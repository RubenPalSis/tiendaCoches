import { html, raw } from '../../shared/escape.js';
import { formatPrice } from '../../shared/money.js';
import { icon, PLACEHOLDER_IMAGE } from '../../shared/product-card.js';
import { CONDITIONS } from '../../shared/constants.js';
import { qs, on, debounce } from '../../core/dom.js';
import { viewHead, errorBox } from '../ui.js';
import { listProducts, listCategories } from '../data.js';
import { search } from '../../services/search.js';

const FILTERS = {
  todos: { label: 'Todos', fn: () => true },
  disponibles: { label: 'Disponibles', fn: (p) => p.active && p.stock > 0 },
  agotados: { label: 'Vendidos / sin stock', fn: (p) => p.stock <= 0 },
  ocultos: { label: 'Ocultos', fn: (p) => !p.active },
  sinfoto: { label: 'Sin fotos', fn: (p) => !p.images?.length },
};

const rowMarkup = (p, categories) => html`<a class="row row--product${p.active ? '' : ' is-inactive'}" href="#/productos/${p.id}">
  <img class="row__thumb" src="${p.images?.[0]?.sm || PLACEHOLDER_IMAGE}" alt="" width="64" height="48" loading="lazy">
  <span class="row__main">
    <span class="row__title">${p.name}</span>
    <span class="row__meta">${[p.reference && `Ref. ${p.reference}`, categories.get(p.categoryId)?.name, CONDITIONS[p.condition]].filter(Boolean).join(' · ')}</span>
    <span class="row__flags">
      ${!p.active ? raw('<span class="flag">Oculto</span>') : ''}
      ${p.featured ? raw('<span class="flag flag--ok">Destacado</span>') : ''}
      ${p.reserved > 0 ? raw(html`<span class="flag flag--warn">${p.reserved} en pago</span>`) : ''}
      ${!p.images?.length ? raw('<span class="flag flag--warn">Sin fotos</span>') : ''}
    </span>
  </span>
  <span class="row__side"><span class="row__amount">${formatPrice(p.price)}</span>
    <span class="flag ${p.stock > 0 ? 'flag--ok' : 'flag--danger'}">${p.stock > 0 ? `Stock: ${p.stock}` : p.soldCount ? 'Vendido' : 'Sin stock'}</span></span>
</a>`;

export async function render(view) {
  view.innerHTML = html`${raw(viewHead('Productos', html`<a class="btn" href="#/categorias">${icon('grid', 'icon icon--sm')} Categorías</a>
    <button class="btn" type="button" data-refresh aria-label="Recargar">${icon('refresh', 'icon icon--sm')}</button>
    <a class="btn btn--primary" href="#/productos/nuevo">${icon('plus')} Nueva pieza</a>`))}
    <div class="list-tools">
      <input class="input" type="search" id="q" placeholder="Buscar por nombre, referencia, marca…" aria-label="Buscar productos">
      <select class="select" id="cat" aria-label="Categoría"><option value="">Todas las categorías</option></select>
    </div>
    <nav class="tabs" id="tabs" aria-label="Filtrar"></nav>
    <div class="rows" id="list"><p class="muted">Cargando…</p></div>`;

  const list = qs('#list', view);
  let filter = 'todos';
  let products = [];
  let categories = new Map();

  function draw() {
    const q = qs('#q', view).value;
    const cat = qs('#cat', view).value;
    let items = products.filter(FILTERS[filter].fn);
    if (cat) items = items.filter((p) => p.categoryId === cat);
    items = search(items.map((p) => ({ ...p, ref: p.reference, compat: p.compatibility, _src: p })), q, categories).map((x) => x._src);
    qs('#tabs', view).innerHTML = Object.entries(FILTERS).map(([k, f]) =>
      html`<button type="button" class="tab" data-filter="${k}" aria-current="${k === filter}">${f.label}<span class="tab__count">${products.filter(f.fn).length}</span></button>`).join('');
    list.innerHTML = items.length
      ? items.map((p) => rowMarkup(p, categories)).join('')
      : html`<div class="empty">${products.length ? 'No hay productos con estos filtros.' : raw(html`Todavía no hay productos. <a href="#/productos/nuevo">Publica tu primera pieza</a>.`)}</div>`;
  }

  async function load(fresh = false) {
    try {
      const [p, c] = await Promise.all([listProducts({ fresh }), listCategories()]);
      products = p;
      categories = new Map(c.map((x) => [x.id, x]));
      qs('#cat', view).innerHTML = html`<option value="">Todas las categorías</option>${c.map((x) => raw(html`<option value="${x.id}">${x.name}</option>`))}`;
      draw();
    } catch (err) {
      list.innerHTML = errorBox(err);
    }
  }

  qs('#q', view).addEventListener('input', debounce(draw, 150));
  qs('#cat', view).addEventListener('change', draw);
  on(view, 'click', '[data-filter]', (e, b) => { filter = b.dataset.filter; draw(); });
  on(view, 'click', '[data-refresh]', () => load(true));
  load();
}
