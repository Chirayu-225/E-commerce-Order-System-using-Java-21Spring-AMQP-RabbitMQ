<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue';
import { PackagePlus } from '@lucide/vue';
import { api, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useToast } from '@/stores/toast';

const toast = useToast();
const rows = ref<any[] | null>(null);
const qty = ref<Record<string, number>>({});
async function load() { rows.value = await api.admin.products(); }
onMounted(load); onActivated(load);
async function restock(id: string) {
  const n = Number(qty.value[id] || 0);
  if (n <= 0) return;
  try { await api.admin.restock(id, n); toast.success('Restocked', `+${n} units`); qty.value[id] = 0; void load(); }
  catch (e) { toast.error('Restock failed', e instanceof ApiError ? e.message : undefined); }
}
</script>

<template>
  <section class="card">
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Product</th><th>Price</th><th>On hand</th><th>Reserved</th><th>Sold</th><th>Available</th><th>Restock</th></tr></thead>
        <tbody v-if="rows">
          <tr v-for="r in rows" :key="r.id">
            <td><b class="nm">{{ r.name }}</b><span class="subtle mono">{{ r.sku }} · {{ r.category }}</span></td>
            <td class="tnum">{{ money(r.priceMinor) }}</td>
            <td class="tnum">{{ r.onHand }}</td>
            <td class="tnum"><span :class="{ warn: r.reserved > 0 }">{{ r.reserved }}</span></td>
            <td class="tnum">{{ r.sold }}</td>
            <td class="tnum"><span class="badge" :class="r.available === 0 ? 'badge-hot' : r.available < 20 ? 'badge-deal' : 'badge-ok'">{{ r.available }}</span></td>
            <td><div class="row" style="--gap: 6px"><input v-model.number="qty[r.id]" class="input sm" type="number" min="1" placeholder="Qty" /><button class="btn btn-sm icon-btn" aria-label="Restock" @click="restock(r.id)"><PackagePlus :size="15" /></button></div></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows" class="skeleton" style="height: 300px; margin: 16px" />
    </div>
    <p class="subtle foot">Invariant enforced by Postgres CHECK constraints: <span class="mono">on_hand + sold = initial_stock</span> and <span class="mono">reserved ≤ on_hand</span>.</p>
  </section>
</template>

<style scoped>
.nm { display: block; font-size: .88rem; }
.input.sm { height: 32px; width: 80px; }
.warn { color: var(--deal); font-weight: 650; }
.foot { padding: 12px 16px; border-top: 1px solid var(--border); }
</style>
