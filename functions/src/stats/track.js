// Estadísticas propias, sin cookies ni identificadores: contadores diarios agregados.
import { db, FieldValue } from '../lib/firebase.js';
import { PublicError, rateLimit, clientIp, isBot } from '../lib/http.js';
import { dayKey } from '../lib/dates.js';
import { getCatalog } from '../catalog/catalog-index.js';

const EVENTS = { pv: 'pageViews', view: 'productViewsTotal', cart: 'addToCart', checkout: 'checkoutStarted' };

/** POST /api/track { e: 'pv'|'view'|'cart'|'checkout', id? } */
export async function track(req) {
  if (isBot(req)) return { ok: true };
  rateLimit(`track:${clientIp(req)}`, { limit: 120, windowMs: 10 * 60_000 });

  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const field = EVENTS[body?.e];
  if (!field) throw new PublicError(400, 'invalid', 'Evento no válido.');

  const update = { [field]: FieldValue.increment(1) };
  if (body.e === 'view' || body.e === 'cart') {
    const id = String(body.id ?? '');
    const { products } = await getCatalog();
    if (!products.some((p) => p.id === id)) return { ok: true }; // ids inventados no ensucian las estadísticas
    update[body.e === 'view' ? 'productViews' : 'productAddToCart'] = { [id]: FieldValue.increment(1) };
  }
  await db.collection('statistics').doc(`day_${dayKey()}`).set(update, { merge: true });
  return { ok: true };
}
