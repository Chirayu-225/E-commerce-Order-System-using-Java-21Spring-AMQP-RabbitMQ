<script setup lang="ts">
import { computed } from 'vue';
import { Check, Clock, CreditCard, Package, Truck, Home, X } from '@lucide/vue';
import type { Order } from '@/lib/types';
import { dateTime } from '@/lib/format';

const props = defineProps<{ order: Order }>();
const STEPS = [
  { key: 'PENDING_PAYMENT', label: 'Order placed', icon: Clock },
  { key: 'PAID', label: 'Payment confirmed', icon: CreditCard },
  { key: 'PACKED', label: 'Packed', icon: Package },
  { key: 'SHIPPED', label: 'Shipped', icon: Truck },
  { key: 'DELIVERED', label: 'Delivered', icon: Home },
] as const;
const at = (k: string) => props.order.events?.find((e) => e.to === k)?.at;
const terminalBad = computed(() => props.order.status === 'CANCELLED' || props.order.status === 'EXPIRED');
const idx = computed(() => {
  if (terminalBad.value) {
    let last = -1;
    STEPS.forEach((s, i) => { if (at(s.key)) last = i; });
    return last;
  }
  return STEPS.findIndex((s) => s.key === props.order.status);
});
</script>

<template>
  <ol class="tl">
    <li v-for="(s, i) in STEPS" :key="s.key" :class="{ done: i <= idx, current: i === idx && !terminalBad && order.status !== 'DELIVERED' }">
      <span class="node"><Check v-if="i < idx || (i === idx && (order.status === 'DELIVERED' || terminalBad))" :size="15" /><component :is="s.icon" v-else :size="15" /></span>
      <div class="txt">
        <b>{{ s.label }}</b>
        <span class="subtle">{{ at(s.key) ? dateTime(at(s.key)!) : i === idx + 1 && !terminalBad ? 'Up next' : '' }}</span>
      </div>
    </li>
    <li v-if="terminalBad" class="bad">
      <span class="node"><X :size="15" /></span>
      <div class="txt"><b>{{ order.status === 'EXPIRED' ? 'Expired: payment not received in time' : 'Cancelled' }}</b><span class="subtle">{{ at(order.status) ? dateTime(at(order.status)!) : '' }}</span></div>
    </li>
  </ol>
</template>

<style scoped>
.tl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
li { position: relative; display: flex; gap: 14px; padding-bottom: 22px; }
li:last-child { padding-bottom: 0; }
li:not(:last-child)::before { content: ''; position: absolute; left: 15px; top: 32px; bottom: 2px; width: 2px; background: var(--border); }
li.done:not(:last-child)::before { background: var(--brand); }
.node { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--surface-3); color: var(--text-3); border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border); transition: all .3s var(--ease); }
.done .node { background: var(--brand); color: #fff; box-shadow: none; }
.current .node { box-shadow: 0 0 0 5px var(--brand-soft); animation: ring 1.8s ease-in-out infinite; }
@keyframes ring { 50% { box-shadow: 0 0 0 9px transparent; } }
.bad .node { background: var(--hot-soft); color: var(--hot); box-shadow: none; }
.txt { display: flex; flex-direction: column; padding-top: 5px; }
.txt b { font-size: .92rem; font-weight: 650; }
li:not(.done):not(.bad) .txt b { color: var(--text-3); font-weight: 550; }
</style>
