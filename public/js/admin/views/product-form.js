// Alta/edición de piezas, pensada para hacerse desde el móvil en un minuto (como publicar en Wallapop):
// fotos → título → precio → estado → publicar. El resto de campos es opcional.
import { html, raw } from '../../shared/escape.js';
import { toCents, centsToInput } from '../../shared/money.js';
import { icon } from '../../shared/product-card.js';
import { productSlug, productPath } from '../../shared/slug.js';
import { CONDITIONS, SIZE_PRESETS, LIMITS } from '../../shared/constants.js';
import { qs, qsa, on, setLoading } from '../../core/dom.js';
import { viewHead, toast, confirmDialog, errorBox } from '../ui.js';
import { getProduct, listCategories, updateProductCache, removeFromProductCache } from '../data.js';
import { uploadImage, deleteImage } from '../uploads.js';

const sizeFor = (weight) => SIZE_PRESETS.find((s) => s.weight === weight)?.id ?? (weight ? 'custom' : 'S');

function formMarkup(p, categories, isNew) {
  const size = sizeFor(p.weight);
  return html`
  <form id="product-form" novalidate>
    <div class="form-layout">
      <div class="form-stack">
        <section class="box">
          <h2 class="box__title">Fotos <span class="muted" style="font-size:.85rem;font-family:var(--f-body);text-transform:none">${p.images?.length ?? 0}/${LIMITS.maxImages}</span></h2>
          <div class="uploader">
            <div class="photos" id="photos"></div>
            <label class="dropzone" id="dropzone">
              ${icon('camera')}
              <span><strong>Hacer fotos o elegir de la galería</strong><br>La primera foto es la principal. Se comprimen automáticamente.</span>
              <input type="file" accept="image/*" multiple hidden id="file-input">
            </label>
          </div>
        </section>
        <section class="box form-stack">
          <h2 class="box__title">Datos principales</h2>
          <div class="field" data-field="name">
            <label class="field__label" for="f-name">Título</label>
            <input class="input" id="f-name" name="name" maxlength="150" required value="${p.name ?? ''}" placeholder="Ej.: Faro delantero izquierdo Seat Ibiza 6J">
            <span class="field__hint">Incluye qué pieza es, la marca y el modelo del coche: así la encuentran en Google.</span>
            <span class="field__error" hidden></span>
          </div>
          <div class="inline-fields">
            <div class="field" data-field="price">
              <label class="field__label" for="f-price">Precio (IVA incl.)</label>
              <div class="input-suffix"><input class="input" id="f-price" name="price" inputmode="decimal" required value="${p.price != null ? centsToInput(p.price) : ''}" placeholder="0,00"><span>€</span></div>
              <span class="field__error" hidden></span>
            </div>
            <div class="field" data-field="stock">
              <label class="field__label" for="f-stock">Unidades</label>
              <input class="input" id="f-stock" name="stock" type="number" inputmode="numeric" min="0" max="100000" required value="${p.stock ?? 1}">
              ${p.reserved > 0 ? raw(html`<span class="field__hint" style="color:var(--c-warning)">${p.reserved} unidad(es) reservadas en un pago en curso.</span>`) : ''}
              <span class="field__error" hidden></span>
            </div>
          </div>
          <div class="field">
            <span class="field__label">Estado</span>
            <div class="segmented">${Object.entries(CONDITIONS).map(([k, label]) => raw(html`<label><input type="radio" name="condition" value="${k}"${(p.condition ?? 'used') === k ? raw(' checked') : ''}><span>${label}</span></label>`))}</div>
          </div>
          <div class="field">
            <label class="field__label" for="f-conditionNotes">Observaciones del estado <span class="opt">(opcional)</span></label>
            <input class="input" id="f-conditionNotes" name="conditionNotes" maxlength="300" value="${p.conditionNotes ?? ''}" placeholder="Ej.: pequeño arañazo en la tulipa, funciona perfectamente">
          </div>
          <div class="field" data-field="categoryId">
            <label class="field__label" for="f-category">Categoría</label>
            <select class="select" id="f-category" name="categoryId">
              <option value="">Sin categoría</option>
              ${categories.map((c) => raw(html`<option value="${c.id}"${p.categoryId === c.id ? raw(' selected') : ''}>${c.name}${c.active ? '' : ' (oculta)'}</option>`))}
            </select>
            ${categories.length ? '' : raw('<span class="field__hint">Aún no hay categorías. <a href="#/categorias">Crear categorías</a>.</span>')}
          </div>
          <div class="field">
            <span class="field__label">Tamaño del paquete (para calcular el envío)</span>
            <div class="segmented">${SIZE_PRESETS.map((s) => raw(html`<label><input type="radio" name="size" value="${s.id}"${size === s.id ? raw(' checked') : ''}><span>${s.label}</span></label>`))}
              <label><input type="radio" name="size" value="custom"${size === 'custom' ? raw(' checked') : ''}><span>Peso exacto</span></label></div>
            <div class="input-suffix" id="weight-wrap" style="margin-top:8px"${size === 'custom' ? '' : raw(' hidden')}>
              <input class="input" name="weightKg" inputmode="decimal" value="${p.weight ? String(p.weight / 1000).replace('.', ',') : ''}" placeholder="Peso con embalaje" aria-label="Peso exacto en kg"><span>kg</span></div>
          </div>
        </section>
        <section class="box form-stack">
          <details class="more"${p.reference || p.brand || p.description || p.compatibility ? raw(' open') : ''}>
            <summary>${icon('plus', 'icon icon--sm')} Más detalles (recomendado)</summary>
            <div class="form-stack">
              <div class="inline-fields">
                <div class="field"><label class="field__label" for="f-reference">Referencia <span class="opt">(opcional)</span></label>
                  <input class="input mono" id="f-reference" name="reference" maxlength="80" value="${p.reference ?? ''}" placeholder="Nº de pieza / OEM"></div>
                <div class="field"><label class="field__label" for="f-brand">Marca <span class="opt">(opcional)</span></label>
                  <input class="input" id="f-brand" name="brand" maxlength="80" value="${p.brand ?? ''}" placeholder="Seat, Bosch, Valeo…"></div>
                <div class="field"><label class="field__label" for="f-model">Modelo <span class="opt">(opcional)</span></label>
                  <input class="input" id="f-model" name="model" maxlength="120" value="${p.model ?? ''}" placeholder="Ibiza 6J"></div>
              </div>
              <div class="field"><label class="field__label" for="f-compatibility">Compatibilidad <span class="opt">(opcional)</span></label>
                <textarea class="textarea" id="f-compatibility" name="compatibility" maxlength="2000" rows="3" placeholder="Modelos y años compatibles, motorizaciones…">${p.compatibility ?? ''}</textarea></div>
              <div class="field"><label class="field__label" for="f-description">Descripción <span class="opt">(opcional)</span></label>
                <textarea class="textarea" id="f-description" name="description" maxlength="6000" rows="6" placeholder="Estado, qué incluye, de qué vehículo procede, kilómetros…">${p.description ?? ''}</textarea></div>
              <div class="field" data-field="comparePrice"><label class="field__label" for="f-comparePrice">Precio anterior (para mostrar oferta) <span class="opt">(opcional)</span></label>
                <div class="input-suffix"><input class="input" id="f-comparePrice" name="comparePrice" inputmode="decimal" value="${p.comparePrice ? centsToInput(p.comparePrice) : ''}" placeholder="0,00"><span>€</span></div>
                <span class="field__error" hidden></span></div>
            </div>
          </details>
        </section>
      </div>
      <aside class="form-stack">
        <section class="box form-stack">
          <h2 class="box__title">Publicación</h2>
          <label class="switch">Visible en la tienda <input type="checkbox" name="active"${p.active !== false ? raw(' checked') : ''}></label>
          <label class="switch">Destacado en portada <input type="checkbox" name="featured"${p.featured ? raw(' checked') : ''}></label>
          ${!isNew ? raw(html`<dl class="kv">
            <div><dt>Vendidas</dt><dd>${p.soldCount ?? 0}</dd></div>
            <div><dt>En pago</dt><dd>${p.reserved ?? 0}</dd></div>
          </dl>
          <a class="btn btn--sm" href="${productPath(p)}" target="_blank" rel="noopener">${icon('external', 'icon icon--sm')} Ver en la tienda</a>
          <a class="btn btn--sm" href="#/productos/nuevo?copiar=${p.id}">${icon('copy', 'icon icon--sm')} Duplicar pieza</a>
          <button class="btn btn--sm btn--danger" type="button" data-delete>${icon('trash', 'icon icon--sm')} Eliminar</button>`) : ''}
        </section>
      </aside>
    </div>
    <div class="save-bar">
      <a class="btn" href="#/productos">Cancelar</a>
      <button class="btn btn--primary" type="submit">${icon('check')} ${isNew ? 'Publicar pieza' : 'Guardar cambios'}</button>
    </div>
  </form>`;
}

function photoMarkup(images, uploading) {
  return [
    ...images.map((img, i) => html`<div class="photo${i === 0 ? ' photo--main' : ''}">
      <img src="${img.sm}" alt="Foto ${i + 1}" width="120" height="90">
      ${i === 0 ? raw('<span class="photo__label">Principal</span>') : ''}
      <div class="photo__actions">
        ${i > 0 ? raw(html`<button type="button" data-main="${i}" aria-label="Hacer principal" title="Hacer principal">${icon('star')}</button>`) : ''}
        <button type="button" data-remove-photo="${i}" aria-label="Quitar foto" title="Quitar foto">${icon('trash')}</button>
      </div></div>`),
    ...Array.from({ length: uploading }, () => '<div class="photo photo--uploading"></div>'),
  ].join('');
}

function showErrors(form, errors) {
  qsa('[data-field]', form).forEach((f) => {
    const msg = errors[f.dataset.field];
    f.classList.toggle('has-error', !!msg);
    const el = f.querySelector('.field__error');
    if (el) { el.hidden = !msg; el.textContent = msg ?? ''; }
  });
  const first = Object.keys(errors)[0];
  if (first) form.querySelector(`[name="${first}"]`)?.focus();
}

function readForm(form, original) {
  const d = new FormData(form);
  const errors = {};
  const name = String(d.get('name') ?? '').trim();
  const price = toCents(d.get('price'));
  const comparePriceRaw = String(d.get('comparePrice') ?? '').trim();
  const comparePrice = comparePriceRaw ? toCents(comparePriceRaw) : null;
  const stock = Number(d.get('stock'));
  const size = d.get('size');
  const weight = size === 'custom'
    ? Math.round((parseFloat(String(d.get('weightKg') ?? '').replace(',', '.')) || 0) * 1000)
    : SIZE_PRESETS.find((s) => s.id === size)?.weight ?? 2000;

  if (name.length < 2) errors.name = 'Escribe un título para la pieza.';
  if (price == null || price < 0) errors.price = 'Introduce un precio válido (ej.: 45,00).';
  if (comparePriceRaw && (comparePrice == null || comparePrice <= price)) errors.comparePrice = 'Debe ser mayor que el precio actual (o déjalo vacío).';
  if (!Number.isInteger(stock) || stock < 0) errors.stock = 'Número de unidades no válido.';

  return {
    errors,
    data: {
      name,
      price: price ?? 0,
      comparePrice,
      stock,
      weight,
      condition: d.get('condition') || 'used',
      conditionNotes: String(d.get('conditionNotes') ?? '').trim(),
      categoryId: d.get('categoryId') || '',
      reference: String(d.get('reference') ?? '').trim(),
      brand: String(d.get('brand') ?? '').trim(),
      model: String(d.get('model') ?? '').trim(),
      compatibility: String(d.get('compatibility') ?? '').trim(),
      description: String(d.get('description') ?? '').trim(),
      active: form.elements.active.checked,
      featured: form.elements.featured.checked,
    },
    stockChanged: original ? stock !== original.stock : true,
  };
}

export async function render(view, { params, firebase }) {
  const { db, fs } = firebase;
  const isNew = params[0] === 'nuevo';
  const copyFrom = new URLSearchParams(location.hash.split('?')[1] ?? '').get('copiar');

  const [categories, original, copy] = await Promise.all([
    listCategories(),
    isNew ? null : getProduct(params[0]),
    isNew && copyFrom ? getProduct(copyFrom) : null,
  ]);
  if (!isNew && !original) {
    view.innerHTML = errorBox(new Error('Producto no encontrado.'));
    return;
  }

  const id = isNew ? fs.doc(fs.collection(db, 'products')).id : original.id;
  const base = original ?? (copy ? { ...copy, images: [], name: `${copy.name} (copia)` } : { stock: 1, condition: 'used', active: true });
  let images = [...(original?.images ?? [])];
  const sessionUploads = new Set();
  const removedOnSave = [];
  let uploading = 0;

  view.innerHTML = viewHead(isNew ? 'Nueva pieza' : 'Editar pieza', '', { href: '#/productos', label: 'Productos' }) + formMarkup(base, categories, isNew);
  const form = qs('#product-form', view);
  const photos = qs('#photos', view);
  const drawPhotos = () => {
    photos.innerHTML = photoMarkup(images, uploading);
    qs('.box__title span', view).textContent = `${images.length}/${LIMITS.maxImages}`;
  };
  drawPhotos();

  async function addFiles(files) {
    const room = LIMITS.maxImages - images.length - uploading;
    const list = [...files].slice(0, Math.max(0, room));
    if (files.length > list.length) toast(`Máximo ${LIMITS.maxImages} fotos por pieza.`, { type: 'error' });
    const title = form.elements.name.value || 'pieza';
    for (const file of list) {
      uploading += 1;
      drawPhotos();
      try {
        const img = await uploadImage(`products/${id}`, title, file);
        images.push(img);
        sessionUploads.add(img);
      } catch (err) {
        toast(err.message || 'No se pudo subir la foto.', { type: 'error', timeout: 6000 });
      } finally {
        uploading -= 1;
        drawPhotos();
      }
    }
  }

  qs('#file-input', view).addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const dz = qs('#dropzone', view);
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('is-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('is-over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('is-over'); addFiles(e.dataTransfer.files); });

  on(photos, 'click', '[data-main]', (e, b) => {
    const i = Number(b.dataset.main);
    images = [images[i], ...images.filter((_, j) => j !== i)];
    drawPhotos();
  });
  on(photos, 'click', '[data-remove-photo]', (e, b) => {
    const [img] = images.splice(Number(b.dataset.removePhoto), 1);
    if (sessionUploads.has(img)) deleteImage(img);
    else removedOnSave.push(img);
    drawPhotos();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'size') qs('#weight-wrap', view).hidden = e.target.value !== 'custom';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (uploading) return toast('Espera a que terminen de subirse las fotos.', { type: 'error' });
    const { errors, data, stockChanged } = readForm(form, original);
    showErrors(form, errors);
    if (Object.keys(errors).length) return;
    if (!images.length && data.active && !(await confirmDialog('Sin fotos', 'Las piezas sin fotos se venden mucho peor. ¿Publicar igualmente?', { confirm: 'Publicar sin fotos' }))) return;

    const btn = qs('button[type="submit"]', form);
    setLoading(btn, true);
    const ref = fs.doc(db, 'products', id);
    const payload = {
      ...data,
      slug: productSlug(data.name, id),
      images: images.map(({ sm, md, lg, paths }) => ({ sm, md, lg, paths })),
      updatedAt: fs.serverTimestamp(),
    };
    try {
      if (isNew) {
        await fs.setDoc(ref, { ...payload, reserved: 0, soldCount: 0, createdAt: fs.serverTimestamp() });
      } else {
        await fs.runTransaction(db, async (tx) => {
          const current = (await tx.get(ref)).data();
          if (!current) throw new Error('El producto ya no existe.');
          if (stockChanged && current.stock !== original.stock) {
            throw new Error(`El stock ha cambiado mientras editabas (ahora hay ${current.stock}, posiblemente por una venta). Recarga la página y vuelve a intentarlo.`);
          }
          const update = { ...payload };
          if (!stockChanged) delete update.stock;
          tx.update(ref, update);
        });
      }
      await Promise.all(removedOnSave.map(deleteImage));
      updateProductCache({ id, ...payload, updatedAt: new Date(), ...(isNew ? { reserved: 0, soldCount: 0, createdAt: { toMillis: () => Date.now() } } : {}) });
      toast(isNew ? 'Pieza publicada' : 'Cambios guardados', { type: 'success' });
      location.hash = '#/productos';
    } catch (err) {
      setLoading(btn, false);
      toast(/permission/i.test(err.message) ? 'No se pudo guardar: revisa los datos (o tus permisos).' : err.message, { type: 'error', timeout: 8000 });
    }
  });

  on(view, 'click', '[data-delete]', async () => {
    if (original.reserved > 0) return toast('No se puede eliminar: hay un pago en curso con esta pieza.', { type: 'error' });
    const msg = original.soldCount > 0
      ? 'Esta pieza tiene ventas. Si solo quieres que no aparezca, desactiva «Visible en la tienda». ¿Eliminarla definitivamente?'
      : `Se eliminará «${original.name}» y sus fotos. Esta acción no se puede deshacer.`;
    if (!(await confirmDialog('Eliminar pieza', msg, { confirm: 'Eliminar', danger: true }))) return;
    try {
      await fs.deleteDoc(fs.doc(db, 'products', id));
      await Promise.all((original.images ?? []).map(deleteImage));
      removeFromProductCache(id);
      toast('Pieza eliminada', { type: 'success' });
      location.hash = '#/productos';
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  });

  if (isNew && !copy) form.elements.name.focus();
}
