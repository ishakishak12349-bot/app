'use strict';
const router = require('express').Router();
const sanitizeHtml = require('sanitize-html');
const { q, tx, recalcRating } = require('../db');
const { requireAdmin, logActivity } = require('../middleware/auth');

router.use(requireAdmin);

const PLATFORMS = ['android', 'ios', 'windows', 'mac', 'linux', 'web'];
const STATUSES = ['draft', 'scheduled', 'published', 'hidden'];
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^\w؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'app';
const cleanHtml = (h) => sanitizeHtml(String(h || ''), {
  allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
});
const isUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u) && u.length < 1000;

// ---------- stats ----------
router.get('/stats', async (_req, res) => {
  const days = 14;
  const [tot, dl, vis, topApps, recent, ratingDist] = await Promise.all([
    q(`SELECT
        (SELECT COUNT(*)::int FROM apps) AS apps,
        (SELECT COUNT(*)::int FROM apps WHERE status='published') AS published,
        (SELECT COUNT(*)::int FROM downloads) AS downloads,
        (SELECT COUNT(*)::int FROM visits) AS visits,
        (SELECT COUNT(*)::int FROM reviews WHERE status='approved') AS reviews,
        (SELECT COUNT(*)::int FROM reviews WHERE status='pending') AS pending_reviews,
        (SELECT COALESCE(ROUND(AVG(rating)::numeric,2),0) FROM reviews WHERE status='approved') AS avg_rating`),
    q(`SELECT to_char(d::date,'MM-DD') AS day, COALESCE(c.n,0)::int AS n
       FROM generate_series(CURRENT_DATE - ${days - 1}, CURRENT_DATE, '1 day') d
       LEFT JOIN (SELECT created_at::date AS dd, COUNT(*) n FROM downloads GROUP BY 1) c ON c.dd = d::date ORDER BY d`),
    q(`SELECT to_char(d::date,'MM-DD') AS day, COALESCE(c.n,0)::int AS n
       FROM generate_series(CURRENT_DATE - ${days - 1}, CURRENT_DATE, '1 day') d
       LEFT JOIN (SELECT created_at::date AS dd, COUNT(*) n FROM visits GROUP BY 1) c ON c.dd = d::date ORDER BY d`),
    q(`SELECT name, download_count FROM apps ORDER BY download_count DESC LIMIT 5`),
    q(`SELECT l.action, l.entity, l.details, l.created_at FROM activity_logs l ORDER BY l.created_at DESC LIMIT 8`),
    q(`SELECT rating, COUNT(*)::int n FROM reviews WHERE status='approved' GROUP BY rating ORDER BY rating`),
  ]);
  res.json({ totals: tot.rows[0], downloadsByDay: dl.rows, visitsByDay: vis.rows, topApps: topApps.rows, recent: recent.rows, ratingDist: ratingDist.rows });
});

// ---------- apps ----------
router.get('/apps', async (_req, res) => {
  const { rows } = await q(`SELECT a.id, a.slug, a.name, a.icon_url, a.status, a.is_featured, a.current_version, a.size_bytes,
      a.download_count, a.rating_avg, a.rating_count, a.publish_at, a.updated_at, c.name_ar AS category_name
    FROM apps a LEFT JOIN categories c ON c.id=a.category_id ORDER BY a.updated_at DESC`);
  res.json(rows);
});

router.get('/apps/:id', async (req, res) => {
  const { rows } = await q('SELECT * FROM apps WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const [media, versions] = await Promise.all([
    q('SELECT id, kind, url, sort_order FROM media WHERE app_id=$1 ORDER BY kind, sort_order', [req.params.id]),
    q('SELECT * FROM app_versions WHERE app_id=$1 ORDER BY created_at DESC', [req.params.id]),
  ]);
  res.json({ ...rows[0], media: media.rows, versions: versions.rows });
});

function validateApp(b, partial = false) {
  const err = [];
  if (!partial || b.name !== undefined) if (!b.name || String(b.name).length > 80) err.push('الاسم مطلوب (80 حرفاً كحد أقصى)');
  if (b.platforms !== undefined && (!Array.isArray(b.platforms) || !b.platforms.length || b.platforms.some((p) => !PLATFORMS.includes(p)))) err.push('أنظمة التشغيل غير صحيحة');
  if (b.status !== undefined && !STATUSES.includes(b.status)) err.push('حالة غير صحيحة');
  if (b.status === 'scheduled' && (!b.publish_at || isNaN(new Date(b.publish_at)))) err.push('حدد تاريخ النشر المجدول');
  for (const k of ['icon_url', 'video_url']) if (b[k] && !isUrl(b[k])) err.push(`رابط غير صالح: ${k}`);
  if (b.screenshots !== undefined) {
    if (!Array.isArray(b.screenshots) || b.screenshots.length > 8) err.push('الصور: 8 كحد أقصى');
    else if (b.screenshots.some((u) => !isUrl(u))) err.push('رابط صورة غير صالح');
  }
  if (b.files !== undefined) {
    if (!Array.isArray(b.files)) err.push('files غير صالحة');
    else for (const f of b.files) if (!PLATFORMS.includes(f.platform) || !isUrl(f.file_url)) err.push('ملف التطبيق: النظام أو الرابط غير صالح');
  }
  return err;
}

router.post('/apps', async (req, res) => {
  const b = req.body || {};
  const errs = validateApp(b);
  if (errs.length) return res.status(400).json({ error: errs.join(' • ') });
  const status = b.status || 'draft';
  const out = await tx(async (c) => {
    let slug = slugify(b.slug || b.name);
    const exists = await c.query('SELECT 1 FROM apps WHERE slug=$1', [slug]);
    if (exists.rowCount) slug += '-' + Math.random().toString(36).slice(2, 6);
    const ins = await c.query(
      `INSERT INTO apps (slug,name,short_desc,description,category_id,platforms,current_version,size_bytes,icon_url,video_url,status,is_featured,publish_at,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, slug`,
      [slug, String(b.name).trim(), String(b.short_desc || '').slice(0, 160), cleanHtml(b.description), b.category_id || null,
        b.platforms || ['android'], String(b.current_version || '1.0.0').slice(0, 20), Math.max(0, Number(b.size_bytes) || 0),
        b.icon_url || null, b.video_url || null, status, !!b.is_featured,
        status === 'scheduled' ? new Date(b.publish_at) : null, status === 'published' ? new Date() : null]);
    const id = ins.rows[0].id;
    for (const [i, u] of (b.screenshots || []).entries()) await c.query('INSERT INTO media (app_id,kind,url,sort_order) VALUES ($1,$2,$3,$4)', [id, 'screenshot', u, i]);
    for (const f of b.files || []) {
      await c.query(`INSERT INTO app_versions (app_id,version,platform,file_url,file_id,size_bytes,changelog) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (app_id,version,platform) DO UPDATE SET file_url=EXCLUDED.file_url, size_bytes=EXCLUDED.size_bytes`,
        [id, f.version || b.current_version || '1.0.0', f.platform, f.file_url, f.file_id || null, Number(f.size_bytes) || 0, String(f.changelog || '').slice(0, 2000)]);
    }
    return ins.rows[0];
  });
  await logActivity(req, 'app_created', 'app', out.id, { name: b.name, status });
  res.status(201).json(out);
});

router.put('/apps/:id', async (req, res) => {
  const b = req.body || {};
  const errs = validateApp(b, true);
  if (errs.length) return res.status(400).json({ error: errs.join(' • ') });
  const cur = (await q('SELECT * FROM apps WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'not found' });
  const status = b.status ?? cur.status;
  await tx(async (c) => {
    await c.query(
      `UPDATE apps SET name=$2, short_desc=$3, description=$4, category_id=$5, platforms=$6, current_version=$7, size_bytes=$8,
         icon_url=$9, video_url=$10, status=$11, is_featured=$12, publish_at=$13,
         published_at = CASE WHEN $11='published' AND published_at IS NULL THEN now() ELSE published_at END, updated_at=now()
       WHERE id=$1`,
      [cur.id, b.name ?? cur.name, b.short_desc !== undefined ? String(b.short_desc).slice(0, 160) : cur.short_desc,
        b.description !== undefined ? cleanHtml(b.description) : cur.description, b.category_id !== undefined ? b.category_id || null : cur.category_id,
        b.platforms ?? cur.platforms, b.current_version ?? cur.current_version, b.size_bytes !== undefined ? Math.max(0, Number(b.size_bytes) || 0) : cur.size_bytes,
        b.icon_url !== undefined ? b.icon_url || null : cur.icon_url, b.video_url !== undefined ? b.video_url || null : cur.video_url,
        status, b.is_featured ?? cur.is_featured, status === 'scheduled' ? new Date(b.publish_at || cur.publish_at) : null]);
    if (b.screenshots) {
      await c.query(`DELETE FROM media WHERE app_id=$1 AND kind='screenshot'`, [cur.id]);
      for (const [i, u] of b.screenshots.entries()) await c.query('INSERT INTO media (app_id,kind,url,sort_order) VALUES ($1,$2,$3,$4)', [cur.id, 'screenshot', u, i]);
    }
    for (const f of b.files || []) {
      await c.query(`INSERT INTO app_versions (app_id,version,platform,file_url,file_id,size_bytes,changelog) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (app_id,version,platform) DO UPDATE SET file_url=EXCLUDED.file_url, file_id=EXCLUDED.file_id, size_bytes=EXCLUDED.size_bytes, changelog=EXCLUDED.changelog`,
        [cur.id, f.version || b.current_version || cur.current_version, f.platform, f.file_url, f.file_id || null, Number(f.size_bytes) || 0, String(f.changelog || '').slice(0, 2000)]);
    }
  });
  await logActivity(req, 'app_updated', 'app', cur.id, { name: b.name ?? cur.name });
  res.json({ ok: true });
});

router.patch('/apps/:id/flags', async (req, res) => {
  const { is_featured, status } = req.body || {};
  if (status !== undefined && !['published', 'hidden', 'draft'].includes(status)) return res.status(400).json({ error: 'bad status' });
  const r = await q(`UPDATE apps SET is_featured=COALESCE($2,is_featured), status=COALESCE($3,status),
      published_at = CASE WHEN $3='published' AND published_at IS NULL THEN now() ELSE published_at END, updated_at=now()
    WHERE id=$1 RETURNING name`, [req.params.id, typeof is_featured === 'boolean' ? is_featured : null, status || null]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  await logActivity(req, 'app_flags', 'app', req.params.id, { is_featured, status, name: r.rows[0].name });
  res.json({ ok: true });
});

router.delete('/apps/:id', async (req, res) => {
  const r = await q('DELETE FROM apps WHERE id=$1 RETURNING name', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  await logActivity(req, 'app_deleted', 'app', req.params.id, { name: r.rows[0].name });
  res.json({ ok: true });
});

// ---------- reviews ----------
router.get('/reviews', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await q(`SELECT r.*, a.name AS app_name FROM reviews r JOIN apps a ON a.id=r.app_id
    WHERE ($1::review_status IS NULL OR r.status=$1) ORDER BY r.created_at DESC LIMIT 200`, [status]);
  res.json(rows);
});

router.patch('/reviews/:id', async (req, res) => {
  const { status, admin_reply } = req.body || {};
  if (status !== undefined && !['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'bad status' });
  const r = await q(`UPDATE reviews SET status=COALESCE($2,status), admin_reply=CASE WHEN $3::text IS NULL THEN admin_reply ELSE NULLIF($3,'') END
    WHERE id=$1 RETURNING app_id`, [req.params.id, status || null, admin_reply === undefined ? null : String(admin_reply).slice(0, 1000)]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  await recalcRating(r.rows[0].app_id);
  await logActivity(req, 'review_' + (status || 'reply'), 'review', req.params.id);
  res.json({ ok: true });
});

router.delete('/reviews/:id', async (req, res) => {
  const r = await q('DELETE FROM reviews WHERE id=$1 RETURNING app_id', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  await recalcRating(r.rows[0].app_id);
  await logActivity(req, 'review_deleted', 'review', req.params.id);
  res.json({ ok: true });
});

// ---------- categories ----------
router.get('/categories', async (_req, res) => {
  const { rows } = await q(`SELECT c.*, COUNT(a.id)::int AS apps FROM categories c LEFT JOIN apps a ON a.category_id=c.id GROUP BY c.id ORDER BY c.sort_order`);
  res.json(rows);
});
router.post('/categories', async (req, res) => {
  const { name_ar, name_en, icon, sort_order } = req.body || {};
  if (!name_ar || !name_en) return res.status(400).json({ error: 'الاسم بالعربية والإنجليزية مطلوب' });
  const slug = slugify(name_en);
  try {
    const r = await q('INSERT INTO categories (slug,name_ar,name_en,icon,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [slug, String(name_ar).slice(0, 40), String(name_en).slice(0, 40), String(icon || '📦').slice(0, 8), parseInt(sort_order, 10) || 0]);
    await logActivity(req, 'category_created', 'category', r.rows[0].id, { name: name_ar });
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(e.code === '23505' ? 409 : 500).json({ error: e.code === '23505' ? 'التصنيف موجود' : 'server error' }); }
});
router.put('/categories/:id', async (req, res) => {
  const { name_ar, name_en, icon, sort_order } = req.body || {};
  const r = await q(`UPDATE categories SET name_ar=COALESCE($2,name_ar), name_en=COALESCE($3,name_en), icon=COALESCE($4,icon), sort_order=COALESCE($5,sort_order) WHERE id=$1 RETURNING *`,
    [req.params.id, name_ar || null, name_en || null, icon || null, Number.isFinite(parseInt(sort_order, 10)) ? parseInt(sort_order, 10) : null]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  await logActivity(req, 'category_updated', 'category', req.params.id);
  res.json(r.rows[0]);
});
router.delete('/categories/:id', async (req, res) => {
  const r = await q('DELETE FROM categories WHERE id=$1 RETURNING name_ar', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  await logActivity(req, 'category_deleted', 'category', req.params.id, { name: r.rows[0].name_ar });
  res.json({ ok: true });
});

// ---------- users ----------
router.get('/users', async (_req, res) => {
  const { rows } = await q(`SELECT u.id, u.display_name, u.email, u.is_banned, u.created_at,
      (SELECT COUNT(*)::int FROM reviews r WHERE r.user_id=u.id) AS reviews,
      (SELECT COUNT(*)::int FROM downloads d WHERE d.user_id=u.id) AS downloads
    FROM users u ORDER BY u.created_at DESC LIMIT 300`);
  res.json(rows);
});
router.patch('/users/:id', async (req, res) => {
  const r = await q('UPDATE users SET is_banned=$2 WHERE id=$1 RETURNING display_name', [req.params.id, !!req.body?.is_banned]);
  if (!r.rowCount) return res.status(404).json({ error: 'not found' });
  await logActivity(req, req.body?.is_banned ? 'user_banned' : 'user_unbanned', 'user', req.params.id, { name: r.rows[0].display_name });
  res.json({ ok: true });
});

// ---------- activity + settings ----------
router.get('/activity', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
  const { rows } = await q(`SELECT l.id, l.action, l.entity, l.entity_id, l.details, l.ip, l.created_at, a.email AS admin_email
    FROM activity_logs l LEFT JOIN admins a ON a.id=l.admin_id ORDER BY l.created_at DESC LIMIT ${limit}`);
  res.json(rows);
});

router.put('/developer', async (req, res) => {
  const b = req.body || {};
  const value = { name: String(b.name || '').slice(0, 60), bio: String(b.bio || '').slice(0, 1000), email: String(b.email || '').slice(0, 120),
    links: Object.fromEntries(Object.entries(b.links || {}).filter(([, v]) => isUrl(v)).slice(0, 8)) };
  await q(`INSERT INTO settings (key,value) VALUES ('developer',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [value]);
  await logActivity(req, 'developer_updated', 'settings', 'developer');
  res.json(value);
});

module.exports = router;
