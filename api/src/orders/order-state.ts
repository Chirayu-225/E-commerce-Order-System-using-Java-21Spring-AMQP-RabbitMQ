import { conflict } from '../common/errors';

export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED';

/**
 * The order lifecycle as an explicit state machine.  Every status change in the system goes through
 * `assertTransition`, so an order can never jump (for example from EXPIRED back to PAID).
 *
 *   PENDING_PAYMENT ──▶ PAID ──▶ PACKED ──▶ SHIPPED ──▶ DELIVERED
 *        │               │         │
 *        ├──▶ EXPIRED    └─────────┴──▶ CANCELLED          (CANCELLED is also reachable from PENDING_PAYMENT)
 */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED', 'EXPIRED'],
  PAID: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export const STOCK_COMMITTED: readonly OrderStatus[] = ['PAID', 'PACKED', 'SHIPPED', 'DELIVERED'];

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => TRANSITIONS[from].includes(to);

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw conflict('INVALID_TRANSITION', `An order cannot move from ${from} to ${to}`, { from, to });
  }
}

export const isTerminal = (s: OrderStatus): boolean => TRANSITIONS[s].length === 0;
