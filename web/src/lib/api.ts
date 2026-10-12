import type { Address, Order, Page, Product, Sale, User, Notification } from './types';

export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Errors come back as RFC 7807-style problem JSON: { status, code, title, detail, ... }. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly body: Record<string, any> = {}) { super(message); }
  get retryAfter(): number | undefined { return this.body.retryAfterSec; }
  field(name: string): string | undefined { return (this.body.fields as Array<{ field: string; message: string }> | undefined)?.find((f) => f.field === name)?.message; }
}

let tokenGetter: () => string | null = () => null;
let onUnauthorized: () => void = () => {};
export function configureApi(getToken: () => string | null, unauthorized: () => void) { tokenGetter = getToken; onUnauthorized = unauthorized; }

interface Opts { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }

export async function request<T>(path: string, opts: Opts = {}): Promise<{ data: T; res: Response }> {
  const token = tokenGetter();
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: opts.method ?? 'GET',
      signal: opts.signal,
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    const retry = Number(res.headers.get('Retry-After')) || undefined;
    throw new ApiError(res.status, json?.code ?? 'HTTP_' + res.status, json?.detail ?? json?.message ?? res.statusText, { ...(json ?? {}), retryAfterSec: json?.retryAfterSec ?? retry });
  }
  return { data: json as T, res };
}
const safeJson = (t: string) => { try { return JSON.parse(t); } catch { return null; } };
const get = <T>(p: string, signal?: AbortSignal) => request<T>(p, { signal }).then((r) => r.data);
const post = <T>(p: string, body?: unknown, headers?: Record<string, string>) => request<T>(p, { method: 'POST', body: body ?? {}, headers }).then((r) => r.data);

export const api = {
  login: (email: string, password: string) => post<{ token: string; user: User }>('/api/auth/login', { email, password }),
  register: (name: string, email: string, password: string) => post<{ token: string; user: User }>('/api/auth/register', { name, email, password }),
  me: () => get<User>('/api/auth/me'),

  products: (q: Record<string, string | number | undefined>, signal?: AbortSignal) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
    return get<Page<Product>>(`/api/products?${qs}`, signal);
  },
  product: (id: string) => get<Product>(`/api/products/${id}`),
  categories: () => get<Array<{ category: string; count: number }>>('/api/categories'),
  sales: () => get<{ serverNow: string; sales: Sale[] }>('/api/flash-sales'),

  createOrder: async (body: { items: Array<{ productId: string; qty: number; saleId?: string | null }>; shippingAddress: Address }, idempotencyKey: string) => {
    const r = await request<Order>('/api/orders', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } });
    return { order: r.data, replayed: r.res.headers.get('Idempotent-Replayed') === 'true' };
  },
  orders: (page = 1) => get<Page<Order>>(`/api/orders?page=${page}`),
  order: (id: string) => get<Order>(`/api/orders/${id}`),
  cancel: (id: string) => post<Order>(`/api/orders/${id}/cancel`),
  startPayment: (orderId: string) => post<{ paymentId: string; providerRef: string; amountMinor: number; orderId: string; testMode: boolean }>(`/api/orders/${orderId}/payments`),
  simulatePay: (paymentId: string, outcome: 'success' | 'failure') => post<{ accepted: boolean }>('/api/gateway/pay', { paymentId, outcome }),

  notifications: () => get<{ unread: number; items: Notification[] }>('/api/notifications'),
  readAll: () => post<{ ok: true }>('/api/notifications/read-all'),

  admin: {
    stats: () => get<any>('/api/admin/stats'),
    integrity: () => get<{ ok: boolean; checkedAt: string; checks: Array<{ name: string; ok: boolean; detail: string }> }>('/api/admin/integrity'),
    system: () => get<any>('/api/admin/system'),
    products: () => get<any[]>('/api/admin/products'),
    orders: (status?: string, page = 1) => get<Page<Order & { userId: string }>>(`/api/admin/orders?page=${page}${status ? `&status=${status}` : ''}`),
    restock: (id: string, qty: number) => post<any>(`/api/admin/products/${id}/restock`, { qty }),
    createSale: (body: unknown) => post<Sale>('/api/admin/flash-sales', body),
    reconcile: () => post<any>('/api/admin/reconcile-gates'),
  },
};

export function streamUrl(path: string, token?: string | null): string {
  return `${API_BASE}${path}${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
}
