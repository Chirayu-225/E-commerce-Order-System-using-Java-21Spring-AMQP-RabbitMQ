#!/usr/bin/env node
/**
 * Creates a dedicated product + flash sale and N users with ready-made JWTs, so the k6 run measures
 * the order pipeline and not bcrypt.  Output: loadtest/fixture.json
 *   node loadtest/prepare.js [users=2000] [saleUnits=100] [stock=...]
 * Env: DATABASE_URL, JWT_SECRET (must match the API under test).
 */
const path = require('path');
const fs = require('fs');
const api = path.join(__dirname, '..', 'api', 'node_modules');
const { Client } = require(path.join(api, 'pg'));
const jwt = require(path.join(api, 'jsonwebtoken'));

const users = Number(process.argv[2] ?? 2000);
const units = Number(process.argv[3] ?? 100);
const url = process.env.DATABASE_URL ?? 'postgres://flashcart:flashcart@127.0.0.1:5432/flashcart';
const secret = process.env.JWT_SECRET ?? 'dev-only-secret-change-me-before-deploying-32+';

(async () => {
  const db = new Client({ connectionString: url });
  await db.connect();
  const tag = Date.now().toString(36);
  const p = await db.query(
    `INSERT INTO products (sku, name, brand, category, description, price_minor, mrp_minor, hue)
     VALUES ($1, 'Load Test Phone X', 'LoadCo', 'Mobiles', 'Synthetic product for load testing', 1999900, 3999900, 210) RETURNING id`, [`LT-${tag}`]);
  const pid = p.rows[0].id;
  await db.query(`INSERT INTO inventory (product_id, initial_stock, on_hand) VALUES ($1, $2, $2)`, [pid, units * 2]);
  await db.query(`INSERT INTO stock_movements (product_id, reason, d_on_hand) VALUES ($1, 'RESTOCK', $2)`, [pid, units * 2]);
  const s = await db.query(
    `INSERT INTO flash_sales (product_id, sale_price_minor, quantity, per_user_limit, starts_at, ends_at)
     VALUES ($1, 999900, $2, 1, now() - interval '1 minute', now() + interval '2 hours') RETURNING id`, [pid, units]);
  const u = await db.query(
    `INSERT INTO users (email, password_hash, name)
     SELECT 'lt-' || $1 || '-' || g || '@load.test', 'x', 'Load User ' || g FROM generate_series(1, $2) g RETURNING id, email, name, role`, [tag, users]);
  const tokens = u.rows.map((r) => jwt.sign({ email: r.email, name: r.name, role: r.role }, secret, { subject: r.id, expiresIn: '2h' }));
  fs.writeFileSync(path.join(__dirname, 'fixture.json'), JSON.stringify({ productId: pid, saleId: s.rows[0].id, units, tokens }));
  console.log(`fixture: sale ${s.rows[0].id}, ${units} units, ${users} users`);
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
