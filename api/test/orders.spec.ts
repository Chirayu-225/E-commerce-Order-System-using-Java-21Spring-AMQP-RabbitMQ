import { Ctx, boot, call, expectIntegrity, makeProduct, makeSale, makeUsers, order, orderStatus, payOrder, waitFor, webhook, ADDRESS } from './helpers';
import { signPayload } from '../src/payments/webhook-signature';

describe('orders, payments and lifecycle', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await boot(); });
  afterAll(async () => { await ctx.app.close(); });

  it('idempotency: 20 parallel requests with one key create exactly one order', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 1)];
    const res = await Promise.all(Array.from({ length: 20 }, () => order(ctx, u.token, 'same-key-12345', pid, null)));
    const ok = res.filter((r) => r.statusCode === 201 || r.statusCode === 200);
    expect(ok).toHaveLength(20);
    expect(new Set(ok.map((r) => r.json().id)).size).toBe(1);
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect((await ctx.db.query(`SELECT count(*)::int n FROM orders`)).rows[0].n).toBe(1);
    expect((await ctx.db.query(`SELECT reserved FROM inventory WHERE product_id = $1`, [pid])).rows[0].reserved).toBe(1);
    await expectIntegrity(ctx);
  });

  it('reusing a key for a different request is rejected (422)', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 1)];
    expect((await order(ctx, u.token, 'reuse-key-1234', pid, null, 1)).statusCode).toBe(201);
    const r = await order(ctx, u.token, 'reuse-key-1234', pid, null, 2);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('requires an Idempotency-Key and authentication', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 1)];
    expect((await call(ctx, 'POST', '/api/orders', { token: u.token, body: { items: [{ productId: pid, qty: 1 }], shippingAddress: ADDRESS } })).json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await call(ctx, 'POST', '/api/orders', { key: 'no-auth-12345', body: {} })).statusCode).toBe(401);
  });

  it('the server sets the price: a flash-sale order is charged the sale price', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10, 100_000), await makeUsers(ctx, 1)];
    const sid = await makeSale(ctx, pid, 5, 1, 30_000);
    const o = (await order(ctx, u.token, 'price-key-1234', pid, sid)).json();
    expect(o.items[0].unitPriceMinor).toBe(30_000);
    expect(o.subtotalMinor).toBe(30_000);
    expect(o.shippingMinor).toBe(4_900);
    expect(o.totalMinor).toBe(34_900);
  });

  it('webhook: bad signature 401, success pays the order, duplicate event is ignored', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 1)];
    const o = (await order(ctx, u.token, 'pay-key-123456', pid, null)).json();
    const start = (await call(ctx, 'POST', `/api/orders/${o.id}/payments`, { token: u.token })).json();
    const evt = { id: 'evt_dup_1', type: 'payment.succeeded', data: { providerRef: start.providerRef, amountMinor: start.amountMinor } };
    expect((await webhook(ctx, evt, 't=1,v1=deadbeef')).status).toBe(401);
    expect(await orderStatus(ctx, u.token, o.id)).toBe('PENDING_PAYMENT');

    const first = await webhook(ctx, evt);
    expect(first.body.result).toBe('paid');
    const second = await webhook(ctx, evt);
    expect(second.body.duplicate).toBe(true);
    const third = await webhook(ctx, { ...evt, id: 'evt_dup_2' }); // a different event for an already-settled payment
    expect(third.body.result).toBe('already_settled');

    expect(await orderStatus(ctx, u.token, o.id)).toBe('PAID');
    const inv = (await ctx.db.query(`SELECT on_hand, reserved, sold FROM inventory WHERE product_id = $1`, [pid])).rows[0];
    expect(inv).toEqual({ on_hand: 9, reserved: 0, sold: 1 });
    await expectIntegrity(ctx);
  });

  it('a failed payment leaves the order payable; a retry can succeed', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 1)];
    const o = (await order(ctx, u.token, 'retry-key-1234', pid, null)).json();
    const bad = await payOrder(ctx, u.token, o.id, undefined, 'payment.failed');
    expect(bad.body.result).toBe('failed');
    expect(await orderStatus(ctx, u.token, o.id)).toBe('PENDING_PAYMENT');
    const good = await payOrder(ctx, u.token, o.id);
    expect(good.body.result).toBe('paid');
    expect(good.start.paymentId).not.toBe(bad.start.paymentId);
  });

  it('unpaid orders expire via the RabbitMQ delay queue and give stock + sale units back', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 1)];
    const sid = await makeSale(ctx, pid, 5, 1);
    const o = (await order(ctx, u.token, 'expire-key-1234', pid, sid)).json();
    expect((await ctx.db.query(`SELECT reserved FROM inventory WHERE product_id = $1`, [pid])).rows[0].reserved).toBe(1);
    await waitFor(async () => (await orderStatus(ctx, u.token, o.id)) === 'EXPIRED', 15_000);
    const inv = (await ctx.db.query(`SELECT on_hand, reserved FROM inventory WHERE product_id = $1`, [pid])).rows[0];
    expect(inv).toEqual({ on_hand: 10, reserved: 0 });
    expect((await ctx.db.query(`SELECT claimed FROM flash_sales WHERE id = $1`, [sid])).rows[0].claimed).toBe(0);
    expect(await ctx.redis.gateRemaining(sid)).toBe(5);
    // the user may buy again now
    expect((await order(ctx, u.token, 'expire-key-5678', pid, sid)).statusCode).toBe(201);
    await expectIntegrity(ctx);
  });

  it('a payment that arrives after expiry is refunded, never fulfilled', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 1)];
    const o = (await order(ctx, u.token, 'late-key-123456', pid, null)).json();
    const start = (await call(ctx, 'POST', `/api/orders/${o.id}/payments`, { token: u.token })).json();
    await waitFor(async () => (await orderStatus(ctx, u.token, o.id)) === 'EXPIRED', 15_000);
    const late = await webhook(ctx, { id: 'evt_late_1', type: 'payment.succeeded', data: { providerRef: start.providerRef, amountMinor: start.amountMinor } });
    expect(late.body.result).toBe('refunded_late');
    const final = (await call(ctx, 'GET', `/api/orders/${o.id}`, { token: u.token })).json();
    expect(final.status).toBe('EXPIRED');
    expect(final.payment.status).toBe('REFUNDED');
    expect((await ctx.db.query(`SELECT sold FROM inventory WHERE product_id = $1`, [pid])).rows[0].sold).toBe(0);
    await expectIntegrity(ctx);
  });

  it('paid orders move PAID -> PACKED -> SHIPPED -> DELIVERED through the queues', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 1)];
    const o = (await order(ctx, u.token, 'ship-key-123456', pid, null)).json();
    await payOrder(ctx, u.token, o.id);
    await waitFor(async () => (await orderStatus(ctx, u.token, o.id)) === 'DELIVERED', 20_000);
    const final = (await call(ctx, 'GET', `/api/orders/${o.id}`, { token: u.token })).json();
    expect(final.events.map((e: any) => e.to)).toEqual(['PENDING_PAYMENT', 'PAID', 'PACKED', 'SHIPPED', 'DELIVERED']);
    await waitFor(async () => (await call(ctx, 'GET', '/api/notifications', { token: u.token })).json().items.length >= 5, 10_000);
    await expectIntegrity(ctx);
  });

  it('cancelling a paid order restocks the item and refunds the payment', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 1)];
    const sid = await makeSale(ctx, pid, 5, 1);
    const o = (await order(ctx, u.token, 'cancel-key-1234', pid, sid)).json();
    await payOrder(ctx, u.token, o.id);
    const c = await call(ctx, 'POST', `/api/orders/${o.id}/cancel`, { token: u.token });
    expect(c.statusCode).toBe(200);
    expect(c.json().status).toBe('CANCELLED');
    expect(c.json().payment.status).toBe('REFUNDED');
    expect((await ctx.db.query(`SELECT on_hand, sold FROM inventory WHERE product_id = $1`, [pid])).rows[0]).toEqual({ on_hand: 10, sold: 0 });
    expect(await ctx.redis.gateRemaining(sid)).toBe(5);
    expect((await call(ctx, 'POST', `/api/orders/${o.id}/cancel`, { token: u.token })).statusCode).toBe(409); // already cancelled
    await expectIntegrity(ctx);
  });

  it("users cannot read or cancel other people's orders", async () => {
    const [pid, [a, b]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 2)];
    const o = (await order(ctx, a.token, 'owner-key-12345', pid, null)).json();
    expect((await call(ctx, 'GET', `/api/orders/${o.id}`, { token: b.token })).statusCode).toBe(404);
    expect((await call(ctx, 'POST', `/api/orders/${o.id}/cancel`, { token: b.token })).statusCode).toBe(404);
    expect((await call(ctx, 'POST', `/api/orders/${o.id}/payments`, { token: b.token })).statusCode).toBe(404);
  });

  it('notification consumer is idempotent: a redelivered event creates one notification', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 10), await makeUsers(ctx, 1)];
    const o = (await order(ctx, u.token, 'notif-key-12345', pid, null)).json();
    const workers = ctx.app.get(require('../src/workers/workers.service').WorkersService) as any;
    await waitFor(async () => (await ctx.db.query(`SELECT 1 FROM notifications WHERE order_id = $1`, [o.id])).rowCount, 10_000);
    const env = { eventId: '11111111-1111-4111-8111-111111111111', type: 'order.shipped', aggregateId: o.id, occurredAt: new Date().toISOString(), data: { userId: u.id } };
    await workers.notify(env); await workers.notify(env); await workers.notify(env);
    expect((await ctx.db.query(`SELECT count(*)::int n FROM notifications WHERE order_id = $1 AND title = 'Order shipped'`, [o.id])).rows[0].n).toBe(1);
  });

  it('webhook with a stale timestamp is rejected', async () => {
    const raw = JSON.stringify({ id: 'evt_old', type: 'payment.succeeded', data: { providerRef: 'x', amountMinor: 1 } });
    const res = await call(ctx, 'POST', '/api/payments/webhook', { body: raw, headers: { 'x-signature': signPayload('test-webhook-secret', raw, 1_000) } });
    expect(res.statusCode).toBe(401);
  });
});
