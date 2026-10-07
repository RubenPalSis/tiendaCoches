import { html, raw } from '../../shared/escape.js';
import { formatPrice } from '../../shared/money.js';
import { icon } from '../../shared/product-card.js';
import { viewHead, statusBadge, fmtDateTime, errorBox } from '../ui.js';
import { loadStats, sumStats, dayKeyOffset } from './stats-data.js';

export async function render(view, { firebase }) {
  const { db, fs } = firebase;
  view.innerHTML = viewHead('Inicio', html`<a class="btn btn--primary" href="#/productos/nuevo">${icon('plus')} Nueva pieza</a>`) + '<div id="dash"><p class="muted">Cargando…</p></div>';
  const out = view.querySelector('#dash');

  try {
    const orders = fs.collection(db, 'orders');
    const count = async (statuses) =>
      (await fs.getCountFromServer(fs.query(orders, fs.where('orderStatus', 'in', statuses)))).data().count;

    const [toPrepare, shipped, recentSnap, days, setupInfo] = await Promise.all([
      count(['paid', 'preparing']),
      count(['shipped']),
      fs.getDocs(fs.query(orders, fs.where('orderStatus', 'in', ['paid', 'preparing']), fs.orderBy('createdAt', 'desc'), fs.limit(10))),
      loadStats(firebase, 30),
      setupWarnings(firebase),
    ]);
    const today = days.find((d) => d.id === `day_${dayKeyOffset(0)}`) ?? {};
    const month = sumStats(days);
    const pending = recentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    out.innerHTML = html`
      ${raw(setupInfo)}
      <div class="kpis">
        <a class="kpi kpi--accent" href="#/pedidos?estado=por-preparar"><span class="kpi__label">Por preparar</span><span class="kpi__value">${toPrepare}</span><span class="kpi__sub">Pedidos pagados pendientes de enviar</span></a>
        <a class="kpi" href="#/pedidos?estado=shipped"><span class="kpi__label">Enviados</span><span class="kpi__value">${shipped}</span><span class="kpi__sub">En camino</span></a>
        <a class="kpi" href="#/estadisticas"><span class="kpi__label">Ventas hoy</span><span class="kpi__value">${formatPrice(today.revenue ?? 0)}</span><span class="kpi__sub">${today.orders ?? 0} pedidos · ${today.pageViews ?? 0} visitas</span></a>
        <a class="kpi" href="#/estadisticas"><span class="kpi__label">Últimos 30 días</span><span class="kpi__value">${formatPrice(month.revenue)}</span><span class="kpi__sub">${month.orders} pedidos · ${month.itemsSold} piezas</span></a>
      </div>
      <section class="box">
        <h2 class="box__title">Pedidos por preparar <a class="section__link" href="#/pedidos">Ver todos ${icon('arrow-right', 'icon icon--sm')}</a></h2>
        ${pending.length ? raw(html`<div class="rows">${pending.map((o) => raw(html`<a class="row" href="#/pedidos/${o.id}">
          <span class="row__main"><span class="row__title">${o.number} · ${o.customer.firstName} ${o.customer.lastName}</span>
          <span class="row__meta">${fmtDateTime(o.createdAt)} · ${o.items.length} ${o.items.length === 1 ? 'producto' : 'productos'} · ${o.shippingAddress.city}</span></span>
          <span class="row__side"><span class="row__amount">${formatPrice(o.total)}</span>${raw(statusBadge(o.orderStatus))}</span></a>`))}</div>`)
          : raw(html`<p class="muted" style="margin:0">${icon('check-circle', 'icon icon--sm')} No hay pedidos pendientes. ¡Todo al día!</p>`)}
      </section>`;
  } catch (err) {
    out.innerHTML = errorBox(err);
  }
}

/** Avisos de configuración pendiente para que la tienda pueda vender. */
async function setupWarnings({ db, fs }) {
  const [store, shipping] = await Promise.all([
    fs.getDoc(fs.doc(db, 'settings', 'store')),
    fs.getDoc(fs.doc(db, 'settings', 'shipping')),
  ]);
  const missing = [];
  const s = store.data() ?? {};
  if (!store.exists() || !s.ownerName || !s.taxId || !s.address || !s.email) missing.push('Completa los datos del vendedor (nombre, NIF, dirección y email) en Ajustes → Tienda. Aparecen en los textos legales.');
  if (!shipping.exists()) missing.push('Configura las tarifas de envío en Ajustes → Envíos. Hasta entonces no se pueden hacer pedidos.');
  else if ((shipping.data().zones ?? []).some((z) => z.active && z.rates?.every((r) => !r.price))) missing.push('Todas las tarifas de envío están a 0 €. Revisa Ajustes → Envíos.');
  if (!missing.length) return '';
  return html`<div class="notice notice--warning" style="margin-bottom:16px">${icon('alert')}<div><strong>Configuración pendiente</strong><ul>${missing.map((m) => raw(html`<li>${m}</li>`))}</ul></div></div>`;
}
