<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Zap, Eye, EyeOff, UserRound, ShieldCheck } from '@lucide/vue';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import { ApiError } from '@/lib/api';

const auth = useAuth();
const toast = useToast();
const route = useRoute();
const router = useRouter();
const mode = ref<'login' | 'register'>('login');
const name = ref(''); const email = ref(''); const password = ref('');
const show = ref(false);
const busy = ref(false);
const err = ref<ApiError | null>(null);
const next = computed(() => String(route.query.next ?? '/'));

async function submit() {
  busy.value = true; err.value = null;
  try {
    if (mode.value === 'login') await auth.login(email.value, password.value);
    else await auth.register(name.value, email.value, password.value);
    toast.success(mode.value === 'login' ? `Welcome back, ${auth.user!.name.split(' ')[0]}` : 'Account created');
    void router.replace(next.value);
  } catch (e) {
    err.value = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Something went wrong');
  } finally { busy.value = false; }
}
function demo(kind: 'customer' | 'admin') {
  mode.value = 'login';
  email.value = kind === 'admin' ? 'admin@flashcart.dev' : 'demo@flashcart.dev';
  password.value = kind === 'admin' ? 'admin12345' : 'demo12345';
  void submit();
}
</script>

<template>
  <div class="page auth">
    <div class="container">
      <div class="panel card">
        <div class="side">
          <span class="mark"><Zap :size="22" fill="currentColor" /></span>
          <h2>Deals that drop fast. Checkout that never oversells.</h2>
          <p>Sign in to grab flash deals, track orders live and get notified the moment they ship.</p>
          <ul>
            <li>Stock is held for you for 10 minutes after ordering</li>
            <li>Live order tracking from payment to delivery</li>
            <li>Test-mode payments, no real money</li>
          </ul>
        </div>
        <form class="form" novalidate @submit.prevent="submit">
          <div class="tabs" role="tablist">
            <button type="button" role="tab" :aria-selected="mode === 'login'" :class="{ on: mode === 'login' }" @click="mode = 'login'; err = null">Sign in</button>
            <button type="button" role="tab" :aria-selected="mode === 'register'" :class="{ on: mode === 'register' }" @click="mode = 'register'; err = null">Create account</button>
          </div>

          <div v-if="err && !err.body.fields" class="alert">{{ err.message }}</div>

          <div v-if="mode === 'register'" class="field">
            <label for="name">Full name</label>
            <input id="name" v-model="name" class="input" :class="{ invalid: err?.field('name') }" autocomplete="name" placeholder="Priya Sharma" />
            <span v-if="err?.field('name')" class="field-error">{{ err.field('name') }}</span>
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" v-model="email" class="input" :class="{ invalid: err?.field('email') }" type="email" autocomplete="email" placeholder="you@example.com" />
            <span v-if="err?.field('email')" class="field-error">{{ err.field('email') }}</span>
          </div>
          <div class="field">
            <label for="pw">Password</label>
            <div class="pw">
              <input id="pw" v-model="password" class="input" :class="{ invalid: err?.field('password') }" :type="show ? 'text' : 'password'" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" placeholder="At least 8 characters" />
              <button type="button" class="btn btn-ghost btn-sm icon-btn eye" :aria-label="show ? 'Hide password' : 'Show password'" @click="show = !show"><component :is="show ? EyeOff : Eye" :size="16" /></button>
            </div>
            <span v-if="err?.field('password')" class="field-error">{{ err.field('password') }}</span>
          </div>
          <button class="btn btn-primary btn-lg btn-block" :disabled="busy">{{ busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account' }}</button>

          <div class="or"><span>or try a demo account</span></div>
          <div class="row" style="--gap: 10px">
            <button type="button" class="btn grow" :disabled="busy" @click="demo('customer')"><UserRound :size="16" /> Demo shopper</button>
            <button type="button" class="btn grow" :disabled="busy" @click="demo('admin')"><ShieldCheck :size="16" /> Demo admin</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth { display: grid; place-items: center; min-height: calc(100vh - var(--header-h) - 80px); }
.panel { display: grid; grid-template-columns: 1fr 1fr; max-width: 920px; margin: 0 auto; overflow: hidden; box-shadow: var(--shadow); }
.side { background: var(--hero-grad); color: #fff; padding: 40px; display: flex; flex-direction: column; gap: 16px; }
.side h2 { color: #fff; font-size: 1.6rem; }
.side p { opacity: .85; }
.side ul { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; opacity: .9; font-size: .92rem; }
.mark { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: rgba(255, 255, 255, .14); color: #fbbf24; }
.form { padding: 36px; display: flex; flex-direction: column; gap: 16px; }
.tabs { display: grid; grid-template-columns: 1fr 1fr; padding: 4px; background: var(--surface-3); border-radius: 12px; }
.tabs button { height: 36px; border: 0; border-radius: 9px; background: none; font-weight: 600; color: var(--text-2); cursor: pointer; }
.tabs button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
.alert { padding: 10px 12px; border-radius: 10px; background: var(--hot-soft); color: var(--hot); font-size: .88rem; font-weight: 550; }
.pw { position: relative; }
.pw .input { padding-right: 44px; }
.eye { position: absolute; right: 5px; top: 5px; }
.or { display: flex; align-items: center; gap: 10px; color: var(--text-3); font-size: .8rem; }
.or::before, .or::after { content: ''; height: 1px; flex: 1; background: var(--border); }
@media (max-width: 760px) { .panel { grid-template-columns: 1fr; } .side { padding: 26px; } .side ul { display: none; } .form { padding: 24px; } }
</style>
