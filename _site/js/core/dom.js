export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegación de eventos: on(document, 'click', '[data-x]', (e, el) => …) */
export function on(root, type, selector, handler, options) {
  root.addEventListener(type, (event) => {
    const el = event.target.closest?.(selector);
    if (el && root.contains(el)) handler(event, el);
  }, options);
}

/** Convierte un string HTML (ya escapado) en un fragmento/elemento. */
export function fragment(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content;
}

export function setLoading(button, loading) {
  if (!button) return;
  button.classList.toggle('is-loading', loading);
  button.disabled = loading;
  button.setAttribute('aria-busy', String(loading));
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Bloquea el scroll del body mientras hay un panel abierto. */
export function lockScroll(lock) {
  document.body.classList.toggle('no-scroll', lock);
}
