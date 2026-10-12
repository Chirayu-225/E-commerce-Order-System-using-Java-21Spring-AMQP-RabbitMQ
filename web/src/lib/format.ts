const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Amounts are integer paise end to end; only formatting divides by 100. */
export const money = (minor: number, exact = false) => (exact || minor % 100 ? inr2 : inr).format(minor / 100);
export const compact = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const pct = (minor: number, mrp: number) => Math.round(((mrp - minor) / mrp) * 100);
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export function hms(ms: number): { d: number; h: string; m: string; s: string } {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { d, h: pad(Math.floor((t % 86400) / 3600)), m: pad(Math.floor((t % 3600) / 60)), s: pad(t % 60) };
}
export const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment', PAID: 'Confirmed', PACKED: 'Packed', SHIPPED: 'Shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', EXPIRED: 'Expired',
};
export const uuid = (): string => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
