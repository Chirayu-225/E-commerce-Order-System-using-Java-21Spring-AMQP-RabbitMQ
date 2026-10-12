<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CreditCard, Lock, CheckCircle2, XCircle, Loader2, Timer, FlaskConical } from '@lucide/vue';
import Countdown from '@/components/Countdown.vue';
import { api, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import type { Order } from '@/lib/types';
import { useClock } from '@/stores/clock';
import { useLive } from '@/stores/live';
import { useToast } from '@/stores/toast';

const props = defineProps<{ id: string }>();
const router = useRouter();
const clock = useClock();
const live = useLive();
const toast = useToast();
const order = ref<Order | null>(null);
const phase = ref<'idle' | 'processing' | 'failed'>('idle');
const message = ref('');
const expired = computed(() => !!order.value && (order.value.status === 'EXPIRED' || Date.parse(order.value.expiresAt) <= clock.now));

async function load() {
  try {
    order.value = await api.order(props.id);
    if (order.value.status !== 'PENDING_PAYMENT') void router.replace(`/orders/${props.id}`);
  } catch { toast.error('Order not found'); void router.replace('/orders'); }
}

let poll: number | undefined;
function settle(status: string) {
  if (status === 'PAID') {
    clearInterval(poll);
    toast.success('Payment successful', 'Your order is confirmed.');
    void router.replace(`/orders/${props.id}`);
  }
}
const off = live.onOrder((e) => { if (e.orderId === props.id) settle(e.status); });

async function pay(outcome: 'success' | 'failure') {
  if (!order.value) return;
  phase.value = 'processing'; message.value = '';
  try {
    const p = await api.startPayment(order.value.id);
    await api.simulatePay(p.paymentId, outcome);
    // The gateway confirms asynchronously via a signed webhook.  Wait for it (SSE push, with polling as a fallback).
    const started = Date.now();
    clearInterval(poll);
    poll = window.setInterval(async () => {
      const o = await api.order(props.id).catch(() => null);
      if (!o) return;
      order.value = o;
      if (o.status === 'PAID') settle('PAID');
      else if (o.payment?.status === 'FAILED') {
        clearInterval(poll);
        phase.value = 'failed';
        message.value = o.payment.failureReason ?? 'Payment failed';
      } else if (o.status !== 'PENDING_PAYMENT') { clearInterval(poll); void router.replace(`/orders/${props.id}`); }
      else if (Date.now() - started > 20_000) { clearInterval(poll); phase.value = 'failed'; message.value = 'The payment is taking longer than usual. Check your order in a moment.'; }
    }, 900);
  } catch (e) {
    phase.value = 'failed';
    message.value = e instanceof ApiError ? e.message : 'Could not start the payment';
    if (e instanceof ApiError && (e.code === 'ORDER_EXPIRED' || e.code === 'ORDER_NOT_PAYABLE')) void load();
  }
}

onMounted(load);
onBeforeUnmount(() => { clearInterval(poll); off(); });
</script>

<template>
  <div class="page">
    <div class="container narrow">
      <div v-if="!order" class="skeleton" style="height: 420px; border-radius: var(--radius-xl)" />
      <div v-else class="card gw">
        <header class="gw-head">
          <div class="row" style="--gap: 10px"><span class="lock"><Lock :size="16" /></span><div><b>MockPay secure checkout</b><span class="subtle"> · test mode</span></div></div>
          <span class="badge badge-deal"><FlaskConical :size="13" /> No real money</span>
        </header>

        <div class="amount">
          <span class="subtle">Paying FlashCart for order <b class="mono">{{ order.number }}</b></span>
          <span class="big tnum">{{ money(order.totalMinor, true) }}</span>
          <div v-if="!expired" class="hold"><Timer :size="15" /> Items held for <Countdown :to="order.expiresAt" size="sm" @done="load" /></div>
          <div v-else class="hold bad">This order expired and its items were released.</div>
        </div>

        <div v-if="phase === 'processing'" class="state">
          <Loader2 :size="36" class="spin" />
          <b>Confirming with the bank…</b>
          <span class="subtle">The order is marked paid only when the gateway's signed webhook arrives.</span>
        </div>
        <div v-else-if="expired" class="state">
          <XCircle :size="36" class="bad-ic" />
          <RouterLink to="/" class="btn btn-primary">Back to deals</RouterLink>
        </div>
        <div v-else class="stack body" style="--gap: 14px">
          <div v-if="phase === 'failed'" class="alert"><XCircle :size="17" /> {{ message }}. You can try again.</div>
          <div class="cardui">
            <div class="spread"><span class="chipimg" /><CreditCard :size="22" /></div>
            <span class="num mono">4242 4242 4242 4242</span>
            <div class="spread subtle-l"><span>TEST CARD</span><span>12/34</span></div>
          </div>
          <button class="btn btn-primary btn-lg btn-block" @click="pay('success')"><CheckCircle2 :size="18" /> Pay {{ money(order.totalMinor) }}</button>
          <button class="btn btn-block" @click="pay('failure')"><XCircle :size="16" /> Simulate a declined card</button>
          <p class="subtle fine">This screen stands in for a real payment gateway (e.g. Razorpay/Stripe in test mode). The browser never marks the order paid. The server only does that after verifying an HMAC-signed webhook.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.narrow { max-width: 520px; }
.gw { overflow: hidden; box-shadow: var(--shadow); }
.gw-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--border); background: var(--surface-2); flex-wrap: wrap; }
.lock { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--ok-soft); color: var(--ok); }
.amount { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 28px 20px 18px; text-align: center; }
.big { font-size: 2.4rem; font-weight: 800; letter-spacing: -.03em; }
.hold { display: inline-flex; align-items: center; gap: 8px; font-size: .85rem; color: var(--deal); font-weight: 600; flex-wrap: wrap; justify-content: center; }
.hold.bad { color: var(--hot); }
.body { padding: 0 24px 24px; }
.state { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 20px 24px 36px; }
.spin { animation: spin 1s linear infinite; color: var(--brand); }
@keyframes spin { to { transform: rotate(360deg); } }
.bad-ic { color: var(--hot); }
.cardui { padding: 18px; border-radius: 16px; color: #fff; background: linear-gradient(135deg, #0f172a, #1e3a8a 60%, #6d28d9); display: flex; flex-direction: column; gap: 18px; box-shadow: 0 16px 30px -14px rgba(30, 58, 138, .8); }
.chipimg { width: 38px; height: 28px; border-radius: 6px; background: linear-gradient(135deg, #fde68a, #d97706); }
.num { font-size: 1.15rem; letter-spacing: .12em; }
.subtle-l { font-size: .75rem; opacity: .7; letter-spacing: .08em; }
.alert { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 10px; background: var(--hot-soft); color: var(--hot); font-size: .88rem; font-weight: 550; }
.fine { font-size: .78rem; text-align: center; }
</style>
