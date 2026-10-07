// Cliente de la API pública (/tiendaCoches/api → Cloud Functions vía Firebase Hosting).

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network', details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Versión estática (GitHub Pages): sin servidor, catálogo desde un JSON y pedidos desactivados. */
export const STATIC_MODE = document.querySelector('meta[name="zw-mode"]')?.content === 'static';
export const STATIC_BASE = document.querySelector('meta[name="zw-base"]')?.content ?? '';
export const DEMO_MESSAGE = 'Esta es una versión de demostración: los pedidos y pagos se activarán muy pronto.';

const NETWORK_MESSAGE = 'No hay conexión con la tienda. Comprueba tu conexión a internet e inténtalo de nuevo.';

async function request(path, { method = 'GET', body, timeout = 20000 } = {}) {
  if (STATIC_MODE) throw new ApiError(DEMO_MESSAGE, { status: 503, code: 'static_demo' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(NETWORK_MESSAGE);
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = await res.json(); } catch { /* respuesta sin JSON */ }
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(err?.message || 'Ha ocurrido un error. Inténtalo de nuevo en unos minutos.', {
      status: res.status, code: err?.code || 'http_error', details: err?.details,
    });
  }
  return data;
}

export const apiGet = (path) => request(path);
export const apiPost = (path, body) => request(path, { method: 'POST', body });

let catalogPromise;

/** Catálogo + configuración pública. Una sola petición por página (cacheada por la CDN y el navegador). */
export function getCatalog() {
  const load = STATIC_MODE
    ? fetch(`${STATIC_BASE}/demo/catalog.json`).then((r) => {
      if (!r.ok) throw new ApiError(NETWORK_MESSAGE);
      return r.json();
    })
    : null;
  catalogPromise ??= (load ?? apiGet('/catalog')).catch((err) => {
    catalogPromise = null;
    throw err;
  });
  return catalogPromise;
}
