import { html, raw } from '../../shared/escape.js';
import { formatPrice } from '../../shared/money.js';
import { qs, on } from '../../core/dom.js';
import { viewHead, errorBox } from '../ui.js';
import { listProducts } from '../data.js';
import { loadStats, sumStats, dailySeries } from './stats-data.js';

const RANGES = { 7: '7 días', 30: '30 días', 90: '90 días' };
const dayLabel = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const label = (key) => dayLabel.format(new Date(`${key}T00:00:00Z`));

/** Columnas diarias: barras finas (≤24px), extremo redondeado de 4px, base recta, tooltip por barra. */
function barChart(series, format) {
  const W = 720, H = 240, pad = { t: 12, r: 8, b: 26, l: 56 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const max = Math.max(1, ...series.map((d) => d.value));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const band = iw / series.length;
  const bw = Math.min(24, Math.max(2, band * 0.6));
  const y = (v) => pad.t + ih - (v / top) * ih;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const every = Math.ceil(series.length / 8);

  const bars = series.map((d, i) => {
    const x = pad.l + band * i + (band - bw) / 2;
    const h = Math.max(0, pad.t + ih - y(d.value));
    const r = Math.min(4, h, bw / 2);
    const path = h > 0
      ? `M${x},${pad.t + ih}V${pad.t + ih - h + r}Q${x},${pad.t + ih - h} ${x + r},${pad.t + ih - h}H${x + bw - r}Q${x + bw},${pad.t + ih - h} ${x + bw},${pad.t + ih - h + r}V${pad.t + ih}Z`
      : '';
    return html`<g class="bar-g" data-tip="${label(d.key)}: ${format(d.value)}">
      <rect x="${pad.l + band * i}" y="${pad.t}" width="${band}" height="${ih}" fill="transparent"></rect>
      ${path ? raw(html`<path class="bar" d="${path}"></path>`) : ''}
      ${i % every === 0 ? raw(html`<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${label(d.key)}</text>`) : ''}
    </g>`;
  }).join('');

  return html`<div class="chart-wrap" style="position:relative">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica diaria">
      ${raw(ticks.map((t) => html`<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"></line>
        <text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${format(t)}</text>`).join(''))}
      ${raw(bars)}
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
}

function rank(entries, names, fmt) {
  if (!entries.length) return html`<p class="muted" style="margin:0">Sin datos en este periodo.</p>`;
  return html`<ol class="rank">${entries.map(([id, n]) => raw(html`<li><a class="rank__name" href="#/productos/${id}">${names.get(id) ?? 'Producto eliminado'}</a><span class="rank__value">${fmt(n)}</span></li>`))}</ol>`;
}

export async function render(view, { firebase }) {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const days = RANGES[params.get('dias')] ? Number(params.get('dias')) : 30;
  const metric = params.get('ver') === 'pedidos' ? 'orders' : params.get('ver') === 'visitas' ? 'pageViews' : 'revenue';

  view.innerHTML = html`${raw(viewHead('Estadísticas'))}
    <nav class="tabs" aria-label="Periodo">${Object.entries(RANGES).map(([d, l]) =>
      raw(html`<a class="tab" href="#/estadisticas?dias=${d}&ver=${params.get('ver') ?? ''}" aria-current="${Number(d) === days}">${l}</a>`))}</nav>
    <div id="stats"><p class="muted">Cargando…</p></div>`;
  const out = qs('#stats', view);

  try {
    const [docs, products] = await Promise.all([loadStats(firebase, days), listProducts()]);
    const t = sumStats(docs);
    const names = new Map(products.map((p) => [p.id, p.name]));
    const top = (map, n = 8) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
    const series = dailySeries(docs, days, metric);
    const fmt = metric === 'revenue' ? (v) => formatPrice(v) : (v) => v.toLocaleString('es-ES');
    const conv = t.pageViews ? ((t.orders / t.pageViews) * 100).toFixed(1) : '0.0';
    const funnel = [
      ['Visitas', t.pageViews], ['Productos vistos', t.productViewsTotal], ['Añadidos al carrito', t.addToCart],
      ['Pagos iniciados', t.checkoutStarted], ['Pedidos pagados', t.orders],
    ];
    const fmax = Math.max(1, ...funnel.map((f) => f[1]));
    const metricTab = (key, text) => html`<a class="tab" href="#/estadisticas?dias=${days}&ver=${key}" aria-current="${(key === 'pedidos' && metric === 'orders') || (key === 'visitas' && metric === 'pageViews') || (key === '' && metric === 'revenue')}">${text}</a>`;

    out.innerHTML = html`
      <div class="kpis">
        <div class="kpi kpi--accent"><span class="kpi__label">Ventas</span><span class="kpi__value">${formatPrice(t.revenue)}</span><span class="kpi__sub">IVA incluido, últimos ${days} días</span></div>
        <div class="kpi"><span class="kpi__label">Pedidos</span><span class="kpi__value">${t.orders}</span><span class="kpi__sub">Ticket medio ${formatPrice(t.orders ? Math.round(t.revenue / t.orders) : 0)}</span></div>
        <div class="kpi"><span class="kpi__label">Piezas vendidas</span><span class="kpi__value">${t.itemsSold}</span><span class="kpi__sub">unidades</span></div>
        <div class="kpi"><span class="kpi__label">Visitas</span><span class="kpi__value">${t.pageViews.toLocaleString('es-ES')}</span><span class="kpi__sub">Conversión ${conv.replace('.', ',')} %</span></div>
      </div>
      <section class="box">
        <h2 class="box__title">Evolución diaria</h2>
        <nav class="tabs">${raw(metricTab('', 'Ventas'))}${raw(metricTab('pedidos', 'Pedidos'))}${raw(metricTab('visitas', 'Visitas'))}</nav>
        ${raw(barChart(series, fmt))}
        <details style="margin-top:8px"><summary class="muted" style="cursor:pointer;font-size:.85rem">Ver como tabla</summary>
          <table class="legal" style="display:table;width:100%;font-size:.85rem;margin-top:8px"><thead><tr><th>Día</th><th>Valor</th></tr></thead>
          <tbody>${series.filter((d) => d.value).map((d) => raw(html`<tr><td>${label(d.key)}</td><td>${fmt(d.value)}</td></tr>`))}</tbody></table></details>
      </section>
      <div class="two-col" style="margin-top:16px">
        <section class="box"><h2 class="box__title">Más vendidos</h2>${raw(rank(top(t.productSales), names, (n) => `${n} uds.`))}</section>
        <section class="box"><h2 class="box__title">Embudo de compra</h2>
          <div class="funnel">${funnel.map(([l, v]) => raw(html`<div class="funnel__row"><span>${l}</span><span class="funnel__bar"><span style="width:${(v / fmax) * 100}%"></span></span><strong>${v.toLocaleString('es-ES')}</strong></div>`))}</div>
        </section>
      </div>
      <div class="two-col" style="margin-top:16px">
        <section class="box"><h2 class="box__title">Más vistos</h2>${raw(rank(top(t.productViews), names, (n) => `${n} visitas`))}</section>
        <section class="box"><h2 class="box__title">Más añadidos al carrito</h2>${raw(rank(top(t.productAddToCart), names, (n) => `${n} veces`))}</section>
      </div>
      <p class="hint">Estadísticas propias sin cookies: cuentan páginas vistas (no personas) y excluyen robots conocidos. Las ventas se registran al confirmarse el pago.</p>`;

    const wrap = qs('.chart-wrap', out);
    const tip = qs('.chart-tip', out);
    on(wrap, 'pointerover', '.bar-g', (e, g) => {
      const box = wrap.getBoundingClientRect();
      const r = g.getBoundingClientRect();
      tip.textContent = g.dataset.tip;
      tip.hidden = false;
      tip.style.left = `${Math.min(box.width - 140, Math.max(0, r.left - box.left + r.width / 2 - 70))}px`;
    });
    wrap.addEventListener('pointerleave', () => { tip.hidden = true; });
  } catch (err) {
    out.innerHTML = errorBox(err);
  }
}
