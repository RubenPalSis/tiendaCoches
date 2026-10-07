// Piezas reutilizables del carrito: líneas, barra de envío gratis y resumen.
import { html, raw } from '../shared/escape.js';
import { formatPrice } from '../shared/money.js';
import { productPath } from '../shared/slug.js';
import { icon, PLACEHOLDER_IMAGE } from '../shared/product-card.js';
import { freeShippingThreshold, cheapestRate } from '../shared/shipping.js';
import { maxFor } from '../services/cart.js';

export function cartLineMarkup(line, maxQtyPerLine) {
  const p = line.product;
  const max = p ? maxFor(p, maxQtyPerLine) : 0;
  return html`<li class="cart-line${line.issue ? ' is-unavailable' : ''}" data-line="${line.id}">
  ${p ? raw(html`<a href="${productPath(p)}"><img class="cart-line__img" src="${p.img || PLACEHOLDER_IMAGE}" alt="" width="110" height="82" loading="lazy"></a>`)
    : raw(html`<img class="cart-line__img" src="${PLACEHOLDER_IMAGE}" alt="" width="110" height="82">`)}
  <div class="cart-line__info">
    ${p ? raw(html`<a class="cart-line__name" href="${productPath(p)}">${p.name}</a>`) : raw('<span class="cart-line__name">Producto no disponible</span>')}
    ${p?.ref ? raw(html`<span class="cart-line__meta">Ref. ${p.ref}${p.brand ? ` · ${p.brand}` : ''}</span>`) : ''}
    ${line.issue ? raw(html`<span class="cart-line__warning">${line.issue}</span>`) : ''}
    <div class="cart-line__row">
      ${p && p.stock > 0 ? raw(html`<div class="qty qty--sm">
        <button type="button" class="qty__btn" data-qty-change="-1" aria-label="Quitar una unidad"${line.qty <= 1 ? raw(' disabled') : ''}>−</button>
        <input class="qty__input" type="number" inputmode="numeric" min="1" max="${max}" value="${Math.min(line.qty, max)}" aria-label="Cantidad" data-qty-input>
        <button type="button" class="qty__btn" data-qty-change="1" aria-label="Añadir una unidad"${line.qty >= max ? raw(' disabled') : ''}>+</button>
      </div>`) : raw('<span></span>')}
      <span class="cart-line__price">${p ? formatPrice(p.price * Math.min(line.qty, max || line.qty)) : ''}</span>
    </div>
    <button type="button" class="cart-line__remove" data-remove>${icon('trash', 'icon icon--sm')} Eliminar</button>
  </div>
</li>`;
}

export function freeShippingMarkup(shipping, subtotal) {
  const threshold = freeShippingThreshold(shipping);
  if (!threshold) return '';
  if (subtotal >= threshold) {
    return html`<div class="free-ship free-ship--done">${icon('check-circle', 'icon icon--sm')} <strong>¡Tienes envío gratis!</strong></div>`;
  }
  const pct = Math.round((subtotal / threshold) * 100);
  return html`<div class="free-ship">Te faltan <strong>${formatPrice(threshold - subtotal)}</strong> para el <strong>envío gratis</strong>
  <div class="free-ship__bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div></div>`;
}

/** Texto de envío en el carrito (antes de conocer la dirección). */
export function shippingEstimateLabel(shipping, subtotal) {
  const threshold = freeShippingThreshold(shipping);
  if (threshold && subtotal >= threshold) return 'Gratis';
  const min = cheapestRate(shipping);
  if (min == null) return 'Se calcula en el siguiente paso';
  return min === 0 ? 'Gratis' : `Desde ${formatPrice(min)}`;
}
