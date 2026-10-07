import { html, raw } from '../shared/escape.js';
import { formatPrice } from '../shared/money.js';
import { icon } from '../shared/product-card.js';
import { qs, on } from '../core/dom.js';
import { initApp } from '../core/app.js';
import * as cart from '../services/cart.js';
import { cartLineMarkup, freeShippingMarkup, shippingEstimateLabel } from '../components/cart-view.js';
import { PAYMENT_LOGOS } from '../components/footer.js';

const root = qs('#cart-root');
const { catalog, error } = await initApp();
const maxQty = catalog.checkout?.maxQtyPerLine;

function render() {
  if (error) {
    root.innerHTML = html`<div class="notice notice--error">${icon('alert')} No hemos podido comprobar los precios y el stock. Recarga la página.</div>`;
    return;
  }
  const state = cart.resolve(catalog);
  if (!state.lines.length) {
    root.innerHTML = html`<div class="empty-state">${icon('cart', 'icon icon--xl')}
      <h2>Tu carrito está vacío</h2><p>Encuentra la pieza que necesitas en nuestro catálogo.</p>
      <div class="actions"><a class="btn btn--primary btn--lg" href="/catalogo">Ver catálogo</a></div></div>`;
    return;
  }

  const closed = catalog.checkout?.enabled === false;
  root.innerHTML = html`<div class="cart-layout">
    <section>
      ${state.hasIssues ? raw(html`<div class="notice notice--warning" style="margin-bottom:12px">${icon('alert')}
        <span>Algunos productos han cambiado desde que los añadiste. Revisa los avisos: los productos no disponibles no se incluirán en el pedido.</span></div>`) : ''}
      <ul class="cart-lines">${state.lines.map((l) => raw(cartLineMarkup(l, maxQty)))}</ul>
      <a class="section__link" href="/catalogo" style="margin-top:16px">${icon('arrow-left', 'icon icon--sm')} Seguir comprando</a>
    </section>
    <aside class="sticky-col">
      <div class="summary">
        <h2 class="summary__title">Resumen</h2>
        ${raw(freeShippingMarkup(catalog.shipping, state.subtotal))}
        <dl class="summary__rows">
          <div><dt>Subtotal (${state.count} ${state.count === 1 ? 'artículo' : 'artículos'})</dt><dd>${formatPrice(state.subtotal)}</dd></div>
          <div><dt>Envío ${catalog.shipping.carrier || 'GLS'}</dt><dd>${shippingEstimateLabel(catalog.shipping, state.subtotal)}</dd></div>
          <div class="summary__total"><dt>Total estimado</dt><dd>${formatPrice(state.subtotal)}</dd></div>
        </dl>
        <p class="summary__note">IVA incluido. El envío exacto se calcula con tu código postal.</p>
        ${closed ? raw(html`<div class="notice notice--warning">${icon('info')} ${catalog.checkout.closedMessage}</div>`) : ''}
        <a class="btn btn--primary btn--lg btn--block" href="/checkout"${!state.valid.length || closed ? raw(' aria-disabled="true" tabindex="-1" style="pointer-events:none"') : ''}>
          Tramitar pedido ${icon('arrow-right')}</a>
        <p class="secure-note">${icon('lock')} Pago seguro con Stripe</p>
        ${raw(PAYMENT_LOGOS)}
      </div>
    </aside>
  </div>`;
}

on(root, 'click', '[data-qty-change]', (e, btn) => {
  const id = btn.closest('[data-line]').dataset.line;
  const product = catalog.products.find((p) => p.id === id);
  cart.setQty(id, Math.max(1, Math.min(cart.quantityOf(id) + Number(btn.dataset.qtyChange), cart.maxFor(product, maxQty))));
});
on(root, 'change', '[data-qty-input]', (e, input) => {
  const id = input.closest('[data-line]').dataset.line;
  const product = catalog.products.find((p) => p.id === id);
  const value = parseInt(input.value, 10);
  cart.setQty(id, Math.max(1, Math.min(Number.isFinite(value) ? value : 1, cart.maxFor(product, maxQty))));
});
on(root, 'click', '[data-remove]', (e, btn) => cart.removeItem(btn.closest('[data-line]').dataset.line));

cart.subscribe(render);
render();
