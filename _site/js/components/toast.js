import { html, raw } from '../shared/escape.js';
import { icon } from '../shared/product-card.js';
import { fragment } from '../core/dom.js';

let container;

/** Mensaje breve no intrusivo. type: 'info' | 'success' | 'error' */
export function toast(message, { type = 'info', action, timeout = 4000 } = {}) {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toasts';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.append(container);
  }
  const iconName = type === 'error' ? 'alert' : type === 'success' ? 'check-circle' : 'info';
  const el = fragment(html`<div class="toast toast--${type}">${icon(iconName)}<span>${message}</span>${
    action ? raw(html`<a href="${action.href}">${action.label}</a>`) : ''}</div>`).firstElementChild;
  container.append(el);
  setTimeout(() => el.remove(), timeout);
}
