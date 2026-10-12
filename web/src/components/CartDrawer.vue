<script setup lang="ts">
import { computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { X, Minus, Plus, Trash2, ShoppingBag, Zap, Truck } from '@lucide/vue';
import ProductArt from './ProductArt.vue';
import Countdown from './Countdown.vue';
import { useCart, FREE_SHIPPING_MINOR } from '@/stores/cart';
import { useClock } from '@/stores/clock';
import { money } from '@/lib/format';

const cart = useCart();
const clock = useClock();
const router = useRouter();
const toFree = computed(() => Math.max(0, FREE_SHIPPING_MINOR - cart.subtotal));
const savings = computed(() => cart.mrpTotal - cart.subtotal);

function checkout() { cart.open = false; void router.push('/checkout'); }
const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cart.open = false; };
onMounted(() => document.addEventListener('keydown', esc));
onBeforeUnmount(() => document.removeEventListener('keydown', esc));
watch(() => cart.open, (o) => { document.body.style.overflow = o ? 'hidden' : ''; if (o) cart.pruneExpired(clock.now); });
</script>

<template>
  <Teleport to="body">
    <Transition name="fade"><div v-if="cart.open" class="scrim" @click="cart.open = false" /></Transition>
    <Transition name="slide">
      <aside v-if="cart.open" class="drawer" role="dialog" aria-modal="true" aria-label="Shopping cart">
        <header class="spread head">
          <h2>Your cart <span class="subtle">({{ cart.count }})</span></h2>
          <button class="btn btn-ghost icon-btn" aria-label="Close cart" @click="cart.open = false"><X :size="20" /></button>
        </header>

        <div v-if="!cart.lines.length" class="empty">
          <div class="emoji"><ShoppingBag :size="34" /></div>
          <h3>Your cart is empty</h3>
          <p class="muted">Today's flash deals are moving fast. Grab one before it's gone.</p>
          <button class="btn btn-primary" @click="cart.open = false; router.push('/')">Browse deals</button>
        </div>

        <template v-else>
          <div v-if="toFree > 0" class="ship"><Truck :size="16" /> Add <b>{{ money(toFree) }}</b> more for free delivery
            <div class="bar"><div :style="{ width: Math.min(100, (cart.subtotal / FREE_SHIPPING_MINOR) * 100) + '%' }" /></div>
          </div>
          <div v-else class="ship ok"><Truck :size="16" /> You've unlocked <b>free delivery</b></div>

          <ul class="lines">
            <li v-for="l in cart.lines" :key="l.productId" class="line">
              <div class="thumb"><ProductArt :category="l.category" :hue="l.hue" size="sm" /></div>
              <div class="grow info">
                <span class="name">{{ l.name }}</span>
                <span v-if="l.saleId" class="deal"><Zap :size="12" /> Flash price · ends in <Countdown :to="l.saleEndsAt!" size="sm" /></span>
                <div class="spread">
                  <div class="qty">
                    <button class="btn btn-sm icon-btn" aria-label="Decrease" @click="cart.setQty(l.productId, l.qty - 1)"><Minus :size="14" /></button>
                    <span class="tnum">{{ l.qty }}</span>
                    <button class="btn btn-sm icon-btn" aria-label="Increase" :disabled="l.qty >= cart.maxQty(l)" @click="cart.setQty(l.productId, l.qty + 1)"><Plus :size="14" /></button>
                  </div>
                  <span class="price">{{ money(l.unitMinor * l.qty) }}</span>
                </div>
                <span v-if="l.saleId && l.perUserLimit" class="subtle">Limit {{ l.perUserLimit }} per customer</span>
              </div>
              <button class="btn btn-ghost btn-sm icon-btn rm" aria-label="Remove" @click="cart.remove(l.productId)"><Trash2 :size="15" /></button>
            </li>
          </ul>

          <footer class="foot">
            <div class="spread"><span class="muted">Subtotal</span><span class="tnum">{{ money(cart.subtotal) }}</span></div>
            <div class="spread"><span class="muted">Delivery</span><span class="tnum">{{ cart.shipping ? money(cart.shipping) : 'Free' }}</span></div>
            <div v-if="savings > 0" class="spread save"><span>You save</span><span class="tnum">{{ money(savings) }}</span></div>
            <div class="spread total"><span>Total</span><span class="price tnum">{{ money(cart.total) }}</span></div>
            <button class="btn btn-primary btn-lg btn-block" @click="checkout">Checkout</button>
            <p class="subtle center">Items are reserved only after you place the order.</p>
          </footer>
        </template>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--overlay); z-index: 90; backdrop-filter: blur(2px); }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); background: var(--bg-elev); z-index: 91; display: flex; flex-direction: column; box-shadow: var(--shadow-lg); border-left: 1px solid var(--border); }
.head { padding: 16px 16px 12px 20px; border-bottom: 1px solid var(--border); }
.empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 12px; padding: 32px; }
.emoji { width: 72px; height: 72px; border-radius: 50%; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand-text); }
.ship { margin: 14px 20px 0; padding: 10px 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); font-size: .85rem; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ship.ok { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
.bar { flex-basis: 100%; height: 5px; border-radius: 9px; background: var(--surface-3); overflow: hidden; }
.bar div { height: 100%; background: var(--brand); border-radius: inherit; transition: width .4s var(--ease); }
.lines { list-style: none; margin: 0; padding: 8px 20px; overflow-y: auto; flex: 1; }
.line { display: flex; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.line:last-child { border-bottom: 0; }
.thumb { width: 72px; height: 72px; border-radius: 12px; overflow: hidden; flex: none; }
.info { display: flex; flex-direction: column; gap: 6px; }
.name { font-weight: 600; font-size: .9rem; line-height: 1.3; }
.deal { display: inline-flex; align-items: center; gap: 4px; font-size: .75rem; color: var(--deal); font-weight: 600; flex-wrap: wrap; }
.qty { display: inline-flex; align-items: center; gap: 10px; }
.qty span { min-width: 16px; text-align: center; font-weight: 650; }
.rm { color: var(--text-3); align-self: flex-start; }
.foot { padding: 16px 20px 20px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; background: var(--surface); }
.save { color: var(--ok); font-weight: 600; font-size: .9rem; }
.total { font-weight: 700; font-size: 1.05rem; padding: 6px 0 8px; }
.total .price { font-size: 1.3rem; }
.center { text-align: center; }
.slide-enter-active, .slide-leave-active { transition: transform .3s var(--ease); }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
</style>
