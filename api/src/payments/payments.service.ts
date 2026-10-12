import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig, CONFIG } from '../config/config';
import { DbService } from '../db/db.service';
import { OutboxService } from '../common/outbox.service';
import { OrdersService } from '../orders/orders.service';
import { AuthUser } from '../common/auth';
import { ApiError, conflict, notFound, parse } from '../common/errors';
import { randomId } from '../common/util';
import { EV } from '../common/events';
import { signPayload, verifySignature } from './webhook-signature';

const webhookSchema = z.object({
  id: z.string().min(4).max(100),
  type: z.enum(['payment.succeeded', 'payment.failed']),
  data: z.object({ providerRef: z.string(), amountMinor: z.number().int().nonnegative(), reason: z.string().max(200).optional() }),
});
const payBody = z.object({ paymentId: z.string().uuid(), outcome: z.enum(['success', 'failure']).default('success') });

@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly orders: OrdersService,
  ) {}

  /** Start (or resume) a payment attempt for an unpaid order.  Reuses a still-pending attempt. */
  async start(user: AuthUser, orderId: string) {
    const out = await this.db.tx(async (c) => {
      const o = await c.query<{ user_id: string; status: string; total_minor: number; expires_at: Date; number: string }>(
        `SELECT user_id, status, total_minor, expires_at, number FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      if (!o.rowCount || o.rows[0].user_id !== user.id) throw notFound('Order');
      const ord = o.rows[0];
      if (ord.status !== 'PENDING_PAYMENT') throw conflict('ORDER_NOT_PAYABLE', `This order is ${ord.status.toLowerCase().replace('_', ' ')} and cannot be paid`);
      if (ord.expires_at.getTime() <= Date.now()) throw conflict('ORDER_EXPIRED', 'The payment window for this order has elapsed');
      const existing = await c.query(`SELECT id, provider_ref, amount_minor FROM payments WHERE order_id = $1 AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1`, [orderId]);
      if (existing.rowCount) return { id: existing.rows[0].id as string, ref: existing.rows[0].provider_ref as string, amount: existing.rows[0].amount_minor as number };
      const ref = randomId('pay');
      const ins = await c.query<{ id: string }>(
        `INSERT INTO payments (order_id, provider_ref, status, amount_minor) VALUES ($1, $2, 'PENDING', $3) RETURNING id`, [orderId, ref, ord.total_minor]);
      return { id: ins.rows[0].id, ref, amount: ord.total_minor };
    });
    return { paymentId: out.id, providerRef: out.ref, amountMinor: out.amount, orderId, testMode: true, simulator: this.cfg.gatewaySimulator };
  }

  /**
   * Stand-in for the card page + the gateway's server-to-server callback.  The browser never marks an order paid:
   * only a correctly signed webhook can, exactly as with a real provider.
   */
  async simulatePay(user: AuthUser, body: unknown) {
    if (!this.cfg.gatewaySimulator) throw notFound('Resource');
    const { paymentId, outcome } = parse(payBody, body);
    const p = await this.db.query<{ provider_ref: string; amount_minor: number; user_id: string; status: string }>(
      `SELECT p.provider_ref, p.amount_minor, o.user_id, p.status FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = $1`, [paymentId]);
    if (!p.rowCount || p.rows[0].user_id !== user.id) throw notFound('Payment');
    if (p.rows[0].status !== 'PENDING') throw conflict('PAYMENT_NOT_PENDING', 'This payment attempt is already settled');
    const event = {
      id: randomId('evt'),
      type: outcome === 'success' ? 'payment.succeeded' : 'payment.failed',
      data: { providerRef: p.rows[0].provider_ref, amountMinor: p.rows[0].amount_minor, ...(outcome === 'failure' ? { reason: 'Card declined by issuer (test)' } : {}) },
    };
    const raw = JSON.stringify(event);
    const sig = signPayload(this.cfg.webhookSecret, raw);
    setTimeout(() => {
      this.processWebhook(raw, sig).catch((e) => this.log.error(`simulated webhook failed: ${(e as Error).message}`));
    }, 700);
    return { accepted: true, eventId: event.id };
  }

  async processWebhook(raw: string, signature: string | undefined): Promise<{ received: true; duplicate?: boolean; result?: string }> {
    if (!verifySignature(this.cfg.webhookSecret, raw, signature)) throw new ApiError(401, 'BAD_SIGNATURE', 'Webhook signature verification failed');
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw new ApiError(400, 'BAD_JSON', 'Malformed webhook body'); }
    const ev = parse(webhookSchema, json);

    return this.db.tx(async (c, defer) => {
      // At-least-once delivery: record the event id first; a duplicate is acknowledged and ignored.
      const seen = await c.query(`INSERT INTO payment_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id`, [ev.id]);
      if (!seen.rowCount) return { received: true as const, duplicate: true };

      const pay = await c.query<{ id: string; order_id: string }>(`SELECT id, order_id FROM payments WHERE provider_ref = $1`, [ev.data.providerRef]);
      if (!pay.rowCount) return { received: true as const, result: 'unknown_payment' };
      const orderId = pay.rows[0].order_id;

      // Lock order first, then payment: the same order everywhere, so no deadlock with expire/cancel.
      const o = await c.query<{ status: string; user_id: string; total_minor: number }>(`SELECT status, user_id, total_minor FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const p = await c.query<{ status: string; amount_minor: number }>(`SELECT status, amount_minor FROM payments WHERE id = $1 FOR UPDATE`, [pay.rows[0].id]);
      const ord = o.rows[0], payment = p.rows[0];
      if (payment.status !== 'PENDING') return { received: true as const, result: 'already_settled' };

      if (ev.type === 'payment.failed') {
        await c.query(`UPDATE payments SET status = 'FAILED', failure_reason = $2, updated_at = now() WHERE id = $1`, [pay.rows[0].id, ev.data.reason ?? 'Payment failed']);
        await this.outbox.add(c, EV.PAYMENT_FAILED, 'order', orderId, { orderId, userId: ord.user_id, reason: ev.data.reason ?? 'Payment failed' });
        defer(() => this.orders.emitOrder(ord.user_id, orderId, ord.status));
        return { received: true as const, result: 'failed' };
      }

      if (ord.status !== 'PENDING_PAYMENT' || ev.data.amountMinor !== ord.total_minor) {
        // Money arrived for an order that can no longer be fulfilled (expired/cancelled) or the amount is wrong: refund it.
        await c.query(`UPDATE payments SET status = 'REFUNDED', failure_reason = $2, updated_at = now() WHERE id = $1`,
          [pay.rows[0].id, ord.status !== 'PENDING_PAYMENT' ? `Order was ${ord.status} when payment arrived` : 'Amount mismatch']);
        await this.outbox.add(c, EV.PAYMENT_REFUNDED, 'order', orderId, { orderId, userId: ord.user_id, amountMinor: ev.data.amountMinor, late: true });
        defer(() => this.orders.emitOrder(ord.user_id, orderId, ord.status));
        return { received: true as const, result: 'refunded_late' };
      }

      await this.orders.transition(c, orderId, 'PAID', { onlyFrom: ['PENDING_PAYMENT'], note: 'Payment received', paid: true });
      await c.query(`UPDATE payments SET status = 'SUCCEEDED', updated_at = now() WHERE id = $1`, [pay.rows[0].id]);
      await this.orders.commit(c, orderId);
      await this.outbox.add(c, EV.ORDER_PAID, 'order', orderId, { orderId, userId: ord.user_id, totalMinor: ord.total_minor });
      defer(() => this.orders.emitOrder(ord.user_id, orderId, 'PAID'));
      return { received: true as const, result: 'paid' };
    });
  }
}
