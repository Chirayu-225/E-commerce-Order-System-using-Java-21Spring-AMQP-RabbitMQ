export type Role = 'CUSTOMER' | 'ADMIN';
export interface User { id: string; email: string; name: string; role: Role }
export type SaleStatus = 'UPCOMING' | 'LIVE' | 'SOLD_OUT' | 'ENDED';
export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED';

export interface SaleSummary {
  id: string; salePriceMinor: number; quantity: number; remaining: number; perUserLimit: number;
  startsAt: string; endsAt: string; status: SaleStatus;
}
export interface Product {
  id: string; sku: string; name: string; brand: string; category: string; description: string;
  priceMinor: number; mrpMinor: number; discountPct: number; rating: number; ratingCount: number; hue: number;
  available: number; inStock: boolean; flashSale: SaleSummary | null;
}
export interface Sale extends SaleSummary {
  productId: string;
  product: { name: string; brand: string; category: string; hue: number; priceMinor: number; mrpMinor: number; rating: number; ratingCount: number };
}
export interface Page<T> { page: number; pageSize: number; total: number; items: T[] }
export interface Address { name: string; phone: string; line1: string; city: string; state: string; pincode: string }
export interface OrderItem { productId: string; flashSaleId: string | null; name: string; category: string; hue: number; qty: number; unitPriceMinor: number }
export interface Order {
  id: string; number: string; status: OrderStatus; subtotalMinor: number; shippingMinor: number; totalMinor: number;
  shippingAddress: Address; expiresAt: string; paidAt: string | null; cancelReason: string | null; createdAt: string; updatedAt: string;
  items: OrderItem[];
  payment: { id: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED'; providerRef: string; amountMinor: number; failureReason: string | null } | null;
  events?: Array<{ from: string | null; to: OrderStatus; note: string | null; at: string }>;
  userId?: string;
}
export interface Notification { id: string; orderId: string | null; title: string; body: string; createdAt: string; read: boolean }
