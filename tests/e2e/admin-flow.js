// Flujo del panel contra los emuladores: login, vistas, alta de pieza con foto, edición y borrado.
// Requiere `npm run dev` + `npm run seed`. Uso: node tests/e2e/admin-flow.js
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:5000';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// PNG 2x2 válido para la prueba de subida.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const imgPath = `${OUT}test-photo.png`;
writeFileSync(imgPath, PNG);

const browser = await chromium.launch();
const width = Number(process.env.WIDTH || 390);
const page = await browser.newPage({ viewport: { width, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => {
  // El 400 del login con contraseña incorrecta es esperado.
  if (r.status() >= 400 && !/signInWithPassword|favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`);
});
const shot = (name) => page.screenshot({ path: `${OUT}admin_${name}_${width}.png`, fullPage: process.env.FULL === '1' });
const step = (msg) => console.log(`✔ ${msg}`);
const NAME = `Pieza de prueba E2E ${Date.now().toString(36)}`;

await page.goto(`${BASE}/admin/`);
await page.waitForSelector('#login-form');
await shot('login');

// Credenciales incorrectas
await page.fill('#l-email', 'admin@demo.test');
await page.fill('#l-pass', 'mala');
await page.click('#login-form button[type="submit"]');
await page.waitForSelector('.notice--error');
step('login con contraseña incorrecta rechazado');

await page.fill('#l-email', 'admin@demo.test');
await page.fill('#l-pass', 'demo1234');
await page.click('#login-form button[type="submit"]');
await page.waitForSelector('.kpis', { timeout: 15000 });
await shot('dashboard');
step('login admin y panel de inicio');

for (const [hash, sel, name] of [
  ['#/pedidos', '#orders', 'orders'],
  ['#/productos', '#list .row', 'products'],
  ['#/categorias', '#list .row', 'categories'],
  ['#/estadisticas', '.kpis', 'stats'],
  ['#/configuracion?tab=envios', '#shipping-form', 'settings_shipping'],
  ['#/configuracion?tab=tienda', '#store-form', 'settings_store'],
]) {
  await page.goto(`${BASE}/admin/${hash}`);
  await page.waitForSelector(sel, { timeout: 15000 });
  await shot(name);
  step(`vista ${hash}`);
}

// Flujo GLS manual sobre un pedido pagado (lo crea tests/e2e/shop-flow.js)
await page.goto(`${BASE}/admin/#/pedidos?estado=por-preparar`);
await page.waitForFunction(() => { const el = document.querySelector('#orders'); return el && !el.textContent.includes('Cargando'); });
if (await page.locator('#orders a.row').count()) {
  await page.locator('#orders a.row').first().click();
  await page.waitForSelector('#ship-form');
  if (await page.locator('[data-status="preparing"]').count()) {
    await page.click('[data-status="preparing"]');
    await page.waitForSelector('.box__title .status--warning'); // insignia «Preparando»
  }
  await page.fill('#tracking', 'GLS123456789');
  await page.click('#ship-form button[type="submit"]');
  await page.waitForSelector('[data-status="delivered"]', { timeout: 15000 });
  assert.ok((await page.textContent('#view')).includes('GLS123456789'));
  await shot('order_shipped');
  step('pedido: preparando → enviado con nº de seguimiento GLS');
} else {
  console.log('… sin pedidos pagados: ejecuta antes tests/e2e/shop-flow.js para probar el flujo GLS');
}

// Alta de pieza con foto
await page.goto(`${BASE}/admin/#/productos/nuevo`);
await page.waitForSelector('#product-form');
await page.setInputFiles('#file-input', imgPath);
await page.waitForSelector('.photo img', { timeout: 20000 });
await page.fill('#f-name', NAME);
await page.fill('#f-price', '49,90');
await page.fill('#f-stock', '2');
await page.selectOption('#f-category', 'lips-spoilers');
await shot('product_new');
await page.click('#product-form button[type="submit"]');
await page.waitForFunction(() => location.hash === '#/productos', null, { timeout: 15000 });
await page.waitForSelector(`text=${NAME}`);
step('alta de pieza con foto');

// Edición: precio y ocultar
await page.click(`text=${NAME}`);
await page.waitForSelector('#product-form');
await page.fill('#f-price', '39,90');
await page.click('#product-form button[type="submit"]');
await page.waitForFunction(() => location.hash === '#/productos');
await page.waitForSelector('text=39,90');
step('edición de precio');

// Validación: precio vacío
await page.click(`text=${NAME}`);
await page.waitForSelector('#product-form');
await page.fill('#f-price', '');
await page.click('#product-form button[type="submit"]');
await page.waitForSelector('[data-field="price"].has-error');
step('validación de precio obligatorio');

// Comprobar que aparece en la tienda pública (índice actualizado por el trigger)
// El catálogo tiene caché de 30 s en memoria (y de minutos en la CDN real): reintentamos.
let created;
for (let i = 0; i < 25 && !created; i++) {
  const catalog = await (await page.request.get(`${BASE}/api/catalog?t=${Date.now()}`)).json();
  created = catalog.products.find((p) => p.name === NAME && p.price === 3990);
  if (!created) await page.waitForTimeout(2000);
}
assert.ok(created, 'la pieza nueva aparece en el catálogo público');
assert.equal(created.price, 3990);
assert.ok(created.img.includes('-sm.'), 'la foto pequeña está en el índice');
step('la pieza aparece en /api/catalog con precio y foto');

// Borrado
await page.click('[data-delete]');
await page.locator('dialog[open] button[type="submit"]').click();
await page.waitForFunction(() => location.hash === '#/productos');
assert.equal(await page.locator(`text=${NAME}`).count(), 0);
step('borrado de pieza');

// Cierre de sesión
await page.click('#logout');
await page.waitForSelector('#login-form');
step('cierre de sesión');

await browser.close();
if (errors.length) {
  console.error('\nErrores en consola:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nPanel: todas las comprobaciones OK');
