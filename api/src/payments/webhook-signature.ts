import { createHmac, timingSafeEqual } from 'crypto';

/** Stripe-style signature header: `t=<unix seconds>,v1=<hex hmac of "t.body">`.  The timestamp blocks replay of old captures. */
export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${mac}`;
}

export function verifySignature(secret: string, body: string, header: string | undefined, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  let given: Buffer;
  try { given = Buffer.from(parts.v1, 'hex'); } catch { return false; }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
