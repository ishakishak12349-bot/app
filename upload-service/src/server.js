'use strict';
/**
 * Abdo-Sit Upload Service
 * - رفع مجزأ (chunked) مع استئناف
 * - حماية بمفتاح API (للرفع والإدارة فقط)
 * - تنزيل مباشر عام مع عداد ودعم Range
 * - QR Code لكل ملف
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '4000', 10);
const API_KEY = process.env.UPLOAD_API_KEY || '';
const MAX_BYTES = Math.floor(parseFloat(process.env.MAX_FILE_SIZE_GB || '2') * 1024 ** 3);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const CDN_BASE = (process.env.CDN_BASE_URL || '').replace(/\/$/, '');
const PUBLIC_URL = (process.env.PUBLIC_UPLOAD_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CHUNK_MAX = 16 * 1024 * 1024;

if (!API_KEY || API_KEY.length < 16 || API_KEY.startsWith('change_me')) {
  console.error('FATAL: set a strong UPLOAD_API_KEY (>=16 chars).');
  process.exit(1);
}
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'uploads.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, name TEXT, stored TEXT, mime TEXT, size INTEGER,
  downloads INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, name TEXT, mime TEXT, size INTEGER, received INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`);

const MIME = {
  '.apk': 'application/vnd.android.package-archive', '.exe': 'application/vnd.microsoft.portable-executable',
  '.zip': 'application/zip', '.dmg': 'application/x-apple-diskimage', '.ipa': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.msi': 'application/x-msi',
  '.deb': 'application/vnd.debian.binary-package', '.appimage': 'application/octet-stream',
};
const ALLOWED = new Set(Object.keys(MIME));
const INLINE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm']);

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors());

// ---------- auth ----------
function safeEq(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
const fails = new Map(); // ip -> {n, t}
function auth(req, res, next) {
  const ip = req.ip;
  const f = fails.get(ip);
  if (f && f.n >= 10 && Date.now() - f.t < 15 * 60 * 1000) return res.status(429).json({ error: 'too many attempts' });
  const key = req.get('x-api-key') || '';
  if (!safeEq(key, API_KEY)) {
    fails.set(ip, { n: (f && Date.now() - f.t < 15 * 60 * 1000 ? f.n : 0) + 1, t: Date.now() });
    return res.status(401).json({ error: 'invalid api key' });
  }
  fails.delete(ip);
  next();
}

const sanitizeName = (n) => path.basename(String(n)).replace(/[^\w.\-؀-ۿ ]+/g, '_').slice(0, 180) || 'file';
const urlFor = (id) => `${CDN_BASE || PUBLIC_URL}/f/${id}`;

// ---------- public ----------
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/', express.static(path.join(__dirname, '..', 'public')));

// ---------- chunked upload ----------
// 1) init
app.post('/api/upload/init', auth, express.json(), (req, res) => {
  const name = sanitizeName(req.body.name);
  const size = Number(req.body.size);
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED.has(ext)) return res.status(400).json({ error: `extension ${ext || '(none)'} not allowed` });
  if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: 'invalid size' });
  if (size > MAX_BYTES) return res.status(413).json({ error: 'file too large' });

  // resume: same name+size session already exists
  const key = crypto.createHash('sha1').update(`${name}:${size}`).digest('hex').slice(0, 24);
  let s = db.prepare('SELECT * FROM sessions WHERE id=?').get(key);
  const tmp = path.join(TMP_DIR, key);
  if (s && fs.existsSync(tmp)) {
    const real = fs.statSync(tmp).size;
    db.prepare('UPDATE sessions SET received=? WHERE id=?').run(real, key);
    return res.json({ uploadId: key, received: real, resumed: true });
  }
  db.prepare('INSERT OR REPLACE INTO sessions (id,name,mime,size,received) VALUES (?,?,?,?,0)')
    .run(key, name, MIME[ext], size);
  fs.writeFileSync(tmp, '');
  res.json({ uploadId: key, received: 0, resumed: false });
});

// 2) chunk (raw body, offset in query)
app.put('/api/upload/:id', auth, express.raw({ type: '*/*', limit: CHUNK_MAX }), (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'unknown upload' });
  const tmp = path.join(TMP_DIR, s.id);
  const offset = Number(req.query.offset);
  const current = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  if (offset !== current) return res.status(409).json({ error: 'offset mismatch', received: current });
  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'empty chunk' });
  if (current + body.length > s.size) return res.status(400).json({ error: 'chunk exceeds declared size' });
  fs.appendFileSync(tmp, body);
  const received = current + body.length;
  db.prepare('UPDATE sessions SET received=? WHERE id=?').run(received, s.id);
  res.json({ received });
});

// 3) complete
app.post('/api/upload/:id/complete', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'unknown upload' });
  const tmp = path.join(TMP_DIR, s.id);
  const real = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  if (real !== s.size) return res.status(409).json({ error: 'incomplete', received: real, size: s.size });
  const id = crypto.randomBytes(9).toString('base64url');
  const stored = `${id}${path.extname(s.name).toLowerCase()}`;
  fs.renameSync(tmp, path.join(FILES_DIR, stored));
  db.prepare('INSERT INTO files (id,name,stored,mime,size) VALUES (?,?,?,?,?)').run(id, s.name, stored, s.mime, s.size);
  db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);
  res.json({ id, name: s.name, size: s.size, url: urlFor(id), qr: `${PUBLIC_URL}/api/files/${id}/qr` });
});

// ---------- files ----------
app.get('/api/files', auth, (_req, res) => {
  const rows = db.prepare('SELECT id,name,mime,size,downloads,created_at FROM files ORDER BY created_at DESC LIMIT 500').all();
  res.json(rows.map((r) => ({ ...r, url: urlFor(r.id) })));
});

app.delete('/api/files/:id', auth, (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  fs.rmSync(path.join(FILES_DIR, f.stored), { force: true });
  db.prepare('DELETE FROM files WHERE id=?').run(f.id);
  res.json({ ok: true });
});

app.get('/api/files/:id/stats', (req, res) => {
  const f = db.prepare('SELECT id,name,size,downloads FROM files WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'not found' });
  res.json(f);
});

app.get('/api/files/:id/qr', async (req, res) => {
  const f = db.prepare('SELECT id FROM files WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).end();
  const png = await QRCode.toBuffer(urlFor(f.id), { width: 512, margin: 2, color: { dark: '#0b0f1f', light: '#ffffff' } });
  res.type('png').set('Cache-Control', 'public, max-age=86400').send(png);
});

// QR for any store page (e.g. app detail link): /api/qr?url=...
app.get('/api/qr', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\//i.test(url) || url.length > 500) return res.status(400).json({ error: 'invalid url' });
  const png = await QRCode.toBuffer(url, { width: 512, margin: 2 });
  res.type('png').set('Cache-Control', 'public, max-age=86400').send(png);
});

// ---------- public download (Range + counter) ----------
app.get('/f/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).send('Not found');
  const full = path.join(FILES_DIR, f.stored);
  if (!fs.existsSync(full)) return res.status(404).send('Not found');
  const ext = path.extname(f.stored).toLowerCase();
  const size = f.size;
  const range = req.headers.range;
  const asInline = INLINE.has(ext) && req.query.dl !== '1';
  res.set({
    'Content-Type': f.mime || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Disposition': `${asInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  });
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - parseInt(m[2], 10)); }
      else { start = parseInt(m[1], 10); if (m[2] !== '') end = Math.min(end, parseInt(m[2], 10)); }
      if (start > end || start >= size) { res.set('Content-Range', `bytes */${size}`); return res.status(416).end(); }
      status = 206;
      res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
  }
  res.set('Content-Length', end - start + 1);
  res.status(status);
  // count once per real download (first byte request, not inline media)
  if (start === 0 && !asInline && req.method === 'GET') {
    db.prepare('UPDATE files SET downloads = downloads + 1 WHERE id=?').run(f.id);
  }
  fs.createReadStream(full, { start, end }).on('error', () => res.destroy()).pipe(res);
});

// cleanup stale sessions (>3 days)
setInterval(() => {
  const old = db.prepare("SELECT id FROM sessions WHERE created_at < datetime('now','-3 days')").all();
  for (const s of old) {
    fs.rmSync(path.join(TMP_DIR, s.id), { force: true });
    db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);
  }
}, 6 * 3600 * 1000).unref();

app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.type === 'entity.too.large' ? 'chunk too large' : 'server error' });
});

app.listen(PORT, () => console.log(`Upload service on :${PORT}`));
