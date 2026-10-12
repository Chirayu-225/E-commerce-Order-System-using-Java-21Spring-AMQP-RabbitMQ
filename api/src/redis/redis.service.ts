import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config/config';

/**
 * KEYS[1] = remaining units for the sale   KEYS[2] = units this user already holds
 * ARGV[1] = qty wanted                     ARGV[2] = per-user limit
 * Returns {code, remaining}: 1 = reserved, 0 = sold out, -1 = gate not initialised, -2 = per-user limit hit.
 * One Lua script = one atomic step in Redis, so thousands of buyers can never take the same unit.
 */
const GATE_RESERVE = `
local remaining = redis.call('GET', KEYS[1])
if remaining == false then return {-1, 0} end
remaining = tonumber(remaining)
local qty = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local bought = tonumber(redis.call('GET', KEYS[2]) or '0')
if bought + qty > limit then return {-2, remaining} end
if remaining < qty then return {0, remaining} end
redis.call('DECRBY', KEYS[1], qty)
redis.call('INCRBY', KEYS[2], qty)
redis.call('EXPIRE', KEYS[2], 604800)
return {1, remaining - qty}
`;

const GATE_RELEASE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
local remaining = redis.call('INCRBY', KEYS[1], ARGV[1])
local bought = tonumber(redis.call('GET', KEYS[2]) or '0') - tonumber(ARGV[1])
if bought < 0 then bought = 0 end
redis.call('SET', KEYS[2], bought, 'EX', 604800)
return remaining
`;

/** Token bucket: refills continuously at ARGV[2]/s up to ARGV[1] tokens.  Returns {allowed, retryAfterMs}. */
const TOKEN_BUCKET = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity; ts = now end
tokens = math.min(capacity, tokens + (math.max(0, now - ts) / 1000) * rate)
local allowed = 0
local retry = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 else retry = math.ceil(((cost - tokens) / rate) * 1000) end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity / rate) * 1000) + 1000)
return {allowed, retry}
`;

export type GateResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: 'SOLD_OUT' | 'LIMIT' | 'UNINIT'; remaining: number };

type RedisWithScripts = Redis & {
  gateReserve(k1: string, k2: string, qty: number, limit: number): Promise<[number, number]>;
  gateRelease(k1: string, k2: string, qty: number): Promise<number>;
  tokenBucket(k: string, capacity: number, rate: number, cost: number): Promise<[number, number]>;
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger('Redis');
  readonly client: RedisWithScripts;
  private sub?: Redis;
  readonly prefix: string;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.prefix = cfg.redisPrefix;
    const r = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 1, commandTimeout: 2000, enableReadyCheck: true });
    r.on('error', (e) => this.log.warn(`redis error: ${e.message}`));
    r.defineCommand('gateReserve', { numberOfKeys: 2, lua: GATE_RESERVE });
    r.defineCommand('gateRelease', { numberOfKeys: 2, lua: GATE_RELEASE });
    r.defineCommand('tokenBucket', { numberOfKeys: 1, lua: TOKEN_BUCKET });
    this.client = r as RedisWithScripts;
  }

  key(...parts: Array<string | number>): string {
    return this.prefix + parts.join(':');
  }

  async ping(): Promise<boolean> {
    try { return (await this.client.ping()) === 'PONG'; } catch { return false; }
  }

  // ---- flash-sale stock gate -------------------------------------------------------------
  private gateKey(saleId: string) { return this.key('sale', saleId, 'remaining'); }
  private userKey(saleId: string, userId: string) { return this.key('sale', saleId, 'user', userId); }

  async gateReserve(saleId: string, userId: string, qty: number, limit: number): Promise<GateResult> {
    const [code, remaining] = await this.client.gateReserve(this.gateKey(saleId), this.userKey(saleId, userId), qty, limit);
    if (code === 1) return { ok: true, remaining };
    return { ok: false, reason: code === 0 ? 'SOLD_OUT' : code === -2 ? 'LIMIT' : 'UNINIT', remaining };
  }
  async gateRelease(saleId: string, userId: string, qty: number): Promise<number> {
    return this.client.gateRelease(this.gateKey(saleId), this.userKey(saleId, userId), qty);
  }
  async gateRemaining(saleId: string): Promise<number | null> {
    const v = await this.client.get(this.gateKey(saleId));
    return v === null ? null : Number(v);
  }
  /** Initialise only if absent (SET NX): many instances can race to do this safely. */
  async gateInit(saleId: string, remaining: number): Promise<void> {
    await this.client.set(this.gateKey(saleId), String(Math.max(0, remaining)), 'EX', 7 * 24 * 3600, 'NX');
  }
  async gateSet(saleId: string, remaining: number): Promise<void> {
    await this.client.set(this.gateKey(saleId), String(Math.max(0, remaining)), 'EX', 7 * 24 * 3600);
  }

  // ---- rate limiting ---------------------------------------------------------------------
  async takeToken(bucket: string, capacity: number, perSec: number, cost = 1): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const [allowed, retry] = await this.client.tokenBucket(this.key('rl', bucket), capacity, perSec, cost);
    return { allowed: allowed === 1, retryAfterMs: retry };
  }

  // ---- realtime fan-out (Redis pub/sub so every API instance can push to its own SSE clients) ----
  async publish(channel: string, payload: unknown): Promise<void> {
    await this.client.publish(this.key('rt', channel), JSON.stringify(payload));
  }
  async subscribe(handler: (channel: string, payload: unknown) => void): Promise<void> {
    this.sub = new Redis(this.cfg.redisUrl, { maxRetriesPerRequest: null });
    this.sub.on('error', (e) => this.log.warn(`subscriber error: ${e.message}`));
    const base = this.key('rt', '');
    await this.sub.psubscribe(`${base}*`);
    this.sub.on('pmessage', (_p, ch, msg) => {
      try { handler(ch.slice(base.length), JSON.parse(msg)); } catch { /* ignore malformed */ }
    });
  }

  // ---- tiny counters for the admin "system" panel ----------------------------------------
  incr(metric: string, by = 1): void {
    this.client.hincrby(this.key('metrics'), metric, by).catch(() => undefined);
  }
  async metrics(): Promise<Record<string, number>> {
    try {
      const h = await this.client.hgetall(this.key('metrics'));
      return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v)]));
    } catch { return {}; }
  }

  /** Delete every key this app owns under its prefix (tests / demo reset). */
  async flushOwned(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${this.prefix}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length) await this.client.del(...keys);
    } while (cursor !== '0');
  }

  async onModuleDestroy(): Promise<void> {
    try { await this.sub?.quit(); } catch { /* ignore */ }
    try { await this.client.quit(); } catch { /* ignore */ }
  }
}
