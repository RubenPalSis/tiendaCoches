import { db } from '../lib/firebase.js';
import { getSettings } from '../lib/settings.js';
import { ORDER_ALERT_EMAILS } from '../lib/config.js';
import { sendMail } from './mailer.js';
import {
  orderConfirmationEmail, orderShippedEmail, orderCancelledEmail,
  sellerNewOrderEmail, withdrawalReceiptEmail, sellerWithdrawalEmail, sellerPaymentAlertEmail,
} from './templates.js';

/**
 * Destinatarios de los avisos al vendedor. Si wrangler.toml fija ORDER_ALERT_EMAILS, van SOLO ahí
 * (nadie puede desviarlos desde el panel); si está vacío (desarrollo), al email de avisos del panel.
 */
const sellerRecipients = (store) => {
  const fixed = [...new Set(ORDER_ALERT_EMAILS.value().split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (fixed.length) return fixed;
  const fallback = store.notificationEmail || store.email;
  return fallback ? [fallback] : [];
};
const sendToSeller = (store, mail) => Promise.all(sellerRecipients(store).map((to) => sendMail({ to, ...mail })));

async function logEmail(orderId, key, ok) {
  await db.collection('orders').doc(orderId).update({ [`emails.${key}`]: ok ? 'sent' : 'not_sent' }).catch(() => {});
}

export async function sendOrderPaidEmails(order, accessToken) {
  const store = await getSettings('store');
  const orderUrl = accessToken && order.siteOrigin
    ? `${order.siteOrigin}/pedido?n=${order.id}&t=${encodeURIComponent(accessToken)}`
    : '';
  const toCustomer = orderConfirmationEmail(store, order, orderUrl);
  const toSeller = sellerNewOrderEmail(store, order, order.siteOrigin ? `${order.siteOrigin}/admin/#/pedidos/${order.id}` : '');
  const [a] = await Promise.all([
    sendMail({ to: order.customer.email, ...toCustomer }),
    sendToSeller(store, toSeller),
  ]);
  await logEmail(order.id, 'confirmation', a);
}

export async function sendOrderShippedEmail(order) {
  const store = await getSettings('store');
  const lookupUrl = order.siteOrigin ? `${order.siteOrigin}/pedido?numero=${encodeURIComponent(order.number)}` : '';
  const ok = await sendMail({ to: order.customer.email, ...orderShippedEmail(store, order, lookupUrl) });
  await logEmail(order.id, 'shipped', ok);
  return ok;
}

export async function sendOrderCancelledEmail(order, refunded) {
  const store = await getSettings('store');
  const ok = await sendMail({ to: order.customer.email, ...orderCancelledEmail(store, order, refunded) });
  await logEmail(order.id, 'cancelled', ok);
}

export async function sendWithdrawalEmails(order, message, requestedAt) {
  const store = await getSettings('store');
  await Promise.all([
    sendMail({ to: order.customer.email, ...withdrawalReceiptEmail(store, order, message, requestedAt) }),
    sendToSeller(store, sellerWithdrawalEmail(store, order, message)),
  ]);
}

/** Aviso al vendedor de un cobro de Stripe que no cuadra con el pedido (no se marca como pagado). */
export async function sendPaymentAlertEmail(orderId, order, detail) {
  const store = await getSettings('store');
  const adminUrl = order?.siteOrigin ? `${order.siteOrigin}/admin/#/pedidos/${orderId}` : '';
  await sendToSeller(store, sellerPaymentAlertEmail(store, order, detail, adminUrl));
}
