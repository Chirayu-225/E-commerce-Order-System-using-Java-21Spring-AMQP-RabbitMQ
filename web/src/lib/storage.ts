/** localStorage can throw (private mode, blocked storage): never let that break the app. */
export const store = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
  },
  set(key: string, value: unknown): void { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  del(key: string): void { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};
