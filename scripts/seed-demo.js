// Datos de demostración para los EMULADORES (nunca contra producción).
// Uso: con `npm run dev` en marcha, ejecutar `npm run seed` en otra terminal.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199';
const projectId = process.env.GCLOUD_PROJECT || 'demo-tienda';
if (!projectId.startsWith('demo-')) {
  console.error('Este script solo se ejecuta contra proyectos demo de los emuladores.');
  process.exit(1);
}

initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();

const ADMIN = { email: 'admin@demo.test', password: 'demo1234' };

// Catálogo real de la tienda (demo/, generado desde Wallapop con scripts/wallapop-import.js demo).
const demo = (f) => JSON.parse(readFileSync(join(ROOT, 'demo', f), 'utf8'));
const settings = demo('settings.json');
const categories = demo('categories.json');
const products = demo('products.json');

async function main() {
  const now = Timestamp.now();
  // Solo emulador: se borra el catálogo anterior para empezar limpio.
  for (const col of ['products', 'categories']) await db.recursiveDelete(db.collection(col));

  const batch = db.batch();
  for (const c of categories) {
    batch.set(db.doc(`categories/${c.id}`), { name: c.name, slug: c.slug, description: c.description, order: c.order, image: '', active: true, createdAt: now, updatedAt: now });
  }

  // Fotos al emulador de Storage (mismas URLs que usaría el panel).
  const url = (path) => `http://127.0.0.1:9199/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
  for (const p of products) {
    const images = [];
    for (const img of p.images) {
      const out = { paths: {} };
      for (const size of ['sm', 'md', 'lg']) {
        const file = img[size].replace('/demo/img/', '');
        const path = `products/${p.id}/${file.replace(/-md\.webp$/, size === 'lg' ? '-lg.webp' : '-md.webp')}`;
        await bucket.file(path).save(readFileSync(join(ROOT, 'demo/img', file)), { contentType: 'image/webp', metadata: { cacheControl: 'public, max-age=31536000' } });
        out[size] = url(path);
        out.paths[size] = path;
      }
      images.push(out);
    }
    const { id, createdAt, ...rest } = p;
    batch.set(db.doc(`products/${id}`), { ...rest, images, createdAt: Timestamp.fromMillis(createdAt), updatedAt: now });
  }

  batch.set(db.doc('settings/store'), {
    ...settings.store,
    ownerName: 'Nombre Apellido (DEMO)', taxId: '00000000T', address: 'Calle Ejemplo 1, 09400 Aranda de Duero (Burgos)',
    email: 'tienda@demo.test', phone: '600 000 000', whatsapp: '600000000', usedWarranty: '1 año',
    notificationEmail: 'tienda@demo.test', emailFrom: 'tienda@demo.test',
  });
  // Tarifas de EJEMPLO para probar en local (las reales se configuran en el panel).
  batch.set(db.doc('settings/shipping'), {
    carrier: 'GLS',
    defaultWeight: 2000,
    trackingUrlTemplate: '',
    zones: [
      { id: 'peninsula', name: 'Península', active: true, countries: ['ES'], postalPrefixes: [], excludePostalPrefixes: ['07', '35', '38', '51', '52'],
        rates: [{ maxWeight: 2000, price: 595 }, { maxWeight: 5000, price: 795 }, { maxWeight: 10000, price: 995 }, { maxWeight: 20000, price: 1495 }, { maxWeight: 30000, price: 1895 }],
        freeOver: 15000, deliveryTime: '24–72 h laborables' },
      { id: 'portugal', name: 'Portugal', active: true, countries: ['PT'], postalPrefixes: [], excludePostalPrefixes: [],
        rates: [{ maxWeight: 5000, price: 1295 }, { maxWeight: 20000, price: 2295 }, { maxWeight: 30000, price: 2995 }],
        freeOver: 0, deliveryTime: '48–96 h laborables' },
    ],
  });
  batch.set(db.doc('settings/checkout'), { enabled: true, closedMessage: 'La tienda está cerrada temporalmente.', maxQtyPerLine: 10, termsVersion: '1' });
  await batch.commit();

  let user;
  try { user = await auth.getUserByEmail(ADMIN.email); } catch { user = await auth.createUser(ADMIN); }
  await auth.setCustomUserClaims(user.uid, { admin: true });

  console.log(`✔ ${categories.length} categorías, ${products.length} productos de Mivotunning y configuración de prueba creados.`);
  console.log(`✔ Admin de prueba: ${ADMIN.email} / ${ADMIN.password} (solo emulador)`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
