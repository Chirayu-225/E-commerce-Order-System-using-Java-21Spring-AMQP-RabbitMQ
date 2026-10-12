<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Zap, ShoppingCart, Truck, ShieldCheck, RotateCcw, ChevronRight, Minus, Plus, BellRing } from '@lucide/vue';
import ProductArt from '@/components/ProductArt.vue';
import Stars from '@/components/Stars.vue';
import Countdown from '@/components/Countdown.vue';
import StockBar from '@/components/StockBar.vue';
import { api, ApiError } from '@/lib/api';
import { money, pct } from '@/lib/format';
import type { Product } from '@/lib/types';
import { useSaleStream } from '@/lib/useSaleStream';
import { useCart, FREE_SHIPPING_MINOR } from '@/stores/cart';
import { useToast } from '@/stores/toast';

const props = defineProps<{ id: string }>();
const router = useRouter();
const cart = useCart();
const toast = useToast();
const p = ref<Product | null>(null);
const error = ref('');
const qty = ref(1);

async function load() {
  error.value = '';
  try { p.value = await api.product(props.id); document.title = `${p.value.name} · FlashCart`; }
  catch (e) { error.value = e instanceof ApiError && e.status === 404 ? 'This product does not exist.' : 'Could not load this product.'; }
}
watch(() => props.id, () => { p.value = null; qty.value = 1; void load(); }, { immediate: true });

const sale = computed(() => p.value?.flashSale ?? null);
const { remaining: liveRemaining } = useSaleStream(computed(() => (sale.value && sale.value.status !== 'UPCOMING' ? sale.value.id : null)));
const remaining = computed(() => liveRemaining.value ?? sale.value?.remaining ?? 0);
const live = computed(() => sale.value?.status === 'LIVE' && remaining.value > 0);
const price = computed(() => (live.value ? sale.value!.salePriceMinor : p.value?.priceMinor ?? 0));
const maxQty = computed(() => (live.value ? sale.value!.perUserLimit : Math.min(10, p.value?.available ?? 10)));

function add(buyNow: boolean) {
  if (!p.value) return;
  if (!cart.add(p.value, live.value, qty.value)) { toast.warning('Limit reached', `You can buy at most ${maxQty.value} of this item`); return; }
  if (buyNow) void router.push('/checkout');
  else { toast.success('Added to cart', p.value.name); cart.open = true; }
}
</script>

<template>
  <div class="page">
    <div class="container">
      <div v-if="error" class="card card-pad center-msg"><h3>{{ error }}</h3><RouterLink to="/" class="btn">Back to shop</RouterLink></div>
      <div v-else-if="!p" class="layout">
        <div class="skeleton" style="aspect-ratio: 1; border-radius: var(--radius-xl)" />
        <div class="stack"><div class="skeleton" style="height: 14px; width: 30%" /><div class="skeleton" style="height: 34px" /><div class="skeleton" style="height: 34px; width: 60%" /><div class="skeleton" style="height: 160px; margin-top: 20px" /></div>
      </div>
      <template v-else>
        <nav class="crumbs subtle"><RouterLink to="/">Home</RouterLink><ChevronRight :size="14" /><RouterLink :to="{ path: '/', query: { category: p.category }, hash: '#catalog' }">{{ p.category }}</RouterLink><ChevronRight :size="14" /><span>{{ p.brand }}</span></nav>
        <div class="layout">
          <div class="gallery card"><ProductArt :category="p.category" :hue="p.hue" size="lg" /></div>
          <div class="stack info" style="--gap: 16px">
            <div class="stack" style="--gap: 8px">
              <span class="brand">{{ p.brand }}</span>
              <h1>{{ p.name }}</h1>
              <Stars :rating="p.rating" :count="p.ratingCount" />
            </div>

            <div v-if="sale && sale.status !== 'ENDED'" class="deal" :class="{ up: sale.status === 'UPCOMING' }">
              <div class="spread wrap">
                <span class="dl"><component :is="sale.status === 'UPCOMING' ? BellRing : Zap" :size="16" />
                  {{ sale.status === 'UPCOMING' ? `Flash deal at ${money(sale.salePriceMinor)} opens in` : live ? 'Flash deal ends in' : 'Flash deal sold out' }}</span>
                <Countdown v-if="sale.status === 'UPCOMING'" :to="sale.startsAt" @done="load" />
                <Countdown v-else-if="live" :to="sale.endsAt" @done="load" />
              </div>
              <StockBar v-if="sale.status !== 'UPCOMING'" :remaining="remaining" :total="sale.quantity" />
              <span class="subtle">Limit {{ sale.perUserLimit }} per customer · price held for 10 minutes after you order</span>
            </div>

            <div class="prices">
              <span class="price big">{{ money(price) }}</span>
              <span class="mrp">MRP {{ money(p.mrpMinor) }}</span>
              <span class="off">{{ pct(price, p.mrpMinor) }}% off</span>
            </div>
            <span class="subtle">Inclusive of all taxes · {{ p.available > 0 ? (p.available < 20 ? `Only ${p.available} left in stock` : 'In stock') : 'Out of stock' }}</span>

            <div class="row wrap buy" style="--gap: 12px">
              <div class="qty">
                <button class="btn icon-btn" aria-label="Decrease quantity" :disabled="qty <= 1" @click="qty--"><Minus :size="16" /></button>
                <span class="tnum">{{ qty }}</span>
                <button class="btn icon-btn" aria-label="Increase quantity" :disabled="qty >= maxQty" @click="qty++"><Plus :size="16" /></button>
              </div>
              <button class="btn btn-lg grow" :disabled="!p.inStock" @click="add(false)"><ShoppingCart :size="18" /> Add to cart</button>
              <button class="btn btn-lg grow" :class="live ? 'btn-deal' : 'btn-primary'" :disabled="!p.inStock" @click="add(true)"><Zap v-if="live" :size="18" /> Buy now</button>
            </div>

            <div class="perks">
              <div><Truck :size="17" /><span>{{ price * qty >= FREE_SHIPPING_MINOR ? 'Free delivery' : `Free delivery over ${money(FREE_SHIPPING_MINOR)}` }}</span></div>
              <div><RotateCcw :size="17" /><span>Cancel free before shipping</span></div>
              <div><ShieldCheck :size="17" /><span>Secure test-mode checkout</span></div>
            </div>

            <div class="card card-pad stack" style="--gap: 8px">
              <h3>About this item</h3>
              <p class="muted">{{ p.description }}</p>
              <dl class="specs">
                <dt>Brand</dt><dd>{{ p.brand }}</dd>
                <dt>Category</dt><dd>{{ p.category }}</dd>
                <dt>SKU</dt><dd class="mono">{{ p.sku }}</dd>
              </dl>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.crumbs { display: flex; align-items: center; gap: 6px; margin-bottom: 18px; }
.crumbs a { color: var(--text-2); }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 40px; align-items: start; }
.gallery { overflow: hidden; border-radius: var(--radius-xl); position: sticky; top: calc(var(--header-h) + 20px); }
.brand { font-size: .78rem; letter-spacing: .1em; text-transform: uppercase; color: var(--text-3); font-weight: 650; }
.deal { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: var(--radius); background: var(--deal-soft); border: 1px solid color-mix(in srgb, var(--deal-500) 30%, transparent); }
.deal.up { background: var(--brand-soft); border-color: color-mix(in srgb, var(--brand) 25%, transparent); }
.dl { display: inline-flex; align-items: center; gap: 6px; font-weight: 650; color: var(--deal); }
.up .dl { color: var(--brand-text); }
.prices { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.price.big { font-size: 2rem; }
.qty { display: inline-flex; align-items: center; gap: 10px; padding: 3px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.qty .btn { border: 0; height: 40px; }
.qty span { min-width: 22px; text-align: center; font-weight: 700; }
.buy .grow { min-width: 160px; }
.perks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.perks div { display: flex; align-items: center; gap: 8px; font-size: .82rem; color: var(--text-2); padding: 10px 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); }
.specs { display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; margin: 6px 0 0; font-size: .9rem; }
.specs dt { color: var(--text-3); }
.specs dd { margin: 0; }
.center-msg { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 48px; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; gap: 22px; }
  .gallery { position: static; max-width: 460px; }
  .perks { grid-template-columns: 1fr; }
}
</style>
