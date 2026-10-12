import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { store } from '@/lib/storage';
import type { Product } from '@/lib/types';

export interface CartLine {
  productId: string; name: string; brand: string; category: string; hue: number;
  qty: number; unitMinor: number; mrpMinor: number;
  /** set when the line was added at a flash-sale price */
  saleId: string | null; saleEndsAt: string | null; perUserLimit: number | null;
}

export const FREE_SHIPPING_MINOR = 49_900;
export const SHIPPING_FEE_MINOR = 4_900;

/** The cart lives in the browser; prices shown here are a preview, the server re-prices every order. */
export const useCart = defineStore('cart', () => {
  const lines = ref<CartLine[]>(store.get<CartLine[]>('fc-cart', []));
  const open = ref(false);
  watch(lines, (v) => store.set('fc-cart', v), { deep: true });

  const count = computed(() => lines.value.reduce((a, l) => a + l.qty, 0));
  const subtotal = computed(() => lines.value.reduce((a, l) => a + l.qty * l.unitMinor, 0));
  const mrpTotal = computed(() => lines.value.reduce((a, l) => a + l.qty * l.mrpMinor, 0));
  const shipping = computed(() => (subtotal.value === 0 || subtotal.value >= FREE_SHIPPING_MINOR ? 0 : SHIPPING_FEE_MINOR));
  const total = computed(() => subtotal.value + shipping.value);

  function maxQty(l: Pick<CartLine, 'perUserLimit' | 'saleId'>) { return l.saleId && l.perUserLimit ? l.perUserLimit : 10; }

  /** Adds a product.  A live flash sale price is used when `useSale` is true. Returns false if a limit blocks it. */
  function add(p: Product, useSale: boolean, qty = 1): boolean {
    const sale = useSale && p.flashSale && p.flashSale.status === 'LIVE' ? p.flashSale : null;
    const existing = lines.value.find((l) => l.productId === p.id);
    if (existing && (existing.saleId ?? null) !== (sale?.id ?? null)) {
      // switching between sale and regular price replaces the line
      lines.value = lines.value.filter((l) => l !== existing);
    } else if (existing) {
      if (existing.qty + qty > maxQty(existing)) return false;
      existing.qty += qty;
      return true;
    }
    lines.value.push({
      productId: p.id, name: p.name, brand: p.brand, category: p.category, hue: p.hue, qty,
      unitMinor: sale ? sale.salePriceMinor : p.priceMinor, mrpMinor: p.mrpMinor,
      saleId: sale?.id ?? null, saleEndsAt: sale?.endsAt ?? null, perUserLimit: sale?.perUserLimit ?? null,
    });
    return true;
  }
  function setQty(productId: string, qty: number) {
    const l = lines.value.find((x) => x.productId === productId);
    if (!l) return;
    if (qty <= 0) remove(productId); else l.qty = Math.min(qty, maxQty(l));
  }
  function remove(productId: string) { lines.value = lines.value.filter((l) => l.productId !== productId); }
  function clear() { lines.value = []; }
  /** Drop sale pricing from lines whose sale has ended (they fall back to... removal, since price would change). */
  function pruneExpired(now: number) { lines.value = lines.value.filter((l) => !l.saleEndsAt || Date.parse(l.saleEndsAt) > now); }

  return { lines, open, count, subtotal, mrpTotal, shipping, total, add, setQty, remove, clear, pruneExpired, maxQty };
});
