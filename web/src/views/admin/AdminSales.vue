<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref } from 'vue';
import { Zap } from '@lucide/vue';
import StatusBadge from '@/components/StatusBadge.vue';
import { api, ApiError } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import type { Sale } from '@/lib/types';
import { useToast } from '@/stores/toast';

const toast = useToast();
const products = ref<any[]>([]);
const sales = ref<Sale[]>([]);
const form = reactive({ productId: '', discountPct: 40, quantity: 50, perUserLimit: 1, startsInMinutes: 0, durationMinutes: 60 });
const busy = ref(false);
const err = ref('');
async function load() {
  const [p, s] = await Promise.all([api.admin.products(), api.sales()]);
  products.value = p; sales.value = s.sales;
  if (!form.productId && p.length) form.productId = p[0].id;
}
onMounted(load); onActivated(load);
const selected = computed(() => products.value.find((p) => p.id === form.productId));
const preview = computed(() => (selected.value ? Math.round((selected.value.priceMinor * (100 - form.discountPct)) / 100 / 100) * 100 : 0));

async function create() {
  busy.value = true; err.value = '';
  try {
    const s = await api.admin.createSale({
      productId: form.productId, discountPct: Number(form.discountPct), quantity: Number(form.quantity), perUserLimit: Number(form.perUserLimit),
      startsInSeconds: Number(form.startsInMinutes) * 60, durationMinutes: Number(form.durationMinutes),
    });
    toast.success('Flash sale scheduled', `${s.product.name}: ${s.quantity} units`);
    void load();
  } catch (e) { err.value = e instanceof ApiError ? e.message : 'Could not create the sale'; }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="two">
    <section class="card card-pad stack" style="--gap: 14px">
      <h3>Schedule a flash sale</h3>
      <div class="field"><label>Product</label>
        <select v-model="form.productId" class="select"><option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }} ({{ p.available }} available)</option></select>
      </div>
      <div class="grid">
        <div class="field"><label>Discount %</label><input v-model.number="form.discountPct" class="input" type="number" min="1" max="90" /></div>
        <div class="field"><label>Units</label><input v-model.number="form.quantity" class="input" type="number" min="1" /></div>
        <div class="field"><label>Limit per customer</label><input v-model.number="form.perUserLimit" class="input" type="number" min="1" max="10" /></div>
        <div class="field"><label>Starts in (minutes)</label><input v-model.number="form.startsInMinutes" class="input" type="number" min="0" /></div>
        <div class="field"><label>Duration (minutes)</label><input v-model.number="form.durationMinutes" class="input" type="number" min="1" /></div>
        <div class="field"><label>Sale price</label><div class="pv"><b>{{ money(preview) }}</b><span v-if="selected" class="mrp">{{ money(selected.priceMinor) }}</span></div></div>
      </div>
      <p v-if="err" class="field-error">{{ err }}</p>
      <button class="btn btn-deal" :disabled="busy || !form.productId" @click="create"><Zap :size="16" /> {{ busy ? 'Scheduling…' : 'Schedule sale' }}</button>
      <p class="subtle">Units are carved out of available stock; the API rejects overlapping sales for the same product and sales larger than available stock.</p>
    </section>
    <section class="card card-pad stack" style="--gap: 10px">
      <h3>Recent and upcoming</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Product</th><th>Status</th><th>Sold</th><th>Window</th></tr></thead>
        <tbody>
          <tr v-for="s in sales" :key="s.id">
            <td><b class="nm">{{ s.product.name }}</b><span class="subtle">{{ money(s.salePriceMinor) }} · limit {{ s.perUserLimit }}</span></td>
            <td><StatusBadge :status="s.status" /></td>
            <td class="tnum">{{ s.quantity - s.remaining }}/{{ s.quantity }}</td>
            <td class="subtle">{{ dateTime(s.startsAt) }}<br />→ {{ dateTime(s.endsAt) }}</td>
          </tr>
        </tbody>
      </table></div>
    </section>
  </div>
</template>

<style scoped>
.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 16px; align-items: start; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pv { height: 42px; display: flex; align-items: center; gap: 8px; }
.nm { display: block; font-size: .88rem; }
@media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
</style>
