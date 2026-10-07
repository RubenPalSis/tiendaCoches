import { html, raw } from '../shared/escape.js';
import { formatPrice } from '../shared/money.js';
import { categoryPath } from '../shared/slug.js';
import { renderProductCard, icon } from '../shared/product-card.js';
import { freeShippingThreshold } from '../shared/shipping.js';
import { qs } from '../core/dom.js';
import { initApp } from '../core/app.js';
import { enhanceSearch } from '../components/header.js';
import { categoryIcon, whatsappUrl } from '../components/store-links.js';

const PER_SECTION = 8;
// Filas completas: 8, 4 o lo que haya si son menos de 4.
const fit = (list) => list.slice(0, list.length >= PER_SECTION ? PER_SECTION : list.length >= 4 ? 4 : list.length);

function fillGrid(id, products, sectionId) {
  const grid = qs(`#${id}`);
  const section = qs(`#${sectionId}`);
  if (!products.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  grid.innerHTML = products.map((p, i) => renderProductCard(p, { eager: i < 2 && id === 'featured' })).join('');
}

function renderCategories({ categories, products }) {
  if (!categories.length) return;
  const counts = new Map();
  for (const p of products) if (p.stock > 0) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
  qs('#categories').innerHTML = categories.map((c) => c.image
    ? html`<a class="cat-tile cat-tile--image" href="${categoryPath(c)}"><img src="${c.image}" alt="" loading="lazy" width="300" height="200">
        <span class="cat-tile__name">${c.name}</span><span class="cat-tile__count">${counts.get(c.id) ?? 0} productos</span></a>`
    : html`<a class="cat-tile" href="${categoryPath(c)}">${icon(categoryIcon(c.name), 'icon cat-tile__icon')}
        <span class="cat-tile__name">${c.name}</span><span class="cat-tile__count">${counts.get(c.id) ?? 0} productos</span></a>`).join('');
  qs('#categories-section').hidden = false;
}

function renderHints({ products, categories }) {
  const brands = [...new Set(products.filter((p) => p.stock > 0 && p.brand).map((p) => p.brand))].slice(0, 4);
  const hints = [
    ...brands.map((b) => ({ label: b, href: `/catalogo?q=${encodeURIComponent(b)}` })),
    ...categories.slice(0, 6 - brands.length).map((c) => ({ label: c.name, href: categoryPath(c) })),
  ];
  if (!hints.length) return;
  qs('#hero-hints').innerHTML = html`<span>Populares:</span>${hints.map((h) => raw(html`<a href="${h.href}">${h.label}</a>`))}`;
}

function renderShippingInfo({ shipping, store }) {
  const zone = shipping.zones?.find((z) => z.active);
  const free = freeShippingThreshold(shipping);
  if (zone) qs('#hero-shipping').textContent = `${zone.name}${zone.deliveryTime ? ` · ${zone.deliveryTime}` : ''}`;
  if (free) qs('#benefit-shipping').textContent = `Envío gratis en pedidos desde ${formatPrice(free)}. Seguimiento online de tu paquete.`;
  if (zone?.deliveryTime) qs('#steps-delivery').textContent = `Plazo habitual: ${zone.deliveryTime}.`;
  const wa = whatsappUrl(store, 'Hola, estoy buscando una pieza: ');
  if (wa) {
    const cta = qs('#cta-contact');
    cta.href = wa;
    cta.target = '_blank';
    cta.rel = 'noopener';
    cta.innerHTML = html`${icon('whatsapp')} Escríbenos por WhatsApp`;
  }
}

/** Textos e imagen de portada configurables (settings/store); si no hay, se mantienen los del HTML. */
function renderHero({ store }) {
  if (store.heroKicker) qs('#hero-kicker').textContent = store.heroKicker;
  if (store.heroTitle) {
    qs('#hero-title').innerHTML = html`${store.heroTitle}${store.heroHighlight ? raw(html` <em>${store.heroHighlight}</em>`) : ''}`;
  }
  if (store.heroLead) qs('#hero-lead').textContent = store.heroLead;
  if (store.heroImage) qs('#hero-image').src = store.heroImage;
}

const { catalog, error } = await initApp();
enhanceSearch(qs('.hero [data-search]'), catalog);
renderHero(catalog);

if (!error) {
  const available = catalog.products.filter((p) => p.stock > 0);
  const featured = available.filter((p) => p.featured);
  const offers = available.filter((p) => p.comparePrice > p.price);
  const featuredList = fit(featured.length >= 4 ? featured : available);
  const shown = new Set(featuredList.map((p) => p.id));

  renderCategories(catalog);
  renderHints(catalog);
  renderShippingInfo(catalog);
  fillGrid('featured', featuredList, 'featured-section');
  fillGrid('offers', offers.slice(0, 4), 'offers-section');
  fillGrid('recent', fit(available.filter((p) => !shown.has(p.id))), 'recent-section');

  if (!catalog.products.length) {
    qs('#featured').innerHTML = html`<p class="empty" style="grid-column:1/-1">Estamos preparando el catálogo. ¡Vuelve muy pronto!</p>`;
  }
} else {
  qs('#featured').innerHTML = html`<p class="empty" style="grid-column:1/-1">No hemos podido cargar los productos. <a href="">Recargar</a></p>`;
}
