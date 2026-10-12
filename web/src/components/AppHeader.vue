<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { Search, ShoppingCart, User, LogOut, Package, LayoutDashboard, ChevronDown, Zap } from '@lucide/vue';
import ThemeToggle from './ThemeToggle.vue';
import NotificationBell from './NotificationBell.vue';
import { useAuth } from '@/stores/auth';
import { useCart } from '@/stores/cart';

const auth = useAuth();
const cart = useCart();
const route = useRoute();
const router = useRouter();
const q = ref(String(route.query.q ?? ''));
const menu = ref(false);
const menuRoot = ref<HTMLElement>();
const bump = ref(false);

watch(() => route.query.q, (v) => { q.value = String(v ?? ''); });
watch(() => cart.count, (n, o) => { if (n > o) { bump.value = true; setTimeout(() => (bump.value = false), 400); } });

function search() { void router.push({ path: '/', query: { ...(q.value.trim() ? { q: q.value.trim() } : {}) }, hash: '#catalog' }); }
function logout() { menu.value = false; auth.logout(); void router.push('/'); }
const outside = (e: MouseEvent) => { if (menuRoot.value && !menuRoot.value.contains(e.target as Node)) menu.value = false; };
onMounted(() => document.addEventListener('click', outside));
onBeforeUnmount(() => document.removeEventListener('click', outside));
</script>

<template>
  <header class="hdr">
    <div class="container inner">
      <RouterLink to="/" class="logo" aria-label="FlashCart home">
        <span class="mark"><Zap :size="18" fill="currentColor" /></span>
        <span class="word">Flash<b>Cart</b></span>
      </RouterLink>

      <form class="search" role="search" @submit.prevent="search">
        <Search :size="17" class="si" />
        <input v-model="q" class="input" type="search" placeholder="Search for phones, headphones, laptops..." aria-label="Search products" />
      </form>

      <nav class="actions">
        <ThemeToggle />
        <NotificationBell v-if="auth.isAuthed" />
        <button class="btn btn-ghost cart-btn" :class="{ bump }" aria-label="Open cart" @click="cart.open = true">
          <span class="ico"><ShoppingCart :size="19" /><span v-if="cart.count" class="count tnum">{{ cart.count }}</span></span>
          <span class="lbl">Cart</span>
        </button>
        <div v-if="auth.isAuthed" ref="menuRoot" class="um">
          <button class="btn btn-ghost user" :aria-expanded="menu" @click="menu = !menu">
            <span class="avatar">{{ auth.user!.name.slice(0, 1).toUpperCase() }}</span>
            <span class="lbl">{{ auth.user!.name.split(' ')[0] }}</span>
            <ChevronDown :size="15" class="lbl" />
          </button>
          <Transition name="pop">
            <div v-if="menu" class="dd card" role="menu" @click="menu = false">
              <div class="who"><b>{{ auth.user!.name }}</b><span class="subtle">{{ auth.user!.email }}</span></div>
              <RouterLink to="/orders" class="mi"><Package :size="16" /> My orders</RouterLink>
              <RouterLink v-if="auth.isAdmin" to="/admin" class="mi"><LayoutDashboard :size="16" /> Admin console</RouterLink>
              <button class="mi" @click.stop="logout"><LogOut :size="16" /> Sign out</button>
            </div>
          </Transition>
        </div>
        <RouterLink v-else :to="{ path: '/login', query: { next: route.fullPath } }" class="btn btn-primary btn-sm signin"><User :size="15" /> Sign in</RouterLink>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.hdr { position: sticky; top: 0; z-index: 50; height: var(--header-h); background: color-mix(in srgb, var(--bg-elev) 85%, transparent); backdrop-filter: saturate(1.6) blur(14px); border-bottom: 1px solid var(--border); }
.inner { height: 100%; display: flex; align-items: center; gap: 20px; }
.logo { display: flex; align-items: center; gap: 9px; color: var(--text); text-decoration: none !important; flex: none; }
.mark { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fbbf24; box-shadow: 0 6px 16px -6px rgba(37, 99, 235, .8); }
.word { font-size: 1.15rem; font-weight: 750; letter-spacing: -.03em; }
.word b { color: var(--brand-text); font-weight: 750; }
.search { position: relative; flex: 1; max-width: 560px; }
.search .input { padding-left: 38px; background: var(--surface-2); border-color: var(--border); height: 40px; }
.search .input:focus { background: var(--surface); }
.si { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.cart-btn { position: relative; padding: 0 12px; gap: 12px; }
.ico { position: relative; display: inline-flex; }
.cart-btn .count { position: absolute; top: -9px; right: -11px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px; background: var(--brand); color: #fff; font-size: .7rem; font-weight: 750; display: grid; place-items: center; border: 2px solid var(--bg-elev); }
.cart-btn.bump { animation: bump .4s var(--ease); }
@keyframes bump { 30% { transform: scale(1.12); } }
.um { position: relative; }
.user { padding: 0 8px 0 4px; gap: 8px; }
.avatar { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 750; font-size: .85rem; background: var(--brand-soft); color: var(--brand-text); }
.dd { position: absolute; right: 0; top: calc(100% + 8px); min-width: 230px; padding: 6px; box-shadow: var(--shadow-lg); z-index: 60; }
.who { display: flex; flex-direction: column; padding: 10px 10px 12px; border-bottom: 1px solid var(--border); margin-bottom: 6px; }
.mi { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: 8px; border: 0; background: none; color: var(--text); font-weight: 550; font-size: .9rem; cursor: pointer; text-decoration: none !important; }
.mi:hover { background: var(--surface-3); }
.signin { margin-left: 6px; }
.pop-enter-active, .pop-leave-active { transition: opacity .15s, transform .15s var(--ease); }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-6px) scale(.98); }
@media (max-width: 860px) { .lbl { display: none; } .inner { gap: 12px; } }
@media (max-width: 600px) {
  .inner { flex-wrap: wrap; height: auto; padding-top: 10px; padding-bottom: 10px; row-gap: 10px; }
  .hdr { height: auto; }
  .search { order: 3; flex-basis: 100%; max-width: none; }
  .word { font-size: 1.05rem; }
}
</style>
