'use strict';
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { q, recalcRating } = require('../db');

const STORE_URL = (process.env.PUBLIC_STORE_URL || 'http://localhost:8080').replace(/\/$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ipHash = (ip) => crypto.createHash('sha256').update(String(ip) + (process.env.JWT_SECRET || '')).digest('hex').slice(0, 32);
const PLATFORMS = ['android', 'ios', 'windows', 'mac', 'linux', 'web'];

const APP_COLS = `a.id, a.slug, a.name, a.short_desc, a.icon_url, a.platforms, a.current_version, a.size_bytes,
  a.download_count, a.rating_avg, a.rating_count, a.is_featured, a.created_at, a.updated_at, a.published_at,
  c.slug AS category_slug, c.name_ar AS category_name, c.icon AS category_icon`;

// شارات ذكية تُحسب من البيانات
function withBadges(row, topIds = new Set()) {
  const now = Date.now(), day = 86400000;
  const badges = [];
  if (row.published_at && now - new Date(row.published_at) < 14 * day) badges.push('new');
  if (row.is_featured) badges.push('featured');
  if (row.updated_at && row.published_at && new Date(row.updated_at) - new Date(row.published_at) > day && now - new Date(row.updated_at) < 14 * day) badges.push('updated');
  if (topIds.has(row.id)) badges.push('top');
  return { ...row, badges };
}

async function topIds() {
  const { rows } = await q(`SELECT id FROM apps WHERE status='published' AND download_count > 0 ORDER BY download_count DESC LIMIT 5`);
  return new Set(rows.map((r) => r.id));
}

const PUB = `a.status='published'`;

// ---------- home ----------
router.get('/home', async (_req, res) => {
  const top = await topIds();
  const run = (where, order, limit = 12) =>
    q(`SELECT ${APP_COLS} FROM apps a LEFT JOIN categories c ON c.id=a.category_id WHERE ${PUB} ${where} ORDER BY ${order} LIMIT ${limit}`);
  const [featured, popular, fresh, cats, totals] = await Promise.all([
    run('AND a.is_featured', 'a.published_at DESC', 6),
    run('', 'a.download_count DESC'),
    run('', 'a.published_at DESC'),
    q(`SELECT c.id, c.slug, c.name_ar, c.name_en, c.icon, COUNT(a.id)::int AS apps
       FROM categories c LEFT JOIN apps a ON a.category_id=c.id AND a.status='published'
       GROUP BY c.id ORDER BY c.sort_order`),
    q(`SELECT COUNT(*)::int AS apps, COALESCE(SUM(download_count),0)::bigint AS downloads FROM apps WHERE status='published'`),
  ]);
  const b = (r) => r.rows.map((x) => withBadges(x, top));
  res.json({ featured: b(featured), popular: b(popular), fresh: b(fresh), categories: cats.rows, totals: totals.rows[0] });
});

router.get('/categories', async (_req, res) => {
  const { rows } = await q(`SELECT c.id, c.slug, c.name_ar, c.name_en, c.icon, COUNT(a.id)::int AS apps
    FROM categories c LEFT JOIN apps a ON a.category_id=c.id AND a.status='published' GROUP BY c.id ORDER BY c.sort_order`);
  res.json(rows);
});

// ---------- search / list ----------
router.get('/apps', async (req, res) => {
  const { q: text, category, platform, minRating, maxSize, since, sort = 'new' } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 24, 60);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const where = [PUB], p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', `$${p.length}`)); };
  if (text) { p.push(`%${String(text).slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`); where.push(`(a.name ILIKE $${p.length} OR a.short_desc ILIKE $${p.length})`); }
  if (category) add('c.slug = ?', String(category));
  if (platform && PLATFORMS.includes(platform)) add('? = ANY(a.platforms)', platform);
  if (minRating) add('a.rating_avg >= ?', Number(minRating) || 0);
  if (maxSize) add('a.size_bytes <= ?', Math.floor(Number(maxSize) * 1048576) || 0);
  if (since) { const d = new Date(String(since)); if (!isNaN(d)) add('a.published_at >= ?', d.toISOString()); }
  const order = { new: 'a.published_at DESC', downloads: 'a.download_count DESC', rating: 'a.rating_avg DESC, a.rating_count DESC', name: 'a.name ASC', size: 'a.size_bytes ASC' }[sort] || 'a.published_at DESC';
  const sqlWhere = where.join(' AND ');
  const top = await topIds();
  const { rows } = await q(
    `SELECT ${APP_COLS}, COUNT(*) OVER()::int AS total FROM apps a LEFT JOIN categories c ON c.id=a.category_id
     WHERE ${sqlWhere} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, p);
  res.json({ total: rows[0]?.total || 0, items: rows.map(({ total, ...r }) => withBadges(r, top)) });
});

// ---------- app details ----------
router.get('/apps/:slug', async (req, res) => {
  const { rows } = await q(
    `SELECT a.*, c.slug AS category_slug, c.name_ar AS category_name, c.icon AS category_icon
     FROM apps a LEFT JOIN categories c ON c.id=a.category_id WHERE a.slug=$1 AND a.status='published'`, [req.params.slug]);
  const app = rows[0];
  if (!app) return res.status(404).json({ error: 'not found' });
  const [media, versions, reviews, dist, related] = await Promise.all([
    q(`SELECT kind, url FROM media WHERE app_id=$1 ORDER BY kind, sort_order`, [app.id]),
    q(`SELECT version, platform, size_bytes, changelog, created_at FROM app_versions WHERE app_id=$1 ORDER BY created_at DESC LIMIT 20`, [app.id]),
    q(`SELECT id, author_name, rating, comment, admin_reply, created_at FROM reviews WHERE app_id=$1 AND status='approved' ORDER BY created_at DESC LIMIT 50`, [app.id]),
    q(`SELECT rating, COUNT(*)::int AS n FROM reviews WHERE app_id=$1 AND status='approved' GROUP BY rating`, [app.id]),
    q(`SELECT ${APP_COLS} FROM apps a LEFT JOIN categories c ON c.id=a.category_id
       WHERE ${PUB} AND a.id<>$1 AND a.category_id IS NOT DISTINCT FROM $2 ORDER BY a.download_count DESC LIMIT 6`, [app.id, app.category_id]),
  ]);
  const top = await topIds();
  const { video_url, ...rest } = app;
  res.json({
    ...withBadges(rest, top), video_url,
    screenshots: media.rows.filter((m) => m.kind === 'screenshot').map((m) => m.url),
    versions: versions.rows, reviews: reviews.rows,
    distribution: [5, 4, 3, 2, 1].map((s) => ({ stars: s, count: dist.rows.find((d) => d.rating === s)?.n || 0 })),
    related: related.rows.map((x) => withBadges(x, top)),
  });
});

// ---------- download (counts + returns url) ----------
const dlLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
router.post('/apps/:slug/download', dlLimiter, async (req, res) => {
  const platform = PLATFORMS.includes(req.body?.platform) ? req.body.platform : null;
  const deviceId = String(req.body?.deviceId || '').slice(0, 64) || null;
  const { rows } = await q(`SELECT id FROM apps WHERE slug=$1 AND status='published'`, [req.params.slug]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const appId = rows[0].id;
  const v = (await q(
    `SELECT id, file_url, version, platform FROM app_versions WHERE app_id=$1
     ORDER BY (platform=$2) DESC NULLS LAST, created_at DESC LIMIT 1`, [appId, platform])).rows[0];
  if (!v) return res.status(404).json({ error: 'no file available' });
  if (platform && v.platform !== platform) return res.status(409).json({ error: 'no build for this platform', available: v.platform, url: v.file_url });
  await q('INSERT INTO downloads (app_id, version_id, device_id, platform, ip_hash) VALUES ($1,$2,$3,$4,$5)', [appId, v.id, deviceId, v.platform, ipHash(req.ip)]);
  await q('UPDATE apps SET download_count = download_count + 1 WHERE id=$1', [appId]);
  res.json({ url: v.file_url, version: v.version, platform: v.platform });
});

// سجل التحميلات لجهاز معيّن
router.get('/downloads/history', async (req, res) => {
  const deviceId = String(req.query.deviceId || '').slice(0, 64);
  if (!deviceId) return res.json([]);
  const { rows } = await q(
    `SELECT d.created_at, d.platform, a.slug, a.name, a.icon_url, v.version
     FROM downloads d JOIN apps a ON a.id=d.app_id LEFT JOIN app_versions v ON v.id=d.version_id
     WHERE d.device_id=$1 ORDER BY d.created_at DESC LIMIT 100`, [deviceId]);
  res.json(rows);
});

// ---------- reviews ----------
const reviewLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
router.post('/apps/:slug/reviews', reviewLimiter, async (req, res) => {
  const rating = parseInt(req.body?.rating, 10);
  if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'التقييم من 1 إلى 5' });
  const name = String(req.body?.name || 'زائر').trim().slice(0, 40) || 'زائر';
  const comment = String(req.body?.comment || '').trim().slice(0, 1000);
  const { rows } = await q(`SELECT id FROM apps WHERE slug=$1 AND status='published'`, [req.params.slug]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  // التقييم بدون تعليق يُعتمد مباشرة، والتعليق ينتظر موافقة المدير
  const status = comment ? 'pending' : 'approved';
  await q('INSERT INTO reviews (app_id, author_name, rating, comment, status) VALUES ($1,$2,$3,$4,$5)', [rows[0].id, name, rating, comment, status]);
  if (status === 'approved') await recalcRating(rows[0].id);
  res.status(201).json({ ok: true, status });
});

// ---------- developer / visits ----------
router.get('/developer', async (_req, res) => {
  const { rows } = await q(`SELECT value FROM settings WHERE key='developer'`);
  res.json(rows[0]?.value || {});
});

router.post('/visit', rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
  await q('INSERT INTO visits (path, device_id) VALUES ($1,$2)', [String(req.body?.path || '/').slice(0, 200), String(req.body?.deviceId || '').slice(0, 64) || null]);
  res.json({ ok: true });
});

// ---------- SEO ----------
// صفحة مشاركة: Open Graph لكل تطبيق ثم تحويل إلى المتجر
router.get('/share/:slug', async (req, res) => {
  const { rows } = await q(`SELECT slug, name, short_desc, icon_url FROM apps WHERE slug=$1 AND status='published'`, [req.params.slug]);
  const a = rows[0];
  if (!a) return res.redirect(STORE_URL);
  const url = `${STORE_URL}/#/app/${encodeURIComponent(a.slug)}`;
  res.type('html').send(`<!doctype html><html lang="ar"><head><meta charset="utf-8">
<title>${esc(a.name)} — Abdo-Sit</title>
<meta name="description" content="${esc(a.short_desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Abdo-Sit">
<meta property="og:title" content="${esc(a.name)}"><meta property="og:description" content="${esc(a.short_desc)}">
${a.icon_url ? `<meta property="og:image" content="${esc(a.icon_url)}">` : ''}<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary"><link rel="canonical" href="${esc(url)}">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: a.name, description: a.short_desc, image: a.icon_url || undefined, url }).replace(/</g, '\\u003c')}</script>
<meta http-equiv="refresh" content="0;url=${esc(url)}"></head><body><a href="${esc(url)}">${esc(a.name)}</a></body></html>`);
});

router.get('/sitemap.xml', async (_req, res) => {
  const { rows } = await q(`SELECT slug, updated_at FROM apps WHERE status='published' ORDER BY updated_at DESC`);
  const api = `${(process.env.PUBLIC_API_URL || '').replace(/\/$/, '')}/api/share/`;
  const urls = [`<url><loc>${esc(STORE_URL)}/</loc></url>`,
    ...rows.map((r) => `<url><loc>${esc(api + r.slug)}</loc><lastmod>${new Date(r.updated_at).toISOString()}</lastmod></url>`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
});

module.exports = router;
