import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ServerResponse } from 'http';
import { RedisService } from '../redis/redis.service';

/** Fans Redis pub/sub messages out to this instance's open SSE connections (so any API instance can serve any client). */
@Injectable()
export class RealtimeHub implements OnModuleInit {
  private readonly log = new Logger('Realtime');
  private readonly clients = new Map<string, Set<ServerResponse>>();

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.subscribe((channel, payload) => {
        const set = this.clients.get(channel);
        if (!set) return;
        const type = (payload as { type?: string })?.type ?? 'message';
        const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
        for (const res of set) { try { res.write(frame); } catch { /* closed; cleaned up on 'close' */ } }
      });
    } catch (e) {
      this.log.warn(`realtime disabled (Redis unavailable): ${(e as Error).message}`);
    }
  }

  add(channel: string, res: ServerResponse): () => void {
    let set = this.clients.get(channel);
    if (!set) this.clients.set(channel, (set = new Set()));
    set.add(res);
    return () => { set!.delete(res); if (!set!.size) this.clients.delete(channel); };
  }

  get connections(): number {
    let n = 0;
    for (const s of this.clients.values()) n += s.size;
    return n;
  }

  closeAll(): void {
    for (const s of this.clients.values()) for (const r of s) { try { r.end(); } catch { /* ignore */ } }
    this.clients.clear();
  }
}
