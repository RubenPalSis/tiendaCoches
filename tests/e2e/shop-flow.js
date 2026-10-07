// Recorrido del comprador contra los emuladores (requiere `npm run dev` + `npm run seed`).
// Uso: node tests/e2e/shop-flow.js   (WIDTH=1366 para escritorio)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

process.env.GCLOUD_PROJECT = 'demo-tienda';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const BASE = process.env.BASE_URL || 'http://localhost:5000';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
const width = Number(process.env.WIDTH || 375);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 812 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// 503 de /api/checkout = pagos sin configurar en local (esperado).
page.on('response', (r) => { if (r.status() >= 500 && !(r.status() === 503 && r.url().endsWith('/api/checkout'))) errors.push(`${r.status()} ${r.url()}`); });
const shot = (n) => page.screenshot({ path: `${OUT}shop_${n}_${width}.png`, fullPage: process.env.FULL === '1' });
const step = (m) => console.log(`✔ ${m}`);

const { db } = await import('../../functions/src/lib/firebase.js');
// Preparación: un producto con 3 unidades (para probar cantidades) y otro agotado (vendido).
const all = (await db.collection('products').orderBy('createdAt', 'desc').get()).docs;
const multi = all.find((d) => /audi/i.test(d.data().name)) ?? all[0];
const soldOut = all.find((d) => d.id !== multi.id && /BMW/.test(d.data().name));
const single = all.find((d) => ![multi.id, soldOut.id].includes(d.id));
await multi.ref.update({ stock: 3 });
await soldOut.ref.update({ stock: 0, soldCount: 1 });
await single.ref.update({ stock: 1 });
await page.waitForTimeout(31_000); // caché de 30 s del catálogo en el servidor

// Búsqueda con sugerencias
await page.goto(BASE);
await page.waitForSelector('#header');
await page.fill('#hero-search', 'golf gti');
await page.waitForSelector('#hero-suggest .suggest__item');
assert.match(await page.textContent('#hero-suggest'), /Golf GTI/i);
await shot('search_suggest');
step('sugerencias de búsqueda instantánea');

await page.press('#hero-search', 'Enter');
await page.waitForURL(/catalogo\?q=/);
await page.waitForSelector('#results .card');
const found = await page.locator('#results .card').count();
assert.ok(found >= 1 && found <= 3);
step(`búsqueda → catálogo con ${found} resultados`);

// Filtros
await page.goto(`${BASE}/catalogo`);
await page.waitForSelector('#results .card');
const total = Number(await page.textContent('.toolbar__count strong'));
if (width < 1024) {
  await page.click('[data-open-filters]');
  await page.waitForSelector('#filters-drawer.is-open');
  await shot('filters_drawer');
  await page.locator('#filters-drawer input[name="brand"][value="Audi"]').check();
  await page.click('#filters-apply');
} else {
  await page.locator('#filters input[name="brand"][value="Audi"]').check();
}
await page.waitForFunction((n) => Number(document.querySelector('.toolbar__count strong').textContent) < n, total);
assert.ok(page.url().includes('marca=Audi'));
const onlyAudi = Number(await page.textContent('.toolbar__count strong'));
step(`filtro por marca (${total} → ${onlyAudi})`);

await page.selectOption('#sort', 'precio-asc');
const prices = await page.$$eval('#results .price', (els) => els.map((e) => parseFloat(e.textContent.replace(/[^\d,]/g, '').replace(',', '.'))));
assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
step('ordenar por precio');

// Categoría (SSR) con vendidos
await page.goto(`${BASE}/categoria/${soldOut.data().categoryId}?vendidos=1`);
await page.waitForSelector('#results .card');
while (await page.locator('[data-load-more]').count()) await page.click('[data-load-more]'); // los vendidos van al final
assert.ok(await page.locator('.badge--sold').count() >= 1, 'productos vendidos visibles con etiqueta');
step('página de categoría con productos vendidos marcados');

// Ficha de producto → carrito
await page.goto(`${BASE}/producto/${multi.data().slug}`);
await page.waitForSelector('#add-to-cart');
await page.click('[data-qty-inc]');
assert.equal(await page.inputValue('#qty'), '2');
await shot('product');
await page.click('#add-to-cart');
await page.waitForSelector('#cart-drawer.is-open');
assert.equal(await page.textContent('[data-cart-count]'), '2');
await shot('cart_drawer');
step('añadir 2 unidades desde la ficha (mini-carrito abierto)');

// Página de carrito: cambiar cantidades
await page.goto(`${BASE}/carrito`);
await page.waitForSelector('.cart-line');
await page.click('[data-qty-change="1"]');
await page.waitForFunction(() => document.querySelector('[data-qty-input]').value === '3');
await page.click('[data-qty-change="-1"]');
await page.waitForFunction(() => document.querySelector('[data-qty-input]').value === '2');
await shot('cart');
step('modificar cantidades en el carrito');

// Producto de una sola unidad: no se puede añadir más del stock
await page.goto(`${BASE}/producto/${single.data().slug}`);
await page.click('#add-to-cart');
await page.waitForSelector('#cart-drawer.is-open');
await page.goto(`${BASE}/producto/${single.data().slug}`);
await page.click('#add-to-cart');
await page.waitForSelector('.toast--error');
step('no permite superar el stock disponible');

// Checkout
await page.goto(`${BASE}/checkout`);
await page.waitForSelector('#checkout-form');
await page.click('#pay-btn');
await page.waitForSelector('[data-field="email"].has-error');
step('checkout: validación de campos obligatorios');

await page.fill('#f-email', 'comprador@test.com');
await page.fill('#f-phone', '600123123');
await page.fill('#f-firstName', 'Laura');
await page.fill('#f-lastName', 'García López');
await page.fill('#f-line1', 'Calle Alcalá 100');
await page.fill('#f-postalCode', '35001');
await page.waitForSelector('#shipping-option .notice--error');
step('código postal de Canarias → sin envío disponible');
await page.fill('#f-postalCode', '28009');
await page.fill('#f-city', 'Madrid');
await page.waitForSelector('.shipping-option', { timeout: 5000 }).catch(async (e) => { await shot('failure'); console.log(await page.innerText('#shipping-option')); throw e; });
assert.equal(await page.inputValue('#f-province'), 'Madrid');
await page.check('#f-terms');
await shot('checkout');
step('provincia automática y envío GLS calculado');

await page.click('#pay-btn');
await page.waitForSelector('#form-error .notice--error');
assert.match(await page.textContent('#form-error'), /pagos todavía no están configurados/);
step('sin claves de Stripe: error claro y sin cobrar (esperado en local)');

// Página de pedido pagado (simulamos el webhook)
const { createPendingOrder, markOrderPaid } = await import('../../functions/src/orders/order-service.js');
// Stock real (el catálogo público puede estar en caché).
const prod = { id: multi.id };
const shippingRules = (await db.doc('settings/shipping').get()).data();
// El emulador puede devolver "lock timeout" si otra transacción acaba de tocar los mismos documentos.
const retry = async (fn, n = 4) => { for (let i = 1; ; i++) { try { return await fn(); } catch (e) { if (i >= n || e.code !== 10) throw e; await new Promise((r) => setTimeout(r, 1500)); } } };
const created = await retry(() => createPendingOrder({
  items: [{ id: prod.id, qty: 1 }], origin: BASE, termsVersion: '1',
  customer: { firstName: 'Laura', lastName: 'García', email: 'laura@test.com', phone: '600123123' },
  address: { line1: 'Calle Alcalá 100', line2: '', postalCode: '28009', city: 'Madrid', province: 'Madrid', country: 'ES', notes: '' },
}, shippingRules));
await db.doc(`orders/${created.id}`).update({ 'stripe.sessionId': 'cs_e2e' });
await page.goto(`${BASE}/pedido?n=${created.id}&t=${encodeURIComponent(created.token)}&pago=ok`);
await page.waitForSelector('text=Confirmando tu pago');
await shot('order_pending');
await retry(() => markOrderPaid({ eventId: `evt_e2e_${Date.now()}`, orderId: created.id, sessionId: 'cs_e2e', amountTotal: created.order.total, currency: 'eur', paymentIntentId: 'pi_e2e' }));
await page.waitForSelector('text=Gracias por tu compra', { timeout: 15000 });
assert.equal(await page.locator('[data-cart-count]').isHidden(), true, 'carrito vaciado tras el pago');
await shot('order_paid');
step('página de pedido: espera al webhook y confirma el pago');

// Consulta de pedido por número + email
await page.goto(`${BASE}/pedido?numero=${created.order.number}`);
await page.fill('#l-email', 'laura@test.com');
await page.click('#lookup-form button[type="submit"]');
await page.waitForSelector('.timeline');
step('consulta de pedido con número y email');

// Desistimiento en línea
await page.goto(`${BASE}/legal/devoluciones?pedido=${created.order.number}`);
await page.fill('#w-email', 'laura@test.com');
await page.click('#withdrawal-form button[type="submit"]');
await page.waitForSelector('#withdrawal-result .notice');
const withdrawal = await page.textContent('#withdrawal-result');
// Límite antiabuso: 5 solicitudes/hora por IP (al repetir los tests seguidos salta el 429).
assert.match(withdrawal, /desistimiento recibida|Demasiadas solicitudes/);
step(/Demasiadas/.test(withdrawal) ? 'desistimiento: límite antiabuso activo (429)' : 'formulario de desistimiento en línea');

console.log(`\nPedido de prueba: ${created.order.number} → ${BASE}/admin/#/pedidos/${created.id}`);
await browser.close();
if (errors.length) { console.error('Errores:\n' + errors.join('\n')); process.exit(1); }
console.log('Tienda: todas las comprobaciones OK');
process.exit(0);
