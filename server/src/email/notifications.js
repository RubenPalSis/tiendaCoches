import { db } from '../lib/firebase.js';
import { getSettings } from '../lib/settings.js';
import { sendMail } from './mailer.js';
import {
  orderConfirmationEmail, orderShippedEmail, orderCancelledEmail,
  sellerNewOrderEmail, withdrawalReceiptEmail, sellerWithdrawalEmail,
} from './templates.js';

const sellerEmail = (store) => store.notificationEmail || store.email;

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
    sendMail({ to: sellerEmail(store), ...toSeller }),
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
    sendMail({ to: sellerEmail(store), ...sellerWithdrawalEmail(store, order, message) }),
  ]);
}
