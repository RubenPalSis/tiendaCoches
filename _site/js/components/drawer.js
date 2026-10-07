import { lockScroll } from '../core/dom.js';

/**
 * Panel lateral accesible (menú móvil, mini-carrito, filtros).
 * @param el elemento .drawer ya presente en el DOM
 */
export function createDrawer(el, { onOpen } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.hidden = true;
  el.before(backdrop);
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.hidden = true;
  let lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    backdrop.hidden = false;
    el.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add('is-open');
      el.classList.add('is-open');
    });
    lockScroll(true);
    onOpen?.();
    setTimeout(() => el.querySelector('[data-autofocus], button, a, input')?.focus(), 50);
  }

  function close() {
    backdrop.classList.remove('is-open');
    el.classList.remove('is-open');
    lockScroll(false);
    setTimeout(() => {
      backdrop.hidden = true;
      el.hidden = true;
    }, 250);
    lastFocus?.focus?.();
  }

  backdrop.addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  return { open, close, isOpen: () => el.classList.contains('is-open') };
}
