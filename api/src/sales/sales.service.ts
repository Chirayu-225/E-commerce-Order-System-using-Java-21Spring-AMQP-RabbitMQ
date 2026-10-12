import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { notFound, conflict, parse } from '../common/errors';

export type SaleStatus = 'UPCOMING' | 'LIVE' | 'SOLD_OUT' | 'ENDED';

export interface SaleProduct {
  name: string; brand: string; category: string; hue: number;
  priceMinor: number; mrpMinor: number; rating: number; ratingCount: number;
}
interface SaleBase {
  id: string; productId: string; salePriceMinor: number; quantity: number; perUserLimit: number;
  startsAt: string; endsAt: string; product: SaleProduct;
}
export interface SaleView extends SaleBase { remaining: number; status: SaleStatus }

const createSchema = z.object({
  productId: z.string().uuid(),
  salePriceMinor: z.number().int().positive().optional(),
  discountPct: z.number().min(1).max(90).optional(),
  quantity: z.number().int().min(1).max(100_000),
  perUserLimit: z.number().int().min(1).max(10).default(1),
  startsInSeconds: z.number().int().min(0).max(30 * 24 * 3600).optional(),
  durationMinutes: z.number().int().min(1).max(7 * 24 * 60).default(60),
});

@Injectable()
export class SalesService {
  private readonly log = new Logger('Sales');
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly db: DbService,
    private readonly redis: RedisService,
    private readonly cache: CacheService,
  ) {}

  private async loadBase(): Promise<SaleBase[]> {
    const r = await this.db.query(
      `SELECT s.id, s.product_id, s.sale_price_minor, s.quantity, s.per_user_limit, s.starts_at, s.ends_at,
              p.name, p.brand, p.category, p.hue, p.price_minor, p.mrp_minor, p.rating::float8 AS rating, p.rating_count
         FROM flash_sales s JOIN products p ON p.id = s.product_id
        WHERE s.ends_at > now() - interval '1 day'
        ORDER BY s.starts_at`,
    );
    return r.rows.map((x) => ({
      id: x.id, productId: x.product_id, salePriceMinor: x.sale_price_minor, quantity: x.quantity, perUserLimit: x.per_user_limit,
      startsAt: new Date(x.starts_at).toISOString(), endsAt: new Date(x.ends_at).toISOString(),
      product: { name: x.name, brand: x.brand, category: x.category, hue: x.hue, priceMinor: x.price_minor, mrpMinor: x.mrp_minor, rating: x.rating, ratingCount: x.rating_count },
    }));
  }

  /** Sale definitions change rarely, so they are cached for a few seconds; live stock is always read from Redis. */
  private base(): Promise<SaleBase[]> {
    return this.cache.wrap('sales:base', 3, () => this.loadBase());
  }

  /** Remaining units for a sale: the Redis gate if present, otherwise (re)built from Postgres, the source of truth. */
  async getRemaining(saleId: string): Promise<number> {
    if (!this.cfg.gateEnabled) {
      const d = await this.db.query<{ remaining: number }>(`SELECT quantity - claimed AS remaining FROM flash_sales WHERE id = $1`, [saleId]);
      if (!d.rowCount) throw notFound('Flash sale');
      return d.rows[0].remaining;
    }
    try {
      const v = await this.redis.gateRemaining(saleId);
      if (v !== null) return v;
    } catch { /* fall through to the database */ }
    const r = await this.db.query<{ remaining: number }>(`SELECT quantity - claimed AS remaining FROM flash_sales WHERE id = $1`, [saleId]);
    if (!r.rowCount) throw notFound('Flash sale');
    try { await this.redis.gateInit(saleId, r.rows[0].remaining); } catch { /* gate is optional */ }
    return r.rows[0].remaining;
  }

  /** Make sure the Redis gate exists for this sale (used when the gate reports "not initialised"). */
  async ensureGate(saleId: string): Promise<void> {
    await this.getRemaining(saleId);
  }

  private async remainingMany(ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ids.length) return out;
    let vals: Array<string | null> = ids.map(() => null);
    if (this.cfg.gateEnabled) try { vals = await this.redis.client.mget(ids.map((id) => this.redis.key('sale', id, 'remaining'))); } catch { /* use DB */ }
    await Promise.all(ids.map(async (id, i) => {
      out.set(id, vals[i] !== null ? Number(vals[i]) : await this.getRemaining(id));
    }));
    return out;
  }

  statusOf(b: Pick<SaleBase, 'startsAt' | 'endsAt'>, remaining: number, nowMs = Date.now()): SaleStatus {
    if (nowMs < Date.parse(b.startsAt)) return 'UPCOMING';
    if (nowMs >= Date.parse(b.endsAt)) return 'ENDED';
    return remaining <= 0 ? 'SOLD_OUT' : 'LIVE';
  }

  async list(): Promise<SaleView[]> {
    const base = await this.base();
    const rem = await this.remainingMany(base.map((b) => b.id));
    const now = Date.now();
    return base.map((b) => {
      const remaining = rem.get(b.id) ?? 0;
      return { ...b, remaining, status: this.statusOf(b, remaining, now) };
    });
  }

  async get(id: string): Promise<SaleView> {
    const s = (await this.list()).find((x) => x.id === id);
    if (!s) throw notFound('Flash sale');
    return s;
  }

  /** The most relevant sale per product: live/sold-out first, then the next upcoming one.  Ended sales are not shown. */
  async byProduct(): Promise<Map<string, SaleView>> {
    const rank: Record<SaleStatus, number> = { LIVE: 0, SOLD_OUT: 1, UPCOMING: 2, ENDED: 9 };
    const m = new Map<string, SaleView>();
    for (const s of await this.list()) {
      if (s.status === 'ENDED') continue;
      const cur = m.get(s.productId);
      if (!cur || rank[s.status] < rank[cur.status]) m.set(s.productId, s);
    }
    return m;
  }

  // ---- admin ---------------------------------------------------------------------------------
  async create(body: unknown): Promise<SaleView> {
    const input = parse(createSchema, body);
    const prod = await this.db.query<{ price_minor: number; name: string }>(`SELECT price_minor, name FROM products WHERE id = $1 AND is_active`, [input.productId]);
    if (!prod.rowCount) throw notFound('Product');
    const price = input.salePriceMinor ?? Math.max(100, Math.round((prod.rows[0].price_minor * (100 - (input.discountPct ?? 30))) / 100 / 100) * 100); // whole rupees
    if (price >= prod.rows[0].price_minor) throw conflict('INVALID_SALE_PRICE', 'The sale price must be lower than the regular price');

    const inv = await this.db.query<{ available: number }>(`SELECT on_hand - reserved AS available FROM inventory WHERE product_id = $1`, [input.productId]);
    if (!inv.rowCount || inv.rows[0].available < input.quantity) {
      throw conflict('NOT_ENOUGH_STOCK', `Only ${inv.rows[0]?.available ?? 0} units are available to allocate to a sale`);
    }
    const startsIn = input.startsInSeconds ?? 0;
    const created = await this.db.query<{ id: string }>(
      `INSERT INTO flash_sales (product_id, sale_price_minor, quantity, per_user_limit, starts_at, ends_at)
       SELECT $1, $2, $3, $4, now() + ($5 * interval '1 second'), now() + ($5 * interval '1 second') + ($6 * interval '1 minute')
        WHERE NOT EXISTS (
          SELECT 1 FROM flash_sales f WHERE f.product_id = $1
             AND tstzrange(f.starts_at, f.ends_at) && tstzrange(now() + ($5 * interval '1 second'), now() + ($5 * interval '1 second') + ($6 * interval '1 minute')))
       RETURNING id`,
      [input.productId, price, input.quantity, input.perUserLimit, startsIn, input.durationMinutes],
    );
    if (!created.rowCount) throw conflict('SALE_OVERLAP', 'This product already has a sale scheduled in that time window');
    const id = created.rows[0].id;
    await this.redis.gateSet(id, input.quantity).catch(() => undefined);
    await this.cache.invalidateAll();
    this.log.log(`created flash sale ${id} for ${prod.rows[0].name}: ${input.quantity} units`);
    return this.get(id);
  }

  /** Rebuild every Redis gate from Postgres (after a Redis restart or when drift is detected). */
  async reconcileGates(): Promise<Array<{ saleId: string; before: number | null; after: number }>> {
    const rows = await this.db.query<{ id: string; remaining: number }>(
      `SELECT id, quantity - claimed AS remaining FROM flash_sales WHERE ends_at > now() - interval '1 hour'`);
    const out: Array<{ saleId: string; before: number | null; after: number }> = [];
    for (const r of rows.rows) {
      const before = await this.redis.gateRemaining(r.id).catch(() => null);
      await this.redis.gateSet(r.id, r.remaining);
      out.push({ saleId: r.id, before, after: r.remaining });
    }
    return out;
  }
}
