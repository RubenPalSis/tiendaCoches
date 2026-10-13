import { html, raw } from './escape.js';
import { formatPrice, discountPercent } from './money.js';
import { productPath } from './slug.js';
import { CONDITIONS } from './constants.js';

export const PLACEHOLDER_IMAGE = '/assets/img/placeholder.svg';

/** Disponibilidad visible para el comprador a partir de stock y reservas. */
export function availability(p) {
  if (p.stock > 0) {
    // En piezas usadas cada unidad es única: «Última unidad» es real. En productos nuevos con poco
    // stock no se fuerza esa urgencia (el vendedor puede reponer).
    if (p.condition === 'used' && p.stock === 1) return { code: 'low', label: 'Última unidad' };
    if (p.condition === 'used' && p.stock === 2) return { code: 'low', label: 'Últimas 2 unidades' };
    return { code: 'in', label: 'En stock' };
  }
  if (p.reserved) return { code: 'reserved', label: 'Reservado temporalmente' };
  return { code: 'sold', label: 'Vendido' };
}

export function icon(name, cls = 'icon') {
  return raw(`<svg class="${cls}" aria-hidden="true"><use href="/assets/icons.svg#${name}"></use></svg>`);
}

/**
 * Tarjeta de producto. La usan el catálogo (navegador) y las páginas de categoría (servidor).
 * @param p entrada del índice de catálogo
 */
export function renderProductCard(p, { eager = false } = {}) {
  const url = productPath(p);
  const avail = availability(p);
  const off = discountPercent(p.price, p.comparePrice);
  const canBuy = avail.code === 'in' || avail.code === 'low';
  const meta = [p.brand, p.model].filter(Boolean).join(' · ');

  return html`<article class="card${canBuy ? '' : ' card--unavailable'}">
  <a class="card__media" href="${url}" tabindex="-1" aria-hidden="true">
    <img src="${p.img || PLACEHOLDER_IMAGE}" alt="" width="400" height="300" loading="${eager ? 'eager' : 'lazy'}" decoding="async">
    <span class="card__badges">
      ${off ? raw(html`<span class="badge badge--sale">-${off}%</span>`) : ''}
      ${p.condition && p.condition !== 'new' ? raw(html`<span class="badge badge--condition">${CONDITIONS[p.condition]}</span>`) : ''}
      ${!canBuy ? raw(html`<span class="badge badge--${avail.code}">${avail.label}</span>`) : ''}
    </span>
  </a>
  <div class="card__body">
    ${meta ? raw(html`<p class="card__meta">${meta}</p>`) : ''}
    <h3 class="card__title"><a href="${url}">${p.name}</a></h3>
    ${p.ref ? raw(html`<p class="card__ref">Ref. <span class="mono">${p.ref}</span></p>`) : ''}
    <div class="card__footer">
      <div class="price-block">
        <span class="price">${formatPrice(p.price)}</span>
        ${off ? raw(html`<s class="price-old">${formatPrice(p.comparePrice)}</s>`) : ''}
      </div>
      ${canBuy
        ? raw(html`<button type="button" class="btn btn--primary btn--icon card__add" data-add-to-cart="${p.id}" aria-label="Añadir ${p.name} al carrito">${icon('cart-plus')}</button>`)
        : ''}
    </div>
    <p class="stock stock--${avail.code}">${avail.label}</p>
  </div>
</article>`;
}
