const path = require('path');
const dotenv = require('dotenv');
// Load env BEFORE other local modules read process.env
dotenv.config({ path: path.join(__dirname, '.env') });

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const compression= require('compression');
const rateLimit  = require('express-rate-limit');
const axios      = require('axios');
const crypto     = require('crypto');
const fs         = require('fs');
const os         = require('os');
const { execSync }    = require('child_process');
const { createServer }= require('http');
const { Server }      = require('socket.io');
const ScraperManager  = require('./scrapers/ScraperManager');
const { router: authRouter, verifyToken } = require('./authRoutes');
const debridRouter = require('./debridRoutes');
const { router: featureRouter } = require('./featureRoutes');
const { router: payRouter, handleWebhook } = require('./paymentRoutes');
const { PlayEvent, User, ContactMessage, TitleRequest, Promo } = require('./models');

function requireUser(req, res) {
  const tok = req.headers['x-user-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = verifyToken(tok);
  if (!user) {
    res.status(401).json({ success: false, error: 'Login required to watch' });
    return null;
  }
  return user;
}

const app    = express();
const server = createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = parseInt(process.env.PORT) || 3001;
const scraper= new ScraperManager();

// Stripe webhook needs raw body (must be before express.json)
app.post('/api/pay/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// ─── Online tracking ─────────────────────────────────────
const online = new Map(); // socket.id -> session
const visitors = new Map(); // stable visitor id -> { firstSeen, user, role }
let totalViews = 0, totalWatches = 0;

function clientIp(sock) {
  const xf = sock.handshake.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim().replace('::ffff:', '');
  return String(sock.handshake.address || '').replace('::ffff:', '');
}

function getOnlineStats() {
  const ips = new Set();
  const watchingIps = new Set();
  for (const u of online.values()) {
    if ((u.vid || '').startsWith('tmp-')) continue;
    const key = u.ip || u.vid || u.id;
    ips.add(key);
    if (u.watching && (u.watching.title || u.watching.tmdbId)) watchingIps.add(key);
  }
  return {
    count: ips.size,
    connections: [...online.values()].filter(u => !(u.vid || '').startsWith('tmp-')).length,
    currentlyWatching: watchingIps.size,
    totalViews,
    totalWatches
  };
}

function scoreSession(u) {
  let s = 0;
  if (u.watching && (u.watching.title || u.watching.tmdbId)) s += 100;
  if (u.user) s += 20;
  if (u.role === 'admin') s += 10;
  if (u.page && u.page !== 'admin') s += 5;
  s += Math.min(30, Math.floor(((Date.now() - (u.firstSeen || Date.now())) / 1000) / 60));
  return s;
}

function mergedOnlineUsers() {
  const byKey = new Map();
  for (const u of online.values()) {
    if ((u.vid || '').startsWith('tmp-')) continue;
    const key = u.ip || u.vid || u.id;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        ...u,
        tabs: 1,
        firstSeen: u.firstSeen || u.connectedAt || Date.now()
      });
      continue;
    }
    cur.tabs += 1;
    cur.firstSeen = Math.min(cur.firstSeen || Date.now(), u.firstSeen || u.connectedAt || Date.now());
    if (scoreSession(u) >= scoreSession(cur)) {
      cur.id = u.id;
      cur.vid = u.vid;
      cur.ua = u.ua;
      cur.page = u.page;
      cur.watching = u.watching;
      cur.user = u.user || cur.user;
      cur.role = u.role || cur.role;
    } else {
      cur.user = cur.user || u.user;
      cur.role = cur.role || u.role;
      if (!cur.watching && u.watching) cur.watching = u.watching;
    }
    cur.lastSeen = Math.max(cur.lastSeen || 0, u.lastSeen || 0);
  }
  return Array.from(byKey.values());
}

function broadcastOnline() {
  const s = getOnlineStats();
  io.emit('online-count', s.count);
  io.emit('online-stats', s);
}

function normalizeWatching(d) {
  if (!d || typeof d !== 'object') return null;
  const title = String(d.title || '').trim();
  const tmdbId = d.tmdbId || d.id || null;
  if (!title && !tmdbId) return null;
  const out = {
    title: title || 'Unknown title',
    tmdbId,
    type: d.type === 'tv' ? 'tv' : 'movie'
  };
  if (out.type === 'tv') {
    if (d.season != null) out.season = Number(d.season) || 1;
    if (d.episode != null) out.episode = Number(d.episode) || 1;
  }
  return out;
}

function upsertPresence(sock, payload) {
  const d = payload || {};
  const vid = String(d.vid || sock.id).slice(0, 64);
  const prevVisit = visitors.get(vid) || {};
  const existing = online.get(sock.id);
  const firstSeen = prevVisit.firstSeen || (existing && existing.firstSeen) || Date.now();
  const username = String(d.username || d.user || prevVisit.user || (existing && existing.user) || '').slice(0, 40) || null;
  const role = String(d.role || prevVisit.role || (existing && existing.role) || '').slice(0, 20) || null;
  const watching = d.watching !== undefined
    ? normalizeWatching(d.watching)
    : (existing ? existing.watching : null);
  const page = (d.page || (existing && existing.page) || 'home').toString().slice(0, 40);
  const session = {
    id: sock.id.slice(0, 8),
    vid,
    ip: clientIp(sock),
    ua: sock.handshake.headers['user-agent'] || '',
    firstSeen,
    connectedAt: firstSeen,
    lastSeen: Date.now(),
    page,
    watching,
    user: username,
    role
  };
  online.set(sock.id, session);
  visitors.set(vid, { firstSeen, user: username, role, lastSeen: Date.now() });
  // prune idle visitor memory (24h)
  if (visitors.size > 5000) {
    const cut = Date.now() - 86400000;
    for (const [k, v] of visitors) {
      if ((v.lastSeen || 0) < cut) visitors.delete(k);
    }
  }
  return session;
}

io.on('connection', sock => {
  // Temporary row until client sends hello/identify
  upsertPresence(sock, { vid: 'tmp-' + sock.id, page: 'home' });
  broadcastOnline();
  sock.emit('online-count', getOnlineStats().count);

  sock.on('hello', d => {
    upsertPresence(sock, d || {});
    broadcastOnline();
  });
  sock.on('page-view', d => {
    totalViews++;
    const u = online.get(sock.id);
    if (u) {
      u.page = (d && d.page) || 'home';
      u.lastSeen = Date.now();
    } else {
      upsertPresence(sock, { page: d && d.page });
    }
  });
  sock.on('identify', d => {
    const u = online.get(sock.id);
    if (!u || !d) return;
    const name = String(d.username || d.user || '').slice(0, 40);
    if (name) {
      u.user = name;
      if (d.role) u.role = String(d.role).slice(0, 20);
      const prev = visitors.get(u.vid) || { firstSeen: u.firstSeen };
      visitors.set(u.vid, { ...prev, user: name, role: u.role, lastSeen: Date.now() });
    }
  });
  sock.on('watching', d => {
    totalWatches++;
    const u = online.get(sock.id);
    const watching = normalizeWatching(d);
    if (u) {
      u.watching = watching;
      u.page = watching ? 'watching' : (u.page || 'home');
      u.lastSeen = Date.now();
    } else {
      upsertPresence(sock, { watching: d, page: 'watching' });
    }
    broadcastOnline();
  });
  sock.on('stop-watching', () => {
    const u = online.get(sock.id);
    if (u) {
      u.watching = null;
      if (u.page === 'watching') u.page = 'home';
      u.lastSeen = Date.now();
    }
    broadcastOnline();
  });
  sock.on('presence', d => {
    upsertPresence(sock, d || {});
    broadcastOnline();
  });
  sock.on('disconnect', () => {
    online.delete(sock.id);
    broadcastOnline();
  });
});

// ─── Middleware ───────────────────────────────────────────
// Behind nginx/Cloudflare — required so express-rate-limit doesn't throw on X-Forwarded-For
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '256kb' }));
app.use(rateLimit({
  windowMs: 60000,
  max: 400,
  skip: req => req.path.startsWith('/api/admin') && req.path !== '/api/admin/login',
  validate: { xForwardedForHeader: false }
}));
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { success: false, error: 'Too many admin login attempts. Try again later.' }
});

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
const SITE = (process.env.SITE_URL || 'https://snookiebaby.xyz').replace(/\/$/, '');

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
    voteCount:  r.vote_count  || 0,
    adult:    !!r.adult
  };
}

function wantAdultQuery(req) {
  const v = req?.query?.adult;
  return v === '1' || v === 'true' || v === 'yes';
}

/** Adult/XXX is Ad-Free only — query flag alone is not enough */
async function allowAdult(req) {
  if (!wantAdultQuery(req)) return false;
  const tok = req.headers['x-user-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verifyToken(tok);
  if (!payload?.id) return false;
  try {
    if (require('mongoose').connection.readyState !== 1) return false;
    const u = await User.findById(payload.id).select('adFree');
    return !!u?.adFree;
  } catch {
    return false;
  }
}

function filterAdult(list, allow) {
  if (allow) return list || [];
  return (list || []).filter(x => !x.adult);
}

// ─── Discover helper ──────────────────────────────────────
async function discRoute(req, res, path, type, ck, ttl = 3600, extra = {}) {
  try {
    const page = req.query.page || 1;
    const adult = await allowAdult(req);
    const k = `${ck}:${page}:a${adult ? 1 : 0}`;
    const c = await getC(k);
    if (c) return res.json({ success: true, data: c.r, totalPages: c.tp });
    const d = await tmdb(path, { page, include_adult: adult, ...extra });
    if (!d) return res.json({ success: true, data: [] });
    const r = filterAdult(d.results.map(x => mapItem({ ...x, media_type: type })), adult);
    await setC(k, { r, tp: d.total_pages }, ttl);
    res.json({ success: true, data: r, totalPages: d.total_pages });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
}

// ─── PUBLIC ROUTES ────────────────────────────────────────

app.get('/api/health', (req, res) => {
  const s = getOnlineStats();
  res.json({
    status: 'OK', uptime: Math.floor(process.uptime()), timestamp: Date.now(),
    onlineUsers: s.count, connections: s.connections, currentlyWatching: s.currentlyWatching,
    totalViews: s.totalViews, totalWatches: s.totalWatches,
    services: { mongodb: mok?'connected':'unavailable', redis: rok?'connected':'memory',
      tmdb: KEY?'configured':'NOT SET', scrapers: scraper.getScraperStatus().length }
  });
});

app.get('/api/online', (req, res) => {
  const s = getOnlineStats();
  res.json({
    success: true,
    count: s.count,
    connections: s.connections,
    currentlyWatching: s.currentlyWatching,
    totalViews: s.totalViews,
    totalWatches: s.totalWatches
  });
});

// Native Android / Fire Stick APK version (for in-app update prompts)
app.get('/api/app/version', (req, res) => {
  res.json({
    success: true,
    platform: 'android',
    versionCode: 2,
    versionName: '1.1.0',
    minVersionCode: 2,
    apkUrl: 'https://snookiebaby.xyz/downloads/FlixNova-android.apk',
    firetvApkUrl: 'https://snookiebaby.xyz/downloads/FlixNova-firetv.apk',
    notes: 'Fire Stick / Android TV optimized: embed hosts allowed, D-pad focus, single-iframe player.',
    forceUpdate: false
  });
});

app.get('/api/trending', async (req, res) => {
  try {
    const adult = await allowAdult(req);
    const page = Math.max(1, Math.min(parseInt(req.query.page) || 1, 500));
    const ck = `trending:week:v4:a${adult ? 1 : 0}:p${page}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c.r, totalPages: c.tp, page });
    const d = await tmdb('/trending/all/week', { page });
    if (!d) return res.json({ success: true, data: [], totalPages: 1, page });
    const r = filterAdult(
      d.results.filter(x => x.media_type==='movie'||x.media_type==='tv').map(mapItem),
      adult
    );
    const tp = d.total_pages || 1;
    await setC(ck, { r, tp }, 900);
    res.json({ success: true, data: r, totalPages: tp, page });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/trending/day', async (req, res) => {
  try {
    const adult = await allowAdult(req);
    const page = Math.max(1, Math.min(parseInt(req.query.page) || 1, 500));
    const ck = `trending:day:v4:a${adult ? 1 : 0}:p${page}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c.r, totalPages: c.tp, page });
    const d = await tmdb('/trending/all/day', { page });
    if (!d) return res.json({ success: true, data: [], totalPages: 1, page });
    const r = filterAdult(
      d.results.filter(x => x.media_type==='movie'||x.media_type==='tv').map(mapItem),
      adult
    );
    const tp = d.total_pages || 1;
    await setC(ck, { r, tp }, 600);
    res.json({ success: true, data: r, totalPages: tp, page });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/trending/browse', async (req, res) => {
  try {
    const adult = await allowAdult(req);
    const page = Math.max(1, Math.min(parseInt(req.query.page) || 1, 500));
    const ck = `trending:browse:v4:a${adult ? 1 : 0}:p${page}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c.r, totalPages: c.tp, page });
    const d = await tmdb('/trending/all/week', { page });
    if (!d) return res.json({ success: true, data: [], totalPages: 1, page });
    const r = filterAdult(
      (d.results || []).filter(x => x.media_type==='movie'||x.media_type==='tv').map(mapItem),
      adult
    );
    const tp = d.total_pages || 1;
    await setC(ck, { r, tp }, 900);
    res.json({ success: true, data: r, totalPages: tp, page });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

/** Cinema hero: trending → in cinemas trailers (up to 20) */
app.get('/api/hero', async (req, res) => {
  try {
    const adult = await allowAdult(req);
    const c = await getC(`hero:trailers:v4:a${adult ? 1 : 0}`);
    if (c) return res.json({ success: true, data: c });
    const [day, week, now1, pop] = await Promise.all([
      tmdb('/trending/all/day'),
      tmdb('/trending/all/week'),
      tmdb('/movie/now_playing', { page: 1 }),
      tmdb('/movie/popular', { page: 1 })
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
    push(day); push(week); push(now1, 'movie'); push(pop, 'movie');
    if (!adult) pool.splice(0, pool.length, ...pool.filter(r => !r.adult));
    pool.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    const candidates = pool.slice(0, 24);
    const out = [];
    // Batched video lookups (avoid stampeding TMDB)
    for (let i = 0; i < candidates.length && out.length < 12; i += 8) {
      const batch = candidates.slice(i, i + 8);
      await Promise.all(batch.map(async (r) => {
        if (out.length >= 12) return;
        try {
          const vids = await tmdb(`/${r.media_type}/${r.id}/videos`);
          const trailer = (vids?.results || []).find(v =>
            v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')
          );
          if (!trailer?.key) return;
          out.push({ ...mapItem(r), trailerKey: trailer.key, trailerName: trailer.name || 'Trailer' });
        } catch {}
      }));
    }
    out.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    const data = out.slice(0, 12);
    await setC(`hero:trailers:v4:a${adult ? 1 : 0}`, data, 3600);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Adult / XXX catalog — Ad-Free accounts only (bounded but larger catalog) */
app.get('/api/discover/adult', async (req, res) => {
  try {
    if (!(await allowAdult(req))) {
      return res.status(403).json({
        success: false,
        error: 'Adult / XXX is included with Ad-Free £1. Unlock then turn XXX On.',
        code: 'ADFREE_REQUIRED'
      });
    }
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const ck = `adult:cat:v6:${page}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c.r, totalPages: c.tp, page });
    const all = [];
    const queries = [
      'xxx', 'adult', 'erotic', 'pornographic', 'softcore', 'hardcore',
      'hentai', 'explicit', 'adult film', 'japanese adult', 'european adult',
      'playboy', 'penthouse', 'nude', 'lesbian', 'gay adult', 'milf',
      'pornstar', 'uncensored', 'blue movie', 'adult comedy', 'erotica',
      'sex comedy', 'erotic thriller', 'adult anime', 'jav', 'av idol'
    ];
    // Rotate fewer queries per page (faster cold cache); discover pages fill the rest
    const start = ((page - 1) * 6) % queries.length;
    const qSlice = [];
    for (let i = 0; i < 6; i++) qSlice.push(queries[(start + i) % queries.length]);
    await Promise.all(qSlice.map(async (q) => {
      const d = await tmdb('/search/movie', { query: q, page, include_adult: true });
      if (d?.results) all.push(...d.results.filter(x => x.adult).map(x => mapItem({ ...x, media_type: 'movie' })));
    }));
    await Promise.all([0, 1, 2].map(async (off) => {
      const p = page + off;
      const dm = await tmdb('/discover/movie', { page: p, include_adult: true, sort_by: 'popularity.desc' });
      if (dm?.results) all.push(...dm.results.filter(x => x.adult).map(x => mapItem({ ...x, media_type: 'movie' })));
    }));
    const seen = new Set();
    const r = all
      .filter(x => {
        if (seen.has(x.id)) return false;
        seen.add(x.id);
        return true;
      })
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    await setC(ck, { r, tp: 80 }, 3600);
    res.json({ success: true, data: r, totalPages: 80, page });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Fat home catalog — many movie/TV rows in one request */
app.get('/api/catalog/home', async (req, res) => {
  try {
    const adult = await allowAdult(req);
    const ck = `home:catalog:v2:a${adult ? 1 : 0}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c });

    const movieGenres = [
      [28, 'Action'], [12, 'Adventure'], [16, 'Animation'], [35, 'Comedy'],
      [80, 'Crime'], [18, 'Drama'], [14, 'Fantasy'], [27, 'Horror'],
      [878, 'Sci-Fi'], [53, 'Thriller'], [10749, 'Romance'], [9648, 'Mystery'],
      [10752, 'War'], [37, 'Western'], [99, 'Documentary'], [36, 'History']
    ];
    const tvGenres = [
      [10759, 'Action & Adventure'], [16, 'Animation'], [35, 'Comedy'],
      [80, 'Crime'], [18, 'Drama'], [10765, 'Sci-Fi & Fantasy'],
      [9648, 'Mystery'], [10751, 'Family'], [10762, 'Kids'], [10764, 'Reality']
    ];

    const fetchBrowse = async (type, extra = {}, pages = 1) => {
      const all = [];
      for (let p = 1; p <= pages; p++) {
        const d = await tmdb(`/discover/${type}`, {
          page: p,
          sort_by: 'popularity.desc',
          include_adult: adult,
          ...extra
        });
        if (d?.results) all.push(...d.results.map(x => mapItem({ ...x, media_type: type })));
      }
      return filterAdult(all, adult);
    };

    const [
      trendingDay, trendingWeek, nowPlaying,
      popMovie, topMovie, popTv, topTv, animeTv, animeMovie
    ] = await Promise.all([
      tmdb('/trending/all/day', { page: 1 }),
      tmdb('/trending/all/week', { page: 1 }),
      fetchBrowse('movie', {}, 1),
      fetchBrowse('movie', {}, 2),
      fetchBrowse('movie', { sort_by: 'vote_average.desc', 'vote_count.gte': 300 }, 1),
      fetchBrowse('tv', {}, 2),
      fetchBrowse('tv', { sort_by: 'vote_average.desc', 'vote_count.gte': 200 }, 1),
      fetchBrowse('tv', { with_genres: '16', with_origin_country: 'JP' }, 1),
      fetchBrowse('movie', { with_genres: '16', with_origin_country: 'JP' }, 1)
    ]);

    const mapTrend = (d) => filterAdult(
      (d?.results || []).filter(x => x.media_type === 'movie' || x.media_type === 'tv').map(mapItem),
      adult
    );

    // now_playing / airing via dedicated endpoints for accuracy
    const [nowApi, airApi, onAirApi, upApi] = await Promise.all([
      tmdb('/movie/now_playing', { page: 1 }),
      tmdb('/tv/airing_today', { page: 1 }),
      tmdb('/tv/on_the_air', { page: 1 }),
      tmdb('/movie/upcoming', { page: 1 })
    ]);
    const now = filterAdult((nowApi?.results || []).map(x => mapItem({ ...x, media_type: 'movie' })), adult);
    const air = filterAdult((airApi?.results || []).map(x => mapItem({ ...x, media_type: 'tv' })), adult);
    const onair = filterAdult((onAirApi?.results || []).map(x => mapItem({ ...x, media_type: 'tv' })), adult);
    const up = filterAdult((upApi?.results || []).map(x => mapItem({ ...x, media_type: 'movie' })), adult);

    const genreMovieRows = await Promise.all(movieGenres.map(async ([id, name]) => ({
      title: `Movies · ${name}`,
      items: await fetchBrowse('movie', { with_genres: String(id) }, 1),
      ap: `/browse/movie?genre=${id}`
    })));
    const genreTvRows = await Promise.all(tvGenres.map(async ([id, name]) => ({
      title: `TV · ${name}`,
      items: await fetchBrowse('tv', { with_genres: String(id) }, 1),
      ap: `/browse/tv?genre=${id}`
    })));

    const sections = [
      { title: 'Trending Today', items: mapTrend(trendingDay), ap: '/trending/day' },
      { title: 'Trending This Week', items: mapTrend(trendingWeek), ap: '/trending/browse' },
      { title: 'Now in Cinemas', items: now.length ? now : nowPlaying, ap: '/browse/movie' },
      { title: 'Popular Movies', items: popMovie, ap: '/browse/movie' },
      { title: 'Popular TV Shows', items: popTv, ap: '/browse/tv' },
      { title: 'Top Rated Movies', items: topMovie, ap: '/browse/movie?sort=vote_average.desc' },
      { title: 'Top Rated TV', items: topTv, ap: '/browse/tv?sort=vote_average.desc' },
      { title: 'Airing Today', items: air, ap: '/browse/tv' },
      { title: 'On The Air', items: onair, ap: '/browse/tv' },
      { title: 'Coming Soon', items: up, ap: '/discover/movie/upcoming' },
      { title: 'Anime Series', items: animeTv, ap: '/browse/tv?anime=1' },
      { title: 'Anime Movies', items: animeMovie, ap: '/browse/movie?anime=1' },
      ...genreMovieRows,
      ...genreTvRows
    ].map(s => ({ ...s, items: (s.items || []).slice(0, 36) }))
      .filter(s => s.items && s.items.length);

    await setC(ck, sections, 1800);
    res.json({ success: true, data: sections });
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
    const { genre, sort, pages, year, page, country, decade, anime, kids } = req.query;
    const adult = (await allowAdult(req)) && kids !== '1' && kids !== 'true';
    const pageNum = Math.max(1, Math.min(parseInt(page) || 1, 500));
    // When paginating with `page`, always fetch exactly that TMDB page (ignore `pages` bootstrap)
    const n = page
      ? 1
      : Math.min(parseInt(pages) || 3, 10);
    const s = sort || 'popularity.desc';
    const ck = `browse6:${type}:${genre||'all'}:${s}:${year||'any'}:${decade||''}:${country||''}:${anime||''}:${kids||''}:a${adult?1:0}:p${page?pageNum:'m'}:n${n}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c.data, totalPages: c.tp, page: pageNum });
    const all = [];
    let totalPages = 1;
    const start = page ? pageNum : 1;
    const end = page ? pageNum : n;
    for (let p = start; p <= end; p++) {
      const params = { page: p, sort_by: s, include_adult: adult };
      if (kids === '1' || kids === 'true') {
        params.include_adult = false;
        params.certification_country = 'US';
        if (type === 'movie') params['certification.lte'] = 'PG-13';
        else {
          params.with_genres = genre || '10751|16'; // Family / Animation bias for kids TV
        }
      }
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
    const u = filterAdult(
      all.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; }),
      adult
    );
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
    const adult = await allowAdult(req);
    const ck = `search:v2:${q.toLowerCase()}:${page}:a${adult ? 1 : 0}`;
    const c = await getC(ck);
    if (c) return res.json({ success: true, data: c });
    if (!KEY) return res.json({ success: false, error: 'TMDB_API_KEY not set' });
    const d = await tmdb('/search/multi', { query: q, page, include_adult: adult });
    if (!d) return res.json({ success: true, data: [] });
    const r = filterAdult(
      d.results.filter(x => x.media_type==='movie'||x.media_type==='tv').map(mapItem),
      adult
    );
    await setC(ck, r, 1800);
    res.json({ success: true, data: r, total: d.total_results });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/details/:tmdbId/:type', async (req, res) => {
  try {
    const { tmdbId, type } = req.params;
    const adult = await allowAdult(req);
    const ck = `det:v3:${tmdbId}:${type}`;
    const scrub = (data) => {
      if (!data) return data;
      return {
        ...data,
        similar: filterAdult(data.similar || [], adult)
      };
    };
    const c = await getC(ck);
    if (c) {
      if (c.adult && !adult) return res.status(404).json({ success: false, error: 'Adult content hidden' });
      return res.json({ success: true, data: scrub(c) });
    }
    const d = await tmdb(`/${type}/${tmdbId}`, { append_to_response: 'credits,videos,external_ids,similar,recommendations' });
    if (!d) return res.status(404).json({ success: false, error: 'Not found' });
    if (d.adult && !adult) return res.status(404).json({ success: false, error: 'Adult content hidden' });
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
      similar: (d.similar?.results || d.recommendations?.results || []).slice(0,24).map(x => mapItem({ ...x, media_type: type })),
      imdbId: d.imdb_id || d.external_ids?.imdb_id || null,
      language: d.original_language || 'en',
      countries: (d.production_countries || []).map(c => c.name),
      budget: d.budget || null, revenue: d.revenue || null
    };
    await setC(ck, result, 86400);
    res.json({ success: true, data: scrub(result) });
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
    if (!requireUser(req, res)) return;
    const { tmdbId, type } = req.params;
    const { season, episode, nocache, all } = req.query;
    // Default clean-only (fewer popup-prone hosts). ?all=1 unlocks fallback servers.
    const clean = all !== '1' && all !== 'true';
    const ck = `src8:${tmdbId}:${type}:${season||0}:${episode||0}:${clean?'c':'a'}`;
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

app.get('/api/scrapers', (req, res) => res.status(401).json({ success: false, error: 'Admin only' }));

// Public cache flush removed — use DELETE /api/admin/cache/clear

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { success: false, error: 'Too many messages. Try again later.' }
});

app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const name = String((req.body || {}).name || '').trim().slice(0, 80);
    const email = String((req.body || {}).email || '').trim().toLowerCase().slice(0, 120);
    const subject = String((req.body || {}).subject || '').trim().slice(0, 120);
    const message = String((req.body || {}).message || '').trim().slice(0, 4000);
    if (!name || !email || !subject || !message || message.length < 10) {
      return res.status(400).json({ success: false, error: 'Name, email, subject, and message (10+) required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Valid email required' });
    }
    if (require('mongoose').connection.readyState === 1) {
      await ContactMessage.create({ name, email, subject, message });
    } else {
      console.log('[contact]', name, email, subject, message.slice(0, 200));
    }
    // Optional SMTP notify to SMTP_FROM / SMTP_USER
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: process.env.SMTP_SECURE === '1',
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
        });
        const to = process.env.CONTACT_TO || process.env.SMTP_FROM || process.env.SMTP_USER;
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to,
          replyTo: email,
          subject: `[FlixNova] ${subject}`,
          text: `From: ${name} <${email}>\n\n${message}`
        });
      } catch (mailErr) {
        console.error('Contact SMTP:', mailErr.message);
      }
    }
    res.json({ success: true, message: 'Message received. Thank you.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// User accounts, watchlist, history, comments, ratings
app.use('/api/auth', authRouter);

// Real-Debrid (Torrentio) — token sent per-request via x-rd-token
app.use('/api/debrid', debridRouter);

// Profiles, progress, requests, subtitles, analytics ingest
app.use('/api/features', featureRouter);

// £1 ad-free unlock (Stripe Checkout)
app.use('/api/pay', payRouter);

// SEO
app.get('/sitemap.xml', async (req, res) => {
  const urls = new Set([`${SITE}/`, `${SITE}/get-app.html`]);
  const add = (type, id) => { if (id && (type === 'movie' || type === 'tv')) urls.add(`${SITE}/watch/${type}/${id}`); };
  try {
    const packs = await Promise.all([
      tmdb('/trending/all/week', { page: 1 }),
      tmdb('/trending/all/week', { page: 2 }),
      tmdb('/trending/all/day', { page: 1 }),
      tmdb('/movie/now_playing', { page: 1 }),
      tmdb('/movie/popular', { page: 1 }),
      tmdb('/movie/top_rated', { page: 1 }),
      tmdb('/tv/popular', { page: 1 }),
      tmdb('/tv/top_rated', { page: 1 })
    ]);
    packs.forEach((d) => {
      (d?.results || []).forEach((r) => {
        const type = r.media_type || (r.first_air_date ? 'tv' : 'movie');
        if (!r.adult) add(type, r.id);
      });
    });
  } catch {}
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  [...urls].forEach((loc, i) => {
    const pri = loc === `${SITE}/` ? '1.0' : (loc.includes('/watch/') ? '0.7' : '0.5');
    xml += `<url><loc>${loc}</loc><changefreq>${i < 3 ? 'daily' : 'weekly'}</changefreq><priority>${pri}</priority></url>\n`;
  });
  xml += '</urlset>';
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`);
});

// ─── ADMIN ────────────────────────────────────────────────
const TF = process.env.ADMIN_SESSIONS_FILE || path.join(__dirname, '.admin-sessions');
const ENV_FILE = process.env.ENV_FILE || path.join(__dirname, '.env');
let sess = {};
try { sess = JSON.parse(fs.readFileSync(TF, 'utf8')); } catch {}
function saveS() { try { fs.writeFileSync(TF, JSON.stringify(sess)); } catch {} }

function adminAuth(req, res, next) {
  const t = req.headers['x-admin-token'];
  if (!t || !sess[t] || sess[t].exp < Date.now()) return res.status(401).json({ success: false, error: 'Unauthorized' });
  req.adminUser = sess[t].user; next();
}

app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  // Re-read .env so password changes apply without full code redeploy confusion
  try { dotenv.config({ path: path.join(__dirname, '.env'), override: true }); } catch {}
  const { username, password } = req.body || {};
  const adminUser = String(process.env.ADMIN_USER || 'admin').trim();
  const adminPass = String(process.env.ADMIN_PASS || '');
  console.log(`Admin login attempt: ${username}`);
  if (!adminPass) {
    return res.status(503).json({ success: false, error: 'Set ADMIN_PASS in backend/.env then restart' });
  }
  if (String(username || '').trim() === adminUser && String(password || '') === adminPass) {
    const t = crypto.randomBytes(32).toString('hex');
    sess[t] = { user: adminUser, exp: Date.now() + 7 * 86400000 };
    saveS();
    return res.json({ success: true, token: t, username: adminUser });
  }
  res.status(401).json({ success: false, error: 'Invalid credentials' });
});

app.get('/api/admin/contacts', adminAuth, async (req, res) => {
  try {
    if (require('mongoose').connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
    const rows = await ContactMessage.find({}).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.patch('/api/admin/contacts/:id', adminAuth, async (req, res) => {
  try {
    const status = (req.body || {}).status === 'done' ? 'done' : 'open';
    const row = await ContactMessage.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!row) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
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
      online: getOnlineStats()
    }});
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/admin/online', adminAuth, (req, res) => {
  const stats = getOnlineStats();
  const users = mergedOnlineUsers()
    .map(u => ({
      id: u.id,
      vid: u.vid,
      user: u.user || (u.role === 'admin' ? 'admin' : null),
      role: u.role || null,
      ip: String(u.ip || '').replace('::ffff:', ''),
      connectedAt: u.firstSeen || u.connectedAt,
      duration: Math.floor((Date.now() - (u.firstSeen || u.connectedAt || Date.now())) / 1000),
      page: u.watching ? 'watching' : (u.page || 'home'),
      watching: u.watching,
      tabs: u.tabs || 1,
      device: /Mobile|Android|iPhone/i.test(u.ua) ? 'Mobile' : 'Desktop'
    }))
    .sort((a, b) => (b.duration || 0) - (a.duration || 0));
  res.json({
    success: true,
    data: users,
    count: stats.count,
    connections: stats.connections,
    currentlyWatching: stats.currentlyWatching,
    totalViews: stats.totalViews,
    totalWatches: stats.totalWatches
  });
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

app.delete('/api/admin/cache/key', adminAuth, async (req, res) => {
  try {
    const key = String(req.body?.key || req.query?.key || '').trim();
    if (!key) return res.status(400).json({ success: false, error: 'key required' });
    if (rok && rc) await rc.del(key);
    mem.delete(key);
    res.json({ success: true, deleted: key });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
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

/** Secrets that admins may set from the Payments & Email / Settings UI */
const ADMIN_WRITABLE_SECRETS = new Set([
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'SMTP_SECURE',
  'SITE_URL',
  'ADFREE_PRICE_PENCE',
  'ADFREE_CURRENCY',
  'REALDEBRID_API_TOKEN',
  'RD_API_TOKEN'
]);

function upsertEnvKey(key, value) {
  let raw = '';
  try { raw = fs.readFileSync(ENV_FILE, 'utf8'); } catch { raw = ''; }
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value ?? ''}`;
  raw = re.test(raw) ? raw.replace(re, line) : (raw.replace(/\s*$/, '') + `\n${line}\n`);
  fs.writeFileSync(ENV_FILE, raw);
}

function readEnvMap() {
  const conf = {};
  try {
    const raw = fs.readFileSync(ENV_FILE, 'utf8');
    raw.split('\n').forEach(line => {
      const eq = line.indexOf('=');
      if (eq > 0 && !line.startsWith('#')) {
        conf[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    });
  } catch {}
  return conf;
}

app.get('/api/admin/config', adminAuth, (req, res) => {
  try {
    const rawMap = readEnvMap();
    const conf = {};
    Object.entries(rawMap).forEach(([k, v]) => {
      conf[k] = isSecretEnvKey(k) ? (v ? '***' : '') : v;
    });
    res.json({
      success: true,
      data: conf,
      payConfigured: !!(rawMap.STRIPE_SECRET_KEY && String(rawMap.STRIPE_SECRET_KEY).startsWith('sk_')),
      smtpConfigured: !!(rawMap.SMTP_HOST && rawMap.SMTP_USER),
      siteUrl: rawMap.SITE_URL || SITE
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/admin/config', adminAuth, (req, res) => {
  const { key, value } = req.body || {};
  if (!key || !/^[A-Z0-9_]+$/i.test(key)) {
    return res.status(400).json({ success: false, error: 'Valid key required' });
  }
  if (isSecretEnvKey(key) && !ADMIN_WRITABLE_SECRETS.has(key)) {
    return res.status(400).json({ success: false, error: 'This secret cannot be edited from the UI' });
  }
  // Don't overwrite secrets when UI sends the masked placeholder
  if (isSecretEnvKey(key) && (value === '***' || value === undefined)) {
    return res.status(400).json({ success: false, error: 'Enter a new secret value (not ***)' });
  }
  try {
    upsertEnvKey(key, String(value ?? '').trim());
    res.json({ success: true, message: 'Saved — restart app to apply', needsRestart: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/** Save several payments/email keys at once */
app.put('/api/admin/integrations', adminAuth, (req, res) => {
  try {
    const body = req.body || {};
    const allowed = [
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SITE_URL',
      'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_SECURE',
      'ADFREE_PRICE_PENCE', 'ADFREE_CURRENCY'
    ];
    let saved = 0;
    for (const key of allowed) {
      if (body[key] === undefined || body[key] === null) continue;
      let val = String(body[key]).trim();
      if (!val || val === '***') continue;
      if (key === 'STRIPE_SECRET_KEY' && !val.startsWith('sk_')) {
        return res.status(400).json({ success: false, error: 'STRIPE_SECRET_KEY must start with sk_test_ or sk_live_' });
      }
      if (key === 'STRIPE_WEBHOOK_SECRET') {
        // Common mistake: pasting the webhook endpoint URL instead of the signing secret
        if (/^https?:\/\//i.test(val) || !val.startsWith('whsec_')) {
          return res.status(400).json({
            success: false,
            error: 'Webhook secret must start with whsec_ (Signing secret from Stripe → Webhooks → endpoint). Do not paste the https:// URL.'
          });
        }
      }
      if (key === 'SMTP_HOST') val = val.replace(/^host\s+/i, '').trim();
      if (key === 'SMTP_PASS') val = val.replace(/\s+/g, '');
      upsertEnvKey(key, val);
      saved++;
    }
    if (!saved) return res.status(400).json({ success: false, error: 'No new values to save' });
    res.json({ success: true, message: `Saved ${saved} setting(s). Restart app to apply.`, needsRestart: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
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
    const { tmdbId = '27205', type = 'movie', season = 1, episode = 1, adult = false, title = '' } = req.body || {};
    const media = type === 'tv' ? 'tv' : 'movie';
    let imdb = '';
    let metaTitle = String(title || '');
    if (KEY) {
      try {
        const [ext, det] = await Promise.all([
          axios.get(`${TMDB}/${media}/${tmdbId}/external_ids`, { params: { api_key: KEY }, timeout: 8000 }),
          axios.get(`${TMDB}/${media}/${tmdbId}`, { params: { api_key: KEY }, timeout: 8000 })
        ]);
        imdb = ext.data?.imdb_id || '';
        if (!metaTitle) metaTitle = det.data?.title || det.data?.name || '';
      } catch {}
    }
    const pathStr = imdb
      ? (media === 'tv'
        ? `/stream/series/${imdb}:${parseInt(season, 10) || 1}:${parseInt(episode, 10) || 1}.json`
        : `/stream/movie/${imdb}.json`)
      : null;
    const t0 = Date.now();
    const TORRENTIO = 'https://torrentio.strem.fun';
    const COMET = 'https://comet.elfhosted.com';
    const cfg = `realdebrid=${encodeURIComponent(token)}|qualityfilter=scr,cam,unknown`;
    const cometB64 = Buffer.from(JSON.stringify({
      cachedOnly: false, removeTrash: true, resultFormat: ['all'],
      maxResultsPerResolution: 0, maxSize: 0,
      debridService: 'realdebrid', debridApiKey: token,
      debridServices: [], enableTorrent: false, debridStreamProxyPassword: '',
      languages: { exclude: [], priority: [] }, resolutions: {}, options: {}
    })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

    async function countAddon(url, label) {
      try {
        const r = await axios.get(url, {
          headers: { 'User-Agent': 'FlixNova-Admin', Accept: 'application/json' },
          timeout: 22000, validateStatus: s => s < 500
        });
        const streams = (r.data?.streams || []).filter(s => /^https?:\/\//i.test(s.url || s.externalUrl || ''));
        return { provider: label, ok: r.status < 400, streamCount: streams.length, sample: streams.slice(0, 3).map(s => (s.title || s.name || '').split('\n')[0]) };
      } catch (e) {
        return { provider: label, ok: false, streamCount: 0, error: e.message };
      }
    }

    const results = [];
    if (pathStr) {
      results.push(await countAddon(`${TORRENTIO}/${cfg}${pathStr}`, 'torrentio'));
      results.push(await countAddon(`${COMET}/${cometB64}${pathStr}`, 'comet'));
      const mfCfg = (process.env.MEDIAFUSION_CONFIG || '').trim().replace(/^\/+|\/+$/g, '');
      if (mfCfg) {
        results.push(await countAddon(`https://mediafusion.elfhosted.com/${mfCfg}${pathStr}`, 'mediafusion'));
      } else {
        results.push({ provider: 'mediafusion', ok: false, streamCount: 0, error: 'Set MEDIAFUSION_CONFIG env to enable' });
      }
    }

    // Adult / title ApiBay probe (count only — no RD magnet spam in admin test)
    let apibay = { provider: 'apibay', ok: false, streamCount: 0 };
    try {
      const q = imdb || metaTitle || 'test';
      const bayUrl = adult
        ? `https://apibay.org/q.php?q=${encodeURIComponent(q)}&cat=500`
        : `https://apibay.org/q.php?q=${encodeURIComponent(q)}`;
      const br = await axios.get(bayUrl, { timeout: 12000, validateStatus: s => s < 500 });
      const list = Array.isArray(br.data) ? br.data.filter(x => x && x.info_hash && x.id !== '0') : [];
      apibay = {
        provider: 'apibay',
        ok: true,
        streamCount: list.length,
        sample: list.slice(0, 3).map(x => x.name)
      };
    } catch (e) {
      apibay.error = e.message;
    }
    results.push(apibay);

    res.json({
      success: true,
      data: {
        imdbId: imdb || null,
        tmdbId,
        type: media,
        title: metaTitle,
        adult: !!adult,
        streamCount: results.reduce((n, r) => n + (r.streamCount || 0), 0),
        providers: results,
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

app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    if (require('mongoose').connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
    const q = String(req.query.q || '').trim().toLowerCase();
    const filter = q
      ? { $or: [{ username: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] }
      : {};
    const users = await User.find(filter)
      .select('username email adFree adFreeAt createdAt watchlist history')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({
      success: true,
      data: users.map(u => ({
        id: String(u._id),
        username: u.username,
        email: u.email || '',
        adFree: !!u.adFree,
        adFreeAt: u.adFreeAt || null,
        createdAt: u.createdAt,
        watchlistCount: (u.watchlist || []).length,
        historyCount: (u.history || []).length
      })),
      total: await User.countDocuments({})
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.patch('/api/admin/users/:id', adminAuth, async (req, res) => {
  try {
    if (require('mongoose').connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const { adFree, email, username, password } = req.body || {};
    if (typeof adFree === 'boolean') {
      user.adFree = adFree;
      user.adFreeAt = adFree ? (user.adFreeAt || new Date()) : null;
    }
    if (email !== undefined) user.email = String(email || '').trim().toLowerCase().slice(0, 120);
    if (username !== undefined) {
      const next = String(username || '').trim().toLowerCase().slice(0, 32);
      if (next.length < 3) return res.status(400).json({ success: false, error: 'Username too short' });
      const taken = await User.findOne({ username: next, _id: { $ne: user._id } });
      if (taken) return res.status(400).json({ success: false, error: 'Username already taken' });
      user.username = next;
    }
    if (password) {
      if (String(password).length < 6) return res.status(400).json({ success: false, error: 'Password min 6 chars' });
      const bcrypt = require('bcryptjs');
      user.passHash = await bcrypt.hash(String(password), 10);
    }
    await user.save();
    res.json({
      success: true,
      data: {
        id: String(user._id),
        username: user.username,
        email: user.email || '',
        adFree: !!user.adFree,
        adFreeAt: user.adFreeAt
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/admin/users/:id', adminAuth, async (req, res) => {
  try {
    if (require('mongoose').connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, message: 'User deleted' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Create a site user from admin (optional Ad-Free) */
app.post('/api/admin/users', adminAuth, async (req, res) => {
  try {
    if (require('mongoose').connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 120);
    const adFree = !!req.body?.adFree;
    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Username (3+) and password (6+) required' });
    }
    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ success: false, error: 'Username taken' });
    const bcrypt = require('bcryptjs');
    const passHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      email,
      passHash,
      adFree,
      adFreeAt: adFree ? new Date() : null
    });
    res.json({
      success: true,
      data: {
        id: String(user._id),
        username: user.username,
        email: user.email || '',
        adFree: !!user.adFree
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Title requests from users */
app.get('/api/admin/requests', adminAuth, async (req, res) => {
  try {
    if (require('mongoose').connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
    const status = String(req.query.status || '').trim();
    const filter = ['open', 'done', 'rejected'].includes(status) ? { status } : {};
    const list = await TitleRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const open = await TitleRequest.countDocuments({ status: 'open' });
    res.json({
      success: true,
      open,
      data: list.map(r => ({
        id: String(r._id),
        title: r.title,
        mediaType: r.mediaType,
        note: r.note || '',
        username: r.username || 'guest',
        tmdbId: r.tmdbId,
        status: r.status,
        adminNote: r.adminNote || '',
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      }))
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.patch('/api/admin/requests/:id', adminAuth, async (req, res) => {
  try {
    if (require('mongoose').connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
    const doc = await TitleRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: 'Not found' });
    const { status, adminNote } = req.body || {};
    if (['open', 'done', 'rejected'].includes(status)) doc.status = status;
    if (adminNote !== undefined) doc.adminNote = String(adminNote || '').slice(0, 500);
    doc.updatedAt = new Date();
    await doc.save();
    res.json({ success: true, data: { id: String(doc._id), status: doc.status, adminNote: doc.adminNote } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** First-10 free Ad-Free launch promo */
app.get('/api/admin/promo', adminAuth, async (req, res) => {
  try {
    if (require('mongoose').connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
    const FIRST10_KEY = 'first10';
    const envLimit = Math.max(1, parseInt(process.env.FIRST10_PROMO_LIMIT || '10', 10) || 10);
    await Promo.updateOne(
      { key: FIRST10_KEY },
      { $setOnInsert: { key: FIRST10_KEY, limit: envLimit, claimed: 0, claims: [], enabled: true } },
      { upsert: true }
    );
    const promo = await Promo.findOne({ key: FIRST10_KEY }).lean();
    const limit = Math.max(1, promo?.limit || envLimit);
    const claimed = Math.min(limit, Math.max(0, promo?.claimed || 0));
    res.json({
      success: true,
      data: {
        key: FIRST10_KEY,
        enabled: promo?.enabled !== false && String(process.env.FIRST10_PROMO_ENABLED || '1') !== '0',
        limit,
        claimed,
        remaining: Math.max(0, limit - claimed),
        claims: (promo?.claims || []).slice().reverse()
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.patch('/api/admin/promo', adminAuth, async (req, res) => {
  try {
    if (require('mongoose').connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
    const FIRST10_KEY = 'first10';
    const updates = { updatedAt: new Date() };
    if (typeof req.body?.enabled === 'boolean') updates.enabled = req.body.enabled;
    if (req.body?.limit !== undefined) {
      const lim = parseInt(req.body.limit, 10);
      if (!Number.isFinite(lim) || lim < 1 || lim > 1000) {
        return res.status(400).json({ success: false, error: 'limit must be 1–1000' });
      }
      updates.limit = lim;
    }
    const promo = await Promo.findOneAndUpdate(
      { key: FIRST10_KEY },
      { $set: updates, $setOnInsert: { key: FIRST10_KEY, claimed: 0, claims: [] } },
      { new: true, upsert: true }
    );
    res.json({
      success: true,
      data: {
        enabled: promo.enabled !== false,
        limit: promo.limit,
        claimed: promo.claimed,
        remaining: Math.max(0, promo.limit - promo.claimed)
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/promo/reset', adminAuth, async (req, res) => {
  try {
    if (require('mongoose').connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database unavailable' });
    }
    const FIRST10_KEY = 'first10';
    // Clear promoClaim flags on users who used this promo (does not revoke adFree by default)
    const revoke = !!req.body?.revokeAdFree;
    const claimedUsers = await Promo.findOne({ key: FIRST10_KEY }).lean();
    const ids = (claimedUsers?.claims || []).map(c => c.userId).filter(Boolean);
    if (revoke && ids.length) {
      await User.updateMany(
        { _id: { $in: ids }, promoClaim: FIRST10_KEY },
        { $set: { adFree: false, adFreeAt: null, promoClaim: '' } }
      );
    } else if (ids.length) {
      await User.updateMany({ _id: { $in: ids }, promoClaim: FIRST10_KEY }, { $set: { promoClaim: '' } });
    }
    const promo = await Promo.findOneAndUpdate(
      { key: FIRST10_KEY },
      { $set: { claimed: 0, claims: [], updatedAt: new Date() } },
      { new: true, upsert: true }
    );
    res.json({
      success: true,
      message: revoke
        ? 'Promo reset and Ad-Free revoked for prior claimants'
        : 'Promo counter reset (Ad-Free kept on prior claimants)',
      data: { claimed: 0, remaining: promo?.limit || 10, limit: promo?.limit || 10 }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/catalog/refresh', adminAuth, async (req, res) => {
  try {
    const keys = [
      'trending:week:v2', 'trending:day:v2', 'trending:browse:v2',
      'hero:trailers:v1', 'hero:trailers:v2'
    ];
    let cleared = 0;
    if (rok && rc) {
      for (const k of keys) {
        try { await rc.del(k); cleared++; } catch {}
      }
      // Also wipe discover/browse caches commonly used on home
      try {
        const all = await rc.keys('browse:*');
        if (all?.length) { await rc.del(all); cleared += all.length; }
      } catch {}
      try {
        const disc = await rc.keys('discover:*');
        if (disc?.length) { await rc.del(disc); cleared += disc.length; }
      } catch {}
    }
    for (const k of keys) mem.delete(k);
    res.json({
      success: true,
      message: 'Homepage / trending / hero caches cleared. Next visit fetches fresh TMDB data.',
      cleared
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/analytics', adminAuth, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const since = new Date(Date.now() - days * 86400000);
    const match = { at: { $gte: since } };
    const [total, bySource, topTitles, recent] = await Promise.all([
      PlayEvent.countDocuments(match),
      PlayEvent.aggregate([
        { $match: match },
        { $group: { _id: '$source', count: { $sum: 1 }, ok: { $sum: { $cond: ['$success', 1, 0] } } } }
      ]),
      PlayEvent.aggregate([
        { $match: match },
        { $group: { _id: { tmdbId: '$tmdbId', mediaType: '$mediaType', title: '$title' }, plays: { $sum: 1 }, rd: { $sum: { $cond: [{ $eq: ['$source', 'rd'] }, 1, 0] } } } },
        { $sort: { plays: -1 } },
        { $limit: 25 }
      ]),
      PlayEvent.find(match).sort({ at: -1 }).limit(30).lean()
    ]);
    const rd = bySource.find(x => x._id === 'rd') || { count: 0, ok: 0 };
    const embed = bySource.find(x => x._id === 'embed') || { count: 0, ok: 0 };
    const rdHitRate = total ? Math.round((rd.count / total) * 1000) / 10 : 0;
    res.json({
      success: true,
      data: {
        days, totalPlays: total, rdHitRate,
        bySource: { rd: rd.count, embed: embed.count, other: Math.max(0, total - rd.count - embed.count) },
        topTitles: topTitles.map(t => ({
          tmdbId: t._id.tmdbId, type: t._id.mediaType, title: t._id.title || ('#' + t._id.tmdbId),
          plays: t.plays, rd: t.rd
        })),
        recent
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── 404 for API ─────────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// ─── Static site + SPA watch routes ──────────────────────
const WEB = path.join(__dirname, '..', 'website');
const ADMIN_DIR = path.join(__dirname, '..', 'admin');
app.use('/admin', express.static(ADMIN_DIR, {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (/\.(html|js|css|json|webmanifest)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
app.use(express.static(WEB, {
  index: 'index.html',
  setHeaders(res, filePath) {
    // HTML/JS must update immediately after deploy (was maxAge 1h — looked “stuck”)
    if (/\.(html|js|css|json|webmanifest)$/i.test(filePath) || /sw\.js$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (/\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Shareable watch URLs → SPA (nginx should also try_files to index.html)
app.get('/watch/:type/:id/:season?/:episode?', (req, res) => {
  res.sendFile(path.join(WEB, 'index.html'));
});
app.get('/reset', (req, res) => {
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
