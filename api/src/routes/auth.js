'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const { q } = require('../db');
const { signToken, requireAdmin, logActivity } = require('../middleware/auth');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const MAX_FAILS = 5;
const LOCK_MIN = 15;
authenticator.options = { window: 1 };

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, code } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'bad request' });

  const { rows } = await q('SELECT * FROM admins WHERE lower(email)=lower($1)', [email.trim()]);
  const a = rows[0];
  // نفس زمن الاستجابة تقريباً سواء وُجد الحساب أم لا
  const hash = a ? a.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = await bcrypt.compare(password, hash);

  if (a && a.locked_until && new Date(a.locked_until) > new Date())
    return res.status(423).json({ error: 'الحساب مقفل مؤقتاً، حاول لاحقاً' });

  if (!a || !ok) {
    if (a) {
      const fails = a.failed_logins + 1;
      await q('UPDATE admins SET failed_logins=$2, locked_until=$3 WHERE id=$1',
        [a.id, fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null]);
    }
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }

  if (a.totp_enabled) {
    if (!code) return res.json({ need2fa: true });
    if (!authenticator.check(String(code).replace(/\s/g, ''), a.totp_secret))
      return res.status(401).json({ error: 'رمز التحقق غير صحيح', need2fa: true });
  }

  await q('UPDATE admins SET failed_logins=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [a.id]);
  req.admin = { id: a.id };
  await logActivity(req, 'login', 'admin', a.id);
  res.json({ token: signToken(a), admin: { email: a.email, name: a.display_name, totp: a.totp_enabled } });
});

router.get('/me', requireAdmin, async (req, res) => {
  const { rows } = await q('SELECT email, display_name, totp_enabled FROM admins WHERE id=$1', [req.admin.id]);
  if (!rows[0]) return res.status(401).json({ error: 'unauthorized' });
  res.json({ email: rows[0].email, name: rows[0].display_name, totp: rows[0].totp_enabled });
});

// إعداد 2FA: يولّد سراً + QR
router.post('/2fa/setup', requireAdmin, async (req, res) => {
  const { rows } = await q('SELECT email, totp_enabled FROM admins WHERE id=$1', [req.admin.id]);
  if (rows[0].totp_enabled) return res.status(400).json({ error: '2FA مفعّل بالفعل' });
  const secret = authenticator.generateSecret();
  await q('UPDATE admins SET totp_secret=$2 WHERE id=$1', [req.admin.id, secret]);
  const otpauth = authenticator.keyuri(rows[0].email, 'Abdo-Sit', secret);
  res.json({ secret, otpauth, qr: await QRCode.toDataURL(otpauth) });
});

router.post('/2fa/enable', requireAdmin, async (req, res) => {
  const { rows } = await q('SELECT totp_secret FROM admins WHERE id=$1', [req.admin.id]);
  if (!rows[0]?.totp_secret) return res.status(400).json({ error: 'ابدأ الإعداد أولاً' });
  if (!authenticator.check(String(req.body?.code || '').replace(/\s/g, ''), rows[0].totp_secret))
    return res.status(400).json({ error: 'رمز غير صحيح' });
  await q('UPDATE admins SET totp_enabled=TRUE WHERE id=$1', [req.admin.id]);
  await logActivity(req, '2fa_enabled', 'admin', req.admin.id);
  res.json({ ok: true });
});

router.post('/password', requireAdmin, async (req, res) => {
  const { current, next } = req.body || {};
  if (typeof next !== 'string' || next.length < 10) return res.status(400).json({ error: 'كلمة المرور الجديدة قصيرة (10 أحرف على الأقل)' });
  const { rows } = await q('SELECT password_hash FROM admins WHERE id=$1', [req.admin.id]);
  if (!(await bcrypt.compare(String(current || ''), rows[0].password_hash))) return res.status(401).json({ error: 'كلمة المرور الحالية خاطئة' });
  await q('UPDATE admins SET password_hash=$2 WHERE id=$1', [req.admin.id, await bcrypt.hash(next, 12)]);
  await logActivity(req, 'password_changed', 'admin', req.admin.id);
  res.json({ ok: true });
});

module.exports = router;
