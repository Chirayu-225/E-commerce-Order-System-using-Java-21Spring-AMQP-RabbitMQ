import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';
import { sleep } from '../common/util';

/**
 * Cache-aside with three layers of stampede protection:
 *  1. in-process single flight  (concurrent misses on one instance share one DB query)
 *  2. a short Redis lock        (only one instance across the fleet rebuilds a hot key)
 *  3. version-based invalidation (bump one counter instead of scanning for keys to delete)
 */
@Injectable()
export class CacheService {
  private inflight = new Map<string, Promise<unknown>>();
  constructor(private readonly redis: RedisService) {}

  private verKey() { return this.redis.key('cache', 'ver'); }

  async invalidateAll(): Promise<void> {
    try { await this.redis.client.incr(this.verKey()); } catch { /* cache is best-effort */ }
  }

  async wrap<T>(name: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
    let key: string;
    try {
      const ver = (await this.redis.client.get(this.verKey())) ?? '0';
      key = this.redis.key('cache', ver, name);
      const hit = await this.redis.client.get(key);
      if (hit !== null) { this.redis.incr('cache_hit'); return JSON.parse(hit) as T; }
    } catch {
      this.redis.incr('cache_error');
      return loader(); // Redis down: serve straight from Postgres
    }

    this.redis.incr('cache_miss');
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const p = (async () => {
      const lock = this.redis.key('cache', 'lock', name);
      let gotLock = false;
      try { gotLock = (await this.redis.client.set(lock, '1', 'PX', 5000, 'NX')) === 'OK'; } catch { /* ignore */ }
      if (!gotLock) {
        // Another instance is rebuilding this key: wait briefly for its result instead of piling on the database.
        for (let i = 0; i < 10; i++) {
          await sleep(40);
          try {
            const v = await this.redis.client.get(key);
            if (v !== null) return JSON.parse(v) as T;
          } catch { break; }
        }
      }
      try {
        const value = await loader();
        try { await this.redis.client.set(key, JSON.stringify(value), 'EX', ttlSec); } catch { /* ignore */ }
        return value;
      } finally {
        if (gotLock) { try { await this.redis.client.del(lock); } catch { /* ignore */ } }
      }
    })();
    this.inflight.set(key, p);
    try { return await p; } finally { this.inflight.delete(key); }
  }
}
