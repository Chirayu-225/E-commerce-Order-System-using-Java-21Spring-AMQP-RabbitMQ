#!/usr/bin/env node
// After a run: prove the books balance.  Exits non-zero if anything was oversold.
const path = require('path');
const fs = require('fs');
const { Client } = require(path.join(__dirname, '..', 'api', 'node_modules', 'pg'));
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));
const res = fs.existsSync(path.join(__dirname, 'result.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'result.json'), 'utf8')) : null;
const url = process.env.DATABASE_URL ?? 'postgres://flashcart:flashcart@127.0.0.1:5432/flashcart';
(async () => {
  const db = new Client({ connectionString: url });
  await db.connect();
  const sale = (await db.query(`SELECT quantity, claimed FROM flash_sales WHERE id = $1`, [fx.saleId])).rows[0];
  const orders = (await db.query(`SELECT count(*)::int n, COALESCE(sum(i.qty),0)::int units FROM orders o JOIN order_items i ON i.order_id = o.id WHERE i.flash_sale_id = $1 AND o.status = 'PENDING_PAYMENT'`, [fx.saleId])).rows[0];
  const inv = (await db.query(`SELECT on_hand, reserved, sold, initial_stock FROM inventory WHERE product_id = $1`, [fx.productId])).rows[0];
  const dupes = (await db.query(`SELECT count(*)::int n FROM (SELECT user_id FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.flash_sale_id=$1 GROUP BY user_id HAVING count(*)>1) x`, [fx.saleId])).rows[0].n;
  const checks = [
    ['orders for the sale <= units available', orders.units <= sale.quantity],
    ['orders created == units available (sale sold out)', orders.units === sale.quantity],
    ['sale.claimed == units in orders', sale.claimed === orders.units],
    ['inventory.reserved == units in orders', inv.reserved === orders.units],
    ['inventory conserved (on_hand + sold == initial)', inv.on_hand + inv.sold === inv.initial_stock],
    ['no user holds two orders (per-user limit)', dupes === 0],
    ...(res ? [['k6 201 count == orders in database', res.created === orders.n]] : []),
  ];
  let bad = 0;
  for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) bad++; }
  console.log(JSON.stringify({ sale, orders, inv }));
  await db.end();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
