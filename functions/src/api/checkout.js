import { logger } from 'firebase-functions';
import { db, Timestamp } from '../lib/firebase.js';
import { PublicError, rateLimit, clientIp, requestOrigin } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { getStripe } from '../stripe/client.js';
import { createPendingOrder, releaseReservation, tokenMatches } from '../orders/order-service.js';
import { validateCartItems, validateCheckoutForm } from '../shared/validation.js';
import { shippableCountries } from '../shared/shipping.js';
import { LIMITS } from '../shared/constants.js';

const httpsImage = (url) => (url && url.startsWith('https://') ? [url] : undefined);

/** POST /api/checkout — valida todo en servidor, reserva stock y crea la sesión de Stripe. */
export async function createCheckout(req) {
  rateLimit(`checkout:${clientIp(req)}`, { limit: 8, windowMs: 10 * 60_000 });

  const [checkoutSettings, shippingRules] = await Promise.all([getSettings('checkout'), getSettings('shipping')]);
  if (!checkoutSettings.enabled) throw new PublicError(503, 'store_closed', checkoutSettings.closedMessage);
  if (!shippingRules.configured) {
    throw new PublicError(503, 'shipping_not_configured', 'La tienda todavía no admite pedidos. Inténtalo más tarde.');
  }

  const body = req.body ?? {};
  if (body.acceptTerms !== true) {
    throw new PublicError(422, 'terms_required', 'Debes aceptar las condiciones de compra para continuar.');
  }

  const cart = validateCartItems(body.items, {
    maxLines: LIMITS.maxLines,
    maxQtyPerLine: checkoutSettings.maxQtyPerLine ?? LIMITS.maxQtyPerLine,
  });
  if (!cart.ok) throw new PublicError(422, 'invalid_cart', cart.message);

  const form = validateCheckoutForm(body.customer, shippableCountries(shippingRules));
  if (!form.ok) throw new PublicError(422, 'invalid_form', 'Revisa los datos de envío.', form.errors);

  const v = form.value;
  const stripe = getStripe(); // falla antes de reservar stock si los pagos no están configurados

  // El mismo navegador vuelve a intentarlo (p. ej. botón «Atrás» desde Stripe): se cancela su reserva anterior.
  if (body.previous?.n && body.previous?.t) await cancelOwnPending(body.previous.n, body.previous.t);
  await enforcePendingLimits(v.email);
  const origin = requestOrigin(req);
  const { id, token, order } = await createPendingOrder(
    {
      origin,
      items: cart.items,
      customer: { firstName: v.firstName, lastName: v.lastName, email: v.email, phone: v.phone },
      address: {
        line1: v.line1, line2: v.line2, postalCode: v.postalCode, city: v.city,
        province: v.province, country: v.country, notes: v.notes,
      },
      termsVersion: checkoutSettings.termsVersion,
    },
    shippingRules,
  );

  const orderLink = `n=${id}&t=${encodeURIComponent(token)}`;
  // Stripe exige ≥30 min: se recalcula justo antes de llamarle (la transacción pudo tardar).
  const expiresAtMs = Math.max(order.reservationExpiresAt.toMillis(), Date.now() + (LIMITS.reservationMinutes + 1) * 60_000);
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        locale: 'es',
        payment_method_types: ['card'], // incluye Apple Pay y Google Pay; evita métodos de pago diferido
        customer_email: order.customer.email,
        client_reference_id: id,
        // El token solo viaja en la sesión de Stripe (no se guarda en claro) para el enlace del email.
        metadata: { orderId: id, orderNumber: order.number, accessToken: token },
        payment_intent_data: { description: `Pedido ${order.number}`, metadata: { orderId: id, orderNumber: order.number } },
        line_items: order.items.map((it) => ({
          quantity: it.quantity,
          price_data: {
            currency: 'eur',
            unit_amount: it.unitPrice,
            product_data: { name: it.name.slice(0, 250), images: httpsImage(it.image), metadata: { productId: it.productId } },
          },
        })),
        shipping_options: [{
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: `Envío ${order.shipping.carrier} · ${order.shipping.zoneName}`.slice(0, 100),
            fixed_amount: { amount: order.shippingCost, currency: 'eur' },
          },
        }],
        expires_at: Math.floor(expiresAtMs / 1000),
        success_url: `${origin}/pedido?${orderLink}&pago=ok`,
        cancel_url: `${origin}/checkout?cancelado=1&${orderLink}`,
      },
      { idempotencyKey: `checkout-${id}` },
    );

    if (session.amount_total !== order.total) {
      logger.error('Importe de Stripe distinto al calculado', { id, stripe: session.amount_total, order: order.total });
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      throw new Error('amount_mismatch');
    }

    await db.collection('orders').doc(id).update({
      'stripe.sessionId': session.id,
      reservationExpiresAt: Timestamp.fromMillis(expiresAtMs),
    });
    return { url: session.url, orderId: id, token };
  } catch (err) {
    await releaseReservation(id, { status: 'cancelled', note: 'Error al crear la sesión de pago' });
    if (err instanceof PublicError) throw err;
    logger.error('Error creando la sesión de Stripe', err);
    throw new PublicError(502, 'payment_error', 'No hemos podido iniciar el pago. Inténtalo de nuevo en unos minutos.');
  }
}

// Límites que no dependen de la IP (las cabeceras de IP se pueden falsear): evitan que alguien
// deje todo el catálogo «reservado» creando pagos que nunca completa.
const MAX_PENDING_PER_EMAIL = 2;
const MAX_PENDING_TOTAL = 30;

async function enforcePendingLimits(email) {
  const pending = db.collection('orders').where('paymentStatus', '==', 'pending');
  const [byEmail, total] = await Promise.all([
    pending.where('customer.email', '==', email).count().get(),
    pending.count().get(),
  ]);
  if (byEmail.data().count >= MAX_PENDING_PER_EMAIL) {
    throw new PublicError(429, 'too_many_pending', 'Ya tienes un pago en curso. Complétalo o espera unos minutos antes de intentarlo de nuevo.');
  }
  if (total.data().count >= MAX_PENDING_TOTAL) {
    logger.warn('Demasiados pagos pendientes a la vez', { total: total.data().count });
    throw new PublicError(503, 'busy', 'Hay mucha actividad en este momento. Inténtalo de nuevo en unos minutos.');
  }
}

/**
 * Caduca la sesión de Stripe y libera la reserva SOLO si Stripe confirma que ya no se puede pagar.
 * @returns {{ released: boolean, items?: {id:string, qty:number}[] }}
 */
export async function expireAndRelease(orderId, order, { status = 'cancelled', by = 'customer', note } = {}) {
  if (order.paymentStatus !== 'pending') return { released: false };
  if (order.stripe?.sessionId) {
    const stripe = getStripe();
    let expired = false;
    try {
      expired = (await stripe.checkout.sessions.expire(order.stripe.sessionId)).status === 'expired';
    } catch {
      const session = await stripe.checkout.sessions.retrieve(order.stripe.sessionId).catch(() => null);
      expired = session?.status === 'expired';
    }
    if (!expired) return { released: false }; // pagada o error temporal: el webhook decidirá
  }
  const released = await releaseReservation(orderId, { status, by, note });
  return { released, items: released ? order.items.map((it) => ({ id: it.productId, qty: it.quantity })) : [] };
}

async function cancelOwnPending(n, t) {
  if (typeof n !== 'string' || !/^[A-Za-z0-9]{20}$/.test(n)) return;
  const snap = await db.collection('orders').doc(n).get();
  if (snap.exists && tokenMatches(snap.data(), t)) {
    await expireAndRelease(n, snap.data(), { note: 'Nuevo intento de pago del comprador' }).catch(() => {});
  }
}

/** POST /api/order/cancel — el comprador vuelve de Stripe sin pagar: libera la reserva al momento. */
export async function cancelPendingCheckout(req) {
  rateLimit(`cancel:${clientIp(req)}`, { limit: 20, windowMs: 10 * 60_000 });
  const { n, t } = req.body ?? {};
  if (typeof n !== 'string' || !/^[A-Za-z0-9]{20}$/.test(n)) throw new PublicError(400, 'invalid', 'Pedido no válido.');
  const snap = await db.collection('orders').doc(n).get();
  const order = snap.data();
  if (!snap.exists || !tokenMatches(order, t)) throw new PublicError(404, 'not_found', 'Pedido no encontrado.');
  return expireAndRelease(n, order, { note: 'Pago cancelado por el comprador' });
}
