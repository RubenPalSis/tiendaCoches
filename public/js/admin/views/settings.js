import { html, raw } from '../../shared/escape.js';
import { toCents, centsToInput } from '../../shared/money.js';
import { icon } from '../../shared/product-card.js';
import { COUNTRIES } from '../../shared/constants.js';
import { DEFAULT_SHIPPING_RULES } from '../../shared/shipping.js';
import { qs, qsa, on, setLoading } from '../../core/dom.js';
import { viewHead, toast, errorBox, confirmDialog } from '../ui.js';
import { getSettingsDoc, saveSettingsDoc } from '../data.js';

const TABS = { tienda: 'Tienda', envios: 'Envíos', venta: 'Venta', mantenimiento: 'Mantenimiento' };

const input = (name, label, value, { hint = '', type = 'text', placeholder = '', attrs = '' } = {}) => html`
  <div class="field"><label class="field__label" for="s-${name}">${label}</label>
  <input class="input" id="s-${name}" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder}" ${raw(attrs)}>
  ${hint ? raw(html`<span class="field__hint">${hint}</span>`) : ''}</div>`;

// ---------- Tienda ----------
function storeForm(s) {
  return html`<form id="store-form" class="form-stack">
    <section class="box form-stack"><h2 class="box__title">Tienda</h2>
      <div class="inline-fields">${raw(input('name', 'Nombre de la tienda', s.name))}${raw(input('tagline', 'Eslogan', s.tagline))}</div>
      <div class="field"><label class="field__label" for="s-topbar">Mensajes de la barra superior (uno por línea)</label>
        <textarea class="textarea" id="s-topbar" name="topbar" rows="3">${(s.topbar ?? []).join('\n')}</textarea></div>
      <div class="field"><label class="field__label" for="s-about">Texto «sobre nosotros» del pie de página</label>
        <textarea class="textarea" id="s-about" name="about" rows="2" maxlength="400">${s.about ?? ''}</textarea></div>
    </section>
    <section class="box form-stack"><h2 class="box__title">Datos del vendedor (obligatorios por ley)</h2>
      <p class="hint" style="margin:0">Aparecen en el aviso legal, la política de privacidad y las condiciones de compra.</p>
      <div class="inline-fields">${raw(input('ownerName', 'Nombre y apellidos / razón social', s.ownerName))}${raw(input('taxId', 'NIF', s.taxId))}</div>
      ${raw(input('address', 'Domicilio', s.address, { placeholder: 'Calle, nº, CP, ciudad, provincia' }))}
      ${raw(input('usedWarranty', 'Garantía de productos usados', s.usedWarranty, { placeholder: 'Ej.: 1 año', hint: 'Confirma el plazo mínimo legal con tu gestoría.' }))}
    </section>
    <section class="box form-stack"><h2 class="box__title">Contacto y emails</h2>
      <div class="inline-fields">
        ${raw(input('email', 'Email de contacto (público)', s.email, { type: 'email' }))}
        ${raw(input('phone', 'Teléfono (público)', s.phone, { type: 'tel' }))}
        ${raw(input('whatsapp', 'WhatsApp', s.whatsapp, { type: 'tel', hint: 'Muestra el botón de WhatsApp en la tienda. Déjalo vacío para ocultarlo.' }))}
      </div>
      <div class="inline-fields">
        ${raw(input('notificationEmail', 'Email donde recibir avisos de pedidos', s.notificationEmail, { type: 'email' }))}
        ${raw(input('emailFrom', 'Remitente de los emails a clientes', s.emailFrom, { type: 'email', hint: 'Debe ser una dirección autorizada en tu proveedor de email (SMTP).' }))}
      </div>
    </section>
    <div class="save-bar"><button class="btn btn--primary" type="submit">${icon('check')} Guardar</button></div>
  </form>`;
}

// ---------- Envíos ----------
const rateRow = (r = {}) => html`<div class="rate-row" data-rate>
  <div class="field"><label class="field__label">Hasta (kg)</label><input class="input" name="maxWeight" inputmode="decimal" value="${r.maxWeight ? String(r.maxWeight / 1000).replace('.', ',') : ''}"></div>
  <div class="field"><label class="field__label">Precio (€)</label><input class="input" name="price" inputmode="decimal" value="${r.price != null ? centsToInput(r.price) : ''}"></div>
  <button class="btn btn--icon btn--danger" type="button" data-remove-rate aria-label="Quitar tramo">${icon('trash', 'icon icon--sm')}</button>
</div>`;

const zoneBlock = (z) => html`<div class="zone" data-zone="${z.id}">
  <div class="inline-fields">
    <div class="field"><label class="field__label">Nombre de la zona</label><input class="input" name="zoneName" value="${z.name}"></div>
    <div class="field"><label class="field__label">Plazo de entrega</label><input class="input" name="deliveryTime" value="${z.deliveryTime ?? ''}" placeholder="24–72 h laborables"></div>
    <div class="field"><label class="field__label">Envío gratis desde (€)</label><input class="input" name="freeOver" inputmode="decimal" value="${z.freeOver ? centsToInput(z.freeOver) : ''}" placeholder="Vacío = nunca"></div>
  </div>
  <div class="field"><span class="field__label">Países</span><div class="segmented">${Object.entries(COUNTRIES).map(([c, n]) =>
    raw(html`<label><input type="checkbox" name="countries" value="${c}"${z.countries?.includes(c) ? raw(' checked') : ''}><span>${n}</span></label>`))}</div></div>
  <div class="inline-fields">
    <div class="field"><label class="field__label">Solo códigos postales que empiecen por</label><input class="input" name="postalPrefixes" value="${(z.postalPrefixes ?? []).join(', ')}" placeholder="Vacío = todos">
      <span class="field__hint">Ej.: 07 para Baleares.</span></div>
    <div class="field"><label class="field__label">Excluir códigos postales que empiecen por</label><input class="input" name="excludePostalPrefixes" value="${(z.excludePostalPrefixes ?? []).join(', ')}">
      <span class="field__hint">07 Baleares · 35, 38 Canarias · 51 Ceuta · 52 Melilla</span></div>
  </div>
  <div class="field"><span class="field__label">Tarifas por peso total del pedido</span>
    <div class="rates">${(z.rates ?? []).map((r) => raw(rateRow(r)))}</div>
    <button class="btn btn--sm" type="button" data-add-rate style="justify-self:start;margin-top:4px">${icon('plus', 'icon icon--sm')} Añadir tramo</button></div>
  <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
    <label class="switch" style="gap:10px">Zona activa <input type="checkbox" name="zoneActive"${z.active ? raw(' checked') : ''}></label>
    <button class="btn btn--sm btn--danger" type="button" data-remove-zone>${icon('trash', 'icon icon--sm')} Eliminar zona</button>
  </div>
</div>`;

function shippingForm(s) {
  return html`<form id="shipping-form" class="form-stack">
    <div class="notice notice--info">${icon('info')} <span>Pon aquí <strong>lo que quieres cobrar al cliente</strong> por el envío. Consulta tus tarifas con tu agencia GLS. El peso de cada pieza se toma del «tamaño del paquete» de su ficha.</span></div>
    <section class="box form-stack"><h2 class="box__title">Transportista</h2>
      <div class="inline-fields">
        ${raw(input('carrier', 'Nombre del transportista', s.carrier || 'GLS'))}
        ${raw(input('trackingUrlTemplate', 'Enlace de seguimiento', s.trackingUrlTemplate, { placeholder: 'https://…{tracking}…', hint: 'Copia el enlace de seguimiento de un envío y sustituye el número por {tracking}. Vacío = solo se muestra el número.' }))}
      </div>
    </section>
    <section class="box form-stack"><h2 class="box__title">Zonas y tarifas</h2>
      <div class="form-stack" id="zones">${(s.zones ?? []).map((z) => raw(zoneBlock(z)))}</div>
      <button class="btn" type="button" data-add-zone style="justify-self:start">${icon('plus', 'icon icon--sm')} Añadir zona</button>
    </section>
    <div class="save-bar"><button class="btn btn--primary" type="submit">${icon('check')} Guardar envíos</button></div>
  </form>`;
}

const prefixes = (v) => String(v ?? '').split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 50);

function readShipping(form) {
  const zones = qsa('[data-zone]', form).map((el) => {
    const get = (n) => qs(`[name="${n}"]`, el);
    const rates = qsa('[data-rate]', el).map((r) => ({
      maxWeight: Math.round((parseFloat(qs('[name="maxWeight"]', r).value.replace(',', '.')) || 0) * 1000),
      price: toCents(qs('[name="price"]', r).value || '0'),
    })).filter((r) => r.maxWeight > 0).sort((a, b) => a.maxWeight - b.maxWeight);
    return {
      id: el.dataset.zone,
      name: get('zoneName').value.trim() || 'Zona',
      active: get('zoneActive').checked,
      countries: qsa('[name="countries"]:checked', el).map((c) => c.value),
      postalPrefixes: prefixes(get('postalPrefixes').value),
      excludePostalPrefixes: prefixes(get('excludePostalPrefixes').value),
      deliveryTime: get('deliveryTime').value.trim(),
      freeOver: get('freeOver').value.trim() ? toCents(get('freeOver').value) ?? 0 : 0,
      rates,
    };
  });
  const problems = [];
  zones.forEach((z) => {
    if (z.active && !z.countries.length) problems.push(`La zona «${z.name}» no tiene países.`);
    if (z.active && !z.rates.length) problems.push(`La zona «${z.name}» no tiene tarifas.`);
    if (z.rates.some((r) => r.price == null)) problems.push(`Hay un precio no válido en «${z.name}».`);
  });
  return {
    problems,
    data: {
      carrier: form.carrier.value.trim() || 'GLS',
      trackingUrlTemplate: form.trackingUrlTemplate.value.trim(),
      defaultWeight: 2000,
      zones,
    },
  };
}

// ---------- Venta ----------
function checkoutForm(c) {
  return html`<form id="checkout-form" class="form-stack">
    <section class="box form-stack"><h2 class="box__title">Venta online</h2>
      <label class="switch">Aceptar pedidos <input type="checkbox" name="enabled"${c.enabled !== false ? raw(' checked') : ''}></label>
      <p class="hint" style="margin:0">Desactívalo si te vas de vacaciones: la tienda seguirá visible, pero no se podrá pagar.</p>
      <div class="field"><label class="field__label" for="s-closed">Mensaje cuando no se aceptan pedidos</label>
        <input class="input" id="s-closed" name="closedMessage" value="${c.closedMessage ?? 'La tienda está cerrada temporalmente. Vuelve en unos días.'}"></div>
      <div class="inline-fields">
        ${raw(input('maxQtyPerLine', 'Máximo de unidades por producto en un pedido', c.maxQtyPerLine ?? 10, { type: 'number', attrs: 'min="1" max="50"' }))}
        ${raw(input('termsVersion', 'Versión de las condiciones de compra', c.termsVersion ?? '1', { hint: 'Súbela cuando cambies las condiciones: queda registrada en cada pedido.' }))}
      </div>
    </section>
    <div class="save-bar"><button class="btn btn--primary" type="submit">${icon('check')} Guardar</button></div>
  </form>`;
}

// ---------- Mantenimiento ----------
const maintenance = () => html`<section class="box form-stack"><h2 class="box__title">Mantenimiento</h2>
  <div class="row"><span class="row__main"><span class="row__title">Reconstruir el índice del catálogo</span>
    <span class="row__meta" style="white-space:normal">Úsalo solo si algún producto no aparece en la tienda. Lee todos los productos una vez.</span></span>
    <button class="btn btn--sm" type="button" data-action="rebuildCatalog">${icon('refresh', 'icon icon--sm')} Reconstruir</button></div>
  <div class="row"><span class="row__main"><span class="row__title">Liberar reservas caducadas</span>
    <span class="row__meta" style="white-space:normal">Devuelve al stock las unidades de pagos abandonados. Se hace solo cada hora.</span></span>
    <button class="btn btn--sm" type="button" data-action="releaseStale">${icon('refresh', 'icon icon--sm')} Liberar</button></div>
  <p class="hint">Los cambios en productos y precios pueden tardar hasta 5 minutos en verse en la tienda por la caché. Al pagar, el precio y el stock siempre se comprueban en tiempo real.</p>
</section>`;

export async function render(view, { firebase }) {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const tab = TABS[params.get('tab')] ? params.get('tab') : 'tienda';
  view.innerHTML = html`${raw(viewHead('Ajustes'))}
    <nav class="tabs">${Object.entries(TABS).map(([k, l]) => raw(html`<a class="tab" href="#/configuracion?tab=${k}" aria-current="${k === tab}">${l}</a>`))}</nav>
    <div id="settings"><p class="muted">Cargando…</p></div>`;
  const out = qs('#settings', view);

  async function save(btn, name, data) {
    setLoading(btn, true);
    try {
      await saveSettingsDoc(name, data);
      toast('Ajustes guardados. Se verán en la tienda en unos minutos.', { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      setLoading(btn, false);
    }
  }

  try {
    if (tab === 'tienda') {
      out.innerHTML = storeForm((await getSettingsDoc('store')) ?? {});
      qs('#store-form', out).addEventListener('submit', (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        const data = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v).trim().slice(0, 500)]));
        data.topbar = String(d.topbar ?? '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 4);
        if (!data.name) return toast('El nombre de la tienda es obligatorio.', { type: 'error' });
        save(qs('button[type="submit"]', e.target), 'store', data);
      });
    }

    if (tab === 'envios') {
      const current = (await getSettingsDoc('shipping')) ?? DEFAULT_SHIPPING_RULES;
      out.innerHTML = shippingForm(current);
      const form = qs('#shipping-form', out);
      on(form, 'click', '[data-add-rate]', (e, b) => b.previousElementSibling.insertAdjacentHTML('beforeend', rateRow()));
      on(form, 'click', '[data-remove-rate]', (e, b) => b.closest('[data-rate]').remove());
      on(form, 'click', '[data-add-zone]', () => qs('#zones', form).insertAdjacentHTML('beforeend', zoneBlock({
        id: `zona-${Date.now().toString(36)}`, name: 'Nueva zona', active: false, countries: ['ES'], rates: [{ maxWeight: 2000, price: 0 }],
      })));
      on(form, 'click', '[data-remove-zone]', async (e, b) => {
        if (await confirmDialog('Eliminar zona', '¿Eliminar esta zona de envío?', { confirm: 'Eliminar', danger: true })) b.closest('[data-zone]').remove();
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const { problems, data } = readShipping(form);
        if (problems.length) return toast(problems[0], { type: 'error', timeout: 6000 });
        if (!data.zones.some((z) => z.active)) return toast('Debe haber al menos una zona activa.', { type: 'error' });
        save(qs('button[type="submit"]', form), 'shipping', data);
      });
    }

    if (tab === 'venta') {
      out.innerHTML = checkoutForm((await getSettingsDoc('checkout')) ?? {});
      qs('#checkout-form', out).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target;
        save(qs('button[type="submit"]', f), 'checkout', {
          enabled: f.enabled.checked,
          closedMessage: f.closedMessage.value.trim().slice(0, 300),
          maxQtyPerLine: Math.min(50, Math.max(1, parseInt(f.maxQtyPerLine.value, 10) || 10)),
          termsVersion: f.termsVersion.value.trim().slice(0, 20) || '1',
        });
      });
    }

    if (tab === 'mantenimiento') {
      out.innerHTML = maintenance();
      on(out, 'click', '[data-action]', async (e, b) => {
        setLoading(b, true);
        try {
          const res = await firebase.adminAction(b.dataset.action);
          toast(b.dataset.action === 'rebuildCatalog' ? `Índice reconstruido (${res.products} productos).` : `Reservas liberadas: ${res.released}.`, { type: 'success' });
        } catch (err) {
          toast(err.message, { type: 'error' });
        } finally {
          setLoading(b, false);
        }
      });
    }
  } catch (err) {
    out.innerHTML = errorBox(err);
  }
}
