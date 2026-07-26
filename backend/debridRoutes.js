/**
 * Real-Debrid via Torrentio (Stremio addon).
 * Token resolution order:
 *  1) Client header/body (per-user key)
 *  2) REALDEBRID_API_TOKEN in server .env (site-wide)
 */
const express = require('express');
const axios = require('axios');

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

router.get('/status', async (req, res) => {
  const siteConfigured = !!siteToken();
  const token = tokenFrom(req);
  if (!token) {
    return res.json({ success: true, configured: false, siteConfigured });
  }
  try {
    const r = await axios.get(`${RD_API}/user`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua() },
      timeout: 10000
    });
    res.json({
      success: true,
      configured: true,
      siteConfigured,
      data: {
        username: r.data.username,
        email: r.data.email,
        premium: r.data.type === 'premium',
        expiration: r.data.expiration,
        points: r.data.points,
        source: req.headers['x-rd-token'] ? 'user' : (siteConfigured ? 'site' : 'user')
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

router.post('/streams', async (req, res) => {
  try {
    const token = tokenFrom(req);
    const { imdbId, type, season, episode, tmdbId } = req.body || {};
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Real-Debrid token required (paste in RD button or set REALDEBRID_API_TOKEN on server)'
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
    const streams = raw
      .map((s, i) => {
        const playUrl = s.url || s.externalUrl || '';
        if (!/^https?:\/\//i.test(playUrl)) return null;
        if (/magnet:/i.test(playUrl)) return null;
        const title = s.title || s.name || `Stream ${i + 1}`;
        const quality = parseQuality(title + ' ' + (s.name || ''));
        const isHls = /\.m3u8(\?|$)/i.test(playUrl) || /hls/i.test(playUrl);
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
          priority: i + 1
        };
      })
      .filter(Boolean)
      .slice(0, 40);

    const rank = q => ({ '4K': 0, '1080p': 1, '720p': 2, HD: 3, '480p': 4, CAM: 9 }[q] ?? 5);
    streams.sort((a, b) => rank(a.quality) - rank(b.quality) || (b.seeders || 0) - (a.seeders || 0));

    res.json({
      success: true,
      data: {
        imdbId: imdb,
        streams,
        totalSources: streams.length,
        provider: 'realdebrid+torrentio'
      }
    });
  } catch (e) {
    console.error('Debrid streams error:', e.message);
    res.status(500).json({ success: false, error: e.message || 'Debrid lookup failed' });
  }
});

module.exports = router;
