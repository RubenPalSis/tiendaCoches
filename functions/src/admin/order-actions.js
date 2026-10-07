// Acciones del panel sobre pedidos. Los pedidos no se pueden escribir desde el navegador:
// todo cambio pasa por aquí para validar transiciones, stock y reembolsos.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { REGION, STRIPE_SECRET_KEY, SMTP_URL, MAX_INSTANCES } from '../lib/config.js';
import { db, FieldValue, Timestamp } from '../lib/firebase.js';
import { getSettings } from '../lib/settings.js';
import { getStripe } from '../stripe/client.js';
import { releaseStaleReservations } from '../orders/order-service.js';
import { expireAndRelease } from '../api/checkout.js';
import { allowedAdmins } from './claims.js';
import { rebuildIndex } from '../catalog/catalog-index.js';
import { sendOrderShippedEmail, sendOrderCancelledEmail } from '../email/notifications.js';
import { ORDER_TRANSITIONS, CANCELLABLE } from '../shared/constants.js';
import { trackingUrl } from '../shared/shipping.js';

export function requireAdmin(request) {
  const email = String(request.auth?.token?.email ?? '').toLowerCase();
  // Además del claim, el email debe seguir en ADMIN_EMAILS (quitarlo revoca el acceso al momento).
  if (request.auth?.token?.admin !== true || !allowedAdmins().includes(email)) {
    throw new HttpsError('permission-denied', 'Solo administradores.');
  }
  return request.auth.token.email || request.auth.uid;
}

const historyEntry = (from, to, by, note) => ({ from, to, by, at: Timestamp.now(), ...(note ? { note } : {}) });

async function loadOrder(orderId) {
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(orderId)) throw new HttpsError('invalid-argument', 'Pedido no válido.');
  const ref = db.collection('orders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Pedido no encontrado.');
  return { ref, order: snap.data() };
}

async function setStatus({ orderId, status, trackingNumber, notify = true }, by) {
  const { ref } = await loadOrder(orderId);
  const rules = status === 'shipped' ? await getSettings('shipping', { fresh: true }) : null;

  // Comprobación y cambio en una transacción: dos acciones simultáneas no pueden dejar un estado incoherente.
  await db.runTransaction(async (tx) => {
    const order = (await tx.get(ref)).data();
    if (!ORDER_TRANSITIONS[order.orderStatus]?.includes(status)) {
      throw new HttpsError('failed-precondition', `No se puede pasar de "${order.orderStatus}" a "${status}". Recarga la página.`);
    }
    const update = {
      orderStatus: status,
      updatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion(historyEntry(order.orderStatus, status, by)),
    };
    if (status === 'shipped') {
      const tracking = String(trackingNumber ?? order.shipping.trackingNumber ?? '').trim();
      if (!/^[A-Za-z0-9 -]{4,40}$/.test(tracking)) {
        throw new HttpsError('invalid-argument', 'Introduce un número de seguimiento válido antes de marcar como enviado.');
      }
      update['shipping.trackingNumber'] = tracking;
      update['shipping.trackingUrl'] = trackingUrl(rules, tracking);
      update['shipping.shippedAt'] = FieldValue.serverTimestamp();
    }
    if (status === 'delivered') update['shipping.deliveredAt'] = FieldValue.serverTimestamp();
    tx.update(ref, update);
  });

  if (status === 'shipped' && notify) {
    const fresh = (await ref.get()).data();
    const emailed = await sendOrderShippedEmail({ id: orderId, ...fresh });
    return { ok: true, emailed };
  }
  return { ok: true };
}

async function setTracking({ orderId, trackingNumber }) {
  const { ref } = await loadOrder(orderId);
  const tracking = String(trackingNumber ?? '').trim();
  if (tracking && !/^[A-Za-z0-9 -]{4,40}$/.test(tracking)) throw new HttpsError('invalid-argument', 'Número de seguimiento no válido.');
  const rules = await getSettings('shipping', { fresh: true });
  await ref.update({
    'shipping.trackingNumber': tracking,
    'shipping.trackingUrl': trackingUrl(rules, tracking),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

async function setNote({ orderId, note }) {
  const { ref } = await loadOrder(orderId);
  await ref.update({ adminNote: String(note ?? '').slice(0, 2000), updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
}

async function cancel({ orderId, restock = true, refund = false, notify = true }, by) {
  const { ref, order } = await loadOrder(orderId);
  if (!CANCELLABLE.includes(order.orderStatus)) {
    throw new HttpsError('failed-precondition', 'Este pedido ya no se puede cancelar desde el panel.');
  }

  if (order.paymentStatus === 'pending') {
    const res = await expireAndRelease(orderId, order, { by, note: 'Cancelado desde el panel' });
    if (!res.released) {
      throw new HttpsError('failed-precondition', 'El cliente podría estar pagando ahora mismo. Espera un par de minutos y recarga el pedido.');
    }
    return { ok: true };
  }

  // 1) Cancelar y reponer stock en una transacción que vuelve a comprobar el estado.
  const cancelledOrder = await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    if (!CANCELLABLE.includes(current.orderStatus) || current.paymentStatus === 'pending') {
      throw new HttpsError('failed-precondition', 'El pedido ha cambiado mientras tanto. Recarga la página.');
    }
    // Solo se reponen las líneas que realmente descontaron stock.
    const restockable = restock ? current.items.filter((it) => it.stockTaken !== false) : [];
    if (restockable.length) {
      const refs = restockable.map((it) => db.collection('products').doc(it.productId));
      const snaps = await tx.getAll(...refs); // en una transacción, todas las lecturas antes de escribir
      snaps.forEach((pSnap, i) => {
        if (!pSnap.exists) return;
        const qty = restockable[i].quantity;
        tx.update(refs[i], {
          stock: FieldValue.increment(qty),
          soldCount: Math.max(0, (pSnap.data().soldCount ?? 0) - qty),
        });
      });
    }
    tx.update(ref, {
      orderStatus: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      history: FieldValue.arrayUnion(historyEntry(current.orderStatus, 'cancelled', by, restock ? 'Stock repuesto' : undefined)),
    });
    return current;
  });

  // 2) Reembolso (fuera de la transacción: es una llamada externa).
  let refunded = false;
  if (refund && cancelledOrder.paymentStatus === 'paid') {
    try {
      if (!cancelledOrder.stripe?.paymentIntentId) throw new Error('Sin pago de Stripe asociado');
      await getStripe().refunds.create(
        { payment_intent: cancelledOrder.stripe.paymentIntentId, metadata: { orderId } },
        { idempotencyKey: `refund-${orderId}` },
      );
      refunded = true;
      await ref.update({ paymentStatus: 'refunded', refundedAmount: cancelledOrder.total, updatedAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.error('Error al reembolsar', { orderId, message: err.message });
      await ref.update({ needsReview: 'El pedido está cancelado pero el reembolso automático falló. Hazlo desde el panel de Stripe.' });
      throw new HttpsError('internal', 'Pedido cancelado, pero Stripe no ha podido hacer el reembolso. Hazlo desde el panel de Stripe.');
    }
  }

  if (notify) await sendOrderCancelledEmail({ id: orderId, ...cancelledOrder }, refunded);
  return { ok: true, refunded };
}

export const ACTIONS = {
  setStatus,
  setTracking,
  setNote,
  cancel,
  rebuildCatalog: () => rebuildIndex(),
  releaseStale: async () => ({ released: await releaseStaleReservations(0) }),
};

export const adminAction = onCall(
  { region: REGION, secrets: [STRIPE_SECRET_KEY, SMTP_URL], maxInstances: MAX_INSTANCES },
  async (request) => {
    const by = requireAdmin(request);
    const { action, ...payload } = request.data ?? {};
    const fn = ACTIONS[action];
    if (!fn) throw new HttpsError('invalid-argument', 'Acción no válida.');
    try {
      return await fn(payload, by);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error('Error en acción de administración', { action, err });
      throw new HttpsError('internal', err.message?.startsWith('Los pagos') ? err.message : 'Error inesperado. Inténtalo de nuevo.');
    }
  },
);
