import { html, raw } from '../shared/escape.js';
import { formatPrice } from '../shared/money.js';
import { icon } from '../shared/product-card.js';
import { qs, fragment, on } from '../core/dom.js';
import * as cart from '../services/cart.js';
import { createDrawer } from './drawer.js';
import { cartLineMarkup, freeShippingMarkup } from './cart-view.js';

/** Mini-carrito lateral. Se abre al añadir un producto o al pulsar el icono del carrito. */
export function createCartDrawer(catalog) {
  document.body.append(fragment(html`<aside class="drawer drawer--right" id="cart-drawer" aria-label="Carrito">
  <div class="drawer__head">
    <p class="drawer__title">Tu carrito</p>
    <button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Cerrar carrito">${icon('close')}</button>
  </div>
  <div class="drawer__body" id="cart-drawer-body"></div>
  <div class="drawer__foot" id="cart-drawer-foot"></div>
</aside>`));

  const el = qs('#cart-drawer');
  const body = qs('#cart-drawer-body');
  const foot = qs('#cart-drawer-foot');
  const maxQty = catalog.checkout?.maxQtyPerLine;

  function render() {
    const state = cart.resolve(catalog);
    if (!state.lines.length) {
      body.innerHTML = html`<div class="empty">${icon('cart', 'icon icon--xl')}<p>Tu carrito está vacío.</p>
        <a class="btn btn--primary" href="/tiendaCoches/catalogo" data-close>Ver productos</a></div>`;
      foot.hidden = true;
      return;
    }
    body.innerHTML = html`${raw(freeShippingMarkup(catalog.shipping, state.subtotal))}
      <ul class="cart-lines">${state.lines.map((l) => raw(cartLineMarkup(l, maxQty)))}</ul>`;
    foot.hidden = false;
    foot.innerHTML = html`<dl class="summary__rows" style="margin-bottom:12px">
        <div class="summary__total"><dt>Subtotal</dt><dd>${formatPrice(state.subtotal)}</dd></div></dl>
      <div style="display:grid;gap:8px">
        <a class="btn btn--primary btn--lg btn--block${state.valid.length ? '' : ' is-disabled'}" href="/tiendaCoches/checkout"${state.valid.length ? '' : raw(' aria-disabled="true"')}>Tramitar pedido</a>
        <a class="btn btn--block" href="/tiendaCoches/carrito">Ver carrito</a>
      </div>
      <p class="summary__note" style="margin-top:8px">Gastos de envío calculados en el siguiente paso.</p>`;
  }

  on(el, 'click', '[data-qty-change]', (e, btn) => {
    const id = btn.closest('[data-line]').dataset.line;
    const product = catalog.products.find((p) => p.id === id);
    const next = cart.quantityOf(id) + Number(btn.dataset.qtyChange);
    cart.setQty(id, Math.max(1, Math.min(next, cart.maxFor(product, maxQty))));
  });
  on(el, 'change', '[data-qty-input]', (e, input) => {
    const id = input.closest('[data-line]').dataset.line;
    const product = catalog.products.find((p) => p.id === id);
    const value = parseInt(input.value, 10);
    cart.setQty(id, Math.max(1, Math.min(Number.isFinite(value) ? value : 1, cart.maxFor(product, maxQty))));
  });
  on(el, 'click', '[data-remove]', (e, btn) => cart.removeItem(btn.closest('[data-line]').dataset.line));

  const drawer = createDrawer(el, { onOpen: render });
  cart.subscribe(() => { if (drawer.isOpen()) render(); });
  return drawer;
}
