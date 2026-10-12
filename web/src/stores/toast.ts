import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';
export interface Toast { id: number; kind: ToastKind; title: string; body?: string }

export const useToast = defineStore('toast', () => {
  const items = ref<Toast[]>([]);
  let n = 0;
  function push(kind: ToastKind, title: string, body?: string, ms = 4200) {
    const id = ++n;
    items.value = [...items.value.slice(-3), { id, kind, title, body }];
    setTimeout(() => dismiss(id), ms);
  }
  function dismiss(id: number) { items.value = items.value.filter((t) => t.id !== id); }
  return {
    items, dismiss,
    success: (t: string, b?: string) => push('success', t, b),
    error: (t: string, b?: string) => push('error', t, b, 6000),
    info: (t: string, b?: string) => push('info', t, b),
    warning: (t: string, b?: string) => push('warning', t, b, 5000),
  };
});
