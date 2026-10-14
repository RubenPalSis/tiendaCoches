// Importa el catálogo público de un vendedor de Wallapop a la tienda.
//
//   1) Descargar anuncios y fotos (no toca la tienda):
//        node scripts/wallapop-import.js fetch <id-usuario-wallapop>
//      → data/wallapop/items.json + data/wallapop/images/
//
//   Versión estática (GitHub Pages): node scripts/wallapop-import.js demo → demo/
//
//   2) Importar a Firestore + fotos en Cloudinary (por defecto: emuladores + Worker de `npm run dev`):
//        node scripts/wallapop-import.js import
//      Producción: ver docs/puesta-en-produccion.md («Importar el catálogo de Wallapop»).
//
// Usa solo los datos públicos de los anuncios del propio cliente. Los productos ya importados no se
// sobrescriben (se respetan los cambios hechos en el panel) salvo con --force.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { productSlug, slugify } from '../public/js/shared/slug.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data/wallapop');
const API = 'https://api.wallapop.com/api/v3';
const HEADERS = { Accept: 'application/json', 'X-DeviceOS': '0', 'Accept-Language': 'es-ES', 'User-Agent': 'Mozilla/5.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Categorías y extracción de datos ----------
// Categorías que pidió el cliente, en su orden. Se asigna la primera que encaje con el título
// (por eso «Lip + taloneras» va a Lip); lo que no encaja en ninguna va a Universales.
export const CATEGORIES = [
  { id: 'lip', name: 'Lip', order: 1, description: 'Lips, labios y splitters delanteros para dar un aspecto deportivo a tu coche.', match: /\b(lip|labio|splitter)/i },
  { id: 'alerones', name: 'Alerones', order: 2, description: 'Alerones y spoilers traseros de maletero y de luna.', match: /\b(aler[oó]n|spoiler)/i },
  { id: 'difusores', name: 'Difusores', order: 4, description: 'Difusores traseros deportivos.', match: /\bdifusor/i },
  { id: 'parrillas-calandras', name: 'Parrillas y calandras', order: 9, description: 'Parrillas, calandras, riñones y rejillas deportivas.', match: /\b(parrilla|calandra|rejilla|ri[ñn]ones)/i },
  { id: 'tapas-espejos', name: 'Tapas de espejos', order: 8, description: 'Tapas y carcasas de retrovisor.', match: /\b(espejo|retrovisor)/i },
  { id: 'colas-escape', name: 'Colas de escape', order: 7, description: 'Colas, puntas y embellecedores de escape.', match: /\b(escape|colas?\b|puntera)/i },
  { id: 'bodykit-paragolpes', name: 'Bodykit y paragolpes', order: 3, description: 'Paragolpes deportivos y body kits completos.', match: /\b(paragolpes|parachoques|body ?kit|kit (de )?carrocer)/i },
  { id: 'taloneras', name: 'Añadidos y taloneras', order: 5, description: 'Añadidos, taloneras y faldones laterales.', match: /\b(talonera|añadido|fald[oó]n|faldones)/i },
  { id: 'universales', name: 'Universales', order: 6, description: 'Accesorios universales que sirven para cualquier coche.', match: /.*/ },
];

// Marcas que trabaja el cliente (apartado «Marcas» de la tienda: ver CAR_BRANDS). Las demás se
// conservan tal cual; lo que no es de ninguna marca se marca como «Universal».
const BRANDS = [
  ['BMW', /\bbmw\b/i], ['Seat', /\b(seat|cupra)\b/i], ['Audi', /\baudi\b/i],
  ['Volkswagen', /\b(volkswagen|vw)\b/i], ['Mercedes', /\bmercedes(?:-benz)?\b/i], ['Skoda', /\bskoda\b/i],
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
  return { brand: 'Universal', model: '' };
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

const sized = (url, width) => url.replace('/upload/', `/upload/c_limit,w_${width}/`);

/** Sube una foto a Cloudinary (producción) o al almacén simulado del Worker de desarrollo. */
async function uploader(emulator) {
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret, CLOUDINARY_FOLDER: folder = 'tienda' } = process.env;
  if (emulator) {
    const worker = process.env.BASE_URL || 'http://127.0.0.1:5000';
    return async (publicId, buffer) => {
      const form = new FormData();
      form.append('public_id', `${folder}/${publicId}`);
      form.append('file', new Blob([buffer], { type: 'image/webp' }), 'foto.webp');
      const res = await fetch(`${worker}/dev-media/upload`, { method: 'POST', body: form }).catch(() => null);
      if (!res?.ok) throw new Error(`No se pudo subir la foto al Worker de desarrollo (${worker}). ¿Está en marcha \`npm run dev\`?`);
      return res.json();
    };
  }
  if (!cloud || !key || !secret) throw new Error('Faltan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET.');
  const { cloudinarySignature } = await import('../server/src/media/media.js');
  return async (publicId, buffer) => {
    const params = { public_id: `${folder}/${publicId}`, timestamp: Math.floor(Date.now() / 1000), overwrite: 'true' };
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...params, api_key: key, signature: await cloudinarySignature(params, secret) })) form.append(k, String(v));
    form.append('file', new Blob([buffer], { type: 'image/webp' }), 'foto.webp');
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(`Cloudinary: ${data.error?.message ?? res.status}`);
    return data;
  };
}

async function importCatalog({ force }) {
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const sharp = (await import('sharp')).default;

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.GCLOUD_PROJECT || (emulator ? 'demo-tienda' : undefined);
  if (!projectId) throw new Error('Indica el proyecto: GCLOUD_PROJECT=mi-proyecto');
  process.env.GCLOUD_PROJECT = projectId;
  initializeApp({ projectId });
  const db = getFirestore();
  const upload = await uploader(emulator);

  const all = JSON.parse(readFileSync(join(DATA, 'items.json'), 'utf8')).items;
  const items = all.filter(isAccessory);
  all.filter((it) => !isAccessory(it)).forEach((it) => console.log(`· Omitido (no es un accesorio): ${it.title}`));
  console.log(`Importando ${items.length} productos en ${projectId}${emulator ? ' (EMULADOR)' : ''}…`);

  for (const c of CATEGORIES) {
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
      const buffer = await sharp(source).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 }).toBuffer();
      const { secure_url: url, public_id: publicId } = await upload(`products/${id}/${slugify(name, 50)}-${n + 1}`, buffer);
      images.push({ sm: sized(url, 400), md: sized(url, 800), lg: url, publicId });
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

  // Índice público del catálogo. En producción el servidor usa la cuenta de servicio: se toma del
  // mismo archivo que GOOGLE_APPLICATION_CREDENTIALS (si no, la tarea horaria lo reconstruirá).
  if (!emulator && !process.env.FIREBASE_SERVICE_ACCOUNT && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.FIREBASE_SERVICE_ACCOUNT = readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
  }
  const { rebuildIndex } = await import('../server/src/catalog/catalog-index.js');
  console.log(`✔ Índice del catálogo: ${(await rebuildIndex()).products} productos visibles.`);
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
  // Todas las categorías, aunque aún no tengan productos: el cliente las quiere visibles desde el principio.
  const categories = [...CATEGORIES].sort((a, b) => a.order - b.order).map(({ match, ...c }) => ({ ...c, slug: c.id, image: '', active: true }));
  writeFileSync(join(OUT, 'products.json'), JSON.stringify(products, null, 1));
  writeFileSync(join(OUT, 'categories.json'), JSON.stringify(categories, null, 1));
  console.log(`\n✔ demo/: ${products.length} productos, ${categories.length} categorías`);
}

// ---------- CLI ----------
// Solo al ejecutarlo directamente (scripts/update-categories.js importa las categorías de aquí).
const [cmd, arg] = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href ? process.argv.slice(2) : [];
if (cmd === 'fetch' && arg) await fetchCatalog(arg);
else if (cmd === 'demo') await exportDemo();
else if (cmd === 'import') await importCatalog({ force: process.argv.includes('--force') }); else if (cmd) {
  console.log('Uso:\n  node scripts/wallapop-import.js fetch <id-usuario>\n  node scripts/wallapop-import.js import [--force]\n  node scripts/wallapop-import.js demo   (catálogo estático para GitHub Pages)');
}
