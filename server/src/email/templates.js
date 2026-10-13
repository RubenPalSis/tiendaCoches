// Plantillas de email con estilos en línea (los clientes de correo no admiten hojas de estilo externas).
import { esc } from '../shared/escape.js';
import { formatPrice } from '../shared/money.js';
import { COUNTRIES } from '../shared/constants.js';

// Colores de marca de los emails (cambiar junto a public/css/tokens.css al reutilizar para otro cliente).
const C = { ink: '#0D0F13', muted: '#646B76', line: '#E3E6EA', accent: '#D40C25', bg: '#F4F5F7' };

function layout(store, title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:${C.bg};font-family:Arial,Helvetica,sans-serif;color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:${C.ink};padding:20px 24px;color:#fff;font-size:20px;font-weight:bold;letter-spacing:.5px">${esc(store.name)}</td></tr>
<tr><td style="padding:24px">${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${C.line};color:${C.muted};font-size:12px;line-height:1.5">
${esc(store.name)}${store.ownerName ? ` · ${esc(store.ownerName)}` : ''}${store.taxId ? ` · NIF ${esc(store.taxId)}` : ''}<br>
${store.email ? `Contacto: ${esc(store.email)}` : ''}${store.phone ? ` · ${esc(store.phone)}` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:${C.accent};color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block">${esc(label)}</a></p>`;

function itemsTable(order) {
  const rows = order.items.map((it) => `<tr>
<td style="padding:8px 0;border-bottom:1px solid ${C.line}">${esc(it.name)}${it.reference ? `<br><span style="color:${C.muted};font-size:12px">Ref. ${esc(it.reference)}</span>` : ''}</td>
<td style="padding:8px;border-bottom:1px solid ${C.line};text-align:center">${it.quantity}</td>
<td style="padding:8px 0;border-bottom:1px solid ${C.line};text-align:right;white-space:nowrap">${formatPrice(it.unitPrice * it.quantity)}</td></tr>`).join('');
  const line = (label, value, strong) =>
    `<tr><td colspan="2" style="padding:4px 0;${strong ? 'font-weight:bold' : `color:${C.muted}`}">${label}</td><td style="padding:4px 0;text-align:right;${strong ? 'font-weight:bold' : ''}">${value}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:16px 0">
<tr><th align="left" style="font-size:12px;color:${C.muted};padding-bottom:6px">Producto</th><th style="font-size:12px;color:${C.muted}">Uds.</th><th align="right" style="font-size:12px;color:${C.muted}">Importe</th></tr>
${rows}
${line('Subtotal', formatPrice(order.subtotal))}
${line(`Envío ${esc(order.shipping.carrier)}`, order.shippingCost ? formatPrice(order.shippingCost) : 'Gratis')}
${line('Total (IVA incluido)', formatPrice(order.total), true)}
</table>`;
}

function addressBlock(order) {
  const a = order.shippingAddress;
  return `<p style="font-size:14px;line-height:1.5;margin:0"><strong>Dirección de envío</strong><br>
${esc(order.customer.firstName)} ${esc(order.customer.lastName)}<br>${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}<br>
${esc(a.postalCode)} ${esc(a.city)} (${esc(a.province)}), ${esc(COUNTRIES[a.country] ?? a.country)}<br>Tel. ${esc(order.customer.phone)}</p>`;
}

export function orderConfirmationEmail(store, order, orderUrl) {
  const subject = `Pedido ${order.number} confirmado`;
  const html = layout(store, subject, `
<h1 style="font-size:22px;margin:0 0 8px">¡Gracias por tu compra, ${esc(order.customer.firstName)}!</h1>
<p style="color:${C.muted};margin:0 0 16px">Hemos recibido el pago de tu pedido <strong style="color:${C.ink}">${esc(order.number)}</strong>. Te avisaremos por email cuando lo enviemos con ${esc(order.shipping.carrier)}.</p>
${itemsTable(order)}
${addressBlock(order)}
${orderUrl ? button(orderUrl, 'Ver mi pedido') : ''}
<p style="color:${C.muted};font-size:12px">Guarda este email: el enlace te permite consultar el estado y el seguimiento de tu pedido.</p>`);
  const text = `Gracias por tu compra. Pedido ${order.number} confirmado. Total: ${formatPrice(order.total)}. ${orderUrl ? `Consulta tu pedido: ${orderUrl}` : ''}`;
  return { subject, html, text };
}

export function orderShippedEmail(store, order, lookupUrl) {
  const subject = `Tu pedido ${order.number} está en camino`;
  const { trackingNumber, trackingUrl, carrier } = order.shipping;
  const html = layout(store, subject, `
<h1 style="font-size:22px;margin:0 0 8px">¡Tu pedido ya está en camino!</h1>
<p style="color:${C.muted}">Hemos entregado tu pedido <strong style="color:${C.ink}">${esc(order.number)}</strong> a ${esc(carrier)}.</p>
<p style="font-size:16px">Número de seguimiento: <strong style="font-family:monospace">${esc(trackingNumber)}</strong></p>
${trackingUrl ? button(trackingUrl, `Seguir mi envío en ${carrier}`) : ''}
${order.shipping.deliveryTime ? `<p style="color:${C.muted}">Plazo habitual de entrega: ${esc(order.shipping.deliveryTime)}.</p>` : ''}
${addressBlock(order)}
${lookupUrl ? `<p style="font-size:13px;color:${C.muted}">También puedes consultar tu pedido en <a href="${esc(lookupUrl)}">${esc(lookupUrl)}</a></p>` : ''}`);
  const text = `Tu pedido ${order.number} está en camino con ${carrier}. Seguimiento: ${trackingNumber} ${trackingUrl}`;
  return { subject, html, text };
}

export function orderCancelledEmail(store, order, refunded) {
  const subject = `Pedido ${order.number} cancelado`;
  const html = layout(store, subject, `
<h1 style="font-size:22px;margin:0 0 8px">Tu pedido ha sido cancelado</h1>
<p style="color:${C.muted}">El pedido <strong style="color:${C.ink}">${esc(order.number)}</strong> ha sido cancelado.</p>
${refunded ? `<p>Hemos emitido el reembolso de <strong>${formatPrice(order.total)}</strong> a tu método de pago. Según tu banco, puede tardar entre 5 y 10 días en aparecer.</p>` : ''}
<p>Si tienes cualquier duda, responde a este email.</p>`);
  return { subject, html, text: `Tu pedido ${order.number} ha sido cancelado.` };
}

export function sellerNewOrderEmail(store, order, adminUrl) {
  const subject = `🛒 Nuevo pedido ${order.number} · ${formatPrice(order.total)}`;
  const html = layout(store, subject, `
<h1 style="font-size:22px;margin:0 0 8px">Nuevo pedido pagado</h1>
<p style="color:${C.muted}">Pedido <strong style="color:${C.ink}">${esc(order.number)}</strong> de ${esc(order.customer.firstName)} ${esc(order.customer.lastName)} (${esc(order.customer.email)}).</p>
${itemsTable(order)}
${addressBlock(order)}
${order.shippingAddress.notes ? `<p><strong>Notas del cliente:</strong> ${esc(order.shippingAddress.notes)}</p>` : ''}
${order.needsReview ? `<p style="color:#C62828"><strong>Atención:</strong> ${esc(order.needsReview)}</p>` : ''}
${adminUrl ? button(adminUrl, 'Abrir en el panel') : ''}`);
  return { subject, html, text: `Nuevo pedido ${order.number}: ${formatPrice(order.total)}` };
}

export function withdrawalReceiptEmail(store, order, message, requestedAt) {
  const subject = `Hemos recibido tu solicitud de desistimiento · Pedido ${order.number}`;
  const html = layout(store, subject, `
<h1 style="font-size:22px;margin:0 0 8px">Solicitud de desistimiento recibida</h1>
<p>Confirmamos que el <strong>${requestedAt.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</strong> recibimos tu solicitud de desistimiento del pedido <strong>${esc(order.number)}</strong>.</p>
${message ? `<p style="color:${C.muted}">Tu mensaje: «${esc(message)}»</p>` : ''}
<p>Te contactaremos con las instrucciones para la devolución de los productos.</p>`);
  return { subject, html, text: `Solicitud de desistimiento recibida para el pedido ${order.number}.` };
}

export function sellerWithdrawalEmail(store, order, message) {
  const subject = `↩️ Solicitud de desistimiento · Pedido ${order.number}`;
  const html = layout(store, subject, `
<h1 style="font-size:22px;margin:0 0 8px">Solicitud de desistimiento</h1>
<p>${esc(order.customer.firstName)} ${esc(order.customer.lastName)} (${esc(order.customer.email)}) quiere desistir del pedido <strong>${esc(order.number)}</strong>.</p>
${message ? `<p>Mensaje: «${esc(message)}»</p>` : ''}
${itemsTable(order)}`);
  return { subject, html, text: `Solicitud de desistimiento del pedido ${order.number}.` };
}
