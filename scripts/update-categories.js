// Pasa la tienda publicada (producción) a las categorías y marcas que pidió el cliente (2026-10-13):
// crea las categorías de demo/categories.json, recoloca los productos que siguen en una categoría
// antigua, unifica las marcas («Mercedes-Benz» → «Mercedes», sin marca → «Universal») y borra las
// categorías antiguas. Solo toca categoría y marca: precios, fotos, stock y textos no cambian.
//
// Uso (con una clave de cuenta de servicio TEMPORAL; bórrala al terminar):
//   node scripts/update-categories.js ruta/clave.json
// Se puede ejecutar varias veces: la segunda ya no cambia nada.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorize } from './wallapop-import.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [keyPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!keyPath) {
  console.error('Uso: node scripts/update-categories.js ruta/clave-cuenta-servicio.json');
  process.exit(1);
}

const key = readFileSync(keyPath, 'utf8');
process.env.FIREBASE_SERVICE_ACCOUNT = key;
if (!process.argv.includes('--emulator')) delete process.env.FIRESTORE_EMULATOR_HOST; // --emulator: solo para probar el script
const { db, Timestamp } = await import('../server/src/lib/firebase.js');
const { rebuildIndex } = await import('../server/src/catalog/catalog-index.js');

const categories = JSON.parse(readFileSync(join(ROOT, 'demo/categories.json'), 'utf8'));
const ids = new Set(categories.map((c) => c.id));
const now = Timestamp.now();
console.log(`Actualizando categorías en ${JSON.parse(key).project_id}…`);

for (const c of categories) {
  const ref = db.doc(`categories/${c.id}`);
  if ((await ref.get()).exists) continue;
  await ref.set({ name: c.name, slug: c.slug, description: c.description, order: c.order, image: '', active: true, createdAt: now, updatedAt: now });
  console.log(`+ Categoría «${c.name}»`);
}

const normalizeBrand = (brand) => (!brand ? 'Universal' : /^mercedes/i.test(brand) ? 'Mercedes' : /^cupra$/i.test(brand) ? 'Seat' : brand);
let moved = 0;
for (const doc of (await db.collection('products').get()).docs) {
  const p = doc.data();
  const changes = {};
  // Los productos ya colocados en una categoría nueva (p. ej. a mano desde el panel) se respetan.
  if (!ids.has(p.categoryId)) changes.categoryId = categorize(p.name);
  if (normalizeBrand(p.brand) !== p.brand) changes.brand = normalizeBrand(p.brand);
  if (!Object.keys(changes).length) continue;
  await doc.ref.update({ ...changes, updatedAt: now });
  moved += 1;
  console.log(`· ${p.name}: ${Object.entries(changes).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
}

for (const doc of (await db.collection('categories').get()).docs) {
  if (ids.has(doc.id)) continue;
  await doc.ref.delete();
  console.log(`- Categoría antigua «${doc.data().name}» borrada`);
}

const { products } = await rebuildIndex();
console.log(`\n✔ ${moved} productos actualizados. Índice del catálogo: ${products} productos visibles.`);
console.log('\nBorra ahora la clave de la cuenta de servicio de este equipo.');
