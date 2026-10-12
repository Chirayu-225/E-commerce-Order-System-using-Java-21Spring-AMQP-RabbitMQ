import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig, CONFIG } from '../config/config';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { RabbitService } from '../mq/rabbit.service';
import { SalesService } from '../sales/sales.service';
import { RealtimeHub } from '../events/realtime.hub';
import { notFound, parse } from '../common/errors';

export interface Check { name: string; ok: boolean; detail: string }
const restockSchema = z.object({ qty: z.number().int().min(1).max(100_000) });

@Injectable()
export class AdminService {
  private readonly startedAt = Date.now();
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly cache: CacheService,
    private readonly rabbit: RabbitService,
    private readonly sales: SalesService,
    private readonly hub: RealtimeHub,
  ) {}

  async stats() {
    const [byStatus, money, users, today, sales] = await Promise.all([
      this.db.query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM orders GROUP BY status`),
      this.db.query<{ revenue: string; units: string }>(
        `SELECT COALESCE(sum(o.total_minor), 0)::text AS revenue,
                COALESCE((SELECT sum(i.qty) FROM order_items i JOIN orders o2 ON o2.id = i.order_id WHERE o2.status IN ('PAID','PACKED','SHIPPED','DELIVERED')), 0)::text AS units
           FROM orders o WHERE o.status IN ('PAID','PACKED','SHIPPED','DELIVERED')`),
      this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`),
      this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM orders WHERE created_at > now() - interval '24 hours'`),
      this.sales.list(),
    ]);
    return {
      ordersByStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
      revenueMinor: Number(money.rows[0].revenue),
      unitsSold: Number(money.rows[0].units),
      customers: users.rows[0].n,
      ordersLast24h: today.rows[0].n,
      sales: sales.map((s) => ({ id: s.id, name: s.product.name, status: s.status, quantity: s.quantity, remaining: s.remaining, startsAt: s.startsAt, endsAt: s.endsAt, salePriceMinor: s.salePriceMinor })),
    };
  }

  /** Re-derive every invariant from raw rows.  Each check should return zero offenders. */
  async integrity(): Promise<{ ok: boolean; checkedAt: string; checks: Check[] }> {
    const q = async (name: string, sql: string, okMsg: string, badMsg: (n: number) => string): Promise<Check> => {
      const r = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`);
      const n = r.rows[0].n;
      return { name, ok: n === 0, detail: n === 0 ? okMsg : badMsg(n) };
    };
    const COMMITTED = `('PAID','PACKED','SHIPPED','DELIVERED')`;
    const checks: Check[] = await Promise.all([
      q('Unit conservation', `SELECT 1 FROM inventory WHERE on_hand + sold <> initial_stock OR on_hand < 0 OR reserved < 0 OR reserved > on_hand`,
        'on_hand + sold = initial stock for every product; nothing negative', (n) => `${n} product(s) violate conservation`),
      q('Ledger matches inventory', `
        SELECT i.product_id FROM inventory i
          LEFT JOIN (SELECT product_id, sum(d_on_hand) oh, sum(d_reserved) rs, sum(d_sold) sd,
                            sum(d_on_hand) FILTER (WHERE reason = 'RESTOCK') rst FROM stock_movements GROUP BY product_id) m ON m.product_id = i.product_id
         WHERE i.on_hand  <> (i.initial_stock - COALESCE(m.rst, 0)) + COALESCE(m.oh, 0)
            OR i.reserved <> COALESCE(m.rs, 0)
            OR i.sold     <> COALESCE(m.sd, 0)`,
        'Inventory equals the sum of the append-only stock ledger', (n) => `${n} product(s) differ from the ledger`),
      q('Reserved = open orders', `
        SELECT i.product_id FROM inventory i
          LEFT JOIN (SELECT it.product_id, sum(it.qty) q FROM order_items it JOIN orders o ON o.id = it.order_id WHERE o.status = 'PENDING_PAYMENT' GROUP BY it.product_id) t ON t.product_id = i.product_id
         WHERE i.reserved <> COALESCE(t.q, 0)`,
        'Reserved units equal units held by unpaid orders', (n) => `${n} product(s) have orphaned or missing reservations`),
      q('Sold = paid orders', `
        SELECT i.product_id FROM inventory i
          LEFT JOIN (SELECT it.product_id, sum(it.qty) q FROM order_items it JOIN orders o ON o.id = it.order_id WHERE o.status IN ${COMMITTED} GROUP BY it.product_id) t ON t.product_id = i.product_id
         WHERE i.sold <> COALESCE(t.q, 0)`,
        'Sold units equal units in paid orders', (n) => `${n} product(s) have sold units that do not match paid orders`),
      q('Sales never oversold', `SELECT s.id FROM flash_sales s WHERE s.claimed > s.quantity`,
        'No flash sale has claimed more than its allocation', (n) => `${n} sale(s) oversold`),
      q('Sale claims = order lines', `
        SELECT s.id FROM flash_sales s
          LEFT JOIN (SELECT it.flash_sale_id id, sum(it.qty) q FROM order_items it JOIN orders o ON o.id = it.order_id
                      WHERE o.status = 'PENDING_PAYMENT' OR o.status IN ${COMMITTED} GROUP BY it.flash_sale_id) t ON t.id = s.id
         WHERE s.claimed <> COALESCE(t.q, 0)`,
        'Each sale\'s claimed counter equals the units in live orders', (n) => `${n} sale(s) have a claimed counter that disagrees with orders`),
      q('Per-user limits respected', `
        SELECT c.sale_id FROM sale_user_claims c JOIN flash_sales s ON s.id = c.sale_id WHERE c.qty > s.per_user_limit`,
        'No customer holds more than the per-user limit', (n) => `${n} claim(s) exceed the limit`),
      q('Paid orders have a payment', `
        SELECT o.id FROM orders o WHERE o.status IN ${COMMITTED}
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'SUCCEEDED')`,
        'Every paid order has a succeeded payment', (n) => `${n} paid order(s) without a succeeded payment`),
      q('No stuck unpaid orders', `SELECT id FROM orders WHERE status = 'PENDING_PAYMENT' AND expires_at < now() - interval '90 seconds'`,
        'Nothing is held past its payment deadline', (n) => `${n} order(s) overdue for expiry`),
      q('Outbox is draining', `SELECT id FROM outbox WHERE published_at IS NULL AND created_at < now() - interval '30 seconds'`,
        'No domain event has waited more than 30s to be published', (n) => `${n} event(s) stuck in the outbox`),
    ]);

    // Redis gate vs Postgres (informational drift check; transient differences during traffic are normal)
    if (!this.cfg.gateEnabled) {
      checks.push({ name: 'Redis gate in sync', ok: true, detail: 'Redis gate disabled (Postgres-only mode)' });
    } else try {
      const rows = await this.db.query<{ id: string; remaining: number }>(`SELECT id, quantity - claimed AS remaining FROM flash_sales WHERE ends_at > now()`);
      const drift: string[] = [];
      for (const r of rows.rows) {
        const g = await this.redis.gateRemaining(r.id);
        if (g !== null && g !== r.remaining) drift.push(`${r.id.slice(0, 8)} redis=${g} db=${r.remaining}`);
      }
      checks.push({ name: 'Redis gate in sync', ok: drift.length === 0, detail: drift.length ? `Drift: ${drift.join('; ')} (use reconcile)` : 'Redis counters match Postgres for all live sales' });
    } catch {
      checks.push({ name: 'Redis gate in sync', ok: true, detail: 'Redis unavailable: running on Postgres alone' });
    }
    return { ok: checks.every((c) => c.ok), checkedAt: new Date().toISOString(), checks };
  }

  async system() {
    const [metrics, depths, outbox, dbRows] = await Promise.all([
      this.redis.metrics().catch(() => ({} as Record<string, number>)),
      this.rabbit.queueDepths().catch(() => []),
      this.db.query<{ pending: number; oldest: number | null }>(
        `SELECT count(*)::int AS pending, EXTRACT(EPOCH FROM now() - min(created_at))::float8 AS oldest FROM outbox WHERE published_at IS NULL`),
      this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM outbox`),
    ]);
    const hit = metrics.cache_hit ?? 0, miss = metrics.cache_miss ?? 0;
    return {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      redis: await this.redis.ping(),
      rabbit: this.rabbit.isReady,
      gateEnabled: this.cfg.gateEnabled,
      cache: { hit, miss, hitRatio: hit + miss ? Number((hit / (hit + miss)).toFixed(3)) : null },
      counters: metrics,
      queues: depths,
      outbox: { pending: outbox.rows[0].pending, oldestAgeSec: outbox.rows[0].oldest, total: dbRows.rows[0].n },
      db: { poolTotal: this.db.pool.totalCount, poolIdle: this.db.pool.idleCount, poolWaiting: this.db.pool.waitingCount },
      sseConnections: this.hub.connections,
    };
  }

  async products() {
    const r = await this.db.query(
      `SELECT p.id, p.sku, p.name, p.brand, p.category, p.price_minor AS "priceMinor", i.initial_stock AS "initialStock",
              i.on_hand AS "onHand", i.reserved, i.sold, i.on_hand - i.reserved AS available
         FROM products p JOIN inventory i ON i.product_id = p.id ORDER BY p.category, p.name`);
    return r.rows;
  }

  async restock(productId: string, body: unknown) {
    const { qty } = parse(restockSchema, body);
    await this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE inventory SET on_hand = on_hand + $2, initial_stock = initial_stock + $2, updated_at = now() WHERE product_id = $1 RETURNING product_id`, [productId, qty]);
      if (!r.rowCount) throw notFound('Product');
      await c.query(`INSERT INTO stock_movements (product_id, reason, d_on_hand) VALUES ($1, 'RESTOCK', $2)`, [productId, qty]);
    });
    await this.cache.invalidateAll();
    return (await this.products()).find((p) => p.id === productId);
  }

  async createSale(body: unknown) { return this.sales.create(body); }
  reconcile() {
    return this.sales.reconcileGates().then(async (r) => { await this.cache.invalidateAll(); return { reconciled: r }; });
  }
}
