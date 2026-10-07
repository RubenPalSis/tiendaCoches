// Ficha de producto: el HTML llega renderizado desde el servidor (SEO); aquí se añade la interacción.
import { html, raw } from '../shared/escape.js';
import { renderProductCard, icon, availability } from '../shared/product-card.js';
import { qs, qsa, on, fragment, lockScroll } from '../core/dom.js';
import { initApp } from '../core/app.js';
import { track } from '../services/tracker.js';
import { quantityOf, maxFor } from '../services/cart.js';
import { whatsappUrl, telUrl } from '../components/store-links.js';

const data = JSON.parse(qs('#product-data')?.textContent || '{}');
const { catalog } = await initApp();
const live = catalog.products.find((p) => p.id === data.id);
track('view', data.id);

// ---------- Galería ----------
const mainImg = qs('#gallery-main');
const thumbs = qsa('.gallery__thumb');
const images = data.images?.length ? data.images : [];
let current = 0;

function show(index) {
  if (!images.length) return;
  current = (index + images.length) % images.length;
  const img = images[current];
  mainImg.srcset = `${img.sm} 400w, ${img.md} 800w, ${img.lg} 1600w`;
  mainImg.src = img.md;
  thumbs.forEach((t, i) => t.classList.toggle('is-active', i === current));
}

on(document, 'click', '.gallery__thumb', (e, btn) => show(Number(btn.dataset.index)));

function openLightbox() {
  const box = fragment(html`<div class="lightbox" role="dialog" aria-modal="true" aria-label="Foto ampliada">
    <img src="${images[current].lg}" alt="">
    <button type="button" class="btn btn--ghost btn--icon lightbox__close" aria-label="Cerrar">${icon('close')}</button>
    ${images.length > 1 ? raw(html`<button type="button" class="btn btn--ghost btn--icon lightbox__nav lightbox__nav--prev" data-dir="-1" aria-label="Foto anterior">${icon('chevron-left')}</button>
    <button type="button" class="btn btn--ghost btn--icon lightbox__nav lightbox__nav--next" data-dir="1" aria-label="Foto siguiente">${icon('chevron-right')}</button>`) : ''}
  </div>`).firstElementChild;
  document.body.append(box);
  lockScroll(true);
  const img = box.querySelector('img');
  const close = () => { box.remove(); lockScroll(false); document.removeEventListener('keydown', onKey); };
  const move = (dir) => { show(current + dir); img.src = images[current].lg; };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') move(1);
    if (e.key === 'ArrowLeft') move(-1);
  };
  document.addEventListener('keydown', onKey);
  box.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-dir]');
    if (nav) return move(Number(nav.dataset.dir));
    if (e.target === box || e.target.closest('.lightbox__close')) close();
  });
  box.querySelector('.lightbox__close').focus();
}
mainImg?.addEventListener('click', () => { if (images.length) openLightbox(); });

// Deslizar con el dedo en móvil.
let touchX = null;
mainImg?.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
mainImg?.addEventListener('touchend', (e) => {
  if (touchX == null || images.length < 2) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 40) show(current + (dx < 0 ? 1 : -1));
  touchX = null;
});

// ---------- Disponibilidad actualizada y cantidad ----------
const product = live ?? data;
const max = Math.max(1, maxFor(product, catalog.checkout?.maxQtyPerLine) - quantityOf(data.id));
const qtyInput = qs('#qty');

if (live && qs('#buy-box')) {
  const avail = availability(live);
  const stockEl = qs('#product-stock');
  stockEl.className = `stock stock--${avail.code}`;
  stockEl.textContent = avail.label;
  if (live.stock <= 0) {
    qs('#buy-box').innerHTML = html`<p class="notice notice--muted">${live.reserved
      ? 'Otra persona está completando la compra de este producto. Si no finaliza el pago, volverá a estar disponible en unos minutos.'
      : 'Este producto ya se ha vendido.'}</p>`;
    qs('#buy-bar')?.remove();
  }
}

if (qtyInput) {
  qtyInput.max = String(max);
  const clamp = (v) => Math.max(1, Math.min(max, Number.isFinite(v) ? v : 1));
  const sync = () => {
    qtyInput.value = String(clamp(parseInt(qtyInput.value, 10)));
    qs('[data-qty-dec]').disabled = Number(qtyInput.value) <= 1;
    qs('[data-qty-inc]').disabled = Number(qtyInput.value) >= max;
  };
  qs('[data-qty-dec]').addEventListener('click', () => { qtyInput.value = String(Number(qtyInput.value) - 1); sync(); });
  qs('[data-qty-inc]').addEventListener('click', () => { qtyInput.value = String(Number(qtyInput.value) + 1); sync(); });
  qtyInput.addEventListener('change', sync);
  sync();
}

// ---------- Barra de compra fija en móvil ----------
const buyBar = qs('#buy-bar');
const addButton = qs('#add-to-cart');
if (buyBar && addButton && 'IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    buyBar.hidden = entry.isIntersecting || entry.boundingClientRect.top > 0;
  }).observe(addButton);
}

// ---------- Ayuda: ¿es compatible con mi coche? ----------
const help = qs('#product-help');
if (help) {
  const { store } = catalog;
  const ref = help.dataset.productRef;
  const text = `Hola, tengo una duda sobre "${help.dataset.productName}"${ref ? ` (ref. ${ref})` : ''}: ${location.href}`;
  const wa = whatsappUrl(store, text);
  const contact = wa
    ? html`<a class="btn btn--sm" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp', 'icon icon--sm')} WhatsApp</a>`
    : store.phone ? html`<a class="btn btn--sm" href="${telUrl(store.phone)}">${icon('phone', 'icon icon--sm')} Llamar</a>`
    : store.email ? html`<a class="btn btn--sm" href="mailto:${store.email}?subject=${encodeURIComponent(`Consulta: ${help.dataset.productName}`)}">${icon('mail', 'icon icon--sm')} Email</a>`
    : '';
  if (contact) help.innerHTML = html`<div class="help-box"><span><strong>¿Dudas sobre si es tu pieza?</strong><br><span class="muted">Te ayudamos a comprobarlo.</span></span>${raw(contact)}</div>`;
}

// ---------- Relacionados ----------
const related = catalog.products
  .filter((p) => p.id !== data.id && p.stock > 0)
  .map((p) => ({ p, score: (p.categoryId === data.categoryId ? 2 : 0) + (data.brand && p.brand === data.brand ? 1 : 0) + (data.model && p.model === data.model ? 2 : 0) }))
  .filter((x) => x.score > 0)
  .sort((a, b) => b.score - a.score || b.p.createdAt - a.p.createdAt)
  .slice(0, 4)
  .map((x) => x.p);
if (related.length) {
  qs('#related-grid').innerHTML = related.map((p) => renderProductCard(p)).join('');
  qs('#related').hidden = false;
}
