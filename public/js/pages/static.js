// Páginas de contenido (legales, contacto, 404): rellena los datos de la tienda desde la configuración.
import { html, raw } from '../shared/escape.js';
import { formatPrice } from '../shared/money.js';
import { icon } from '../shared/product-card.js';
import { COUNTRIES } from '../shared/constants.js';
import { qs, qsa, setLoading } from '../core/dom.js';
import { apiPost } from '../core/api.js';
import { initApp } from '../core/app.js';
import { whatsappUrl, telUrl } from '../components/store-links.js';

const { catalog } = await initApp();
const { store, shipping } = catalog;

// <span data-store="ownerName"></span> → valor de settings/store (o aviso visible si falta).
for (const el of qsa('[data-store]')) {
  const value = store[el.dataset.store];
  if (value) el.textContent = value;
  else {
    el.textContent = `[pendiente: ${el.dataset.label || el.dataset.store}]`;
    el.classList.add('missing-data');
  }
}
qsa('[data-store-carrier]').forEach((el) => { el.textContent = shipping.carrier || 'GLS'; });

qsa('.legal-nav a').forEach((a) => {
  if (a.getAttribute('href') === location.pathname) a.setAttribute('aria-current', 'page');
});

// Tabla de tarifas de envío (envíos y condiciones).
const ratesEl = qs('#shipping-rates');
if (ratesEl) {
  const zones = (shipping.zones ?? []).filter((z) => z.active);
  ratesEl.innerHTML = zones.length && shipping.configured
    ? zones.map((z) => html`<h3>${z.name}</h3>
      <p>${z.countries.map((c) => COUNTRIES[c] ?? c).join(', ')}${z.excludePostalPrefixes?.length ? ` (excepto códigos postales que empiezan por ${z.excludePostalPrefixes.join(', ')})` : ''}.
      ${z.deliveryTime ? `Plazo habitual de entrega: ${z.deliveryTime}.` : ''}</p>
      <table><thead><tr><th>Peso total del pedido</th><th>Precio (IVA incluido)</th></tr></thead><tbody>
      ${[...z.rates].sort((a, b) => a.maxWeight - b.maxWeight).map((r) => raw(html`<tr><td>Hasta ${(r.maxWeight / 1000).toLocaleString('es-ES')} kg</td><td>${r.price ? formatPrice(r.price) : 'Gratis'}</td></tr>`))}
      </tbody></table>
      ${z.freeOver ? raw(html`<p><strong>Envío gratis</strong> en pedidos desde ${formatPrice(z.freeOver)}.</p>`) : ''}`).join('')
    : html`<p class="missing-data">[pendiente: configurar tarifas de envío en el panel]</p>`;
}

// Tarjetas de contacto.
const contactEl = qs('#contact-cards');
if (contactEl) {
  const wa = whatsappUrl(store, 'Hola, tengo una consulta: ');
  const cards = [
    wa && html`<a class="contact-card" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp', 'icon icon--lg')}<span><strong>WhatsApp</strong><span>Respuesta rápida</span></span></a>`,
    store.phone && html`<a class="contact-card" href="${telUrl(store.phone)}">${icon('phone', 'icon icon--lg')}<span><strong>Teléfono</strong><span>${store.phone}</span></span></a>`,
    store.email && html`<a class="contact-card" href="mailto:${store.email}">${icon('mail', 'icon icon--lg')}<span><strong>Email</strong><span>${store.email}</span></span></a>`,
  ].filter(Boolean);
  contactEl.innerHTML = cards.length ? cards.join('') : html`<p class="missing-data">[pendiente: datos de contacto en el panel]</p>`;
}

// Formulario de desistimiento en línea.
const withdrawalForm = qs('#withdrawal-form');
if (withdrawalForm) {
  const prefill = new URLSearchParams(location.search).get('pedido');
  if (prefill) withdrawalForm.elements.orderNumber.value = prefill;
  withdrawalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('button[type="submit"]', withdrawalForm);
    const out = qs('#withdrawal-result');
    const data = Object.fromEntries(new FormData(withdrawalForm));
    setLoading(btn, true);
    try {
      const res = await apiPost('/withdrawal', data);
      const when = new Date(res.requestedAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
      withdrawalForm.hidden = true;
      out.innerHTML = html`<div class="notice notice--success">${icon('check-circle')}<div>
        <strong>${res.alreadyRequested ? 'Ya habíamos recibido tu solicitud.' : 'Solicitud de desistimiento recibida.'}</strong><br>
        Fecha de recepción: ${when}. ${res.alreadyRequested ? '' : 'Te hemos enviado un acuse de recibo por email y te contactaremos con las instrucciones de devolución.'}</div></div>`;
    } catch (err) {
      setLoading(btn, false);
      out.innerHTML = html`<div class="notice notice--error">${icon('alert')} ${err.message}</div>`;
    }
  });
}
