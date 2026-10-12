import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import type { Channel, ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import { AppConfig, CONFIG } from '../config/config';
import { sleep } from '../common/util';
import { Envelope, TASK } from '../common/events';

/** Broker objects are namespaced by REDIS_PREFIX so tests (and several environments sharing one broker) never see each other's messages. */
const ns = (cfg: AppConfig): string => (cfg.redisPrefix === 'fc:' ? '' : `${cfg.redisPrefix.replace(/[^a-z0-9]/gi, '')}.`);
export const exchangeName = (cfg: AppConfig): string => `${ns(cfg)}flashcart.events`;
const MAX_ATTEMPTS = 5;

export interface QueueNames {
  waitExpire: string; taskExpire: string;
  waitPack: string; taskPack: string;
  waitShip: string; taskShip: string;
  waitDeliver: string; taskDeliver: string;
  notifications: string; dead: string;
}

/**
 * Delay queues carry the TTL in their NAME.  RabbitMQ refuses to re-declare a queue with different
 * arguments, so changing a delay creates a fresh queue and the old one simply drains - nothing is dropped.
 */
export function queueNames(cfg: AppConfig): QueueNames {
  const d = cfg.fulfilmentDelaysMs;
  const p = ns(cfg);
  return {
    waitExpire: `${p}q.wait.expire.${cfg.orderTtlMs}`, taskExpire: `${p}q.task.expire`,
    waitPack: `${p}q.wait.pack.${d.pack}`, taskPack: `${p}q.task.pack`,
    waitShip: `${p}q.wait.ship.${d.ship}`, taskShip: `${p}q.task.ship`,
    waitDeliver: `${p}q.wait.deliver.${d.deliver}`, taskDeliver: `${p}q.task.deliver`,
    notifications: `${p}q.notifications`, dead: `${p}q.dead`,
  };
}

interface ConsumerReg { queue: string; handler: (e: Envelope) => Promise<void>; prefetch: number }

@Injectable()
export class RabbitService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Rabbit');
  readonly queues: QueueNames;
  private readonly exchange: string;
  private conn?: ChannelModel;
  private pub?: ConfirmChannel;
  private con?: Channel;
  private closing = false;
  private connecting = false;
  private ready = false;
  private waiters: Array<() => void> = [];
  private readonly consumers: ConsumerReg[] = [];

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.queues = queueNames(cfg);
    this.exchange = exchangeName(cfg);
  }

  onModuleInit(): void {
    void this.connectLoop();
  }

  get isReady(): boolean { return this.ready; }

  async whenReady(timeoutMs = 10_000): Promise<void> {
    if (this.ready) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('RabbitMQ not available')), timeoutMs);
      this.waiters.push(() => { clearTimeout(t); resolve(); });
    });
  }

  private async connectLoop(): Promise<void> {
    if (this.connecting || this.closing) return;
    this.connecting = true;
    let attempt = 0;
    while (!this.closing) {
      try {
        const conn = await amqp.connect(this.cfg.rabbitUrl);
        this.conn = conn;
        conn.on('error', (e) => this.log.warn(`connection error: ${e.message}`));
        conn.on('close', () => {
          this.ready = false;
          if (!this.closing) { this.log.warn('connection closed, reconnecting'); void this.connectLoop(); }
        });
        this.pub = await conn.createConfirmChannel();
        this.pub.on('error', (e) => this.log.warn(`publish channel error: ${e.message}`));
        const setup = await conn.createChannel();
        await this.assertTopology(setup);
        await setup.close();
        this.con = await conn.createChannel();
        this.con.on('error', (e) => this.log.warn(`consume channel error: ${e.message}`));
        for (const c of this.consumers) await this.attach(c);
        this.ready = true;
        this.waiters.splice(0).forEach((w) => w());
        this.log.log('connected, topology ready');
        break;
      } catch (e) {
        attempt++;
        this.log.warn(`connect attempt ${attempt} failed: ${(e as Error).message}`);
        try { await this.conn?.close(); } catch { /* ignore */ }
        await sleep(Math.min(5000, 250 * 2 ** Math.min(attempt, 5)));
      }
    }
    this.connecting = false;
  }

  /**
   * Topology: one topic exchange; "wait" queues have a TTL and dead-letter into the exchange under a
   * task.* key, which is how we get durable delayed jobs (order expiry, warehouse steps) without a scheduler.
   */
  private async assertTopology(ch: Channel): Promise<void> {
    const q = this.queues;
    const d = this.cfg.fulfilmentDelaysMs;
    await ch.assertExchange(this.exchange, 'topic', { durable: true });
    const delay = async (wait: string, ttl: number, bindKey: string, taskKey: string, taskQueue: string) => {
      await ch.assertQueue(taskQueue, { durable: true });
      await ch.bindQueue(taskQueue, this.exchange, taskKey);
      await ch.assertQueue(wait, {
        durable: true,
        arguments: { 'x-message-ttl': ttl, 'x-dead-letter-exchange': this.exchange, 'x-dead-letter-routing-key': taskKey },
      });
      await ch.bindQueue(wait, this.exchange, bindKey);
    };
    await delay(q.waitExpire, this.cfg.orderTtlMs, 'order.created', TASK.EXPIRE, q.taskExpire);
    await delay(q.waitPack, d.pack, 'order.paid', TASK.PACK, q.taskPack);
    await delay(q.waitShip, d.ship, 'order.packed', TASK.SHIP, q.taskShip);
    await delay(q.waitDeliver, d.deliver, 'order.shipped', TASK.DELIVER, q.taskDeliver);
    await ch.assertQueue(q.notifications, { durable: true });
    await ch.bindQueue(q.notifications, this.exchange, 'order.*');
    await ch.bindQueue(q.notifications, this.exchange, 'payment.*');
    await ch.assertQueue(q.dead, { durable: true });
    await ch.bindQueue(q.dead, this.exchange, 'dead.#');
  }

  /** Publish a batch and wait for the broker's confirm: resolves only once RabbitMQ has persisted every message. */
  async publishBatch(items: Array<{ routingKey: string; envelope: Envelope }>): Promise<void> {
    await this.whenReady();
    const pub = this.pub!;
    for (const { routingKey, envelope } of items) {
      pub.publish(this.exchange, routingKey, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        messageId: envelope.eventId,
        contentType: 'application/json',
        type: routingKey,
        timestamp: Date.now(),
      });
    }
    await pub.waitForConfirms();
  }

  async consume(queue: string, handler: (e: Envelope) => Promise<void>, prefetch = 8): Promise<void> {
    const reg: ConsumerReg = { queue, handler, prefetch };
    this.consumers.push(reg);
    if (this.ready) await this.attach(reg);
  }

  private async attach(reg: ConsumerReg): Promise<void> {
    const ch = this.con!;
    await ch.prefetch(reg.prefetch);
    await ch.consume(reg.queue, (msg) => { if (msg) void this.dispatch(ch, reg, msg); });
  }

  /** At-least-once delivery: ack only after the handler succeeds; retry with backoff; park poison messages in q.dead. */
  private async dispatch(ch: Channel, reg: ConsumerReg, msg: ConsumeMessage): Promise<void> {
    let env: Envelope;
    try {
      env = JSON.parse(msg.content.toString()) as Envelope;
    } catch {
      this.log.error(`unparseable message on ${reg.queue}, dropping`);
      ch.nack(msg, false, false);
      return;
    }
    try {
      await reg.handler(env);
      ch.ack(msg);
    } catch (e) {
      const attempts = Number(msg.properties.headers?.['x-attempts'] ?? 0) + 1;
      this.log.warn(`handler for ${reg.queue} failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${(e as Error).message}`);
      try {
        if (attempts >= MAX_ATTEMPTS) {
          this.pub!.publish(this.exchange, `dead.${reg.queue}`, msg.content, {
            persistent: true, messageId: msg.properties.messageId,
            headers: { 'x-error': (e as Error).message, 'x-origin-queue': reg.queue },
          });
        } else {
          await sleep(300 * attempts);
          this.pub!.sendToQueue(reg.queue, msg.content, {
            persistent: true, messageId: msg.properties.messageId,
            headers: { ...(msg.properties.headers ?? {}), 'x-attempts': attempts },
          });
        }
        await this.pub!.waitForConfirms();
        ch.ack(msg);
      } catch {
        try { ch.nack(msg, false, true); } catch { /* channel already closed; broker will redeliver */ }
      }
    }
  }

  async queueDepths(): Promise<Array<{ queue: string; messages: number; consumers: number }>> {
    if (!this.ready || !this.conn) return [];
    const out: Array<{ queue: string; messages: number; consumers: number }> = [];
    const ch = await this.conn.createChannel();
    try {
      for (const name of Object.values(this.queues)) {
        const r = await ch.checkQueue(name);
        out.push({ queue: name, messages: r.messageCount, consumers: r.consumerCount });
      }
    } catch { /* queue missing: report what we have */ } finally {
      try { await ch.close(); } catch { /* ignore */ }
    }
    return out;
  }

  /** Test helper: empty every queue so each test starts from a clean broker. */
  async resetForTests(): Promise<void> {
    await this.whenReady();
    const ch = await this.conn!.createChannel();
    await this.assertTopology(ch);
    // purge (not delete) so attached consumers survive
    for (const name of Object.values(this.queues)) await ch.purgeQueue(name);
    await ch.close();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    try { await this.pub?.close(); } catch { /* ignore */ }
    try { await this.con?.close(); } catch { /* ignore */ }
    try { await this.conn?.close(); } catch { /* ignore */ }
  }
}
