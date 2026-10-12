<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { Zap, Plus, Check } from '@lucide/vue';
import ProductArt from './ProductArt.vue';
import Stars from './Stars.vue';
import { money, pct } from '@/lib/format';
import type { Product } from '@/lib/types';
import { useCart } from '@/stores/cart';
import { useToast } from '@/stores/toast';

const props = defineProps<{ product: Product }>();
const cart = useCart();
const toast = useToast();
const live = computed(() => props.product.flashSale?.status === 'LIVE' ? props.product.flashSale : null);
const upcoming = computed(() => props.product.flashSale?.status === 'UPCOMING' ? props.product.flashSale : null);
const price = computed(() => live.value?.salePriceMinor ?? props.product.priceMinor);
const inCart = computed(() => cart.lines.some((l) => l.productId === props.product.id));

function add() {
  if (!props.product.inStock) return;
  if (cart.add(props.product, !!live.value)) toast.success('Added to cart', props.product.name);
  else toast.warning('Limit reached', `You can buy at most ${live.value?.perUserLimit ?? 10} of this item`);
}
</script>

<template>
  <article class="pc card">
    <RouterLink :to="`/product/${product.id}`" class="media" :aria-label="product.name">
      <ProductArt :category="product.category" :hue="product.hue" />
      <span v-if="live" class="flag hot"><Zap :size="12" /> Flash deal</span>
      <span v-else-if="upcoming" class="flag up">Deal soon</span>
      <span v-if="!product.inStock" class="oos">Out of stock</span>
    </RouterLink>
    <div class="body">
      <span class="brand">{{ product.brand }}</span>
      <RouterLink :to="`/product/${product.id}`" class="name">{{ product.name }}</RouterLink>
      <Stars :rating="product.rating" :count="product.ratingCount" />
      <div class="prices">
        <span class="price">{{ money(price) }}</span>
        <span class="mrp">{{ money(product.mrpMinor) }}</span>
        <span class="off">{{ pct(price, product.mrpMinor) }}% off</span>
      </div>
      <button class="btn btn-sm add" :class="live ? 'btn-deal' : ''" :disabled="!product.inStock" @click="add">
        <component :is="inCart ? Check : Plus" :size="15" />
        {{ !product.inStock ? 'Sold out' : inCart ? 'Add another' : 'Add to cart' }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.pc { display: flex; flex-direction: column; overflow: hidden; transition: transform .2s var(--ease), box-shadow .2s var(--ease), border-color .2s; }
.pc:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: var(--border-strong); }
.media { position: relative; display: block; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
.flag { position: absolute; top: 10px; left: 10px; display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; font-size: .72rem; font-weight: 700; }
.flag.hot { background: linear-gradient(135deg, #f59e0b, #f97316); color: #1a1205; }
.flag.up { background: var(--surface); color: var(--brand-text); box-shadow: var(--shadow-sm); }
.oos { position: absolute; inset: auto 0 0 0; padding: 6px; text-align: center; font-size: .8rem; font-weight: 700; background: var(--overlay); color: #fff; }
.body { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px 14px; flex: 1; }
.brand { font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; color: var(--text-3); font-weight: 650; }
.name { color: var(--text); font-weight: 600; font-size: .92rem; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.7em; }
.name:hover { color: var(--brand-text); text-decoration: none; }
.prices { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.prices .price { font-size: 1.1rem; }
.add { margin-top: auto; }
@media (max-width: 520px) { .body { padding: 10px; } .prices .price { font-size: 1rem; } }
</style>
