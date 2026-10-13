// Carga en Firebase (producción) el catálogo de Mivotunning ya preparado en demo/: categorías,
// productos de Wallapop y textos de la tienda. Las fotos se sirven desde la propia web (/media/catalogo,
// ver scripts/copy-shared.js), así que no hace falta Cloudinary para este catálogo inicial.
//
// Uso (con una clave de cuenta de servicio TEMPORAL; bórrala al terminar):
//   node scripts/import-catalog.js ruta/clave.json [--force]
// No sobrescribe productos ni ajustes ya existentes (se respetan los cambios del panel) salvo con --force.
// Nunca toca envíos ni datos legales: esos los pone el vendedor en el panel.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [keyPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const force = process.argv.includes('--force');
if (!keyPath) {
  console.error('Uso: node scripts/import-catalog.js ruta/clave-cuenta-servicio.json [--force]');
  process.exit(1);
}

// El servidor de la tienda (server/) usa la misma cuenta de servicio para escribir en Firestore.
const key = readFileSync(keyPath, 'utf8');
process.env.FIREBASE_SERVICE_ACCOUNT = key;
if (!process.argv.includes('--emulator')) delete process.env.FIRESTORE_EMULATOR_HOST; // --emulator: solo para probar el script
const projectId = JSON.parse(key).project_id;
const { db, Timestamp } = await import('../server/src/lib/firebase.js');
const { rebuildIndex } = await import('../server/src/catalog/catalog-index.js');

const demo = (f) => JSON.parse(readFileSync(join(ROOT, 'demo', f), 'utf8'));
const media = (url) => url.replace('/demo/img/', '/media/catalogo/');
const now = Timestamp.now();

console.log(`Importando el catálogo en ${projectId}…`);

let categories = 0;
for (const c of demo('categories.json')) {
  const ref = db.doc(`categories/${c.id}`);
  if ((await ref.get()).exists && !force) continue;
  await ref.set({ name: c.name, slug: c.slug, description: c.description, order: c.order, image: '', active: true, createdAt: now, updatedAt: now });
  categories += 1;
}

let created = 0;
let skipped = 0;
for (const p of demo('products.json')) {
  const ref = db.doc(`products/${p.id}`);
  const existing = await ref.get();
  if (existing.exists && !force) { skipped += 1; continue; }
  const { id, createdAt, images, ...rest } = p;
  await ref.set({
    ...rest,
    images: images.map((img) => ({ sm: media(img.sm), md: media(img.md), lg: media(img.lg) })),
    // Se conservan stock, reservas y ventas si el producto ya existía.
    stock: existing.exists ? existing.data().stock : rest.stock,
    reserved: existing.exists ? existing.data().reserved ?? 0 : 0,
    soldCount: existing.exists ? existing.data().soldCount ?? 0 : 0,
    createdAt: existing.exists ? existing.data().createdAt : Timestamp.fromMillis(createdAt),
    updatedAt: now,
  });
  created += 1;
  process.stdout.write(`\r${created + skipped} productos revisados`);
}

// Nombre, textos, logo y redes de la tienda (solo los campos que aún no existan).
const storeRef = db.doc('settings/store');
const store = (await storeRef.get()).data() ?? {};
const { store: demoStore } = demo('settings.json');
const missing = Object.fromEntries(Object.entries(demoStore).filter(([k, v]) => v !== '' && (force || store[k] === undefined || store[k] === '')));
if (Object.keys(missing).length) await storeRef.set(missing, { merge: true });

const { products } = await rebuildIndex();
console.log(`\n✔ ${categories} categorías y ${created} productos importados (${skipped} ya existían).`);
console.log(`✔ Ajustes de la tienda: ${Object.keys(missing).join(', ') || 'sin cambios'}.`);
console.log(`✔ Índice del catálogo: ${products} productos visibles en la tienda.`);
console.log('\nBorra ahora la clave de la cuenta de servicio de este equipo.');
process.exit(0);
