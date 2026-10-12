import { Inject, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { AppConfig, CONFIG } from '../config/config';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { OutboxService } from '../common/outbox.service';
import { SalesService } from '../sales/sales.service';
import { AuthUser } from '../common/auth';
import { ApiError, badRequest, conflict, forbidden, notFound, parse } from '../common/errors';
import { sha256, stableStringify } from '../common/util';
import { EV } from '../common/events';
import { OrderStatus, assertTransition } from './order-state';
import { Line, StockError, commitSale, releaseReserved, reserveStock, restockSold } from './inventory.ops';

export const FREE_SHIPPING_MINOR = 49_900;
export const SHIPPING_FEE_MINOR = 4_900;

const addressSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  line1: z.string().trim().min(5).max(200),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
});
const createSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    qty: z.number().int().min(1).max(10),
    saleId: z.string().uuid().nullish(),
  })).min(1).max(10),
  shippingAddress: addressSchema,
});

export interface OrderView {
  id: string; number: string; status: OrderStatus;
  subtotalMinor: number; shippingMinor: number; totalMinor: number;
  shippingAddress: unknown; expiresAt: string; paidAt: string | null; cancelReason: string | null;
  createdAt: string; updatedAt: string;
  items: Array<{ productId: string; flashSaleId: string | null; name: string; category: string; hue: number; qty: number; unitPriceMinor: number }>;
  payment: { id: string; status: string; providerRef: string; amountMinor: number; failureReason: string | null } | null;
  events?: Array<{ from: string | null; to: string; note: string | null; at: string }>;
  userId?: string;
}

const NEXT_EVENT: Record<string, string> = { PACKED: EV.ORDER_PACKED, SHIPPED: EV.ORDER_SHIPPED, DELIVERED: EV.ORDER_DELIVERED };
const PREV: Record<string, OrderStatus> = { PACKED: 'PAID', SHIPPED: 'PACKED', DELIVERED: 'SHIPPED' };

@Injectable()
export class OrdersService {
  private readonly log = new Logger('Orders');

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly cache: CacheService,
    private readonly outbox: OutboxService,
    private readonly sales: SalesService,
  ) {}

  // ---- realtime helpers ----------------------------------------------------------------------
  emitOrder(userId: string, orderId: string, status: string): void {
    void this.redis.publish(`user:${userId}`, { type: 'order', orderId, status }).catch(() => undefined);
  }
  async emitStock(saleId: string): Promise<void> {
    try {
      const remaining = await this.sales.getRemaining(saleId);
      await this.redis.publish(`sale:${saleId}`, { type: 'stock', saleId, remaining });
    } catch { /* realtime is best-effort */ }
  }
  private async releaseGates(userId: string, lines: Array<Pick<Line, 'saleId' | 'qty'>>): Promise<void> {
    for (const l of lines) {
      if (!l.saleId) continue;
      try { await this.redis.gateRelease(l.saleId, userId, l.qty); } catch { /* reconcile will repair drift */ }
      await this.emitStock(l.saleId);
    }
  }


  // ---- tiny read-through memo for pricing lookups -----------------------------------------------
  // Catalogue rows and sale definitions are immutable once created (no price-edit API), so a 2-second memo cannot
  // misprice an order, and during a stampede it removes two database round trips per request.  Postgres still
  // re-checks the sale window and stock authoritatively inside the order transaction.
  private memo = { products: new Map<string, { at: number; v: any }>(), sales: new Map<string, { at: number; v: any }>() };
  private static readonly MEMO_MS = 2000;

  private async memoLoad<T>(m: Map<string, { at: number; v: T }>, ids: string[], load: (missing: string[]) => Promise<Map<string, T>>): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const missing: string[] = [];
    const now = Date.now();
    for (const id of ids) {
      const hit = m.get(id);
      if (hit && now - hit.at < OrdersService.MEMO_MS) out.set(id, hit.v); else missing.push(id);
    }
    if (missing.length) {
      for (const [id, v] of await load(missing)) { m.set(id, { at: now, v }); out.set(id, v); }
      if (m.size > 5000) m.clear();
    }
    return out;
  }

  private productsById(ids: string[]) {
    return this.memoLoad(this.memo.products, ids, async (missing) => {
      const r = await this.db.query<{ id: string; name: string; category: string; hue: number; price_minor: number }>(
        `SELECT id, name, category, hue, price_minor FROM products WHERE id = ANY($1::uuid[]) AND is_active`, [missing]);
      return new Map(r.rows.map((p) => [p.id, p]));
    });
  }

  private salesById(ids: string[]) {
    return this.memoLoad(this.memo.sales, ids, async (missing) => {
      const r = await this.db.query<{ id: string; product_id: string; sale_price_minor: number; per_user_limit: number; starts_at: Date; ends_at: Date }>(
        `SELECT id, product_id, sale_price_minor, per_user_limit, starts_at, ends_at FROM flash_sales WHERE id = ANY($1::uuid[])`, [missing]);
      return new Map(r.rows.map((x) => [x.id, { productId: x.product_id, salePrice: x.sale_price_minor, perUserLimit: x.per_user_limit, startsAt: x.starts_at.getTime(), endsAt: x.ends_at.getTime() }]));
    });
  }

  // ---- create (checkout) ---------------------------------------------------------------------
  async create(user: AuthUser, idemKey: string | undefined, body: unknown): Promise<{ order: OrderView; replayed: boolean }> {
    if (!idemKey || idemKey.length < 8 || idemKey.length > 100) {
      throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (8-100 characters) so retries cannot create duplicate orders');
    }
    const input = parse(createSchema, body);

    // merge duplicate lines
    const merged = new Map<string, { productId: string; qty: number; saleId: string | null }>();
    for (const i of input.items) {
      const k = `${i.productId}:${i.saleId ?? ''}`;
      const cur = merged.get(k);
      if (cur) cur.qty += i.qty; else merged.set(k, { productId: i.productId, qty: i.qty, saleId: i.saleId ?? null });
    }
    const items = [...merged.values()];
    if (items.some((i) => i.qty > 10)) throw badRequest('QTY_TOO_HIGH', 'At most 10 units of one product per order');
    if (new Set(items.map((i) => i.productId)).size !== items.length) {
      throw badRequest('DUPLICATE_PRODUCT', 'A product cannot appear both with and without a sale price');
    }
    const requestHash = sha256(stableStringify({ items: [...items].sort((a, b) => (a.productId < b.productId ? -1 : 1)), a: input.shippingAddress }));

    const replay = await this.findByKey(user.id, idemKey, requestHash);
    if (replay) return { order: replay, replayed: true };

    // --- server-side pricing (the client's idea of the price is never trusted) ---
    const pmap = await this.productsById(items.map((i) => i.productId));
    const smap = await this.salesById([...new Set(items.map((i) => i.saleId).filter((x): x is string => !!x))]);
    const saleIds = [...smap.keys()];
    const nowMs = Date.now();

    const lines: Array<Line & { name: string; category: string; hue: number; unit: number }> = [];
    for (const i of items) {
      const p = pmap.get(i.productId);
      if (!p) throw notFound('Product');
      let unit = p.price_minor; let limit: number | undefined;
      if (i.saleId) {
        const s = smap.get(i.saleId);
        if (!s || s.productId !== i.productId) throw notFound('Flash sale');
        if (nowMs < s.startsAt) throw new ApiError(425, 'SALE_NOT_STARTED', 'This sale has not started yet');
        if (nowMs >= s.endsAt) throw conflict('SALE_ENDED', 'This sale has ended');
        unit = s.salePrice; limit = s.perUserLimit;
      }
      lines.push({ productId: i.productId, qty: i.qty, saleId: i.saleId, limit, name: p.name, category: p.category, hue: p.hue, unit });
    }
    const subtotal = lines.reduce((a, l) => a + l.unit * l.qty, 0);
    const shipping = subtotal >= FREE_SHIPPING_MINOR ? 0 : SHIPPING_FEE_MINOR;

    // --- layer 1: Redis gate (fast reject of the crowd that cannot win) ---
    const gated: Line[] = [];
    try {
      if (this.cfg.gateEnabled) {
        for (const l of [...lines].filter((x) => x.saleId).sort((a, b) => (a.productId < b.productId ? -1 : 1))) {
          let res = await this.gateTry(l, user.id);
          if (res === 'UNINIT') { await this.sales.ensureGate(l.saleId!); res = await this.gateTry(l, user.id); }
          if (res === 'OK') gated.push(l);
          else if (res === 'SOLD_OUT') throw conflict('SOLD_OUT', 'Sold out! This deal is gone.');
          else if (res === 'LIMIT') throw conflict('LIMIT_REACHED', `You have reached the purchase limit (${l.limit}) for this sale`);
          // 'SKIP' (Redis unavailable): fall through, Postgres alone is still correct
        }
      }

      // --- layer 2: Postgres (authoritative) ---
      const order = await this.db.tx(async (c, defer) => {
        const ins = await c.query<{ id: string }>(
          `INSERT INTO orders (user_id, status, subtotal_minor, shipping_minor, total_minor, shipping_address, idempotency_key, request_hash, expires_at)
           VALUES ($1, 'PENDING_PAYMENT', $2, $3, $4, $5::jsonb, $6, $7, now() + ($8 * interval '1 millisecond'))
           ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`,
          [user.id, subtotal, shipping, subtotal + shipping, JSON.stringify(input.shippingAddress), idemKey, requestHash, this.cfg.orderTtlMs]);
        if (!ins.rowCount) return null; // a concurrent request with the same key won
        const id = ins.rows[0].id;
        await c.query(
          `INSERT INTO order_items (order_id, product_id, flash_sale_id, name, category, hue, qty, unit_price_minor)
           SELECT $1, * FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::smallint[], $7::int[], $8::int[])`,
          [id, lines.map((l) => l.productId), lines.map((l) => l.saleId), lines.map((l) => l.name), lines.map((l) => l.category),
            lines.map((l) => l.hue), lines.map((l) => l.qty), lines.map((l) => l.unit)]);
        await reserveStock(c, id, user.id, lines); // hot rows last, to keep their locks short
        await c.query(`INSERT INTO order_events (order_id, from_status, to_status, note) VALUES ($1, NULL, 'PENDING_PAYMENT', 'Order placed')`, [id]);
        await this.outbox.add(c, EV.ORDER_CREATED, 'order', id, { orderId: id, userId: user.id, totalMinor: subtotal + shipping });
        defer(() => {
          this.emitOrder(user.id, id, 'PENDING_PAYMENT');
          for (const sid of saleIds) void this.emitStock(sid);
        });
        return id;
      });

      if (order === null) {
        await this.releaseGates(user.id, gated);
        const existing = await this.findByKey(user.id, idemKey, requestHash);
        if (!existing) throw conflict('IDEMPOTENCY_CONFLICT', 'A request with this key is still being processed');
        return { order: existing, replayed: true };
      }
      return { order: await this.getForUser(user.id, order), replayed: false };
    } catch (e) {
      await this.releaseGates(user.id, gated);
      if (e instanceof StockError) {
        this.redis.incr('stock_rejected');
        if (e.kind === 'OUT_OF_STOCK') throw conflict('OUT_OF_STOCK', 'Not enough stock for one of the items', { productId: e.line.productId });
        if (e.kind === 'LIMIT') throw conflict('LIMIT_REACHED', 'You have reached the purchase limit for this sale');
        throw conflict('SOLD_OUT', 'Sold out! This deal is gone.');
      }
      throw e;
    }
  }

  private async gateTry(l: Line, userId: string): Promise<'OK' | 'SOLD_OUT' | 'LIMIT' | 'UNINIT' | 'SKIP'> {
    try {
      const r = await this.redis.gateReserve(l.saleId!, userId, l.qty, l.limit ?? 1);
      if (r.ok) return 'OK';
      if (r.reason === 'SOLD_OUT') { this.redis.incr('gate_rejected'); return 'SOLD_OUT'; }
      return r.reason === 'LIMIT' ? 'LIMIT' : 'UNINIT';
    } catch {
      this.redis.incr('gate_bypassed');
      return 'SKIP';
    }
  }

  private async findByKey(userId: string, key: string, hash: string): Promise<OrderView | null> {
    const r = await this.db.query<{ id: string; request_hash: string }>(
      `SELECT id, request_hash FROM orders WHERE user_id = $1 AND idempotency_key = $2`, [userId, key]);
    if (!r.rowCount) return null;
    if (r.rows[0].request_hash !== hash) {
      throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request');
    }
    return this.getForUser(userId, r.rows[0].id);
  }

  // ---- reads ---------------------------------------------------------------------------------
  private async hydrate(ids: string[], withEvents: boolean): Promise<OrderView[]> {
    if (!ids.length) return [];
    const [o, items, pays, evs] = await Promise.all([
      this.db.query(`SELECT * FROM orders WHERE id = ANY($1::uuid[])`, [ids]),
      this.db.query(`SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY name`, [ids]),
      this.db.query(`SELECT DISTINCT ON (order_id) * FROM payments WHERE order_id = ANY($1::uuid[]) ORDER BY order_id, created_at DESC`, [ids]),
      withEvents ? this.db.query(`SELECT * FROM order_events WHERE order_id = ANY($1::uuid[]) ORDER BY id`, [ids]) : Promise.resolve({ rows: [] as any[] }),
    ]);
    const byOrder = <T extends { order_id: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) { const a = m.get(r.order_id); if (a) a.push(r); else m.set(r.order_id, [r]); }
      return m;
    };
    const im = byOrder(items.rows), pm = byOrder(pays.rows), em = byOrder(evs.rows);
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    const views = o.rows.map((x): OrderView => {
      const p = pm.get(x.id)?.[0];
      const v: OrderView = {
        id: x.id, number: x.number, status: x.status, userId: x.user_id,
        subtotalMinor: x.subtotal_minor, shippingMinor: x.shipping_minor, totalMinor: x.total_minor,
        shippingAddress: x.shipping_address, expiresAt: iso(x.expires_at)!, paidAt: iso(x.paid_at), cancelReason: x.cancel_reason,
        createdAt: iso(x.created_at)!, updatedAt: iso(x.updated_at)!,
        items: (im.get(x.id) ?? []).map((i) => ({ productId: i.product_id, flashSaleId: i.flash_sale_id, name: i.name, category: i.category, hue: i.hue, qty: i.qty, unitPriceMinor: i.unit_price_minor })),
        payment: p ? { id: p.id, status: p.status, providerRef: p.provider_ref, amountMinor: p.amount_minor, failureReason: p.failure_reason } : null,
      };
      if (withEvents) v.events = (em.get(x.id) ?? []).map((e) => ({ from: e.from_status, to: e.to_status, note: e.note, at: iso(e.created_at)! }));
      return v;
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    return views.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  async getForUser(userId: string, id: string, isAdmin = false): Promise<OrderView> {
    const [v] = await this.hydrate([id], true);
    if (!v) throw notFound('Order');
    if (v.userId !== userId && !isAdmin) throw notFound('Order'); // do not reveal that it exists
    return v;
  }

  async listForUser(userId: string, page = 1, pageSize = 20) {
    const r = await this.db.query<{ id: string; total: number }>(
      `SELECT id, count(*) OVER()::int AS total FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize]);
    return { page, pageSize, total: r.rows[0]?.total ?? 0, items: await this.hydrate(r.rows.map((x) => x.id), false) };
  }

  async listAll(opts: { status?: string; page?: number; pageSize?: number }) {
    const page = opts.page ?? 1, pageSize = opts.pageSize ?? 25;
    const r = await this.db.query<{ id: string; total: number }>(
      `SELECT id, count(*) OVER()::int AS total FROM orders WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [opts.status || null, pageSize, (page - 1) * pageSize]);
    return { page, pageSize, total: r.rows[0]?.total ?? 0, items: await this.hydrate(r.rows.map((x) => x.id), false) };
  }

  // ---- state transitions ---------------------------------------------------------------------
  /**
   * Move an order to a new status.  The row is locked first (SELECT ... FOR UPDATE), so two concurrent
   * actions on the same order (pay vs. expire vs. cancel) are serialised and the state machine is checked
   * against the TRUE current state.  Lock order everywhere: order row, then payment row.
   * Returns null when `onlyFrom` is given and the order is in a different state (a stale message: nothing to do).
   */
  async transition(c: PoolClient, orderId: string, to: OrderStatus, opts: {
    onlyFrom?: OrderStatus[]; note?: string; reason?: string; paid?: boolean;
  } = {}): Promise<{ from: OrderStatus; userId: string } | null> {
    const cur = await c.query<{ status: OrderStatus; user_id: string }>(`SELECT status, user_id FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (!cur.rowCount) throw notFound('Order');
    const { status: from, user_id: userId } = cur.rows[0];
    if (opts.onlyFrom && !opts.onlyFrom.includes(from)) return null;
    assertTransition(from, to);
    await c.query(
      `UPDATE orders SET status = $2, version = version + 1, updated_at = now(),
              paid_at = CASE WHEN $4::boolean THEN now() ELSE paid_at END,
              cancel_reason = COALESCE($3, cancel_reason)
        WHERE id = $1`, [orderId, to, opts.reason ?? null, !!opts.paid]);
    await c.query(`INSERT INTO order_events (order_id, from_status, to_status, note) VALUES ($1, $2, $3, $4)`, [orderId, from, to, opts.note ?? null]);
    return { from, userId };
  }

  /** Unpaid order past its deadline: give the stock back.  Safe to call repeatedly or early. */
  async expire(orderId: string): Promise<boolean> {
    return this.db.tx(async (c, defer) => {
      const due = await c.query(`SELECT 1 FROM orders WHERE id = $1 AND status = 'PENDING_PAYMENT' AND expires_at <= now()`, [orderId]);
      if (!due.rowCount) return false;
      const t = await this.transition(c, orderId, 'EXPIRED', { onlyFrom: ['PENDING_PAYMENT'], note: 'Payment window elapsed', reason: 'Payment not received in time' });
      if (!t) return false;
      const lines = await releaseReserved(c, orderId, t.userId);
      await this.outbox.add(c, EV.ORDER_EXPIRED, 'order', orderId, { orderId, userId: t.userId });
      defer(async () => { this.emitOrder(t.userId, orderId, 'EXPIRED'); await this.releaseGates(t.userId, lines); });
      return true;
    });
  }

  /** Warehouse progress: PAID -> PACKED -> SHIPPED -> DELIVERED. */
  async advance(orderId: string, to: 'PACKED' | 'SHIPPED' | 'DELIVERED'): Promise<boolean> {
    return this.db.tx(async (c, defer) => {
      const t = await this.transition(c, orderId, to, { onlyFrom: [PREV[to]], note: `Order ${to.toLowerCase()}` });
      if (!t) return false;
      await this.outbox.add(c, NEXT_EVENT[to], 'order', orderId, { orderId, userId: t.userId });
      defer(() => this.emitOrder(t.userId, orderId, to));
      return true;
    });
  }

  async cancel(user: AuthUser, orderId: string): Promise<OrderView> {
    await this.db.tx(async (c, defer) => {
      const o = await c.query<{ user_id: string; status: OrderStatus; total_minor: number }>(
        `SELECT user_id, status, total_minor FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      if (!o.rowCount || (o.rows[0].user_id !== user.id && user.role !== 'ADMIN')) throw notFound('Order');
      const { status, user_id: ownerId } = o.rows[0];
      if (!['PENDING_PAYMENT', 'PAID', 'PACKED'].includes(status)) {
        throw conflict('CANNOT_CANCEL', `An order that is ${status.toLowerCase().replace('_', ' ')} can no longer be cancelled`);
      }
      // we already hold the order lock, transition() re-locks the same row (a no-op inside this transaction)
      await this.transition(c, orderId, 'CANCELLED', { note: 'Cancelled by ' + (ownerId === user.id ? 'customer' : 'admin'), reason: 'Cancelled by request' });
      let lines: Line[];
      if (status === 'PENDING_PAYMENT') {
        lines = await releaseReserved(c, orderId, ownerId);
      } else {
        lines = await restockSold(c, orderId, ownerId);
        const p = await c.query<{ id: string }>(`UPDATE payments SET status = 'REFUNDED', updated_at = now() WHERE order_id = $1 AND status = 'SUCCEEDED' RETURNING id`, [orderId]);
        if (p.rowCount) await this.outbox.add(c, EV.PAYMENT_REFUNDED, 'order', orderId, { orderId, userId: ownerId, amountMinor: o.rows[0].total_minor });
      }
      await this.outbox.add(c, EV.ORDER_CANCELLED, 'order', orderId, { orderId, userId: ownerId });
      defer(async () => { this.emitOrder(ownerId, orderId, 'CANCELLED'); await this.releaseGates(ownerId, lines); });
    });
    return this.getForUser(user.id, orderId, user.role === 'ADMIN');
  }

  /** Mark stock sold when payment lands (called by the payments service inside its own transaction). */
  commit(c: PoolClient, orderId: string): Promise<void> { return commitSale(c, orderId); }

  /** Backstop for the delayed-message path: expire anything overdue, even if a queue message was lost. */
  async sweepExpired(limit = 100): Promise<number> {
    const r = await this.db.query<{ id: string }>(
      `SELECT id FROM orders WHERE status = 'PENDING_PAYMENT' AND expires_at <= now() - interval '2 seconds' ORDER BY expires_at LIMIT $1`, [limit]);
    let n = 0;
    for (const row of r.rows) {
      try { if (await this.expire(row.id)) n++; } catch (e) { this.log.warn(`sweep failed for ${row.id}: ${(e as Error).message}`); }
    }
    if (n) this.log.log(`sweeper expired ${n} order(s)`);
    return n;
  }
}
