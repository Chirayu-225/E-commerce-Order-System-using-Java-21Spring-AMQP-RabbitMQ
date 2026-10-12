<script setup lang="ts">
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from '@lucide/vue';
import { useToast } from '@/stores/toast';
const t = useToast();
const icon = { success: CheckCircle2, error: AlertCircle, info: Info, warning: AlertTriangle };
</script>
<template>
  <div class="host" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="x in t.items" :key="x.id" class="toast card" :class="x.kind" role="status">
        <component :is="icon[x.kind]" :size="19" class="ic" />
        <div class="grow"><b>{{ x.title }}</b><p v-if="x.body">{{ x.body }}</p></div>
        <button class="btn btn-ghost btn-sm icon-btn" aria-label="Dismiss" @click="t.dismiss(x.id)"><X :size="15" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>
<style scoped>
.host { position: fixed; bottom: 20px; right: 20px; z-index: 200; display: flex; flex-direction: column; gap: 10px; width: min(380px, calc(100vw - 32px)); }
.toast { display: flex; gap: 10px; align-items: flex-start; padding: 12px 10px 12px 14px; box-shadow: var(--shadow-lg); border-left: 4px solid var(--brand); }
.toast b { font-size: .9rem; } .toast p { font-size: .84rem; color: var(--text-2); margin-top: 2px; }
.ic { margin-top: 1px; flex: none; }
.success { border-left-color: var(--ok-500); } .success .ic { color: var(--ok); }
.error { border-left-color: var(--hot-500); } .error .ic { color: var(--hot); }
.warning { border-left-color: var(--deal-500); } .warning .ic { color: var(--deal); }
.info .ic { color: var(--brand-text); }
.toast-enter-active, .toast-leave-active { transition: all .25s var(--ease); }
.toast-enter-from { opacity: 0; transform: translateY(12px) scale(.97); }
.toast-leave-to { opacity: 0; transform: translateX(24px); }
@media (max-width: 600px) { .host { left: 16px; right: 16px; bottom: 16px; width: auto; } }
</style>
