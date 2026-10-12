<script setup lang="ts">
import { Zap } from '@lucide/vue';
</script>
<template>
  <footer class="ft">
    <div class="container spread wrap">
      <div class="row" style="--gap: 8px"><Zap :size="16" class="z" /><b>FlashCart</b><span class="subtle">· a portfolio project. Test-mode payments only; no real money moves.</span></div>
      <div class="row subtle" style="--gap: 16px"><span>NestJS · Postgres · Redis · RabbitMQ · Vue 3</span></div>
    </div>
  </footer>
</template>
<style scoped>
.ft { border-top: 1px solid var(--border); padding: 22px 0; background: var(--bg-elev); font-size: .9rem; }
.z { color: var(--deal-500); }
</style>
