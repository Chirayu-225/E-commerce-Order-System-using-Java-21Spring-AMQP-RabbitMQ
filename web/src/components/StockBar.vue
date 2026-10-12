<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(defineProps<{ remaining: number; total: number; tone?: 'default' | 'light' }>(), { tone: 'default' });
const claimedPct = computed(() => (props.total ? Math.min(100, Math.round(((props.total - props.remaining) / props.total) * 100)) : 100));
const low = computed(() => props.remaining > 0 && props.remaining / props.total <= 0.2);
</script>

<template>
  <div class="sb" :class="tone">
    <div class="track" role="progressbar" :aria-valuenow="claimedPct" aria-valuemin="0" aria-valuemax="100" :aria-label="`${claimedPct}% claimed`">
      <div class="fill" :class="{ low, gone: remaining <= 0 }" :style="{ width: claimedPct + '%' }" />
    </div>
    <div class="meta">
      <span v-if="remaining <= 0" class="txt gone">All {{ total }} claimed</span>
      <span v-else-if="low" class="txt low">Hurry! Only <b class="tnum">{{ remaining }}</b> left</span>
      <span v-else class="txt"><b class="tnum">{{ remaining }}</b> of {{ total }} left</span>
      <span class="txt tnum">{{ claimedPct }}% claimed</span>
    </div>
  </div>
</template>

<style scoped>
.sb { display: flex; flex-direction: column; gap: 6px; }
.track { height: 8px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, #f59e0b, #f97316); transition: width .6s cubic-bezier(.2, .8, .2, 1); }
.fill.low { background: linear-gradient(90deg, #f97316, #ef4444); }
.fill.gone { background: var(--text-3); }
.meta { display: flex; justify-content: space-between; font-size: .8rem; color: var(--text-2); }
.txt b { color: var(--text); }
.txt.low { color: var(--hot); font-weight: 600; } .txt.low b { color: var(--hot); }
.txt.gone { color: var(--text-3); }
.light .track { background: rgba(255, 255, 255, .18); }
.light .meta, .light .txt b { color: rgba(255, 255, 255, .92); }
.light .txt.low, .light .txt.low b { color: #fde68a; }
</style>
