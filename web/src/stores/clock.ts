import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * One shared ticking clock, corrected by the server's time.  A visitor whose laptop clock is 2 minutes fast
 * still sees the countdown hit zero exactly when the server opens the sale.
 */
export const useClock = defineStore('clock', () => {
  const offset = ref(0); // serverNow - clientNow (ms)
  const now = ref(Date.now());
  setInterval(() => { now.value = Date.now() + offset.value; }, 250);
  function sync(serverIso: string, rttMs = 0) {
    offset.value = Date.parse(serverIso) + rttMs / 2 - Date.now();
    now.value = Date.now() + offset.value;
  }
  return { now, offset, sync };
});
