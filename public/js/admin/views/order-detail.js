import { html, raw } from '../../shared/escape.js';
import { formatPrice } from '../../shared/money.js';
import { icon, PLACEHOLDER_IMAGE } from '../../shared/product-card.js';
import { productPath } from '../../shared/slug.js';
import { ORDER_STATUS, ORDER_TRANSITIONS, CANCELLABLE, COUNTRIES } from '../../shared/constants.js';
import { qs, on, setLoading } from '../../core/dom.js';
import { viewHead, statusBadge, paymentBadge, fmtDateTime, errorBox, toast, dialog } from '../ui.js';
import { refreshOrdersBadge } from '../app.js';
import { listProducts } from '../data.js';

const EMAIL_LABELS = { confirmation: 'Confirmación', shipped: 'Envío', cancelled: 'Cancelación' };

const ACTION_LABELS = {
  preparing: { label: 'Marcar como «Preparando»', icon: 'package', cls: 'btn--dark' },
  paid: { label: 'Volver a «Pagado»', icon: 'arrow-left', cls: '' },
  delivered: { label: 'Marcar como entregado', icon: 'check-circle', cls: 'btn--dark' },
};

function addressText(o) {
  const a = o.shippingAddress;
  return [
    `${o.customer.firstName} ${o.customer.lastName}`,
    `${a.line1}${a.line2 ? `, ${a.line2}` : ''}`,
    `${a.postalCode} ${a.city} (${a.province})`,
    COUNTRIES[a.country] ?? a.country,
    `Tel. ${o.customer.phone}`,
  ].join('\n');
}

function markup(o) {
  const transitions = (ORDER_TRANSITIONS[o.orderStatus] ?? []).filter((s) => s !== 'shipped');
  const canShip = ORDER_TRANSITIONS[o.orderStatus]?.includes('shipped');
  const canCancel = CANCELLABLE.includes(o.orderStatus);
  const history = [...(o.history ?? [])].sort((a, b) => (b.at?.toMillis?.() ?? 0) - (a.at?.toMillis?.() ?? 0));

  return html`
  ${raw(viewHead(`Pedido ${o.number}`, html`<button class="btn no-print" type="button" data-print>${icon('printer', 'icon icon--sm')} Hoja de pedido</button>`, { href: '#/pedidos', label: 'Pedidos' }))}
  <div class="print-only"><p><strong>Fecha:</strong> ${fmtDateTime(o.createdAt)}</p></div>
  ${o.needsReview ? raw(html`<div class="alert-box">${icon('alert', 'icon icon--sm')} <strong>Revisar:</strong> ${o.needsReview}</div>`) : ''}
  ${o.withdrawal?.requestedAt ? raw(html`<div class="alert-box">${icon('return', 'icon icon--sm')} <strong>El cliente ha solicitado desistir</strong> el ${fmtDateTime(o.withdrawal.requestedAt)}.${o.withdrawal.message ? ` Mensaje: «${o.withdrawal.message}»` : ''} Contacta con el cliente para organizar la devolución y, al recibirla, cancela el pedido con reembolso.</div>`) : ''}
  <div class="order-grid">
    <div>
      <section class="box">
        <h2 class="box__title">Productos <span>${raw(statusBadge(o.orderStatus))}</span></h2>
        <ul class="summary-items">${o.items.map((it) => raw(html`<li class="summary-item">
          <span class="summary-item__img"><img src="${it.image || PLACEHOLDER_IMAGE}" alt="" width="56" height="42"><span class="summary-item__qty">${it.quantity}</span></span>
          <span class="summary-item__name"><a href="#/productos/${it.productId}">${it.name}</a>${it.reference ? raw(html`<br><span class="muted">Ref. ${it.reference}</span>`) : ''}
            <span class="muted"> · ${it.quantity} × ${formatPrice(it.unitPrice)}</span></span>
          <span class="summary-item__price">${formatPrice(it.unitPrice * it.quantity)}</span></li>`))}</ul>
        <dl class="summary__rows" style="margin-top:14px">
          <div><dt>Subtotal</dt><dd>${formatPrice(o.subtotal)}</dd></div>
          <div><dt>Envío ${o.shipping.carrier} · ${o.shipping.zoneName} (${(o.shipping.weight / 1000).toLocaleString('es-ES')} kg)</dt><dd>${o.shippingCost ? formatPrice(o.shippingCost) : 'Gratis'}</dd></div>
          <div class="summary__total"><dt>Total cobrado</dt><dd>${formatPrice(o.total)}</dd></div>
        </dl>
      </section>
      <section class="box">
        <h2 class="box__title">Envío ${o.shipping.carrier}
          <button class="btn btn--sm no-print" type="button" data-copy-address>${icon('copy', 'icon icon--sm')} Copiar dirección</button></h2>
        <div class="address-block">${addressText(o)}</div>
        ${o.shippingAddress.notes ? raw(html`<p style="margin:10px 0 0"><strong>Notas del cliente:</strong> ${o.shippingAddress.notes}</p>`) : ''}
        <dl class="kv" style="margin-top:12px">
          <div><dt>Peso estimado</dt><dd>${(o.shipping.weight / 1000).toLocaleString('es-ES')} kg</dd></div>
          ${o.shipping.trackingNumber ? raw(html`<div><dt>Seguimiento</dt><dd><span class="mono">${o.shipping.trackingNumber}</span>
            ${o.shipping.trackingUrl ? raw(html` · <a href="${o.shipping.trackingUrl}" target="_blank" rel="noopener">Ver en ${o.shipping.carrier}</a>`) : ''}</dd></div>`) : ''}
          ${o.shipping.shippedAt ? raw(html`<div><dt>Enviado</dt><dd>${fmtDateTime(o.shipping.shippedAt)}</dd></div>`) : ''}
          ${o.shipping.deliveredAt ? raw(html`<div><dt>Entregado</dt><dd>${fmtDateTime(o.shipping.deliveredAt)}</dd></div>`) : ''}
        </dl>
      </section>
    </div>
    <aside>
      <section class="box no-print">
        <h2 class="box__title">Acciones</h2>
        ${canShip ? raw(html`<form class="tracking-form" id="ship-form">
          <div class="field"><label class="field__label" for="tracking">Nº de seguimiento ${o.shipping.carrier}</label>
            <input class="input mono" id="tracking" name="tracking" value="${o.shipping.trackingNumber}" placeholder="Pega aquí el número de la etiqueta" autocomplete="off" required></div>
          <label class="checkbox"><input type="checkbox" name="notify" checked> Enviar email al cliente con el seguimiento</label>
          <button class="btn btn--primary btn--block" type="submit">${icon('truck')} Marcar como enviado</button>
          <p class="hint" style="margin:0">Crea el envío en ${o.shipping.carrier} como lo haces normalmente y pega aquí el número de seguimiento.</p>
        </form>`) : ''}
        ${o.orderStatus === 'shipped' ? raw(html`<form class="tracking-form" id="tracking-form" style="margin-bottom:10px">
          <div class="field"><label class="field__label" for="tracking-edit">Corregir nº de seguimiento</label>
            <input class="input mono" id="tracking-edit" name="tracking" value="${o.shipping.trackingNumber}" autocomplete="off"></div>
          <button class="btn btn--sm" type="submit">Guardar seguimiento</button></form>`) : ''}
        <div class="status-actions" style="margin-top:${canShip ? '14px' : '0'}">
          ${transitions.map((s) => raw(html`<button class="btn btn--block ${ACTION_LABELS[s]?.cls ?? ''}" type="button" data-status="${s}">${icon(ACTION_LABELS[s]?.icon ?? 'arrow-right', 'icon icon--sm')} ${ACTION_LABELS[s]?.label ?? `Pasar a ${ORDER_STATUS[s].label}`}</button>`))}
          ${canCancel ? raw(html`<button class="btn btn--danger btn--block" type="button" data-cancel>${icon('close', 'icon icon--sm')} Cancelar pedido</button>`) : ''}
          ${!transitions.length && !canShip && !canCancel ? raw('<p class="muted" style="margin:0">No hay acciones disponibles para este pedido.</p>') : ''}
        </div>
      </section>
      <section class="box">
        <h2 class="box__title">Cliente</h2>
        <dl class="kv">
          <div><dt>Nombre</dt><dd>${o.customer.firstName} ${o.customer.lastName}</dd></div>
          <div><dt>Email</dt><dd><a href="mailto:${o.customer.email}">${o.customer.email}</a></dd></div>
          <div><dt>Teléfono</dt><dd><a href="tel:${o.customer.phone}">${o.customer.phone}</a></dd></div>
        </dl>
      </section>
      <section class="box">
        <h2 class="box__title">Pago</h2>
        <dl class="kv">
          <div><dt>Estado</dt><dd>${raw(paymentBadge(o.paymentStatus))}</dd></div>
          <div><dt>Fecha</dt><dd>${fmtDateTime(o.paidAt ?? o.createdAt)}</dd></div>
          ${o.refundedAmount ? raw(html`<div><dt>Reembolsado</dt><dd>${formatPrice(o.refundedAmount)}</dd></div>`) : ''}
          ${o.stripe?.paymentIntentId ? raw(html`<div><dt>Stripe</dt><dd><a class="mono" href="https://dashboard.stripe.com/payments/${o.stripe.paymentIntentId}" target="_blank" rel="noopener">${o.stripe.paymentIntentId.slice(0, 18)}…</a></dd></div>`) : ''}
          <div><dt>Emails</dt><dd>${o.emails ? Object.entries(o.emails).map(([k, v]) => `${EMAIL_LABELS[k] ?? k}: ${v === 'sent' ? 'enviado' : 'no enviado'}`).join(' · ') : '—'}</dd></div>
        </dl>
      </section>
      <section class="box no-print">
        <h2 class="box__title">Notas internas</h2>
        <form id="note-form" class="form-stack">
          <textarea class="textarea" name="note" rows="3" placeholder="Solo visibles en el panel">${o.adminNote ?? ''}</textarea>
          <button class="btn btn--sm" type="submit">Guardar nota</button>
        </form>
      </section>
      <section class="box no-print">
        <h2 class="box__title">Historial</h2>
        <ul class="history">${history.map((h) => raw(html`<li><span><strong>${ORDER_STATUS[h.to]?.label ?? h.to}</strong>${h.note ? ` · ${h.note}` : ''}<br>
          <span class="muted">${fmtDateTime(h.at)} · ${h.by === 'stripe' ? 'Stripe' : h.by === 'system' ? 'Sistema' : h.by === 'customer' ? 'Cliente' : h.by}</span></span></li>`))}</ul>
      </section>
    </aside>
  </div>`;
}

export async function render(view, { params, firebase }) {
  const { db, fs, adminAction } = firebase;
  const id = params[0];

  async function load() {
    const snap = await fs.getDoc(fs.doc(db, 'orders', id));
    if (!snap.exists()) {
      view.innerHTML = errorBox(new Error('Pedido no encontrado.'));
      return null;
    }
    const order = { id, ...snap.data() };
    view.innerHTML = markup(order);
    return order;
  }

  let order = await load();
  if (!order) return;

  async function run(button, action, payload, success) {
    if (view.dataset.busy) return;
    view.dataset.busy = '1';
    view.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    setLoading(button, true);
    try {
      const res = await adminAction(action, { orderId: id, ...payload });
      toast(typeof success === 'function' ? success(res) : success, { type: 'success' });
      listProducts({ fresh: true }).catch(() => {});
      order = await load();
      refreshOrdersBadge();
    } catch (err) {
      setLoading(button, false);
      view.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      toast(err.message, { type: 'error', timeout: 7000 });
    } finally {
      delete view.dataset.busy;
    }
  }

  on(view, 'click', '[data-print]', () => window.print());
  on(view, 'click', '[data-copy-address]', async () => {
    try { await navigator.clipboard.writeText(addressText(order)); toast('Dirección copiada', { type: 'success' }); } catch { toast('No se pudo copiar', { type: 'error' }); }
  });
  on(view, 'click', '[data-status]', (e, btn) => run(btn, 'setStatus', { status: btn.dataset.status }, 'Estado actualizado'));
  on(view, 'submit', '#ship-form', (e) => {
    e.preventDefault();
    const f = e.target;
    run(qs('button[type="submit"]', f), 'setStatus', { status: 'shipped', trackingNumber: f.tracking.value.trim(), notify: f.notify.checked },
      (res) => (res.emailed ? 'Pedido enviado. Hemos avisado al cliente por email.' : 'Pedido marcado como enviado.'));
  });
  on(view, 'submit', '#tracking-form', (e) => {
    e.preventDefault();
    run(qs('button', e.target), 'setTracking', { trackingNumber: e.target.tracking.value.trim() }, 'Seguimiento actualizado');
  });
  on(view, 'submit', '#note-form', (e) => {
    e.preventDefault();
    run(qs('button', e.target), 'setNote', { note: e.target.note.value }, 'Nota guardada');
  });
  on(view, 'click', '[data-cancel]', async (e, btn) => {
    const paid = order.paymentStatus === 'paid';
    const result = await dialog({
      title: 'Cancelar pedido',
      danger: true,
      confirm: 'Cancelar pedido',
      cancel: 'Volver',
      body: html`<p>Vas a cancelar el pedido <strong>${order.number}</strong> (${formatPrice(order.total)}).</p>
        ${paid ? raw(html`<label class="checkbox" style="margin-bottom:10px"><input type="checkbox" name="refund" checked> Reembolsar ${formatPrice(order.total)} al cliente con Stripe</label>`) : raw('<p class="muted">El pedido no está pagado: se liberará el stock reservado.</p>')}
        ${paid ? raw('<label class="checkbox" style="margin-bottom:10px"><input type="checkbox" name="restock" checked> Devolver las unidades al stock</label>') : ''}
        <label class="checkbox"><input type="checkbox" name="notify" checked> Avisar al cliente por email</label>`,
    });
    if (!result) return;
    run(btn, 'cancel', { refund: !!result.refund, restock: paid ? !!result.restock : true, notify: !!result.notify },
      (res) => (res.refunded ? 'Pedido cancelado y reembolsado.' : 'Pedido cancelado.'));
  });
}
