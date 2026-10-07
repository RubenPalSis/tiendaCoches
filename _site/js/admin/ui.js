// Utilidades de interfaz del panel.
import { html, raw, esc } from '../shared/escape.js';
import { icon } from '../shared/product-card.js';
import { ORDER_STATUS, PAYMENT_STATUS } from '../shared/constants.js';
import { fragment } from '../core/dom.js';
export { toast } from '../components/toast.js';

const dateTime = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const dateShort = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', timeZone: 'Europe/Madrid' });

const toDate = (ts) => (ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : ts ? new Date(ts) : null);
export const fmtDateTime = (ts) => (toDate(ts) ? dateTime.format(toDate(ts)) : '—');
export const fmtDateShort = (ts) => (toDate(ts) ? dateShort.format(toDate(ts)) : '—');

export function statusBadge(status) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: 'muted' };
  return html`<span class="status status--${s.tone}">${s.label}</span>`;
}

export function paymentBadge(status) {
  const tone = { paid: 'success', pending: 'muted', expired: 'muted', failed: 'danger', refunded: 'danger', partially_refunded: 'warning' }[status] ?? 'muted';
  return html`<span class="status status--${tone}">${PAYMENT_STATUS[status] ?? status}</span>`;
}

export function viewHead(title, actions = '', back) {
  return html`${back ? raw(html`<a class="back-link no-print" href="${back.href}">${icon('arrow-left', 'icon icon--sm')} ${back.label}</a>`) : ''}
  <div class="view-head"><h1>${title}</h1><div class="view-head__actions">${raw(actions)}</div></div>`;
}

export const loading = () => html`<p class="muted" style="padding:24px 0">Cargando…</p>`;

export function errorBox(err) {
  const msg = /permission|insufficient/i.test(err?.message ?? '')
    ? 'No tienes permisos para ver esta información.'
    : err?.message || 'Ha ocurrido un error.';
  return html`<div class="notice notice--error">${icon('alert')} ${msg}</div>`;
}

/**
 * Diálogo modal. Resuelve con los datos del formulario o null si se cancela.
 * @param body HTML del cuerpo (puede contener inputs con name)
 */
export function dialog({ title, body, confirm = 'Aceptar', cancel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const el = fragment(html`<dialog class="modal">
      <form method="dialog">
        <div class="modal__head"><h2 class="modal__title">${title}</h2>
          <button type="button" class="btn btn--ghost btn--icon" data-cancel aria-label="Cerrar">${icon('close')}</button></div>
        <div class="modal__body">${raw(body)}</div>
        <div class="modal__foot">
          <button type="button" class="btn" data-cancel>${cancel}</button>
          <button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" value="ok">${confirm}</button>
        </div>
      </form></dialog>`).firstElementChild;
    document.body.append(el);
    const form = el.querySelector('form');
    const finish = (value) => { el.close(); el.remove(); resolve(value); };
    el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => finish(null)));
    el.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = {};
      for (const input of form.elements) {
        if (!input.name) continue;
        data[input.name] = input.type === 'checkbox' ? input.checked : input.value;
      }
      finish(data);
    });
    el.showModal();
  });
}

export const confirmDialog = (title, message, opts = {}) =>
  dialog({ title, body: `<p style="margin:0">${esc(message)}</p>`, ...opts }).then((r) => r !== null);
