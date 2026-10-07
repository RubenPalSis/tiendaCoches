// Catálogo, búsqueda y páginas de categoría (las de categoría llegan pre-renderizadas desde el servidor).
import { html, raw } from '../shared/escape.js';
import { toCents, centsToInput } from '../shared/money.js';
import { renderProductCard, icon } from '../shared/product-card.js';
import { CONDITIONS } from '../shared/constants.js';
import { qs, on, fragment, debounce } from '../core/dom.js';
import { initApp } from '../core/app.js';
import { search } from '../services/search.js';
import { createDrawer } from '../components/drawer.js';

const PAGE_SIZE = 24;
const SORTS = {
  relevancia: 'Más relevantes',
  recientes: 'Más recientes',
  'precio-asc': 'Precio: de menor a mayor',
  'precio-desc': 'Precio: de mayor a menor',
  nombre: 'Nombre (A-Z)',
};

const main = qs('#main');
const fixedCategory = main.dataset.category || null; // páginas /categoria/:slug

function readState() {
  const p = new URLSearchParams(location.search);
  const list = (k) => (p.get(k) ? p.get(k).split(',').filter(Boolean) : []);
  return {
    q: p.get('q')?.trim() ?? '',
    category: fixedCategory || p.get('categoria') || '',
    brands: list('marca'),
    conditions: list('estado').filter((c) => c in CONDITIONS),
    min: toCents(p.get('min') ?? '') ?? null,
    max: toCents(p.get('max') ?? '') ?? null,
    showSold: p.get('vendidos') === '1',
    offers: p.get('ofertas') === '1',
    sort: SORTS[p.get('orden')] ? p.get('orden') : '',
    limit: PAGE_SIZE,
  };
}

function writeState(state) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.category && !fixedCategory) p.set('categoria', state.category);
  if (state.brands.length) p.set('marca', state.brands.join(','));
  if (state.conditions.length) p.set('estado', state.conditions.join(','));
  if (state.min != null) p.set('min', centsToInput(state.min));
  if (state.max != null) p.set('max', centsToInput(state.max));
  if (state.showSold) p.set('vendidos', '1');
  if (state.offers) p.set('ofertas', '1');
  if (state.sort) p.set('orden', state.sort);
  const qsStr = p.toString();
  history.replaceState(null, '', `${location.pathname}${qsStr ? `?${qsStr}` : ''}`);
}

const SORTERS = {
  recientes: (a, b) => b.createdAt - a.createdAt,
  'precio-asc': (a, b) => a.price - b.price,
  'precio-desc': (a, b) => b.price - a.price,
  nombre: (a, b) => a.name.localeCompare(b.name, 'es'),
};

function compute(catalog, state, categoriesById) {
  let base = catalog.products;
  if (state.category) base = base.filter((p) => p.categoryId === state.category);
  base = search(base, state.q, categoriesById);
  if (!state.showSold) base = base.filter((p) => p.stock > 0);

  // Facetas calculadas antes de aplicar marca/estado para que se puedan combinar.
  const brandCounts = new Map();
  const conditionCounts = new Map();
  for (const p of base) {
    if (p.brand) brandCounts.set(p.brand, (brandCounts.get(p.brand) ?? 0) + 1);
    conditionCounts.set(p.condition, (conditionCounts.get(p.condition) ?? 0) + 1);
  }

  let results = base;
  if (state.brands.length) results = results.filter((p) => state.brands.includes(p.brand));
  if (state.conditions.length) results = results.filter((p) => state.conditions.includes(p.condition));
  if (state.min != null) results = results.filter((p) => p.price >= state.min);
  if (state.max != null) results = results.filter((p) => p.price <= state.max);
  if (state.offers) results = results.filter((p) => p.comparePrice > p.price);

  const sort = state.sort || (state.q ? 'relevancia' : 'recientes');
  if (SORTERS[sort]) results = [...results].sort(SORTERS[sort]);
  // Los vendidos siempre al final.
  if (state.showSold) results = [...results.filter((p) => p.stock > 0), ...results.filter((p) => p.stock <= 0)];

  return {
    results,
    brands: [...brandCounts].sort((a, b) => a[0].localeCompare(b[0], 'es')),
    conditions: [...conditionCounts],
    sort,
  };
}

function filtersMarkup(catalog, state, data) {
  return html`
  ${!fixedCategory && catalog.categories.length ? raw(html`<div class="filter-group">
    <p class="filter-group__title">Categoría</p>
    <ul class="filter-list">
      <li><label class="filter-option"><input type="radio" name="category" value=""${!state.category ? raw(' checked') : ''}> Todas</label></li>
      ${catalog.categories.map((c) => raw(html`<li><label class="filter-option"><input type="radio" name="category" value="${c.id}"${state.category === c.id ? raw(' checked') : ''}> ${c.name}</label></li>`))}
    </ul>
  </div>`) : ''}
  ${data.brands.length ? raw(html`<div class="filter-group">
    <p class="filter-group__title">Marca</p>
    <ul class="filter-list">${data.brands.map(([b, n]) => raw(html`<li><label class="filter-option">
      <input type="checkbox" name="brand" value="${b}"${state.brands.includes(b) ? raw(' checked') : ''}> ${b}<span class="filter-option__count">${n}</span></label></li>`))}</ul>
  </div>`) : ''}
  ${data.conditions.length > 1 || state.conditions.length ? raw(html`<div class="filter-group">
    <p class="filter-group__title">Estado</p>
    <ul class="filter-list">${data.conditions.map(([c, n]) => raw(html`<li><label class="filter-option">
      <input type="checkbox" name="condition" value="${c}"${state.conditions.includes(c) ? raw(' checked') : ''}> ${CONDITIONS[c]}<span class="filter-option__count">${n}</span></label></li>`))}</ul>
  </div>`) : ''}
  <div class="filter-group">
    <p class="filter-group__title">Precio (€)</p>
    <div class="price-range">
      <input class="input" type="text" inputmode="decimal" name="min" placeholder="Mín." value="${state.min != null ? centsToInput(state.min) : ''}" aria-label="Precio mínimo">
      <span>–</span>
      <input class="input" type="text" inputmode="decimal" name="max" placeholder="Máx." value="${state.max != null ? centsToInput(state.max) : ''}" aria-label="Precio máximo">
    </div>
  </div>
  <div class="filter-group" style="display:grid;gap:14px">
    <label class="switch">Solo ofertas <input type="checkbox" name="offers"${state.offers ? raw(' checked') : ''}></label>
    <label class="switch">Mostrar vendidos <input type="checkbox" name="showSold"${state.showSold ? raw(' checked') : ''}></label>
  </div>`;
}

function chipsMarkup(catalog, state) {
  const chips = [];
  if (state.q) chips.push({ key: 'q', label: `«${state.q}»` });
  if (state.category && !fixedCategory) chips.push({ key: 'category', label: catalog.categories.find((c) => c.id === state.category)?.name ?? 'Categoría' });
  state.brands.forEach((b) => chips.push({ key: 'brand', value: b, label: b }));
  state.conditions.forEach((c) => chips.push({ key: 'condition', value: c, label: CONDITIONS[c] }));
  if (state.min != null || state.max != null) chips.push({ key: 'price', label: `${state.min != null ? centsToInput(state.min) : '0'} – ${state.max != null ? centsToInput(state.max) : '∞'} €` });
  if (state.offers) chips.push({ key: 'offers', label: 'Ofertas' });
  if (!chips.length) return '';
  return html`<div class="chips">${chips.map((c) => raw(html`<button type="button" class="chip" data-chip="${c.key}" data-value="${c.value ?? ''}" aria-label="Quitar filtro ${c.label}">${c.label} ${icon('close')}</button>`))}
    <button type="button" class="chip chip--clear" data-clear-filters>Borrar filtros</button></div>`;
}

const { catalog, error } = await initApp();
const categoriesById = new Map(catalog.categories.map((c) => [c.id, c]));
let state = readState();

const aside = qs('#filters');
const toolbar = qs('#toolbar');
const resultsEl = qs('#results');
const loadMoreEl = qs('#load-more');

document.body.append(fragment(html`<aside class="drawer drawer--left" id="filters-drawer" aria-label="Filtros">
  <div class="drawer__head"><p class="drawer__title">Filtros</p><button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Cerrar filtros">${icon('close')}</button></div>
  <div class="drawer__body" id="filters-drawer-body"></div>
  <div class="drawer__foot"><button type="button" class="btn btn--primary btn--block" data-close id="filters-apply">Ver resultados</button></div>
</aside>`));
const filtersDrawer = createDrawer(qs('#filters-drawer'));
const drawerBody = qs('#filters-drawer-body');
const desktop = matchMedia('(min-width: 1024px)');

function updateHeading(count) {
  if (fixedCategory) return;
  const title = qs('#catalog-title');
  const lead = qs('#catalog-lead');
  const cat = categoriesById.get(state.category);
  if (state.q) {
    title.textContent = `Resultados para «${state.q}»`;
    lead.textContent = count ? `Hemos encontrado ${count} productos.` : '';
    document.title = `${state.q} – Búsqueda | ${catalog.store.name}`;
  } else if (cat) {
    title.textContent = cat.name;
    lead.textContent = cat.description || '';
    document.title = `${cat.name} | ${catalog.store.name}`;
  } else {
    title.textContent = state.offers ? 'Ofertas' : 'Catálogo';
    document.title = `${state.offers ? 'Ofertas' : 'Catálogo'} | ${catalog.store.name}`;
  }
}

function render({ filters = true } = {}) {
  const data = compute(catalog, state, categoriesById);
  const visible = data.results.slice(0, state.limit);

  if (filters) {
    const markup = filtersMarkup(catalog, state, data);
    aside.innerHTML = desktop.matches ? markup : '';
    drawerBody.innerHTML = desktop.matches ? '' : markup;
  }
  qs('#filters-apply').textContent = `Ver ${data.results.length} resultados`;

  toolbar.innerHTML = html`
    <p class="toolbar__count" aria-live="polite"><strong>${data.results.length}</strong> ${data.results.length === 1 ? 'producto' : 'productos'}</p>
    <div class="toolbar__actions">
      <button type="button" class="btn btn--sm filters-btn" data-open-filters>${icon('sliders', 'icon icon--sm')} Filtros</button>
      <label class="sr-only" for="sort">Ordenar</label>
      <select class="select" id="sort" name="sort">${Object.entries(SORTS).filter(([k]) => k !== 'relevancia' || state.q).map(([k, label]) =>
        raw(html`<option value="${k}"${data.sort === k ? raw(' selected') : ''}>${label}</option>`))}</select>
    </div>
    ${raw(chipsMarkup(catalog, state))}`;

  if (!data.results.length) {
    resultsEl.innerHTML = html`<div class="empty" style="grid-column:1/-1">${icon('search', 'icon icon--xl')}
      <h2>No hay productos con estos filtros</h2>
      <p>Prueba con otra búsqueda, quita algún filtro o <a href="/tiendaCoches/contacto">pregúntanos por la pieza</a>.</p>
      ${!state.showSold ? raw('<button type="button" class="btn" data-show-sold>Ver también productos vendidos</button>') : ''}</div>`;
  } else {
    resultsEl.innerHTML = visible.map((p, i) => renderProductCard(p, { eager: i < 4 })).join('');
  }

  const remaining = data.results.length - visible.length;
  loadMoreEl.innerHTML = data.results.length > PAGE_SIZE ? html`
    <p class="load-more__info">Has visto ${visible.length} de ${data.results.length} productos</p>
    <div class="progress"><span style="width:${Math.round((visible.length / data.results.length) * 100)}%"></span></div>
    ${remaining > 0 ? raw(html`<button type="button" class="btn" data-load-more>Cargar ${Math.min(remaining, PAGE_SIZE)} más</button>`) : ''}` : '';

  updateHeading(data.results.length);
}

function update(changes, opts) {
  state = { ...state, ...changes, limit: PAGE_SIZE };
  writeState(state);
  render(opts);
}

function onFilterInput(e) {
  const t = e.target;
  if (t.name === 'category') update({ category: t.value });
  else if (t.name === 'brand') update({ brands: t.checked ? [...state.brands, t.value] : state.brands.filter((b) => b !== t.value) });
  else if (t.name === 'condition') update({ conditions: t.checked ? [...state.conditions, t.value] : state.conditions.filter((c) => c !== t.value) });
  else if (t.name === 'offers') update({ offers: t.checked });
  else if (t.name === 'showSold') update({ showSold: t.checked });
}
const onPriceInput = debounce((e) => {
  if (e.target.name !== 'min' && e.target.name !== 'max') return;
  const value = e.target.value.trim() === '' ? null : toCents(e.target.value);
  if (value === null && e.target.value.trim() !== '') return;
  update({ [e.target.name]: value }, { filters: false });
}, 450);

for (const root of [aside, drawerBody]) {
  root.addEventListener('change', onFilterInput);
  root.addEventListener('input', onPriceInput);
}
on(toolbar, 'change', '#sort', (e, select) => update({ sort: select.value }, { filters: false }));
on(toolbar, 'click', '[data-open-filters]', () => filtersDrawer.open());
on(toolbar, 'click', '[data-clear-filters]', () => update({ q: '', category: fixedCategory || '', brands: [], conditions: [], min: null, max: null, offers: false }));
on(toolbar, 'click', '[data-chip]', (e, chip) => {
  const { chip: key, value } = chip.dataset;
  const changes = {
    q: { q: '' }, category: { category: '' }, offers: { offers: false }, price: { min: null, max: null },
    brand: { brands: state.brands.filter((b) => b !== value) },
    condition: { conditions: state.conditions.filter((c) => c !== value) },
  }[key];
  if (key === 'q') { const input = qs('#header-search'); if (input) input.value = ''; }
  update(changes);
});
on(resultsEl, 'click', '[data-show-sold]', () => update({ showSold: true }));
on(loadMoreEl, 'click', '[data-load-more]', () => {
  state.limit += PAGE_SIZE;
  render({ filters: false });
});
desktop.addEventListener('change', () => render());

if (!error) {
  render();
  if (fixedCategory && !categoriesById.has(fixedCategory)) location.replace('/tiendaCoches/catalogo');
} else {
  resultsEl.innerHTML = html`<p class="empty" style="grid-column:1/-1">No hemos podido cargar los productos. <a href="">Recargar</a></p>`;
}

