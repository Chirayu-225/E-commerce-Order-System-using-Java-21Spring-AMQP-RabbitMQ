<script setup lang="ts">
import { computed, toRef } from 'vue';
import { useRouter } from 'vue-router';
import { Zap, ShieldCheck, Timer, ArrowRight, BellRing } from '@lucide/vue';
import ProductArt from './ProductArt.vue';
import Countdown from './Countdown.vue';
import StockBar from './StockBar.vue';
import { money, pct } from '@/lib/format';
import type { Sale } from '@/lib/types';
import { useSaleStream } from '@/lib/useSaleStream';
import { useCart } from '@/stores/cart';
import { useToast } from '@/stores/toast';
import { api } from '@/lib/api';

const props = defineProps<{ sale: Sale }>();
const emit = defineEmits<{ changed: [] }>();
const router = useRouter();
const cart = useCart();
const toast = useToast();
const { remaining: liveRemaining, live: streaming } = useSaleStream(toRef(() => props.sale.id));
const remaining = computed(() => liveRemaining.value ?? props.sale.remaining);
const isLive = computed(() => props.sale.status === 'LIVE' && remaining.value > 0);
const soldOut = computed(() => props.sale.status === 'SOLD_OUT' || (props.sale.status === 'LIVE' && remaining.value <= 0));

async function grab() {
  try {
    const p = await api.product(props.sale.productId);
    if (!cart.add(p, true)) { toast.warning('Limit reached', `Max ${props.sale.perUserLimit} per customer for this deal`); return; }
    void router.push('/checkout');
  } catch { toast.error('Could not load the deal', 'Please try again'); }
}
</script>

<template>
  <section class="hero">
    <div class="glow" />
    <div class="content">
      <div class="copy">
        <div class="row wrap" style="--gap: 8px">
          <span v-if="isLive" class="pill live"><span class="dot pulse" /> Live now</span>
          <span v-else-if="soldOut" class="pill out">Sold out</span>
          <span v-else class="pill soon"><BellRing :size="13" /> Starts soon</span>
          <span class="pill"><Zap :size="13" /> Flash sale · {{ sale.quantity }} units only</span>
          <span v-if="streaming" class="pill ghost" title="Stock updates in real time over Server-Sent Events">● real-time stock</span>
        </div>
        <span class="brand">{{ sale.product.brand }}</span>
        <h1>{{ sale.product.name }}</h1>
        <div class="prices">
          <span class="price big">{{ money(sale.salePriceMinor) }}</span>
          <span class="mrp">{{ money(sale.product.mrpMinor) }}</span>
          <span class="offp">{{ pct(sale.salePriceMinor, sale.product.mrpMinor) }}% off</span>
        </div>

        <div class="timer">
          <span class="tl"><Timer :size="15" /> {{ sale.status === 'UPCOMING' ? 'Deal opens in' : 'Deal ends in' }}</span>
          <Countdown :to="sale.status === 'UPCOMING' ? sale.startsAt : sale.endsAt" size="lg" tone="light" @done="emit('changed')" />
        </div>

        <StockBar v-if="sale.status !== 'UPCOMING'" :remaining="remaining" :total="sale.quantity" tone="light" class="sbar" />

        <div class="row wrap cta" style="--gap: 12px">
          <button v-if="isLive" class="btn btn-deal btn-lg" @click="grab"><Zap :size="18" /> Grab this deal <ArrowRight :size="17" /></button>
          <button v-else-if="soldOut" class="btn btn-lg" disabled>All units claimed</button>
          <RouterLink v-else :to="`/product/${sale.productId}`" class="btn btn-lg light-btn">View product <ArrowRight :size="17" /></RouterLink>
          <span class="assure"><ShieldCheck :size="16" /> Limit {{ sale.perUserLimit }} per customer · never oversold</span>
        </div>
      </div>
      <RouterLink :to="`/product/${sale.productId}`" class="visual" :aria-label="sale.product.name">
        <ProductArt :category="sale.product.category" :hue="sale.product.hue" size="lg" />
        <span class="tag">-{{ pct(sale.salePriceMinor, sale.product.mrpMinor) }}%</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.hero { position: relative; overflow: hidden; border-radius: var(--radius-xl); background: var(--hero-grad); color: #fff; box-shadow: var(--shadow-lg); }
.glow { position: absolute; inset: -40% -10% auto auto; width: 520px; height: 520px; border-radius: 50%; background: radial-gradient(circle, rgba(251, 191, 36, .35), transparent 65%); pointer-events: none; }
.content { position: relative; display: grid; grid-template-columns: 1.25fr 1fr; gap: 32px; padding: 40px 44px; align-items: center; }
.copy { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.pill { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 99px; font-size: .75rem; font-weight: 650; background: rgba(255, 255, 255, .14); backdrop-filter: blur(6px); }
.pill.live { background: #ef4444; }
.pill.soon { background: rgba(251, 191, 36, .9); color: #1a1205; }
.pill.out { background: rgba(255, 255, 255, .25); }
.pill.ghost { background: transparent; border: 1px solid rgba(255, 255, 255, .25); color: rgba(255, 255, 255, .85); }
.brand { font-size: .78rem; letter-spacing: .12em; text-transform: uppercase; opacity: .75; font-weight: 650; margin-top: 4px; }
h1 { color: #fff; font-size: clamp(1.5rem, 1.1rem + 1.8vw, 2.5rem); max-width: 20ch; }
.prices { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.price.big { font-size: 2.2rem; }
.mrp { color: rgba(255, 255, 255, .6); font-size: 1rem; }
.offp { color: #86efac; font-weight: 750; }
.timer { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 4px; }
.tl { display: inline-flex; align-items: center; gap: 6px; font-size: .85rem; opacity: .85; font-weight: 600; }
.sbar { max-width: 460px; }
.cta { margin-top: 6px; }
.light-btn { --b-bg: #fff; --b-fg: #1e3a8a; --b-bd: transparent; }
.light-btn:hover { background: #eef2ff; }
.assure { display: inline-flex; align-items: center; gap: 6px; font-size: .85rem; opacity: .85; }
.visual { position: relative; border-radius: 28px; overflow: hidden; box-shadow: 0 30px 60px -20px rgba(0, 0, 0, .55); transform: rotate(2deg); transition: transform .4s var(--ease); max-width: 400px; justify-self: end; width: 100%; }
.visual:hover { transform: rotate(0deg) scale(1.01); }
.tag { position: absolute; top: 16px; right: 16px; background: #fbbf24; color: #1a1205; font-weight: 800; padding: 6px 12px; border-radius: 10px; font-size: 1rem; }
@media (max-width: 860px) {
  .content { grid-template-columns: 1fr; padding: 26px 22px; gap: 22px; }
  .visual { order: -1; max-width: 240px; justify-self: start; transform: none; }
  .price.big { font-size: 1.8rem; }
}
</style>
