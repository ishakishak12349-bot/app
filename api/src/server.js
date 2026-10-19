'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const { pool, q } = require('./db');

const PORT = parseInt(process.env.PORT || '3000', 10);
const origins = (process.env.CORS_ORIGINS || process.env.PUBLIC_STORE_URL || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('change_me')) {
  console.error('FATAL: set a strong JWT_SECRET (>=32 chars).'); process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(cors({ origin: origins.length ? origins : true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

// Express 4 لا يلتقط أخطاء async تلقائياً — نمرّرها يدوياً
const wrap = (router) => (req, res, next) => router(req, res, (e) => next(e));
function patchAsync(router) {
  for (const layer of router.stack) {
    if (layer.route) for (const l of layer.route.stack) {
      const h = l.handle;
      if (h.length <= 3) l.handle = (req, res, next) => Promise.resolve(h(req, res, next)).catch(next);
    }
  }
  return router;
}

app.get('/health', async (_req, res) => {
  try { await q('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});
app.use('/api/auth', patchAsync(require('./routes/auth')));
app.use('/api/admin', patchAsync(require('./routes/admin')));
app.use('/api', patchAsync(require('./routes/public')));

app.use((_req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad json' });
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

// إنشاء أول مدير تلقائياً + النشر المجدول
async function bootstrap() {
  const { rowCount } = await q('SELECT 1 FROM admins LIMIT 1');
  if (!rowCount) {
    const email = process.env.ADMIN_EMAIL, pass = process.env.ADMIN_PASSWORD;
    if (!email || !pass || pass.length < 10 || pass.startsWith('change_me')) {
      console.warn('⚠ No admin exists. Set ADMIN_EMAIL and a strong ADMIN_PASSWORD (>=10 chars) and restart.');
    } else {
      await q('INSERT INTO admins (email, password_hash) VALUES ($1,$2)', [email.toLowerCase(), await bcrypt.hash(pass, 12)]);
      console.log(`✔ Admin created: ${email}`);
    }
  }
  const publishDue = () => q(`UPDATE apps SET status='published', published_at=COALESCE(published_at, now()), updated_at=now()
    WHERE status='scheduled' AND publish_at <= now()`).catch((e) => console.error('scheduler', e.message));
  await publishDue();
  setInterval(publishDue, 60 * 1000).unref();
}

(async () => {
  for (let i = 0; i < 30; i++) {
    try { await q('SELECT 1'); break; } catch { if (i === 29) throw new Error('database unreachable'); await new Promise((r) => setTimeout(r, 2000)); }
  }
  await bootstrap();
  app.listen(PORT, () => console.log(`API on :${PORT}`));
})().catch((e) => { console.error(e); process.exit(1); });

process.on('SIGTERM', () => pool.end().then(() => process.exit(0)));
