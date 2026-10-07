// Carrito en localStorage: solo ids y cantidades. Precios y stock se toman siempre del catálogo
// actual y el servidor los vuelve a validar al pagar.
import { load, save, remove } from '../core/storage.js';
import { LIMITS } from '../shared/constants.js';

const KEY = 'zw_cart_v1';
const listeners = new Set();

let items = sanitize(load(KEY, []));

function sanitize(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((it) => it && typeof it.id === 'string' && Number.isInteger(it.qty) && it.qty > 0)
    .slice(0, LIMITS.maxLines);
}

function commit() {
  save(KEY, items);
  listeners.forEach((fn) => fn(getItems()));
}

// Sincroniza el carrito entre pestañas abiertas.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  items = sanitize(load(KEY, []));
  listeners.forEach((fn) => fn(getItems()));
});

export const getItems = () => items.map((it) => ({ ...it }));
export const count = () => items.reduce((sum, it) => sum + it.qty, 0);
export const quantityOf = (id) => items.find((it) => it.id === id)?.qty ?? 0;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Máximo que se puede tener en el carrito de un producto. */
export const maxFor = (product, maxQtyPerLine = LIMITS.maxQtyPerLine) =>
  Math.max(0, Math.min(product?.stock ?? 0, maxQtyPerLine));

/** @returns {{ added: number, limited: boolean }} */
export function add(product, qty = 1, maxQtyPerLine) {
  const max = maxFor(product, maxQtyPerLine);
  const current = quantityOf(product.id);
  const next = Math.min(current + qty, max);
  if (next <= current) return { added: 0, limited: true };
  setQty(product.id, next);
  return { added: next - current, limited: current + qty > max };
}

export function setQty(id, qty) {
  const idx = items.findIndex((it) => it.id === id);
  if (qty <= 0) {
    if (idx >= 0) items.splice(idx, 1);
  } else if (idx >= 0) {
    items[idx].qty = qty;
  } else {
    if (items.length >= LIMITS.maxLines) return;
    items.push({ id, qty });
  }
  commit();
}

export const removeItem = (id) => setQty(id, 0);

export function clear() {
  items = [];
  remove(KEY);
  listeners.forEach((fn) => fn([]));
}

/**
 * Cruza el carrito con el catálogo. Devuelve líneas con producto, problemas detectados y subtotal.
 * Los productos que ya no existen se marcan como no disponibles (no se eliminan sin avisar).
 */
export function resolve(catalog) {
  const byId = new Map(catalog.products.map((p) => [p.id, p]));
  const lines = items.map((it) => {
    const product = byId.get(it.id) ?? null;
    let issue = null;
    if (!product) issue = 'Este producto ya no está disponible.';
    else if (product.stock <= 0) issue = product.reserved ? 'Reservado por otro comprador en este momento.' : 'Se ha vendido.';
    else if (it.qty > product.stock) issue = `Solo quedan ${product.stock} unidades.`;
    return { id: it.id, qty: it.qty, product, issue, total: product ? product.price * it.qty : 0 };
  });
  const valid = lines.filter((l) => !l.issue);
  return {
    lines,
    valid,
    hasIssues: lines.some((l) => l.issue),
    subtotal: valid.reduce((s, l) => s + l.total, 0),
    count: valid.reduce((s, l) => s + l.qty, 0),
  };
}
