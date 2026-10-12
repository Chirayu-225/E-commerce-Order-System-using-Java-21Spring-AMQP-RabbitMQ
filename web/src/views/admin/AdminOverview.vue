<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onBeforeUnmount, ref } from 'vue';
import { IndianRupee, ShoppingBag, Users, Package } from '@lucide/vue';
import StatusBadge from '@/components/StatusBadge.vue';
import StockBar from '@/components/StockBar.vue';
import { api } from '@/lib/api';
import { money, compact, dateTime, STATUS_LABEL } from '@/lib/format';

const s = ref<any>(null);
async function load() { try { s.value = await api.admin.stats(); } catch { /* keep */ } }
let t: number | undefined;
const start = () => { void load(); clearInterval(t); t = window.setInterval(load, 5000); };
onMounted(start); onActivated(start);
onDeactivated(() => clearInterval(t)); onBeforeUnmount(() => clearInterval(t));

const statuses = ['PENDING_PAYMENT', 'PAID', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED'];
const totalOrders = computed(() => (s.value ? Object.values(s.value.ordersByStatus as Record<string, number>).reduce((a, b) => a + b, 0) : 0));
const COLORS: Record<string, string> = { PENDING_PAYMENT: '#f59e0b', PAID: '#3b82f6', PACKED: '#6366f1', SHIPPED: '#8b5cf6', DELIVERED: '#10b981', CANCELLED: '#94a3b8', EXPIRED: '#64748b' };
</script>

<template>
  <div v-if="!s" class="kpis"><div v-for="i in 4" :key="i" class="skeleton" style="height: 104px; border-radius: var(--radius-lg)" /></div>
  <div v-else class="stack" style="--gap: 20px">
    <div class="kpis">
      <div class="card kpi"><span class="ki b"><IndianRupee :size="18" /></span><span class="subtle">Revenue (paid orders)</span><b class="kv">{{ money(s.revenueMinor) }}</b></div>
      <div class="card kpi"><span class="ki v"><ShoppingBag :size="18" /></span><span class="subtle">Orders, last 24h</span><b class="kv tnum">{{ s.ordersLast24h }}</b></div>
      <div class="card kpi"><span class="ki g"><Package :size="18" /></span><span class="subtle">Units sold</span><b class="kv tnum">{{ compact(s.unitsSold) }}</b></div>
      <div class="card kpi"><span class="ki a"><Users :size="18" /></span><span class="subtle">Customers</span><b class="kv tnum">{{ compact(s.customers) }}</b></div>
    </div>

    <div class="two">
      <section class="card card-pad stack" style="--gap: 14px">
        <h3>Orders by status <span class="subtle">· {{ totalOrders }} total</span></h3>
        <div class="stackbar"><span v-for="k in statuses" :key="k" :style="{ width: ((s.ordersByStatus[k] ?? 0) / Math.max(1, totalOrders)) * 100 + '%', background: COLORS[k] }" :title="`${STATUS_LABEL[k]}: ${s.ordersByStatus[k] ?? 0}`" /></div>
        <ul class="legend">
          <li v-for="k in statuses" :key="k"><span class="sw" :style="{ background: COLORS[k] }" />{{ STATUS_LABEL[k] }}<b class="tnum">{{ s.ordersByStatus[k] ?? 0 }}</b></li>
        </ul>
      </section>
      <section class="card card-pad stack" style="--gap: 14px">
        <h3>Flash sales</h3>
        <div v-for="x in s.sales" :key="x.id" class="sale">
          <div class="spread"><b class="nm">{{ x.name }}</b><StatusBadge :status="x.status" /></div>
          <span class="subtle">{{ money(x.salePriceMinor) }} · {{ dateTime(x.startsAt) }} → {{ dateTime(x.endsAt) }}</span>
          <StockBar :remaining="x.remaining" :total="x.quantity" />
        </div>
        <p v-if="!s.sales.length" class="muted">No sales scheduled.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.kpi { padding: 18px; display: flex; flex-direction: column; gap: 4px; }
.ki { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; margin-bottom: 6px; }
.ki.b { background: var(--brand-soft); color: var(--brand-text); } .ki.v { background: rgba(139, 92, 246, .14); color: #8b5cf6; }
.ki.g { background: var(--ok-soft); color: var(--ok); } .ki.a { background: var(--deal-soft); color: var(--deal); }
.kv { font-size: 1.6rem; letter-spacing: -.02em; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.stackbar { display: flex; height: 14px; border-radius: 99px; overflow: hidden; background: var(--surface-3); }
.stackbar span { height: 100%; transition: width .5s var(--ease); }
.legend { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; font-size: .88rem; }
.legend li { display: flex; align-items: center; gap: 8px; color: var(--text-2); }
.legend b { margin-left: auto; color: var(--text); }
.sw { width: 10px; height: 10px; border-radius: 3px; }
.sale { display: flex; flex-direction: column; gap: 6px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
.sale:last-child { border-bottom: 0; padding-bottom: 0; }
.nm { font-size: .92rem; }
@media (max-width: 900px) { .kpis { grid-template-columns: repeat(2, 1fr); } .two { grid-template-columns: 1fr; } }
</style>
