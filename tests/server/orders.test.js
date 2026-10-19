// Lógica crítica del backend contra el emulador de Firestore:
// validación de precios, reserva de stock, concurrencia, webhook de Stripe y cancelaciones.
// Uso: npm test, o con emuladores ya en marcha: node --test tests/server/*.test.js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearFirestore } from './helpers.js';

process.env.GCLOUD_PROJECT = 'demo-tienda-test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.BREVO_API_KEY = 'disabled';
process.env.SITE_URL = 'https://tienda.test';

const { db, Timestamp } = await import('../../server/src/lib/firebase.js');
const { setStripeForTests, signPayload } = await import('../../server/src/stripe/client.js');
const { createCheckout, cancelPendingCheckout } = await import('../../server/src/api/checkout.js');
const { createPendingOrder, releaseReservation, markOrderPaid, releaseStaleReservations, hashToken } = await import('../../server/src/orders/order-service.js');
const { handleStripeEvent, stripeWebhook } = await import('../../server/src/stripe/webhook.js');
const { getSettings } = await import('../../server/src/lib/settings.js');

const SHIPPING = {
  carrier: 'GLS', defaultWeight: 2000, trackingUrlTemplate: 'https://gls.test/track?n={tracking}',
  zones: [{
    id: 'peninsula', name: 'Península', active: true, countries: ['ES'], postalPrefixes: [], excludePostalPrefixes: ['07', '35', '38', '51', '52'],
    rates: [{ maxWeight: 2000, price: 500 }, { maxWeight: 10000, price: 900 }], freeOver: 10000, deliveryTime: '24-72h',
  }],
};

const CUSTOMER = {
  firstName: 'Ana', lastName: 'Pérez', email: 'ANA@test.com', phone: '600111222',
  line1: 'Calle Mayor 1', line2: '', postalCode: '28013', city: 'Madrid', province: '', country: 'ES', notes: '',
};

// Doble de Stripe: registra las llamadas y calcula amount_total como Stripe.
const stripeCalls = [];
let failNextSession = false;
const fakeStripe = {
  checkout: {
    sessions: {
      async create(params) {
        stripeCalls.push({ type: 'create', params });
        if (failNextSession) { failNextSession = false; throw new Error('Stripe caído'); }
        const items = params.line_items.reduce((s, li) => s + li.price_data.unit_amount * li.quantity, 0);
        const ship = params.shipping_options?.[0]?.shipping_rate_data.fixed_amount.amount ?? 0;
        return { id: `cs_test_${stripeCalls.length}`, url: 'https://checkout.stripe.test/pay', amount_total: items + ship };
      },
      async expire(id) { stripeCalls.push({ type: 'expire', id }); return { id, status: 'expired' }; },
      async retrieve(id) { return { id, status: 'open' }; },
    },
  },
  refunds: { async create(p) { stripeCalls.push({ type: 'refund', p }); return { id: 're_1' }; } },
};
setStripeForTests(fakeStripe);

let ipCounter = 0;
const req = (body) => ({ body, headers: { host: 'tienda.test', 'x-forwarded-for': `10.0.0.${++ipCounter % 250}` }, ip: '1.1.1.1' });

const clearDb = clearFirestore;

async function addProduct(id, data) {
  await db.doc(`products/${id}`).set({
    name: `Producto ${id}`, slug: `producto-${id}`, price: 2000, stock: 1, reserved: 0, soldCount: 0, weight: 1500,
    active: true, images: [], createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...data,
  });
}
const product = async (id) => (await db.doc(`products/${id}`).get()).data();
const order = async (id) => (await db.doc(`orders/${id}`).get()).data();

before(async () => {
  await clearDb();
});

beforeEach(async () => {
  await clearDb();
  stripeCalls.length = 0;
  await db.doc('settings/shipping').set(SHIPPING);
  await db.doc('settings/checkout').set({ enabled: true, maxQtyPerLine: 10, termsVersion: '3', closedMessage: 'Cerrado' });
  await getSettings('shipping', { fresh: true });
  await getSettings('checkout', { fresh: true });
});

test('checkout: usa precios de Firestore (ignora precios enviados), calcula envío y reserva stock', async () => {
  await addProduct('PROD0000000000000001', { price: 2500, stock: 3 });
  const res = await createCheckout(req({
    items: [{ id: 'PROD0000000000000001', qty: 2, price: 1 }], // un precio manipulado se ignora
    customer: CUSTOMER, acceptTerms: true,
  }));
  assert.equal(res.url, 'https://checkout.stripe.test/pay');

  const o = await order(res.orderId);
  assert.equal(o.subtotal, 5000);
  assert.equal(o.shippingCost, 900); // 2 × 1,5 kg = 3 kg → tramo hasta 10 kg
  assert.equal(o.total, o.subtotal + o.shippingCost);
  assert.equal(o.paymentStatus, 'pending');
  assert.equal(o.customer.email, 'ana@test.com');
  assert.equal(o.shippingAddress.province, 'Madrid', 'provincia deducida del CP');
  assert.equal(o.legal.termsVersion, '3');
  assert.match(o.number, /^\d{4}-00001$/);

  const p = await product('PROD0000000000000001');
  assert.equal(p.stock, 1);
  assert.equal(p.reserved, 2);

  const create = stripeCalls.find((c) => c.type === 'create').params;
  assert.equal(create.line_items[0].price_data.unit_amount, 2500);
  assert.equal(create.metadata.orderId, res.orderId);
  assert.ok(create.expires_at * 1000 - Date.now() >= 30 * 60_000, 'la sesión expira en ≥30 min (mínimo de Stripe)');
  assert.ok(create.success_url.startsWith('https://tienda.test/pedido?n='));
});

test('checkout: envío gratis a partir del umbral y zona no servida', async () => {
  await addProduct('PROD0000000000000002', { price: 12000, stock: 1 });
  const res = await createCheckout(req({ items: [{ id: 'PROD0000000000000002', qty: 1 }], customer: CUSTOMER, acceptTerms: true }));
  assert.equal((await order(res.orderId)).shippingCost, 0);

  await addProduct('PROD0000000000000003', { price: 1000, stock: 1 });
  await assert.rejects(
    createCheckout(req({ items: [{ id: 'PROD0000000000000003', qty: 1 }], customer: { ...CUSTOMER, postalCode: '35001' }, acceptTerms: true })),
    (err) => err.code === 'no_zone',
  );
  assert.equal((await product('PROD0000000000000003')).stock, 1, 'sin zona no se reserva stock');
});

test('checkout: sin stock, cantidad superior al stock, producto inactivo o inexistente', async () => {
  await addProduct('PROD0000000000000004', { stock: 0 });
  await addProduct('PROD0000000000000005', { stock: 2 });
  await addProduct('PROD0000000000000006', { active: false });
  await assert.rejects(
    createCheckout(req({
      items: [{ id: 'PROD0000000000000004', qty: 1 }, { id: 'PROD0000000000000005', qty: 3 }, { id: 'PROD0000000000000006', qty: 1 }, { id: 'NOEXISTE000000000000', qty: 1 }],
      customer: CUSTOMER, acceptTerms: true,
    })),
    (err) => {
      assert.equal(err.code, 'cart_changed');
      const byId = Object.fromEntries(err.details.map((d) => [d.id, d]));
      assert.equal(byId.PROD0000000000000004.code, 'insufficient_stock');
      assert.equal(byId.PROD0000000000000005.available, 2);
      assert.equal(byId.PROD0000000000000006.code, 'unavailable');
      assert.equal(byId.NOEXISTE000000000000.code, 'unavailable');
      return true;
    },
  );
  assert.equal((await product('PROD0000000000000005')).stock, 2, 'nada reservado si el carrito es inválido');
});

test('checkout: exige aceptar condiciones, datos válidos y tienda abierta', async () => {
  await addProduct('PROD0000000000000007', {});
  const items = [{ id: 'PROD0000000000000007', qty: 1 }];
  await assert.rejects(createCheckout(req({ items, customer: CUSTOMER })), (e) => e.code === 'terms_required');
  await assert.rejects(createCheckout(req({ items, customer: { ...CUSTOMER, email: 'malo' }, acceptTerms: true })), (e) => e.code === 'invalid_form' && e.details.email === 'Introduce un email válido');
  await assert.rejects(createCheckout(req({ items: [{ id: 'PROD0000000000000007', qty: 50 }], customer: CUSTOMER, acceptTerms: true })), (e) => e.code === 'invalid_cart');
  await db.doc('settings/checkout').set({ enabled: false, closedMessage: 'Vacaciones' });
  await getSettings('checkout', { fresh: true });
  await assert.rejects(createCheckout(req({ items, customer: CUSTOMER, acceptTerms: true })), (e) => e.code === 'store_closed');
});

test('concurrencia: 8 compradores a la vez por la última unidad → solo 1 consigue reservarla', async () => {
  await addProduct('ULTIMA00000000000001', { stock: 1 });
  const input = { items: [{ id: 'ULTIMA00000000000001', qty: 1 }], customer: { ...CUSTOMER, email: 'x@y.es' }, address: { country: 'ES', postalCode: '28013' }, termsVersion: '1' };
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => createPendingOrder(input, SHIPPING)));
  const ok = results.filter((r) => r.status === 'fulfilled');
  const ko = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.ok(ko.every((r) => r.reason.code === 'cart_changed'));
  const p = await product('ULTIMA00000000000001');
  assert.equal(p.stock, 0);
  assert.equal(p.reserved, 1);
});

test('si Stripe falla al crear la sesión, se devuelve el stock', async () => {
  await addProduct('PROD0000000000000008', { stock: 1 });
  failNextSession = true;
  await assert.rejects(createCheckout(req({ items: [{ id: 'PROD0000000000000008', qty: 1 }], customer: CUSTOMER, acceptTerms: true })), (e) => e.code === 'payment_error');
  const p = await product('PROD0000000000000008');
  assert.equal(p.stock, 1);
  assert.equal(p.reserved, 0);
});

async function paidFlow(stock = 2, qty = 1) {
  await addProduct('PAGO0000000000000001', { stock, price: 3000 });
  const res = await createCheckout(req({ items: [{ id: 'PAGO0000000000000001', qty }], customer: CUSTOMER, acceptTerms: true }));
  const o = await order(res.orderId);
  return { orderId: res.orderId, order: o };
}

const completedEvent = (id, o, over = {}) => ({
  id, type: 'checkout.session.completed',
  data: { object: { id: o.stripe.sessionId, payment_status: 'paid', amount_total: o.total, currency: 'eur', payment_intent: 'pi_123', metadata: { orderId: o.id, accessToken: 'tok' }, ...over } },
});

test('webhook: pago completado → pedido pagado, reserva convertida en venta, estadísticas; idempotente', async () => {
  const { orderId, order: o } = await paidFlow(2, 1);
  const ev = completedEvent('evt_1', { ...o, id: orderId });
  assert.equal(await handleStripeEvent(ev), 'paid');
  assert.equal(await handleStripeEvent(ev), 'duplicate', 'el mismo evento no se procesa dos veces');

  const paid = await order(orderId);
  assert.equal(paid.paymentStatus, 'paid');
  assert.equal(paid.orderStatus, 'paid');
  assert.equal(paid.stripe.paymentIntentId, 'pi_123');
  assert.equal(paid.deleteAt, undefined, 'los pedidos pagados no caducan por TTL');
  const p = await product('PAGO0000000000000001');
  assert.equal(p.stock, 1);
  assert.equal(p.reserved, 0);
  assert.equal(p.soldCount, 1);
  const stats = (await db.collection('statistics').get()).docs[0].data();
  assert.equal(stats.orders, 1);
  assert.equal(stats.revenue, o.total);
});

test('webhook: importe o sesión que no coinciden NO marcan el pedido como pagado', async () => {
  const { orderId, order: o } = await paidFlow();
  assert.equal(await handleStripeEvent(completedEvent('evt_2', { ...o, id: orderId }, { amount_total: 1 })), 'mismatch');
  assert.equal(await handleStripeEvent(completedEvent('evt_3', { ...o, id: orderId }, { id: 'cs_otro' })), 'mismatch');
  assert.equal(await handleStripeEvent(completedEvent('evt_4', { ...o, id: orderId }, { payment_status: 'unpaid' })), 'ignored_unpaid');
  assert.equal((await order(orderId)).paymentStatus, 'pending');
});

test('webhook: sesión caducada (pago rechazado/abandonado) → stock devuelto', async () => {
  const { orderId, order: o } = await paidFlow(1, 1);
  assert.equal((await product('PAGO0000000000000001')).stock, 0);
  const ev = { id: 'evt_5', type: 'checkout.session.expired', data: { object: { id: o.stripe.sessionId, metadata: { orderId } } } };
  assert.equal(await handleStripeEvent(ev), 'released');
  assert.equal(await handleStripeEvent({ ...ev, id: 'evt_6' }), 'noop');
  const p = await product('PAGO0000000000000001');
  assert.equal(p.stock, 1);
  assert.equal(p.reserved, 0);
  const x = await order(orderId);
  assert.equal(x.orderStatus, 'expired');
  assert.ok(x.deleteAt, 'los pedidos no pagados tienen fecha de borrado (TTL)');
});

test('el comprador cancela en Stripe → se libera la reserva al momento', async () => {
  await addProduct('PAGO0000000000000002', { stock: 1 });
  const res = await createCheckout(req({ items: [{ id: 'PAGO0000000000000002', qty: 1 }], customer: CUSTOMER, acceptTerms: true }));
  const link = new URL(stripeCalls.find((c) => c.type === 'create').params.cancel_url);
  await assert.rejects(cancelPendingCheckout(req({ n: res.orderId, t: 'token-falso' })), (e) => e.code === 'not_found');
  const out = await cancelPendingCheckout(req({ n: link.searchParams.get('n'), t: link.searchParams.get('t') }));
  assert.equal(out.released, true);
  assert.ok(stripeCalls.some((c) => c.type === 'expire'));
  assert.equal((await product('PAGO0000000000000002')).stock, 1);
  assert.equal((await order(res.orderId)).orderStatus, 'cancelled');
});

test('pago tardío tras liberar la reserva: se vende si hay stock; si no, se marca para revisar', async () => {
  const { orderId, order: o } = await paidFlow(1, 1);
  await releaseReservation(orderId);
  await db.doc('products/PAGO0000000000000001').update({ stock: 0 }); // otro comprador se la llevó
  const res = await markOrderPaid({ eventId: 'evt_late', orderId, sessionId: o.stripe.sessionId, amountTotal: o.total, currency: 'eur', paymentIntentId: 'pi_late' });
  assert.equal(res.result, 'paid');
  assert.equal(res.conflict, true);
  assert.ok((await order(orderId)).needsReview);
  assert.equal((await product('PAGO0000000000000001')).stock, 0, 'nunca stock negativo');
});

test('red de seguridad: reservas caducadas sin webhook se liberan', async () => {
  const { orderId } = await paidFlow(1, 1);
  await db.doc(`orders/${orderId}`).update({ reservationExpiresAt: Timestamp.fromMillis(Date.now() - 3_600_000) });
  assert.equal(await releaseStaleReservations(), 1);
  assert.equal((await product('PAGO0000000000000001')).stock, 1);
});

test('endpoint del webhook: rechaza firmas no válidas y acepta las válidas', async () => {
  const { orderId, order: o } = await paidFlow();
  const payload = JSON.stringify(completedEvent('evt_http', { ...o, id: orderId }));
  const call = (signature) => new Promise((resolve) => {
    const res = {
      statusCode: 200, status(c) { this.statusCode = c; return this; },
      send(b) { resolve({ code: this.statusCode, body: b }); }, json(b) { resolve({ code: this.statusCode, body: b }); },
      set() { return this; }, setHeader() {}, getHeader() {},
    };
    stripeWebhook({ method: 'POST', rawBody: payload, headers: { 'stripe-signature': signature }, body: JSON.parse(payload) }, res);
  });
  const bad = await call('t=1,v1=firmafalsa');
  assert.equal(bad.code, 400);
  assert.equal((await order(orderId)).paymentStatus, 'pending');

  const header = await signPayload(payload, process.env.STRIPE_WEBHOOK_SECRET);
  const good = await call(header);
  assert.equal(good.code, 200);
  assert.equal((await order(orderId)).paymentStatus, 'paid');
});

test('el token de acceso al pedido se guarda solo como hash', async () => {
  const { order: o } = await paidFlow();
  const link = new URL(stripeCalls.find((c) => c.type === 'create').params.success_url);
  assert.equal(o.accessTokenHash, hashToken(link.searchParams.get('t')));
  assert.ok(!JSON.stringify(o).includes(link.searchParams.get('t')));
});

test('límite antiabuso: máximo 2 pagos pendientes por email', async () => {
  for (const id of ['LIM00000000000000001', 'LIM00000000000000002', 'LIM00000000000000003']) await addProduct(id, { stock: 1 });
  await createCheckout(req({ items: [{ id: 'LIM00000000000000001', qty: 1 }], customer: CUSTOMER, acceptTerms: true }));
  await createCheckout(req({ items: [{ id: 'LIM00000000000000002', qty: 1 }], customer: CUSTOMER, acceptTerms: true }));
  await assert.rejects(
    createCheckout(req({ items: [{ id: 'LIM00000000000000003', qty: 1 }], customer: CUSTOMER, acceptTerms: true })),
    (e) => e.code === 'too_many_pending',
  );
  assert.equal((await product('LIM00000000000000003')).stock, 1);
});

test('reintento del mismo navegador (botón Atrás): se cancela la reserva anterior y puede volver a comprar la pieza única', async () => {
  await addProduct('UNICA000000000000001', { stock: 1 });
  const first = await createCheckout(req({ items: [{ id: 'UNICA000000000000001', qty: 1 }], customer: CUSTOMER, acceptTerms: true }));
  assert.equal((await product('UNICA000000000000001')).stock, 0);
  const second = await createCheckout(req({
    items: [{ id: 'UNICA000000000000001', qty: 1 }], customer: CUSTOMER, acceptTerms: true,
    previous: { n: first.orderId, t: first.token },
  }));
  assert.ok(second.url);
  assert.equal((await order(first.orderId)).orderStatus, 'cancelled');
  const p = await product('UNICA000000000000001');
  assert.equal(p.stock, 0);
  assert.equal(p.reserved, 1);
});

test('cancelación del comprador: si Stripe no confirma la caducidad (p. ej. ya pagó), NO se libera el stock', async () => {
  await addProduct('PAGANDO0000000000001', { stock: 1 });
  const res = await createCheckout(req({ items: [{ id: 'PAGANDO0000000000001', qty: 1 }], customer: CUSTOMER, acceptTerms: true }));
  const original = fakeStripe.checkout.sessions.expire;
  fakeStripe.checkout.sessions.expire = async () => { throw new Error('session is complete'); };
  const retrieve = fakeStripe.checkout.sessions.retrieve;
  fakeStripe.checkout.sessions.retrieve = async (id) => ({ id, status: 'complete' });
  try {
    const out = await cancelPendingCheckout(req({ n: res.orderId, t: res.token }));
    assert.equal(out.released, false);
    assert.equal((await product('PAGANDO0000000000001')).stock, 0);
    assert.equal((await order(res.orderId)).paymentStatus, 'pending');
  } finally {
    fakeStripe.checkout.sessions.expire = original;
    fakeStripe.checkout.sessions.retrieve = retrieve;
  }
});

test('pago tardío: registra qué líneas descontaron stock (stockTaken)', async () => {
  const { orderId, order: o } = await paidFlow(1, 1);
  await releaseReservation(orderId);
  await db.doc('products/PAGO0000000000000001').update({ stock: 0 });
  await markOrderPaid({ eventId: 'evt_st', orderId, sessionId: o.stripe.sessionId, amountTotal: o.total, currency: 'eur', paymentIntentId: 'pi' });
  assert.equal((await order(orderId)).items[0].stockTaken, false);
});

test('origen de los enlaces: no se puede falsear con X-Forwarded-Host', async () => {
  const { requestOrigin } = await import('../../server/src/lib/http.js');
  assert.equal(requestOrigin({ headers: { 'x-forwarded-host': 'evil.tld' } }), 'https://tienda.test');
});

test('limpieza horaria: borra pedidos sin pagar y eventos caducados (sustituye al TTL), nunca los pagados', async () => {
  const { purgeExpired } = await import('../../server/src/orders/order-service.js');
  const past = Timestamp.fromMillis(Date.now() - 60_000);
  const future = Timestamp.fromMillis(Date.now() + 86_400_000);
  await db.doc('orders/VIEJO000000000000001').set({ paymentStatus: 'expired', deleteAt: past });
  await db.doc('orders/NUEVO000000000000001').set({ paymentStatus: 'pending', deleteAt: future });
  await db.doc('orders/PAGADO00000000000001').set({ paymentStatus: 'paid' });
  await db.doc('stripeEvents/evt_viejo').set({ deleteAt: past });
  assert.equal(await purgeExpired(), 2);
  assert.equal((await db.doc('orders/VIEJO000000000000001').get()).exists, false);
  assert.equal((await db.doc('orders/NUEVO000000000000001').get()).exists, true);
  assert.equal((await db.doc('orders/PAGADO00000000000001').get()).exists, true);
  assert.equal((await db.doc('stripeEvents/evt_viejo').get()).exists, false);
});

test('checkout con medidas: cobra por peso volumétrico y guarda los bultos en el pedido', async () => {
  await db.doc('settings/shipping').set({ ...SHIPPING, volumetricDivisor: 5000, bulkyLength: 120, zones: [{ ...SHIPPING.zones[0], bulkySurcharge: 1500, rates: [...SHIPPING.zones[0].rates, { maxWeight: 60000, price: 2900 }] }] });
  await getSettings('shipping', { fresh: true });
  // Paragolpes: 6 kg reales, 180 × 50 × 30 cm → 54 kg volumétricos y voluminoso.
  await addProduct('PARAGOLPES0000000001', { price: 3000, weight: 6000, length: 180, width: 50, height: 30 });
  const res = await createCheckout(req({ items: [{ id: 'PARAGOLPES0000000001', qty: 1 }], customer: CUSTOMER, acceptTerms: true }));
  const o = await order(res.orderId);
  assert.equal(o.shipping.weight, 54000);
  assert.equal(o.shipping.realWeight, 6000);
  assert.equal(o.shipping.bulky, 1);
  assert.equal(o.shippingCost, 2900 + 1500);
  assert.deepEqual([o.items[0].length, o.items[0].width, o.items[0].height], [180, 50, 30]);
  const create = stripeCalls.find((c) => c.type === 'create').params;
  assert.equal(create.shipping_options[0].shipping_rate_data.fixed_amount.amount, 4400);
});

test('pago diferido (SEPA): la tarea horaria NO libera la reserva mientras Stripe no confirme la caducidad', async () => {
  const { orderId } = await paidFlow(1, 1);
  await db.doc(`orders/${orderId}`).update({ reservationExpiresAt: Timestamp.fromMillis(Date.now() - 3_600_000) });
  const { expire, retrieve } = fakeStripe.checkout.sessions;
  fakeStripe.checkout.sessions.expire = async () => { throw new Error('session is complete'); };
  fakeStripe.checkout.sessions.retrieve = async (id) => ({ id, status: 'complete', payment_status: 'unpaid' });
  try {
    assert.equal(await releaseStaleReservations(), 0);
    assert.equal((await product('PAGO0000000000000001')).stock, 0, 'la pieza sigue reservada');
    assert.equal((await order(orderId)).paymentStatus, 'pending');
  } finally {
    Object.assign(fakeStripe.checkout.sessions, { expire, retrieve });
  }
});

test('pago que no coincide: el pedido queda marcado para revisar', async () => {
  const { orderId, order: o } = await paidFlow();
  assert.equal(await handleStripeEvent(completedEvent('evt_mm', { ...o, id: orderId }, { amount_total: 1 })), 'mismatch');
  const x = await order(orderId);
  assert.equal(x.paymentStatus, 'pending');
  assert.match(x.needsReview, /no coincide/);
});

test('límite antiabuso: máximo 3 pagos pendientes por IP aunque cambie el email', async () => {
  const ids = ['IPLIM000000000000001', 'IPLIM000000000000002', 'IPLIM000000000000003', 'IPLIM000000000000004'];
  for (const id of ids) await addProduct(id, { stock: 1 });
  const sameIp = (body) => ({ body, headers: { host: 'tienda.test', 'cf-connecting-ip': '203.0.113.7' } });
  for (const [i, id] of ids.slice(0, 3).entries()) {
    await createCheckout(sameIp({ items: [{ id, qty: 1 }], customer: { ...CUSTOMER, email: `u${i}@test.com` }, acceptTerms: true }));
  }
  await assert.rejects(
    createCheckout(sameIp({ items: [{ id: ids[3], qty: 1 }], customer: { ...CUSTOMER, email: 'otro@test.com' }, acceptTerms: true })),
    (e) => e.code === 'too_many_pending',
  );
  const o = (await db.collection('orders').limit(1).get()).docs[0].data();
  assert.ok(o.ipHash && !JSON.stringify(o).includes('203.0.113.7'), 'solo se guarda el hash de la IP');
});

test('consulta con número + email: no muestra la calle ni los apellidos', async () => {
  const { lookupOrder } = await import('../../server/src/api/order.js');
  const { orderId, order: o } = await paidFlow();
  await handleStripeEvent(completedEvent('evt_lk', { ...o, id: orderId }));
  const view = await lookupOrder(req({ number: o.number, email: 'ana@test.com' }));
  assert.equal(view.shippingAddress.line1, undefined);
  assert.equal(view.shippingAddress.postalCode, '28013');
  assert.equal(view.customer.lastName, 'P.');
});

test('desistimiento: dos solicitudes a la vez solo registran una', async () => {
  const { requestWithdrawal } = await import('../../server/src/api/order.js');
  const { orderId, order: o } = await paidFlow();
  await handleStripeEvent(completedEvent('evt_wd', { ...o, id: orderId }));
  const body = { orderNumber: o.number, email: 'ana@test.com', message: 'No me vale' };
  const results = await Promise.all([requestWithdrawal(req(body)), requestWithdrawal(req(body))]);
  assert.equal(results.filter((r) => !r.alreadyRequested).length, 1);
  const history = (await order(orderId)).history.filter((h) => h.note === 'Solicitud de desistimiento');
  assert.equal(history.length, 1);
});
