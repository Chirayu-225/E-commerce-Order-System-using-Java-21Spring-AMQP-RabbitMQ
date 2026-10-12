<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Zap, ShieldCheck, Activity, Clock, PackageSearch, SlidersHorizontal, ServerCrash } from '@lucide/vue';
import FlashHero from '@/components/FlashHero.vue';
import ProductCard from '@/components/ProductCard.vue';
import ProductArt from '@/components/ProductArt.vue';
import Countdown from '@/components/Countdown.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { api, ApiError } from '@/lib/api';
import { money, pct } from '@/lib/format';
import type { Product, Sale } from '@/lib/types';
import { useClock } from '@/stores/clock';

const route = useRoute();
const router = useRouter();
const clock = useClock();

// ---- flash sales ----
const sales = ref<Sale[]>([]);
const salesLoading = ref(true);
async function loadSales() {
  const t0 = performance.now();
  try {
    const r = await api.sales();
    clock.sync(r.serverNow, performance.now() - t0);
    sales.value = r.sales;
  } catch { /* keep last */ } finally { salesLoading.value = false; }
}
const featured = computed(() => sales.value.find((s) => s.status === 'LIVE') ?? sales.value.find((s) => s.status === 'UPCOMING') ?? sales.value.find((s) => s.status === 'SOLD_OUT') ?? null);
const others = computed(() => sales.value.filter((s) => s !== featured.value).sort((a, b) => order(a) - order(b)));
const order = (s: Sale) => ({ LIVE: 0, UPCOMING: 1, SOLD_OUT: 2, ENDED: 3 }[s.status]);

// ---- catalogue ----
const categories = ref<Array<{ category: string; count: number }>>([]);
const items = ref<Product[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(true);
const loadingMore = ref(false);
const loadError = ref('');
const category = computed(() => String(route.query.category ?? ''));
const sort = computed(() => String(route.query.sort ?? 'popular'));
const q = computed(() => String(route.query.q ?? ''));
let ctrl: AbortController | null = null;

async function loadProducts(reset = true) {
  ctrl?.abort();
  ctrl = new AbortController();
  if (reset) { page.value = 1; loading.value = true; } else loadingMore.value = true;
  loadError.value = '';
  try {
    const r = await api.products({ category: category.value, sort: sort.value, q: q.value, page: page.value, pageSize: 12 }, ctrl.signal);
    items.value = reset ? r.items : [...items.value, ...r.items];
    total.value = r.total;
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      if (reset) { items.value = []; total.value = 0; }
      loadError.value = e instanceof ApiError && e.status === 0
        ? 'Cannot reach the FlashCart API. Make sure the backend is running on port 8080.'
        : `The server returned an error${e instanceof ApiError ? ` (${e.status} ${e.code})` : ''}.`;
    }
  } finally { loading.value = false; loadingMore.value = false; }
}
function more() { page.value++; void loadProducts(false); }
function setQuery(patch: Record<string, string | undefined>) {
  const next = { ...route.query, ...patch };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  void router.replace({ query: next, hash: '#catalog' });
}
watch(() => [category.value, sort.value, q.value], () => loadProducts(true));

let timer: number | undefined;
onMounted(async () => {
  void loadSales();
  void loadProducts(true);
  api.categories().then((c) => (categories.value = c)).catch(() => undefined);
  timer = window.setInterval(loadSales, 20_000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="page">
    <div class="container stack" style="--gap: 28px">
      <!-- hero -->
      <div v-if="salesLoading" class="skeleton hero-skel" />
      <FlashHero v-else-if="featured" :sale="featured" @changed="loadSales" />

      <!-- value props -->
      <section class="props">
        <div class="prop"><span class="pi"><ShieldCheck :size="18" /></span><div><b>Never oversold</b><span class="subtle">Stock is reserved atomically in the database</span></div></div>
        <div class="prop"><span class="pi"><Clock :size="18" /></span><div><b>10-minute hold</b><span class="subtle">Your deal is held while you pay</span></div></div>
        <div class="prop"><span class="pi"><Activity :size="18" /></span><div><b>Live stock</b><span class="subtle">Counts update in real time</span></div></div>
        <div class="prop"><span class="pi"><Zap :size="18" /></span><div><b>Fair limits</b><span class="subtle">Per-customer caps on every deal</span></div></div>
      </section>

      <!-- other sales -->
      <section v-if="others.length" class="stack" style="--gap: 14px">
        <div class="spread"><h2>More flash deals</h2></div>
        <div class="deals">
          <RouterLink v-for="s in others" :key="s.id" :to="`/product/${s.productId}`" class="deal card" :class="{ dim: s.status === 'ENDED' || s.status === 'SOLD_OUT' }">
            <div class="dthumb"><ProductArt :category="s.product.category" :hue="s.product.hue" size="sm" /></div>
            <div class="grow stack" style="--gap: 6px">
              <div class="spread"><StatusBadge :status="s.status" /><span v-if="s.status === 'UPCOMING'" class="subtle">opens in</span></div>
              <b class="dname">{{ s.product.name }}</b>
              <div class="row" style="--gap: 8px"><span class="price">{{ money(s.salePriceMinor) }}</span><span class="mrp">{{ money(s.product.mrpMinor) }}</span><span class="off">{{ pct(s.salePriceMinor, s.product.mrpMinor) }}% off</span></div>
              <Countdown v-if="s.status === 'UPCOMING'" :to="s.startsAt" size="sm" @done="loadSales" />
              <span v-else-if="s.status === 'LIVE'" class="subtle">{{ s.remaining }} of {{ s.quantity }} left</span>
              <span v-else class="subtle">All {{ s.quantity }} units claimed</span>
            </div>
          </RouterLink>
        </div>
      </section>

      <!-- catalogue -->
      <section id="catalog" class="stack" style="--gap: 16px">
        <div class="spread wrap">
          <div>
            <h2>{{ q ? `Results for “${q}”` : category || 'All products' }}</h2>
            <span class="subtle">{{ loading ? 'Loading…' : `${total} item${total === 1 ? '' : 's'}` }}</span>
          </div>
          <label class="sortbox"><SlidersHorizontal :size="15" />
            <select class="select" :value="sort" aria-label="Sort products" @change="setQuery({ sort: ($event.target as HTMLSelectElement).value === 'popular' ? undefined : ($event.target as HTMLSelectElement).value })">
              <option value="popular">Most popular</option>
              <option value="discount">Biggest discount</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="new">Newest</option>
            </select>
          </label>
        </div>
        <div class="chips">
          <button class="chip" :class="{ active: !category }" @click="setQuery({ category: undefined })">All</button>
          <button v-for="c in categories" :key="c.category" class="chip" :class="{ active: category === c.category }" @click="setQuery({ category: c.category })">{{ c.category }} <span class="cc">{{ c.count }}</span></button>
          <button v-if="q" class="chip" @click="setQuery({ q: undefined })">Clear search ✕</button>
        </div>

        <div v-if="loading" class="grid-products">
          <div v-for="i in 8" :key="i" class="card skel-card"><div class="skeleton" style="aspect-ratio: 1" /><div class="stack" style="--gap: 8px; padding: 14px"><div class="skeleton" style="height: 10px; width: 40%" /><div class="skeleton" style="height: 14px" /><div class="skeleton" style="height: 14px; width: 70%" /><div class="skeleton" style="height: 32px; margin-top: 6px" /></div></div>
        </div>
        <div v-else-if="loadError" class="empty card card-pad">
          <ServerCrash :size="36" class="bad" />
          <h3>Couldn't load products</h3>
          <p class="muted">{{ loadError }}</p>
          <button class="btn btn-primary" @click="loadProducts(true); loadSales()">Try again</button>
        </div>
        <div v-else-if="!items.length" class="empty card card-pad">
          <PackageSearch :size="36" class="muted" />
          <h3>No products match</h3>
          <p class="muted">Try a different search or category.</p>
          <button class="btn" @click="router.replace({ query: {} })">Reset filters</button>
        </div>
        <div v-else class="grid-products">
          <ProductCard v-for="p in items" :key="p.id" :product="p" />
        </div>
        <div v-if="!loading && items.length < total" class="center">
          <button class="btn" :disabled="loadingMore" @click="more">{{ loadingMore ? 'Loading…' : `Show more (${total - items.length} left)` }}</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hero-skel { height: 380px; border-radius: var(--radius-xl); }
.props { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.prop { display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); }
.prop div { display: flex; flex-direction: column; }
.prop b { font-size: .9rem; }
.prop .subtle { font-size: .8rem; }
.pi { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand-text); flex: none; }
@media (max-width: 900px) { .props { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 520px) { .props { grid-template-columns: 1fr; } }
.deals { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.deal { display: flex; gap: 14px; padding: 12px; color: var(--text); text-decoration: none !important; transition: transform .2s var(--ease), box-shadow .2s; }
.deal:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.deal.dim { opacity: .7; }
.dthumb { width: 96px; height: 96px; border-radius: 12px; overflow: hidden; flex: none; }
.dname { font-size: .9rem; line-height: 1.3; }
.sortbox { display: inline-flex; align-items: center; gap: 8px; color: var(--text-2); }
.sortbox .select { width: auto; height: 38px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.cc { font-size: .72rem; opacity: .6; }
.skel-card { overflow: hidden; }
.empty { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 48px; }
.center { display: flex; justify-content: center; }
.bad { color: var(--hot); }
</style>
