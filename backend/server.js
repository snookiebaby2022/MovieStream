const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const compression= require('compression');
const rateLimit  = require('express-rate-limit');
const dotenv     = require('dotenv');
const axios      = require('axios');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const { execSync }    = require('child_process');
const { createServer }= require('http');
const { Server }      = require('socket.io');
const ScraperManager  = require('./scrapers/ScraperManager');
const { router: authRouter } = require('./authRoutes');
const debridRouter = require('./debridRoutes');

dotenv.config();

const app    = express();
const server = createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = parseInt(process.env.PORT) || 3001;
const scraper= new ScraperManager();

// ─── Online tracking ─────────────────────────────────────
const online = new Map();
let totalViews = 0, totalWatches = 0;

io.on('connection', sock => {
  const uid = crypto.randomBytes(8).toString('hex');
  online.set(uid, {
    id: uid,
    ip: sock.handshake.address,
    ua: sock.handshake.headers['user-agent'] || '',
    connectedAt: Date.now(),
    page: 'home',
    watching: null
  });
  io.emit('online-count', online.size);
  sock.on('page-view',      d => { totalViews++; const u=online.get(uid); if(u) u.page=d.page||'home'; });
  sock.on('watching',       d => { totalWatches++; const u=online.get(uid); if(u) u.watching=d; });
  sock.on('stop-watching',  () => { const u=online.get(uid); if(u) u.watching=null; });
  sock.on('disconnect',     () => { online.delete(uid); io.emit('online-count', online.size); });
});

// ─── Middleware ───────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 60000, max: 400, skip: req => req.path.startsWith('/api/admin') }));

// ─── Redis ────────────────────────────────────────────────
const redis = require('redis');
let rc, rok = false;
const mem = new Map();

(async () => {
  try {
    rc = redis.createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
    rc.on('error', () => { rok = false; });
    await rc.connect();
    rok = true;
    global.redisClientAdmin = rc;
    console.log('✅ Redis connected');
  } catch { console.log('⚠️  Redis unavailable - using memory cache'); }
})();

async function getC(k) {
  try { if (rok) { const d = await rc.get(k); return d ? JSON.parse(d) : null; } } catch {}
  const i = mem.get(k);
  if (i && i.exp > Date.now()) return i.data;
  mem.delete(k); return null;
}
async function setC(k, d, ttl = 3600) {
  try { if (rok) { await rc.set(k, JSON.stringify(d), { EX: ttl }); return; } } catch {}
  if (mem.size > 800) mem.delete(mem.keys().next().value);
  mem.set(k, { data: d, exp: Date.now() + ttl * 1000 });
}

// ─── MongoDB ──────────────────────────────────────────────
let mok = false;
try {
  const mongoose = require('mongoose');
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/moviestream', { serverSelectionTimeoutMS: 3000 })
    .then(() => { mok = true; console.log('✅ MongoDB connected'); })
    .catch(() => console.log('⚠️  MongoDB unavailable'));
} catch {}

// ─── TMDB ─────────────────────────────────────────────────
const KEY  = process.env.TMDB_API_KEY || '';
const TMDB = 'https://api.themoviedb.org/3';
const IMG  = 'https://image.tmdb.org/t/p';
const SITE = process.env.SITE_URL || 'https://snookiebaby.xyz';

async function tmdb(path, params = {}) {
  if (!KEY) return null;
  try {
    const r = await axios.get(`${TMDB}${path}`, {
      params: { api_key: KEY, language: 'en-US', ...params },
      timeout: 10000
    });
    return r.data;
  } catch(e) { console.error('TMDB:', path, e.message); return null; }
}

function mapItem(r) {
  const type = r.media_type || (r.first_air_date ? 'tv' : 'movie');
  return {
    id: r.id, tmdbId: r.id,
    title:    r.title || r.name || '',
    type,
    year:     (r.release_date || r.first_air_date || '').slice(0, 4),
    poster:   r.poster_path   ? `${IMG}/w500${r.poster_path}`    : null,
    backdrop: r.backdrop_path ? `${IMG}/w1280${r.backdrop_path}` : null,
    overview: r.overview || '',
    rating:   Math.round((r.vote_average || 0) * 10) / 10,
    popularity: r.popularity || 0,
    voteCount:  r.vote_count  || 0
  };
}

// ─── Discover helper ──────────────────────────────────────
async function discRoute(req, res, path, type, ck, ttl = 3600, extra = {}) {
  try {
    const page = req.query.page || 1;
    const k = `${ck}:${page}`;
    const c = await getC(k);
    if (c) return res.json({ success: true, data: c.r, totalPages: c.tp });
    const d = await tmdb(path, { page, ...extra });
    if (!d) return res.json({ success: true, data: [] });
    const r = d.results.map(x => mapItem({ ...x, media_type: type }));
    await setC(k, { r, tp: d.total_pages }, ttl);
    res.json({ success: true, data: r, totalPages: d.total_pages });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
}

// ─── PUBLIC ROUTES ────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({
  status: 'OK', uptime: Math.floor(process.uptime()), timestamp: Date.now(),
  onlineUsers: online.size, totalViews, totalWatches,
  services: { mongodb: mok?'connected':'unavailable', redis: rok?'connected':'memory',
    tmdb: KEY?'configured':'NOT SET', scrapers: scraper.getScraperStatus().length }
}));

app.get('/api/online', (req, res) => res.json({ success: true, count: online.size, totalViews }));

app.get('/api/trending', async (req, res) => {
  try {
    const c = await getC('trending:week:v2');
    if (c) return res.json({ success: true, data: c });
    const d = await tmdb('/trending/all/week');
    if (!d) return res.json({ success: true, data: [] });
    const r = d.results.filter(x => x.media_type==='movie'||x.media_type==='tv').map(mapItem);
    await setC('trending:week:v2', r, 900);
    res.json({ success: true, data: r });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/trending/day', async (req, res) => {
  try {
    const c = await getC('trending:day:v2');
    if (c) return res.json({ success: true, data: c });
    const d = await tmdb('/trending/all/day');
    if (!d) return res.json({ success: true, data: [] });
    const r = d.results.filter(x => x.media_type==='movie'||x.media_type==='tv').map(mapItem);
    await setC('trending:day:v2', r, 600);
    res.json({ success: true, data: r });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/trending/browse', async (req, res) => {
  try {
    const c = await getC('trending:browse:v2');
    if (c) return res.json({ success: true, data: c });
    const all = [];
    for (let p = 1; p <= 3; p++) {
      const d = await tmdb('/trending/all/week', { page: p });
      if (d?.results) all.push(...d.results.filter(x=>x.media_type==='movie'||x.media_type==='tv').map(mapItem));
    }
    const seen = new Set(); const u = all.filter(x => { if(seen.has(x.id))return false; seen.add(x.id); return true; });
    await setC('trending:browse:v2', u, 900);
    res.json({ success: true, data: u });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

/** Cinema hero: trending titles that have YouTube trailers */
app.get('/api/hero', async (req, res) => {
  try {
    const c = await getC('hero:trailers:v1');
    if (c) return res.json({ success: true, data: c });
    const [day, week, now] = await Promise.all([
      tmdb('/trending/all/day'),
      tmdb('/trending/all/week'),
      tmdb('/movie/now_playing')
    ]);
    const pool = [];
    const seen = new Set();
    const push = (list, forceType) => {
      (list?.results || []).forEach(r => {
        const type = forceType || r.media_type;
        if (type !== 'movie' && type !== 'tv') return;
        const key = type + ':' + r.id;
        if (seen.has(key) || !r.backdrop_path) return;
        seen.add(key);
        pool.push({ ...r, media_type: type });
      });
    };
    push(day); push(week); push(now, 'movie');
    pool.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    const candidates = pool.slice(0, 14);
    const out = [];
    await Promise.all(candidates.map(async (r) => {
      try {
        const vids = await tmdb(`/${r.media_type}/${r.id}/videos`);
        const trailer = (vids?.results || []).find(v =>
          v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')
        );
        if (!trailer?.key) return;
        out.push({ ...mapItem(r), trailerKey: trailer.key, trailerName: trailer.name || 'Trailer' });
      } catch {}
    }));
    out.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    const data = out.slice(0, 8);
    await setC('hero:trailers:v1', data, 1200);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/discover/movie',            (q,s) => discRoute(q,s,'/movie/popular',    'movie','pop:movie', 1800));
app.get('/api/discover/movie/top',        (q,s) => discRoute(q,s,'/movie/top_rated',  'movie','top:movie', 3600));
app.get('/api/discover/movie/nowplaying', (q,s) => discRoute(q,s,'/movie/now_playing','movie','now:movie', 900));
app.get('/api/discover/movie/upcoming',   (q,s) => discRoute(q,s,'/movie/upcoming',   'movie','up:movie', 1800));
app.get('/api/discover/tv',               (q,s) => discRoute(q,s,'/tv/popular',       'tv',  'pop:tv', 1800));
app.get('/api/discover/tv/top',           (q,s) => discRoute(q,s,'/tv/top_rated',     'tv',  'top:tv', 3600));
app.get('/api/discover/tv/airing',        (q,s) => discRoute(q,s,'/tv/airing_today',  'tv',  'air:tv', 900));
app.get('/api/discover/tv/ontheair',      (q,s) => discRoute(q,s,'/tv/on_the_air',    'tv',  'onair:tv', 900));

app.get('/api/discover/genre/:genreId/:type', (req, res) => {
  const { genreId, type } = req.params;
  discRoute(req, res, `/discover/${type}`, type, `genre:${genreId}:${type}`, 3600,
    { with_genres: genreId, sort_by: 'popularity.desc' });
});

app.get('/api/browse/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { genre, sort, pages, year, page, country, decade, anime } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const n = Math.min(parseInt(pages) || (page ? 1 : 3), 10);
    const s = sort || 'popularity.desc';
    const ck = `browse3:${type}:${genre||'all'}:${s}:${year||'any'}:${decade||''}:${country||''}:${anime||''}:${page||'m'}:${n}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c.data, totalPages: c.tp, page: pageNum });
    const all = [];
    let totalPages = 1;
    const start = page ? pageNum : 1;
    const end = page ? pageNum : n;
    for (let p = start; p <= end; p++) {
      const params = { page: p, sort_by: s, include_adult: false };
      if (genre) params.with_genres = genre;
      if (anime === '1') {
        // Animation + Japanese / anime keyword blend
        params.with_genres = type === 'movie' ? '16' : '16';
        if (type === 'tv') params.with_keywords = '210024'; // anime keyword often used
        params.with_origin_country = country || 'JP';
      }
      if (country && anime !== '1') params.with_origin_country = country;
      if (year) {
        if (type === 'movie') params.primary_release_year = year;
        else params.first_air_date_year = year;
      } else if (decade) {
        const d0 = parseInt(decade, 10);
        if (type === 'movie') {
          params['primary_release_date.gte'] = `${d0}-01-01`;
          params['primary_release_date.lte'] = `${d0 + 9}-12-31`;
        } else {
          params['first_air_date.gte'] = `${d0}-01-01`;
          params['first_air_date.lte'] = `${d0 + 9}-12-31`;
        }
      }
      const d = await tmdb(`/discover/${type}`, params);
      if (d?.results) all.push(...d.results.map(x => mapItem({ ...x, media_type: type })));
      if (d?.total_pages) totalPages = d.total_pages;
    }
    const seen = new Set();
    const u = all.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; });
    await setC(ck, { data: u, tp: totalPages }, 3600);
    res.json({ success: true, data: u, totalPages, page: pageNum });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Catalog years for filter UI (123movies-style)
app.get('/api/years', (req, res) => {
  const y = new Date().getFullYear();
  const years = [];
  for (let i = y; i >= 1950; i--) years.push(i);
  res.json({ success: true, data: years });
});

app.get('/api/countries', (req, res) => {
  res.json({
    success: true,
    data: [
      { code: 'US', name: 'USA' }, { code: 'GB', name: 'UK' }, { code: 'CA', name: 'Canada' },
      { code: 'AU', name: 'Australia' }, { code: 'IN', name: 'India' }, { code: 'JP', name: 'Japan' },
      { code: 'KR', name: 'South Korea' }, { code: 'CN', name: 'China' }, { code: 'FR', name: 'France' },
      { code: 'DE', name: 'Germany' }, { code: 'ES', name: 'Spain' }, { code: 'IT', name: 'Italy' },
      { code: 'BR', name: 'Brazil' }, { code: 'MX', name: 'Mexico' }, { code: 'NG', name: 'Nigeria' },
      { code: 'TH', name: 'Thailand' }, { code: 'TR', name: 'Turkey' }, { code: 'RU', name: 'Russia' }
    ]
  });
});

app.get('/api/search/:query', async (req, res) => {
  try {
    const q = req.params.query.trim();
    const page = req.query.page || 1;
    const ck = `search:${q.toLowerCase()}:${page}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c });
    if (!KEY) return res.json({ success: false, error: 'TMDB_API_KEY not set' });
    const d = await tmdb('/search/multi', { query: q, page, include_adult: false });
    if (!d) return res.json({ success: true, data: [] });
    const r = d.results.filter(x => x.media_type==='movie'||x.media_type==='tv').map(mapItem);
    await setC(ck, r, 1800);
    res.json({ success: true, data: r, total: d.total_results });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/details/:tmdbId/:type', async (req, res) => {
  try {
    const { tmdbId, type } = req.params;
    const ck = `det:${tmdbId}:${type}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c });
    const d = await tmdb(`/${type}/${tmdbId}`, { append_to_response: 'credits,videos,external_ids,similar,recommendations' });
    if (!d) return res.status(404).json({ success: false, error: 'Not found' });
    const result = {
      ...mapItem({ ...d, media_type: type }),
      tagline: d.tagline || '',
      runtime: d.runtime || (d.episode_run_time || [])[0] || null,
      status: d.status || '',
      genres: d.genres || [],
      seasons: (d.seasons || []).map(s => ({ season_number: s.season_number, name: s.name, episode_count: s.episode_count, poster_path: s.poster_path, air_date: s.air_date })),
      numberOfSeasons: d.number_of_seasons || null,
      numberOfEpisodes: d.number_of_episodes || null,
      networks: (d.networks || []).map(n => n.name),
      production: (d.production_companies || []).slice(0,3).map(c => c.name),
      cast: (d.credits?.cast || []).slice(0,20).map(c => ({ name: c.name, character: c.character||'', photo: c.profile_path?`${IMG}/w185${c.profile_path}`:null })),
      crew: (d.credits?.crew || []).filter(c => ['Director','Creator','Executive Producer','Writer'].includes(c.job)).slice(0,5).map(c => ({ name: c.name, job: c.job })),
      videos: (d.videos?.results || []).filter(v => v.site==='YouTube').slice(0,3).map(v => ({ key: v.key, name: v.name, type: v.type })),
      similar: (d.similar?.results || d.recommendations?.results || []).slice(0,12).map(x => mapItem({ ...x, media_type: type })),
      imdbId: d.imdb_id || d.external_ids?.imdb_id || null,
      language: d.original_language || 'en',
      countries: (d.production_countries || []).map(c => c.name),
      budget: d.budget || null, revenue: d.revenue || null
    };
    await setC(ck, result, 86400);
    res.json({ success: true, data: result });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/season/:tmdbId/:season', async (req, res) => {
  try {
    const { tmdbId, season } = req.params;
    const ck = `season:${tmdbId}:${season}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c });
    const d = await tmdb(`/tv/${tmdbId}/season/${season}`);
    if (!d) return res.status(404).json({ success: false, error: 'Not found' });
    const result = {
      season: d.season_number, name: d.name, overview: d.overview,
      poster: d.poster_path ? `${IMG}/w300${d.poster_path}` : null,
      episodes: (d.episodes || []).map(e => ({
        episode: e.episode_number, season: e.season_number,
        name: e.name || `Episode ${e.episode_number}`,
        overview: e.overview || '', airDate: e.air_date || '',
        runtime: e.runtime || null,
        stillPath: e.still_path ? `${IMG}/w300${e.still_path}` : null,
        rating: e.vote_average || 0
      }))
    };
    await setC(ck, result, 86400);
    res.json({ success: true, data: result });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/sources/:tmdbId/:type', async (req, res) => {
  try {
    const { tmdbId, type } = req.params;
    const { season, episode, nocache, all } = req.query;
    // Default clean-only (fewer popup-prone hosts). ?all=1 unlocks fallback servers.
    const clean = all !== '1' && all !== 'true';
    const ck = `src6:${tmdbId}:${type}:${season||0}:${episode||0}:${clean?'c':'a'}`;
    if (!nocache) {
      const c = await getC(ck);
      if (c) { console.log(`Cache hit: ${ck}`); return res.json({ success: true, data: c, cached: true }); }
    }
    console.log(`Scraping: ${ck}`);
    const { sources, errors, cleanOnly } = await scraper.getSources(
      tmdbId, type,
      season  ? parseInt(season)  : null,
      episode ? parseInt(episode) : null,
      { clean }
    );
    const result = { sources, errors, totalSources: sources.length, cleanOnly, scrapedAt: Date.now() };
    if (sources.length > 0) await setC(ck, result, 1800);
    res.json({ success: true, data: result });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/genres/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const ck = `genres:${type}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c });
    const d = await tmdb(`/genre/${type}/list`);
    if (!d) return res.json({ success: true, data: [] });
    await setC(ck, d.genres, 86400);
    res.json({ success: true, data: d.genres });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/scrapers', (req, res) => res.json({ success: true, data: scraper.getScraperStatus() }));

app.post('/api/cache/clear', async (req, res) => {
  try { if (rok) await rc.flushAll(); mem.clear(); res.json({ success: true }); }
  catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// User accounts, watchlist, history, comments, ratings
app.use('/api/auth', authRouter);

// Real-Debrid (Torrentio) — token sent per-request via x-rd-token
app.use('/api/debrid', debridRouter);

// SEO
app.get('/sitemap.xml', async (req, res) => {
  let xml = `<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
  try { const d = await tmdb('/trending/all/week'); if(d) d.results.forEach(r => { xml += `<url><loc>${SITE}/watch/${r.media_type}/${r.id}</loc><changefreq>weekly</changefreq></url>\n`; }); } catch {}
  xml += '</urlset>';
  res.set('Content-Type', 'application/xml'); res.send(xml);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
});

// ─── ADMIN ────────────────────────────────────────────────
const TF = process.env.ADMIN_SESSIONS_FILE || path.join(__dirname, '.admin-sessions');
const ENV_FILE = process.env.ENV_FILE || path.join(__dirname, '.env');
let sess = {};
try { sess = JSON.parse(fs.readFileSync(TF, 'utf8')); } catch {}
function saveS() { try { fs.writeFileSync(TF, JSON.stringify(sess)); } catch {} }

function adminAuth(req, res, next) {
  const t = req.headers['x-admin-token'] || req.query.token;
  if (!t || !sess[t] || sess[t].exp < Date.now()) return res.status(401).json({ success: false, error: 'Unauthorized' });
  req.adminUser = sess[t].user; next();
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS;
  console.log(`Admin login attempt: ${username}`);
  if (!adminPass) {
    return res.status(503).json({ success: false, error: 'Set ADMIN_PASS in backend/.env then restart' });
  }
  if (username === adminUser && password === adminPass) {
    const t = crypto.randomBytes(32).toString('hex');
    sess[t] = { user: username, exp: Date.now() + 7*86400000 };
    saveS();
    return res.json({ success: true, token: t, username });
  }
  res.status(401).json({ success: false, error: 'Invalid credentials' });
});

app.post('/api/admin/logout', adminAuth, (req, res) => {
  delete sess[req.headers['x-admin-token']]; saveS(); res.json({ success: true });
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    let pm2d = {};
    try {
      const raw = execSync('pm2 jlist 2>/dev/null', { timeout: 5000 }).toString();
      const ms = JSON.parse(raw).find(p => p.name === 'moviestream');
      if (ms) pm2d = { status: ms.pm2_env.status, restarts: ms.pm2_env.restart_time, pid: ms.pid, memory: ms.monit?.memory, cpu: ms.monit?.cpu, uptime: ms.pm2_env.pm_uptime };
    } catch {}
    let disk = {};
    try { const df = execSync("df -h / | awk 'NR==2{print $2,$3,$4,$5}'").toString().trim().split(' '); disk = { total: df[0], used: df[1], free: df[2], percent: df[3] }; } catch {}
    let ri = { keys: 0, memory: 'N/A', connected: rok };
    try { if (rok) { ri.keys = await rc.dbSize(); const info = await rc.info('memory'); const m = info.match(/used_memory_human:(\S+)/); ri.memory = m?m[1]:'N/A'; } } catch {}
    const total = os.totalmem(), free = os.freemem();
    res.json({ success: true, data: {
      process: pm2d, disk, redis: ri,
      system: { totalMem: Math.round(total/1048576), usedMem: Math.round((total-free)/1048576), freeMem: Math.round(free/1048576), memPercent: Math.round((total-free)/total*100), loadAvg: os.loadavg().map(l=>l.toFixed(2)), uptime: Math.floor(os.uptime()), cpuCount: os.cpus().length, platform: os.platform(), hostname: os.hostname() },
      node: { version: process.version, uptime: Math.floor(process.uptime()), memory: { used: Math.round(process.memoryUsage().heapUsed/1048576), total: Math.round(process.memoryUsage().heapTotal/1048576) } },
      online: { count: online.size, totalViews, totalWatches }
    }});
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/online', adminAuth, (req, res) => {
  const users = Array.from(online.values()).map(u => ({ id: u.id, ip: u.ip.replace('::ffff:',''), connectedAt: u.connectedAt, duration: Math.floor((Date.now()-u.connectedAt)/1000), page: u.page, watching: u.watching, device: /Mobile|Android|iPhone/i.test(u.ua)?'Mobile':'Desktop' }));
  res.json({ success: true, data: users, count: users.length, totalViews, totalWatches });
});

app.get('/api/admin/scrapers', adminAuth, (req, res) => res.json({ success: true, data: scraper.getScraperStatus() }));

app.post('/api/admin/scrapers/test', adminAuth, async (req, res) => {
  const { scraperName, tmdbId='27205', type='movie' } = req.body || {};
  const sc = scraper.scrapers.find(s => s.instance.name === scraperName);
  if (!sc) return res.status(404).json({ success: false, error: 'Not found' });
  const t = Date.now();
  try {
    const r = await Promise.race([sc.instance.getSource(tmdbId, type, null, null), new Promise((_,rej)=>setTimeout(()=>rej(new Error('Timeout')),12000))]);
    res.json({ success: true, data: { scraper: scraperName, working: !!r, source: r, elapsed: `${Date.now()-t}ms` } });
  } catch(e) { res.json({ success: true, data: { scraper: scraperName, working: false, error: e.message, elapsed: `${Date.now()-t}ms` } }); }
});

app.post('/api/admin/scrapers/test-all', adminAuth, async (req, res) => {
  const results = await Promise.allSettled(scraper.scrapers.map(async s => {
    const t = Date.now();
    try { const r = await Promise.race([s.instance.getSource('27205','movie',null,null), new Promise((_,rej)=>setTimeout(()=>rej(new Error('Timeout')),12000))]); return { name: s.instance.name, working: !!r, elapsed: `${Date.now()-t}ms`, url: r?.url||r?.embedUrl||null }; }
    catch(e) { return { name: s.instance.name, working: false, error: e.message, elapsed: `${Date.now()-t}ms` }; }
  }));
  res.json({ success: true, data: results.map(r => r.value||r.reason) });
});

app.get('/api/admin/cache/stats', adminAuth, async (req, res) => {
  try {
    if (!rok) return res.json({ success: true, data: { connected: false, keys: 0, memory: 'N/A' } });
    const keys = await rc.dbSize(); const info = await rc.info('memory'); const m = info.match(/used_memory_human:(\S+)/);
    res.json({ success: true, data: { connected: true, keys, memory: m?m[1]:'N/A' } });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/admin/cache/clear', adminAuth, async (req, res) => {
  try { if (rok) await rc.flushAll(); mem.clear(); res.json({ success: true }); }
  catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/logs/:type', adminAuth, (req, res) => {
  const file = req.params.type==='error' ? '/var/log/moviestream-error.log' : '/var/log/moviestream-out.log';
  const lines = parseInt(req.query.lines) || 100;
  try { const out = execSync(`tail -${lines} "${file}" 2>/dev/null || echo "No logs"`, { timeout: 5000 }).toString(); res.json({ success: true, data: out, file }); }
  catch { res.json({ success: true, data: 'No logs', file }); }
});

app.delete('/api/admin/logs/clear', adminAuth, (req, res) => {
  try { execSync('> /var/log/moviestream-out.log; > /var/log/moviestream-error.log'); res.json({ success: true }); }
  catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/process/:action', adminAuth, (req, res) => {
  const { action } = req.params;
  if (!['restart','reload','stop','start'].includes(action)) return res.status(400).json({ success: false, error: 'Invalid' });
  try { execSync(`pm2 ${action} moviestream 2>&1`, { timeout: 15000 }); res.json({ success: true, message: `App ${action}ed` }); }
  catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/nginx/:action', adminAuth, (req, res) => {
  const { action } = req.params;
  if (!['restart','reload','start','stop','test'].includes(action)) return res.status(400).json({ success: false, error: 'Invalid' });
  try { const cmd = action==='test' ? 'nginx -t 2>&1' : `systemctl ${action} nginx 2>&1`; const out = execSync(cmd, { timeout: 10000 }).toString(); res.json({ success: true, message: out||'OK' }); }
  catch(e) { res.status(500).json({ success: false, error: e.stderr?.toString()||e.message }); }
});

function isSecretEnvKey(k) {
  return /SECRET|PASS|KEY|TOKEN|URI|URL/i.test(k) && !/^SITE_URL$/i.test(k);
}

function upsertEnvKey(key, value) {
  let raw = '';
  try { raw = fs.readFileSync(ENV_FILE, 'utf8'); } catch { raw = ''; }
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value ?? ''}`;
  raw = re.test(raw) ? raw.replace(re, line) : (raw.replace(/\s*$/, '') + `\n${line}\n`);
  fs.writeFileSync(ENV_FILE, raw);
}

app.get('/api/admin/config', adminAuth, (req, res) => {
  try {
    const raw = fs.readFileSync(ENV_FILE, 'utf8');
    const conf = {};
    raw.split('\n').forEach(line => {
      const eq = line.indexOf('=');
      if (eq > 0 && !line.startsWith('#')) {
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1).trim();
        conf[k] = isSecretEnvKey(k) ? '***' : v;
      }
    });
    res.json({ success: true, data: conf });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/admin/config', adminAuth, (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ success: false, error: 'Key required' });
  if (isSecretEnvKey(key) && key !== 'REALDEBRID_API_TOKEN') {
    return res.status(400).json({ success: false, error: 'Use the Real-Debrid page or edit .env on the server for secrets' });
  }
  try {
    upsertEnvKey(key, value);
    res.json({ success: true, message: 'Saved - restart to apply' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/** Admin Real-Debrid management */
app.get('/api/admin/debrid', adminAuth, async (req, res) => {
  const token = (process.env.REALDEBRID_API_TOKEN || process.env.RD_API_TOKEN || '').trim();
  if (!token) {
    return res.json({ success: true, configured: false, siteConfigured: false });
  }
  try {
    const r = await axios.get('https://api.real-debrid.com/rest/1.0/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'FlixNova-Admin' },
      timeout: 10000
    });
    res.json({
      success: true,
      configured: true,
      siteConfigured: true,
      data: {
        username: r.data.username,
        email: r.data.email,
        premium: r.data.type === 'premium',
        expiration: r.data.expiration,
        points: r.data.points,
        tokenHint: token.slice(0, 4) + '…' + token.slice(-4)
      }
    });
  } catch (e) {
    const status = e.response?.status;
    res.status(status === 401 ? 401 : 502).json({
      success: false,
      configured: true,
      siteConfigured: true,
      error: status === 401 ? 'Invalid Real-Debrid token' : (e.message || 'RD check failed')
    });
  }
});

app.put('/api/admin/debrid', adminAuth, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ success: false, error: 'Token required' });
  try {
    const r = await axios.get('https://api.real-debrid.com/rest/1.0/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'FlixNova-Admin' },
      timeout: 10000
    });
    upsertEnvKey('REALDEBRID_API_TOKEN', token);
    process.env.REALDEBRID_API_TOKEN = token;
    res.json({
      success: true,
      message: 'Real-Debrid token saved and active',
      data: {
        username: r.data.username,
        premium: r.data.type === 'premium',
        expiration: r.data.expiration
      }
    });
  } catch (e) {
    const status = e.response?.status;
    res.status(status === 401 ? 401 : 502).json({
      success: false,
      error: status === 401 ? 'Invalid Real-Debrid token' : (e.message || 'Could not verify token')
    });
  }
});

app.delete('/api/admin/debrid', adminAuth, (req, res) => {
  try {
    upsertEnvKey('REALDEBRID_API_TOKEN', '');
    delete process.env.REALDEBRID_API_TOKEN;
    delete process.env.RD_API_TOKEN;
    res.json({ success: true, message: 'Site Real-Debrid token cleared' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/debrid/test', adminAuth, async (req, res) => {
  try {
    const token = (process.env.REALDEBRID_API_TOKEN || process.env.RD_API_TOKEN || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'No site RD token configured' });
    const { tmdbId = '27205', type = 'movie', season = 1, episode = 1 } = req.body || {};
    const media = type === 'tv' ? 'tv' : 'movie';
    let imdb = '';
    if (KEY) {
      try {
        const ext = await axios.get(`${TMDB}/${media}/${tmdbId}/external_ids`, {
          params: { api_key: KEY }, timeout: 8000
        });
        imdb = ext.data?.imdb_id || '';
      } catch {}
    }
    if (!imdb) return res.status(400).json({ success: false, error: 'Could not resolve IMDB id' });
    const cfg = `realdebrid=${encodeURIComponent(token)}|qualityfilter=scr,cam,unknown`;
    const pathStr = media === 'tv'
      ? `/stream/series/${imdb}:${parseInt(season, 10) || 1}:${parseInt(episode, 10) || 1}.json`
      : `/stream/movie/${imdb}.json`;
    const t0 = Date.now();
    const r = await axios.get(`https://torrentio.strem.fun/${cfg}${pathStr}`, {
      headers: { 'User-Agent': 'FlixNova-Admin', Accept: 'application/json' },
      timeout: 25000,
      validateStatus: s => s < 500
    });
    const streams = (r.data?.streams || []).filter(s => /^https?:\/\//i.test(s.url || s.externalUrl || ''));
    res.json({
      success: true,
      data: {
        imdbId: imdb,
        tmdbId,
        type: media,
        streamCount: streams.length,
        sample: streams.slice(0, 5).map(s => (s.title || s.name || '').split('\n')[0]),
        elapsed: `${Date.now() - t0}ms`
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/test/search/:query', adminAuth, async (req, res) => {
  const t = Date.now();
  try { const r = await axios.get(`${TMDB}/search/multi`, { params: { api_key: KEY, query: req.params.query }, timeout: 8000 }); res.json({ success: true, data: r.data.results.slice(0,5), elapsed: `${Date.now()-t}ms` }); }
  catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/admin/test/sources', adminAuth, async (req, res) => {
  const t = Date.now(); const { tmdbId='27205', type='movie', season, episode } = req.body||{};
  const result = await scraper.getSources(tmdbId, type, season, episode);
  res.json({ success: true, data: result, elapsed: `${Date.now()-t}ms` });
});

// ─── 404 for API ─────────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// ─── Static site + SPA watch routes ──────────────────────
const WEB = path.join(__dirname, '..', 'website');
const ADMIN_DIR = path.join(__dirname, '..', 'admin');
app.use('/admin', express.static(ADMIN_DIR, { index: 'index.html' }));
app.use(express.static(WEB, { index: 'index.html', maxAge: '1h' }));

// Shareable watch URLs → SPA (nginx should also try_files to index.html)
app.get('/watch/:type/:id/:season?/:episode?', (req, res) => {
  res.sendFile(path.join(WEB, 'index.html'));
});
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(WEB, 'index.html'), err => { if (err) next(); });
});

// ─── Start ────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ✅ FlixNova API running on port ${PORT}`);
  console.log(`  TMDB: ${KEY ? '✅ configured' : '❌ NOT SET - add TMDB_API_KEY to .env'}`);
  console.log(`  Scrapers: ${scraper.getScraperStatus().length}`);
  console.log(`  Auth/DB: MongoDB user accounts enabled when connected\n`);
});

process.on('SIGTERM', async () => { if (rc) await rc.quit().catch(()=>{}); process.exit(0); });
