// El Worker completo (server/src/worker.js) llamado como lo haría Cloudflare, contra los emuladores:
// rutas, permisos del panel con tokens reales del emulador de Authentication, índice del catálogo,
// fotos y cabeceras de seguridad.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearFirestore, clearAuth, emulatorUser, skipGlsTariff } from './helpers.js';

process.env.GCLOUD_PROJECT = 'demo-tienda-worker';

const { default: worker } = await import('../../server/src/worker.js');
const { db, Timestamp } = await import('../../server/src/lib/firebase.js');
const { SECURITY_HEADERS } = await import('../../server/src/lib/security-headers.js');
const { cloudinarySignature } = await import('../../server/src/media/media.js');
const { formEncode, setStripeForTests } = await import('../../server/src/stripe/client.js');

const ENV = {
  FIREBASE_PROJECT_ID: 'demo-tienda-worker',
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  ADMIN_EMAILS: 'admin@x.es',
  BREVO_API_KEY: 'disabled',
  CLOUDINARY_FOLDER: 'tienda',
  ASSETS: { fetch: async (req) => new Response(`asset ${new URL(req.url).pathname}`) },
};
const ctx = { waitUntil: () => {} };
const call = (path, init = {}, env = ENV) => worker.fetch(new Request(`http://localhost:5000${path}`, init), env, ctx);
const callable = (name, data, idToken, env) => call(`/fn/${name}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
  body: JSON.stringify({ data }),
}, env);

let admin;
let stranger;
before(async () => {
  await clearAuth();
  admin = await emulatorUser('admin@x.es');
  stranger = await emulatorUser('otro@x.es');
});
beforeEach(clearFirestore);

const product = (over = {}) => ({
  name: 'Lip BMW E46', slug: 'lip-bmw-e46-P1', price: 7000, stock: 1, reserved: 0, soldCount: 0, active: true,
  images: [], categoryId: 'lips', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...over,
});

test('rutas: estáticos al almacén de archivos; API, páginas SEO y configuración al Worker', async () => {
  assert.equal(await (await call('/catalogo')).text(), 'asset /catalogo');
  const catalog = await call('/api/catalog');
  assert.equal(catalog.status, 200);
  assert.deepEqual((await catalog.json()).products, []);
  assert.equal((await call('/api/noexiste')).status, 404);
  assert.match(await (await call('/robots.txt')).text(), /Sitemap: http:\/\/localhost:5000\/sitemap.xml/);
  const config = await (await call('/__/firebase/init.json')).json();
  assert.equal(config.projectId, 'demo-tienda-worker');
});

test('todas las respuestas llevan las cabeceras de seguridad, iguales a las de public/_headers', async () => {
  const res = await call('/api/catalog');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(k), v, k);
  const file = readFileSync('public/_headers', 'utf8');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.ok(file.includes(`  ${k}: ${v}\n`), `public/_headers: ${k}`);
});

test('panel: sin sesión, con token falso o sin ser administrador → rechazado', async () => {
  assert.equal((await callable('adminAction', { action: 'rebuildCatalog' })).status, 403);
  assert.equal((await callable('adminAction', { action: 'rebuildCatalog' }, 'a.b.c')).status, 401);
  const res = await callable('adminAction', { action: 'rebuildCatalog' }, stranger.idToken);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.status, 'PERMISSION_DENIED');
});

test('panel: syncAdminClaim da el permiso solo a emails de ADMIN_EMAILS verificados', async () => {
  const res = await (await callable('syncAdminClaim', null, admin.idToken)).json();
  assert.deepEqual(res.result, { admin: true, changed: true });
  const other = await (await callable('syncAdminClaim', null, stranger.idToken)).json();
  assert.equal(other.result.admin, false);
  const unverified = await emulatorUser('admin2@x.es', { verified: false });
  const env = { ...ENV, ADMIN_EMAILS: 'admin@x.es,admin2@x.es' };
  const r2 = await (await callable('syncAdminClaim', null, unverified.idToken, env)).json();
  assert.equal(r2.result.reason, 'email_not_verified');
});

test('panel: tras guardar un producto, syncProducts actualiza el índice público', async () => {
  const token = (await emulatorUser('admin-sync@x.es', { claims: { admin: true } })).idToken;
  const env = { ...ENV, ADMIN_EMAILS: 'admin-sync@x.es' };
  await db.doc('products/P1').set(product());
  const res = await callable('adminAction', { action: 'syncProducts', ids: ['P1'] }, token, env);
  assert.equal(res.status, 200, await res.clone().text());
  let index = await (await call('/api/catalog')).json();
  assert.deepEqual(index.products.map((p) => p.id), ['P1']);

  await db.doc('products/P1').update({ active: false });
  await callable('adminAction', { action: 'syncProducts', ids: ['P1'] }, token, env);
  index = await (await call('/api/catalog')).json();
  assert.equal(index.products.length, 0);
  assert.equal((await callable('adminAction', { action: 'syncProducts', ids: ['../x'] }, token, env)).status, 400);
});

test('el índice refleja el stock al reservar en el checkout (sin disparadores de Firestore)', async () => {
  setStripeForTests({ checkout: { sessions: { async create(p) { return { id: 'cs_1', url: 'https://pay.test', amount_total: p.line_items[0].price_data.unit_amount + p.shipping_options[0].shipping_rate_data.fixed_amount.amount }; } } } });
  await db.doc('settings/shipping').set({ carrier: 'GLS', defaultWeight: 1000, zones: [{ id: 'p', name: 'Península', active: true, countries: ['ES'], postalPrefixes: [], excludePostalPrefixes: [], rates: [{ maxWeight: 30000, price: 500 }], freeOver: 0 }] });
  await skipGlsTariff(db);
  await db.doc('settings/checkout').set({ enabled: true, maxQtyPerLine: 5, termsVersion: '1' });
  const { getSettings } = await import('../../server/src/lib/settings.js');
  await Promise.all(['shipping', 'checkout'].map((n) => getSettings(n, { fresh: true })));
  await db.doc('products/P2').set(product({ slug: 'lip-P2' }));
  await (await import('../../server/src/catalog/catalog-index.js')).rebuildIndex();
  const res = await call('/api/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acceptTerms: true, items: [{ id: 'P2', qty: 1 }], customer: { firstName: 'Ana', lastName: 'Pérez', email: 'ana@x.es', phone: '600111222', dni: '12345678Z', line1: 'Calle 1', postalCode: '28013', city: 'Madrid', province: '', country: 'ES' } }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const index = await (await call('/api/catalog')).json();
  assert.equal(index.products[0].stock, 0);
  assert.equal(index.products[0].reserved, true);
});

test('webhook de Stripe en /stripe/webhook: firma obligatoria', async () => {
  const res = await call('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: '{}' }, { ...ENV, STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  assert.equal(res.status, 400);
});

test('fotos: firma de Cloudinary correcta y solo para administradores', async () => {
  // Ejemplo de la documentación de Cloudinary.
  assert.equal(
    await cloudinarySignature({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 }, 'abcd'),
    'bfd09f95f331f558cbd1320e67aa8d488770583e',
  );
  const token = (await emulatorUser('admin-media@x.es', { claims: { admin: true } })).idToken;
  const env = { ...ENV, ADMIN_EMAILS: 'admin-media@x.es', CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: '123', CLOUDINARY_API_SECRET: 'sec' };
  const res = await (await callable('adminAction', { action: 'mediaUploadParams', folder: 'products/P1', name: 'Lip BMW' }, token, env)).json();
  assert.equal(res.result.uploadUrl, 'https://api.cloudinary.com/v1_1/demo/image/upload');
  assert.match(res.result.fields.public_id, /^tienda\/products\/P1\/lip-bmw-[a-z0-9]+$/);
  const { signature, api_key: apiKey, ...signed } = res.result.fields;
  assert.equal(apiKey, '123');
  assert.equal(signature, await cloudinarySignature(signed, 'sec'));
  const bad = await callable('adminAction', { action: 'mediaUploadParams', folder: '../otra', name: 'x' }, token, env);
  assert.equal(bad.status, 400);
  assert.equal((await callable('adminAction', { action: 'mediaUploadParams', folder: 'store', name: 'x' }, stranger.idToken, env)).status, 403);
  const off = await callable('adminAction', { action: 'mediaUploadParams', folder: 'store', name: 'x' }, token, { ...ENV, ADMIN_EMAILS: 'admin-media@x.es' });
  assert.equal(off.status, 400);
  assert.match((await off.json()).error.message, /Cloudinary/);
});

test('Stripe: los parámetros anidados se codifican como espera su API', () => {
  const body = formEncode({ mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'eur', product_data: { images: ['https://x/a.webp'] } } }], metadata: { orderId: 'O1' }, skip: undefined });
  assert.equal(decodeURIComponent(body.toString()), 'mode=payment&line_items[0][quantity]=1&line_items[0][price_data][currency]=eur&line_items[0][price_data][product_data][images][0]=https://x/a.webp&metadata[orderId]=O1');
});
