// Acceso a datos del panel con caché en memoria durante la sesión (menos lecturas de Firestore).
import { db, fs } from './firebase.js';

let productsCache = null;
let categoriesCache = null;

export async function listProducts({ fresh = false } = {}) {
  if (productsCache && !fresh) return productsCache;
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'products'), fs.orderBy('createdAt', 'desc')));
  productsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return productsCache;
}

export async function getProduct(id) {
  const cached = productsCache?.find((p) => p.id === id);
  if (cached) return cached;
  const snap = await fs.getDoc(fs.doc(db, 'products', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function updateProductCache(product) {
  if (!productsCache) return;
  const i = productsCache.findIndex((p) => p.id === product.id);
  if (i >= 0) productsCache[i] = { ...productsCache[i], ...product };
  else productsCache.unshift(product);
}

export function removeFromProductCache(id) {
  if (productsCache) productsCache = productsCache.filter((p) => p.id !== id);
}

export async function listCategories({ fresh = false } = {}) {
  if (categoriesCache && !fresh) return categoriesCache;
  const snap = await fs.getDocs(fs.collection(db, 'categories'));
  categoriesCache = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'es'));
  return categoriesCache;
}

export const invalidateCategories = () => { categoriesCache = null; };

export async function getSettingsDoc(name) {
  const snap = await fs.getDoc(fs.doc(db, 'settings', name));
  return snap.exists() ? snap.data() : null;
}

export const saveSettingsDoc = (name, data) => fs.setDoc(fs.doc(db, 'settings', name), data);
