import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { api, streamUrl } from '@/lib/api';
import type { Notification } from '@/lib/types';
import { useAuth } from './auth';
import { useToast } from './toast';

type OrderListener = (e: { orderId: string; status: string }) => void;

/** Per-user live channel (Server-Sent Events): order status changes and notifications. */
export const useLive = defineStore('live', () => {
  const auth = useAuth();
  const toast = useToast();
  const notifications = ref<Notification[]>([]);
  const unread = ref(0);
  const connected = ref(false);
  const listeners = new Set<OrderListener>();
  let es: EventSource | null = null;

  async function loadNotifications() {
    if (!auth.isAuthed) return;
    try { const r = await api.notifications(); notifications.value = r.items; unread.value = r.unread; } catch { /* ignore */ }
  }
  async function markAllRead() {
    if (!unread.value) return;
    unread.value = 0;
    notifications.value = notifications.value.map((n) => ({ ...n, read: true }));
    try { await api.readAll(); } catch { /* ignore */ }
  }

  function connect() {
    disconnect();
    if (!auth.token) return;
    es = new EventSource(streamUrl('/api/stream/me', auth.token));
    es.addEventListener('open', () => { connected.value = true; });
    es.addEventListener('error', () => { connected.value = false; });
    es.addEventListener('order', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      listeners.forEach((l) => l(d));
    });
    es.addEventListener('notification', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      // the checkout and payment screens already confirm these two themselves
      if (d.title !== 'Order placed' && d.title !== 'Payment received') toast.info(d.title, d.body);
      void loadNotifications();
    });
  }
  function disconnect() { es?.close(); es = null; connected.value = false; }
  function onOrder(fn: OrderListener) { listeners.add(fn); return () => listeners.delete(fn); }

  watch(() => auth.token, (t) => {
    if (t) { connect(); void loadNotifications(); } else { disconnect(); notifications.value = []; unread.value = 0; }
  }, { immediate: true });

  return { notifications, unread, connected, loadNotifications, markAllRead, onOrder };
});
