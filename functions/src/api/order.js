import { db, FieldValue, Timestamp } from '../lib/firebase.js';
import { PublicError, rateLimit, clientIp } from '../lib/http.js';
import { tokenMatches } from '../orders/order-service.js';
import { sendWithdrawalEmails } from '../email/notifications.js';

const iso = (ts) => (ts?.toDate ? ts.toDate().toISOString() : null);

/** Vista pública del pedido: solo lo necesario para el comprador. */
export function publicOrderView(id, o) {
  return {
    id,
    number: o.number,
    createdAt: iso(o.createdAt),
    paidAt: iso(o.paidAt),
    orderStatus: o.orderStatus,
    paymentStatus: o.paymentStatus,
    customer: { firstName: o.customer.firstName, lastName: o.customer.lastName, email: o.customer.email },
    shippingAddress: o.shippingAddress,
    items: o.items.map(({ productId, name, slug, reference, unitPrice, quantity, image }) => ({
      productId, name, slug, reference, unitPrice, quantity, image,
    })),
    subtotal: o.subtotal,
    shippingCost: o.shippingCost,
    total: o.total,
    shipping: {
      carrier: o.shipping.carrier,
      zoneName: o.shipping.zoneName,
      deliveryTime: o.shipping.deliveryTime,
      trackingNumber: o.shipping.trackingNumber,
      trackingUrl: o.shipping.trackingUrl,
      shippedAt: iso(o.shipping.shippedAt),
      deliveredAt: iso(o.shipping.deliveredAt),
    },
    withdrawalRequestedAt: iso(o.withdrawal?.requestedAt),
  };
}

/** GET /api/order?n=<id>&t=<token> */
export async function getPublicOrder(req) {
  rateLimit(`order:${clientIp(req)}`, { limit: 60, windowMs: 5 * 60_000 });
  const { n, t } = req.query;
  if (typeof n !== 'string' || !/^[A-Za-z0-9]{20}$/.test(n) || typeof t !== 'string') {
    throw new PublicError(400, 'invalid', 'Enlace de pedido no válido.');
  }
  const snap = await db.collection('orders').doc(n).get();
  if (!snap.exists || !tokenMatches(snap.data(), t)) {
    throw new PublicError(404, 'not_found', 'No encontramos este pedido. Revisa el enlace de tu email.');
  }
  return publicOrderView(snap.id, snap.data());
}

/** POST /api/withdrawal — formulario de desistimiento en línea. */
export async function requestWithdrawal(req) {
  rateLimit(`withdrawal:${clientIp(req)}`, { limit: 5, windowMs: 60 * 60_000 });
  const { orderNumber, email, message } = req.body ?? {};
  const number = String(orderNumber ?? '').trim();
  const mail = String(email ?? '').trim().toLowerCase();
  const text = String(message ?? '').trim().slice(0, 1000);
  if (!/^\d{4}-\d{5}$/.test(number) || !mail.includes('@')) {
    throw new PublicError(422, 'invalid', 'Introduce el número de pedido (por ejemplo 2026-00012) y el email de la compra.');
  }

  const snap = await db.collection('orders').where('number', '==', number).limit(1).get();
  const doc = snap.docs[0];
  const order = doc?.data();
  if (!doc || order.customer.email !== mail || !['paid', 'preparing', 'shipped', 'delivered'].includes(order.orderStatus)) {
    throw new PublicError(404, 'not_found', 'No encontramos un pedido pagado con ese número y email.');
  }
  if (order.withdrawal?.requestedAt) {
    return { alreadyRequested: true, requestedAt: order.withdrawal.requestedAt.toDate().toISOString() };
  }

  const requestedAt = Timestamp.now();
  await doc.ref.update({
    withdrawal: { requestedAt, message: text },
    updatedAt: FieldValue.serverTimestamp(),
    history: FieldValue.arrayUnion({ from: order.orderStatus, to: order.orderStatus, by: 'customer', at: requestedAt, note: 'Solicitud de desistimiento' }),
  });
  await sendWithdrawalEmails({ id: doc.id, ...order }, text, requestedAt.toDate());
  return { alreadyRequested: false, requestedAt: requestedAt.toDate().toISOString() };
}

/** POST /api/order/lookup { number, email } — consulta sin enlace (por ejemplo, desde el email de envío). */
export async function lookupOrder(req) {
  rateLimit(`lookup:${clientIp(req)}`, { limit: 10, windowMs: 15 * 60_000 });
  const number = String(req.body?.number ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!/^\d{4}-\d{5}$/.test(number) || !email.includes('@')) {
    throw new PublicError(422, 'invalid', 'Introduce el número de pedido y el email con el que compraste.');
  }
  const snap = await db.collection('orders').where('number', '==', number).limit(1).get();
  const doc = snap.docs[0];
  if (!doc || doc.data().customer.email !== email || doc.data().paymentStatus === 'pending') {
    throw new PublicError(404, 'not_found', 'No encontramos un pedido con ese número y email.');
  }
  return publicOrderView(doc.id, doc.data());
}
