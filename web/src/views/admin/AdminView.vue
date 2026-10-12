<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LayoutDashboard, ShieldCheck, Zap, Boxes, ReceiptText } from '@lucide/vue';
import AdminOverview from './AdminOverview.vue';
import AdminHealth from './AdminHealth.vue';
import AdminSales from './AdminSales.vue';
import AdminInventory from './AdminInventory.vue';
import AdminOrders from './AdminOrders.vue';

const route = useRoute();
const router = useRouter();
const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, comp: AdminOverview },
  { key: 'health', label: 'Integrity & system', icon: ShieldCheck, comp: AdminHealth },
  { key: 'sales', label: 'Flash sales', icon: Zap, comp: AdminSales },
  { key: 'inventory', label: 'Inventory', icon: Boxes, comp: AdminInventory },
  { key: 'orders', label: 'Orders', icon: ReceiptText, comp: AdminOrders },
];
const tab = computed(() => TABS.find((t) => t.key === route.query.tab) ?? TABS[0]);
</script>

<template>
  <div class="page">
    <div class="container">
      <div class="spread wrap head">
        <div><h1>Admin console</h1><p class="muted">Operate flash sales and watch the system prove its own correctness.</p></div>
      </div>
      <nav class="tabs" role="tablist">
        <button v-for="t in TABS" :key="t.key" role="tab" :aria-selected="tab.key === t.key" :class="{ on: tab.key === t.key }" @click="router.replace({ query: { tab: t.key } })">
          <component :is="t.icon" :size="16" /> {{ t.label }}
        </button>
      </nav>
      <KeepAlive><component :is="tab.comp" :key="tab.key" /></KeepAlive>
    </div>
  </div>
</template>

<style scoped>
.head { margin-bottom: 18px; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 22px; overflow-x: auto; }
.tabs button { display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 14px; border: 0; background: none; color: var(--text-2); font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
.tabs button:hover { color: var(--text); }
.tabs button.on { color: var(--brand-text); border-bottom-color: var(--brand); }
</style>
