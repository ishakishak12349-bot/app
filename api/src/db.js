'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
  idleTimeoutMillis: 30000,
});

const q = (text, params) => pool.query(text, params);

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

async function recalcRating(appId, client = pool) {
  await client.query(
    `UPDATE apps SET
       rating_avg = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE app_id=$1 AND status='approved'), 0),
       rating_count = (SELECT COUNT(*) FROM reviews WHERE app_id=$1 AND status='approved')
     WHERE id=$1`, [appId]);
}

module.exports = { pool, q, tx, recalcRating };
