import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/bootstrap';
import { AppConfig } from '../src/config/config';
import { DbService } from '../src/db/db.service';
import { RedisService } from '../src/redis/redis.service';
import { RabbitService } from '../src/mq/rabbit.service';
import { TokenService } from '../src/common/auth';
import { signPayload } from '../src/payments/webhook-signature';
import { AdminService } from '../src/admin/admin.service';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://flashcart:flashcart@127.0.0.1:5432/flashcart_test';
export const WEBHOOK_SECRET = 'test-webhook-secret';
export const ADDRESS = { name: 'Test Buyer', phone: '9876543210', line1: '1 Test Street', city: 'Pune', state: 'MH', pincode: '411001' };

export interface Ctx { app: NestFastifyApplication; db: DbService; redis: RedisService; rabbit: RabbitService; tokens: TokenService; admin: AdminService }

export async function boot(over: Partial<AppConfig> = {}): Promise<Ctx> {
  const app = await createApp({
    databaseUrl: TEST_DB, redisPrefix: 'fct:', seedDemo: false, webhookSecret: WEBHOOK_SECRET, jwtSecret: 'test-jwt-secret-test-jwt-secret-1234',
    orderTtlMs: 2500, fulfilmentDelaysMs: { pack: 400, ship: 400, deliver: 400 }, dbPoolMax: 30,
    rateLimit: { enabled: false, ipBurst: 1000, ipPerSec: 1000, checkoutBurst: 1000, checkoutPerSec: 1000 },
    ...over,
  }, { logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const ctx: Ctx = { app, db: app.get(DbService), redis: app.get(RedisService), rabbit: app.get(RabbitService), tokens: app.get(TokenService), admin: app.get(AdminService) };
  await reset(ctx);
  return ctx;
}

export async function reset(ctx: Ctx): Promise<void> {
  await ctx.db.query(`TRUNCATE users, products, inventory, stock_movements, flash_sales, sale_user_claims, orders, order_items, order_events,
                      payments, payment_webhook_events, outbox, inbox, notifications RESTART IDENTITY CASCADE`);
  await ctx.redis.flushOwned();
  await ctx.rabbit.resetForTests();
}

export const call = (ctx: Ctx, method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown; key?: string; headers?: Record<string, string> } = {}) =>
  ctx.app.inject({
    method, url,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.key ? { 'idempotency-key': opts.key } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
    payload: opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
  });

export async function makeUsers(ctx: Ctx, n: number, role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') {
  const r = await ctx.db.query<{ id: string; email: string; name: string; role: 'CUSTOMER' | 'ADMIN' }>(
    `INSERT INTO users (email, password_hash, name, role)
     SELECT 'u' || gen_random_uuid() || '@t.dev', 'x', 'User ' || g, $2 FROM generate_series(1, $1) g RETURNING id, email, name, role`, [n, role]);
  return r.rows.map((u) => ({ ...u, token: ctx.tokens.sign(u) }));
}

export async function makeProduct(ctx: Ctx, stock: number, price = 100_000): Promise<string> {
  const p = await ctx.db.query<{ id: string }>(
    `INSERT INTO products (sku, name, brand, category, description, price_minor, mrp_minor) VALUES ('SKU-' || gen_random_uuid(), 'Test Phone', 'TestCo', 'Mobiles', 'A test phone', $1, $1 * 2) RETURNING id`, [price]);
  await ctx.db.query(`INSERT INTO inventory (product_id, initial_stock, on_hand) VALUES ($1, $2, $2)`, [p.rows[0].id, stock]);
  await ctx.db.query(`INSERT INTO stock_movements (product_id, reason, d_on_hand) VALUES ($1, 'RESTOCK', $2)`, [p.rows[0].id, stock]);
  return p.rows[0].id;
}

export async function makeSale(ctx: Ctx, productId: string, quantity: number, perUserLimit = 1, price = 50_000): Promise<string> {
  const s = await ctx.db.query<{ id: string }>(
    `INSERT INTO flash_sales (product_id, sale_price_minor, quantity, per_user_limit, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, now() - interval '1 minute', now() + interval '1 hour') RETURNING id`, [productId, price, quantity, perUserLimit]);
  return s.rows[0].id;
}

export const order = (ctx: Ctx, token: string, key: string, productId: string, saleId: string | null, qty = 1) =>
  call(ctx, 'POST', '/api/orders', { token, key, body: { items: [{ productId, qty, saleId }], shippingAddress: ADDRESS } });

export async function payOrder(ctx: Ctx, token: string, orderId: string, eventId = `evt_${Math.random().toString(36).slice(2)}`, type = 'payment.succeeded') {
  const start = (await call(ctx, 'POST', `/api/orders/${orderId}/payments`, { token })).json();
  return { start, ...(await webhook(ctx, { id: eventId, type, data: { providerRef: start.providerRef, amountMinor: start.amountMinor } })) };
}

export async function webhook(ctx: Ctx, event: object, sig?: string) {
  const raw = JSON.stringify(event);
  const res = await call(ctx, 'POST', '/api/payments/webhook', { body: raw, headers: { 'x-signature': sig ?? signPayload(WEBHOOK_SECRET, raw) } });
  return { res, status: res.statusCode, body: res.json() };
}

export async function waitFor<T>(fn: () => Promise<T | undefined | false>, ms = 15_000, step = 100): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, step));
  }
}

export const orderStatus = async (ctx: Ctx, token: string, id: string): Promise<string> => (await call(ctx, 'GET', `/api/orders/${id}`, { token })).json().status;

export async function expectIntegrity(ctx: Ctx): Promise<void> {
  const r = await ctx.admin.integrity();
  const bad = r.checks.filter((c) => !c.ok);
  if (bad.length) throw new Error(`integrity failed: ${bad.map((b) => `${b.name}: ${b.detail}`).join(' | ')}`);
}
