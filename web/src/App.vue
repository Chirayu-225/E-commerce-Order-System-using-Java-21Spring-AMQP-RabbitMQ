<script setup lang="ts">
import { onMounted } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AppFooter from './components/AppFooter.vue';
import CartDrawer from './components/CartDrawer.vue';
import ToastHost from './components/ToastHost.vue';
import { useAuth } from './stores/auth';
import { useLive } from './stores/live';
import { useTheme } from './stores/theme';

const auth = useAuth();
useTheme();
useLive();
onMounted(() => { void auth.refresh(); });
</script>

<template>
  <a href="#main" class="skip">Skip to content</a>
  <AppHeader />
  <main id="main">
    <RouterView v-slot="{ Component, route }">
      <Transition name="page" appear>
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </main>
  <AppFooter />
  <CartDrawer />
  <ToastHost />
</template>

<style>
#app { min-height: 100vh; display: flex; flex-direction: column; }
main { flex: 1; }
.skip { position: absolute; left: -999px; top: 8px; z-index: 300; background: var(--surface); padding: 8px 12px; border-radius: 8px; }
.skip:focus { left: 8px; }
</style>
