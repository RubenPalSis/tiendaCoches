// localStorage seguro: si el navegador lo bloquea (modo privado, etc.) la tienda sigue funcionando.
// Solo guardamos el carrito y el borrador del checkout: almacenamiento estrictamente necesario, sin cookies.
const memory = new Map();

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    memory.set(key, value);
  }
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
  memory.delete(key);
}
