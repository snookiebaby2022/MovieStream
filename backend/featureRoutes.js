/**
 * Profiles, progress, requests, analytics, subtitles.
 */
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { User, Progress, TitleRequest, PlayEvent } = require('./models');
const { authRequired, authOptional } = require('./authRoutes');

const router = express.Router();

function dbReady(res) {
  if (require('mongoose').connection.readyState !== 1) {
    res.status(503).json({ success: false, error: 'Database unavailable' });
    return false;
  }
  return true;
}

function defaultProfiles(username) {
  return [
    { id: crypto.randomBytes(6).toString('hex'), name: username || 'Main', avatar: '1', kids: false, lang: 'en' },
    { id: crypto.randomBytes(6).toString('hex'), name: 'Kids', avatar: '2', kids: true, lang: 'en' }
  ];
}

async function ensureProfiles(user) {
  if (!user.profiles || !user.profiles.length) {
    user.profiles = defaultProfiles(user.username);
    user.activeProfileId = user.profiles[0].id;
    await user.save();
  }
  if (!user.activeProfileId || !user.profiles.find(p => p.id === user.activeProfileId)) {
    user.activeProfileId = user.profiles[0].id;
    await user.save();
  }
  return user;
}

// ── Profiles ──────────────────────────────────────────────
router.get('/profiles', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    let user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'Not found' });
    user = await ensureProfiles(user);
    res.json({
      success: true,
      data: { profiles: user.profiles, activeProfileId: user.activeProfileId }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/profiles', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    let user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'Not found' });
    user = await ensureProfiles(user);
    if (user.profiles.length >= 5) return res.status(400).json({ success: false, error: 'Max 5 profiles' });
    const { name, kids, avatar, lang } = req.body || {};
    if (!name || String(name).trim().length < 1) return res.status(400).json({ success: false, error: 'Name required' });
    const p = {
      id: crypto.randomBytes(6).toString('hex'),
      name: String(name).trim().slice(0, 24),
      kids: !!kids,
      avatar: String(avatar || '1').slice(0, 8),
      lang: String(lang || 'en').slice(0, 8)
    };
    user.profiles.push(p);
    await user.save();
    res.json({ success: true, data: { profiles: user.profiles, activeProfileId: user.activeProfileId } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/profiles/active', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    let user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'Not found' });
    user = await ensureProfiles(user);
    const id = String((req.body || {}).profileId || '');
    if (!user.profiles.find(p => p.id === id)) return res.status(400).json({ success: false, error: 'Invalid profile' });
    user.activeProfileId = id;
    await user.save();
    const active = user.profiles.find(p => p.id === id);
    res.json({ success: true, data: { activeProfileId: id, profile: active } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/profiles/:id', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    let user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, error: 'Not found' });
    user = await ensureProfiles(user);
    if (user.profiles.length <= 1) return res.status(400).json({ success: false, error: 'Keep at least one profile' });
    user.profiles = user.profiles.filter(p => p.id !== req.params.id);
    if (user.activeProfileId === req.params.id) user.activeProfileId = user.profiles[0].id;
    await user.save();
    res.json({ success: true, data: { profiles: user.profiles, activeProfileId: user.activeProfileId } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Progress / resume ─────────────────────────────────────
router.get('/progress', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const user = await User.findById(req.user.id);
    const profileId = String(req.query.profileId || user?.activeProfileId || '');
    const list = await Progress.find({ userId: req.user.id, profileId })
      .sort({ updatedAt: -1 }).limit(40).lean();
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/progress', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const b = req.body || {};
    if (!b.tmdbId || !b.mediaType) return res.status(400).json({ success: false, error: 'tmdbId and mediaType required' });
    const user = await User.findById(req.user.id);
    const profileId = String(b.profileId || user?.activeProfileId || '');
    const currentTime = Math.max(0, Number(b.currentTime) || 0);
    const duration = Math.max(0, Number(b.duration) || 0);
    // Ignore tiny watches / completed
    if (currentTime < 20) return res.json({ success: true, skipped: true });
    if (duration > 0 && currentTime / duration > 0.92) {
      await Progress.deleteOne({
        userId: req.user.id, profileId, tmdbId: b.tmdbId, mediaType: b.mediaType,
        season: b.season || 0, episode: b.episode || 0
      });
      return res.json({ success: true, completed: true });
    }
    const doc = await Progress.findOneAndUpdate(
      {
        userId: req.user.id, profileId,
        tmdbId: b.tmdbId, mediaType: b.mediaType,
        season: b.season || 0, episode: b.episode || 0
      },
      {
        title: b.title || '', poster: b.poster || '', backdrop: b.backdrop || '',
        currentTime, duration, updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/progress/:type/:tmdbId', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const user = await User.findById(req.user.id);
    const profileId = String(req.query.profileId || user?.activeProfileId || '');
    const season = parseInt(req.query.season, 10) || 0;
    const episode = parseInt(req.query.episode, 10) || 0;
    const doc = await Progress.findOne({
      userId: req.user.id, profileId,
      tmdbId: parseInt(req.params.tmdbId, 10),
      mediaType: req.params.type,
      season, episode
    }).lean();
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Title requests ────────────────────────────────────────
router.post('/requests', authOptional, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const { title, mediaType, note, tmdbId } = req.body || {};
    if (!title || String(title).trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Title required' });
    }
    const doc = await TitleRequest.create({
      userId: req.user?.id || null,
      username: req.user?.username || 'guest',
      title: String(title).trim().slice(0, 200),
      mediaType: ['movie', 'tv', 'either'].includes(mediaType) ? mediaType : 'either',
      note: String(note || '').slice(0, 500),
      tmdbId: tmdbId ? parseInt(tmdbId, 10) : null
    });
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/requests/mine', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const list = await TitleRequest.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Analytics (public ingest + admin reads via server) ────
router.post('/analytics/play', authOptional, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const b = req.body || {};
    if (!b.tmdbId || !b.mediaType) return res.status(400).json({ success: false, error: 'Missing fields' });
    await PlayEvent.create({
      tmdbId: parseInt(b.tmdbId, 10),
      mediaType: b.mediaType === 'tv' ? 'tv' : 'movie',
      title: String(b.title || '').slice(0, 200),
      season: b.season || 0,
      episode: b.episode || 0,
      source: ['rd', 'embed', 'other'].includes(b.source) ? b.source : 'other',
      success: b.success !== false,
      userId: req.user?.id || ''
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Subtitles (Stremio OpenSubtitles addon) ───────────────
router.get('/subtitles', async (req, res) => {
  try {
    let imdb = String(req.query.imdbId || '').trim();
    const type = req.query.type === 'tv' ? 'tv' : 'movie';
    const season = parseInt(req.query.season, 10) || 1;
    const episode = parseInt(req.query.episode, 10) || 1;
    const lang = String(req.query.lang || '').toLowerCase();
    if (imdb && !imdb.startsWith('tt')) imdb = 'tt' + imdb.replace(/\D/g, '');
    if (!imdb) return res.status(400).json({ success: false, error: 'imdbId required' });

    const path = type === 'tv'
      ? `/subtitles/series/${imdb}:${season}:${episode}.json`
      : `/subtitles/movie/${imdb}.json`;
    const url = `https://opensubtitles-v3.strem.io${path}`;
    const r = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'FlixNova/1.0', Accept: 'application/json' },
      validateStatus: s => s < 500
    });
    let subs = (r.data?.subtitles || []).map((s, i) => ({
      id: s.id || String(i),
      lang: s.lang || s.language || 'und',
      label: (s.lang || s.language || 'Subtitle') + (s.releases ? ` · ${String(s.releases).slice(0, 40)}` : ''),
      url: s.url || (s.Stream || s.stream) || ''
    })).filter(s => /^https?:\/\//i.test(s.url));

    if (lang) subs = subs.filter(s => String(s.lang).toLowerCase().startsWith(lang));
    res.json({ success: true, data: subs.slice(0, 40) });
  } catch (e) {
    res.status(502).json({ success: false, error: e.message || 'Subtitle lookup failed' });
  }
});

/** Proxy subtitle file (CORS) */
router.get('/subtitles/proxy', async (req, res) => {
  try {
    const target = String(req.query.url || '');
    if (!/^https?:\/\//i.test(target)) return res.status(400).json({ success: false, error: 'Invalid url' });
    const r = await axios.get(target, {
      timeout: 20000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'FlixNova/1.0' }
    });
    const ct = r.headers['content-type'] || 'text/vtt';
    res.setHeader('Content-Type', ct.includes('vtt') ? 'text/vtt' : 'text/plain; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(r.data));
  } catch (e) {
    res.status(502).json({ success: false, error: e.message });
  }
});

module.exports = { router, ensureProfiles, defaultProfiles };
