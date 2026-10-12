<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { MapPin, Lock, Zap, AlertTriangle, ShoppingBag, Timer } from '@lucide/vue';
import ProductArt from '@/components/ProductArt.vue';
import { api, ApiError } from '@/lib/api';
import { money, uuid } from '@/lib/format';
import { store } from '@/lib/storage';
import type { Address } from '@/lib/types';
import { useCart } from '@/stores/cart';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';

const cart = useCart();
const auth = useAuth();
const toast = useToast();
const router = useRouter();

const addr = reactive<Address>(store.get<Address>('fc-address', { name: auth.user?.name ?? '', phone: '', line1: '', city: 'Bengaluru', state: 'Karnataka', pincode: '' }));
const busy = ref(false);
const err = ref<ApiError | null>(null);

/**
 * One Idempotency-Key per checkout attempt.  Double-clicks, retries after a timeout, or a flaky network all reuse
 * the same key, so the server can only ever create ONE order for this attempt.  Changing the cart or address
 * starts a new attempt (new key).
 */
const key = ref(uuid());
watch(() => [JSON.stringify(cart.lines.map((l) => [l.productId, l.qty, l.saleId])), JSON.stringify(addr)], () => { key.value = uuid(); });

const rules: Record<keyof Address, (v: string) => string | null> = {
  name: (v) => (v.trim().length >= 2 ? null : 'Enter the recipient name'),
  phone: (v) => (/^[6-9]\d{9}$/.test(v.trim()) ? null : 'Enter a valid 10-digit mobile number'),
  line1: (v) => (v.trim().length >= 5 ? null : 'Enter the full address'),
  city: (v) => (v.trim().length >= 2 ? null : 'Enter a city'),
  state: (v) => (v.trim().length >= 2 ? null : 'Enter a state'),
  pincode: (v) => (/^\d{6}$/.test(v.trim()) ? null : 'Enter a 6-digit pincode'),
};
const touched = ref(false);
const fieldErr = (k: keyof Address) => (touched.value ? rules[k](addr[k]) : null) ?? err.value?.field(`shippingAddress.${k}`) ?? null;
const valid = computed(() => (Object.keys(rules) as Array<keyof Address>).every((k) => !rules[k](addr[k])));
const hasSale = computed(() => cart.lines.some((l) => l.saleId));

const ERRORS: Record<string, string> = {
  SOLD_OUT: 'A flash deal in your cart just sold out. Remove it to continue with the rest.',
  LIMIT_REACHED: 'You have already claimed the maximum allowed for one of these deals.',
  SALE_ENDED: 'A flash deal in your cart has ended. Remove it or add the item at the regular price.',
  SALE_NOT_STARTED: 'A deal in your cart has not opened yet.',
  OUT_OF_STOCK: 'One of the items just went out of stock.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment.',
};

async function place() {
  touched.value = true;
  if (!valid.value || !cart.lines.length) return;
  busy.value = true; err.value = null;
  store.set('fc-address', addr);
  try {
    const { order, replayed } = await api.createOrder({
      items: cart.lines.map((l) => ({ productId: l.productId, qty: l.qty, saleId: l.saleId })),
      shippingAddress: { ...addr },
    }, key.value);
    cart.clear();
    if (replayed) toast.info('Order already placed', 'We found the order from your earlier attempt.');
    else toast.success('Order placed', `${order.number} is reserved for 10 minutes. Complete payment to confirm.`);
    void router.replace(`/orders/${order.id}/pay`);
  } catch (e) {
    err.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Something went wrong');
    if (err.value.code === 'RATE_LIMITED' && err.value.retryAfter) err.value = new ApiError(429, 'RATE_LIMITED', `Too many attempts. Try again in ${err.value.retryAfter}s.`, err.value.body);
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="page">
    <div class="container">
      <h1 class="title">Checkout</h1>
      <div v-if="!cart.lines.length" class="card card-pad empty">
        <ShoppingBag :size="34" class="muted" /><h3>Your cart is empty</h3>
        <RouterLink to="/" class="btn btn-primary">Browse deals</RouterLink>
      </div>
      <div v-else class="layout">
        <section class="card card-pad stack" style="--gap: 18px">
          <div class="row"><span class="step">1</span><h2>Delivery address</h2></div>
          <div class="grid">
            <div class="field"><label for="n">Full name</label><input id="n" v-model="addr.name" class="input" :class="{ invalid: fieldErr('name') }" autocomplete="name" /><span v-if="fieldErr('name')" class="field-error">{{ fieldErr('name') }}</span></div>
            <div class="field"><label for="ph">Mobile number</label><input id="ph" v-model="addr.phone" class="input" :class="{ invalid: fieldErr('phone') }" inputmode="numeric" maxlength="10" autocomplete="tel-national" placeholder="9876543210" /><span v-if="fieldErr('phone')" class="field-error">{{ fieldErr('phone') }}</span></div>
            <div class="field span2"><label for="l1">Address</label><input id="l1" v-model="addr.line1" class="input" :class="{ invalid: fieldErr('line1') }" autocomplete="street-address" placeholder="Flat / house no, street, area" /><span v-if="fieldErr('line1')" class="field-error">{{ fieldErr('line1') }}</span></div>
            <div class="field"><label for="c">City</label><input id="c" v-model="addr.city" class="input" :class="{ invalid: fieldErr('city') }" autocomplete="address-level2" /><span v-if="fieldErr('city')" class="field-error">{{ fieldErr('city') }}</span></div>
            <div class="field"><label for="s">State</label><input id="s" v-model="addr.state" class="input" :class="{ invalid: fieldErr('state') }" autocomplete="address-level1" /><span v-if="fieldErr('state')" class="field-error">{{ fieldErr('state') }}</span></div>
            <div class="field"><label for="pin">Pincode</label><input id="pin" v-model="addr.pincode" class="input" :class="{ invalid: fieldErr('pincode') }" inputmode="numeric" maxlength="6" autocomplete="postal-code" placeholder="560001" /><span v-if="fieldErr('pincode')" class="field-error">{{ fieldErr('pincode') }}</span></div>
          </div>
          <div class="divider" />
          <div class="row"><span class="step">2</span><h2>Payment</h2></div>
          <p class="muted pay-note"><Lock :size="15" /><span>After placing the order you'll pay on the next screen (test mode). Your items are held for <b>10 minutes</b>; unpaid orders are released automatically.</span></p>
        </section>

        <aside class="card card-pad stack summary" style="--gap: 14px">
          <h2>Order summary</h2>
          <ul class="items">
            <li v-for="l in cart.lines" :key="l.productId">
              <div class="thumb"><ProductArt :category="l.category" :hue="l.hue" size="sm" /><span class="q">{{ l.qty }}</span></div>
              <div class="grow"><span class="nm">{{ l.name }}</span><span v-if="l.saleId" class="dl"><Zap :size="12" /> Flash price</span></div>
              <span class="tnum">{{ money(l.unitMinor * l.qty) }}</span>
            </li>
          </ul>
          <div class="divider" />
          <div class="spread"><span class="muted">Subtotal</span><span class="tnum">{{ money(cart.subtotal) }}</span></div>
          <div class="spread"><span class="muted">Delivery</span><span class="tnum">{{ cart.shipping ? money(cart.shipping) : 'Free' }}</span></div>
          <div v-if="cart.mrpTotal > cart.subtotal" class="spread save"><span>Total savings</span><span class="tnum">{{ money(cart.mrpTotal - cart.subtotal) }}</span></div>
          <div class="spread total"><span>To pay</span><span class="price">{{ money(cart.total) }}</span></div>

          <div v-if="err && !err.body.fields" class="alert"><AlertTriangle :size="17" /><span>{{ ERRORS[err.code] ?? err.message }}</span></div>
          <button class="btn btn-lg btn-block" :class="hasSale ? 'btn-deal' : 'btn-primary'" :disabled="busy" @click="place">
            <Timer v-if="!busy" :size="18" /> {{ busy ? 'Reserving your items…' : `Place order · ${money(cart.total)}` }}
          </button>
          <p class="subtle fine">Prices are confirmed by the server when you place the order. <span class="mono">Idempotency-Key {{ key.slice(0, 8) }}…</span></p>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.title { margin-bottom: 20px; }
.layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.step { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--brand); color: #fff; font-weight: 750; font-size: .85rem; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.span2 { grid-column: span 2; }
.pay-note { display: flex; gap: 8px; align-items: flex-start; font-size: .9rem; }
.pay-note svg { margin-top: 3px; flex: none; }
.summary { position: sticky; top: calc(var(--header-h) + 20px); }
.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.items li { display: flex; align-items: center; gap: 12px; font-size: .9rem; }
.thumb { position: relative; width: 52px; height: 52px; border-radius: 10px; overflow: hidden; flex: none; }
.q { position: absolute; top: 2px; right: 2px; min-width: 18px; height: 18px; border-radius: 9px; background: var(--text); color: var(--bg); font-size: .7rem; font-weight: 750; display: grid; place-items: center; }
.nm { display: block; font-weight: 550; line-height: 1.3; }
.dl { display: inline-flex; align-items: center; gap: 3px; font-size: .75rem; color: var(--deal); font-weight: 650; }
.save { color: var(--ok); font-weight: 600; }
.total { font-weight: 700; } .total .price { font-size: 1.35rem; }
.alert { display: flex; gap: 10px; padding: 12px; border-radius: 10px; background: var(--hot-soft); color: var(--hot); font-size: .88rem; font-weight: 550; }
.alert svg { flex: none; margin-top: 1px; }
.fine { font-size: .78rem; }
.empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .summary { position: static; } }
@media (max-width: 520px) { .grid { grid-template-columns: 1fr; } .span2 { grid-column: auto; } }
</style>
