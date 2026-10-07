import { html, raw } from '../../shared/escape.js';
import { formatPrice } from '../../shared/money.js';
import { icon } from '../../shared/product-card.js';
import { qs, on } from '../../core/dom.js';
import { viewHead, statusBadge, fmtDateTime, errorBox } from '../ui.js';

const PAGE = 25;
const FILTERS = {
  'por-preparar': { label: 'Por preparar', statuses: ['paid', 'preparing'] },
  shipped: { label: 'Enviados', statuses: ['shipped'] },
  delivered: { label: 'Entregados', statuses: ['delivered'] },
  cancelled: { label: 'Cancelados', statuses: ['cancelled'] },
  'sin-pagar': { label: 'Sin pagar', statuses: ['pending', 'expired'] },
  todos: { label: 'Todos', statuses: null },
};

const rowMarkup = (o) => html`<a class="row" href="#/pedidos/${o.id}">
  <span class="row__main">
    <span class="row__title">${o.number} · ${o.customer.firstName} ${o.customer.lastName}</span>
    <span class="row__meta">${fmtDateTime(o.createdAt)} · ${o.shippingAddress.city} (${o.shippingAddress.province})</span>
    <span class="row__flags">
      ${o.shipping.trackingNumber ? raw(html`<span class="flag">${o.shipping.carrier} ${o.shipping.trackingNumber}</span>`) : ''}
      ${o.withdrawal?.requestedAt ? raw('<span class="flag flag--danger">Desistimiento</span>') : ''}
      ${o.needsReview ? raw('<span class="flag flag--danger">Revisar</span>') : ''}
      ${['refunded', 'partially_refunded'].includes(o.paymentStatus) ? raw('<span class="flag flag--warn">Reembolsado</span>') : ''}
    </span>
  </span>
  <span class="row__side"><span class="row__amount">${formatPrice(o.total)}</span>${raw(statusBadge(o.orderStatus))}</span>
</a>`;

export async function render(view, { firebase }) {
  const { db, fs } = firebase;
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const filterKey = FILTERS[params.get('estado')] ? params.get('estado') : 'por-preparar';
  const filter = FILTERS[filterKey];

  view.innerHTML = html`${raw(viewHead('Pedidos'))}
    <nav class="tabs" aria-label="Filtrar pedidos">${Object.entries(FILTERS).map(([k, f]) =>
      raw(html`<a class="tab" href="#/pedidos?estado=${k}" aria-current="${k === filterKey}">${f.label}</a>`))}</nav>
    <form class="list-tools" id="search-form" role="search">
      <input class="input" name="number" placeholder="Buscar por nº de pedido (2026-00012) o email" aria-label="Buscar pedido">
      <button class="btn" type="submit">${icon('search', 'icon icon--sm')} Buscar</button>
    </form>
    <div class="rows" id="orders"><p class="muted">Cargando…</p></div>
    <div class="list-more" id="more"></div>`;

  const list = qs('#orders', view);
  const more = qs('#more', view);
  let last = null;

  async function load(append = false) {
    const constraints = [];
    if (filter.statuses) constraints.push(fs.where('orderStatus', 'in', filter.statuses));
    constraints.push(fs.orderBy('createdAt', 'desc'), fs.limit(PAGE));
    if (append && last) constraints.push(fs.startAfter(last));
    try {
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'orders'), ...constraints));
      last = snap.docs.at(-1) ?? last;
      const markup = snap.docs.map((d) => rowMarkup({ id: d.id, ...d.data() })).join('');
      if (append) list.insertAdjacentHTML('beforeend', markup);
      else list.innerHTML = markup || html`<p class="muted">${icon('check-circle', 'icon icon--sm')} No hay pedidos en esta sección.</p>`;
      more.innerHTML = snap.size === PAGE ? html`<button class="btn" type="button" data-more>Cargar más</button>` : '';
    } catch (err) {
      list.innerHTML = errorBox(err);
    }
  }

  on(more, 'click', '[data-more]', () => load(true));
  qs('#search-form', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const term = e.target.number.value.trim();
    if (!term) return load();
    const field = term.includes('@') ? 'customer.email' : 'number';
    try {
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'orders'), fs.where(field, '==', term.toLowerCase()), fs.limit(20)));
      list.innerHTML = snap.docs.map((d) => rowMarkup({ id: d.id, ...d.data() })).join('') || html`<p class="muted">No se ha encontrado ningún pedido.</p>`;
      more.innerHTML = '';
    } catch (err) {
      list.innerHTML = errorBox(err);
    }
  });

  load();
}
