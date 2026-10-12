<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { Bell } from '@lucide/vue';
import { useLive } from '@/stores/live';
import { ago } from '@/lib/format';

const live = useLive();
const router = useRouter();
const open = ref(false);
const root = ref<HTMLElement>();
function toggle() { open.value = !open.value; if (open.value) void live.markAllRead(); }
function go(orderId: string | null) { open.value = false; if (orderId) void router.push(`/orders/${orderId}`); }
const outside = (e: MouseEvent) => { if (root.value && !root.value.contains(e.target as Node)) open.value = false; };
onMounted(() => document.addEventListener('click', outside));
onBeforeUnmount(() => document.removeEventListener('click', outside));
</script>

<template>
  <div ref="root" class="nb">
    <button class="btn btn-ghost icon-btn" aria-label="Notifications" @click="toggle">
      <Bell :size="19" />
      <span v-if="live.unread" class="count tnum">{{ live.unread > 9 ? '9+' : live.unread }}</span>
    </button>
    <Transition name="pop">
      <div v-if="open" class="panel card" role="menu">
        <div class="head spread"><h3>Notifications</h3><span class="badge" :class="live.connected ? 'badge-ok' : ''"><span class="dot" :class="{ pulse: live.connected }" />{{ live.connected ? 'Live' : 'Offline' }}</span></div>
        <div v-if="!live.notifications.length" class="empty subtle">No notifications yet. Order updates will show up here in real time.</div>
        <button v-for="n in live.notifications" :key="n.id" class="item" @click="go(n.orderId)">
          <span class="dotx" :class="{ unread: !n.read }" />
          <span class="grow">
            <span class="t">{{ n.title }}</span>
            <span class="b">{{ n.body }}</span>
            <span class="w">{{ ago(n.createdAt) }}</span>
          </span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.nb { position: relative; }
.count { position: absolute; top: 4px; right: 3px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 99px; background: var(--hot); color: #fff; font-size: .68rem; font-weight: 750; display: grid; place-items: center; border: 2px solid var(--bg-elev); }
.panel { position: absolute; right: 0; top: calc(100% + 8px); width: min(380px, calc(100vw - 24px)); max-height: 440px; overflow: auto; box-shadow: var(--shadow-lg); z-index: 60; }
.head { padding: 14px 16px 10px; position: sticky; top: 0; background: var(--surface); border-bottom: 1px solid var(--border); }
.empty { padding: 24px 16px; text-align: center; }
.item { display: flex; gap: 10px; width: 100%; text-align: left; padding: 12px 16px; background: none; border: 0; border-bottom: 1px solid var(--border); cursor: pointer; }
.item:hover { background: var(--surface-2); }
.item:last-child { border-bottom: 0; }
.dotx { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex: none; background: transparent; }
.dotx.unread { background: var(--brand); }
.t { display: block; font-weight: 650; font-size: .9rem; }
.b { display: block; color: var(--text-2); font-size: .85rem; }
.w { display: block; color: var(--text-3); font-size: .75rem; margin-top: 2px; }
.pop-enter-active, .pop-leave-active { transition: opacity .15s, transform .15s var(--ease); }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-6px) scale(.98); }
</style>
