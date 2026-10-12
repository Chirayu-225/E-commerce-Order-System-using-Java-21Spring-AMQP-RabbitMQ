# Load test report

## What is being tested

A flash-sale stampede:

- **N** distinct, already-authenticated users each try to buy **1** unit of a sale that has **100** units.
- Their clicks are spread randomly over about 1.5 seconds.
- At the same time, a second scenario sends **150 req/s** of browsing traffic for 20 s, split across sale listings, product listings and search.

There are two questions:

1. **Correctness:** is the number of orders exactly the allocation, with nothing lost, duplicated or oversold?
2. **Latency:** what does the crowd experience, and how much does the Redis gate help?

Script: [`loadtest/flash-sale.js`](../loadtest/flash-sale.js) (k6 v0.55). Fixture: [`loadtest/prepare.js`](../loadtest/prepare.js) creates a fresh product, a 100-unit sale with a limit of 1 per user, and N users with pre-signed JWTs, so bcrypt is not part of the measurement. Verifier: [`loadtest/verify.js`](../loadtest/verify.js) checks these against the database after the run:

- orders ≤ units
- orders = units (sold out)
- `sale.claimed` = units in orders
- `inventory.reserved` = units in orders
- conservation (`on_hand + sold = initial`)
- no user holding two orders
- k6's count of 201s = orders in the database

Accepted outcomes per request are `201` (won) and `409 SOLD_OUT` (lost). Anything else counts as "unexpected".

## Environment

| | |
|---|---|
| Machine | 1 cloud VM: **2 vCPUs** (Intel Xeon @ 2.80 GHz), 8 GB RAM |
| API | 1 Node.js 22 process (NestJS 11 + Fastify), DB pool 20, rate limiting disabled for the run (all k6 traffic comes from one IP) |
| Datastores | PostgreSQL 16 (`fsync=off` dev instance), Redis 7.0, RabbitMQ 3.12, all on the same VM |
| Load generator | k6 on **the same VM**, competing for the same 2 cores |

Every run was preceded by a 300-user warm-up run against a separate fixture, so JIT warm-up isn't counted.

## Results

| Run | Orders | Sold out | Unexpected | Checkout p50 | Checkout p95 | Browse p95 | Throughput (all reqs) | Verifier |
|---|---|---|---|---|---|---|---|---|
| 1,000 users · gate **on** | **100** | 900 | 0 | 2,588 ms | 2,917 ms | 708 ms | 196 req/s | 7/7 PASS |
| 1,000 users · gate **off** | **100** | 900 | 0 | 6,185 ms | 8,092 ms | 2,654 ms | 163 req/s | 7/7 PASS |
| 3,000 users · gate on | **100** | 2,599 | 301 | 7,574 ms | 58,966 ms | 4,564 ms | 77 req/s | no oversell (see below) |

## Reading the numbers

**Correctness held in every run.** The database contained exactly 100 orders for the 100-unit sale, and every ledger check passed. That includes the run with the Redis gate switched off, where Postgres row-level guards and `CHECK` constraints were the only defence. It also includes the overloaded 3,000-user run.

**The Redis gate is a latency feature, not a correctness feature.** With the gate on, 900 of 1,000 requests are rejected in Redis without opening a database transaction. Checkout p95 dropped about 2.8× (8.1 s → 2.9 s), and browsing traffic sharing the same database stayed about 3.7× faster (p95 2.7 s → 0.7 s), because the losers no longer queue on the hot sale row.

**Why the latencies are in seconds.** This is queueing, not slow code. An idle checkout takes a few milliseconds. In this test, 1,000 requests arrive within about 1.5 s at a single Node.js process that shares 2 cores with Postgres, Redis, RabbitMQ and k6 (k6 alone used about 25% of a core during the burst). The median request mostly waits its turn. On separate machines, or with several API processes, the same design would be expected to do much better. That hasn't been measured here, so no number is claimed.

**3,000 simultaneous users saturated this box.** 301 requests timed out at the client (k6's default 60 s), and the tail went to about 59 s. Even then, the database shows exactly 100 orders. The verifier's only failure was the "k6 201 count = DB orders" comparison, which can't be evaluated when responses are lost to timeouts.

## Reproduce

```bash
# API with rate limiting off (one IP) — gate on/off via REDIS_GATE_ENABLED
RATE_LIMIT_ENABLED=false REDIS_GATE_ENABLED=true node api/dist/main.js &
node loadtest/prepare.js 1000 100
USERS=1000 k6 run loadtest/flash-sale.js      # writes loadtest/result.json
node loadtest/verify.js                       # exits non-zero if anything is inconsistent
```

## Optimisations made because of this test

- **First run (cold):** p50 was about 3.8 s at 1,000 users. A per-request lookup of product and sale rows (two DB round trips before the gate) was replaced with a 2-second in-process memo of those immutable rows. Postgres still re-checks the sale window inside the transaction.
- **Found by the test:** per-order cache invalidation was bumping the cache version on every checkout, which meant the catalogue cache never hit during a sale. Orders don't change cached data (stock is overlaid live), so the invalidation was removed from the order path.
- **Bug in the load script itself:** k6 VU ids are shared across scenarios, so indexing tokens by `__VU` handed 60 buyers an undefined token (`401`). The fix was to index by `exec.scenario.iterationInTest`.
