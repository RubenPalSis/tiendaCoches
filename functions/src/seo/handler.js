import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { REGION, MAX_INSTANCES } from '../lib/config.js';
import { db } from '../lib/firebase.js';
import { requestOrigin } from '../lib/http.js';
import { getCatalog } from '../catalog/catalog-index.js';
import { productIdFromSlug, productPath, categoryPath } from '../shared/slug.js';
import { esc } from '../shared/escape.js';
import { productPage, categoryPage, notFoundPage } from './pages.js';

const PAGE_CACHE = 'public, max-age=300, s-maxage=600';

const STATIC_PATHS = [
  '/', '/catalogo', '/contacto', '/legal/aviso-legal', '/legal/privacidad', '/legal/cookies',
  '/legal/condiciones', '/legal/envios', '/legal/devoluciones', '/legal/pagos',
];

async function renderProduct(req, res, slug, catalog) {
  const id = productIdFromSlug(slug);
  const snap = id ? await db.collection('products').doc(id).get() : null;
  const product = snap?.exists ? { id: snap.id, ...snap.data() } : null;
  if (!product || !product.active) return sendNotFound(res, catalog);

  const canonicalPath = productPath(product);
  if (req.path !== canonicalPath) return res.redirect(301, canonicalPath);

  const category = catalog.categories.find((c) => c.id === product.categoryId);
  res.set('Cache-Control', PAGE_CACHE);
  res.status(200).send(productPage({ origin: requestOrigin(req), store: catalog.store, product, category, shipping: catalog.shipping }));
}

function renderCategory(req, res, slug, catalog) {
  const category = catalog.categories.find((c) => c.slug === slug);
  if (!category) return sendNotFound(res, catalog);
  const products = catalog.products.filter((p) => p.categoryId === category.id);
  res.set('Cache-Control', PAGE_CACHE);
  res.status(200).send(categoryPage({ origin: requestOrigin(req), store: catalog.store, category, products }));
}

function sendNotFound(res, catalog) {
  res.set('Cache-Control', 'public, max-age=60, s-maxage=120');
  res.status(404).send(notFoundPage({ store: catalog.store }));
}

function sitemap(req, res, catalog) {
  const origin = requestOrigin(req);
  const entry = (path, lastmod) =>
    `<url><loc>${esc(origin + path)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  const urls = [
    ...STATIC_PATHS.map((p) => entry(p)),
    ...catalog.categories.map((c) => entry(categoryPath(c))),
    ...catalog.products.map((p) => entry(productPath(p), p.createdAt)),
  ];
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
}

function robots(req, res) {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.send(`User-agent: *
Disallow: /admin/
Disallow: /api/
Disallow: /carrito
Disallow: /checkout
Disallow: /pedido

Sitemap: ${requestOrigin(req)}/sitemap.xml
`);
}

export const seo = onRequest({ region: REGION, maxInstances: MAX_INSTANCES, memory: '256MiB' }, async (req, res) => {
  try {
    if (req.path === '/robots.txt') return robots(req, res);
    const catalog = await getCatalog();
    if (req.path === '/sitemap.xml') return sitemap(req, res, catalog);

    const [, section, slug = ''] = req.path.split('/');
    if (section === 'producto' && slug) return await renderProduct(req, res, decodeURIComponent(slug), catalog);
    if (section === 'categoria' && slug) return renderCategory(req, res, decodeURIComponent(slug), catalog);
    return sendNotFound(res, catalog);
  } catch (err) {
    logger.error('Error renderizando página', { path: req.path, err });
    res.set('Cache-Control', 'no-store');
    res.status(500).send('<!doctype html><meta charset="utf-8"><title>Error</title><p>Error temporal. Recarga la página en unos segundos.</p>');
  }
});
