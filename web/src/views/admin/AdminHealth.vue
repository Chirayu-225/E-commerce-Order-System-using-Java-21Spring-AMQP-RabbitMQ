<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { CheckCircle2, XCircle, RefreshCw, Database, Server, Radio, Gauge, Wrench } from '@lucide/vue';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useToast } from '@/stores/toast';

const toast = useToast();
const integrity = ref<Awaited<ReturnType<typeof api.admin.integrity>> | null>(null);
const sys = ref<any>(null);
const checking = ref(false);

async function runChecks() {
  checking.value = true;
  try { integrity.value = await api.admin.integrity(); } finally { checking.value = false; }
}
async function loadSys() { try { sys.value = await api.admin.system(); } catch { /* keep */ } }
async function reconcile() {
  const r = await api.admin.reconcile();
  toast.success('Redis gates rebuilt from Postgres', `${r.reconciled.length} sale counter(s) reconciled`);
  void runChecks();
}
let t: number | undefined;
const start = () => { void runChecks(); void loadSys(); clearInterval(t); t = window.setInterval(loadSys, 3000); };
onMounted(start); onActivated(start);
onDeactivated(() => clearInterval(t)); onBeforeUnmount(() => clearInterval(t));

const counters = computed(() => Object.entries((sys.value?.counters ?? {}) as Record<string, number>).sort());
const fmtUptime = (s: number) => (s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
</script>

<template>
  <div class="stack" style="--gap: 20px">
    <section class="card card-pad stack" style="--gap: 14px">
      <div class="spread wrap">
        <div>
          <h3 class="row" style="--gap: 8px">
            <component :is="integrity?.ok === false ? XCircle : CheckCircle2" :size="20" :class="integrity?.ok === false ? 'bad' : 'good'" />
            Data integrity{{ integrity ? (integrity.ok ? ': all invariants hold' : ': attention needed') : '' }}
          </h3>
          <p class="subtle">Every invariant is re-derived from raw rows (inventory, ledger, orders, payments, Redis). {{ integrity ? `Checked ${dateTime(integrity.checkedAt)}` : '' }}</p>
        </div>
        <div class="row" style="--gap: 8px">
          <button class="btn btn-sm" @click="reconcile"><Wrench :size="14" /> Reconcile Redis</button>
          <button class="btn btn-sm btn-primary" :disabled="checking" @click="runChecks"><RefreshCw :size="14" :class="{ spin: checking }" /> Run checks</button>
        </div>
      </div>
      <ul v-if="integrity" class="checks">
        <li v-for="c in integrity.checks" :key="c.name" :class="{ fail: !c.ok }">
          <component :is="c.ok ? CheckCircle2 : XCircle" :size="18" :class="c.ok ? 'good' : 'bad'" />
          <div><b>{{ c.name }}</b><span class="subtle">{{ c.detail }}</span></div>
        </li>
      </ul>
      <div v-else class="skeleton" style="height: 220px" />
    </section>

    <div v-if="sys" class="tiles">
      <div class="card tile"><span class="ti"><Server :size="17" /></span><span class="subtle">Uptime</span><b>{{ fmtUptime(sys.uptimeSec) }}</b></div>
      <div class="card tile"><span class="ti"><Database :size="17" /></span><span class="subtle">DB pool (total / idle / waiting)</span><b class="tnum">{{ sys.db.poolTotal }} / {{ sys.db.poolIdle }} / {{ sys.db.poolWaiting }}</b></div>
      <div class="card tile"><span class="ti"><Gauge :size="17" /></span><span class="subtle">Cache hit ratio</span><b class="tnum">{{ sys.cache.hitRatio === null ? 'n/a' : (sys.cache.hitRatio * 100).toFixed(1) + '%' }}</b></div>
      <div class="card tile"><span class="ti"><Radio :size="17" /></span><span class="subtle">Live SSE connections</span><b class="tnum">{{ sys.sseConnections }}</b></div>
    </div>

    <div v-if="sys" class="two">
      <section class="card card-pad stack" style="--gap: 12px">
        <div class="spread"><h3>RabbitMQ queues</h3><span class="badge" :class="sys.rabbit ? 'badge-ok' : 'badge-hot'"><span class="dot" />{{ sys.rabbit ? 'connected' : 'down' }}</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Queue</th><th>Ready</th><th>Consumers</th></tr></thead>
          <tbody><tr v-for="q in sys.queues" :key="q.queue"><td class="mono">{{ q.queue }}</td><td class="tnum">{{ q.messages }}</td><td class="tnum">{{ q.consumers }}</td></tr></tbody>
        </table></div>
        <p class="subtle">Outbox: {{ sys.outbox.pending }} pending of {{ sys.outbox.total }} events{{ sys.outbox.oldestAgeSec ? ` · oldest ${sys.outbox.oldestAgeSec.toFixed(1)}s` : '' }}</p>
      </section>
      <section class="card card-pad stack" style="--gap: 12px">
        <div class="spread"><h3>Counters</h3><span class="badge" :class="sys.redis ? 'badge-ok' : 'badge-hot'"><span class="dot" />Redis {{ sys.redis ? 'up' : 'down' }} · gate {{ sys.gateEnabled ? 'on' : 'off' }}</span></div>
        <div class="table-wrap"><table class="table">
          <tbody><tr v-for="[k, v] in counters" :key="k"><td class="mono">{{ k }}</td><td class="tnum right">{{ v.toLocaleString('en-IN') }}</td></tr></tbody>
        </table></div>
        <p v-if="!counters.length" class="muted">No traffic yet.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.good { color: var(--ok); } .bad { color: var(--hot); }
.checks { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.checks li { display: flex; gap: 10px; padding: 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); }
.checks li.fail { background: var(--hot-soft); border-color: transparent; }
.checks li div { display: flex; flex-direction: column; gap: 2px; }
.checks b { font-size: .9rem; }
.checks svg { flex: none; margin-top: 1px; }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.tile { padding: 16px; display: flex; flex-direction: column; gap: 3px; }
.tile b { font-size: 1.3rem; }
.ti { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--surface-3); color: var(--text-2); margin-bottom: 4px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.right { text-align: right; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 900px) { .checks, .two { grid-template-columns: 1fr; } .tiles { grid-template-columns: repeat(2, 1fr); } }
</style>
