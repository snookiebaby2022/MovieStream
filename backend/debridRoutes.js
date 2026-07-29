/**
 * Premium debrid streams via Stremio addons (Torrentio, Comet, MediaFusion, AIOStreams).
 * Debrid backends: Real-Debrid, AllDebrid, Premiumize, TorBox (env tokens).
 * XXX / sparse titles: ApiBay → Real-Debrid magnet resolve when RD token is set.
 */
const express = require('express');
const axios = require('axios');
const { verifyToken } = require('./authRoutes');
const { User } = require('./models');
const { isEntitled, ensureTrialClock, entitlementPayload, startWatchTrial } = require('./entitlement');

const router = express.Router();
const TORRENTIO = (process.env.TORRENTIO_URL || 'https://torrentio.strem.fun').replace(/\/$/, '');
const COMET = (process.env.COMET_URL || 'https://comet.elfhosted.com').replace(/\/$/, '');
const MEDIAFUSION = (process.env.MEDIAFUSION_URL || 'https://mediafusion.elfhosted.com').replace(/\/$/, '');
/** Optional path segment from MediaFusion “Share Manifest URL” (encrypted user data) */
function mediaFusionConfig() {
  return (process.env.MEDIAFUSION_CONFIG || '').toString().trim().replace(/^\/+|\/+$/g, '');
}
/** AIOStreams streams base (manifest URL without /manifest.json) */
function aioStreamsBase() {
  return (process.env.AIOSTREAMS_BASE_URL || '')
    .toString()
    .trim()
    .replace(/\/$/, '')
    .replace(/\/manifest\.json$/i, '');
}
const RD_API = 'https://api.real-debrid.com/rest/1.0';
const APIBAY = 'https://apibay.org';

function ua() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

function siteToken() {
  const base = (process.env.REALDEBRID_API_TOKEN || process.env.RD_API_TOKEN || '').toString().trim();
  if (base) return base;
  const numbered = Object.keys(process.env)
    .filter(key => /^REALDEBRID_API_TOKEN_[2-9]\d*$/.test(key))
    .sort((a, b) => Number(a.match(/(\d+)$/)?.[1]) - Number(b.match(/(\d+)$/)?.[1]));
  for (const key of numbered) {
    const token = String(process.env[key] || '').trim();
    if (token) return token;
  }
  return '';
}

function envToken(key) {
  return (process.env[key] || '').toString().trim();
}

const DEBRID_ACCOUNT_TYPES = [
  { prefix: 'REALDEBRID', id: 'realdebrid', label: 'rd' },
  { prefix: 'ALLDEBRID', id: 'alldebrid', label: 'ad' },
  { prefix: 'PREMIUMIZE', id: 'premiumize', label: 'pm' },
  { prefix: 'TORBOX', id: 'torbox', label: 'tb' }
];

/**
 * Enumerate base and numbered account slots, e.g. REALDEBRID_API_TOKEN_2.
 * Duplicate tokens are ignored so one account is not queried twice.
 */
function configuredDebrids(preferClientRd, env = process.env) {
  const list = [];
  const seenTokens = new Set();
  const personal = String(preferClientRd || '').trim();

  if (personal) {
    list.push({
      id: 'realdebrid',
      label: 'rd-personal',
      token: personal,
      key: 'PERSONAL_REALDEBRID_TOKEN',
      slot: 0
    });
    seenTokens.add(personal);
  }

  for (const type of DEBRID_ACCOUNT_TYPES) {
    const re = new RegExp(`^${type.prefix}_API_TOKEN(?:_(\\d+))?$`);
    const keys = Object.keys(env)
      .filter(key => re.test(key))
      .sort((a, b) => {
        const as = Number(a.match(re)?.[1] || 1);
        const bs = Number(b.match(re)?.[1] || 1);
        return as - bs || a.localeCompare(b);
      });
    // Preserve the legacy RD_API_TOKEN fallback as account slot 1.
    if (type.id === 'realdebrid' && !keys.includes('REALDEBRID_API_TOKEN') && env.RD_API_TOKEN) {
      keys.unshift('RD_API_TOKEN');
    }
    for (const key of keys) {
      if (personal && type.id === 'realdebrid') continue;
      const token = String(env[key] || '').trim();
      if (!token || seenTokens.has(token)) continue;
      const slot = Number(key.match(/_(\d+)$/)?.[1] || 1);
      list.push({
        id: type.id,
        label: `${type.label}${slot > 1 ? slot : ''}`,
        token,
        key,
        slot
      });
      seenTokens.add(token);
    }
  }
  return list;
}

function anyPremiumConfigured(preferClientRd) {
  return configuredDebrids(preferClientRd).length > 0 || !!mediaFusionConfig() || !!aioStreamsBase();
}

/** Prefer an explicitly supplied personal RD token over the site token. */
function tokenFrom(req) {
  const client = (
    req.headers['x-rd-token'] ||
    req.body?.token ||
    req.query?.token ||
    ''
  ).toString().trim();
  return client || siteToken();
}

function clientRdToken(req) {
  return (
    req.headers['x-rd-token'] ||
    req.body?.token ||
    req.query?.token ||
    ''
  ).toString().trim();
}

const ACCOUNT_ERR_RE = /AUTH_BLOCKED|access to (the )?debrid api is blocked|check your debrid account|check your (?:debrid )?email|please (?:approve|confirm).{0,40}email|invalid (?:api )?key|expired|not premium|inactive premium|banned|geo.?blocked|ip.?blocked|unauthorized|forbidden|please (re-)?configure|obsolete configuration/i;
const FAILED_CLIP_RE = /\/videos\/failed[_/]|failed_access|failed_unauthorized|failed_premium/i;

function isFailedClipUrl(url) {
  return FAILED_CLIP_RE.test(String(url || ''));
}

function isAccountErrorText(text) {
  return ACCOUNT_ERR_RE.test(String(text || ''));
}

function providerFamily(provider) {
  const p = String(provider || '').toLowerCase();
  if (p.includes('alldebrid') || p.includes('-ad') || /\bad\b/.test(p)) return 'alldebrid';
  if (p.includes('realdebrid') || p.includes('torrentio-real') || /\brd\b/.test(p)) return 'realdebrid';
  if (p.includes('premiumize') || /\bpm\b/.test(p)) return 'premiumize';
  if (p.includes('torbox') || /\btb\b/.test(p)) return 'torbox';
  if (p.includes('mediafusion')) return 'mediafusion';
  if (p.includes('aiostreams')) return 'aiostreams';
  if (p.includes('comet')) return 'comet';
  if (p.includes('torrentio')) return 'torrentio';
  return p.split('-')[0] || p || 'unknown';
}

/** Keep numbered accounts independent for quarantine while balancing by provider. */
function providerFailureGroup(provider) {
  const p = String(provider || '').toLowerCase();
  const family = providerFamily(p);
  const slot = p.match(/-(\d+)$/)?.[1];
  return slot ? `${family}:${slot}` : family;
}

/** Cap results per provider family so one blocked provider cannot fill the whole list. */
function balanceByProvider(streams, { perProvider = 12, max = 40 } = {}) {
  const counts = new Map();
  const out = [];
  for (const s of streams) {
    const fam = providerFamily(s.provider || s.source);
    const n = counts.get(fam) || 0;
    if (n >= perProvider) continue;
    counts.set(fam, n + 1);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function quarantineProviders(streams, blockedFamilies) {
  if (!blockedFamilies || !blockedFamilies.size) return streams;
  return streams.filter(s => !blockedFamilies.has(providerFailureGroup(s.provider || s.source)));
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

/** Higher = try first. Prefer 1080p, then 4K, then 720p. */
function qualityRank(q) {
  switch (String(q || '').toUpperCase()) {
    case '1080P': return 100;
    case '4K': return 85;
    case '720P': return 70;
    case 'HD': return 50;
    case '480P': return 30;
    case 'CAM': return 0;
    default: return 40;
  }
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
  if (/\[ad\+\]|\[pm\+\]|\[tb\+\]/.test(t)) score += 90;
  if (/⚡/.test(t) && !/\[rd\+\]|\[ad\+\]|\[pm\+\]|\[tb\+\]/.test(t)) score += 70; // Comet cached
  if (/\[rd download\]|\[ad download\]|\[pm download\]|\[tb download\]/.test(t)) score -= 80;
  if (/\.mp4(\?|$)|[\s.\-_]mp4[\s.\-_]/i.test(t)) score += 55;
  if (/x264|h\.?264|avc/.test(t)) score += 45;
  if (/blu-?ray|bluray|bdrip|brrip|remux/.test(t)) score += 12;
  if (/web-?dl|webrip|hdtv/.test(t)) score -= 15; // RD May-2026 keyword filter often hits these
  if (/amzn|netflix|\bnf\b|\bhulu\b|\bd\+|\batvp\b|disney|\bhbo\b|\bcr\b/.test(t)) score -= 25;
  if (/\byts\b|rarbg|sparkles|ion10/.test(t)) score -= 20;
  if (/1080p/.test(t)) score += 35;
  if (/2160p|4k|uhd/.test(t)) score += 18; // after 1080p in sort, but keep in pool
  if (/720p/.test(t)) score += 12;
  if (/480p|dvdrip|hdrip/.test(t)) score += 10;
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

async function requireEntitled(req, res) {
  const userTok = verifyToken(
    req.headers['x-user-token'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
    req.query?.token ||
    req.query?.t ||
    ''
  );
  if (!userTok) {
    res.status(401).json({ success: false, error: 'Login required', code: 'LOGIN_REQUIRED' });
    return null;
  }
  if (require('mongoose').connection.readyState !== 1) {
    res.status(503).json({ success: false, error: 'Database unavailable' });
    return null;
  }
  let user = await User.findById(userTok.id);
  if (!user) {
    res.status(401).json({ success: false, error: 'Login required', code: 'LOGIN_REQUIRED' });
    return null;
  }
  user = await ensureTrialClock(user);
  if (!isEntitled(user)) {
    const started = await startWatchTrial(user);
    user = started.user;
  }
  if (!isEntitled(user)) {
    const ent = entitlementPayload(user);
    res.status(403).json({
      success: false,
      error: 'Your free trial has ended. Subscribe for £1/month to keep watching.',
      code: 'ADFREE_REQUIRED',
      needsPay: true,
      trialEndsAt: ent.trialEndsAt,
      trialExpired: ent.trialExpired
    });
    return null;
  }
  return userTok;
}

/** @deprecated alias */
async function requireAdFree(req, res) {
  return requireEntitled(req, res);
}

function isAllowedProxyUrl(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase();
    // RD resolve hosts + common CDN endings after unrestrict
    return (
      /(^|\.)real-debrid\.com$/i.test(h) ||
      /(^|\.)alldebrid\.com$/i.test(h) ||
      /(^|\.)premiumize\.me$/i.test(h) ||
      /(^|\.)torbox\.app$/i.test(h) ||
      /(^|\.)strem\.fun$/i.test(h) ||
      /(^|\.)elfhosted\.com$/i.test(h) ||
      /(^|\.)viren070\.me$/i.test(h) ||
      /(^|\.)googleusercontent\.com$/i.test(h) ||
      /(^|\.)googleapis\.com$/i.test(h) ||
      /(^|\.)cloudfront\.net$/i.test(h) ||
      /(^|\.)akamaihd\.net$/i.test(h) ||
      /(^|\.)akamaized\.net$/i.test(h) ||
      /(^|\.)fastly\.net$/i.test(h) ||
      /\.cdn\./i.test(h) ||
      /download/i.test(h)
    );
  } catch {
    return false;
  }
}

/**
 * Read at most `maxBytes` of the body, then abort. Streaming avoids axios
 * maxContentLength errors when a host ignores our Range request.
 */
async function fetchHeadSample(url, maxBytes = 8192) {
  const r = await axios.get(url, {
    timeout: 12000,
    maxRedirects: 5,
    responseType: 'stream',
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: {
      'User-Agent': ua(),
      Range: 'bytes=0-4095',
      Accept: '*/*'
    },
    validateStatus: () => true
  });

  const chunks = [];
  let read = 0;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { r.data.destroy(); } catch {}
      resolve();
    };
    r.data.on('data', (c) => {
      chunks.push(c);
      read += c.length;
      if (read >= maxBytes) finish();
    });
    r.data.on('end', finish);
    r.data.on('error', finish);
    r.data.on('close', finish);
    setTimeout(finish, 8000);
  });

  return { res: r, buf: Buffer.concat(chunks) };
}

/** Probe an RD / resolved stream URL for copyright / infringing / account-error blocks */
async function probeStreamUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { url, ok: false, reason: 'invalid' };
  }
  if (isFailedClipUrl(url)) {
    return { url, ok: false, reason: 'account_blocked', finalUrl: url };
  }
  try {
    const { res: r, buf } = await fetchHeadSample(url);
    const ct = String(r.headers['content-type'] || '');
    const status = r.status;
    const text = buf.toString('utf8', 0, Math.min(buf.length, 4000));
    const finalUrl = String(r.request?.res?.responseUrl || r.request?.responseURL || url);

    const cr = String(r.headers['content-range'] || '');
    const crm = cr.match(/\/(\d+)\s*$/);
    const contentLength = parseInt(String(r.headers['content-length'] || '0'), 10) || 0;
    // Content-Range gives the true total. Content-Length is only the total on a
    // full 200 response — on a 206 it is just the slice we asked for.
    let totalBytes = crm ? (parseInt(crm[1], 10) || 0) : 0;
    if (!totalBytes && status === 200 && contentLength > 0) {
      totalBytes = contentLength;
    }

    // Axios redirect chain (Torrentio → failed_access_v2.mp4 on CDN)
    const redirectUrls = [];
    try {
      const chain = r.request?.res?.responseUrl || r.request?.responseURL;
      if (chain) redirectUrls.push(String(chain));
      const redirects = r.request?._redirectable?._redirects || r.request?._redirects;
      if (Array.isArray(redirects)) {
        redirects.forEach((x) => {
          if (x && x.href) redirectUrls.push(String(x.href));
          else if (typeof x === 'string') redirectUrls.push(x);
        });
      }
    } catch {}

    if (
      isFailedClipUrl(finalUrl) ||
      isFailedClipUrl(url) ||
      redirectUrls.some(isFailedClipUrl)
    ) {
      return { url, ok: false, reason: 'account_blocked', finalUrl };
    }
    if (isAccountErrorText(text) || isAccountErrorText(finalUrl)) {
      return { url, ok: false, reason: 'account_blocked', finalUrl };
    }
    if (status === 401 || status === 403) {
      return { url, ok: false, reason: 'account_blocked', status, finalUrl };
    }
    if (status === 429 || status >= 500) {
      return { url, ok: false, reason: 'unavailable', status, finalUrl };
    }
    if (status === 451 || INFRINGE_RE.test(text)) {
      return { url, ok: false, reason: 'copyright', finalUrl };
    }
    if (/application\/json|text\/html|text\/plain/i.test(ct) && INFRINGE_RE.test(text)) {
      return { url, ok: false, reason: 'copyright', finalUrl };
    }
    try {
      if (/json/i.test(ct) || text.trim().startsWith('{')) {
        const j = JSON.parse(text);
        const blob = JSON.stringify(j);
        if (j && (j.error_code === 35 || j.error === 'infringing_file' || INFRINGE_RE.test(blob))) {
          return { url, ok: false, reason: 'copyright', finalUrl };
        }
        if (isAccountErrorText(blob)) {
          return { url, ok: false, reason: 'account_blocked', finalUrl };
        }
      }
    } catch {}

    // Tiny "video" stubs = copyright notice OR AllDebrid/Torrentio orange "API blocked" MP4
    if (totalBytes > 0 && totalBytes < 12 * 1024 * 1024 && /video|octet-stream|mp4/i.test(ct)) {
      const accountish = isFailedClipUrl(finalUrl) || redirectUrls.some(isFailedClipUrl) || totalBytes < 3 * 1024 * 1024;
      return {
        url,
        ok: false,
        reason: accountish ? 'account_blocked' : 'copyright_stub',
        finalUrl,
        bytes: totalBytes
      };
    }

    if (status >= 200 && status < 400 && /video|audio|mpegurl|octet-stream|mp2t|mp4/i.test(ct)) {
      return { url, ok: true, reason: 'media', bytes: totalBytes || undefined, finalUrl };
    }
    if (status >= 200 && status < 400 && !/text\/html/i.test(ct) && buf.length > 0) {
      return { url, ok: true, reason: 'ok', bytes: totalBytes || undefined, finalUrl };
    }
    if (/text\/html/i.test(ct) && (INFRINGE_RE.test(text) || isAccountErrorText(text))) {
      return { url, ok: false, reason: INFRINGE_RE.test(text) ? 'copyright' : 'account_blocked', finalUrl };
    }
    // Nothing conclusive — keep the stream as a playable candidate, just unverified
    return { url, ok: false, reason: 'inconclusive', finalUrl, status };
  } catch (e) {
    return { url, ok: false, reason: 'probe_error', error: e.message };
  }
}

/** Probe reasons that mean "definitely do not play this URL". */
const HARD_FAIL_REASONS = new Set([
  'account_blocked',
  'copyright',
  'copyright_stub',
  'invalid'
]);

function isHardProbeFail(result) {
  return !!result && result.ok === false && HARD_FAIL_REASONS.has(result.reason);
}

function mapAddonStreams(raw, provider) {
  return (raw || [])
    .map((s, i) => {
      const playUrl = s.url || s.externalUrl || '';
      if (!/^https?:\/\//i.test(playUrl)) return null;
      if (/magnet:/i.test(playUrl)) return null;
      if (isFailedClipUrl(playUrl)) return null;
      const title = s.title || s.description || s.name || `Stream ${i + 1}`;
      const name = s.name || provider;
      const blob = `${title} ${name}`;
      if (INFRINGE_RE.test(blob)) return null;
      // Skip Comet/MediaFusion/Torrentio account & config error notices
      if (isAccountErrorText(blob) || /invalid api key|obsolete configuration|please (re-)?configure|check your configuration/i.test(blob)) {
        return null;
      }
      const quality = parseQuality(title + ' ' + name);
      const isHls = /\.m3u8(\?|$)/i.test(playUrl) || /hls/i.test(playUrl);
      const bScore = browserScore(title, playUrl, name);
      const cached = /\[rd\+\]|\[ad\+\]|\[pm\+\]|\[tb\+\]|⚡|cached/i.test(name + ' ' + title);
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

function cometConfigB64(token, debridService = 'realdebrid') {
  const cfg = {
    cachedOnly: false,
    sortCachedUncachedTogether: false,
    removeTrash: true,
    resultFormat: ['all'],
    maxResultsPerResolution: 0,
    maxSize: 0,
    debridService: debridService || 'realdebrid',
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

/** Cap parallel Torrentio hits — multi-account fan-out was causing mass 429s. */
let torrentioInFlight = 0;
const torrentioWaiters = [];
async function withTorrentioSlot(fn) {
  if (torrentioInFlight >= 2) {
    await new Promise(resolve => torrentioWaiters.push(resolve));
  }
  torrentioInFlight++;
  try {
    return await fn();
  } finally {
    torrentioInFlight--;
    const next = torrentioWaiters.shift();
    if (next) next();
  }
}

async function fetchJsonStreams(url, label, { retries = 0 } = {}) {
  try {
    const r = await axios.get(url, {
      headers: { 'User-Agent': ua(), Accept: 'application/json' },
      timeout: 22000,
      validateStatus: s => s < 500
    });
    if (r.status === 429 && retries > 0) {
      console.warn(`Debrid/${label}: HTTP 429 — backing off`);
      await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 800)));
      return fetchJsonStreams(url, label, { retries: retries - 1 });
    }
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

async function fetchTorrentio(service, token, path, { deep = false } = {}) {
  const cfgSoft = `${service}=${encodeURIComponent(token)}|qualityfilter=scr,cam,unknown`;
  const cfgAll = `${service}=${encodeURIComponent(token)}`;
  const label = `torrentio-${service}`;
  // First play: one soft request. Deep: escalate only if needed.
  return withTorrentioSlot(async () => {
    let streams = await fetchJsonStreams(`${TORRENTIO}/${cfgSoft}${path}`, label, { retries: 1 });
    if (deep && streams.filter(s => s.browserOk || s.quality === '1080p' || s.quality === '4K').length < 3) {
      const more = await fetchJsonStreams(`${TORRENTIO}/${cfgAll}${path}`, label, { retries: 1 });
      streams = dedupeStreams(streams.concat(more));
    } else if (!streams.length) {
      streams = await fetchJsonStreams(`${TORRENTIO}/${cfgAll}${path}`, label, { retries: deep ? 1 : 0 });
    }
    return streams;
  });
}

/** First play: one account per provider. Deep: all configured accounts. */
function debridsForLookup(preferClientRd, deep, env = process.env) {
  const all = configuredDebrids(preferClientRd, env);
  if (deep) return all;
  const seen = new Set();
  const primary = [];
  for (const d of all) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    primary.push(d);
  }
  return primary;
}

async function fetchComet(service, token, path) {
  const b64 = cometConfigB64(token, service);
  return fetchJsonStreams(`${COMET}/${b64}${path}`, `comet-${service}`);
}

async function fetchMediaFusion(path) {
  const cfg = mediaFusionConfig();
  if (!cfg) return [];
  return fetchJsonStreams(`${MEDIAFUSION}/${cfg}${path}`, 'mediafusion');
}

async function fetchAioStreams(path) {
  const base = aioStreamsBase();
  if (!base) return [];
  return fetchJsonStreams(`${base}${path}`, 'aiostreams');
}

/** Parallel Torrentio/Comet per configured debrid + MediaFusion + AIOStreams */
async function fetchAddonStreams(path, { deep = false, preferClientRd = '' } = {}) {
  const debrids = debridsForLookup(preferClientRd, deep);
  const jobs = [];
  for (const d of debrids) {
    const accountSuffix = d.slot > 1 ? `-${d.slot}` : '';
    jobs.push(
      fetchTorrentio(d.id, d.token, path, { deep })
        .then(rows => rows.map(row => ({ ...row, provider: `torrentio-${d.id}${accountSuffix}` })))
        .then(rows => ({ provider: `torrentio-${d.id}${accountSuffix}`, rows }))
        .catch(() => ({ provider: `torrentio-${d.id}${accountSuffix}`, rows: [] }))
    );
    jobs.push(
      fetchComet(d.id, d.token, path)
        .then(rows => rows.map(row => ({ ...row, provider: `comet-${d.id}${accountSuffix}` })))
        .then(rows => ({ provider: `comet-${d.id}${accountSuffix}`, rows }))
        .catch(() => ({ provider: `comet-${d.id}${accountSuffix}`, rows: [] }))
    );
  }
  jobs.push(
    fetchMediaFusion(path)
      .then(rows => ({ provider: 'mediafusion', rows }))
      .catch(() => ({ provider: 'mediafusion', rows: [] }))
  );
  jobs.push(
    fetchAioStreams(path)
      .then(rows => ({ provider: 'aiostreams', rows }))
      .catch(() => ({ provider: 'aiostreams', rows: [] }))
  );
  if (!jobs.length) return [];

  // First play stays snappy; deep waits longer after rate-limit backoff
  const hardMs = deep ? 26000 : 16000;
  const raced = await Promise.all(
    jobs.map(p =>
      Promise.race([
        p,
        new Promise(resolve => setTimeout(() => resolve({ provider: 'timeout', rows: [] }), hardMs))
      ])
    )
  );

  const flat = [];
  for (const pack of raced) {
    if (pack && Array.isArray(pack.rows)) flat.push(...pack.rows);
  }
  return dedupeStreams(flat);
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
 * Probe top candidates until minValidated healthy streams exist (or pool exhausted).
 * Prefer cached + browser-friendly + soft codecs. Quarantine account-blocked providers.
 * keepUnprobed / backupUnprobed control whether unverified leftovers are appended.
 */
async function validateTopStreams(streams, {
  want = 8,
  probeLimit = 28,
  minValidated = 3,
  keepUnprobed = false,
  backupUnprobed = 0,
  deadlineMs = 9000
} = {}) {
  if (!streams.length) return [];
  const ranked = streams.slice().sort((a, b) =>
    ((b.cached ? 1 : 0) - (a.cached ? 1 : 0)) ||
    ((b.browserOk ? 1 : 0) - (a.browserOk ? 1 : 0)) ||
    ((a.hardCodec ? 1 : 0) - (b.hardCodec ? 1 : 0)) ||
    (qualityRank(b.quality) - qualityRank(a.quality)) ||
    ((a.rdRisky ? 1 : 0) - (b.rdRisky ? 1 : 0)) ||
    ((b.browserScore || 0) - (a.browserScore || 0)) ||
    ((b.seeders || 0) - (a.seeders || 0))
  );

  const validated = [];
  const backlog = [];
  const rejected = new Set();
  const blockedFamilies = new Set();
  const probedKeys = new Set();
  const limit = Math.min(probeLimit, ranked.length);
  let cursor = 0;

  async function probeOne(s) {
    const key = String(s.url || '').split('?')[0].toLowerCase();
    if (!key || probedKeys.has(key) || rejected.has(key)) return;
    probedKeys.add(key);
    const fam = providerFailureGroup(s.provider || s.source);
    if (blockedFamilies.has(fam)) {
      rejected.add(key);
      return;
    }
    const result = await probeStreamUrl(s.url);
    if (result.ok === false && result.reason === 'account_blocked') {
      rejected.add(key);
      blockedFamilies.add(fam);
      return;
    }
    if (isHardProbeFail(result)) {
      rejected.add(key);
      return;
    }
    if (result.ok) {
      const row = { ...s, validated: true, probeReason: result.reason };
      if (s.browserOk !== false && !s.hardCodec) validated.push(row);
      else backlog.push(row);
    }
    // inconclusive / probe_error / transient: keep as an unverified candidate
  }

  // Stop probing once the deadline passes so first play never hangs on slow hosts
  const stopAt = Date.now() + Math.max(1500, deadlineMs);

  while (validated.length < minValidated && cursor < limit && Date.now() < stopAt) {
    const batch = [];
    while (batch.length < 5 && cursor < limit) {
      const s = ranked[cursor++];
      const key = String(s.url || '').split('?')[0].toLowerCase();
      const fam = providerFailureGroup(s.provider || s.source);
      if (!key || probedKeys.has(key) || rejected.has(key) || blockedFamilies.has(fam)) continue;
      batch.push(s);
    }
    if (!batch.length) break;
    await Promise.all(batch.map(probeOne));
  }

  const pool = quarantineProviders(ranked, blockedFamilies);
  const notRejected = (s) => !rejected.has(String(s.url || '').split('?')[0].toLowerCase());
  const good = dedupeStreams(
    quarantineProviders(validated.concat(backlog.filter(notRejected)), blockedFamilies)
  );

  // Validated streams lead, but unverified candidates always stay as fallback so a
  // slow/odd probe never empties the list.
  const backupN = keepUnprobed ? 40 : Math.max(8, backupUnprobed | 0);
  const leftover = pool
    .filter(s => notRejected(s) && !good.some(g => g.url === s.url))
    .slice(0, backupN);

  return balanceByProvider(dedupeStreams(good.concat(leftover)), {
    perProvider: 12,
    max: Math.max(want, 12) + leftover.length
  });
}

router.get('/status', async (req, res) => {
  const siteConfigured = anyPremiumConfigured();
  const providers = configuredDebrids().map(d => d.id);
  if (mediaFusionConfig()) providers.push('mediafusion');
  if (aioStreamsBase()) providers.push('aiostreams');
  const userTok = (
    req.headers['x-rd-token'] ||
    req.body?.token ||
    req.query?.token ||
    ''
  ).toString().trim();
  if (!userTok) {
    return res.json({
      success: true,
      configured: false,
      siteConfigured,
      providers,
      debridCount: configuredDebrids().length
    });
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

    // Only drop links that are definitely unplayable — transient/unknown probes stay
    const bad = results.filter(isHardProbeFail).map(r => r.url);
    const blocked = results.filter(r => !r.ok && r.reason === 'account_blocked').map(r => r.url);
    res.json({
      success: true,
      data: {
        results,
        bad,
        blocked,
        removed: bad.length
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message || 'Validate failed' });
  }
});

/**
 * Same-origin media proxy for website + Android / Fire Stick WebView.
 * Must forward Range correctly so pause/seek/scrub work on progressive MP4.
 */
router.get('/proxy', async (req, res) => {
  try {
    if (!(await requireAdFree(req, res))) return;
    const target = String(req.query.u || req.query.url || '').trim();
    if (!target || !isAllowedProxyUrl(target)) {
      return res.status(400).json({ success: false, error: 'Invalid stream URL' });
    }

    const range = req.headers.range;
    const headers = {
      'User-Agent': ua(),
      Accept: '*/*',
      ...(range ? { Range: range } : {})
    };

    const upstream = await axios.get(target, {
      headers,
      responseType: 'stream',
      timeout: 45000,
      maxRedirects: 8,
      validateStatus: () => true,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    const status = upstream.status;
    const finalUrl = String(upstream.request?.res?.responseUrl || upstream.request?.responseURL || target);
    const upCt = String(upstream.headers['content-type'] || '');
    const upCl = parseInt(String(upstream.headers['content-length'] || '0'), 10) || 0;
    const upCr = String(upstream.headers['content-range'] || '');
    const rangeTotal = (() => {
      const m = upCr.match(/\/(\d+)\s*$/);
      return m ? (parseInt(m[1], 10) || 0) : 0;
    })();
    // Only trust Content-Length as "whole file size" on a non-ranged 200 response.
    // Seek requests often return a small Content-Length for the byte slice — that is NOT a stub.
    const wholeFileBytes = rangeTotal || (!range && status === 200 ? upCl : 0);

    if (isFailedClipUrl(finalUrl) || isFailedClipUrl(target)) {
      try { upstream.data.destroy(); } catch {}
      return res.status(403).json({
        success: false,
        error: 'Debrid access blocked — check your debrid account or email approval',
        code: 'ACCOUNT_BLOCKED'
      });
    }
    // Orange AUTH_BLOCKED / copyright stub MP4s are tiny complete videos (never ranged seeks)
    if (
      !range &&
      wholeFileBytes > 0 &&
      wholeFileBytes < 12 * 1024 * 1024 &&
      /video|mp4|octet-stream/i.test(upCt) &&
      status >= 200 &&
      status < 400
    ) {
      try { upstream.data.destroy(); } catch {}
      return res.status(403).json({
        success: false,
        error: 'Debrid returned a blocked/error clip — try another source',
        code: 'ACCOUNT_BLOCKED'
      });
    }
    if (status === 401 || status === 403 || status === 451) {
      try { upstream.data.destroy(); } catch {}
      return res.status(status).json({ success: false, error: 'Upstream blocked', code: status });
    }
    if (status >= 400) {
      try { upstream.data.destroy(); } catch {}
      return res.status(502).json({ success: false, error: `Upstream HTTP ${status}` });
    }

    const pass = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'content-disposition'
    ];
    for (const k of pass) {
      const v = upstream.headers[k];
      if (v) res.setHeader(k, v);
    }
    if (!res.getHeader('content-type')) {
      res.setHeader('Content-Type', 'video/mp4');
    }
    // Browsers need this to enable the scrubber / rewind even when upstream omits it
    if (!res.getHeader('accept-ranges')) {
      res.setHeader('Accept-Ranges', 'bytes');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.status(status);
    upstream.data.on('error', () => {
      try { res.end(); } catch {}
    });
    req.on('close', () => {
      try { upstream.data.destroy(); } catch {}
    });
    upstream.data.pipe(res);
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({ success: false, error: e.message || 'Proxy failed' });
    } else {
      try { res.end(); } catch {}
    }
  }
});

router.post('/streams', async (req, res) => {
  try {
    if (!(await requireEntitled(req, res))) return;

    const personalRd = clientRdToken(req);
    const rdToken = personalRd || siteToken();
    const {
      imdbId, type, season, episode, tmdbId,
      title, year, adult, deep, exclude
    } = req.body || {};
    const deepLookup = deep === true || deep === 1 || deep === '1' || deep === 'true';
    const excludeKeys = new Set(
      (Array.isArray(exclude) ? exclude : [])
        .map(u => String(u || '').split('?')[0].toLowerCase())
        .filter(Boolean)
    );
    if (!anyPremiumConfigured(personalRd) && !rdToken) {
      return res.status(400).json({
        success: false,
        error: 'No debrid providers configured (set REALDEBRID_API_TOKEN or other premium keys)'
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

    console.log('Debrid multi:', {
      path,
      imdb,
      adult: isAdult,
      deep: deepLookup,
      title: metaTitle?.slice(0, 40),
      providers: debridsForLookup(personalRd, deepLookup).map(d => `${d.id}:${d.slot}`),
      mediafusion: !!mediaFusionConfig(),
      aiostreams: !!aioStreamsBase()
    });

    async function gatherStreams(deep) {
      let list = [];
      if (path) {
        list = await fetchAddonStreams(path, { deep, preferClientRd: personalRd });
      }
      const playableSoFar = list.filter(s => s.browserOk && s.cached).length;
      const needApibay = rdToken && (isAdult || !list.length || playableSoFar < 2 || deep);
      if (needApibay) {
        try {
          const extra = await fetchApibayRdStreams(rdToken, {
            imdb: imdb && imdb.startsWith('tt') ? imdb : '',
            title: metaTitle,
            year: metaYear,
            adult: isAdult
          });
          list = dedupeStreams(list.concat(extra));
        } catch (e) {
          console.warn('ApiBay RD:', e.message);
        }
      }
      if (excludeKeys.size) {
        list = list.filter(s => !excludeKeys.has(String(s.url || '').split('?')[0].toLowerCase()));
      }
      list = list.slice().sort((a, b) =>
        (qualityRank(b.quality) - qualityRank(a.quality)) ||
        ((b.browserOk ? 1 : 0) - (a.browserOk ? 1 : 0)) ||
        ((b.cached ? 1 : 0) - (a.cached ? 1 : 0)) ||
        ((a.hardCodec ? 1 : 0) - (b.hardCodec ? 1 : 0)) ||
        ((a.rdRisky ? 1 : 0) - (b.rdRisky ? 1 : 0)) ||
        ((b.browserScore || 0) - (a.browserScore || 0)) ||
        ((b.seeders || 0) - (a.seeders || 0))
      );
      list = balanceByProvider(list, { perProvider: deep ? 16 : 12, max: deep ? 60 : 48 });
      list = await validateTopStreams(list, {
        want: deep ? 16 : 12,
        probeLimit: deep ? 30 : 24,
        minValidated: deep ? 5 : 3,
        keepUnprobed: false,
        backupUnprobed: deep ? 16 : 10,
        deadlineMs: deep ? 16000 : 9000
      });
      list = list.slice().sort((a, b) =>
        ((b.validated ? 1 : 0) - (a.validated ? 1 : 0)) ||
        ((b.cached ? 1 : 0) - (a.cached ? 1 : 0)) ||
        (qualityRank(b.quality) - qualityRank(a.quality)) ||
        ((b.browserOk ? 1 : 0) - (a.browserOk ? 1 : 0)) ||
        ((a.hardCodec ? 1 : 0) - (b.hardCodec ? 1 : 0)) ||
        ((b.browserScore || 0) - (a.browserScore || 0))
      );
      return balanceByProvider(list, { perProvider: 12, max: 40 });
    }

    let streams = await gatherStreams(deepLookup);
    // First play empty (usually Torrentio 429) → automatically do what "Find more sources" does
    if (!streams.length && !deepLookup) {
      console.warn('Debrid first-pass empty — auto deep retry');
      await new Promise(r => setTimeout(r, 900));
      streams = await gatherStreams(true);
    }

    if (!streams.length && !imdb && !metaTitle) {
      return res.status(400).json({ success: false, error: 'IMDB id or title required for debrid streams' });
    }

    const validatedCount = streams.filter(s => s.validated).length;
    const providers = [...new Set(streams.map(s => s.provider).filter(Boolean))];
    console.log('Debrid result:', {
      imdb,
      total: streams.length,
      browserFriendly: streams.filter(s => s.browserOk).length,
      cached: streams.filter(s => s.cached).length,
      validated: validatedCount,
      providers,
      deep: deepLookup || (!streams.length ? false : undefined)
    });

    if (!streams.length) {
      return res.json({
        success: false,
        error: 'No playable premium streams found. Debrid may be blocked — check account/email, or try Find more sources.',
        code: 'NO_PLAYABLE_STREAMS',
        data: {
          imdbId: imdb || null,
          streams: [],
          validated: 0,
          providers,
          adult: isAdult,
          deep: deepLookup
        }
      });
    }

    res.json({
      success: true,
      data: {
        imdbId: imdb || null,
        streams,
        totalSources: streams.length,
        browserFriendly: streams.filter(s => s.browserOk).length,
        cached: streams.filter(s => s.cached).length,
        validated: validatedCount,
        providers,
        provider: providers.join('+') || 'none',
        adult: isAdult,
        deep: deepLookup
      }
    });
  } catch (e) {
    console.error('Debrid streams error:', e.message);
    res.status(500).json({ success: false, error: e.message || 'Debrid lookup failed' });
  }
});

module.exports = router;
module.exports.probeStreamUrl = probeStreamUrl;
module.exports.isFailedClipUrl = isFailedClipUrl;
module.exports.isAccountErrorText = isAccountErrorText;
module.exports.balanceByProvider = balanceByProvider;
module.exports.providerFamily = providerFamily;
module.exports.quarantineProviders = quarantineProviders;
module.exports.validateTopStreams = validateTopStreams;
module.exports.configuredDebrids = configuredDebrids;
module.exports.debridsForLookup = debridsForLookup;
