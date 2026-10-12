import { signPayload, verifySignature } from '../src/payments/webhook-signature';

describe('webhook signatures', () => {
  const body = '{"id":"evt_1"}';
  it('accepts a valid signature', () => expect(verifySignature('s', body, signPayload('s', body))).toBe(true));
  it('rejects a wrong secret, tampered body, missing header and garbage', () => {
    expect(verifySignature('s', body, signPayload('other', body))).toBe(false);
    expect(verifySignature('s', body + ' ', signPayload('s', body))).toBe(false);
    expect(verifySignature('s', body, undefined)).toBe(false);
    expect(verifySignature('s', body, 'nonsense')).toBe(false);
  });
  it('rejects a replayed (old) signature', () => {
    const old = signPayload('s', body, 1_000_000);
    expect(verifySignature('s', body, old)).toBe(false);
  });
});
