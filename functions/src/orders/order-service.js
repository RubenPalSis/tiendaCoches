// Ciclo de vida de pedidos y stock.
//
// Estrategia: RESERVA al iniciar el pago.
//  1. createPendingOrder: en una transacción comprueba productos/precios/stock reales,
//     descuenta `stock` y suma `reserved`. Así dos compradores nunca pueden pagar la misma unidad.
//  2. markOrderPaid (webhook verificado de Stripe): convierte la reserva en venta.
//  3. releaseReservation (sesión caducada/cancelada): devuelve el stock.
// Las transacciones de Firestore (Admin SDK) bloquean los documentos leídos, por lo que dos
// compras simultáneas de la última unidad se serializan: una gana y la otra recibe "sin stock".
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { logger } from 'firebase-functions';
import { db, FieldValue, Timestamp } from '../lib/firebase.js';
import { PublicError } from '../lib/http.js';
import { addDays, addMinutes, dayKey } from '../lib/dates.js';
import { calculateShipping } from '../shared/shipping.js';
import { LIMITS } from '../shared/constants.js';

export const UNPAID_RETENTION_DAYS = 30;

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
export const newAccessToken = () => randomBytes(24).toString('base64url');

export function tokenMatches(order, token) {
  if (!token || !order?.accessTokenHash) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(order.accessTokenHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const historyEntry = (from, to, by, note) => ({ from, to, by, at: Timestamp.now(), ...(note ? { note } : {}) });

function formatOrderNumber(seq, date = new Date()) {
  return `${date.getFullYear()}-${String(seq).padStart(5, '0')}`;
}

/**
 * Valida el carrito contra Firestore, reserva el stock y crea el pedido pendiente de pago.
 * @param input { items:[{id,qty}], customer, address, termsVersion }
 * @param shippingRules settings/shipping
 */
export async function createPendingOrder(input, shippingRules) {
  const token = newAccessToken();
  const orderRef = db.collection('orders').doc();
  const now = new Date();
  const expiresAt = addMinutes(now, LIMITS.reservationMinutes + 1);

  const order = await db.runTransaction(async (tx) => {
    const productRefs = input.items.map((it) => db.collection('products').doc(it.id));
    const counterRef = db.doc('counters/orders');
    const [counterSnap, ...snaps] = await tx.getAll(counterRef, ...productRefs);

    const problems = [];
    const items = [];
    snaps.forEach((snap, i) => {
      const { id, qty } = input.items[i];
      const p = snap.data();
      if (!snap.exists || !p.active) {
        problems.push({ id, code: 'unavailable', message: 'Este producto ya no está disponible.' });
        return;
      }
      if ((p.stock ?? 0) < qty) {
        problems.push({
          id,
          code: 'insufficient_stock',
          available: Math.max(0, p.stock ?? 0),
          message: p.stock > 0 ? `Solo quedan ${p.stock} unidades de "${p.name}".` : `"${p.name}" se ha agotado.`,
        });
        return;
      }
      items.push({
        productId: id,
        name: p.name,
        slug: p.slug,
        reference: p.reference || '',
        unitPrice: p.price,
        quantity: qty,
        weight: p.weight || 0,
        image: p.images?.[0]?.sm || '',
      });
    });

    if (problems.length) {
      throw new PublicError(409, 'cart_changed', 'Algunos productos de tu carrito han cambiado.', problems);
    }

    const subtotal = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
    const shipping = calculateShipping(shippingRules, {
      items,
      subtotal,
      country: input.address.country,
      postalCode: input.address.postalCode,
    });
    if (!shipping.ok) throw new PublicError(422, shipping.reason, shipping.message);

    const seq = (counterSnap.data()?.seq ?? 0) + 1;
    const data = {
      number: formatOrderNumber(seq, now),
      siteOrigin: input.origin || '',
      accessTokenHash: hashToken(token),
      paymentStatus: 'pending',
      orderStatus: 'pending',
      customer: input.customer,
      shippingAddress: input.address,
      items,
      subtotal,
      shippingCost: shipping.cost,
      total: subtotal + shipping.cost,
      currency: 'eur',
      shipping: {
        carrier: shippingRules.carrier || 'GLS',
        provider: 'manual',
        zoneId: shipping.zone.id,
        zoneName: shipping.zone.name,
        deliveryTime: shipping.zone.deliveryTime || '',
        weight: shipping.weight,
        trackingNumber: '',
        trackingUrl: '',
      },
      stripe: { sessionId: '' },
      legal: { termsVersion: input.termsVersion, acceptedAt: Timestamp.fromDate(now) },
      history: [historyEntry(null, 'pending', 'system')],
      reservationExpiresAt: Timestamp.fromDate(expiresAt),
      deleteAt: Timestamp.fromDate(addDays(now, UNPAID_RETENTION_DAYS)), // TTL: se borra si nunca se paga
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    };

    for (const it of items) {
      tx.update(db.collection('products').doc(it.productId), {
        stock: FieldValue.increment(-it.quantity),
        reserved: FieldValue.increment(it.quantity),
      });
    }
    tx.set(counterRef, { seq }, { merge: true });
    tx.set(orderRef, data);
    return data;
  });

  return { id: orderRef.id, token, order };
}

/** Devuelve al stock las unidades de un pedido no pagado. Idempotente. */
export async function releaseReservation(orderId, { status = 'expired', by = 'system', note } = {}) {
  return db.runTransaction(async (tx) => {
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await tx.get(orderRef);
    const order = orderSnap.data();
    if (!orderSnap.exists || order.paymentStatus !== 'pending') return false;

    const refs = order.items.map((it) => db.collection('products').doc(it.productId));
    const snaps = refs.length ? await tx.getAll(...refs) : [];
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const qty = order.items[i].quantity;
      tx.update(refs[i], {
        stock: FieldValue.increment(qty),
        reserved: Math.max(0, (snap.data().reserved ?? 0) - qty),
      });
    });

    tx.update(orderRef, {
      paymentStatus: 'expired',
      orderStatus: status,
      updatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion(historyEntry(order.orderStatus, status, by, note)),
    });
    return true;
  });
}

/**
 * Confirma el pago a partir de un evento verificado de Stripe. Idempotente por event.id.
 * @returns {{ result: 'paid'|'duplicate'|'already_paid'|'mismatch', orderId, conflict?: boolean }}
 */
export async function markOrderPaid({ eventId, orderId, sessionId, amountTotal, currency, paymentIntentId }) {
  return db.runTransaction(async (tx) => {
    const eventRef = db.collection('stripeEvents').doc(eventId);
    const orderRef = db.collection('orders').doc(orderId);
    const [eventSnap, orderSnap] = await tx.getAll(eventRef, orderRef);
    if (eventSnap.exists) return { result: 'duplicate', orderId };

    const markEvent = () =>
      tx.set(eventRef, { type: 'checkout.session.completed', orderId, at: FieldValue.serverTimestamp(), deleteAt: Timestamp.fromDate(addDays(new Date(), 30)) });

    const order = orderSnap.data();
    if (!orderSnap.exists || order.stripe?.sessionId !== sessionId || order.total !== amountTotal || currency !== 'eur') {
      logger.error('Pago que no coincide con el pedido', { orderId, sessionId, amountTotal, currency });
      markEvent();
      return { result: 'mismatch', orderId };
    }
    if (order.paymentStatus === 'paid') {
      markEvent();
      return { result: 'already_paid', orderId };
    }

    const refs = order.items.map((it) => db.collection('products').doc(it.productId));
    const snaps = await tx.getAll(...refs);
    const wasReserved = order.paymentStatus === 'pending';
    let conflict = false;
    // stockTaken: qué líneas descontaron realmente stock (al cancelar solo se repone eso).
    const items = order.items.map((it) => ({ ...it, stockTaken: true }));

    snaps.forEach((snap, i) => {
      const qty = order.items[i].quantity;
      if (!snap.exists) { conflict = true; items[i].stockTaken = false; return; }
      const p = snap.data();
      if (wasReserved) {
        tx.update(refs[i], { reserved: Math.max(0, (p.reserved ?? 0) - qty), soldCount: FieldValue.increment(qty) });
      } else if ((p.stock ?? 0) >= qty) {
        // Pago tardío de una reserva ya liberada: se vuelve a descontar si aún hay stock.
        tx.update(refs[i], { stock: FieldValue.increment(-qty), soldCount: FieldValue.increment(qty) });
      } else {
        conflict = true;
        items[i].stockTaken = false;
      }
    });
    const review = conflict
      ? 'Pago recibido después de liberar la reserva y sin stock suficiente. Revisa el pedido y reembolsa si es necesario.'
      : !wasReserved
        ? `Pago recibido de un pedido que estaba «${order.orderStatus}». Comprueba que puedes servirlo.`
        : null;

    const statsRef = db.collection('statistics').doc(`day_${dayKey()}`);
    const productSales = Object.fromEntries(order.items.map((it) => [it.productId, FieldValue.increment(it.quantity)]));
    tx.set(statsRef, {
      orders: FieldValue.increment(1),
      revenue: FieldValue.increment(order.total),
      itemsSold: FieldValue.increment(order.items.reduce((s, it) => s + it.quantity, 0)),
      productSales,
    }, { merge: true });

    tx.update(orderRef, {
      paymentStatus: 'paid',
      orderStatus: 'paid',
      paidAt: FieldValue.serverTimestamp(),
      'stripe.paymentIntentId': paymentIntentId || '',
      deleteAt: FieldValue.delete(),
      items,
      needsReview: review ?? FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion(historyEntry(order.orderStatus, 'paid', 'stripe')),
    });
    markEvent();
    return { result: 'paid', orderId, conflict };
  });
}

/** Libera reservas cuya sesión de Stripe ya caducó y cuyo webhook no llegó (red de seguridad). */
export async function releaseStaleReservations(graceMinutes = 15) {
  const cutoff = Timestamp.fromDate(addMinutes(new Date(), -graceMinutes));
  const snap = await db.collection('orders')
    .where('paymentStatus', '==', 'pending')
    .where('reservationExpiresAt', '<', cutoff)
    .limit(100)
    .get();
  let released = 0;
  for (const doc of snap.docs) if (await releaseReservation(doc.id, { note: 'Reserva caducada' })) released += 1;
  return released;
}
