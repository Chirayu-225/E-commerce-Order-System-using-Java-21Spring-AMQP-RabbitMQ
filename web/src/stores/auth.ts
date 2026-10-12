import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, configureApi } from '@/lib/api';
import { store } from '@/lib/storage';
import type { User } from '@/lib/types';

export const useAuth = defineStore('auth', () => {
  const token = ref<string | null>(store.get<string | null>('fc-token', null));
  const user = ref<User | null>(store.get<User | null>('fc-user', null));
  const isAuthed = computed(() => !!token.value && !!user.value);
  const isAdmin = computed(() => user.value?.role === 'ADMIN');

  function setSession(t: string, u: User) {
    token.value = t; user.value = u;
    store.set('fc-token', t); store.set('fc-user', u);
  }
  function logout() {
    token.value = null; user.value = null;
    store.del('fc-token'); store.del('fc-user');
  }
  async function login(email: string, password: string) { const s = await api.login(email, password); setSession(s.token, s.user); }
  async function register(name: string, email: string, password: string) { const s = await api.register(name, email, password); setSession(s.token, s.user); }
  async function refresh() {
    if (!token.value) return;
    try { user.value = await api.me(); store.set('fc-user', user.value); } catch { /* 401 handled globally */ }
  }

  configureApi(() => token.value, () => logout());
  return { token, user, isAuthed, isAdmin, login, register, logout, refresh };
});
