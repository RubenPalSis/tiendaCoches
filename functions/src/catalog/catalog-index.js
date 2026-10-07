// Índice compacto del catálogo en un único documento (catalog/index).
// Cada visitante descarga este índice (vía /api/catalog, cacheado en la CDN) en lugar de leer
// cada producto: 1 lectura de Firestore por cada fallo de caché, independientemente del nº de productos.
import { logger } from 'firebase-functions';
import { db, FieldValue } from '../lib/firebase.js';
import { getSettings, publicStore } from '../lib/settings.js';
import { toIndexEntry, toCategoryEntry } from '../shared/catalog.js';

export { toIndexEntry, toCategoryEntry };

const INDEX_DOC = 'catalog/index';
const MAX_INDEX_BYTES = 900_000; // límite de Firestore: 1 MiB por documento

const byNewest = (a, b) => b.createdAt - a.createdAt;
const byOrder = (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'es');

function checkSize(products) {
  const bytes = JSON.stringify(products).length;
  if (bytes > MAX_INDEX_BYTES) {
    logger.error(`El índice del catálogo ocupa ${bytes} bytes; hay que dividirlo en varios documentos.`);
  }
}

/** Actualiza una sola entrada del índice (2 lecturas + 1 escritura). */
export async function upsertProductInIndex(id) {
  await db.runTransaction(async (tx) => {
    const ref = db.doc(INDEX_DOC);
    // Se relee el producto (no se usa el snapshot del evento): los eventos pueden llegar desordenados.
    const [snap, productSnap] = await tx.getAll(ref, db.collection('products').doc(id));
    const product = productSnap.exists ? productSnap.data() : null;
    const products = (snap.data()?.products ?? []).filter((p) => p.id !== id);
    if (product?.active) products.push(toIndexEntry(id, product));
    products.sort(byNewest);
    checkSize(products);
    tx.set(ref, { products, updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) }, { merge: true });
  });
}

export async function rebuildCategoriesInIndex() {
  const snap = await db.collection('categories').where('active', '==', true).get();
  const categories = snap.docs.map((d) => toCategoryEntry(d.id, d.data())).sort(byOrder);
  await db.doc(INDEX_DOC).set(
    { categories, updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) },
    { merge: true },
  );
}

/** Reconstrucción completa (botón del panel). Lee todos los productos: usar solo si hace falta. */
export async function rebuildIndex() {
  const snap = await db.collection('products').where('active', '==', true).get();
  const products = snap.docs.map((d) => toIndexEntry(d.id, d.data())).sort(byNewest);
  checkSize(products);
  await db.doc(INDEX_DOC).set(
    { products, updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) },
    { merge: true },
  );
  await rebuildCategoriesInIndex();
  return { products: products.length };
}

let memo = { at: 0, value: null };

/** Índice + configuración pública. Caché en memoria de 30 s (además de la CDN). */
export async function getCatalog() {
  if (memo.value && Date.now() - memo.at < 30_000) return memo.value;
  const [snap, store, shipping, checkout] = await Promise.all([
    db.doc(INDEX_DOC).get(),
    getSettings('store'),
    getSettings('shipping'),
    getSettings('checkout'),
  ]);
  const data = snap.data() ?? {};
  const value = {
    version: data.version ?? 0,
    products: data.products ?? [],
    categories: data.categories ?? [],
    store: publicStore(store),
    shipping: { ...shipping, configured: shipping.configured },
    checkout: { enabled: checkout.enabled, closedMessage: checkout.closedMessage, maxQtyPerLine: checkout.maxQtyPerLine },
  };
  memo = { at: Date.now(), value };
  return value;
}
