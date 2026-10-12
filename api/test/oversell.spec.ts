import { Ctx, boot, call, expectIntegrity, makeProduct, makeSale, makeUsers, order } from './helpers';

/** The headline guarantee: a sale of N units sells exactly N, however many people hammer it at once. */
describe.each([
  ['Redis gate + Postgres', true],
  ['Postgres alone (gate disabled)', false],
])('no overselling: %s', (_name, gateEnabled) => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await boot({ gateEnabled: gateEnabled as boolean }); });
  afterAll(async () => { await ctx.app.close(); });

  it('120 concurrent buyers, 20 units: exactly 20 orders succeed', async () => {
    const [pid, users] = [await makeProduct(ctx, 50), await makeUsers(ctx, 120)];
    const sid = await makeSale(ctx, pid, 20, 1);
    const res = await Promise.all(users.map((u, i) => order(ctx, u.token, `k-${i}-${u.id}`, pid, sid)));
    const ok = res.filter((r) => r.statusCode === 201).length;
    const soldOut = res.filter((r) => r.statusCode === 409 && r.json().code === 'SOLD_OUT').length;
    expect(ok).toBe(20);
    expect(soldOut).toBe(100);
    const sale = await ctx.db.query(`SELECT claimed FROM flash_sales WHERE id = $1`, [sid]);
    const inv = await ctx.db.query(`SELECT reserved FROM inventory WHERE product_id = $1`, [pid]);
    expect(sale.rows[0].claimed).toBe(20);
    expect(inv.rows[0].reserved).toBe(20);
    await expectIntegrity(ctx);
  });

  it('per-user limit holds when one user fires many requests at once', async () => {
    const [pid, [u]] = [await makeProduct(ctx, 50), await makeUsers(ctx, 1)];
    const sid = await makeSale(ctx, pid, 30, 2);
    const res = await Promise.all(Array.from({ length: 12 }, (_, i) => order(ctx, u.token, `limit-${i}-${u.id}`, pid, sid)));
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(2);
    expect(res.filter((r) => r.statusCode === 409 && r.json().code === 'LIMIT_REACHED').length).toBe(10);
    await expectIntegrity(ctx);
  });

  it('regular (non-sale) stock is never oversold either', async () => {
    const [pid, users] = [await makeProduct(ctx, 7), await makeUsers(ctx, 40)];
    const res = await Promise.all(users.map((u, i) => order(ctx, u.token, `reg-${i}-${u.id}`, pid, null)));
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(7);
    expect(res.filter((r) => r.statusCode === 409 && r.json().code === 'OUT_OF_STOCK')).toHaveLength(33);
    await expectIntegrity(ctx);
  });

  it('a multi-item cart is all-or-nothing', async () => {
    const [a, b, [u]] = [await makeProduct(ctx, 5), await makeProduct(ctx, 0), await makeUsers(ctx, 1)];
    const r = await call(ctx, 'POST', '/api/orders', {
      token: u.token, key: `cart-${u.id}`,
      body: { items: [{ productId: a, qty: 1 }, { productId: b, qty: 1 }], shippingAddress: { name: 'T Buyer', phone: '9876543210', line1: '1 Test Street', city: 'Pune', state: 'MH', pincode: '411001' } },
    });
    expect(r.statusCode).toBe(409);
    const inv = await ctx.db.query(`SELECT reserved FROM inventory WHERE product_id = $1`, [a]);
    expect(inv.rows[0].reserved).toBe(0); // the first line was rolled back with the transaction
    expect((await ctx.db.query(`SELECT count(*)::int n FROM orders WHERE user_id = $1`, [u.id])).rows[0].n).toBe(0);
  });
});
