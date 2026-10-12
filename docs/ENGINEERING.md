# Engineering notes

This document explains *why* FlashCart is built the way it is. Each section names the failure it prevents, how the code prevents it, and what was traded away. File references point at the code that does it.

## 1. Never oversell: defence in layers

**The failure.** Two requests read "1 left", both decide to sell, and both write. That is a classic read-then-write race, and under a flash sale it happens thousands of times per second.

**Layer 1: Postgres is the authority** (`api/src/orders/inventory.ops.ts`, `api/src/db/migrations/001_init.sql`). Stock is never read and then written. Every change is a single conditional statement, so "is there enough?" and "take it" cannot be separated:

```sql
UPDATE flash_sales SET claimed = claimed + $2
 WHERE id = $1 AND claimed + $2 <= quantity AND starts_at <= now() AND ends_at > now();
UPDATE inventory SET reserved = reserved + $2
 WHERE product_id = $1 AND on_hand - reserved >= $2;
```

Zero affected rows means "no", and the whole order transaction rolls back. On top of that, `CHECK` constraints encode the invariants themselves, so even a future bug in application code cannot commit an impossible state:

- `claimed <= quantity`: a sale can never be oversold
- `reserved <= on_hand`: can't reserve what isn't there
- `on_hand + sold = initial_stock`: units are never created or destroyed
- every counter `>= 0`

The per-user limit is the same pattern: an upsert on `sale_user_claims` with a guard in the `ON CONFLICT ... DO UPDATE ... WHERE`.

**Deadlocks.** A multi-item order locks several hot rows. Every code path touches them in product-id order, so two orders can never wait on each other in a cycle. `DbService.tx` still retries `40P01`/`40001` (Postgres picked a victim, and redoing the work is safe).

**Layer 2: the Redis gate is the shock absorber** (`api/src/redis/redis.service.ts`). With 1,000 buyers and 100 units, 900 requests are guaranteed to lose. Sending all of them into the same few hot Postgres rows serialises everyone behind row locks. One Lua script, executed atomically by Redis, checks the remaining count and this user's count, then decrements both or rejects. Losers get `409 SOLD_OUT` without opening a database transaction.

- The gate is *only* an optimisation. If Redis is down, the gate fails open and Postgres alone stays correct. The test suite runs the oversell scenarios with the gate disabled to prove it.
- If the database step fails for any reason, the reserved gate units are released (compensation).
- Gates are lazily rebuilt from Postgres (`SET NX` from `quantity - claimed`). The admin integrity check reports drift, and `POST /admin/reconcile-gates` rewrites them from the source of truth.
- Measured effect (see `LOADTEST.md`): checkout p95 fell from 8.1 s to 2.9 s at 1,000 concurrent buyers, with identical correctness.

**Trade-off.** Between the gate decrement and the database commit, Redis can briefly read lower than Postgres. That's acceptable: it can only cause a false "sold out" for a few milliseconds, never an oversell, and the units come back on rollback.

## 2. Idempotent checkout

**The failure.** The user double-clicks, or the mobile network drops the response and the app retries, and the customer is charged for two orders.

The client generates one `Idempotency-Key` per checkout attempt (`web/src/views/CheckoutView.vue`). It reuses that key for retries and creates a new one only when the cart or address changes. The server stores `(user_id, idempotency_key)` under a `UNIQUE` constraint, together with a hash of the request body:

- **Same key, same body:** the original order is returned with `200` and `Idempotent-Replayed: true`.
- **Same key, different body:** `422 IDEMPOTENCY_KEY_REUSED`, which is a client bug and is surfaced loudly.
- **Two identical requests racing:** both pass the "does it exist?" check, but only one `INSERT ... ON CONFLICT DO NOTHING` wins. The loser gives back its Redis gate units and returns the winner's order. A test fires 20 parallel identical requests and asserts exactly one order and one reserved unit.

## 3. Transactional outbox

**The failure.** "Save the order, then publish `order.created`." If the process dies between the two steps, the order exists but nothing ever expires it or notifies anyone. If you publish first and the transaction then rolls back, consumers act on an order that doesn't exist.

Events are inserted into an `outbox` table **in the same transaction** as the state change (`api/src/common/outbox.service.ts`). A relay (`api/src/workers/workers.service.ts`):

1. wakes on `pg_notify('outbox')` at commit, plus a 1-second poll in case a notification is lost;
2. claims a batch with `FOR UPDATE SKIP LOCKED`, so several instances can relay without colliding;
3. publishes on a confirm channel and waits for the broker's ack;
4. marks the batch published.

A crash between steps 3 and 4 republishes the batch, so delivery is **at-least-once**. Consumers therefore de-duplicate. The notifications consumer writes an `inbox(consumer, event_id)` row and the notification in one transaction, so a redelivered message is a no-op (there is a test for this). State-changing consumers are naturally idempotent because they go through the state machine with `onlyFrom` guards.

**Trade-off.** With `SKIP LOCKED` and multiple relays, events of *different* aggregates can be published out of order. Ordering per order is preserved in practice, because one transaction produces one event per step and the next step can't happen until the previous one is consumed.

## 4. Durable delayed jobs without a scheduler

Unpaid orders must release their stock after 10 minutes, and the demo warehouse must advance PAID → PACKED → SHIPPED → DELIVERED on its own.

**How.** RabbitMQ queue TTL plus dead-lettering (`api/src/mq/rabbit.service.ts`). `order.created` is routed into `q.wait.expire.<ttl>`, which has no consumers, a message TTL, and a dead-letter routing key of `task.expire`. When the TTL elapses, the broker moves the message to `q.task.expire`, whose consumer calls `OrdersService.expire()`. Messages are persistent, so a restart doesn't lose pending expiries. The TTL is part of the queue *name*, because RabbitMQ refuses to redeclare a queue with different arguments. Changing the TTL creates a new queue and the old one simply drains.

**Backstop.** A sweeper expires anything overdue every 15 s, in case a message is lost (for example, the broker was down when the event was relayed). `expire()` re-checks `status = PENDING_PAYMENT AND expires_at <= now()` under a row lock, so an early, duplicate or late message is harmless.

**Failure handling.** A consumer acks only after success. Failures are retried with backoff (an `x-attempts` header, up to 5 attempts) and then parked in `q.dead` for inspection instead of being retried forever.

## 5. Order state machine and lock ordering

`api/src/orders/order-state.ts` is the single definition of legal transitions:

```
PENDING_PAYMENT ──▶ PAID ──▶ PACKED ──▶ SHIPPED ──▶ DELIVERED
      │               │         │
      ├──▶ EXPIRED    └─────────┴──▶ CANCELLED      (CANCELLED also from PENDING_PAYMENT)
```

Every status change goes through `transition()`, which `SELECT ... FOR UPDATE`s the order row first and validates against the *true* current state. Payment success, expiry and cancellation can race on the same order. The row lock serialises them and the loser sees a state it may not leave.

**Global lock order: order row, then payment row.** The webhook handler, cancellation and expiry all follow it, so they cannot deadlock with each other.

## 6. Payments and webhooks

The browser never marks anything paid. The test-mode gateway (`POST /api/gateway/pay`) behaves like a real provider: it accepts the attempt and, about 700 ms later, calls the server's webhook with a signed event. The webhook handler (`api/src/payments/payments.service.ts`) works like this:

- **Verifies** a Stripe-style signature `t=<unix>,v1=HMAC_SHA256(secret, "t.rawBody")` against the raw request bytes (Fastify `rawBody`), with a ±5-minute timestamp tolerance against replay and a constant-time comparison.
- **De-duplicates** by provider event id (`payment_webhook_events` primary key), because gateways deliver at-least-once.
- **On success:** locks order then payment, transitions to `PAID`, converts the reservation into a sale (`reserved → sold`), and emits `order.paid`.
- **Handles late or wrong money.** If the order already expired or was cancelled, or the amount doesn't match, the payment is marked `REFUNDED` and `payment.refunded` is emitted. Stock is never resurrected for an expired order.
- **On failure:** the attempt is marked `FAILED` and the order stays payable, so the next attempt creates a new payment row.

Cancelling a paid (not yet shipped) order restocks the units (`sold → on_hand`), frees the sale claim and per-user claim, gives the Redis gate units back, and refunds.

## 7. Money

All amounts are integer **paise** end to end (Postgres `integer`, TypeScript `number` within safe-integer range). The client formats them; it never does arithmetic that is sent back. The server ignores client prices entirely and re-prices every order from the catalogue and sale tables, with free shipping at ₹499 or more.

## 8. Caching and stampede protection

`api/src/redis/cache.service.ts` is cache-aside with three protections:

1. **In-process single-flight:** concurrent misses on one instance share one query.
2. **A short Redis `SET NX` lock:** only one instance rebuilds a hot key; the others briefly wait for its result.
3. **Version-key invalidation:** bumping one counter invalidates everything, with no `KEYS` scans.

Only static data is cached (product rows, sale definitions). Stock and sale progress are overlaid live on every response, so cached pages can never show stale availability. During a stampede the checkout path also memoises immutable pricing rows in-process for 2 s, which removes two database round trips per request. Postgres still re-checks the sale window inside the transaction.

## 9. Rate limiting

Token buckets run in Redis via Lua, using `redis.call('TIME')` so instance clocks don't matter. There are two buckets: per IP (global guard) and per user on checkout. A rejected request gets `429` plus a `Retry-After` header. If Redis is unreachable the limiter fails **open**: it's a protection, not a correctness mechanism, and taking the shop down because the limiter is down would be the wrong trade.

## 10. Realtime

Order changes and stock changes are published to Redis pub/sub after commit (deferred effects in `DbService.tx`, so nothing is announced for a rolled-back transaction). Each API instance subscribes once and fans messages out to its own SSE connections (`api/src/events`). That means any instance can serve any browser, and it scales horizontally without sticky sessions.

SSE was chosen over WebSockets because the traffic is server → client only, it reconnects automatically in the browser, and it passes through ordinary HTTP proxies. `EventSource` can't send headers, so the stream endpoints, and only those, accept `?access_token=`.

The browser also corrects for a wrong local clock. `/api/flash-sales` returns `serverNow`, and countdowns run on `Date.now() + offset`, so they hit zero when the *server* opens the sale.

## 11. Observability you can demo

`GET /api/admin/integrity` recomputes every invariant from raw rows rather than trusting counters:

- **Conservation:** on-hand plus sold equals initial stock.
- **Ledger:** inventory equals the sum of the append-only `stock_movements` ledger.
- **Reserved:** equals units in unpaid orders.
- **Sold:** equals units in paid orders.
- **Sales:** no sale is oversold, and each sale's claimed counter equals its order lines.
- **Limits:** no user is over the per-user limit.
- **Payments:** every paid order has a succeeded payment.
- **Stuck work:** no stuck unpaid orders, and the outbox is draining.
- **Redis:** the gate agrees with Postgres.

Every integration test ends by asserting this endpoint is all green. `GET /api/admin/system` shows queue depths, outbox lag, cache hit ratio, pool stats and counters such as `gate_rejected`, `stock_rejected` and `rate_limited_user`.

## What I'd do next at real scale

- Run workers as a separate deployment and scale the API horizontally behind a load balancer. The code already supports this (`SKIP LOCKED`, Redis fan-out, advisory-locked seeding and migrations).
- Add a virtual waiting room in front of the hottest sales, so the arrival rate is shaped instead of absorbed.
- Shard a single hot sale's counter across N Redis keys (and N `flash_sales` sub-allocations) to remove the single-row bottleneck.
- Add OpenTelemetry tracing across HTTP → outbox → RabbitMQ → consumer, and Prometheus metrics instead of the Redis counter hash.
- Integrate a real gateway's test mode (Razorpay or Stripe) behind the existing webhook contract.
