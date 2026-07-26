/**
 * Real-Debrid via Torrentio (Stremio addon).
 * Token resolution order:
 *  1) Client header/body (per-user key)
 *  2) REALDEBRID_API_TOKEN in server .env (site-wide)
 */
const express = require('express');
const axios = require('axios');
const { verifyToken } = require('./authRoutes');
const { User } = require('./models');

const router = express.Router();
const TORRENTIO = 'https://torrentio.strem.fun';
const RD_API = 'https://api.real-debrid.com/rest/1.0';

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

function parseSeeders(title) {
  const m = String(title || '').match(/👤\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Higher = more likely to play in Chrome/Safari <video> */
function browserScore(title, url) {
  const t = `${title || ''} ${url || ''}`.toLowerCase();
  let score = 40;
  if (/\.mp4(\?|$)|[\s.\-_]mp4[\s.\-_]/i.test(t)) score += 50;
  if (/x264|h\.?264|avc/.test(t)) score += 35;
  if (/web-?dl|webrip|hdtv/.test(t)) score += 8;
  if (/1080p/.test(t)) score += 18;
  if (/720p/.test(t)) score += 22; // often lighter / more compatible
  if (/480p|dvdrip|hdrip/.test(t)) score += 6;
  if (/2160p|4k|uhd/.test(t)) score -= 30;
  if (/x265|h\.?265|hevc|10bit|hdr10|dolby\s*vision|\bdv\b/.test(t)) score -= 45;
  if (/\bav1\b/.test(t)) score -= 50;
  if (/\.mkv(\?|$)|[\s.\-_]mkv[\s.\-_]/i.test(t)) score -= 25;
  if (/\.m3u8(\?|$)|hls/.test(t)) score += 40;
  return score;
}

function isLikelyBrowserPlayable(title, url) {
  return browserScore(title, url) >= 55;
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

    // ONLY trust total size from Content-Range (…/TOTAL).
    // Content-Length on a Range request is often just the chunk size (e.g. 4096) and must NOT mark streams as stubs.
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

    // Tiny full-file videos via Content-Range total only (RD copyright stub MP4s)
    if (totalBytes > 0 && totalBytes < 8 * 1024 * 1024 && /video|octet-stream|mp4/i.test(ct)) {
      return { url, ok: false, reason: 'copyright_stub' };
    }

    // Working media usually redirects to video/octet-stream (even with Range)
    if (status >= 200 && status < 400 && /video|audio|mpegurl|octet-stream|mp2t|mp4/i.test(ct)) {
      return { url, ok: true, reason: 'media', bytes: totalBytes || undefined };
    }
    if (status >= 200 && status < 400 && !/text\/html/i.test(ct) && buf.length > 0) {
      return { url, ok: true, reason: 'ok', bytes: totalBytes || undefined };
    }
    if (/text\/html/i.test(ct) && INFRINGE_RE.test(text)) {
      return { url, ok: false, reason: 'copyright' };
    }
    // Unknown — keep (don't over-prune)
    return { url, ok: true, reason: 'unknown' };
  } catch (e) {
    // Network blip — keep link
    return { url, ok: true, reason: 'probe_error' };
  }
}

router.get('/status', async (req, res) => {
  const siteConfigured = !!siteToken();
  // Never use the site-wide RD token for unauthenticated status (leaks account email)
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
    // Small concurrency so we don't hammer RD
    const queue = urls.slice();
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const u = queue.shift();
        results.push(await probeStreamUrl(u));
      }
    });
    await Promise.all(workers);

    // Only remove clear copyright hits — never probe_error / unknown
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

    // Prefer site-wide RD key for paying users
    const token = siteToken() || tokenFrom(req);
    const { imdbId, type, season, episode, tmdbId } = req.body || {};
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Real-Debrid not configured on server (set REALDEBRID_API_TOKEN)'
      });
    }

    let imdb = (imdbId || '').toString().trim();
    if (imdb && !imdb.startsWith('tt')) imdb = 'tt' + imdb.replace(/\D/g, '');

    if (!imdb && tmdbId) {
      const KEY = process.env.TMDB_API_KEY || '';
      const media = type === 'tv' ? 'tv' : 'movie';
      if (KEY) {
        try {
          const ext = await axios.get(`https://api.themoviedb.org/3/${media}/${tmdbId}/external_ids`, {
            params: { api_key: KEY },
            timeout: 8000
          });
          imdb = ext.data?.imdb_id || '';
        } catch {}
      }
    }

    if (!imdb || !imdb.startsWith('tt')) {
      return res.status(400).json({ success: false, error: 'IMDB id required for debrid streams' });
    }

    const cfg = `realdebrid=${encodeURIComponent(token)}|qualityfilter=scr,cam,unknown`;
    let path;
    if (type === 'tv' || type === 'series') {
      const s = parseInt(season, 10) || 1;
      const e = parseInt(episode, 10) || 1;
      path = `/stream/series/${imdb}:${s}:${e}.json`;
    } else {
      path = `/stream/movie/${imdb}.json`;
    }

    const url = `${TORRENTIO}/${cfg}${path}`;
    console.log('Debrid/Torrentio:', path);

    const r = await axios.get(url, {
      headers: { 'User-Agent': ua(), Accept: 'application/json' },
      timeout: 25000,
      validateStatus: s => s < 500
    });

    if (r.status >= 400) {
      return res.status(502).json({ success: false, error: `Torrentio HTTP ${r.status}` });
    }

    const raw = r.data?.streams || [];
    let streams = raw
      .map((s, i) => {
        const playUrl = s.url || s.externalUrl || '';
        if (!/^https?:\/\//i.test(playUrl)) return null;
        if (/magnet:/i.test(playUrl)) return null;
        const title = s.title || s.name || `Stream ${i + 1}`;
        // Skip links torrentio already flagged as removed / infringing
        if (INFRINGE_RE.test(title) || INFRINGE_RE.test(s.name || '')) return null;
        const quality = parseQuality(title + ' ' + (s.name || ''));
        const isHls = /\.m3u8(\?|$)/i.test(playUrl) || /hls/i.test(playUrl);
        const bScore = browserScore(title, playUrl);
        return {
          source: (s.name || 'RD').replace(/\n/g, ' ').slice(0, 40),
          title: title.split('\n')[0].slice(0, 80),
          quality,
          size: parseSize(title),
          seeders: parseSeeders(title),
          type: isHls ? 'hls' : 'direct',
          url: playUrl,
          embedUrl: playUrl,
          debrid: true,
          browserOk: isLikelyBrowserPlayable(title, playUrl),
          browserScore: bScore,
          priority: i + 1
        };
      })
      .filter(Boolean);

    // Prefer browser-friendly (mp4/x264/720-1080) over 4K HEVC/MKV that <video> can't play
    streams.sort((a, b) =>
      (b.browserScore - a.browserScore) ||
      (b.seeders || 0) - (a.seeders || 0)
    );

    // Keep playable-looking ones first, then a few heavier backups
    const friendly = streams.filter(s => s.browserOk);
    const rest = streams.filter(s => !s.browserOk);
    streams = [...friendly, ...rest].slice(0, 40);

    res.json({
      success: true,
      data: {
        imdbId: imdb,
        streams,
        totalSources: streams.length,
        browserFriendly: friendly.length,
        provider: 'realdebrid+torrentio'
      }
    });
  } catch (e) {
    console.error('Debrid streams error:', e.message);
    res.status(500).json({ success: false, error: e.message || 'Debrid lookup failed' });
  }
});

module.exports = router;
