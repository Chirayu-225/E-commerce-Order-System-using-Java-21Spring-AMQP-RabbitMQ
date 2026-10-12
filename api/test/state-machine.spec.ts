import { TRANSITIONS, assertTransition, canTransition, isTerminal, OrderStatus } from '../src/orders/order-state';

describe('order state machine', () => {
  const all = Object.keys(TRANSITIONS) as OrderStatus[];
  it('allows only the documented forward moves', () => {
    expect(canTransition('PENDING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransition('PAID', 'PACKED')).toBe(true);
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
  });
  it('never lets a terminal order move', () => {
    for (const s of all.filter(isTerminal)) for (const t of all) expect(canTransition(s, t)).toBe(false);
  });
  it('cannot skip steps or go backwards', () => {
    expect(canTransition('PENDING_PAYMENT', 'SHIPPED')).toBe(false);
    expect(canTransition('EXPIRED', 'PAID')).toBe(false);
    expect(canTransition('PACKED', 'PAID')).toBe(false);
    expect(canTransition('SHIPPED', 'CANCELLED')).toBe(false);
  });
  it('throws a 409 for illegal transitions', () => {
    expect(() => assertTransition('DELIVERED', 'PAID')).toThrow(/cannot move/);
  });
});
