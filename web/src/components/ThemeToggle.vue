<script setup lang="ts">
import { Sun, Moon } from '@lucide/vue';
import { useTheme } from '@/stores/theme';
const t = useTheme();
</script>
<template>
  <button class="btn btn-ghost icon-btn tt" :aria-label="`Switch to ${t.theme === 'dark' ? 'light' : 'dark'} mode`" :title="`${t.theme === 'dark' ? 'Light' : 'Dark'} mode`" @click="t.toggle()">
    <Transition name="spin" mode="out-in">
      <Sun v-if="t.theme === 'dark'" key="sun" :size="19" />
      <Moon v-else key="moon" :size="19" />
    </Transition>
  </button>
</template>
<style scoped>
.spin-enter-active, .spin-leave-active { transition: transform .25s var(--ease), opacity .2s; }
.spin-enter-from { transform: rotate(-90deg) scale(.6); opacity: 0; }
.spin-leave-to { transform: rotate(90deg) scale(.6); opacity: 0; }
</style>
