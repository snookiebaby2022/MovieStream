'use strict';

const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'website');
const DOWNLOADS = path.join(WEB, 'downloads');
const STORE = process.env.APP_VERSIONS_FILE || path.join(__dirname, 'data', 'app-versions.json');

const DEFAULTS = {
  mobile: {
    packageId: 'xyz.snookiebaby.flixnova',
    versionCode: 3,
    versionName: '1.2.0',
    apkUrl: 'https://snookiebaby.xyz/downloads/FlixNova-android.apk',
    downloaderUrl: 'http://aftv.news/3777174',
    downloaderCode: '3777174',
    minVersionCode: 1,
    forceUpdate: false,
    notes: ''
  },
  tv: {
    packageId: 'xyz.snookiebaby.flixnova.tv',
    versionCode: 7,
    versionName: '1.0.6',
    apkUrl: 'https://snookiebaby.xyz/downloads/FlixNova-tv.apk',
    downloaderUrl: 'http://aftv.news/5381210',
    downloaderCode: '5381210',
    minVersionCode: 1,
    forceUpdate: false,
    notes: 'Catalog click fix + debrid failover + Next wraps sources'
  },
  updatedAt: null
};

const APK_FILES = {
  mobile: 'FlixNova-android.apk',
  tv: 'FlixNova-tv.apk'
};

function ensureStore() {
  const dir = path.dirname(STORE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DOWNLOADS)) fs.mkdirSync(DOWNLOADS, { recursive: true });
  if (!fs.existsSync(STORE)) {
    fs.writeFileSync(STORE, JSON.stringify(DEFAULTS, null, 2));
  }
}

function readRaw() {
  ensureStore();
  try {
    const raw = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    return {
      mobile: { ...DEFAULTS.mobile, ...(raw.mobile || {}) },
      tv: { ...DEFAULTS.tv, ...(raw.tv || {}) },
      updatedAt: raw.updatedAt || null
    };
  } catch {
    return { ...DEFAULTS, mobile: { ...DEFAULTS.mobile }, tv: { ...DEFAULTS.tv } };
  }
}

function writeRaw(data) {
  ensureStore();
  const out = {
    mobile: { ...DEFAULTS.mobile, ...(data.mobile || {}) },
    tv: { ...DEFAULTS.tv, ...(data.tv || {}) },
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(STORE, JSON.stringify(out, null, 2));
  return out;
}

function publicPayload(req) {
  const data = readRaw();
  const origin = (req && (req.get('x-forwarded-proto') || req.protocol) && req.get('host'))
    ? `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`
    : 'https://snookiebaby.xyz';

  const fixUrl = (u, file) => {
    if (u && /^https?:\/\//i.test(u)) return u;
    return `${origin}/downloads/${file}`;
  };

  const mobile = {
    ...data.mobile,
    apkUrl: fixUrl(data.mobile.apkUrl, APK_FILES.mobile)
  };
  const tv = {
    ...data.tv,
    apkUrl: fixUrl(data.tv.apkUrl, APK_FILES.tv)
  };

  return {
    success: true,
    platform: 'android',
    mobile,
    tv,
    versionCode: mobile.versionCode,
    versionName: mobile.versionName,
    minVersionCode: mobile.minVersionCode || 1,
    apkUrl: mobile.apkUrl,
    firetvApkUrl: tv.apkUrl,
    downloaderUrl: tv.downloaderUrl,
    downloaderCode: tv.downloaderCode,
    mobileDownloaderCode: mobile.downloaderCode,
    getAppUrl: `${origin}/get-app.html#firetv`,
    notes: data.mobile.notes || data.tv.notes ||
      `Phone Downloader: ${mobile.downloaderCode}. Fire Stick Downloader: ${tv.downloaderCode}.`,
    forceUpdate: !!(mobile.forceUpdate || tv.forceUpdate),
    updatedAt: data.updatedAt
  };
}

function patchMeta(body = {}) {
  const cur = readRaw();
  for (const target of ['mobile', 'tv']) {
    const src = body[target];
    if (!src || typeof src !== 'object') continue;
    const next = { ...cur[target] };
    if (src.versionCode != null) next.versionCode = Math.max(1, parseInt(src.versionCode, 10) || next.versionCode);
    if (src.versionName != null) next.versionName = String(src.versionName).trim() || next.versionName;
    if (src.apkUrl != null && String(src.apkUrl).trim()) next.apkUrl = String(src.apkUrl).trim();
    if (src.downloaderUrl != null) next.downloaderUrl = String(src.downloaderUrl).trim();
    if (src.downloaderCode != null) next.downloaderCode = String(src.downloaderCode).trim();
    if (src.minVersionCode != null) next.minVersionCode = Math.max(1, parseInt(src.minVersionCode, 10) || 1);
    if (typeof src.forceUpdate === 'boolean') next.forceUpdate = src.forceUpdate;
    if (src.notes != null) next.notes = String(src.notes);
    if (src.packageId != null && String(src.packageId).trim()) next.packageId = String(src.packageId).trim();
    cur[target] = next;
  }
  return writeRaw(cur);
}

function saveApkBuffer(target, buffer, meta = {}) {
  if (!APK_FILES[target]) throw new Error('target must be mobile or tv');
  if (!Buffer.isBuffer(buffer) || buffer.length < 1000) throw new Error('Invalid APK upload');
  ensureStore();
  const fileName = APK_FILES[target];
  const dest = path.join(DOWNLOADS, fileName);
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, dest);

  const cur = readRaw();
  const next = { ...cur[target] };
  if (meta.versionCode != null) next.versionCode = Math.max(1, parseInt(meta.versionCode, 10) || next.versionCode);
  if (meta.versionName) next.versionName = String(meta.versionName).trim();
  if (typeof meta.forceUpdate === 'boolean') next.forceUpdate = meta.forceUpdate;
  if (meta.notes != null) next.notes = String(meta.notes);
  if (meta.downloaderCode) next.downloaderCode = String(meta.downloaderCode).trim();
  if (meta.downloaderUrl) next.downloaderUrl = String(meta.downloaderUrl).trim();
  // Stable public URL + versioned copy for history
  next.apkUrl = `https://snookiebaby.xyz/downloads/${fileName}`;
  const verCopy = path.join(DOWNLOADS, fileName.replace(/\.apk$/i, `-${next.versionName}.apk`));
  try { fs.copyFileSync(dest, verCopy); } catch {}
  cur[target] = next;
  const saved = writeRaw(cur);
  return {
    target,
    fileName,
    bytes: buffer.length,
    version: saved[target]
  };
}

function apkPath(target) {
  return path.join(DOWNLOADS, APK_FILES[target] || '');
}

module.exports = {
  readRaw,
  publicPayload,
  patchMeta,
  saveApkBuffer,
  apkPath,
  APK_FILES,
  STORE
};
