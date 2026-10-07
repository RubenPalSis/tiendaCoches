// Reglas de Firestore y Storage contra el emulador.
// Uso: npm test (arranca emuladores) o con emuladores ya en marcha: node --test tests/rules/
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

let env;
const PRODUCT_ID = 'AbCdEfGhIjKlMnOpQrSt';

const validProduct = (over = {}) => ({
  name: 'Faro delantero', slug: `faro-delantero-${PRODUCT_ID}`, price: 5000, comparePrice: null, stock: 1,
  reserved: 0, soldCount: 0, weight: 2000, images: [], active: true, featured: false, condition: 'used',
  description: '', reference: '', brand: '', model: '', compatibility: '', conditionNotes: '', categoryId: '',
  createdAt: Timestamp.now(), updatedAt: serverTimestamp(), ...over,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-tienda-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
after(() => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'products', PRODUCT_ID), { ...validProduct(), updatedAt: Timestamp.now() });
    await setDoc(doc(db, 'orders/o1'), { number: '2026-00001', customer: { email: 'a@b.c' } });
    await setDoc(doc(db, 'settings/store'), { name: 'Tienda' });
    await setDoc(doc(db, 'catalog/index'), { products: [] });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const user = () => env.authenticatedContext('u1', { email: 'cliente@x.com' }).firestore();
const admin = () => env.authenticatedContext('admin1', { admin: true, email: 'admin@x.com' }).firestore();

test('visitante anónimo: no puede leer ni escribir nada en Firestore', async () => {
  await assertFails(getDoc(doc(anon(), 'products', PRODUCT_ID)));
  await assertFails(getDocs(collection(anon(), 'orders')));
  await assertFails(getDoc(doc(anon(), 'settings/store')));
  await assertFails(getDoc(doc(anon(), 'catalog/index')));
  await assertFails(setDoc(doc(anon(), 'products/nuevo'), validProduct()));
  await assertFails(setDoc(doc(anon(), 'orders/x'), { total: 1 }));
});

test('usuario autenticado SIN rol admin: sin acceso', async () => {
  await assertFails(getDoc(doc(user(), 'orders/o1')));
  await assertFails(updateDoc(doc(user(), 'products', PRODUCT_ID), { price: 1, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(user(), 'settings/store'), { name: 'Hack' }));
  await assertFails(deleteDoc(doc(user(), 'products', PRODUCT_ID)));
});

test('admin: gestiona productos, categorías y ajustes', async () => {
  await assertSucceeds(getDoc(doc(admin(), 'products', PRODUCT_ID)));
  await assertSucceeds(setDoc(doc(admin(), 'products/NuevoProducto12345678'), validProduct({ slug: 'otro-NuevoProducto12345678' })));
  await assertSucceeds(updateDoc(doc(admin(), 'products', PRODUCT_ID), { price: 4500, updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(admin(), 'categories/frenos'), {
    name: 'Frenos', slug: 'frenos', description: '', order: 1, image: '', active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(admin(), 'settings/shipping'), { carrier: 'GLS', zones: [] }));
  await assertSucceeds(getDoc(doc(admin(), 'orders/o1')));
});

test('admin: no puede escribir pedidos, índice ni estadísticas directamente', async () => {
  await assertFails(updateDoc(doc(admin(), 'orders/o1'), { orderStatus: 'shipped' }));
  await assertFails(setDoc(doc(admin(), 'catalog/index'), { products: [] }));
  await assertFails(setDoc(doc(admin(), 'statistics/day_2026-01-01'), { orders: 1 }));
  await assertFails(setDoc(doc(admin(), 'settings/otro'), { a: 1 }));
});

test('admin: validación de datos del producto', async () => {
  const db = admin();
  await assertFails(updateDoc(doc(db, 'products', PRODUCT_ID), { price: -1, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'products', PRODUCT_ID), { price: 10.5, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'products', PRODUCT_ID), { stock: -3, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'products', PRODUCT_ID), { condition: 'roto', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'products', PRODUCT_ID), { hacked: true, updatedAt: serverTimestamp() }));
  // reserved y soldCount solo los cambia el backend
  await assertFails(updateDoc(doc(db, 'products', PRODUCT_ID), { reserved: 5, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'products', PRODUCT_ID), { soldCount: 99, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'products/OtroProducto123456789'), validProduct({ reserved: 2, slug: 'x-OtroProducto123456789' })));
});

test('admin: no puede borrar un producto con unidades reservadas en un pago', async () => {
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'products', PRODUCT_ID), { reserved: 1 }));
  await assertFails(deleteDoc(doc(admin(), 'products', PRODUCT_ID)));
});

test('Storage: lectura pública de fotos, escritura solo admin y solo imágenes', async () => {
  const img = new Uint8Array([137, 80, 78, 71]);
  const adminSt = env.authenticatedContext('admin1', { admin: true }).storage();
  const userSt = env.authenticatedContext('u1').storage();
  const anonSt = env.unauthenticatedContext().storage();
  await assertSucceeds(uploadBytes(ref(adminSt, 'products/p1/foto-sm.webp'), img, { contentType: 'image/webp' }));
  await assertSucceeds(getBytes(ref(anonSt, 'products/p1/foto-sm.webp')));
  await assertFails(uploadBytes(ref(anonSt, 'products/p1/hack.webp'), img, { contentType: 'image/webp' }));
  await assertFails(uploadBytes(ref(userSt, 'products/p1/hack.webp'), img, { contentType: 'image/webp' }));
  await assertFails(uploadBytes(ref(adminSt, 'products/p1/script.html'), img, { contentType: 'text/html' }));
  await assertFails(uploadBytes(ref(adminSt, 'otros/archivo.webp'), img, { contentType: 'image/webp' }));
});
