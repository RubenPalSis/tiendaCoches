// Acciones del panel sobre pedidos: estados, seguimiento GLS, cancelación y reembolso.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.GCLOUD_PROJECT = 'demo-tienda-test2';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.SMTP_URL = 'disabled';
process.env.ADMIN_EMAILS = 'admin@x.es';

const { db, Timestamp } = await import('../../functions/src/lib/firebase.js');
const { setStripeForTests } = await import('../../functions/src/stripe/client.js');
const { ACTIONS, requireAdmin } = await import('../../functions/src/admin/order-actions.js');
const { getSettings } = await import('../../functions/src/lib/settings.js');

const refunds = [];
setStripeForTests({
  refunds: { async create(p) { refunds.push(p); return { id: 're_1' }; } },
  checkout: { sessions: { async expire() { return {}; } } },
});

const ORDER_ID = 'ORDER000000000000001';
const PRODUCT_ID = 'PRODX000000000000001';

beforeEach(async () => {
  for (const col of await db.listCollections()) await db.recursiveDelete(col);
  refunds.length = 0;
  await db.doc('settings/shipping').set({ carrier: 'GLS', trackingUrlTemplate: 'https://gls.example/t?match={tracking}', zones: [] });
  await getSettings('shipping', { fresh: true });
  await db.doc(`products/${PRODUCT_ID}`).set({ name: 'Faro', stock: 0, reserved: 0, soldCount: 1, active: true });
  await db.doc(`orders/${ORDER_ID}`).set({
    number: '2026-00007', paymentStatus: 'paid', orderStatus: 'paid', total: 5500,
    customer: { firstName: 'Ana', lastName: 'P', email: 'ana@test.com', phone: '600' },
    shippingAddress: { line1: 'C/ Mayor 1', postalCode: '28013', city: 'Madrid', province: 'Madrid', country: 'ES' },
    items: [{ productId: PRODUCT_ID, name: 'Faro', quantity: 1, unitPrice: 5000 }],
    subtotal: 5000, shippingCost: 500,
    shipping: { carrier: 'GLS', trackingNumber: '', trackingUrl: '', zoneName: 'Península', weight: 2000 },
    stripe: { sessionId: 'cs_1', paymentIntentId: 'pi_1' }, history: [], createdAt: Timestamp.now(),
  });
});

const order = async () => (await db.doc(`orders/${ORDER_ID}`).get()).data();

test('solo administradores pueden ejecutar acciones', () => {
  assert.throws(() => requireAdmin({}), /administradores/);
  assert.throws(() => requireAdmin({ auth: { token: { email: 'x@y.z' } } }), /administradores/);
  assert.equal(requireAdmin({ auth: { uid: 'a', token: { admin: true, email: 'admin@x.es' } } }), 'admin@x.es');
  // Con el claim pero ya fuera de ADMIN_EMAILS → sin acceso.
  assert.throws(() => requireAdmin({ auth: { uid: 'b', token: { admin: true, email: 'antiguo@x.es' } } }), /administradores/);
});

test('flujo GLS manual: preparando → enviado con seguimiento → entregado', async () => {
  await ACTIONS.setStatus({ orderId: ORDER_ID, status: 'preparing' }, 'admin');
  assert.equal((await order()).orderStatus, 'preparing');

  await assert.rejects(ACTIONS.setStatus({ orderId: ORDER_ID, status: 'shipped' }, 'admin'), /seguimiento/);
  const res = await ACTIONS.setStatus({ orderId: ORDER_ID, status: 'shipped', trackingNumber: ' 1234567890 ' }, 'admin');
  assert.equal(res.ok, true);
  assert.equal(res.emailed, false, 'sin SMTP no se envía email, pero el pedido se actualiza');
  const shipped = await order();
  assert.equal(shipped.orderStatus, 'shipped');
  assert.equal(shipped.shipping.trackingNumber, '1234567890');
  assert.equal(shipped.shipping.trackingUrl, 'https://gls.example/t?match=1234567890');
  assert.ok(shipped.shipping.shippedAt);

  await ACTIONS.setStatus({ orderId: ORDER_ID, status: 'delivered' }, 'admin');
  const delivered = await order();
  assert.equal(delivered.orderStatus, 'delivered');
  assert.equal(delivered.history.length, 3);
});

test('transiciones no permitidas se rechazan', async () => {
  await assert.rejects(ACTIONS.setStatus({ orderId: ORDER_ID, status: 'delivered' }, 'admin'), /No se puede pasar/);
  await assert.rejects(ACTIONS.setStatus({ orderId: ORDER_ID, status: 'pending' }, 'admin'), /No se puede pasar/);
  await assert.rejects(ACTIONS.setStatus({ orderId: 'malo', status: 'preparing' }, 'admin'), /no válido/);
});

test('cancelar pedido pagado: reembolso en Stripe y stock repuesto', async () => {
  const res = await ACTIONS.cancel({ orderId: ORDER_ID, refund: true, restock: true, notify: true }, 'admin');
  assert.equal(res.refunded, true);
  assert.equal(refunds[0].payment_intent, 'pi_1');
  const o = await order();
  assert.equal(o.orderStatus, 'cancelled');
  assert.equal(o.paymentStatus, 'refunded');
  const p = (await db.doc(`products/${PRODUCT_ID}`).get()).data();
  assert.equal(p.stock, 1);
  assert.equal(p.soldCount, 0);
  await assert.rejects(ACTIONS.cancel({ orderId: ORDER_ID }, 'admin'), /ya no se puede cancelar/);
});

test('cancelar sin reembolso ni reponer stock', async () => {
  await ACTIONS.cancel({ orderId: ORDER_ID, refund: false, restock: false }, 'admin');
  assert.equal(refunds.length, 0);
  assert.equal((await db.doc(`products/${PRODUCT_ID}`).get()).data().stock, 0);
  assert.equal((await order()).paymentStatus, 'paid');
});

test('cancelar con stock repuesto solo repone las líneas que descontaron stock', async () => {
  await db.doc(`orders/${ORDER_ID}`).update({ items: [{ productId: PRODUCT_ID, name: 'Faro', quantity: 1, unitPrice: 5000, stockTaken: false }] });
  await ACTIONS.cancel({ orderId: ORDER_ID, refund: false, restock: true, notify: false }, 'admin');
  assert.equal((await db.doc(`products/${PRODUCT_ID}`).get()).data().stock, 0);
});

test('si el reembolso falla, el pedido queda cancelado y marcado para revisar', async () => {
  setStripeForTests({ refunds: { async create() { throw new Error('caído'); } } });
  try {
    await assert.rejects(ACTIONS.cancel({ orderId: ORDER_ID, refund: true, restock: false, notify: false }, 'admin'), /reembolso/);
    const o = await order();
    assert.equal(o.orderStatus, 'cancelled');
    assert.equal(o.paymentStatus, 'paid');
    assert.match(o.needsReview, /reembolso/);
  } finally {
    setStripeForTests({ refunds: { async create(p) { refunds.push(p); return { id: 're_1' }; } }, checkout: { sessions: { async expire() { return { status: 'expired' }; } } } });
  }
});
