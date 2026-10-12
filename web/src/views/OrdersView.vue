<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Package, ChevronRight } from '@lucide/vue';
import ProductArt from '@/components/ProductArt.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import type { Order } from '@/lib/types';
import { useLive } from '@/stores/live';

const live = useLive();
const orders = ref<Order[] | null>(null);
const total = ref(0);
const page = ref(1);
async function load(p = 1) {
  const r = await api.orders(p);
  orders.value = p === 1 ? r.items : [...(orders.value ?? []), ...r.items];
  total.value = r.total; page.value = p;
}
const off = live.onOrder((e) => {
  const o = orders.value?.find((x) => x.id === e.orderId);
  if (o) o.status = e.status as Order['status']; else void load(1);
});
onMounted(() => load(1).catch(() => (orders.value = [])));
onBeforeUnmount(off);
</script>

<template>
  <div class="page">
    <div class="container narrow">
      <div class="spread head"><h1>My orders</h1><span v-if="orders" class="subtle">{{ total }} order{{ total === 1 ? '' : 's' }}</span></div>
      <div v-if="!orders" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height: 110px; border-radius: var(--radius-lg)" /></div>
      <div v-else-if="!orders.length" class="card card-pad empty">
        <Package :size="36" class="muted" /><h3>No orders yet</h3><p class="muted">When you buy something, you can track it here in real time.</p>
        <RouterLink to="/" class="btn btn-primary">Start shopping</RouterLink>
      </div>
      <div v-else class="stack" style="--gap: 12px">
        <RouterLink v-for="o in orders" :key="o.id" :to="o.status === 'PENDING_PAYMENT' ? `/orders/${o.id}/pay` : `/orders/${o.id}`" class="card ord">
          <div class="thumbs">
            <div v-for="(it, i) in o.items.slice(0, 3)" :key="i" class="th" :style="{ zIndex: 3 - i }"><ProductArt :category="it.category" :hue="it.hue" size="sm" /></div>
          </div>
          <div class="grow stack" style="--gap: 4px">
            <div class="row wrap" style="--gap: 10px"><b class="mono">{{ o.number }}</b><StatusBadge :status="o.status" /></div>
            <span class="nm">{{ o.items.map((i) => i.name).join(', ') }}</span>
            <span class="subtle">{{ date(o.createdAt) }} · {{ o.items.reduce((a, i) => a + i.qty, 0) }} item(s)</span>
          </div>
          <div class="right"><span class="price">{{ money(o.totalMinor) }}</span><span v-if="o.status === 'PENDING_PAYMENT'" class="badge badge-deal">Pay now</span><ChevronRight :size="18" class="muted" /></div>
        </RouterLink>
        <button v-if="orders.length < total" class="btn" @click="load(page + 1)">Load more</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.narrow { max-width: 860px; }
.head { margin-bottom: 20px; }
.ord { display: flex; align-items: center; gap: 16px; padding: 14px 16px; color: var(--text); text-decoration: none !important; transition: border-color .15s, box-shadow .15s, transform .15s var(--ease); }
.ord:hover { border-color: var(--border-strong); box-shadow: var(--shadow); transform: translateY(-1px); }
.thumbs { display: flex; flex: none; }
.th { width: 64px; height: 64px; border-radius: 12px; overflow: hidden; border: 2px solid var(--surface); position: relative; }
.th + .th { margin-left: -30px; }
.nm { font-size: .9rem; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.right { display: flex; align-items: center; gap: 10px; }
.empty { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 48px; }
@media (max-width: 600px) { .ord { flex-wrap: wrap; } .right { width: 100%; justify-content: space-between; } .th { width: 52px; height: 52px; } }
</style>
