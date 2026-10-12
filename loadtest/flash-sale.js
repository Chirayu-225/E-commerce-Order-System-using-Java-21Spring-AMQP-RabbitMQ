// k6 load test: a flash-sale stampede.
//   node loadtest/prepare.js 3000 100          # fixture: 100 units, 3000 users
//   k6 run loadtest/flash-sale.js              # BASE_URL=http://127.0.0.1:8080
//   node loadtest/verify.js                    # integrity + "sold <= stock" proof
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const fx = JSON.parse(open('./fixture.json'));
const ALL = new SharedArray('tokens', () => fx.tokens);
const USERS = Math.min(Number(__ENV.USERS || ALL.length), ALL.length);
const tokens = { length: USERS };
const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const ADDRESS = { name: 'Load Tester', phone: '9876543210', line1: '1 Load Street', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };

const created = new Counter('orders_created');
const soldOut = new Counter('orders_sold_out');
const throttled = new Counter('orders_rate_limited');
const unexpected = new Counter('orders_unexpected');
const checkoutLatency = new Trend('checkout_latency', true);

export const options = {
  scenarios: {
    // everyone clicks "Buy" in the same few seconds
    stampede: { executor: 'per-vu-iterations', vus: tokens.length, iterations: 1, maxDuration: '2m', exec: 'buy' },
    // meanwhile shoppers keep browsing
    browsing: { executor: 'constant-arrival-rate', rate: 150, timeUnit: '1s', duration: '20s', preAllocatedVUs: 60, maxVUs: 150, exec: 'browse' },
  },
  thresholds: {
    orders_unexpected: ['count==0'],          // only 201 / 409 SOLD_OUT are acceptable outcomes
    http_req_failed: ['rate<0.001'],           // 409s are tagged as expected below
    checkout_latency: ['p(95)<1500'],
    'http_req_duration{kind:browse}': ['p(95)<400'],
  },
};

http.setResponseCallback(http.expectedStatuses(200, 201, 409));

export function buy() {
  const i = exec.scenario.iterationInTest; // unique 0..USERS-1 (VU ids are shared across scenarios, so they cannot be used)
  sleep(Math.random() * 1.5); // spread the click over ~1.5s like a real crowd
  const res = http.post(`${BASE}/api/orders`,
    JSON.stringify({ items: [{ productId: fx.productId, qty: 1, saleId: fx.saleId }], shippingAddress: ADDRESS }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ALL[i]}`, 'Idempotency-Key': `k6-${fx.saleId}-${i}` }, tags: { kind: 'checkout' } });
  checkoutLatency.add(res.timings.duration);
  if (res.status === 201) created.add(1);
  else if (res.status === 409 && res.json('code') === 'SOLD_OUT') soldOut.add(1);
  else if (res.status === 429) throttled.add(1);
  else { unexpected.add(1); console.error(`unexpected ${res.status} ${res.body}`); }
}

export function browse() {
  const r = Math.random();
  const url = r < 0.4 ? `${BASE}/api/flash-sales` : r < 0.8 ? `${BASE}/api/products?sort=popular` : `${BASE}/api/products?q=phone`;
  const res = http.get(url, { tags: { kind: 'browse' } });
  check(res, { 'browse 200': (x) => x.status === 200 });
}

export function handleSummary(data) {
  const m = (k, f = 'count') => (data.metrics[k] ? data.metrics[k].values[f] : 0);
  const out = {
    units: fx.units, users: USERS,
    created: m('orders_created'), soldOut: m('orders_sold_out'), rateLimited: m('orders_rate_limited'), unexpected: m('orders_unexpected'),
    checkoutP50ms: Math.round(m('checkout_latency', 'med')), checkoutP95ms: Math.round(m('checkout_latency', 'p(95)')), checkoutP99ms: Math.round(m('checkout_latency', 'p(99)')),
    browseP95ms: Math.round(data.metrics['http_req_duration{kind:browse}']?.values['p(95)'] ?? 0),
    totalRequests: m('http_reqs'), requestsPerSec: Number(m('http_reqs', 'rate').toFixed(1)), durationS: Number((data.state.testRunDurationMs / 1000).toFixed(1)),
  };
  return { stdout: JSON.stringify(out, null, 2) + '\n', 'loadtest/result.json': JSON.stringify(out, null, 2) };
}
