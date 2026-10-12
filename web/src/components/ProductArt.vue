<script setup lang="ts">
/** Generated product illustration: one drawing per category, tinted by the product's hue. No external images. */
const props = withDefaults(defineProps<{ category: string; hue: number; size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' });
const kind = (['Audio', 'Wearables', 'Mobiles', 'Laptops', 'Home', 'Fashion', 'Gaming'].includes(props.category) ? props.category : 'Other');
</script>

<template>
  <div class="art" :class="size" :style="{ '--h': hue }" aria-hidden="true">
    <svg viewBox="0 0 200 200" class="svg">
      <defs>
        <radialGradient :id="`g-${hue}-${kind}`" cx="50%" cy="38%" r="70%">
          <stop offset="0" class="s1" />
          <stop offset="1" class="s2" />
        </radialGradient>
      </defs>
      <rect width="200" height="200" :fill="`url(#g-${hue}-${kind})`" />
      <ellipse cx="100" cy="166" rx="58" ry="8" class="shadow" />
      <g class="obj">
        <template v-if="kind === 'Audio'">
          <path d="M52 112v-14a48 48 0 0 1 96 0v14" class="stroke" fill="none" stroke-width="10" stroke-linecap="round" />
          <rect x="40" y="104" width="30" height="50" rx="13" class="main" />
          <rect x="130" y="104" width="30" height="50" rx="13" class="main" />
          <rect x="46" y="112" width="10" height="34" rx="5" class="accent" />
          <rect x="144" y="112" width="10" height="34" rx="5" class="accent" />
        </template>
        <template v-else-if="kind === 'Wearables'">
          <rect x="80" y="34" width="40" height="34" rx="8" class="dark" />
          <rect x="80" y="132" width="40" height="34" rx="8" class="dark" />
          <rect x="64" y="62" width="72" height="76" rx="22" class="main" />
          <rect x="72" y="70" width="56" height="60" rx="16" class="screen" />
          <path d="M100 86v16l10 7" class="hand" fill="none" stroke-width="5" stroke-linecap="round" />
          <rect x="136" y="88" width="6" height="16" rx="3" class="accent" />
        </template>
        <template v-else-if="kind === 'Mobiles'">
          <rect x="66" y="28" width="68" height="138" rx="16" class="main" />
          <rect x="72" y="36" width="56" height="122" rx="11" class="screen" />
          <rect x="90" y="42" width="20" height="5" rx="2.5" class="dark" />
          <rect x="80" y="62" width="40" height="8" rx="4" class="accent" opacity=".9" />
          <rect x="80" y="78" width="28" height="6" rx="3" class="accent" opacity=".5" />
          <rect x="80" y="122" width="40" height="22" rx="6" class="accent" opacity=".35" />
        </template>
        <template v-else-if="kind === 'Laptops'">
          <rect x="44" y="50" width="112" height="76" rx="8" class="main" />
          <rect x="51" y="57" width="98" height="62" rx="4" class="screen" />
          <path d="M28 132h144l-10 18H38z" class="dark" />
          <rect x="86" y="132" width="28" height="5" rx="2.5" class="accent" />
          <rect x="60" y="70" width="44" height="7" rx="3.5" class="accent" opacity=".8" />
          <rect x="60" y="84" width="72" height="5" rx="2.5" class="accent" opacity=".4" />
          <rect x="60" y="95" width="56" height="5" rx="2.5" class="accent" opacity=".4" />
        </template>
        <template v-else-if="kind === 'Home'">
          <rect x="56" y="58" width="88" height="100" rx="22" class="main" />
          <rect x="66" y="48" width="68" height="18" rx="9" class="dark" />
          <circle cx="100" cy="102" r="20" class="screen" />
          <circle cx="100" cy="102" r="12" class="accent" />
          <rect x="74" y="134" width="52" height="10" rx="5" class="dark" />
        </template>
        <template v-else-if="kind === 'Fashion'">
          <path d="M34 128c0-14 6-24 18-26 14-2 26-14 34-30 4-6 12-6 16 0 10 18 30 26 52 30 10 2 14 10 14 18v8H34z" class="main" />
          <path d="M34 136h134v10c0 4-3 7-7 7H41c-4 0-7-3-7-7z" class="dark" />
          <path d="M84 86l14 10M90 78l14 10M78 96l14 10" class="hand" stroke-width="5" stroke-linecap="round" />
          <circle cx="146" cy="118" r="6" class="accent" />
        </template>
        <template v-else-if="kind === 'Gaming'">
          <path d="M58 72h84c18 0 30 14 34 36l6 30c3 14-12 22-22 12l-18-18H58l-18 18c-10 10-25 2-22-12l6-30c4-22 16-36 34-36z" class="main" />
          <rect x="54" y="92" width="30" height="9" rx="4.5" class="dark" />
          <rect x="64.5" y="81.5" width="9" height="30" rx="4.5" class="dark" />
          <circle cx="130" cy="88" r="7" class="accent" />
          <circle cx="146" cy="104" r="7" class="accent" opacity=".7" />
          <circle cx="114" cy="104" r="7" class="accent" opacity=".7" />
          <circle cx="130" cy="120" r="7" class="accent" opacity=".5" />
        </template>
        <template v-else>
          <rect x="54" y="62" width="92" height="88" rx="10" class="main" />
          <path d="M54 82h92" class="hand" stroke-width="6" />
          <rect x="88" y="62" width="24" height="40" class="accent" />
        </template>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.art { position: relative; aspect-ratio: 1; overflow: hidden; border-radius: inherit; }
.svg { width: 100%; height: 100%; }
.s1 { stop-color: hsl(var(--h) var(--art-sat) calc(var(--art-l) + 3%)); }
.s2 { stop-color: hsl(var(--h) var(--art-sat) var(--art-l2)); }
.shadow { fill: hsl(var(--h) 40% 8% / .18); }
.main { fill: hsl(var(--h) 70% 52%); }
.dark { fill: hsl(var(--h) 45% var(--art-dark-l)); }
.screen { fill: hsl(var(--h) 40% var(--art-screen-l)); }
.accent { fill: hsl(calc(var(--h) + 40) 95% 72%); }
.stroke { stroke: hsl(var(--h) 55% var(--art-stroke-l)); }
.hand { stroke: hsl(calc(var(--h) + 40) 95% 72%); }
.obj { transform-origin: 100px 110px; transition: transform .35s cubic-bezier(.2, .8, .2, 1); }
.art:hover .obj { transform: scale(1.04) rotate(-1.5deg); }
.sm .obj { transform: scale(.95); }
</style>
