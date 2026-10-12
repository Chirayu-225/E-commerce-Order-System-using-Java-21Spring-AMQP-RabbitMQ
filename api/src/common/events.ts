/** Domain events published through the outbox.  The string doubles as the RabbitMQ routing key. */
export const EV = {
  ORDER_CREATED: 'order.created',
  ORDER_PAID: 'order.paid',
  ORDER_PACKED: 'order.packed',
  ORDER_SHIPPED: 'order.shipped',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_EXPIRED: 'order.expired',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
} as const;

/** Internal task messages produced by dead-lettering the delay queues. */
export const TASK = {
  EXPIRE: 'task.expire',
  PACK: 'task.pack',
  SHIP: 'task.ship',
  DELIVER: 'task.deliver',
} as const;

export interface Envelope<T = any> {
  eventId: string;
  type: string;
  aggregateId: string;
  occurredAt: string;
  data: T;
}
