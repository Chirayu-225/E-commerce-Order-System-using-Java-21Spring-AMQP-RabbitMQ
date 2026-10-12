import { Db } from '../db/db.service';

/**
 * Stock operations.  Each is ONE atomic conditional UPDATE: the guard lives in the WHERE clause, so
 * "is there enough stock?" and "take it" cannot be separated by another request (no read-then-write race).
 * The CHECK constraints in the schema are the last line of defence: even a buggy caller cannot make stock negative.
 *
 *   reserve  : reserved += q          (only if on_hand - reserved >= q)
 *   commit   : reserved -> sold       (payment succeeded)
 *   release  : reserved -= q          (order expired / cancelled before payment)
 *   restock  : sold -> on_hand        (cancelled/refunded after payment)
 */
export interface Line {
  productId: string;
  qty: number;
  saleId: string | null;
  /** per-user purchase limit of the sale (only for flash-sale lines) */
  limit?: number;
}

export type StockFailure = 'OUT_OF_STOCK' | 'SALE_REJECTED' | 'LIMIT';
export class StockError extends Error {
  constructor(readonly kind: StockFailure, readonly line: Line) {
    super(`${kind} for product ${line.productId}`);
  }
}

const byProduct = (a: Line, b: Line) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);

/** Claim units for a new order.  Lines are processed in product-id order so concurrent orders cannot deadlock. */
export async function reserveStock(c: Db, orderId: string, userId: string, lines: Line[]): Promise<void> {
  for (const l of [...lines].sort(byProduct)) {
    if (l.saleId) {
      const sale = await c.query(
        `UPDATE flash_sales SET claimed = claimed + $2
          WHERE id = $1 AND claimed + $2 <= quantity AND starts_at <= now() AND ends_at > now()
          RETURNING claimed`,
        [l.saleId, l.qty],
      );
      if (!sale.rowCount) throw new StockError('SALE_REJECTED', l);

      const claim = await c.query(
        `INSERT INTO sale_user_claims (sale_id, user_id, qty)
              SELECT $1::uuid, $2::uuid, $3::int WHERE $3::int <= $4::int
         ON CONFLICT (sale_id, user_id)
         DO UPDATE SET qty = sale_user_claims.qty + EXCLUDED.qty
                 WHERE sale_user_claims.qty + EXCLUDED.qty <= $4::int
         RETURNING qty`,
        [l.saleId, userId, l.qty, l.limit ?? 1],
      );
      if (!claim.rowCount) throw new StockError('LIMIT', l);
    }
    const inv = await c.query(
      `UPDATE inventory SET reserved = reserved + $2, updated_at = now()
        WHERE product_id = $1 AND on_hand - reserved >= $2
        RETURNING product_id`,
      [l.productId, l.qty],
    );
    if (!inv.rowCount) throw new StockError('OUT_OF_STOCK', l);
    await c.query(
      `INSERT INTO stock_movements (product_id, order_id, sale_id, reason, d_reserved) VALUES ($1, $2, $3, 'RESERVE', $4)`,
      [l.productId, orderId, l.saleId, l.qty],
    );
  }
}

async function orderLines(c: Db, orderId: string): Promise<Line[]> {
  const r = await c.query<{ product_id: string; flash_sale_id: string | null; qty: number }>(
    `SELECT product_id, flash_sale_id, qty FROM order_items WHERE order_id = $1 ORDER BY product_id`,
    [orderId],
  );
  return r.rows.map((x) => ({ productId: x.product_id, saleId: x.flash_sale_id, qty: x.qty }));
}

async function releaseSaleClaim(c: Db, l: Line, userId: string): Promise<void> {
  if (!l.saleId) return;
  await c.query(`UPDATE flash_sales SET claimed = claimed - $2 WHERE id = $1 AND claimed >= $2`, [l.saleId, l.qty]);
  await c.query(`UPDATE sale_user_claims SET qty = GREATEST(qty - $3, 0) WHERE sale_id = $1 AND user_id = $2`, [l.saleId, userId, l.qty]);
}

function mustChange(rowCount: number | null, what: string, l: Line): void {
  // An invariant violation means a bug (e.g. releasing twice).  Fail loudly and roll the whole transaction back.
  if (!rowCount) throw new Error(`stock invariant violated: ${what} for product ${l.productId}`);
}

/** Payment succeeded: reserved units become sold units. */
export async function commitSale(c: Db, orderId: string): Promise<void> {
  for (const l of await orderLines(c, orderId)) {
    const r = await c.query(
      `UPDATE inventory SET on_hand = on_hand - $2, reserved = reserved - $2, sold = sold + $2, updated_at = now()
        WHERE product_id = $1 AND reserved >= $2`,
      [l.productId, l.qty],
    );
    mustChange(r.rowCount, 'commit', l);
    await c.query(
      `INSERT INTO stock_movements (product_id, order_id, sale_id, reason, d_on_hand, d_reserved, d_sold) VALUES ($1, $2, $3, 'COMMIT', $4, $4, $5)`,
      [l.productId, orderId, l.saleId, -l.qty, l.qty],
    );
  }
}

/** Unpaid order expired or was cancelled: give the reservation back.  Returns the lines (for Redis gate release). */
export async function releaseReserved(c: Db, orderId: string, userId: string): Promise<Line[]> {
  const lines = await orderLines(c, orderId);
  for (const l of lines) {
    const r = await c.query(
      `UPDATE inventory SET reserved = reserved - $2, updated_at = now() WHERE product_id = $1 AND reserved >= $2`,
      [l.productId, l.qty],
    );
    mustChange(r.rowCount, 'release', l);
    await c.query(
      `INSERT INTO stock_movements (product_id, order_id, sale_id, reason, d_reserved) VALUES ($1, $2, $3, 'RELEASE', $4)`,
      [l.productId, orderId, l.saleId, -l.qty],
    );
    await releaseSaleClaim(c, l, userId);
  }
  return lines;
}

/** Paid order cancelled before shipping: sold units go back on the shelf. */
export async function restockSold(c: Db, orderId: string, userId: string): Promise<Line[]> {
  const lines = await orderLines(c, orderId);
  for (const l of lines) {
    const r = await c.query(
      `UPDATE inventory SET on_hand = on_hand + $2, sold = sold - $2, updated_at = now() WHERE product_id = $1 AND sold >= $2`,
      [l.productId, l.qty],
    );
    mustChange(r.rowCount, 'restock', l);
    await c.query(
      `INSERT INTO stock_movements (product_id, order_id, sale_id, reason, d_on_hand, d_sold) VALUES ($1, $2, $3, 'RESTOCK_REFUND', $4, $5)`,
      [l.productId, orderId, l.saleId, l.qty, -l.qty],
    );
    await releaseSaleClaim(c, l, userId);
  }
  return lines;
}
