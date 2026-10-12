<template>
  <div class="page"><div class="container nf card card-pad">
    <span class="big">404</span><h2>This page sold out</h2><p class="muted">The page you were looking for doesn't exist.</p>
    <RouterLink to="/" class="btn btn-primary">Back to deals</RouterLink>
  </div></div>
</template>
<style scoped>
.nf { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 64px 24px; text-align: center; max-width: 560px; }
.big { font-size: 4rem; font-weight: 800; letter-spacing: -.05em; background: var(--hero-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
</style>
