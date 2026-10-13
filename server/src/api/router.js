import { sendJson, handleError, PublicError } from '../lib/http.js';
import { getCatalog } from '../catalog/catalog-index.js';
import { createCheckout, cancelPendingCheckout } from './checkout.js';
import { getPublicOrder, lookupOrder, requestWithdrawal } from './order.js';
import { track } from '../stats/track.js';

// Catálogo cacheado por Cloudflare (worker.js) y por el navegador: la mayoría de visitas no leen Firestore.
const CATALOG_CACHE = 'public, max-age=60, s-maxage=60';

const routes = {
  'GET /catalog': async (req, res) => sendJson(res, 200, await getCatalog(), CATALOG_CACHE),
  'POST /checkout': async (req, res) => sendJson(res, 200, await createCheckout(req)),
  'POST /order/cancel': async (req, res) => sendJson(res, 200, await cancelPendingCheckout(req)),
  'GET /order': async (req, res) => sendJson(res, 200, await getPublicOrder(req)),
  'POST /order/lookup': async (req, res) => sendJson(res, 200, await lookupOrder(req)),
  'POST /withdrawal': async (req, res) => sendJson(res, 200, await requestWithdrawal(req)),
  'POST /track': async (req, res) => sendJson(res, 200, await track(req)),
};

/** /api/* — el `req`/`res` los crea worker.js a partir del Request. */
export async function api(req, res) {
  const path = req.path.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  const handler = routes[`${req.method} ${path}`];
  try {
    if (!handler) throw new PublicError(404, 'not_found', 'Recurso no encontrado.');
    await handler(req, res);
  } catch (err) {
    handleError(res, err);
  }
}
