<script setup lang="ts">
import { compact } from '@/lib/format';
defineProps<{ rating: number; count?: number }>();
</script>
<template>
  <span class="stars">
    <span class="pill">{{ rating.toFixed(1) }} <svg viewBox="0 0 20 20" width="11" height="11"><path fill="currentColor" d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L10 14.8l-5.2 2.8 1-5.8L1.5 7.7l5.9-.8z" /></svg></span>
    <span v-if="count !== undefined" class="cnt">({{ compact(count) }})</span>
  </span>
</template>
<style scoped>
.stars { display: inline-flex; align-items: center; gap: 6px; font-size: .8rem; }
.pill { display: inline-flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 6px; background: #16a34a; color: #fff; font-weight: 700; }
.cnt { color: var(--text-3); }
</style>
