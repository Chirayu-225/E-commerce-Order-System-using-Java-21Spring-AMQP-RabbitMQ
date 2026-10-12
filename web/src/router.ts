import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from './stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, _from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, top: 80, behavior: 'smooth' };
    return { top: 0 };
  },
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    { path: '/product/:id', name: 'product', component: () => import('./views/ProductView.vue'), props: true },
    { path: '/login', name: 'login', component: () => import('./views/AuthView.vue'), meta: { guestOnly: true } },
    { path: '/checkout', name: 'checkout', component: () => import('./views/CheckoutView.vue'), meta: { auth: true } },
    { path: '/orders', name: 'orders', component: () => import('./views/OrdersView.vue'), meta: { auth: true } },
    { path: '/orders/:id', name: 'order', component: () => import('./views/OrderView.vue'), props: true, meta: { auth: true } },
    { path: '/orders/:id/pay', name: 'pay', component: () => import('./views/PayView.vue'), props: true, meta: { auth: true } },
    { path: '/admin', name: 'admin', component: () => import('./views/admin/AdminView.vue'), meta: { auth: true, admin: true } },
    { path: '/:pathMatch(.*)*', name: 'notfound', component: () => import('./views/NotFound.vue') },
  ],
});

router.beforeEach((to) => {
  const auth = useAuth();
  if (to.meta.auth && !auth.isAuthed) return { path: '/login', query: { next: to.fullPath } };
  if (to.meta.admin && !auth.isAdmin) return { path: '/' };
  if (to.meta.guestOnly && auth.isAuthed) return { path: String(to.query.next ?? '/') };
});

router.afterEach((to) => {
  const titles: Record<string, string> = { home: 'Flash deals', checkout: 'Checkout', orders: 'My orders', order: 'Order', pay: 'Payment', login: 'Sign in', admin: 'Admin console' };
  document.title = `${titles[String(to.name)] ? titles[String(to.name)] + ' · ' : ''}FlashCart`;
});
