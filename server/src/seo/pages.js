import { html, raw, esc } from '../shared/escape.js';
import { formatPrice, discountPercent } from '../shared/money.js';
import { productPath, categoryPath } from '../shared/slug.js';
import { CONDITIONS } from '../shared/constants.js';
import { availability, renderProductCard, icon, PLACEHOLDER_IMAGE } from '../shared/product-card.js';
import { renderPage, jsonForScript } from './layout.js';

const SCHEMA_CONDITION = {
  new: 'https://schema.org/NewCondition',
  used: 'https://schema.org/UsedCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
};

const truncate = (text, max) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const paragraphs = (text) =>
  String(text ?? '')
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');

function breadcrumbs(origin, trail) {
  const items = [{ name: 'Inicio', path: '/' }, ...trail];
  return {
    markup: html`<nav class="breadcrumbs" aria-label="Migas de pan"><ol>${items.map((it, i) =>
      raw(i === items.length - 1
        ? html`<li aria-current="page">${it.name}</li>`
        : html`<li><a href="${it.path}">${it.name}</a></li>`))}</ol></nav>`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: origin + it.path })),
    },
  };
}

function gallery(p) {
  const images = p.images?.length ? p.images : [{ sm: PLACEHOLDER_IMAGE, md: PLACEHOLDER_IMAGE, lg: PLACEHOLDER_IMAGE }];
  const alt = (img, i) => img.alt || `${p.name}${i ? ` – foto ${i + 1}` : ''}`;
  const main = images[0];
  return html`<section class="gallery" id="gallery" aria-label="Fotos del producto">
  <div class="gallery__main">
    <img id="gallery-main" src="${main.md}" srcset="${main.sm} 400w, ${main.md} 800w, ${main.lg} 1600w"
      sizes="(min-width: 960px) 560px, 100vw" alt="${alt(main, 0)}" width="800" height="600" fetchpriority="high">
  </div>
  ${images.length > 1 ? raw(html`<div class="gallery__thumbs" role="list">${images.map((img, i) => raw(html`
    <button type="button" class="gallery__thumb${i === 0 ? ' is-active' : ''}" role="listitem" data-index="${i}" aria-label="Ver foto ${i + 1}">
      <img src="${img.sm}" alt="" width="96" height="72" loading="lazy">
    </button>`))}</div>`) : ''}
</section>`;
}

export function productPage({ origin, store, product: p, category, shipping }) {
  const url = origin + productPath(p);
  const avail = availability(p);
  const canBuy = avail.code === 'in' || avail.code === 'low';
  const off = discountPercent(p.price, p.comparePrice);
  const meta = [p.brand, p.model].filter(Boolean).join(' · ');
  const trail = [
    ...(category ? [{ name: category.name, path: categoryPath(category) }] : []),
    { name: p.name, path: productPath(p) },
  ];
  const crumbs = breadcrumbs(origin, trail);
  const description = truncate(
    p.description || `${p.name}${meta ? ` (${meta})` : ''}${p.reference ? `, referencia ${p.reference}` : ''}. Envío con ${shipping.carrier || 'GLS'}.`,
    158,
  );
  const imageUrls = (p.images ?? []).map((i) => i.lg).filter((u) => u?.startsWith('http'));
  const zone = shipping.zones?.find((z) => z.active);

  const specs = [
    ['Referencia', p.reference],
    ['Marca', p.brand],
    ['Modelo', p.model],
    ['Estado', CONDITIONS[p.condition]],
    ['Categoría', category?.name],
    ['Peso aproximado', p.weight ? `${(p.weight / 1000).toLocaleString('es-ES')} kg` : ''],
  ].filter(([, v]) => v);

  const body = html`<main id="main" class="container product-page">
  ${raw(crumbs.markup)}
  <div class="product">
    ${raw(gallery(p))}
    <section class="product__info">
      ${meta ? raw(html`<p class="product__meta">${meta}</p>`) : ''}
      <h1 class="product__title">${p.name}</h1>
      <div class="product__tags">
        ${p.reference ? raw(html`<span class="tag">Ref. <span class="mono">${p.reference}</span></span>`) : ''}
        <span class="tag tag--${p.condition}">${CONDITIONS[p.condition] ?? 'Nuevo'}</span>
      </div>
      ${p.conditionNotes ? raw(html`<p class="product__condition-notes">${icon('info')} ${p.conditionNotes}</p>`) : ''}
      <div class="product__price">
        <span class="price price--lg">${formatPrice(p.price)}</span>
        ${off ? raw(html`<s class="price-old">${formatPrice(p.comparePrice)}</s><span class="badge badge--sale">-${off}%</span>`) : ''}
        <span class="price-note">IVA incluido</span>
      </div>
      <p class="stock stock--${avail.code}" id="product-stock">${avail.label}</p>
      <div class="product__buy" id="buy-box">
        ${canBuy
          ? raw(html`<div class="qty" data-qty>
              <button type="button" class="qty__btn" data-qty-dec aria-label="Quitar una unidad">−</button>
              <input class="qty__input" type="number" inputmode="numeric" min="1" max="${Math.min(p.stock, 10)}" value="1" aria-label="Cantidad" id="qty">
              <button type="button" class="qty__btn" data-qty-inc aria-label="Añadir una unidad">+</button>
            </div>
            <button type="button" class="btn btn--primary btn--lg btn--grow" id="add-to-cart" data-add-to-cart="${p.id}">${icon('cart-plus')} Añadir al carrito</button>`)
          : raw(html`<p class="notice notice--muted">${avail.code === 'reserved'
              ? 'Otra persona está completando la compra de este producto. Si no finaliza el pago, volverá a estar disponible en unos minutos.'
              : 'Este producto ya se ha vendido. Echa un vistazo a productos similares más abajo.'}</p>`)}
      </div>
      <ul class="trust-list">
        <li>${icon('truck')} <span>Envío con <strong>${shipping.carrier || 'GLS'}</strong>${zone?.deliveryTime ? ` · ${zone.deliveryTime}` : ''}${zone?.freeOver ? raw(html` · <strong>gratis desde ${formatPrice(zone.freeOver)}</strong>`) : ''}</span></li>
        <li>${icon('lock')} <span>Pago seguro con tarjeta, Apple Pay o Google Pay</span></li>
        <li>${icon('return')} <span>14 días para desistir de la compra</span></li>
      </ul>
      <div class="product__help" id="product-help" data-product-name="${p.name}" data-product-ref="${p.reference || ''}"></div>
    </section>
  </div>

  <div class="product__details">
    <section class="panel">
      <h2 class="panel__title">Descripción</h2>
      <div class="prose">${raw(paragraphs(p.description) || '<p>Consúltanos cualquier duda sobre este producto.</p>')}</div>
    </section>
    ${p.compatibility ? raw(html`<section class="panel">
      <h2 class="panel__title">Compatibilidad</h2>
      <div class="prose">${raw(paragraphs(p.compatibility))}</div>
      <p class="hint">Comprueba siempre la referencia de tu pieza original antes de comprar. Si tienes dudas, escríbenos.</p>
    </section>`) : ''}
    <section class="panel">
      <h2 class="panel__title">Características</h2>
      <dl class="specs">${specs.map(([k, v]) => raw(html`<div><dt>${k}</dt><dd>${v}</dd></div>`))}</dl>
    </section>
  </div>

  <section class="section" id="related" hidden>
    <div class="section__head"><h2 class="section__title">También te puede interesar</h2></div>
    <div class="grid grid--products" id="related-grid"></div>
  </section>
  <div class="buy-bar" id="buy-bar" hidden>
    <div class="buy-bar__price"><span class="price">${formatPrice(p.price)}</span><span class="buy-bar__name">${p.name}</span></div>
    <button type="button" class="btn btn--primary" data-add-to-cart="${p.id}" data-buy-bar>${icon('cart-plus')} Añadir</button>
  </div>
  <script type="application/json" id="product-data">${raw(jsonForScript({
    id: p.id, name: p.name, slug: p.slug, price: p.price, stock: p.stock, categoryId: p.categoryId,
    brand: p.brand || '', model: p.model || '', img: p.images?.[0]?.sm || '',
    images: (p.images ?? []).map(({ sm, md, lg }) => ({ sm, md, lg })),
  }))}</script>
</main>`;

  const offer = {
    '@type': 'Offer',
    url,
    priceCurrency: 'EUR',
    price: (p.price / 100).toFixed(2),
    availability: canBuy ? 'https://schema.org/InStock' : avail.code === 'reserved' ? 'https://schema.org/LimitedAvailability' : 'https://schema.org/SoldOut',
    itemCondition: SCHEMA_CONDITION[p.condition] ?? SCHEMA_CONDITION.new,
  };
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description,
    ...(imageUrls.length ? { image: imageUrls } : {}),
    ...(p.reference ? { sku: p.reference, mpn: p.reference } : {}),
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    ...(category ? { category: category.name } : {}),
    offers: offer,
  };

  return renderPage({
    title: `${p.name}${p.reference ? ` · ${p.reference}` : ''} | ${store.name}`,
    description,
    canonical: url,
    ogImage: imageUrls[0],
    ogType: 'product',
    page: 'product',
    script: 'product',
    storeName: store.name,
    body,
    jsonLd: [productLd, crumbs.jsonLd],
  });
}

export function categoryPage({ origin, store, category, products }) {
  const url = origin + categoryPath(category);
  const crumbs = breadcrumbs(origin, [{ name: category.name, path: categoryPath(category) }]);
  const available = products.filter((p) => p.stock > 0);
  const description = truncate(
    category.description || `Compra ${category.name.toLowerCase()} para tu vehículo en ${store.name}. ${available.length} productos disponibles con envío GLS y pago seguro.`,
    158,
  );
  const initial = available.slice(0, 24);

  const body = html`<main id="main" class="container catalog-page" data-category="${category.id}">
  ${raw(crumbs.markup)}
  <header class="page-head">
    <h1 class="page-head__title">${category.name}</h1>
    ${category.description ? raw(html`<p class="page-head__lead">${category.description}</p>`) : ''}
  </header>
  <div class="catalog" id="catalog">
    <aside class="filters" id="filters" aria-label="Filtros"></aside>
    <section class="catalog__results">
      <div class="toolbar" id="toolbar"></div>
      <div class="grid grid--products" id="results">${initial.map((p, i) => raw(renderProductCard(p, { eager: i < 4 })))}</div>
      ${initial.length ? '' : raw('<p class="empty">Todavía no hay productos en esta categoría.</p>')}
      <div class="load-more" id="load-more"></div>
    </section>
  </div>
</main>`;

  return renderPage({
    title: `${category.name} | ${store.name}`,
    description,
    canonical: url,
    ogImage: category.image?.startsWith('http') ? category.image : undefined,
    page: 'catalog',
    script: 'catalog',
    storeName: store.name,
    body,
    jsonLd: [crumbs.jsonLd, {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: initial.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: origin + productPath(p), name: p.name })),
    }],
  });
}

export function notFoundPage({ store }) {
  return renderPage({
    title: `Página no encontrada | ${store.name}`,
    description: 'La página que buscas no existe o el producto ya no está disponible.',
    page: 'notfound',
    script: 'static',
    storeName: store.name,
    noindex: true,
    body: html`<main id="main" class="container narrow empty-state">
  ${icon('search', 'icon icon--xl')}
  <h1>No encontramos esta página</h1>
  <p>Puede que el producto ya no esté disponible o que el enlace haya cambiado.</p>
  <div class="actions"><a class="btn btn--primary" href="/catalogo">Ver catálogo</a><a class="btn btn--ghost" href="/">Ir al inicio</a></div>
</main>`,
  });
}
