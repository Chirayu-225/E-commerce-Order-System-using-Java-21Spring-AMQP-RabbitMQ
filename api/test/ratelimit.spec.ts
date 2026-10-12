import { Ctx, boot, call, makeProduct, makeUsers, order } from './helpers';

describe('rate limiting', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await boot({ rateLimit: { enabled: true, ipBurst: 1000, ipPerSec: 1000, checkoutBurst: 3, checkoutPerSec: 0.2 } });
  });
  afterAll(async () => { await ctx.app.close(); });

  it('throttles checkout per user with 429 + Retry-After, without affecting other users', async () => {
    const [pid, [a, b]] = [await makeProduct(ctx, 100), await makeUsers(ctx, 2)];
    const codes: number[] = [];
    let last: any;
    for (let i = 0; i < 6; i++) { last = await order(ctx, a.token, `rl-${i}-${a.id}`, pid, null); codes.push(last.statusCode); }
    expect(codes.filter((c) => c === 201)).toHaveLength(3);
    expect(codes.filter((c) => c === 429)).toHaveLength(3);
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
    expect(last.json().code).toBe('RATE_LIMITED');
    expect((await order(ctx, b.token, `rl-b-${b.id}`, pid, null)).statusCode).toBe(201);
  });
});

describe('per-IP limiting', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = await boot({ rateLimit: { enabled: true, ipBurst: 5, ipPerSec: 0.1, checkoutBurst: 100, checkoutPerSec: 100 } }); });
  afterAll(async () => { await ctx.app.close(); });

  it('rejects a burst from one IP but never throttles the health check', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 9; i++) codes.push((await call(ctx, 'GET', '/api/categories')).statusCode);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(3);
    expect((await call(ctx, 'GET', '/api/health')).statusCode).toBe(200);
  });
});
