import { html, raw } from '../../shared/escape.js';
import { icon } from '../../shared/product-card.js';
import { slugify, categoryPath } from '../../shared/slug.js';
import { qs, on } from '../../core/dom.js';
import { viewHead, toast, dialog, confirmDialog, errorBox } from '../ui.js';
import { listCategories, listProducts, invalidateCategories } from '../data.js';
import { uploadImage } from '../uploads.js';

function formBody(c = {}) {
  return html`<div class="form-stack">
    <div class="field"><label class="field__label" for="c-name">Nombre</label>
      <input class="input" id="c-name" name="name" required maxlength="80" value="${c.name ?? ''}" placeholder="Ej.: Iluminación"></div>
    <div class="field"><label class="field__label" for="c-slug">URL</label>
      <div class="input-suffix"><input class="input" id="c-slug" name="slug" maxlength="80" value="${c.slug ?? ''}" placeholder="se genera automáticamente"></div>
      <span class="field__hint">/categoria/<strong id="slug-preview">${c.slug ?? ''}</strong>${c.id ? ' · Cambiarla rompe los enlaces antiguos.' : ''}</span></div>
    <div class="field"><label class="field__label" for="c-desc">Descripción <span class="opt">(opcional, ayuda al SEO)</span></label>
      <textarea class="textarea" id="c-desc" name="description" maxlength="600" rows="3">${c.description ?? ''}</textarea></div>
    <div class="inline-fields">
      <div class="field"><label class="field__label" for="c-order">Orden</label>
        <input class="input" id="c-order" name="order" type="number" min="0" max="10000" value="${c.order ?? 0}"></div>
      <div class="field"><span class="field__label">Imagen <span class="opt">(opcional)</span></span>
        <input class="input" type="file" name="image" accept="image/*" style="padding:9px"></div>
    </div>
    <label class="switch">Visible en la tienda <input type="checkbox" name="active"${c.active !== false ? raw(' checked') : ''}></label>
  </div>`;
}

export async function render(view, { firebase }) {
  const { db, fs } = firebase;
  view.innerHTML = html`${raw(viewHead('Categorías', html`<button class="btn btn--primary" type="button" data-new>${icon('plus')} Nueva categoría</button>`))}
    <p class="muted">Las categorías aparecen en el menú de la tienda y tienen su propia página optimizada para Google.</p>
    <div class="rows" id="list"><p class="muted">Cargando…</p></div>`;
  const list = qs('#list', view);

  async function draw(fresh = false) {
    try {
      const [cats, products] = await Promise.all([listCategories({ fresh }), listProducts()]);
      const counts = new Map();
      products.forEach((p) => counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1));
      list.innerHTML = cats.length ? cats.map((c) => html`<div class="row${c.active ? '' : ' is-inactive'}">
        <span class="row__main"><span class="row__title">${c.name}</span>
          <span class="row__meta">${categoryPath(c)} · ${counts.get(c.id) ?? 0} productos · orden ${c.order ?? 0}${c.active ? '' : ' · oculta'}</span></span>
        <span class="row__side" style="grid-auto-flow:column">
          <button class="btn btn--sm" type="button" data-edit="${c.id}">${icon('edit', 'icon icon--sm')} Editar</button>
          <button class="btn btn--sm btn--danger btn--icon" type="button" data-del="${c.id}" aria-label="Eliminar ${c.name}">${icon('trash', 'icon icon--sm')}</button>
        </span></div>`).join('')
        : html`<div class="empty">Todavía no hay categorías. Crea la primera, por ejemplo «Motor», «Frenos» o «Iluminación».</div>`;
      return cats;
    } catch (err) {
      list.innerHTML = errorBox(err);
      return [];
    }
  }

  async function edit(category) {
    const promise = dialog({ title: category ? 'Editar categoría' : 'Nueva categoría', body: formBody(category), confirm: 'Guardar' });
    // Vista previa del slug mientras se escribe.
    const modal = document.querySelector('dialog.modal:last-of-type');
    const nameInput = modal.querySelector('[name="name"]');
    const slugInput = modal.querySelector('[name="slug"]');
    const fileInput = modal.querySelector('[name="image"]');
    let file = null;
    fileInput.addEventListener('change', () => { file = fileInput.files[0] ?? null; });
    let manualSlug = !!category;
    slugInput.addEventListener('input', () => { manualSlug = true; modal.querySelector('#slug-preview').textContent = slugify(slugInput.value); });
    nameInput.addEventListener('input', () => {
      if (manualSlug) return;
      slugInput.value = slugify(nameInput.value);
      modal.querySelector('#slug-preview').textContent = slugInput.value;
    });

    const data = await promise;
    if (!data) return;
    const name = data.name.trim();
    const slug = slugify(data.slug || name);
    if (name.length < 2 || slug.length < 2) return toast('Escribe un nombre válido.', { type: 'error' });

    const cats = await listCategories();
    if (cats.some((c) => c.slug === slug && c.id !== category?.id)) return toast('Ya existe una categoría con esa URL.', { type: 'error' });

    const id = category?.id ?? slug;
    try {
      let image = category?.image ?? '';
      if (file) image = (await uploadImage('store', `categoria-${slug}`, file)).md;
      const payload = {
        name, slug, description: data.description.trim(), order: Math.max(0, parseInt(data.order, 10) || 0),
        image, active: !!data.active, updatedAt: fs.serverTimestamp(),
        createdAt: category?.createdAt ?? fs.serverTimestamp(),
      };
      await fs.setDoc(fs.doc(db, 'categories', id), payload);
      invalidateCategories();
      toast('Categoría guardada', { type: 'success' });
      draw(true);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  on(view, 'click', '[data-new]', () => edit(null));
  on(list, 'click', '[data-edit]', async (e, b) => edit((await listCategories()).find((c) => c.id === b.dataset.edit)));
  on(list, 'click', '[data-del]', async (e, b) => {
    const c = (await listCategories()).find((x) => x.id === b.dataset.del);
    const n = (await listProducts()).filter((p) => p.categoryId === c.id).length;
    const ok = await confirmDialog('Eliminar categoría', n
      ? `«${c.name}» tiene ${n} productos, que quedarán sin categoría. ¿Eliminarla?`
      : `¿Eliminar la categoría «${c.name}»?`, { confirm: 'Eliminar', danger: true });
    if (!ok) return;
    try {
      await fs.deleteDoc(fs.doc(db, 'categories', c.id));
      invalidateCategories();
      toast('Categoría eliminada', { type: 'success' });
      draw(true);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  });

  draw();
}
