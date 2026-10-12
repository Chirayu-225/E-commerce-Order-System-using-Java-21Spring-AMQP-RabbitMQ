<script setup lang="ts">
import { computed } from 'vue';
import { useClock } from '@/stores/clock';
import { hms } from '@/lib/format';

const props = withDefaults(defineProps<{ to: string; size?: 'sm' | 'md' | 'lg'; tone?: 'light' | 'default' }>(), { size: 'md', tone: 'default' });
const emit = defineEmits<{ done: [] }>();
const clock = useClock();
let fired = false;
const left = computed(() => {
  const ms = Date.parse(props.to) - clock.now;
  if (ms <= 0 && !fired) { fired = true; queueMicrotask(() => emit('done')); }
  return hms(ms);
});
</script>

<template>
  <div class="cd" :class="[size, tone]" role="timer" :aria-label="`${left.d ? left.d + ' days ' : ''}${left.h} hours ${left.m} minutes ${left.s} seconds`">
    <template v-if="left.d"><span class="u"><b>{{ left.d }}</b><i>d</i></span></template>
    <span class="u"><b>{{ left.h }}</b><i>h</i></span><span class="sep">:</span>
    <span class="u"><b>{{ left.m }}</b><i>m</i></span><span class="sep">:</span>
    <span class="u"><b>{{ left.s }}</b><i>s</i></span>
  </div>
</template>

<style scoped>
.cd { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; }
.u { display: inline-flex; align-items: baseline; gap: 2px; padding: 4px 7px; border-radius: 8px; background: var(--surface-3); }
.u b { font-weight: 750; font-size: 1rem; color: var(--text); }
.u i { font-style: normal; font-size: .7rem; color: var(--text-3); font-weight: 600; }
.sep { color: var(--text-3); font-weight: 700; }
.light .u { background: rgba(255, 255, 255, .14); backdrop-filter: blur(6px); }
.light .u b { color: #fff; }
.light .u i, .light .sep { color: rgba(255, 255, 255, .7); }
.sm .u { padding: 2px 5px; } .sm .u b { font-size: .85rem; }
.lg .u { padding: 8px 12px; border-radius: 12px; } .lg .u b { font-size: 1.6rem; } .lg .u i { font-size: .8rem; }
.lg { gap: 6px; }
</style>
