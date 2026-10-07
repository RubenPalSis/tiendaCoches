// Webhook de Stripe: ÚNICA fuente de verdad para confirmar pagos.
// Volver a la página de éxito NO confirma nada; solo un evento con firma verificada.
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import Stripe from 'stripe';
import { REGION, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SMTP_URL } from '../lib/config.js';
import { db, FieldValue } from '../lib/firebase.js';
import { markOrderPaid, releaseReservation } from '../orders/order-service.js';
import { sendOrderPaidEmails } from '../email/notifications.js';

// Solo se usa para verificar firmas; no necesita la clave secreta.
const verifier = new Stripe('sk_verify_only_placeholder');

export async function handleStripeEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      if (session.payment_status !== 'paid') return 'ignored_unpaid';
      const orderId = session.metadata?.orderId || session.client_reference_id;
      if (!orderId) return 'ignored_no_order';
      const res = await markOrderPaid({
        eventId: event.id,
        orderId,
        sessionId: session.id,
        amountTotal: session.amount_total,
        currency: session.currency,
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
      });
      if (res.result === 'paid') {
        const snap = await db.collection('orders').doc(orderId).get();
        await sendOrderPaidEmails({ id: orderId, ...snap.data() }, session.metadata?.accessToken);
      }
      return res.result;
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object;
      const orderId = session.metadata?.orderId || session.client_reference_id;
      if (!orderId) return 'ignored_no_order';
      const released = await releaseReservation(orderId, { note: 'Sesión de pago caducada' });
      return released ? 'released' : 'noop';
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      if (!pi) return 'ignored';
      const snap = await db.collection('orders').where('stripe.paymentIntentId', '==', pi).limit(1).get();
      if (snap.empty) return 'ignored_no_order';
      const full = charge.amount_refunded >= charge.amount;
      const order = snap.docs[0].data();
      await snap.docs[0].ref.update({
        paymentStatus: full ? 'refunded' : 'partially_refunded',
        refundedAmount: charge.amount_refunded,
        updatedAt: FieldValue.serverTimestamp(),
        // Reembolso hecho fuera del panel con el pedido aún activo: avisar para que no se envíe por error.
        ...(order.orderStatus !== 'cancelled'
          ? { needsReview: `Se ha reembolsado ${full ? 'todo' : 'parte de'} el pago desde Stripe. ${full ? 'No envíes el pedido y cancélalo en el panel (repón el stock si procede).' : 'Revisa qué falta por enviar.'}` }
          : {}),
      });
      return 'refund_recorded';
    }
    default:
      return 'ignored';
  }
}

export const stripeWebhook = onRequest(
  { region: REGION, secrets: [STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY, SMTP_URL], maxInstances: 5, invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    let event;
    try {
      event = verifier.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET.value());
    } catch (err) {
      logger.warn('Firma de webhook no válida', { message: err.message });
      return res.status(400).send('Invalid signature');
    }
    try {
      const result = await handleStripeEvent(event);
      logger.info('Evento de Stripe procesado', { id: event.id, type: event.type, result });
      res.status(200).json({ received: true });
    } catch (err) {
      // 500 → Stripe reintentará el evento automáticamente (el procesamiento es idempotente).
      logger.error('Error procesando evento de Stripe', { id: event.id, type: event.type, err });
      res.status(500).send('Error');
    }
  },
);
