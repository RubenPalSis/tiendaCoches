import { html, raw } from '../shared/escape.js';
import { formatPrice } from '../shared/money.js';
import { productPath, categoryPath } from '../shared/slug.js';
import { icon, PLACEHOLDER_IMAGE } from '../shared/product-card.js';
import { qs, qsa, fragment, debounce } from '../core/dom.js';
import { search } from '../services/search.js';
import * as cart from '../services/cart.js';
import { createDrawer } from './drawer.js';
import { whatsappUrl, telUrl } from './store-links.js';

const TOPBAR_ICONS = ['shield', 'truck', 'package', 'users'];

/** Logotipo: imagen configurada (settings/store.logoUrl) o monograma + nombre. */
export function logoMarkup(store) {
  return store.logoUrl
    ? html`<a class="logo" href="/tiendaCoches/" aria-label="${store.name} – inicio"><img class="logo__img" src="${store.logoUrl}" alt="${store.name}" height="48"></a>`
    : html`<a class="logo" href="/tiendaCoches/" aria-label="${store.name} – inicio">
        <img class="logo__mark" src="/tiendaCoches/assets/img/logo-mark.svg" alt="" width="40" height="40">
        <span class="logo__text"><span class="logo__name">${store.name}</span><span class="logo__tagline">${store.tagline}</span></span>
      </a>`;
}

function headerMarkup(catalog, { query }) {
  const { store, categories } = catalog;
  const current = location.pathname;
  return html`
<div class="topbar"><div class="container topbar__inner">${(store.topbar ?? []).filter(Boolean).slice(0, 4).map((t, i) =>
  raw(html`<span class="topbar__item">${icon(TOPBAR_ICONS[i % TOPBAR_ICONS.length])}${t}</span>`))}</div></div>
<header class="header" id="header">
  <div class="container header__bar">
    <div class="header__brand">
      <button type="button" class="btn btn--ghost btn--icon header__menu-btn" data-open-menu aria-label="Abrir menú">${icon('menu')}</button>
      ${raw(logoMarkup(store))}
    </div>
    <form class="search header__search" role="search" action="/tiendaCoches/catalogo" data-search>
      <label class="sr-only" for="header-search">Buscar productos</label>
      <input class="search__input" id="header-search" name="q" type="search" value="${query}" autocomplete="off"
        placeholder="Busca por pieza, referencia, marca o modelo" enterkeyhint="search"
        role="combobox" aria-expanded="false" aria-controls="header-suggest" aria-autocomplete="list">
      <button class="search__btn" type="submit" aria-label="Buscar">${icon('search')}</button>
      <div class="search__suggest" id="header-suggest" role="listbox" hidden></div>
    </form>
    <div class="header__actions">
      <a class="header__action" href="/tiendaCoches/pedido" aria-label="Consultar mi pedido">${icon('package')}<span class="header__action-label">Mi pedido</span></a>
      <button type="button" class="header__action" data-open-cart aria-label="Ver carrito">
        ${icon('cart')}<span class="header__action-label">Carrito</span>
        <span class="cart-count" data-cart-count hidden>0</span>
      </button>
    </div>
  </div>
  <nav class="catnav" aria-label="Categorías">
    <div class="container">
      <ul class="catnav__list">
        <li><a class="catnav__link" href="/tiendaCoches/catalogo"${current === '/tiendaCoches/catalogo' ? raw(' aria-current="page"') : ''}>Todo el catálogo</a></li>
        ${categories.map((c) => raw(html`<li><a class="catnav__link" href="${categoryPath(c)}"${current === categoryPath(c) ? raw(' aria-current="page"') : ''}>${c.name}</a></li>`))}
      </ul>
    </div>
  </nav>
</header>
<aside class="drawer drawer--left" id="menu-drawer" aria-label="Menú">
  <div class="drawer__head">
    <p class="drawer__title">Menú</p>
    <button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Cerrar menú">${icon('close')}</button>
  </div>
  <div class="drawer__body">
    <ul class="menu-list">
      <li><a href="/tiendaCoches/">Inicio ${icon('chevron-right', 'icon icon--sm')}</a></li>
      <li><a href="/tiendaCoches/catalogo">Todo el catálogo ${icon('chevron-right', 'icon icon--sm')}</a></li>
    </ul>
    ${categories.length ? raw(html`<p class="menu-list__group">Categorías</p>
    <ul class="menu-list">${categories.map((c) => raw(html`<li><a href="${categoryPath(c)}">${c.name} ${icon('chevron-right', 'icon icon--sm')}</a></li>`))}</ul>`) : ''}
    <p class="menu-list__group">Ayuda</p>
    <ul class="menu-list">
      <li><a href="/tiendaCoches/pedido">Consultar mi pedido ${icon('chevron-right', 'icon icon--sm')}</a></li>
      <li><a href="/tiendaCoches/legal/envios">Envíos ${icon('chevron-right', 'icon icon--sm')}</a></li>
      <li><a href="/tiendaCoches/legal/devoluciones">Devoluciones ${icon('chevron-right', 'icon icon--sm')}</a></li>
      <li><a href="/tiendaCoches/contacto">Contacto ${icon('chevron-right', 'icon icon--sm')}</a></li>
    </ul>
  </div>
  ${store.phone || store.whatsapp ? raw(html`<div class="drawer__foot">
    ${whatsappUrl(store) ? raw(html`<a class="btn btn--block" href="${whatsappUrl(store)}" target="_blank" rel="noopener">${icon('whatsapp')} Escríbenos por WhatsApp</a>`) : ''}
    ${!whatsappUrl(store) && store.phone ? raw(html`<a class="btn btn--block" href="${telUrl(store.phone)}">${icon('phone')} ${store.phone}</a>`) : ''}
  </div>`) : ''}
</aside>`;
}

function suggestionMarkup(results, query, categoriesById) {
  if (!results.length) {
    return html`<p class="suggest__empty">No hay resultados para «${query}». Prueba con la referencia o la marca.</p>`;
  }
  return html`${results.slice(0, 6).map((p, i) => raw(html`
    <a class="suggest__item" role="option" id="sg-${i}" href="${productPath(p)}">
      <img src="${p.img || PLACEHOLDER_IMAGE}" alt="" width="48" height="36" loading="lazy">
      <span><span class="suggest__name">${p.name}</span><br>
      <span class="suggest__meta">${[p.ref && `Ref. ${p.ref}`, p.brand, categoriesById.get(p.categoryId)?.name].filter(Boolean).join(' · ')}</span></span>
      <span class="suggest__price">${p.stock > 0 ? formatPrice(p.price) : 'Vendido'}</span>
    </a>`))}
    <a class="suggest__all" href="/tiendaCoches/catalogo?q=${encodeURIComponent(query)}">Ver los ${results.length} resultados ${icon('arrow-right', 'icon icon--sm')}</a>`;
}

/** Buscador con sugerencias instantáneas (cabecera y portada). */
export function enhanceSearch(form, catalog) {
  const input = qs('input', form);
  const box = qs('.search__suggest', form);
  if (!input || !box) return;
  const categoriesById = new Map(catalog.categories.map((c) => [c.id, c]));
  let active = -1;

  const hide = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const update = debounce(() => {
    const q = input.value.trim();
    if (q.length < 2) return hide();
    box.innerHTML = suggestionMarkup(search(catalog.products, q, categoriesById), q, categoriesById);
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  }, 120);

  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('keydown', (e) => {
    const options = qsa('.suggest__item', box);
    if (e.key === 'Escape') return hide();
    if (!options.length || box.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options.forEach((o, i) => o.classList.toggle('is-active', i === active));
      input.setAttribute('aria-activedescendant', options[active].id);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      location.href = options[active].href;
    }
  });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) hide(); });
  form.addEventListener('submit', (e) => {
    if (!input.value.trim()) e.preventDefault();
  });
  // Si el usuario empezó a escribir antes de que cargara el catálogo, mostramos ya las sugerencias.
  if (document.activeElement === input && input.value.trim().length >= 2) update();
}

export function renderHeader(catalog, { onOpenCart }) {
  const slot = qs('#site-header');
  const query = new URLSearchParams(location.search).get('q') ?? '';
  slot.replaceWith(fragment(headerMarkup(catalog, { query })));

  const menu = createDrawer(qs('#menu-drawer'));
  qs('[data-open-menu]').addEventListener('click', menu.open);
  qs('[data-open-cart]').addEventListener('click', onOpenCart);
  enhanceSearch(qs('[data-search]'), catalog);

  const badge = qs('[data-cart-count]');
  const refresh = () => {
    const n = cart.count();
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n === 0;
  };
  refresh();
  cart.subscribe(() => {
    refresh();
    badge.classList.remove('bump');
    void badge.offsetWidth;
    badge.classList.add('bump');
  });
}
