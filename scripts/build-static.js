// Genera una versión ESTÁTICA de la tienda para GitHub Pages (vista previa sin Firebase).
//
//   PAGES_BASE=/tiendaCoches SITE_ORIGIN=https://usuario.github.io node scripts/build-static.js
//   node scripts/build-static.js --serve      (genera y sirve en http://localhost:8000/…)
//
// - Catálogo desde demo/ (generado con `node scripts/wallapop-import.js demo`).
// - Páginas de producto y categoría pre-renderizadas con las mismas plantillas que el servidor (SEO).
// - Pagos, pedidos y panel desactivados con un aviso: se activan al desplegar en Firebase.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const SERVE = process.argv.includes('--serve');
const BASE = (process.env.PAGES_BASE ?? (SERVE ? '/tiendaCoches' : '')).replace(/\/$/, '');
const ORIGIN = (process.env.SITE_ORIGIN ?? 'http://localhost:8000').replace(/\/$/, '');
const SITE = ORIGIN + BASE;

execFileSync(process.execPath, [join(ROOT, 'scripts/copy-shared.js')], { stdio: 'ignore' });
const { productPage, categoryPage, notFoundPage } = await import('../functions/src/seo/pages.js');
const { toIndexEntry, toCategoryEntry } = await import('../public/js/shared/catalog.js');
const { productPath, categoryPath } = await import('../public/js/shared/slug.js');

const read = (f) => JSON.parse(readFileSync(join(ROOT, 'demo', f), 'utf8'));
const abs = (url) => (url && url.startsWith('/') ? SITE + url : url);

// ---------- Datos ----------
const settings = read('settings.json');
const store = { ...settings.store, logoUrl: abs(settings.store.logoUrl), ogImage: abs(settings.store.ogImage), heroImage: abs(settings.store.heroImage) };
const shipping = settings.shipping;
const categories = read('categories.json').filter((c) => c.active).sort((a, b) => a.order - b.order);
const products = read('products.json')
  .filter((p) => p.active)
  .map((p) => ({ ...p, images: p.images.map((i) => ({ sm: abs(i.sm), md: abs(i.md), lg: abs(i.lg) })) }));

const index = products.map((p) => toIndexEntry(p.id, p)).sort((a, b) => b.createdAt - a.createdAt);
const catalog = {
  version: Date.now(),
  products: index,
  categories: categories.map((c) => toCategoryEntry(c.id, c)),
  store,
  shipping,
  checkout: { enabled: false, maxQtyPerLine: settings.checkout?.maxQtyPerLine ?? 10, closedMessage: '' },
};

// ---------- Archivos ----------
rmSync(OUT, { recursive: true, force: true });
cpSync(join(ROOT, 'public'), OUT, { recursive: true });
cpSync(join(ROOT, 'demo/img'), join(OUT, 'demo/img'), { recursive: true });
writeFileSync(join(OUT, 'demo/catalog.json'), JSON.stringify(catalog));

const write = (path, content) => {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), content);
};

for (const p of products) {
  const category = catalog.categories.find((c) => c.id === p.categoryId);
  write(`${productPath(p)}.html`, productPage({ origin: SITE, store, product: p, category, shipping }));
}
for (const c of catalog.categories) {
  write(`${categoryPath(c)}.html`, categoryPage({ origin: SITE, store, category: c, products: index.filter((p) => p.categoryId === c.id) }));
}
write('404.html', notFoundPage({ store }));

const staticPaths = ['/', '/catalogo', '/contacto', '/legal/aviso-legal', '/legal/privacidad', '/legal/cookies', '/legal/condiciones', '/legal/envios', '/legal/devoluciones', '/legal/pagos'];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
  ...staticPaths, ...catalog.categories.map(categoryPath), ...products.map(productPath),
].map((p) => `<url><loc>${SITE}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
write('robots.txt', `User-agent: *\nDisallow: ${BASE}/admin/\nDisallow: ${BASE}/carrito\nDisallow: ${BASE}/checkout\nDisallow: ${BASE}/pedido\n\nSitemap: ${SITE}/sitemap.xml\n`);
write('.nojekyll', '');

// El panel necesita Firebase: en la vista previa se muestra un aviso.
write('admin/index.html', `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panel de administración</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/admin.css"></head>
<body class="admin"><div class="login"><div class="login__card"><div class="login__brand"><img src="/assets/img/logo-mark.svg" alt="" width="44" height="44"><div><h1>Panel de la tienda</h1><p>Vista previa en GitHub Pages</p></div></div>
<p>El panel de administración (productos, pedidos, envíos, estadísticas) funcionará cuando la tienda se publique en Firebase.</p><a class="btn btn--primary" href="/">Volver a la tienda</a></div></div></body></html>`);

// ---------- Post-proceso: modo estático + prefijo de GitHub Pages (/repositorio) ----------
const ROOTS = 'css|js|assets|demo|catalogo|carrito|checkout|pedido|contacto|legal|producto|categoria|admin|api|sitemap\\.xml';
const PREFIX = new RegExp(`(["'\`(])\\/(${ROOTS})(?=[/"'\`?#)\\s.]|$)`, 'g');

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

for (const file of walk(OUT)) {
  const ext = extname(file);
  if (!['.html', '.js', '.css', '.svg'].includes(ext)) continue;
  let text = readFileSync(file, 'utf8');
  if (ext === '.html') {
    text = text
      .replace(/<link rel="preload" href="\/api\/catalog"[^>]*>\n?/g, '')
      .replace(/<meta charset="utf-8">/i, `<meta charset="utf-8">\n<meta name="zw-mode" content="static">\n<meta name="zw-base" content="${BASE}">`);
  }
  if (BASE) text = text.replace(PREFIX, `$1${BASE}/$2`).replace(/href="\/"/g, `href="${BASE}/"`);
  writeFileSync(file, text);
}

console.log(`✔ _site/ generado: ${products.length} productos, ${catalog.categories.length} categorías → ${SITE}/`);

// ---------- Servidor local que imita GitHub Pages ----------
if (SERVE) {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };
  createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith(BASE)) { res.writeHead(302, { Location: `${BASE}/` }); return res.end(); }
    path = path.slice(BASE.length) || '/';
    const candidates = [path, `${path}.html`, join(path, 'index.html')];
    const found = candidates.map((c) => join(OUT, c)).find((f) => existsSync(f) && statSync(f).isFile());
    const file = found ?? join(OUT, '404.html');
    res.writeHead(found ? 200 : 404, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  }).listen(8000, () => console.log(`Sirviendo en http://localhost:8000${BASE}/`));
}
