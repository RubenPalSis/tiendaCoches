// Panel de administración: autenticación (solo administradores) y navegación por hash.
import { html, raw } from '../shared/escape.js';
import { icon } from '../shared/product-card.js';
import { qs, qsa, setLoading } from '../core/dom.js';
import { errorBox } from './ui.js';

const root = qs('#admin-root');

let firebase;
try {
  firebase = await import('./firebase.js');
} catch (err) {
  root.innerHTML = html`<div class="login"><div class="login__card">${raw(errorBox(new Error('No se pudo conectar con Firebase. Comprueba tu conexión y recarga la página.')))}</div></div>`;
  throw err;
}
const { auth, authApi, db, fs } = firebase;

const NAV = [
  { href: '#/', label: 'Inicio', icon: 'home', match: /^#\/?$/ },
  { href: '#/pedidos', label: 'Pedidos', icon: 'package', match: /^#\/pedidos/, badge: true },
  { href: '#/productos', label: 'Productos', icon: 'tag', match: /^#\/productos/ },
  { href: '#/categorias', label: 'Categorías', icon: 'grid', match: /^#\/categorias/, extra: true },
  { href: '#/estadisticas', label: 'Estadísticas', icon: 'chart', match: /^#\/estadisticas/ },
  { href: '#/configuracion', label: 'Ajustes', icon: 'settings', match: /^#\/configuracion/ },
];

const ROUTES = [
  [/^#\/?$/, () => import('./views/dashboard.js')],
  [/^#\/pedidos\/([A-Za-z0-9]{20})$/, () => import('./views/order-detail.js')],
  [/^#\/pedidos/, () => import('./views/orders.js')],
  [/^#\/productos\/(nuevo|[A-Za-z0-9]{20})$/, () => import('./views/product-form.js')],
  [/^#\/productos/, () => import('./views/products.js')],
  [/^#\/categorias/, () => import('./views/categories.js')],
  [/^#\/estadisticas/, () => import('./views/stats.js')],
  [/^#\/configuracion/, () => import('./views/settings.js')],
];

function loginView(message) {
  root.innerHTML = html`<div class="login">
    <form class="login__card" id="login-form" novalidate>
      <div class="login__brand"><img src="/tiendaCoches/assets/img/logo-mark.svg" alt="" width="44" height="44">
        <div><h1>Panel de la tienda</h1><p>Acceso solo para administradores</p></div></div>
      ${message ? raw(html`<div class="notice notice--error">${icon('alert')} ${message}</div>`) : ''}
      <div class="field"><label class="field__label" for="l-email">Email</label>
        <input class="input" id="l-email" name="email" type="email" autocomplete="username" required inputmode="email"></div>
      <div class="field"><label class="field__label" for="l-pass">Contraseña</label>
        <input class="input" id="l-pass" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn btn--primary btn--lg" type="submit">Entrar</button>
      <button class="link-btn" type="button" id="reset-pass" style="justify-self:center">He olvidado mi contraseña</button>
      <a href="/tiendaCoches/" style="justify-self:center;font-size:.88rem">← Volver a la tienda</a>
    </form></div>`;

  const form = qs('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('button[type="submit"]', form);
    const { email, password } = Object.fromEntries(new FormData(form));
    setLoading(btn, true);
    try {
      await authApi.signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setLoading(btn, false);
      const msg = /too-many-requests/.test(err.code)
        ? 'Demasiados intentos. Espera unos minutos y vuelve a probar.'
        : 'Email o contraseña incorrectos.';
      loginView(msg);
    }
  });
  qs('#reset-pass').addEventListener('click', async () => {
    const email = qs('#l-email').value.trim();
    if (!email) return loginView('Escribe tu email y vuelve a pulsar «He olvidado mi contraseña».');
    try { await authApi.sendPasswordResetEmail(auth, email); } catch { /* no revelamos si el email existe */ }
    loginView('Si el email corresponde a un administrador, recibirás un enlace para cambiar la contraseña.');
  });
}

function verifyEmailView(user) {
  root.innerHTML = html`<div class="login"><div class="login__card">
    <div class="login__brand"><img src="/tiendaCoches/assets/img/logo-mark.svg" alt="" width="44" height="44">
      <div><h1>Verifica tu email</h1><p>${user.email}</p></div></div>
    <p>Por seguridad, antes de entrar al panel tienes que confirmar que este email es tuyo.</p>
    <button class="btn btn--primary btn--lg" type="button" id="send-verify">Enviarme el email de verificación</button>
    <p class="hint" style="margin:0">Abre el enlace del email y vuelve a esta página. Revisa también la carpeta de spam.</p>
    <button class="btn" type="button" id="verified">Ya lo he verificado</button>
    <button class="link-btn" type="button" id="verify-logout" style="justify-self:center">Cerrar sesión</button>
  </div></div>`;
  qs('#send-verify').addEventListener('click', async (e) => {
    setLoading(e.currentTarget, true);
    try { await authApi.sendEmailVerification(user); e.currentTarget.textContent = 'Email enviado ✓'; } catch { e.currentTarget.textContent = 'Inténtalo en unos minutos'; }
    setLoading(e.currentTarget, false);
  });
  qs('#verified').addEventListener('click', async () => { await user.reload(); await user.getIdToken(true); location.reload(); });
  qs('#verify-logout').addEventListener('click', () => authApi.signOut(auth));
}

function layout(user) {
  root.innerHTML = html`<div class="admin-layout">
    <header class="admin-top">
      <a class="logo" href="#/"><img class="logo__mark" src="/tiendaCoches/assets/img/logo-mark.svg" alt="" width="32" height="32"><span class="logo__text"><span class="logo__name">Panel</span></span></a>
      <div class="admin-top__right">
        <span class="admin-top__email">${user.email}</span>
        <a class="btn btn--ghost btn--sm" href="/tiendaCoches/" target="_blank" rel="noopener">${icon('store', 'icon icon--sm')} <span class="admin-top__email">Ver tienda</span></a>
        <button class="btn btn--ghost btn--icon" type="button" id="logout" aria-label="Cerrar sesión">${icon('logout')}</button>
      </div>
    </header>
    <nav class="admin-nav" aria-label="Secciones">${NAV.map((n) => raw(html`<a href="${n.href}" class="${n.extra ? 'admin-nav__extra' : ''}">${icon(n.icon)}<span>${n.label}</span>${n.badge ? raw('<span class="admin-nav__badge" id="orders-badge" hidden></span>') : ''}</a>`))}</nav>
    <main class="admin-main" id="view"></main>
  </div>`;
  qs('#logout').addEventListener('click', () => authApi.signOut(auth));
}

let renderToken = 0;
async function route() {
  const hash = location.hash || '#/';
  qsa('.admin-nav a').forEach((a, i) => a.toggleAttribute('aria-current', NAV[i].match.test(hash)));
  qsa('.admin-nav a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
  // Contenedor nuevo en cada navegación: así no se acumulan los eventos de vistas anteriores.
  const old = qs('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  const entry = ROUTES.find(([re]) => re.test(hash));
  if (!entry) { location.hash = '#/'; return; }
  const token = ++renderToken;
  view.innerHTML = '<p class="muted" style="padding:24px 0">Cargando…</p>';
  try {
    const mod = await entry[1]();
    if (token !== renderToken) return;
    const params = hash.match(entry[0]).slice(1);
    await mod.render(view, { params, firebase, hash });
  } catch (err) {
    console.error(err);
    if (token === renderToken) view.innerHTML = errorBox(err);
  }
  window.scrollTo(0, 0);
}

/** Pedidos pagados pendientes de preparar → aviso en el menú. */
export async function refreshOrdersBadge() {
  const badge = qs('#orders-badge');
  if (!badge) return;
  try {
    const q = fs.query(fs.collection(db, 'orders'), fs.where('orderStatus', 'in', ['paid', 'preparing']));
    const n = (await fs.getCountFromServer(q)).data().count;
    badge.textContent = String(n);
    badge.hidden = n === 0;
  } catch { badge.hidden = true; }
}

window.addEventListener('hashchange', () => { if (auth.currentUser) route(); });

authApi.onAuthStateChanged(auth, async (user) => {
  if (!user) return loginView();
  let token = await user.getIdTokenResult();
  if (token.claims.admin !== true) {
    const res = await firebase.syncAdminClaim();
    if (res.reason === 'email_not_verified') return verifyEmailView(user);
    if (res.changed) token = await user.getIdTokenResult(true);
  }
  if (token.claims.admin !== true) {
    await authApi.signOut(auth);
    return loginView('Esta cuenta no tiene permisos de administrador.');
  }
  layout(user);
  route();
  refreshOrdersBadge();
});
