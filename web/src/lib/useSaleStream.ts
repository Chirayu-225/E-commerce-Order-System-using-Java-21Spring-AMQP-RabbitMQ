import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { streamUrl } from './api';

/** Live "units remaining" for one sale over Server-Sent Events.  Reconnects automatically (EventSource does). */
export function useSaleStream(saleId: Ref<string | null | undefined>) {
  const remaining = ref<number | null>(null);
  const live = ref(false);
  let es: EventSource | null = null;
  const close = () => { es?.close(); es = null; live.value = false; };
  watch(saleId, (id) => {
    close();
    remaining.value = null;
    if (!id) return;
    es = new EventSource(streamUrl(`/api/stream/sales/${id}`));
    es.onopen = () => { live.value = true; };
    es.onerror = () => { live.value = false; };
    const onStock = (ev: MessageEvent) => {
      const d = JSON.parse(ev.data);
      if (typeof d.remaining === 'number') remaining.value = d.remaining;
    };
    es.addEventListener('stock', onStock as EventListener);
    es.addEventListener('hello', onStock as EventListener);
  }, { immediate: true });
  onBeforeUnmount(close);
  return { remaining, live };
}
