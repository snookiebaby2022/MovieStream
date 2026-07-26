const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { User, Comment, Rating } = require('./models');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'flixnova-dev-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET not set — using insecure default. Set JWT_SECRET in .env');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signToken(payload, days = 30) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + days * 86400000 }));
  const data = `${header}.${body}`;
  const sig = b64url(crypto.createHmac('sha256', JWT_SECRET).update(data).digest());
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const data = `${h}.${b}`;
  const expect = b64url(crypto.createHmac('sha256', JWT_SECRET).update(data).digest());
  if (s !== expect) return null;
  try {
    const payload = JSON.parse(Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function bearer(req) {
  const h = req.headers.authorization || '';
  if (/^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '');
  return req.headers['x-user-token'] || '';
}

function authOptional(req, _res, next) {
  req.user = verifyToken(bearer(req));
  next();
}

function authRequired(req, res, next) {
  const u = verifyToken(bearer(req));
  if (!u) return res.status(401).json({ success: false, error: 'Login required' });
  req.user = u;
  next();
}

function dbReady(res) {
  if (require('mongoose').connection.readyState !== 1) {
    res.status(503).json({ success: false, error: 'Database unavailable' });
    return false;
  }
  return true;
}

router.post('/register', async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const { username, password, email } = req.body || {};
    if (!username || !password || String(username).length < 3 || String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'Username (3+) and password (6+) required' });
    }
    const exists = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (exists) return res.status(409).json({ success: false, error: 'Username taken' });
    const passHash = await bcrypt.hash(String(password), 10);
    const user = await User.create({
      username: String(username).trim().toLowerCase(),
      email: email ? String(email).trim() : '',
      passHash
    });
    const token = signToken({ id: String(user._id), username: user.username });
    res.json({ success: true, token, username: user.username });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const { username, password } = req.body || {};
    const user = await User.findOne({ username: String(username || '').trim().toLowerCase() });
    if (!user || !(await bcrypt.compare(String(password || ''), user.passHash))) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    const token = signToken({ id: String(user._id), username: user.username });
    res.json({ success: true, token, username: user.username });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const user = await User.findById(req.user.id).select('-passHash');
    if (!user) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: user });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/watchlist', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const user = await User.findById(req.user.id);
    res.json({ success: true, data: user?.watchlist || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/watchlist', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const item = req.body || {};
    if (!item.tmdbId || !item.type) return res.status(400).json({ success: false, error: 'tmdbId and type required' });
    const user = await User.findById(req.user.id);
    user.watchlist = (user.watchlist || []).filter(x => !(x.tmdbId === item.tmdbId && x.type === item.type));
    user.watchlist.unshift({
      tmdbId: item.tmdbId, type: item.type, title: item.title || '',
      poster: item.poster || '', year: item.year || '', rating: item.rating || 0
    });
    if (user.watchlist.length > 300) user.watchlist = user.watchlist.slice(0, 300);
    await user.save();
    res.json({ success: true, data: user.watchlist });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/watchlist/:type/:tmdbId', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const user = await User.findById(req.user.id);
    const id = parseInt(req.params.tmdbId, 10);
    user.watchlist = (user.watchlist || []).filter(x => !(x.tmdbId === id && x.type === req.params.type));
    await user.save();
    res.json({ success: true, data: user.watchlist });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/history', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const user = await User.findById(req.user.id);
    res.json({ success: true, data: user?.history || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/history', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const item = req.body || {};
    if (!item.tmdbId || !item.type) return res.status(400).json({ success: false, error: 'tmdbId and type required' });
    const user = await User.findById(req.user.id);
    user.history = (user.history || []).filter(x => !(x.tmdbId === item.tmdbId && x.type === item.type && (x.season || 0) === (item.season || 0) && (x.episode || 0) === (item.episode || 0)));
    user.history.unshift({
      tmdbId: item.tmdbId, type: item.type, title: item.title || '',
      poster: item.poster || '', year: item.year || '',
      season: item.season || null, episode: item.episode || null, at: new Date()
    });
    if (user.history.length > 200) user.history = user.history.slice(0, 200);
    await user.save();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/comments/:type/:tmdbId', async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const list = await Comment.find({
      tmdbId: parseInt(req.params.tmdbId, 10),
      mediaType: req.params.type
    }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/comments/:type/:tmdbId', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const text = String((req.body || {}).text || '').trim();
    if (text.length < 2) return res.status(400).json({ success: false, error: 'Comment too short' });
    const c = await Comment.create({
      tmdbId: parseInt(req.params.tmdbId, 10),
      mediaType: req.params.type,
      userId: req.user.id,
      username: req.user.username,
      text: text.slice(0, 1000)
    });
    res.json({ success: true, data: c });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/ratings/:type/:tmdbId', authOptional, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const tmdbId = parseInt(req.params.tmdbId, 10);
    const mediaType = req.params.type;
    const agg = await Rating.aggregate([
      { $match: { tmdbId, mediaType } },
      { $group: { _id: null, avg: { $avg: '$score' }, count: { $sum: 1 } } }
    ]);
    let mine = null;
    if (req.user) {
      const r = await Rating.findOne({ tmdbId, mediaType, userId: req.user.id });
      mine = r ? r.score : null;
    }
    res.json({
      success: true,
      data: {
        average: agg[0] ? Math.round(agg[0].avg * 10) / 10 : 0,
        count: agg[0]?.count || 0,
        mine
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/ratings/:type/:tmdbId', authRequired, async (req, res) => {
  try {
    if (!dbReady(res)) return;
    const score = parseInt((req.body || {}).score, 10);
    if (!score || score < 1 || score > 10) return res.status(400).json({ success: false, error: 'Score 1-10' });
    const tmdbId = parseInt(req.params.tmdbId, 10);
    const mediaType = req.params.type;
    await Rating.findOneAndUpdate(
      { tmdbId, mediaType, userId: req.user.id },
      { score },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = { router, authRequired, authOptional, verifyToken };
