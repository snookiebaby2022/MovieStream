/**
 * Real-Debrid streams via multiple Stremio providers + adult/title torrent search.
 * Providers: Torrentio, Comet, optional MediaFusion (MEDIAFUSION_CONFIG env).
 * XXX / sparse titles: ApiBay (TPB) search → RD magnet resolve (cached preferred).
 */
const express = require('express');
const axios = require('axios');
const { verifyToken } = require('./authRoutes');
const { User } = require('./models');

const router = express.Router();
const TORRENTIO = (process.env.TORRENTIO_URL || 'https://torrentio.strem.fun').replace(/\/$/, '');
const COMET = (process.env.COMET_URL || 'https://comet.elfhosted.com').replace(/\/$/, '');
const MEDIAFUSION = (process.env.MEDIAFUSION_URL || 'https://mediafusion.elfhosted.com').replace(/\/$/, '');
/** Optional path segment from MediaFusion “Share Manifest URL” (encrypted user data) */
const MEDIAFUSION_CONFIG = (process.env.MEDIAFUSION_CONFIG || '').toString().trim().replace(/^\/+|\/+$/g, '');
const RD_API = 'https://api.real-debrid.com/rest/1.0';
const APIBAY = 'https://apibay.org';

function ua() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

function siteToken() {
  return (process.env.REALDEBRID_API_TOKEN || process.env.RD_API_TOKEN || '').toString().trim();
}

function tokenFrom(req) {
  const client = (
    req.headers['x-rd-token'] ||
    req.body?.token ||
    req.query?.token ||
    ''
  ).toString().trim();
  return client || siteToken();
}

function parseQuality(title) {
  const t = String(title || '');
  if (/2160p|4k|uhd/i.test(t)) return '4K';
  if (/1080p/i.test(t)) return '1080p';
  if (/720p/i.test(t)) return '720p';
  if (/480p/i.test(t)) return '480p';
  if (/\b(cam|hdcam|ts|telesync|scr|dvdscr)\b/i.test(t)) return 'CAM';
  return 'HD';
}

function parseSize(title) {
  const m = String(title || '').match(/💾\s*([\d.]+\s*[GMK]B)/i);
  return m ? m[1] : '';
}

function formatBytes(n) {
  const b = Number(n) || 0;
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  if (b > 0) return `${(b / 1e3).toFixed(0)} KB`;
  return '';
}

function parseSeeders(title) {
  const m = String(title || '').match(/👤\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Higher = more likely to play in Chrome/Safari/Fire Stick WebView <video> */
function browserScore(title, url, name) {
  const t = `${name || ''} ${title || ''} ${url || ''}`.toLowerCase();
  let score = 40;
  if (/\[rd\+\]/.test(t)) score += 90;
  if (/⚡/.test(t) && !/\[rd\+\]/.test(t)) score += 70; // Comet cached
  if (/\[rd download\]/.test(t)) score -= 80; // uncached — often useless for instant play
  if (/\.mp4(\?|$)|[\s.\-_]mp4[\s.\-_]/i.test(t)) score += 55;
  if (/x264|h\.?264|avc/.test(t)) score += 45;
  if (/blu-?ray|bluray|bdrip|brrip|remux/.test(t)) score += 12;
  if (/web-?dl|webrip|hdtv/.test(t)) score -= 15; // RD May-2026 keyword filter often hits these
  if (/amzn|netflix|\bnf\b|\bhulu\b|\bd\+|\batvp\b|disney|\bhbo\b|\bcr\b/.test(t)) score -= 25;
  if (/\byts\b|rarbg|sparkles|ion10/.test(t)) score -= 20;
  if (/1080p/.test(t)) score += 18;
  if (/720p/.test(t)) score += 28;
  if (/480p|dvdrip|hdrip/.test(t)) score += 10;
  if (/2160p|4k|uhd/.test(t)) score -= 70;
  // Hard codecs: browsers / Fire Stick WebView usually cannot decode
  if (/x265|h\.?265|hevc|10-?bit|hdr10|\bhdr\b|dolby\s*vision|\bdv\b/.test(t)) score -= 120;
  if (/\bav1\b/.test(t)) score -= 120;
  if (/\.mkv(\?|$)|[\s.\-_]mkv[\s.\-_]/i.test(t)) score -= 30;
  if (/\.m3u8(\?|$)|hls/.test(t)) score += 40;
  return score;
}

function isHardCodec(title, url, name) {
  const t = `${name || ''} ${title || ''} ${url || ''}`.toLowerCase();
  return /x265|h\.?265|hevc|10-?bit|hdr10|\bhdr\b|dolby\s*vision|\bdv\b|\bav1\b/.test(t);
}

function isLikelyBrowserPlayable(title, url, name) {
  if (isHardCodec(title, url, name)) return false;
  return browserScore(title, url, name) >= 55;
}

/** RD May 2026+ heuristic blocks — demote / skip these release tags when alternatives exist */
function isRdKeywordRisky(title, name) {
  const t = `${name || ''} ${title || ''}`.toLowerCase();
  return /web-?dl|webrip|\bamzn\b|\bnf\b|netflix|\bhulu\b|\bd\+\b|\batvp\b|\bcr\b|\byts\b|rarbg/.test(t);
}

const INFRINGE_RE = /copyright infringement|infringing[_\s-]?file|error[_\s-]?code[_\s-]?35|"error_code"\s*:\s*35|unavailable for legal reasons|file was removed from debrid/i;

async function requireAdFree(req, res) {
  const userTok = verifyToken(
    req.headers['x-user-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  );
  if (!userTok) {
    res.status(401).json({ success: false, error: 'Login required', code: 'LOGIN_REQUIRED' });
    return null;
  }
  if (require('mongoose').connection.readyState !== 1) {
    res.status(503).json({ success: false, error: 'Database unavailable' });
    return null;
  }
  const user = await User.findById(userTok.id).select('adFree');
  if (!user?.adFree) {
    res.status(403).json({
      success: false,
      error: 'Ad-Free (£1) required for Real-Debrid streams. Free accounts use embed servers.',
      code: 'ADFREE_REQUIRED'
    });
    return null;
  }
  return userTok;
}

/** Probe an RD / resolved stream URL for copyright / infringing blocks */
async function probeStreamUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { url, ok: false, reason: 'invalid' };
  }
  try {
    const r = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      responseType: 'arraybuffer',
      maxContentLength: 8192,
      maxBodyLength: 8192,
      headers: {
        'User-Agent': ua(),
        Range: 'bytes=0-4095',
        Accept: '*/*'
      },
      validateStatus: () => true
    });
    const ct = String(r.headers['content-type'] || '');
    const status = r.status;
    const buf = Buffer.from(r.data || []);
    const text = buf.toString('utf8', 0, Math.min(buf.length, 4000));

    const cr = String(r.headers['content-range'] || '');
    const crm = cr.match(/\/(\d+)\s*$/);
    const totalBytes = crm ? (parseInt(crm[1], 10) || 0) : 0;

    if (status === 451 || INFRINGE_RE.test(text)) {
      return { url, ok: false, reason: 'copyright' };
    }
    if (/application\/json|text\/html|text\/plain/i.test(ct) && INFRINGE_RE.test(text)) {
      return { url, ok: false, reason: 'copyright' };
    }
    try {
      if (/json/i.test(ct) || text.trim().startsWith('{')) {
        const j = JSON.parse(text);
        if (j && (j.error_code === 35 || j.error === 'infringing_file' || INFRINGE_RE.test(JSON.stringify(j)))) {
          return { url, ok: false, reason: 'copyright' };
        }
      }
    } catch {}

    if (totalBytes > 0 && totalBytes < 8 * 1024 * 1024 && /video|octet-stream|mp4/i.test(ct)) {
      return { url, ok: false, reason: 'copyright_stub' };
    }

    if (status >= 200 && status < 400 && /video|audio|mpegurl|octet-stream|mp2t|mp4/i.test(ct)) {
      return { url, ok: true, reason: 'media', bytes: totalBytes || undefined };
    }
    if (status >= 200 && status < 400 && !/text\/html/i.test(ct) && buf.length > 0) {
      return { url, ok: true, reason: 'ok', bytes: totalBytes || undefined };
    }
    if (/text\/html/i.test(ct) && INFRINGE_RE.test(text)) {
      return { url, ok: false, reason: 'copyright' };
    }
    return { url, ok: true, reason: 'unknown' };
  } catch (e) {
    return { url, ok: true, reason: 'probe_error' };
  }
}

function mapAddonStreams(raw, provider) {
  return (raw || [])
    .map((s, i) => {
      const playUrl = s.url || s.externalUrl || '';
      if (!/^https?:\/\//i.test(playUrl)) return null;
      if (/magnet:/i.test(playUrl)) return null;
      const title = s.title || s.description || s.name || `Stream ${i + 1}`;
      const name = s.name || provider;
      if (INFRINGE_RE.test(title) || INFRINGE_RE.test(name)) return null;
      // Skip Comet/MediaFusion config error notices
      if (/invalid api key|obsolete configuration|please (re-)?configure|check your configuration/i.test(title + ' ' + name)) {
        return null;
      }
      const quality = parseQuality(title + ' ' + name);
      const isHls = /\.m3u8(\?|$)/i.test(playUrl) || /hls/i.test(playUrl);
      const bScore = browserScore(title, playUrl, name);
      const cached = /\[rd\+\]|⚡|cached/i.test(name + ' ' + title);
      return {
        source: String(name).replace(/\n/g, ' ').slice(0, 40) || provider,
        title: String(title).split('\n')[0].slice(0, 80),
        quality,
        size: parseSize(title) || formatBytes(s.behaviorHints?.videoSize),
        seeders: parseSeeders(title),
        type: isHls ? 'hls' : 'direct',
        url: playUrl,
        embedUrl: playUrl,
        debrid: true,
        cached,
        browserOk: isLikelyBrowserPlayable(title, playUrl, name),
        browserScore: bScore,
        hardCodec: isHardCodec(title, playUrl, name),
        rdRisky: isRdKeywordRisky(title, name),
        provider,
        priority: i + 1
      };
    })
    .filter(Boolean);
}

function cometConfigB64(token) {
  const cfg = {
    cachedOnly: false,
    sortCachedUncachedTogether: false,
    removeTrash: true,
    resultFormat: ['all'],
    maxResultsPerResolution: 0,
    maxSize: 0,
    debridService: 'realdebrid',
    debridApiKey: token,
    debridServices: [],
    enableTorrent: false,
    debridStreamProxyPassword: '',
    languages: { exclude: [], priority: [] },
    resolutions: {},
    options: {
      remove_ranks_under: -10000000000,
      allow_english_in_languages: false,
      remove_unknown_languages: false
    }
  };
  return Buffer.from(JSON.stringify(cfg), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function fetchJsonStreams(url, label) {
  try {
    const r = await axios.get(url, {
      headers: { 'User-Agent': ua(), Accept: 'application/json' },
      timeout: 22000,
      validateStatus: s => s < 500
    });
    if (r.status >= 400) {
      console.warn(`Debrid/${label}: HTTP ${r.status}`);
      return [];
    }
    return mapAddonStreams(r.data?.streams || [], label);
  } catch (e) {
    console.warn(`Debrid/${label}:`, e.message);
    return [];
  }
}

async function fetchTorrentio(token, path) {
  // Prefer SDR / non-4K / non-cam. HDR+DV+HEVC rarely plays in browser WebViews.
  const cfgClean = `realdebrid=${encodeURIComponent(token)}|qualityfilter=4k,hdr,dolbyvision,threed,scr,cam,unknown`;
  const cfgSoft = `realdebrid=${encodeURIComponent(token)}|qualityfilter=4k,scr,cam,unknown`;
  const cfgAll = `realdebrid=${encodeURIComponent(token)}`;
  let streams = await fetchJsonStreams(`${TORRENTIO}/${cfgClean}${path}`, 'torrentio');
  if (streams.filter(s => s.browserOk).length < 3) {
    const more = await fetchJsonStreams(`${TORRENTIO}/${cfgSoft}${path}`, 'torrentio');
    streams = dedupeStreams(streams.concat(more));
  }
  if (!streams.length) {
    streams = await fetchJsonStreams(`${TORRENTIO}/${cfgAll}${path}`, 'torrentio');
  }
  return streams;
}

async function fetchComet(token, path) {
  const b64 = cometConfigB64(token);
  return fetchJsonStreams(`${COMET}/${b64}${path}`, 'comet');
}

async function fetchMediaFusion(path) {
  if (!MEDIAFUSION_CONFIG) return [];
  return fetchJsonStreams(`${MEDIAFUSION}/${MEDIAFUSION_CONFIG}${path}`, 'mediafusion');
}

/** Prefer fast Torrentio; always merge Comet (Elfhosted patches RD infringing filters). */
async function fetchAddonStreams(token, path) {
  const tioP = fetchTorrentio(token, path);
  const cometP = fetchComet(token, path);
  const mfP = fetchMediaFusion(path);

  const tio = await tioP.catch(() => []);
  const waitMs = (tio || []).filter(s => s.browserOk).length >= 5 ? 1800 : 8000;
  const timed = await Promise.race([
    Promise.all([cometP.catch(() => []), mfP.catch(() => [])]),
    new Promise(resolve => setTimeout(() => resolve([[], []]), waitMs))
  ]);
  const [comet, mf] = timed;
  return dedupeStreams([...(tio || []), ...(comet || []), ...(mf || [])]);
}

function titleMatchScore(torrentName, title) {
  const words = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !/^(the|and|for|xxx|adult)$/.test(w));
  if (!words.length) return 0;
  const n = String(torrentName || '').toLowerCase();
  let hits = 0;
  for (const w of words) if (n.includes(w)) hits++;
  return hits / words.length;
}

async function searchApibay(query, { adult = false } = {}) {
  const q = String(query || '').trim();
  if (!q || q === '0') return [];
  const urls = [];
  if (adult) urls.push(`${APIBAY}/q.php?q=${encodeURIComponent(q)}&cat=500`);
  urls.push(`${APIBAY}/q.php?q=${encodeURIComponent(q)}`);

  const rows = [];
  await Promise.all(urls.map(async (url) => {
    try {
      const r = await axios.get(url, {
        headers: { 'User-Agent': ua(), Accept: 'application/json' },
        timeout: 12000,
        validateStatus: s => s < 500
      });
      const list = Array.isArray(r.data) ? r.data : [];
      for (const row of list) {
        if (!row || row.id === '0' || !row.info_hash) continue;
        rows.push(row);
      }
    } catch (e) {
      console.warn('ApiBay:', e.message);
    }
  }));

  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const hash = String(row.info_hash || '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(hash) || seen.has(hash)) continue;
    seen.add(hash);
    out.push({
      hash,
      name: row.name || hash,
      seeders: parseInt(row.seeders, 10) || 0,
      size: parseInt(row.size, 10) || 0,
      imdb: row.imdb || '',
      category: String(row.category || '')
    });
  }
  out.sort((a, b) => (b.seeders - a.seeders) || (b.size - a.size));
  return out;
}

async function rdInstantCached(token, hashes) {
  const cached = new Set();
  if (!hashes.length) return cached;
  // RD accepts up to ~100 hashes; chunk to be safe
  for (let i = 0; i < hashes.length; i += 40) {
    const chunk = hashes.slice(i, i + 40);
    try {
      const r = await axios.get(`${RD_API}/torrents/instantAvailability/${chunk.join('/')}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua() },
        timeout: 15000,
        validateStatus: () => true
      });
      if (r.status === 200 && r.data && typeof r.data === 'object') {
        for (const [h, info] of Object.entries(r.data)) {
          const rd = info?.rd;
          if (Array.isArray(rd) && rd.length) cached.add(String(h).toLowerCase());
        }
      }
    } catch {}
  }
  return cached;
}

async function rdDeleteTorrent(token, id) {
  if (!id) return;
  try {
    await axios.delete(`${RD_API}/torrents/delete/${id}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua() },
      timeout: 8000,
      validateStatus: () => true
    });
  } catch {}
}

async function resolveHashViaRd(token, torrent) {
  const magnet = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(torrent.name || torrent.hash)}`;
  let id = null;
  try {
    const added = await axios.post(
      `${RD_API}/torrents/addMagnet`,
      new URLSearchParams({ magnet }).toString(),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': ua(),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000
      }
    );
    id = added.data?.id;
    if (!id) return null;

    let info = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const ir = await axios.get(`${RD_API}/torrents/info/${id}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua() },
        timeout: 12000
      });
      info = ir.data;
      if (info?.status === 'waiting_files_selection') {
        const files = Array.isArray(info.files) ? info.files : [];
        const videoIds = files
          .filter(f => /\.(mp4|mkv|avi|m4v|mov|wmv|webm)$/i.test(f.path || ''))
          .map(f => f.id);
        const pick = videoIds.length ? videoIds : files.map(f => f.id).filter(Boolean);
        if (pick.length) {
          await axios.post(
            `${RD_API}/torrents/selectFiles/${id}`,
            new URLSearchParams({ files: pick.join(',') }).toString(),
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': ua(),
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              timeout: 12000
            }
          );
        }
      }
      if (info?.status === 'downloaded' && Array.isArray(info.links) && info.links.length) break;
      if (['error', 'magnet_error', 'virus', 'dead'].includes(info?.status)) {
        await rdDeleteTorrent(token, id);
        return null;
      }
      // Cached torrents usually finish in 1–2 polls; don't wait long for downloads
      if (attempt < 5 && info?.status !== 'downloaded') {
        await new Promise(r => setTimeout(r, 700));
      }
    }

    if (!info || info.status !== 'downloaded' || !info.links?.length) {
      await rdDeleteTorrent(token, id);
      return null;
    }

    // Prefer largest video-like hoster link
    const links = info.links.slice().sort((a, b) => String(b).length - String(a).length);
    let playUrl = '';
    let filename = torrent.name || 'RD';
    for (const link of links.slice(0, 3)) {
      try {
        const ur = await axios.post(
          `${RD_API}/unrestrict/link`,
          new URLSearchParams({ link }).toString(),
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'User-Agent': ua(),
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 15000
          }
        );
        if (ur.data?.download) {
          playUrl = ur.data.download;
          filename = ur.data.filename || filename;
          break;
        }
      } catch {}
    }

    await rdDeleteTorrent(token, id);
    if (!playUrl) return null;

    const title = filename;
    const name = `[RD+] ApiBay`;
    const bScore = browserScore(title, playUrl, name);
    return {
      source: name,
      title: String(title).slice(0, 80),
      quality: parseQuality(title),
      size: formatBytes(torrent.size),
      seeders: torrent.seeders || 0,
      type: /\.m3u8(\?|$)/i.test(playUrl) ? 'hls' : 'direct',
      url: playUrl,
      embedUrl: playUrl,
      debrid: true,
      cached: true,
      browserOk: isLikelyBrowserPlayable(title, playUrl, name),
      browserScore: bScore,
      hardCodec: isHardCodec(title, playUrl, name),
      rdRisky: isRdKeywordRisky(title, name),
      provider: 'apibay',
      priority: 1
    };
  } catch (e) {
    if (id) await rdDeleteTorrent(token, id);
    console.warn('RD resolve:', e.response?.data?.error || e.message);
    return null;
  }
}

async function fetchApibayRdStreams(token, { imdb, title, year, adult }) {
  const queries = [];
  if (imdb) queries.push({ q: imdb, byImdb: true });
  if (title) {
    const y = year ? ` ${year}` : '';
    queries.push({ q: `${title}${y}`.trim(), byImdb: false });
    if (adult) queries.push({ q: title, byImdb: false });
  }
  if (!queries.length) return [];

  const found = [];
  const seen = new Set();
  for (const { q, byImdb } of queries) {
    const rows = await searchApibay(q, { adult: !!adult });
    for (const row of rows) {
      if (seen.has(row.hash)) continue;
      if (byImdb && imdb) {
        if (row.imdb && row.imdb !== imdb && !String(row.name).includes(imdb)) {
          // keep if seeders high and title-ish — still prefer imdb match
          if (row.imdb && row.imdb !== imdb) continue;
        }
      } else if (title) {
        const score = titleMatchScore(row.name, title);
        if (score < 0.45) continue;
        if (year && !String(row.name).includes(String(year)) && score < 0.7) continue;
      }
      // Adult: prefer porn categories (5xx) when searching titles
      if (adult && !byImdb && row.category && !/^5/.test(row.category) && titleMatchScore(row.name, title) < 0.75) {
        continue;
      }
      seen.add(row.hash);
      found.push(row);
    }
  }

  found.sort((a, b) => (b.seeders - a.seeders) || (b.size - a.size));
  const candidates = found.slice(0, adult ? 20 : 12);
  if (!candidates.length) return [];

  const cached = await rdInstantCached(token, candidates.map(c => c.hash));
  // Prefer known-cached; if API gone/empty, still try top seeded (limit stricter)
  let toResolve = candidates.filter(c => cached.has(c.hash));
  if (!toResolve.length) {
    toResolve = candidates.filter(c => c.seeders >= (adult ? 2 : 5)).slice(0, 5);
  } else {
    toResolve = toResolve.slice(0, 8);
  }

  const streams = [];
  // Resolve sequentially to avoid RD rate limits
  for (const t of toResolve) {
    if (streams.length >= 8) break;
    const s = await resolveHashViaRd(token, t);
    if (s) streams.push(s);
  }
  return streams;
}

function dedupeStreams(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const key = String(s.url || '').split('?')[0].toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Probe top candidates and drop copyright stubs / dead links before the client sees them.
 * This is the durable fix for RD returning unplayable "premium" chips.
 */
async function validateTopStreams(streams, { want = 8, probeLimit = 14 } = {}) {
  if (!streams.length) return [];
  const ranked = streams.slice().sort((a, b) =>
    ((b.browserOk ? 1 : 0) - (a.browserOk ? 1 : 0)) ||
    ((b.cached ? 1 : 0) - (a.cached ? 1 : 0)) ||
    ((a.rdRisky ? 1 : 0) - (b.rdRisky ? 1 : 0)) ||
    ((a.hardCodec ? 1 : 0) - (b.hardCodec ? 1 : 0)) ||
    (b.browserScore - a.browserScore) ||
    ((b.seeders || 0) - (a.seeders || 0))
  );

  const candidates = ranked.slice(0, Math.min(probeLimit, ranked.length));
  const validated = [];
  const backlog = [];
  const rejected = new Set();

  const queue = candidates.slice();
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (queue.length && validated.length < want) {
      const s = queue.shift();
      if (!s) break;
      const result = await probeStreamUrl(s.url);
      if (!result.ok && (result.reason === 'copyright' || result.reason === 'copyright_stub')) {
        rejected.add(String(s.url || '').split('?')[0].toLowerCase());
        continue;
      }
      if (result.ok || result.reason === 'unknown' || result.reason === 'probe_error') {
        const row = { ...s, validated: true, probeReason: result.reason };
        if (s.browserOk && !s.hardCodec) validated.push(row);
        else backlog.push(row);
      }
    }
  });
  await Promise.all(workers);

  const notRejected = (s) => !rejected.has(String(s.url || '').split('?')[0].toLowerCase());
  const picked = dedupeStreams(validated.concat(backlog.filter(s => s.browserOk && notRejected(s))));
  if (picked.length >= 2) return picked.slice(0, Math.max(want, 12));
  return dedupeStreams(picked.concat(ranked.filter(notRejected))).slice(0, 40);
}

router.get('/status', async (req, res) => {
  const siteConfigured = !!siteToken();
  const userTok = (
    req.headers['x-rd-token'] ||
    req.body?.token ||
    req.query?.token ||
    ''
  ).toString().trim();
  if (!userTok) {
    return res.json({ success: true, configured: false, siteConfigured });
  }
  try {
    const r = await axios.get(`${RD_API}/user`, {
      headers: { Authorization: `Bearer ${userTok}`, 'User-Agent': ua() },
      timeout: 10000
    });
    res.json({
      success: true,
      configured: true,
      siteConfigured,
      data: {
        username: r.data.username,
        premium: r.data.type === 'premium',
        expiration: r.data.expiration,
        points: r.data.points,
        source: 'user'
      }
    });
  } catch (e) {
    const status = e.response?.status;
    res.status(status === 401 ? 401 : 502).json({
      success: false,
      configured: false,
      siteConfigured,
      error: status === 401 ? 'Invalid Real-Debrid token' : (e.message || 'RD check failed')
    });
  }
});

/** Validate RD stream URLs — drops copyright / infringing_file links */
router.post('/validate', async (req, res) => {
  try {
    if (!(await requireAdFree(req, res))) return;
    const list = Array.isArray(req.body?.urls) ? req.body.urls : (req.body?.url ? [req.body.url] : []);
    const urls = [...new Set(list.map(u => String(u || '').trim()).filter(Boolean))].slice(0, 20);
    if (!urls.length) return res.status(400).json({ success: false, error: 'urls required' });

    const results = [];
    const queue = urls.slice();
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const u = queue.shift();
        results.push(await probeStreamUrl(u));
      }
    });
    await Promise.all(workers);

    const bad = results
      .filter(r => !r.ok && (r.reason === 'copyright' || r.reason === 'copyright_stub'))
      .map(r => r.url);
    res.json({
      success: true,
      data: {
        results,
        bad,
        removed: bad.length
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'Validate failed' });
  }
});

router.post('/streams', async (req, res) => {
  try {
    if (!(await requireAdFree(req, res))) return;

    const token = siteToken() || tokenFrom(req);
    const {
      imdbId, type, season, episode, tmdbId,
      title, year, adult
    } = req.body || {};
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Real-Debrid not configured on server (set REALDEBRID_API_TOKEN)'
      });
    }

    let imdb = (imdbId || '').toString().trim();
    if (imdb && !imdb.startsWith('tt')) imdb = 'tt' + imdb.replace(/\D/g, '');

    let metaTitle = (title || '').toString().trim();
    let metaYear = year ? String(year).replace(/\D/g, '').slice(0, 4) : '';
    let isAdult = adult === true || adult === 1 || adult === '1' || adult === 'true';

    if (tmdbId) {
      const KEY = process.env.TMDB_API_KEY || '';
      const media = type === 'tv' ? 'tv' : 'movie';
      if (KEY) {
        try {
          const tasks = [];
          if (!imdb) {
            tasks.push(
              axios.get(`https://api.themoviedb.org/3/${media}/${tmdbId}/external_ids`, {
                params: { api_key: KEY },
                timeout: 8000
              }).then(r => { imdb = r.data?.imdb_id || imdb; }).catch(() => {})
            );
          }
          tasks.push(
            axios.get(`https://api.themoviedb.org/3/${media}/${tmdbId}`, {
              params: { api_key: KEY },
              timeout: 8000
            }).then(r => {
              const d = r.data || {};
              if (!metaTitle) metaTitle = d.title || d.name || '';
              if (!metaYear) {
                const date = d.release_date || d.first_air_date || '';
                metaYear = date.slice(0, 4);
              }
              if (d.adult) isAdult = true;
            }).catch(() => {})
          );
          await Promise.all(tasks);
        } catch {}
      }
    }

    let path = null;
    if (imdb && imdb.startsWith('tt')) {
      if (type === 'tv' || type === 'series') {
        const s = parseInt(season, 10) || 1;
        const e = parseInt(episode, 10) || 1;
        path = `/stream/series/${imdb}:${s}:${e}.json`;
      } else {
        path = `/stream/movie/${imdb}.json`;
      }
    }

    console.log('Debrid multi:', { path, imdb, adult: isAdult, title: metaTitle?.slice(0, 40), mediafusion: !!MEDIAFUSION_CONFIG });

    let streams = [];
    if (path) {
      streams = await fetchAddonStreams(token, path);
    }

    // ApiBay magnet resolve is slow — only for adult titles or when addons found nothing playable
    const playableSoFar = streams.filter(s => s.browserOk && s.cached).length;
    const needApibay = isAdult || !streams.length || playableSoFar < 2;
    if (needApibay) {
      try {
        const extra = await fetchApibayRdStreams(token, {
          imdb: imdb && imdb.startsWith('tt') ? imdb : '',
          title: metaTitle,
          year: metaYear,
          adult: isAdult
        });
        streams = dedupeStreams(streams.concat(extra));
      } catch (e) {
        console.warn('ApiBay RD:', e.message);
      }
    }

    if (!streams.length && !imdb && !metaTitle) {
      return res.status(400).json({ success: false, error: 'IMDB id or title required for debrid streams' });
    }

    // Progressive narrowing: only keep links that can actually play in-browser.
    // Order matters — each step keeps a fallback if it would empty the list.
    const narrow = (pred, min = 2) => {
      const next = streams.filter(pred);
      if (next.length >= min) streams = next;
    };
    narrow(s => s.browserOk && !s.hardCodec, 2);
    narrow(s => s.cached, 2);
    narrow(s => !s.rdRisky, 2);
    narrow(s => s.quality !== '4K', 2);
    // Drop uncached "[RD download]" leftovers when any cached remain
    narrow(s => s.cached || !/\[rd download\]/i.test(`${s.source || ''} ${s.title || ''}`), 1);

    // Sort before probe so we validate the best candidates first
    streams = streams.slice().sort((a, b) =>
      ((b.browserOk ? 1 : 0) - (a.browserOk ? 1 : 0)) ||
      ((b.cached ? 1 : 0) - (a.cached ? 1 : 0)) ||
      ((a.rdRisky ? 1 : 0) - (b.rdRisky ? 1 : 0)) ||
      ((a.hardCodec ? 1 : 0) - (b.hardCodec ? 1 : 0)) ||
      ((b.browserScore || 0) - (a.browserScore || 0)) ||
      ((b.seeders || 0) - (a.seeders || 0))
    );

    // Pre-validate so the UI does not show dead/copyright chips first
    streams = await validateTopStreams(streams, { want: 10, probeLimit: 18 });

    // Final: if probes found playable browser links, hide the rest from Auto
    const playable = streams.filter(s => s.validated && s.browserOk && !s.hardCodec);
    if (playable.length >= 1) streams = playable;
    else {
      const soft = streams.filter(s => s.browserOk && !s.hardCodec);
      if (soft.length) streams = soft;
    }

    streams = streams.slice(0, 24);
    const providers = [...new Set(streams.map(s => s.provider).filter(Boolean))];
    console.log('Debrid result:', {
      imdb,
      total: streams.length,
      browserFriendly: streams.filter(s => s.browserOk).length,
      cached: streams.filter(s => s.cached).length,
      providers
    });

    res.json({
      success: true,
      data: {
        imdbId: imdb || null,
        streams,
        totalSources: streams.length,
        browserFriendly: streams.filter(s => s.browserOk).length,
        cached: streams.filter(s => s.cached).length,
        providers,
        provider: providers.join('+') || 'none',
        adult: isAdult
      }
    });
  } catch (e) {
    console.error('Debrid streams error:', e.message);
    res.status(500).json({ success: false, error: e.message || 'Debrid lookup failed' });
  }
});

module.exports = router;
