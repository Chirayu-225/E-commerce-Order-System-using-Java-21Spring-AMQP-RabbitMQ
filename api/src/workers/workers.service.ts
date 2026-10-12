import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { DbService } from '../db/db.service';
import { RabbitService, queueNames } from '../mq/rabbit.service';
import { RedisService } from '../redis/redis.service';
import { OrdersService } from '../orders/orders.service';
import { Envelope, EV } from '../common/events';

const NOTE: Record<string, (n: string, d: any) => [string, string]> = {
  [EV.ORDER_CREATED]: (n) => ['Order placed', `Order ${n} is reserved for you. Complete payment to confirm it.`],
  [EV.ORDER_PAID]: (n) => ['Payment received', `Thanks! Order ${n} is confirmed and will be packed shortly.`],
  [EV.ORDER_PACKED]: (n) => ['Order packed', `Order ${n} has been packed and is waiting for pickup.`],
  [EV.ORDER_SHIPPED]: (n) => ['Order shipped', `Order ${n} is on its way.`],
  [EV.ORDER_DELIVERED]: (n) => ['Order delivered', `Order ${n} was delivered. Enjoy!`],
  [EV.ORDER_CANCELLED]: (n) => ['Order cancelled', `Order ${n} was cancelled.`],
  [EV.ORDER_EXPIRED]: (n) => ['Order expired', `Order ${n} was not paid in time, so the items were released.`],
  [EV.PAYMENT_FAILED]: (n, d) => ['Payment failed', `${d?.reason ?? 'Your payment did not go through'}. You can try again for order ${n}.`],
  [EV.PAYMENT_REFUNDED]: (n) => ['Refund initiated', `Your payment for order ${n} is being refunded.`],
};

/** Background work: outbox relay, queue consumers, expiry sweeper. Runs inside the API process (RUN_WORKERS=false to disable). */
@Injectable()
export class WorkersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Workers');
  private timers: NodeJS.Timeout[] = [];
  private stopListen?: () => Promise<void>;
  private draining = false;
  private again = false;
  private stopped = false;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly db: DbService,
    private readonly rabbit: RabbitService,
    private readonly redis: RedisService,
    private readonly orders: OrdersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.runWorkers) { this.log.log('workers disabled'); return; }
    const q = queueNames(this.cfg);
    const advance = (to: 'PACKED' | 'SHIPPED' | 'DELIVERED') => async (e: Envelope) => { await this.orders.advance(e.aggregateId, to); };
    await this.rabbit.consume(q.taskExpire, async (e) => { await this.orders.expire(e.aggregateId); });
    await this.rabbit.consume(q.taskPack, advance('PACKED'));
    await this.rabbit.consume(q.taskShip, advance('SHIPPED'));
    await this.rabbit.consume(q.taskDeliver, advance('DELIVERED'));
    await this.rabbit.consume(q.notifications, (e) => this.notify(e));

    this.stopListen = await this.db.listen('outbox', () => void this.drain());
    this.timers.push(setInterval(() => void this.drain(), 1000));
    this.timers.push(setInterval(() => void this.orders.sweepExpired().catch((e) => this.log.warn(e.message)), 15_000));
    void this.drain();
    this.log.log('workers started (outbox relay, consumers, sweeper)');
  }

  /**
   * Outbox relay: publish committed events to RabbitMQ and mark them published.  Rows are claimed with
   * FOR UPDATE SKIP LOCKED so several API instances can run it without double-publishing the same batch.
   * A crash between publish and mark means a re-publish later: delivery is at-least-once, consumers de-duplicate.
   */
  async drain(): Promise<void> {
    if (this.stopped) return;
    if (this.draining) { this.again = true; return; }
    this.draining = true;
    try {
      do {
        this.again = false;
        for (;;) {
          const n = await this.db.tx(async (c) => {
            const r = await c.query(
              `SELECT id, event_id, type, aggregate_id, payload, created_at FROM outbox
                WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`);
            if (!r.rowCount) return 0;
            await this.rabbit.publishBatch(r.rows.map((x) => ({
              routingKey: x.type,
              envelope: { eventId: x.event_id, type: x.type, aggregateId: x.aggregate_id, occurredAt: new Date(x.created_at).toISOString(), data: x.payload },
            })));
            await c.query(`UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::bigint[])`, [r.rows.map((x) => x.id)]);
            return r.rowCount!;
          });
          if (!n) break;
          this.redis.incr('outbox_published', n);
        }
      } while (this.again && !this.stopped);
    } catch (e) {
      if (!this.stopped) this.log.warn(`outbox relay: ${(e as Error).message} (will retry)`);
    } finally {
      this.draining = false;
    }
  }

  /** Notification consumer.  The inbox row and the notification commit together, so a redelivered message is a no-op. */
  private async notify(e: Envelope): Promise<void> {
    const tpl = NOTE[e.type];
    const userId: string | undefined = e.data?.userId;
    if (!tpl || !userId) return;
    const made = await this.db.tx(async (c) => {
      const seen = await c.query(`INSERT INTO inbox (consumer, event_id) VALUES ('notifications', $1) ON CONFLICT DO NOTHING RETURNING event_id`, [e.eventId]);
      if (!seen.rowCount) return null;
      const num = await c.query<{ number: string }>(`SELECT number FROM orders WHERE id = $1`, [e.aggregateId]);
      if (!num.rowCount) return null;
      const [title, body] = tpl(num.rows[0].number, e.data);
      await c.query(`INSERT INTO notifications (user_id, order_id, title, body) VALUES ($1, $2, $3, $4)`, [userId, e.aggregateId, title, body]);
      return { title, body };
    });
    if (made) {
      this.redis.incr('notifications_created');
      void this.redis.publish(`user:${userId}`, { type: 'notification', ...made }).catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    await this.stopListen?.().catch(() => undefined);
  }
}
