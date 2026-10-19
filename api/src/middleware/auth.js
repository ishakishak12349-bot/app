'use strict';
const jwt = require('jsonwebtoken');
const { q } = require('../db');

const SECRET = process.env.JWT_SECRET;

function signToken(admin) {
  return jwt.sign({ sub: admin.id, email: admin.email }, SECRET, { expiresIn: '8h', issuer: 'abdosit' });
}

function requireAdmin(req, res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const p = jwt.verify(token, SECRET, { issuer: 'abdosit' });
    req.admin = { id: p.sub, email: p.email };
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}

// تسجيل النشاط — يُستدعى من المسارات الإدارية
async function logActivity(req, action, entity, entityId, details = {}) {
  try {
    await q(
      'INSERT INTO activity_logs (admin_id, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.admin?.id || null, action, entity || null, entityId ? String(entityId) : null, details, req.ip]
    );
  } catch (e) { console.error('activity log failed', e.message); }
}

module.exports = { signToken, requireAdmin, logActivity };
