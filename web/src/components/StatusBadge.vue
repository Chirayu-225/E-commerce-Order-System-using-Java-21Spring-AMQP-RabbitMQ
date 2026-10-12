<script setup lang="ts">
import { computed } from 'vue';
import { STATUS_LABEL } from '@/lib/format';
const props = defineProps<{ status: string }>();
const cls = computed(() => ({
  PENDING_PAYMENT: 'badge-deal', PAID: 'badge-brand', PACKED: 'badge-brand', SHIPPED: 'badge-brand',
  DELIVERED: 'badge-ok', CANCELLED: '', EXPIRED: '',
  LIVE: 'badge-hot', UPCOMING: 'badge-brand', SOLD_OUT: '', ENDED: '',
  SUCCEEDED: 'badge-ok', PENDING: 'badge-deal', FAILED: 'badge-hot', REFUNDED: '',
}[props.status] ?? ''));
const label = computed(() => STATUS_LABEL[props.status] ?? props.status.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()));
</script>
<template>
  <span class="badge" :class="cls"><span class="dot" :class="{ pulse: status === 'LIVE' || status === 'PENDING_PAYMENT' }" />{{ label }}</span>
</template>
