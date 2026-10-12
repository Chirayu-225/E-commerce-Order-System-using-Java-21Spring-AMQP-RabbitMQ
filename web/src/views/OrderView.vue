<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ArrowLeft, MapPin, CreditCard, Receipt, Zap, Radio } from '@lucide/vue';
import ProductArt from '@/components/ProductArt.vue';
import StatusBadge from '@/components/StatusBadge.vue';
import OrderTimeline from '@/components/OrderTimeline.vue';
import Countdown from '@/components/Countdown.vue';
import { api, ApiError } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import type { Order } from '@/lib/types';
import { useLive } from '@/stores/live';
import { useToast } from '@/stores/toast';
import { useAuth } from '@/stores/auth';

const props = defineProps<{ id: string }>();
const live = useLive();
const toast = useToast();
const auth = useAuth();
const order = ref<Order | null>(null);
const error = ref('');
const cancelling = ref(false);
const confirmCancel = ref(false);

async function load() {
  try { order.value = await api.order(props.id); }
  catch (e) { error.value = e instanceof ApiError && e.status === 404 ? 'Order not found' : 'Could not load the order'; }
}
const off = live.onOrder((e) => { if (e.orderId === props.id) void load(); });
// fallback refresh while the order is moving through the warehouse, in case the live connection drops
let t: number | undefined;
onMounted(() => { void load(); t = window.setInterval(() => { if (order.value && ['PAID', 'PACKED', 'SHIPPED'].includes(order.value.status) && !live.connected) void load(); }, 5000); });
onBeforeUnmount(() => { off(); clearInterval(t); });

const canCancel = computed(() => !!order.value && ['PENDING_PAYMENT', 'PAID', 'PACKED'].includes(order.value.status));
async function cancel() {
  if (!order.value) return;
  cancelling.value = true;
  try {
    order.value = await api.cancel(order.value.id);
    toast.success('Order cancelled', order.value.payment?.status === 'REFUNDED' ? 'Your refund has been initiated.' : 'The items were released.');
  } catch (e) { toast.error('Could not cancel', e instanceof ApiError ? e.message : undefined); void load(); }
  finally { cancelling.value = false; confirmCancel.value = false; }
}
</script>

<template>
  <div class="page">
    <div class="container">
      <RouterLink to="/orders" class="back"><ArrowLeft :size="16" /> All orders</RouterLink>
      <div v-if="error" class="card card-pad"><h3>{{ error }}</h3></div>
      <div v-else-if="!order" class="skeleton" style="height: 400px; border-radius: var(--radius-xl)" />
      <template v-else>
        <div class="spread wrap head">
          <div class="stack" style="--gap: 6px">
            <div class="row wrap" style="--gap: 12px"><h1 class="mono-h">{{ order.number }}</h1><StatusBadge :status="order.status" /></div>
            <span class="subtle">Placed {{ dateTime(order.createdAt) }}<template v-if="auth.isAdmin && order.userId !== auth.user?.id"> · viewing as admin</template></span>
          </div>
          <div class="row wrap" style="--gap: 10px">
            <span v-if="live.connected" class="badge badge-ok" title="This page updates itself in real time"><Radio :size="13" /> Live updates</span>
            <RouterLink v-if="order.status === 'PENDING_PAYMENT'" :to="`/orders/${order.id}/pay`" class="btn btn-primary"><CreditCard :size="16" /> Pay now</RouterLink>
            <template v-if="canCancel">
              <button v-if="!confirmCancel" class="btn btn-danger" @click="confirmCancel = true">Cancel order</button>
              <template v-else>
                <span class="subtle">Cancel this order?</span>
                <button class="btn btn-sm" @click="confirmCancel = false">Keep it</button>
                <button class="btn btn-sm btn-danger" :disabled="cancelling" @click="cancel">{{ cancelling ? 'Cancelling…' : 'Yes, cancel' }}</button>
              </template>
            </template>
          </div>
        </div>

        <div v-if="order.status === 'PENDING_PAYMENT'" class="banner">
          <span>Complete payment within</span><Countdown :to="order.expiresAt" size="sm" @done="load" /><span>or the items will be released.</span>
        </div>

        <div class="layout">
          <section class="card card-pad">
            <h2 class="sec">Tracking</h2>
            <OrderTimeline :order="order" />
            <p v-if="['PAID', 'PACKED', 'SHIPPED'].includes(order.status)" class="subtle demo-note">Demo warehouse: each step is a delayed RabbitMQ message, so the order moves on its own within about a minute.</p>
          </section>

          <div class="stack" style="--gap: 16px">
            <section class="card card-pad stack" style="--gap: 12px">
              <h2 class="sec row" style="--gap: 8px"><Receipt :size="18" /> Items</h2>
              <ul class="items">
                <li v-for="it in order.items" :key="it.productId">
                  <RouterLink :to="`/product/${it.productId}`" class="thumb"><ProductArt :category="it.category" :hue="it.hue" size="sm" /></RouterLink>
                  <div class="grow"><span class="nm">{{ it.name }}</span><span class="subtle">Qty {{ it.qty }} × {{ money(it.unitPriceMinor) }}</span><span v-if="it.flashSaleId" class="dl"><Zap :size="12" /> Flash deal price</span></div>
                  <span class="tnum">{{ money(it.qty * it.unitPriceMinor) }}</span>
                </li>
              </ul>
              <div class="divider" />
              <div class="spread"><span class="muted">Subtotal</span><span class="tnum">{{ money(order.subtotalMinor) }}</span></div>
              <div class="spread"><span class="muted">Delivery</span><span class="tnum">{{ order.shippingMinor ? money(order.shippingMinor) : 'Free' }}</span></div>
              <div class="spread total"><span>Total</span><span class="price">{{ money(order.totalMinor) }}</span></div>
            </section>
            <section class="card card-pad grid2">
              <div class="stack" style="--gap: 6px">
                <h3 class="row" style="--gap: 8px"><MapPin :size="16" /> Delivery to</h3>
                <span><b>{{ order.shippingAddress.name }}</b></span>
                <span class="muted">{{ order.shippingAddress.line1 }}, {{ order.shippingAddress.city }}, {{ order.shippingAddress.state }} {{ order.shippingAddress.pincode }}</span>
                <span class="subtle">{{ order.shippingAddress.phone }}</span>
              </div>
              <div class="stack" style="--gap: 6px">
                <h3 class="row" style="--gap: 8px"><CreditCard :size="16" /> Payment</h3>
                <template v-if="order.payment"><StatusBadge :status="order.payment.status" /><span class="subtle mono">{{ order.payment.providerRef }}</span><span v-if="order.payment.failureReason" class="subtle">{{ order.payment.failureReason }}</span></template>
                <span v-else class="muted">Not paid yet</span>
              </div>
            </section>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); margin-bottom: 16px; font-weight: 550; font-size: .9rem; }
.head { margin-bottom: 18px; }
.mono-h { font-size: 1.6rem; letter-spacing: -.01em; }
.banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 16px; border-radius: var(--radius); background: var(--deal-soft); color: var(--deal); font-weight: 600; margin-bottom: 18px; }
.layout { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 20px; align-items: start; }
.sec { font-size: 1.05rem; margin-bottom: 18px; }
.demo-note { margin-top: 18px; font-size: .8rem; }
.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.items li { display: flex; align-items: center; gap: 12px; }
.thumb { width: 56px; height: 56px; border-radius: 10px; overflow: hidden; flex: none; }
.nm { display: block; font-weight: 600; font-size: .92rem; }
.items .subtle { display: block; }
.dl { display: inline-flex; align-items: center; gap: 3px; font-size: .75rem; color: var(--deal); font-weight: 650; }
.total { font-weight: 700; } .total .price { font-size: 1.25rem; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
@media (max-width: 520px) { .grid2 { grid-template-columns: 1fr; } }
</style>
