// Confirmación y consulta de pedidos sin cuenta de cliente (enlace con token o número + email).
import { html, raw } from '../shared/escape.js';
import { formatPrice } from '../shared/money.js';
import { productPath } from '../shared/slug.js';
import { icon, PLACEHOLDER_IMAGE } from '../shared/product-card.js';
import { COUNTRIES, ORDER_STATUS } from '../shared/constants.js';
import { qs, setLoading } from '../core/dom.js';
import { apiGet, apiPost } from '../core/api.js';
import { initApp } from '../core/app.js';
import * as cart from '../services/cart.js';

const root = qs('#order-root');
const params = new URLSearchParams(location.search);
const n = params.get('n');
const t = params.get('t');
const fromPayment = params.get('pago') === 'ok';

const dateFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Madrid' });
const STEPS = ['paid', 'preparing', 'shipped', 'delivered'];
const STEP_LABELS = { paid: 'Pagado', preparing: 'Preparando', shipped: 'Enviado', delivered: 'Entregado' };

function heroMarkup(order, { waitingTooLong }) {
  if (order.paymentStatus === 'pending') {
    return html`<div class="order-hero">
      <div class="order-hero__icon order-hero__icon--pending">${icon('clock')}</div>
      <h1>${waitingTooLong ? 'Estamos esperando la confirmación del pago' : 'Confirmando tu pago…'}</h1>
      <p class="muted">${waitingTooLong
        ? 'Está tardando más de lo normal. Si has completado el pago, recibirás un email de confirmación en unos minutos. No vuelvas a pagar.'
        : 'Solo tardará unos segundos. No cierres esta página.'}</p>
    </div>`;
  }
  if (order.orderStatus === 'cancelled' || order.orderStatus === 'expired') {
    return html`<div class="order-hero">
      <div class="order-hero__icon order-hero__icon--error">${icon('close')}</div>
      <h1>${order.orderStatus === 'expired' ? 'El pago no se completó' : 'Pedido cancelado'}</h1>
      <p class="muted">${order.orderStatus === 'expired' ? 'No se ha realizado ningún cargo. Puedes volver a intentarlo cuando quieras.' : 'Si tienes dudas, contacta con nosotros.'}</p>
      <span class="order-number">Pedido ${order.number}</span>
    </div>`;
  }
  return html`<div class="order-hero">
    <div class="order-hero__icon">${icon('check')}</div>
    <h1>${fromPayment ? `¡Gracias por tu compra, ${order.customer.firstName}!` : `Pedido ${ORDER_STATUS[order.orderStatus]?.label.toLowerCase() ?? ''}`}</h1>
    <p class="muted">${fromPayment ? raw(html`Hemos recibido tu pago. Recibirás la confirmación en <strong>${order.customer.email}</strong>.`) : ''}</p>
    <span class="order-number">Pedido ${order.number}</span>
  </div>`;
}

function orderMarkup(order, opts) {
  const a = order.shippingAddress;
  const stepIndex = STEPS.indexOf(order.orderStatus);
  const active = order.paymentStatus === 'paid' || ['refunded', 'partially_refunded'].includes(order.paymentStatus);
  return html`
  ${raw(heroMarkup(order, opts))}
  ${active && order.orderStatus !== 'cancelled' ? raw(html`<section class="panel" style="margin-bottom:16px">
    <ol class="timeline" aria-label="Estado del pedido">${STEPS.map((s, i) => raw(html`<li class="${i <= stepIndex ? 'is-done' : ''}">${STEP_LABELS[s]}</li>`))}</ol>
  </section>`) : ''}
  ${order.shipping.trackingNumber ? raw(html`<section class="tracking-box" style="margin-bottom:16px">
    <strong>${icon('truck', 'icon icon--sm')} Tu pedido viaja con ${order.shipping.carrier}</strong>
    <span>Número de seguimiento: <span class="mono">${order.shipping.trackingNumber}</span></span>
    ${order.shipping.trackingUrl ? raw(html`<a class="btn btn--dark" href="${order.shipping.trackingUrl}" target="_blank" rel="noopener">Seguir mi envío ${icon('external', 'icon icon--sm')}</a>`) : ''}
  </section>`) : ''}
  <section class="panel" style="margin-bottom:16px">
    <h2 class="panel__title">Productos</h2>
    <ul class="summary-items">${order.items.map((it) => raw(html`<li class="summary-item">
      <span class="summary-item__img"><img src="${it.image || PLACEHOLDER_IMAGE}" alt="" width="56" height="42" loading="lazy"><span class="summary-item__qty">${it.quantity}</span></span>
      <span class="summary-item__name">${it.slug ? raw(html`<a href="${productPath({ slug: it.slug, id: it.productId })}">${it.name}</a>`) : it.name}${it.reference ? raw(html`<br><span class="muted">Ref. ${it.reference}</span>`) : ''}</span>
      <span class="summary-item__price">${formatPrice(it.unitPrice * it.quantity)}</span></li>`))}</ul>
    <dl class="summary__rows" style="margin-top:16px">
      <div><dt>Subtotal</dt><dd>${formatPrice(order.subtotal)}</dd></div>
      <div><dt>Envío ${order.shipping.carrier} · ${order.shipping.zoneName}</dt><dd>${order.shippingCost ? formatPrice(order.shippingCost) : 'Gratis'}</dd></div>
      <div class="summary__total"><dt>Total (IVA incluido)</dt><dd>${formatPrice(order.total)}</dd></div>
    </dl>
  </section>
  <div class="split" style="align-items:start;gap:16px">
    <section class="panel">
      <h2 class="panel__title">Envío</h2>
      <p style="margin:0">${order.customer.firstName} ${order.customer.lastName}<br>${a.line1}${a.line2 ? `, ${a.line2}` : ''}<br>
      ${a.postalCode} ${a.city} (${a.province})<br>${COUNTRIES[a.country] ?? a.country}</p>
      ${order.shipping.deliveryTime ? raw(html`<p class="hint">Plazo habitual: ${order.shipping.deliveryTime}</p>`) : ''}
    </section>
    <section class="panel">
      <h2 class="panel__title">Detalles</h2>
      <dl class="specs">
        <div><dt>Fecha</dt><dd>${order.createdAt ? dateFmt.format(new Date(order.createdAt)) : '—'}</dd></div>
        <div><dt>Estado</dt><dd>${ORDER_STATUS[order.orderStatus]?.label ?? order.orderStatus}</dd></div>
        <div><dt>Email</dt><dd>${order.customer.email}</dd></div>
      </dl>
    </section>
  </div>
  <p class="muted" style="margin-top:20px;font-size:.9rem;text-align:center">
    ¿Necesitas ayuda con tu pedido? <a href="/contacto">Contacta con nosotros</a>
    ${active ? raw(html` · <a href="/legal/devoluciones?pedido=${encodeURIComponent(order.number)}#desistimiento">Desistir de la compra</a>`) : ''}
  </p>`;
}

function lookupMarkup(message) {
  return html`<div style="padding-top:24px">
    <h1 class="page-head__title">Consultar mi pedido</h1>
    <p class="muted">Introduce el número de pedido (aparece en el email de confirmación) y el email con el que compraste.</p>
    ${message ? raw(html`<div class="notice notice--error" style="margin-bottom:16px">${icon('alert')} ${message}</div>`) : ''}
    <form class="card-form" id="lookup-form" novalidate>
      <div class="field"><label class="field__label" for="l-number">Número de pedido</label>
        <input class="input" id="l-number" name="number" placeholder="2026-00012" required value="${params.get('numero') ?? ''}" autocomplete="off"></div>
      <div class="field"><label class="field__label" for="l-email">Email</label>
        <input class="input" id="l-email" name="email" type="email" autocomplete="email" required inputmode="email"></div>
      <div id="lookup-error" role="alert"></div>
      <button class="btn btn--primary btn--lg" type="submit">${icon('search')} Consultar pedido</button>
    </form>
  </div>`;
}

function showLookup(message) {
  root.innerHTML = lookupMarkup(message);
  qs('#lookup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('button[type="submit"]', e.target);
    const { number, email } = Object.fromEntries(new FormData(e.target));
    setLoading(btn, true);
    try {
      const order = await apiPost('/order/lookup', { number: number.trim(), email: email.trim() });
      root.innerHTML = orderMarkup(order, {});
    } catch (err) {
      setLoading(btn, false);
      qs('#lookup-error').innerHTML = html`<div class="notice notice--error">${icon('alert')} ${err.message}</div>`;
    }
  });
}

function clearAfterPurchase() {
  cart.clear();
  try {
    sessionStorage.removeItem('zw_checkout_draft');
    sessionStorage.removeItem('zw_pending_payment');
  } catch { /* ignorar */ }
}

async function loadByToken() {
  const started = Date.now();
  // El pedido se confirma cuando llega el webhook de Stripe: consultamos unas pocas veces (sin listeners).
  for (;;) {
    let order;
    try {
      order = await apiGet(`/order?n=${encodeURIComponent(n)}&t=${encodeURIComponent(t)}`);
    } catch (err) {
      if (err.status === 404) return showLookup(err.message);
      root.innerHTML = html`<div class="notice notice--error" style="margin-top:24px">${icon('alert')} ${err.message} <a href="">Reintentar</a></div>`;
      return;
    }
    const waitingTooLong = Date.now() - started > 45_000;
    root.innerHTML = orderMarkup(order, { waitingTooLong });
    if (order.paymentStatus === 'paid') clearAfterPurchase();
    if (order.paymentStatus !== 'pending' || !fromPayment || waitingTooLong) return;
    await new Promise((r) => setTimeout(r, Date.now() - started < 10_000 ? 1500 : 4000));
  }
}

await initApp();
if (n && t) loadByToken();
else showLookup();
