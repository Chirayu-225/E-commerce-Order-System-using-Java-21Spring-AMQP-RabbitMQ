import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type Theme = 'light' | 'dark';

export const useTheme = defineStore('theme', () => {
  const theme = ref<Theme>((document.documentElement.dataset.theme as Theme) || 'light');
  let explicit = false;
  try { explicit = !!localStorage.getItem('fc-theme'); } catch { /* ignore */ }

  function apply(t: Theme) { document.documentElement.dataset.theme = t; }
  function toggle() { set(theme.value === 'dark' ? 'light' : 'dark'); }
  function set(t: Theme) {
    explicit = true;
    theme.value = t;
    try { localStorage.setItem('fc-theme', t); } catch { /* ignore */ }
  }
  watch(theme, apply);
  // Follow the OS setting until the user picks a theme explicitly.
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => { if (!explicit) theme.value = e.matches ? 'dark' : 'light'; });
  } catch { /* old browsers */ }
  return { theme, toggle, set };
});
