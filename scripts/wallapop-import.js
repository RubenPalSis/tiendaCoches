// Importa el catálogo público de un vendedor de Wallapop a la tienda.
//
//   1) Descargar anuncios y fotos (no toca la tienda):
//        node scripts/wallapop-import.js fetch <id-usuario-wallapop>
//      → data/wallapop/items.json + data/wallapop/images/
//
//   Versión estática (GitHub Pages): node scripts/wallapop-import.js demo → demo/
//
//   2) Importar a Firestore + Storage (emulador por defecto):
//        node scripts/wallapop-import.js import
//      Producción: ver docs/puesta-en-produccion.md («Importar el catálogo de Wallapop»).
//
// Usa solo los datos públicos de los anuncios del propio cliente. Los productos ya importados no se
// sobrescriben (se respetan los cambios hechos en el panel) salvo con --force.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productSlug, slugify } from '../public/js/shared/slug.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data/wallapop');
const API = 'https://api.wallapop.com/api/v3';
const HEADERS = { Accept: 'application/json', 'X-DeviceOS': '0', 'Accept-Language': 'es-ES', 'User-Agent': 'Mozilla/5.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Categorías y extracción de datos ----------
export const CATEGORIES = [
  { id: 'lips-spoilers', name: 'Lips y spoilers', order: 1, description: 'Lips, labios y spoilers delanteros, alerones y spoilers traseros para dar un aspecto deportivo a tu coche.', match: /\b(lip|labio|splitter|spoiler|aler[oó]n|fald[oó]n delantero)/i },
  { id: 'difusores', name: 'Difusores y paragolpes', order: 2, description: 'Difusores traseros y paragolpes deportivos.', match: /\b(difusor|paragolpes|parachoques)/i },
  { id: 'taloneras', name: 'Taloneras y body kits', order: 3, description: 'Taloneras, faldones laterales y body kits completos.', match: /\b(talonera|fald[oó]n|faldones|body ?kit|kit (de )?carrocer)/i },
  { id: 'parrillas', name: 'Parrillas y calandras', order: 4, description: 'Parrillas, calandras y rejillas deportivas.', match: /\b(parrilla|calandra|rejilla|ri[ñn]ones)/i },
  { id: 'escapes', name: 'Embellecedores de escape', order: 5, description: 'Colas y embellecedores de escape.', match: /\b(escape|cola|colas|embellecedor|puntera|tubo)/i },
  { id: 'accesorios-exterior', name: 'Accesorios exterior', order: 6, description: 'Carcasas de retrovisor, aletas y otros accesorios exteriores.', match: /.*/ },
];

const BRANDS = [
  ['BMW', /\bbmw\b/i], ['Seat', /\bseat\b/i], ['Cupra', /\bcupra\b/i], ['Audi', /\baudi\b/i],
  ['Volkswagen', /\b(volkswagen|vw)\b/i], ['Mercedes-Benz', /\bmercedes\b/i], ['Skoda', /\bskoda\b/i],
  ['Ford', /\bford\b/i], ['Renault', /\brenault\b/i], ['Peugeot', /\bpeugeot\b/i], ['Opel', /\bopel\b/i],
  ['Toyota', /\btoyota\b/i], ['Honda', /\bhonda\b/i], ['Mini', /\bmini\b/i], ['Hyundai', /\bhyundai\b/i],
  ['Kia', /\bkia\b/i], ['Citroën', /\bcitro[eë]n\b/i], ['Fiat', /\bfiat\b/i], ['Nissan', /\bnissan\b/i],
  ['Tesla', /\btesla\b/i],
];
// Modelos que identifican la marca aunque no aparezca (p. ej. «Golf GTI», «F10-F11», «M5 E60»).
const MODEL_HINTS = [
  ['Volkswagen', /\b(golf|polo|passat|scirocco)\b/i],
  ['BMW', /\b(serie \d|[EFG]\d{2}(?:-[EFG]?\d{2})?|M[2-8])\b/i],
];
// Palabras que describen acabado/material y no forman parte del modelo.
const MODEL_STOP = /\s+(?:pack|para|con|look|tipo|estilo|estylo|xxl|v\d|negro|piano|black|brillo|brillante|abs|doble|1 pieza|\d{4}(?:-\d{2,4})?|\(|\+).*$/i;

export function categorize(title) {
  return CATEGORIES.find((c) => c.match.test(title)).id;
}

const cleanModel = (text) => text.replace(/\s*\/\s*/g, ' / ').replace(MODEL_STOP, '').replace(/\s+/g, ' ').trim().slice(0, 60);

export function extractBrandModel(title) {
  for (const [brand, re] of BRANDS) {
    const m = title.match(new RegExp(`${re.source}\\s+(.+)`, 'i'));
    if (m) return { brand, model: cleanModel(m[m.length - 1]) };
  }
  for (const [brand, re] of MODEL_HINTS) {
    const m = title.match(re);
    if (m) return { brand, model: cleanModel(title.slice(m.index)) };
  }
  return { brand: '', model: '' };
}

/** Anuncios que no son accesorios (p. ej. un coche entero a la venta). */
export const isAccessory = (it) => it.price <= 200000;

const PICTO = /\p{Extended_Pictographic}️?/gu;

/** Limpia la descripción: emojis, avisos propios de Wallapop y el final truncado por Wallapop. */
export function cleanDescription(text) {
  let lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const truncated = text.length >= 600; // Wallapop corta las descripciones largas
  if (truncated) lines = lines.slice(0, -1);
  lines = lines
    .map((l) => l.replace(/^\s*🔹\s*/u, '• ').replace(PICTO, '').replace(/\s+/g, ' ').trim())
    .filter((l) => !/consultar stock|env[ií]os? a toda espa|wallapop|mivotunning \|/i.test(l));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractCompatibility(description) {
  const m = description.match(/compatible con:?[ \t]*\n((?:[ \t]*•.*(?:\n|$))+)/i);
  return m ? m[1].split('\n').map((l) => l.replace(/^\s*•\s*/, '').trim()).filter(Boolean).join('\n') : '';
}

// ---------- 1) Descarga ----------
async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${url}`);
    await sleep(1500 * attempt);
  }
}

async function fetchCatalog(userId) {
  mkdirSync(join(DATA, 'images'), { recursive: true });
  const user = await getJson(`${API}/users/${userId}`);
  const list = [];
  let next = '';
  do {
    const page = await getJson(`${API}/users/${userId}/items${next ? `?since=${encodeURIComponent(next)}` : ''}`);
    list.push(...page.data);
    next = page.meta?.next ?? '';
    await sleep(400);
  } while (next);
  console.log(`${list.length} anuncios de «${user.micro_name}»`);

  const items = [];
  for (const [i, summary] of list.entries()) {
    const detail = await getJson(`${API}/items/${summary.id}`);
    const images = [];
    for (const [n, img] of (detail.images ?? summary.images ?? []).entries()) {
      const url = (img.urls?.big ?? img.urls_by_size?.big ?? '').replace(/pictureSize=W\d+/, 'pictureSize=W1024');
      if (!url) continue;
      const file = `${summary.id}-${n + 1}.jpg`;
      if (!existsSync(join(DATA, 'images', file))) {
        const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
        if (res.ok) writeFileSync(join(DATA, 'images', file), Buffer.from(await res.arrayBuffer()));
      }
      images.push(file);
    }
    items.push({
      wallapopId: summary.id,
      title: detail.title?.original ?? summary.title,
      description: detail.description?.original ?? summary.description ?? '',
      price: Math.round((detail.price?.cash?.amount ?? summary.price?.amount ?? 0) * 100),
      condition: detail.type_attributes?.condition?.value ?? 'new',
      upToKg: parseFloat(detail.type_attributes?.up_to_kg?.value ?? '0') || 0,
      modified: (detail.modified_date ?? 0) * 1000,
      url: detail.share_url,
      images,
    });
    process.stdout.write(`\r${i + 1}/${list.length}`);
    await sleep(250);
  }
  const avatar = user.image?.urls_by_size?.original;
  if (avatar) {
    const res = await fetch(avatar.replace(/pictureSize=W\d+/, 'pictureSize=W1024'));
    if (res.ok) writeFileSync(join(DATA, 'avatar.jpg'), Buffer.from(await res.arrayBuffer()));
  }
  writeFileSync(join(DATA, 'items.json'), JSON.stringify({ user: { id: user.id, name: user.micro_name }, fetchedAt: new Date().toISOString(), items }, null, 2));
  console.log(`\n✔ Guardado en data/wallapop/ (${items.length} productos, ${items.reduce((s, it) => s + it.images.length, 0)} fotos)`);
}

// ---------- 2) Importación ----------
const CONDITION = { new: 'new', as_good_as_new: 'used', good: 'used', fair: 'used', has_given_it_all: 'used', un_opened: 'new' };
const SIZES = { sm: 400, md: 800, lg: 1600 };

async function importCatalog({ force, bucketName }) {
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const { getStorage } = await import('firebase-admin/storage');
  const sharp = (await import('sharp')).default;

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.GCLOUD_PROJECT || (emulator ? 'demo-tienda' : undefined);
  if (!projectId) throw new Error('Indica el proyecto: GCLOUD_PROJECT=mi-proyecto');
  const bucket = bucketName || (emulator ? `${projectId}.appspot.com` : `${projectId}.firebasestorage.app`);
  initializeApp({ projectId, storageBucket: bucket });
  const db = getFirestore();
  const storage = getStorage().bucket();
  const storageHost = emulator ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : 'https://firebasestorage.googleapis.com';
  const publicUrl = (path) => `${storageHost}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;

  const all = JSON.parse(readFileSync(join(DATA, 'items.json'), 'utf8')).items;
  const items = all.filter(isAccessory);
  all.filter((it) => !isAccessory(it)).forEach((it) => console.log(`· Omitido (no es un accesorio): ${it.title}`));
  console.log(`Importando ${items.length} productos en ${projectId}${emulator ? ' (EMULADOR)' : ''}…`);

  const used = new Set(items.map((it) => categorize(it.title)));
  for (const c of CATEGORIES.filter((x) => used.has(x.id))) {
    const ref = db.doc(`categories/${c.id}`);
    if (!(await ref.get()).exists) {
      await ref.set({ name: c.name, slug: c.id, description: c.description, order: c.order, image: '', active: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    }
  }

  let created = 0;
  let skipped = 0;
  for (const [i, it] of items.entries()) {
    const id = `wallapop${it.wallapopId}`.replace(/[^A-Za-z0-9]/g, '').padEnd(20, '0').slice(0, 20);
    const ref = db.doc(`products/${id}`);
    const existing = await ref.get();
    if (existing.exists && !force) { skipped += 1; continue; }

    const name = it.title.replace(/\s+/g, ' ').trim().slice(0, 150);
    const description = cleanDescription(it.description);
    const { brand, model } = extractBrandModel(name);
    const images = [];
    for (const [n, file] of it.images.slice(0, 8).entries()) {
      const source = readFileSync(join(DATA, 'images', file));
      const base = `${slugify(name, 50)}-${n + 1}`;
      const out = { paths: {} };
      for (const [size, width] of Object.entries(SIZES)) {
        const buffer = await sharp(source).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 }).toBuffer();
        const path = `products/${id}/${base}-${size}.webp`;
        await storage.file(path).save(buffer, { contentType: 'image/webp', metadata: { cacheControl: 'public, max-age=31536000, immutable' } });
        out[size] = publicUrl(path);
        out.paths[size] = path;
      }
      images.push(out);
    }

    const now = Timestamp.now();
    await ref.set({
      name,
      slug: productSlug(name, id),
      description,
      reference: '',
      brand,
      model,
      compatibility: extractCompatibility(description),
      categoryId: categorize(name),
      price: it.price,
      comparePrice: null,
      stock: existing.exists ? existing.data().stock : 1,
      reserved: existing.exists ? existing.data().reserved ?? 0 : 0,
      soldCount: existing.exists ? existing.data().soldCount ?? 0 : 0,
      weight: Math.round((it.upToKg || 2) * 1000),
      images,
      active: true,
      featured: false,
      condition: CONDITION[it.condition] ?? 'new',
      conditionNotes: '',
      createdAt: existing.exists ? existing.data().createdAt : Timestamp.fromMillis(it.modified || Date.now() - i * 60_000),
      updatedAt: now,
    });
    created += 1;
    process.stdout.write(`\r${i + 1}/${items.length}`);
  }
  console.log(`\n✔ ${created} productos importados, ${skipped} ya existían (usa --force para reimportarlos).`);
}

// ---------- 3) Catálogo estático para GitHub Pages ----------
const productId = (it) => `wallapop${it.wallapopId}`.replace(/[^A-Za-z0-9]/g, '').padEnd(20, '0').slice(0, 20);

function productFields(it, i) {
  const name = it.title.replace(/\s+/g, ' ').trim().slice(0, 150);
  const description = cleanDescription(it.description);
  return {
    name,
    description,
    ...extractBrandModel(name),
    reference: '',
    compatibility: extractCompatibility(description),
    categoryId: categorize(name),
    price: it.price,
    comparePrice: null,
    weight: Math.round((it.upToKg || 2) * 1000),
    condition: CONDITION[it.condition] ?? 'new',
    conditionNotes: '',
    featured: false,
    active: true,
    createdAt: it.modified || Date.now() - i * 60_000,
  };
}

/** Escribe demo/ (productos, categorías y fotos WebP) para la versión estática. */
async function exportDemo() {
  const sharp = (await import('sharp')).default;
  const OUT = join(ROOT, 'demo');
  mkdirSync(join(OUT, 'img'), { recursive: true });
  const items = JSON.parse(readFileSync(join(DATA, 'items.json'), 'utf8')).items.filter(isAccessory);
  const products = [];
  for (const [i, it] of items.entries()) {
    const id = productId(it);
    const fields = productFields(it, i);
    const images = [];
    for (const [n, file] of it.images.slice(0, 6).entries()) {
      const source = readFileSync(join(DATA, 'images', file));
      const base = `${slugify(fields.name, 40)}-${id.slice(-6)}-${n + 1}`;
      for (const [size, width] of [['sm', 400], ['md', 800]]) {
        const target = join(OUT, 'img', `${base}-${size}.webp`);
        if (!existsSync(target)) {
          await sharp(source).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).webp({ quality: size === 'sm' ? 74 : 78 }).toFile(target);
        }
      }
      // En la demo la foto grande es la de 800 px (Wallapop no ofrece más resolución).
      images.push({ sm: `/demo/img/${base}-sm.webp`, md: `/demo/img/${base}-md.webp`, lg: `/demo/img/${base}-md.webp` });
    }
    products.push({ id, slug: productSlug(fields.name, id), ...fields, stock: 1, reserved: 0, soldCount: 0, images });
    process.stdout.write(`\r${i + 1}/${items.length}`);
  }
  // Destacados por defecto: los 8 más recientes (se cambian desde el panel).
  [...products].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).forEach((p) => { p.featured = true; });
  const used = new Set(products.map((p) => p.categoryId));
  const categories = CATEGORIES.filter((c) => used.has(c.id)).map(({ match, ...c }) => ({ ...c, slug: c.id, image: '', active: true }));
  writeFileSync(join(OUT, 'products.json'), JSON.stringify(products, null, 1));
  writeFileSync(join(OUT, 'categories.json'), JSON.stringify(categories, null, 1));
  console.log(`\n✔ demo/: ${products.length} productos, ${categories.length} categorías`);
}

// ---------- CLI ----------
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'fetch' && arg) await fetchCatalog(arg);
else if (cmd === 'demo') await exportDemo();
else if (cmd === 'import') {
  const bucketArg = process.argv.find((a) => a.startsWith('--bucket='));
  await importCatalog({ force: process.argv.includes('--force'), bucketName: bucketArg?.split('=')[1] });
} else if (cmd) {
  console.log('Uso:\n  node scripts/wallapop-import.js fetch <id-usuario>\n  node scripts/wallapop-import.js import [--force] [--bucket=nombre]\n  node scripts/wallapop-import.js demo   (catálogo estático para GitHub Pages)');
}
