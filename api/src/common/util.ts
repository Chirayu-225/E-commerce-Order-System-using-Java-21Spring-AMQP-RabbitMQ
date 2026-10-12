import { createHash, randomBytes } from 'crypto';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const randomId = (prefix: string, bytes = 9): string => `${prefix}_${randomBytes(bytes).toString('hex')}`;
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const toInt = (v: unknown, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
/** Stable JSON: object keys sorted, so equal payloads always hash equal. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
