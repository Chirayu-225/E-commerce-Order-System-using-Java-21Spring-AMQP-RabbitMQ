<script setup lang="ts">
import { onActivated, onMounted, ref, watch } from 'vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { api } from '@/lib/api';
import { dateTime, money, STATUS_LABEL } from '@/lib/format';
import type { Order } from '@/lib/types';

const status = ref('');
const page = ref(1);
const data = ref<{ total: number; items: Order[] } | null>(null);
async function load() { data.value = await api.admin.orders(status.value || undefined, page.value); }
watch(status, () => { page.value = 1; void load(); });
onMounted(load); onActivated(load);
</script>

<template>
  <section class="card">
    <div class="spread wrap bar">
      <div class="chips">
        <button class="chip" :class="{ active: !status }" @click="status = ''">All</button>
        <button v-for="(l, k) in STATUS_LABEL" :key="k" class="chip" :class="{ active: status === k }" @click="status = String(k)">{{ l }}</button>
      </div>
      <span v-if="data" class="subtle">{{ data.total }} orders</span>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Status</th><th>Payment</th><th>Placed</th></tr></thead>
        <tbody v-if="data">
          <tr v-for="o in data.items" :key="o.id">
            <td><RouterLink :to="`/orders/${o.id}`" class="mono">{{ o.number }}</RouterLink></td>
            <td class="items">{{ o.items.map((i) => `${i.qty}× ${i.name}`).join(', ') }}</td>
            <td class="tnum">{{ money(o.totalMinor) }}</td>
            <td><StatusBadge :status="o.status" /></td>
            <td><StatusBadge v-if="o.payment" :status="o.payment.status" /><span v-else class="subtle">none</span></td>
            <td class="subtle">{{ dateTime(o.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="data && data.total > 25" class="spread pager">
      <button class="btn btn-sm" :disabled="page <= 1" @click="page--; load()">Previous</button>
      <span class="subtle">Page {{ page }} of {{ Math.ceil(data.total / 25) }}</span>
      <button class="btn btn-sm" :disabled="page * 25 >= data.total" @click="page++; load()">Next</button>
    </div>
  </section>
</template>

<style scoped>
.bar { padding: 14px 16px; border-bottom: 1px solid var(--border); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chips .chip { height: 30px; font-size: .8rem; padding: 0 11px; }
.items { max-width: 320px; font-size: .86rem; color: var(--text-2); }
.pager { padding: 12px 16px; border-top: 1px solid var(--border); }
</style>
