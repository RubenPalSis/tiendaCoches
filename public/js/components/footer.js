import { html, raw } from '../shared/escape.js';
import { categoryPath } from '../shared/slug.js';
import { icon } from '../shared/product-card.js';
import { qs, fragment } from '../core/dom.js';
import { whatsappUrl, telUrl } from './store-links.js';
import { logoMarkup } from './header.js';

export const PAYMENT_LOGOS = html`<div class="payment-logos" aria-label="Métodos de pago">
  <span class="payment-logo">VISA</span><span class="payment-logo">Mastercard</span>
  <span class="payment-logo">Apple Pay</span><span class="payment-logo">Google Pay</span>
</div>`;

export function renderFooter(catalog) {
  const slot = qs('#site-footer');
  if (!slot) return;
  const { store, categories, shipping } = catalog;
  const year = new Date().getFullYear();
  const wa = whatsappUrl(store);

  slot.replaceWith(fragment(html`<footer class="footer">
  <div class="container footer__top">
    <div class="footer__brand">
      ${raw(logoMarkup(store))}
      <p>${store.about || store.tagline}</p>
    </div>
    <nav aria-label="Categorías">
      <p class="footer__title">Catálogo</p>
      <ul class="footer__list">
        <li><a href="/catalogo">Todos los productos</a></li>
        ${categories.slice(0, 8).map((c) => raw(html`<li><a href="${categoryPath(c)}">${c.name}</a></li>`))}
      </ul>
    </nav>
    <nav aria-label="Información">
      <p class="footer__title">Información</p>
      <ul class="footer__list">
        <li><a href="/pedido">Consultar mi pedido</a></li>
        <li><a href="/legal/envios">Envíos con ${shipping.carrier || 'GLS'}</a></li>
        <li><a href="/legal/devoluciones">Devoluciones y desistimiento</a></li>
        <li><a href="/legal/pagos">Pago seguro</a></li>
        <li><a href="/legal/condiciones">Condiciones de compra</a></li>
        <li><a href="/contacto">Contacto</a></li>
      </ul>
    </nav>
    <div>
      <p class="footer__title">Contacto</p>
      <ul class="footer__list footer__contact">
        ${wa ? raw(html`<li>${icon('whatsapp')}<a href="${wa}" target="_blank" rel="noopener">WhatsApp</a></li>`) : ''}
        ${store.phone ? raw(html`<li>${icon('phone')}<a href="${telUrl(store.phone)}">${store.phone}</a></li>`) : ''}
        ${store.email ? raw(html`<li>${icon('mail')}<a href="mailto:${store.email}">${store.email}</a></li>`) : ''}
        ${store.instagram ? raw(html`<li>${icon('camera')}<a href="https://www.instagram.com/${store.instagram.replace(/^@/, '')}/" target="_blank" rel="noopener">@${store.instagram.replace(/^@/, '')}</a></li>`) : ''}
        ${store.address ? raw(html`<li>${icon('map-pin')}<span>${store.address}</span></li>`) : ''}
      </ul>
      <div style="margin-top:16px">${raw(PAYMENT_LOGOS)}</div>
    </div>
  </div>
  <div class="container footer__bottom">
    <span>© ${year} ${store.ownerName || store.name}. Todos los precios incluyen IVA.</span>
    <ul class="footer__list" style="display:flex;flex-wrap:wrap;gap:6px 16px">
      <li><a href="/legal/aviso-legal">Aviso legal</a></li>
      <li><a href="/legal/privacidad">Privacidad</a></li>
      <li><a href="/legal/cookies">Cookies</a></li>
    </ul>
  </div>
</footer>
${wa ? raw(html`<a class="whatsapp-fab" href="${wa}" target="_blank" rel="noopener" aria-label="Contactar por WhatsApp">${icon('whatsapp')}</a>`) : ''}`));
}
