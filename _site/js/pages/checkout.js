import { html, raw } from '../shared/escape.js';
import { formatPrice } from '../shared/money.js';
import { icon, PLACEHOLDER_IMAGE } from '../shared/product-card.js';
import { calculateShipping, shippableCountries } from '../shared/shipping.js';
import { validateCheckoutForm } from '../shared/validation.js';
import { provinceFromPostalCode } from '../shared/provinces.js';
import { COUNTRIES } from '../shared/constants.js';
import { qs, qsa, setLoading, debounce } from '../core/dom.js';
import { apiPost } from '../core/api.js';
import { initApp, toast } from '../core/app.js';
import * as cart from '../services/cart.js';
import { track } from '../services/tracker.js';

const DRAFT_KEY = 'zw_checkout_draft';
const root = qs('#checkout-root');
const params = new URLSearchParams(location.search);

// El borrador del formulario se guarda solo durante la sesión del navegador.
const draft = {
  load() { try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}'); } catch { return {}; } },
  save(v) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch { /* ignorar */ } },
};

const { catalog, error } = await initApp();

// Pago en curso de este navegador ({n, t}). Si el comprador vuelve desde Stripe (enlace de cancelar o
// botón «Atrás»), liberamos su reserva ANTES de mostrar el carrito, para que pueda volver a intentarlo.
const PENDING_KEY = 'zw_pending_payment';
const pending = {
  load() { try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; } },
  save(v) { try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(v)); } catch { /* ignorar */ } },
  clear() { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignorar */ } },
};

let cancelledNotice = false;
const fromStripe = params.get('cancelado') === '1' && params.get('n') && params.get('t')
  ? { n: params.get('n'), t: params.get('t') } : null;
const previousPayment = fromStripe ?? pending.load();
if (fromStripe) {
  cancelledNotice = true;
  history.replaceState(null, '', '/tiendaCoches/checkout');
}
if (previousPayment && !error) {
  try {
    const res = await apiPost('/order/cancel', previousPayment);
    // El catálogo puede venir de la caché: devolvemos localmente las unidades liberadas.
    for (const it of res.items ?? []) {
      const p = catalog.products.find((x) => x.id === it.id);
      if (p) { p.stock += it.qty; p.reserved = false; }
    }
    if (res.released || !fromStripe) pending.clear();
  } catch { /* si falla, el servidor lo reintenta al crear el nuevo pago (campo previous) */ }
}

const field = (name, label, { type = 'text', autocomplete, cls = 'col-6', optional = false, attrs = '', hint = '' } = {}) => html`
  <div class="field ${cls}" data-field="${name}">
    <label class="field__label" for="f-${name}">${label}${optional ? raw(' <span class="opt">(opcional)</span>') : ''}</label>
    <input class="input" id="f-${name}" name="${name}" type="${type}"${autocomplete ? raw(` autocomplete="${autocomplete}"`) : ''}${optional ? '' : raw(' required')} ${raw(attrs)}>
    ${hint ? raw(html`<span class="field__hint">${hint}</span>`) : ''}
    <span class="field__error" hidden></span>
  </div>`;

function formMarkup(countries) {
  return html`
  <form id="checkout-form" novalidate>
    <section class="form-section">
      <h2 class="form-section__title"><span class="step-num">1</span> Contacto</h2>
      <div class="form-grid">
        ${raw(field('email', 'Email', { type: 'email', autocomplete: 'email', cls: 'col-3', attrs: 'inputmode="email"', hint: 'Te enviaremos aquí la confirmación del pedido.' }))}
        ${raw(field('phone', 'Teléfono', { type: 'tel', autocomplete: 'tel', cls: 'col-3', attrs: 'inputmode="tel"', hint: 'Para que GLS pueda avisarte de la entrega.' }))}
      </div>
    </section>
    <section class="form-section">
      <h2 class="form-section__title"><span class="step-num">2</span> Dirección de envío</h2>
      <div class="form-grid">
        ${raw(field('firstName', 'Nombre', { autocomplete: 'given-name', cls: 'col-3' }))}
        ${raw(field('lastName', 'Apellidos', { autocomplete: 'family-name', cls: 'col-3' }))}
        ${raw(field('line1', 'Dirección', { autocomplete: 'address-line1', cls: 'col-6', attrs: 'placeholder="Calle, número"' }))}
        ${raw(field('line2', 'Piso, puerta, escalera…', { autocomplete: 'address-line2', cls: 'col-6', optional: true }))}
        ${raw(field('postalCode', 'Código postal', { autocomplete: 'postal-code', cls: 'col-2', attrs: 'inputmode="numeric" maxlength="10"' }))}
        ${raw(field('city', 'Ciudad', { autocomplete: 'address-level2', cls: 'col-4' }))}
        ${raw(field('province', 'Provincia', { autocomplete: 'address-level1', cls: 'col-3' }))}
        <div class="field col-3" data-field="country">
          <label class="field__label" for="f-country">País</label>
          <select class="select" id="f-country" name="country" autocomplete="country">
            ${countries.map((c) => raw(html`<option value="${c}">${COUNTRIES[c] ?? c}</option>`))}
          </select>
          <span class="field__error" hidden></span>
        </div>
        <div class="field col-6" data-field="notes">
          <label class="field__label" for="f-notes">Notas para la entrega <span class="opt">(opcional)</span></label>
          <textarea class="textarea" id="f-notes" name="notes" maxlength="300" rows="2" placeholder="Horario preferido, indicaciones para el repartidor…"></textarea>
          <span class="field__error" hidden></span>
        </div>
      </div>
    </section>
    <section class="form-section">
      <h2 class="form-section__title"><span class="step-num">3</span> Envío y pago</h2>
      <div id="shipping-option"></div>
      <div class="notice notice--info" style="margin-top:14px">${icon('lock')}
        <span>Al pulsar <strong>Pagar</strong> irás a la pasarela segura de <strong>Stripe</strong> para pagar con tarjeta, Apple Pay o Google Pay. Nunca vemos ni guardamos los datos de tu tarjeta.</span></div>
      <div class="field" data-field="acceptTerms" style="margin-top:16px">
        <label class="checkbox"><input type="checkbox" name="acceptTerms" id="f-terms">
          <span>He leído y acepto las <a href="/tiendaCoches/legal/condiciones" target="_blank">condiciones de compra</a> y la <a href="/tiendaCoches/legal/privacidad" target="_blank">política de privacidad</a>. Conozco mi <a href="/tiendaCoches/legal/devoluciones" target="_blank">derecho de desistimiento</a>.</span></label>
        <span class="field__error" hidden></span>
      </div>
    </section>
    <div id="form-error" role="alert"></div>
    <button type="submit" class="btn btn--primary btn--lg btn--block" id="pay-btn">${icon('lock')} <span id="pay-label">Pagar</span></button>
    <p class="legal-small" style="margin-top:10px;text-align:center">El pedido supone una obligación de pago. Tus datos se usan solo para gestionar el pedido y el envío.</p>
  </form>`;
}

function summaryMarkup(state, shippingResult) {
  const shippingLabel = !shippingResult ? 'Introduce tu código postal'
    : !shippingResult.ok ? 'No disponible'
    : shippingResult.cost === 0 ? 'Gratis' : formatPrice(shippingResult.cost);
  const total = state.subtotal + (shippingResult?.ok ? shippingResult.cost : 0);
  return html`<div class="summary">
    <h2 class="summary__title">Tu pedido</h2>
    <ul class="summary-items">${state.valid.map((l) => raw(html`<li class="summary-item">
      <span class="summary-item__img"><img src="${l.product.img || PLACEHOLDER_IMAGE}" alt="" width="56" height="42" loading="lazy"><span class="summary-item__qty">${l.qty}</span></span>
      <span class="summary-item__name">${l.product.name}</span>
      <span class="summary-item__price">${formatPrice(l.total)}</span></li>`))}</ul>
    <dl class="summary__rows">
      <div><dt>Subtotal</dt><dd>${formatPrice(state.subtotal)}</dd></div>
      <div><dt>Envío ${catalog.shipping.carrier || 'GLS'}</dt><dd>${shippingLabel}</dd></div>
      <div class="summary__total"><dt>Total</dt><dd>${formatPrice(total)}</dd></div>
    </dl>
    <p class="summary__note">IVA incluido</p>
    <a class="section__link" href="/tiendaCoches/carrito" style="justify-content:center">${icon('edit', 'icon icon--sm')} Modificar carrito</a>
  </div>`;
}

function showErrors(errors) {
  qsa('[data-field]', root).forEach((f) => {
    const msg = errors[f.dataset.field];
    f.classList.toggle('has-error', !!msg);
    const el = f.querySelector('.field__error');
    if (el) { el.hidden = !msg; el.textContent = msg ?? ''; }
  });
  const first = Object.keys(errors)[0];
  if (first) qs(`[name="${first}"]`, root)?.focus();
}

function readForm(form) {
  const data = Object.fromEntries(new FormData(form));
  data.acceptTerms = qs('#f-terms').checked;
  return data;
}

function init() {
  if (error) {
    root.innerHTML = html`<div class="notice notice--error">${icon('alert')} No hemos podido conectar con la tienda. Recarga la página en unos segundos.</div>`;
    return;
  }
  let state = cart.resolve(catalog);
  if (!state.valid.length) {
    root.innerHTML = html`<div class="empty-state">${icon('cart', 'icon icon--xl')}<h1>No hay productos disponibles en tu carrito</h1>
      ${cancelledNotice ? raw('<p>Has cancelado el pago. No se ha realizado ningún cargo.</p>') : ''}
      <div class="actions"><a class="btn btn--primary" href="/tiendaCoches/catalogo">Ver catálogo</a><a class="btn" href="/tiendaCoches/carrito">Ver carrito</a></div></div>`;
    return;
  }
  if (catalog.checkout?.enabled === false) {
    root.innerHTML = html`<div class="notice notice--warning">${icon('info')} ${catalog.checkout.closedMessage}</div>`;
    return;
  }

  const countries = shippableCountries(catalog.shipping);
  if (!countries.length) countries.push('ES');

  root.innerHTML = html`
    ${cancelledNotice ? raw(html`<div class="notice notice--warning" style="margin-bottom:16px">${icon('info')} Has cancelado el pago. No se ha realizado ningún cargo y tu carrito sigue guardado.</div>`) : ''}
    ${state.hasIssues ? raw(html`<div class="notice notice--warning" style="margin-bottom:16px">${icon('alert')} Algunos productos de tu carrito ya no están disponibles y no se incluirán. <a href="/tiendaCoches/carrito">Revisar carrito</a></div>`) : ''}
    <button type="button" class="summary-toggle" id="summary-toggle" aria-expanded="false" aria-controls="summary-col">
      <span>${icon('cart', 'icon icon--sm')} Ver resumen del pedido</span><span class="price" id="toggle-total"></span></button>
    <div class="checkout-layout">
      <div>${raw(formMarkup(countries))}</div>
      <aside class="sticky-col" id="summary-col"></aside>
    </div>`;

  const form = qs('#checkout-form');
  const summaryCol = qs('#summary-col');
  const toggle = qs('#summary-toggle');
  const mobile = matchMedia('(max-width: 959px)');

  // Restaura el borrador de la sesión.
  const saved = draft.load();
  for (const [k, v] of Object.entries(saved)) {
    const input = form.elements.namedItem(k);
    if (input && k !== 'acceptTerms') input.value = v;
  }

  let shippingResult = null;
  function refresh() {
    const data = readForm(form);
    shippingResult = data.postalCode?.trim().length >= 4
      ? calculateShipping(catalog.shipping, {
        items: state.valid.map((l) => ({ weight: l.product.weight, quantity: l.qty })),
        subtotal: state.subtotal,
        country: data.country,
        postalCode: data.postalCode,
      })
      : null;
    summaryCol.innerHTML = summaryMarkup(state, shippingResult);
    const total = state.subtotal + (shippingResult?.ok ? shippingResult.cost : 0);
    qs('#toggle-total').textContent = formatPrice(total);
    qs('#pay-label').textContent = `Pagar ${formatPrice(total)}`;
    const zone = shippingResult?.zone;
    qs('#shipping-option').innerHTML = !shippingResult
      ? html`<p class="muted" style="margin:0">Introduce tu código postal para calcular el envío.</p>`
      : !shippingResult.ok
        ? html`<div class="notice notice--error">${icon('alert')} ${shippingResult.message}</div>`
        : html`<div class="shipping-option"><span class="shipping-option__logo">${catalog.shipping.carrier || 'GLS'}</span>
            <span class="shipping-option__info"><strong>Envío a domicilio · ${zone.name}</strong>${zone.deliveryTime ? `Entrega habitual en ${zone.deliveryTime}` : ''}</span>
            <span class="shipping-option__price">${shippingResult.cost === 0 ? 'Gratis' : formatPrice(shippingResult.cost)}</span></div>`;
  }

  const persist = debounce(() => {
    const { acceptTerms, ...data } = readForm(form);
    draft.save(data);
  }, 300);

  form.addEventListener('input', (e) => {
    if (e.target.name === 'postalCode' && form.elements.country.value === 'ES') {
      const province = provinceFromPostalCode(e.target.value);
      if (province) {
        form.elements.province.value = province;
        const pf = qs('[data-field="province"]', form);
        pf.classList.remove('has-error');
        pf.querySelector('.field__error').hidden = true;
      }
    }
    if (['postalCode', 'country'].includes(e.target.name)) refresh();
    const f = e.target.closest('[data-field]');
    if (f?.classList.contains('has-error')) {
      f.classList.remove('has-error');
      f.querySelector('.field__error').hidden = true;
    }
    persist();
  });

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    summaryCol.hidden = !open;
  });
  const applyLayout = () => {
    summaryCol.hidden = mobile.matches && toggle.getAttribute('aria-expanded') !== 'true';
  };
  mobile.addEventListener('change', applyLayout);
  applyLayout();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = qs('#form-error');
    errorBox.innerHTML = '';
    const data = readForm(form);
    const { ok, errors, value } = validateCheckoutForm(data, countries);
    if (!data.acceptTerms) errors.acceptTerms = 'Debes aceptar las condiciones para continuar.';
    if (!ok || !data.acceptTerms) return showErrors(errors);
    if (shippingResult && !shippingResult.ok) return showErrors({ postalCode: shippingResult.message });

    const button = qs('#pay-btn');
    setLoading(button, true);
    try {
      track('checkout');
      const res = await apiPost('/tiendaCoches/checkout', {
        items: state.valid.map((l) => ({ id: l.id, qty: l.qty })),
        customer: value,
        acceptTerms: true,
        previous: pending.load() ?? undefined,
      });
      pending.save({ n: res.orderId, t: res.token });
      location.href = res.url;
    } catch (err) {
      setLoading(button, false);
      if (err.code === 'invalid_form' && err.details) return showErrors(err.details);
      if (err.code === 'cart_changed' && Array.isArray(err.details)) {
        for (const d of err.details) {
          if (d.code === 'insufficient_stock' && d.available > 0) cart.setQty(d.id, d.available);
          else cart.removeItem(d.id);
        }
        state = cart.resolve(catalog);
        errorBox.innerHTML = html`<div class="notice notice--error" style="margin-bottom:12px">${icon('alert')}<div>
          <strong>Hemos actualizado tu carrito:</strong><ul>${err.details.map((d) => raw(html`<li>${d.message}</li>`))}</ul>
          ${state.valid.length ? 'Revisa el resumen y vuelve a pulsar Pagar.' : raw('<a href="/tiendaCoches/catalogo">Volver al catálogo</a>')}</div></div>`;
        refresh();
        return;
      }
      errorBox.innerHTML = html`<div class="notice notice--error" style="margin-bottom:12px">${icon('alert')} ${err.message}</div>`;
      toast(err.message, { type: 'error' });
    }
  });

  refresh();
}

init();
