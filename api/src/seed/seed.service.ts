import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AppConfig, CONFIG } from '../config/config';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { ENDED_SALE_SKU, FLASH_SKUS, PRODUCTS } from './products.data';

export const DEMO_USER = { email: 'demo@flashcart.dev', password: 'demo12345' };
export const DEMO_ADMIN = { email: 'admin@flashcart.dev', password: 'admin12345' };
const ADDRESS = { name: 'Demo Customer', phone: '9876543210', line1: '12, MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const NAMES = ['Aarav Mehta', 'Diya Nair', 'Kabir Rao', 'Ishita Das', 'Rohan Iyer', 'Meera Pillai', 'Vikram Shah', 'Ananya Roy'];
const LOCK_KEY = 7_426_001;
/** Discounted price rounded to a whole ...9 rupees (e.g. 5199), the way real deal prices look. */
const dealPrice = (minor: number, offPct: number) => Math.max(100, Math.round((minor * (100 - offPct)) / 100 / 1000) * 1000 - 100);

/** Seeds a believable shop on first start, and keeps at least one live and one upcoming flash sale for demos. */
@Injectable()
export class SeedService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Seed');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly cache: CacheService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.seedDemo) return;
    try {
      await this.seedIfEmpty();
      await this.ensureDemoSales();
      this.timer = setInterval(() => void this.ensureDemoSales().catch((e) => this.log.warn(e.message)), 60_000);
    } catch (e) {
      this.log.error(`seeding failed: ${(e as Error).message}`);
    }
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async seedIfEmpty(): Promise<boolean> {
    const hash = await bcrypt.hash(DEMO_USER.password, 10);
    const adminHash = await bcrypt.hash(DEMO_ADMIN.password, 10);
    const done = await this.db.tx(async (c) => {
      // One instance seeds; others wait here, then see a non-empty database.
      await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
      if ((await c.query('SELECT 1 FROM products LIMIT 1')).rowCount) return false;

      const users: string[] = [];
      await c.query(`INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, 'Flash Admin', 'ADMIN')`, [DEMO_ADMIN.email, adminHash]);
      const demo = await c.query(`INSERT INTO users (email, password_hash, name) VALUES ($1, $2, 'Demo Customer') RETURNING id`, [DEMO_USER.email, hash]);
      users.push(demo.rows[0].id);
      for (let i = 0; i < NAMES.length; i++) {
        const u = await c.query(`INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id`, [`customer${i + 1}@example.com`, hash, NAMES[i]]);
        users.push(u.rows[0].id);
      }

      const ids = new Map<string, { id: string; row: (typeof PRODUCTS)[number] }>();
      for (const p of PRODUCTS) {
        const r = await c.query(
          `INSERT INTO products (sku, name, brand, category, description, price_minor, mrp_minor, rating, rating_count, hue)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [p.sku, p.name, p.brand, p.category, p.description, p.price, p.mrp, p.rating, p.ratings, p.hue]);
        ids.set(p.sku, { id: r.rows[0].id, row: p });
      }

      // deterministic pseudo-random so every fresh database looks the same
      let seed = 42;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
      const sold = new Map<string, number>();
      const movements: Array<{ product: string; order: string; sale: string | null; qty: number }> = [];

      const placeOrder = async (n: number, userId: string, lines: Array<{ sku: string; qty: number; unit: number; saleId?: string }>, hoursAgo: number) => {
        const sub = lines.reduce((a, l) => a + l.qty * l.unit, 0);
        const ship = sub >= 49_900 ? 0 : 4_900;
        const o = await c.query(
          `INSERT INTO orders (user_id, status, subtotal_minor, shipping_minor, total_minor, shipping_address, idempotency_key, request_hash, expires_at, paid_at, created_at, updated_at)
           VALUES ($1,'DELIVERED',$2,$3,$4,$5::jsonb,$6,'seed', now() - ($7 * interval '1 hour') + interval '10 minutes', now() - ($7 * interval '1 hour') + interval '2 minutes',
                   now() - ($7 * interval '1 hour'), now() - ($7 * interval '1 hour') + interval '3 hours') RETURNING id`,
          [userId, sub, ship, sub + ship, JSON.stringify(ADDRESS), `seed-${n}`, hoursAgo]);
        const oid: string = o.rows[0].id;
        for (const l of lines) {
          const p = ids.get(l.sku)!;
          await c.query(
            `INSERT INTO order_items (order_id, product_id, flash_sale_id, name, category, hue, qty, unit_price_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [oid, p.id, l.saleId ?? null, p.row.name, p.row.category, p.row.hue, l.qty, l.unit]);
          sold.set(p.id, (sold.get(p.id) ?? 0) + l.qty);
          movements.push({ product: p.id, order: oid, sale: l.saleId ?? null, qty: l.qty });
        }
        await c.query(`INSERT INTO payments (order_id, provider_ref, status, amount_minor) VALUES ($1, $2, 'SUCCEEDED', $3)`, [oid, `pay_seed_${n}`, sub + ship]);
        const steps: Array<[string | null, string, string, number]> = [
          [null, 'PENDING_PAYMENT', 'Order placed', 0], ['PENDING_PAYMENT', 'PAID', 'Payment received', 2],
          ['PAID', 'PACKED', 'Order packed', 20], ['PACKED', 'SHIPPED', 'Order shipped', 60], ['SHIPPED', 'DELIVERED', 'Order delivered', 150]];
        for (const [f, t, note, mins] of steps) {
          await c.query(`INSERT INTO order_events (order_id, from_status, to_status, note, created_at) VALUES ($1,$2,$3,$4, now() - ($5 * interval '1 hour') + ($6 * interval '1 minute'))`, [oid, f, t, note, hoursAgo, mins]);
        }
      };

      // ended, sold-out flash sale: 12 units, six customers x 2
      const endedP = ids.get(ENDED_SALE_SKU)!;
      const endedPrice = dealPrice(endedP.row.price, 40);
      const sale = await c.query(
        `INSERT INTO flash_sales (product_id, sale_price_minor, quantity, claimed, per_user_limit, starts_at, ends_at)
         VALUES ($1,$2,12,12,2, now() - interval '23 hours', now() - interval '21 hours') RETURNING id`, [endedP.id, endedPrice]);
      const endedSaleId: string = sale.rows[0].id;
      let n = 0;
      for (let u = 0; u < 6; u++) {
        await placeOrder(++n, users[u + 1], [{ sku: ENDED_SALE_SKU, qty: 2, unit: endedPrice, saleId: endedSaleId }], 22 - u * 0.2);
        await c.query(`INSERT INTO sale_user_claims (sale_id, user_id, qty) VALUES ($1,$2,2)`, [endedSaleId, users[u + 1]]);
      }
      // ordinary history over the last two weeks
      const regular = PRODUCTS.filter((p) => p.sku !== ENDED_SALE_SKU && !FLASH_SKUS.includes(p.sku));
      for (let i = 0; i < 26; i++) {
        const lines = new Map<string, { sku: string; qty: number; unit: number }>();
        const k = 1 + Math.floor(rnd() * 3);
        for (let j = 0; j < k; j++) {
          const p = regular[Math.floor(rnd() * regular.length)];
          lines.set(p.sku, { sku: p.sku, qty: 1 + Math.floor(rnd() * 2), unit: p.price });
        }
        await placeOrder(++n, users[Math.floor(rnd() * users.length)], [...lines.values()], 26 + rnd() * 24 * 13);
      }

      for (const { id, row } of ids.values()) {
        const s = sold.get(id) ?? 0;
        await c.query(`INSERT INTO inventory (product_id, initial_stock, on_hand, reserved, sold) VALUES ($1,$2,$3,0,$4)`, [id, row.stock, row.stock - s, s]);
      }
      for (const m of movements) {
        await c.query(`INSERT INTO stock_movements (product_id, order_id, sale_id, reason, d_reserved) VALUES ($1,$2,$3,'RESERVE',$4)`, [m.product, m.order, m.sale, m.qty]);
        await c.query(`INSERT INTO stock_movements (product_id, order_id, sale_id, reason, d_on_hand, d_reserved, d_sold) VALUES ($1,$2,$3,'COMMIT',$4,$4,$5)`, [m.product, m.order, m.sale, -m.qty, m.qty]);
      }
      return true;
    });
    if (done) this.log.log(`seeded demo data: ${PRODUCTS.length} products, 2 users (${DEMO_USER.email} / ${DEMO_ADMIN.email})`);
    return done;
  }

  /** Keep the demo alive: whenever fewer than two sales are live-or-upcoming, schedule more. */
  async ensureDemoSales(): Promise<void> {
    const made = await this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY + 1]);
      const open = await c.query<{ live: boolean }>(`SELECT (starts_at <= now()) AS live FROM flash_sales WHERE ends_at > now()`);
      const hasLive = open.rows.some((r) => r.live);
      const hasUpcoming = open.rows.some((r) => !r.live);
      const want: Array<{ startsIn: number; minutes: number; qty: number; off: number; limit: number }> = [];
      if (!hasLive) want.push({ startsIn: 0, minutes: 180, qty: 100, off: 35, limit: 2 });
      if (!hasUpcoming) want.push({ startsIn: hasLive ? 15 * 60 : 20 * 60, minutes: 180, qty: 60, off: 40, limit: 1 });
      const created: string[] = [];
      for (const w of want) {
        // pick the flash product whose most recent sale is oldest and which has no overlapping sale
        const p = await c.query<{ id: string; price_minor: number; avail: number }>(
          `SELECT p.id, p.price_minor, i.on_hand - i.reserved AS avail
             FROM products p JOIN inventory i ON i.product_id = p.id
            WHERE p.sku = ANY($1) AND NOT EXISTS (SELECT 1 FROM flash_sales f WHERE f.product_id = p.id AND f.ends_at > now())
            ORDER BY (SELECT max(ends_at) FROM flash_sales f WHERE f.product_id = p.id) NULLS FIRST, p.sku LIMIT 1`, [FLASH_SKUS]);
        if (!p.rowCount) continue;
        if (p.rows[0].avail < w.qty) {
          const top = w.qty * 2;
          await c.query(`UPDATE inventory SET on_hand = on_hand + $2, initial_stock = initial_stock + $2 WHERE product_id = $1`, [p.rows[0].id, top]);
          await c.query(`INSERT INTO stock_movements (product_id, reason, d_on_hand) VALUES ($1,'RESTOCK',$2)`, [p.rows[0].id, top]);
        }
        const r = await c.query<{ id: string; q: number }>(
          `INSERT INTO flash_sales (product_id, sale_price_minor, quantity, per_user_limit, starts_at, ends_at)
           VALUES ($1,$2,$3,$4, now() + ($5 * interval '1 second'), now() + ($5 * interval '1 second') + ($6 * interval '1 minute')) RETURNING id, quantity AS q`,
          [p.rows[0].id, dealPrice(p.rows[0].price_minor, w.off), w.qty, w.limit, w.startsIn, w.minutes]);
        created.push(`${r.rows[0].id}:${r.rows[0].q}`);
      }
      return created;
    });
    for (const m of made) { const [id, q] = m.split(':'); await this.redis.gateSet(id, Number(q)).catch(() => undefined); }
    if (made.length) { await this.cache.invalidateAll(); this.log.log(`scheduled ${made.length} demo flash sale(s)`); }
  }
}
