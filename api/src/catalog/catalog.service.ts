import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { CacheService } from '../redis/cache.service';
import { SalesService, SaleView } from '../sales/sales.service';
import { notFound, parse } from '../common/errors';

interface ProductBase {
  id: string; sku: string; name: string; brand: string; category: string; description: string;
  priceMinor: number; mrpMinor: number; discountPct: number; rating: number; ratingCount: number; hue: number;
}
export interface ProductView extends ProductBase {
  available: number;
  inStock: boolean;
  flashSale: Pick<SaleView, 'id' | 'salePriceMinor' | 'quantity' | 'remaining' | 'perUserLimit' | 'startsAt' | 'endsAt' | 'status'> | null;
}

const SORTS: Record<string, string> = {
  popular: 'p.rating_count DESC, p.name',
  price_asc: 'p.price_minor ASC, p.name',
  price_desc: 'p.price_minor DESC, p.name',
  discount: '(p.mrp_minor - p.price_minor)::float / p.mrp_minor DESC, p.name',
  new: 'p.created_at DESC, p.name',
};

const listSchema = z.object({
  category: z.string().trim().max(40).optional(),
  q: z.string().trim().max(80).optional(),
  sort: z.enum(['popular', 'price_asc', 'price_desc', 'discount', 'new']).default('popular'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

const COLS = `p.id, p.sku, p.name, p.brand, p.category, p.description, p.price_minor, p.mrp_minor,
              p.rating::float8 AS rating, p.rating_count, p.hue`;

const toBase = (x: any): ProductBase => ({
  id: x.id, sku: x.sku, name: x.name, brand: x.brand, category: x.category, description: x.description,
  priceMinor: x.price_minor, mrpMinor: x.mrp_minor,
  discountPct: Math.round(((x.mrp_minor - x.price_minor) / x.mrp_minor) * 100),
  rating: x.rating, ratingCount: x.rating_count, hue: x.hue,
});

@Injectable()
export class CatalogService {
  constructor(private readonly db: DbService, private readonly cache: CacheService, private readonly sales: SalesService) {}

  /** Static catalogue data is cached; stock and flash-sale state are layered on top live, so they are never stale. */
  private async overlay(base: ProductBase[]): Promise<ProductView[]> {
    if (!base.length) return [];
    const [inv, sales] = await Promise.all([
      this.db.query<{ product_id: string; available: number }>(
        `SELECT product_id, on_hand - reserved AS available FROM inventory WHERE product_id = ANY($1::uuid[])`, [base.map((b) => b.id)]),
      this.sales.byProduct(),
    ]);
    const avail = new Map(inv.rows.map((r) => [r.product_id, r.available]));
    return base.map((b) => {
      const s = sales.get(b.id);
      const available = avail.get(b.id) ?? 0;
      return {
        ...b, available, inStock: available > 0,
        flashSale: s ? { id: s.id, salePriceMinor: s.salePriceMinor, quantity: s.quantity, remaining: s.remaining, perUserLimit: s.perUserLimit, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status } : null,
      };
    });
  }

  async list(query: unknown) {
    const q = parse(listSchema, query);
    const key = `products:${q.category ?? ''}:${q.q ?? ''}:${q.sort}:${q.page}:${q.pageSize}`;
    const page = await this.cache.wrap(key, 30, async () => {
      const r = await this.db.query(
        `SELECT ${COLS}, count(*) OVER()::int AS total
           FROM products p
          WHERE p.is_active
            AND ($1::text IS NULL OR p.category = $1)
            AND ($2::text IS NULL OR p.search_vector @@ websearch_to_tsquery('english'::regconfig, $2)
                 OR p.name ILIKE '%' || $2 || '%' OR p.brand ILIKE '%' || $2 || '%')
          ORDER BY ${SORTS[q.sort]}
          LIMIT $3 OFFSET $4`,
        [q.category || null, q.q || null, q.pageSize, (q.page - 1) * q.pageSize],
      );
      return { total: r.rows[0]?.total ?? 0, items: r.rows.map(toBase) };
    });
    return { page: q.page, pageSize: q.pageSize, total: page.total, items: await this.overlay(page.items) };
  }

  async get(id: string): Promise<ProductView> {
    const base = await this.cache.wrap(`product:${id}`, 30, async () => {
      const r = await this.db.query(`SELECT ${COLS} FROM products p WHERE p.id = $1 AND p.is_active`, [id]);
      return r.rows[0] ? toBase(r.rows[0]) : null;
    });
    if (!base) throw notFound('Product');
    return (await this.overlay([base]))[0];
  }

  categories() {
    return this.cache.wrap('categories', 60, async () => {
      const r = await this.db.query<{ category: string; count: number }>(
        `SELECT category, count(*)::int AS count FROM products WHERE is_active GROUP BY category ORDER BY count DESC, category`);
      return r.rows;
    });
  }
}
