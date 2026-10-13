import { logger } from './log.js';
import { SITE_URL, isEmulator } from './config.js';

/** Error con mensaje seguro para mostrar al comprador. */
export class PublicError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendJson(res, status, body, cache = 'no-store') {
  res.set('Cache-Control', cache);
  res.status(status).json(body);
}

export function handleError(res, err) {
  if (err instanceof PublicError) {
    return sendJson(res, err.status, { error: { code: err.code, message: err.message, details: err.details } });
  }
  logger.error('Unhandled error', err);
  return sendJson(res, 500, {
    error: { code: 'internal', message: 'Ha ocurrido un error inesperado. Inténtalo de nuevo en unos minutos.' },
  });
}

/** IP real del visitante: Cloudflare la pone en cf-connecting-ip (no la puede falsear el cliente). */
export function clientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
    req.ip ||
    'unknown'
  );
}

/**
 * Origen público de la tienda para enlaces (Stripe, emails, canonical, sitemap).
 * SITE_URL (wrangler.toml) manda; si no está, el dominio de la petición: Cloudflare solo entrega
 * al Worker las peticiones de sus propios dominios, así que la cabecera Host es fiable.
 */
export function requestOrigin(req) {
  const configured = SITE_URL.value().trim().replace(/\/$/, '');
  const host = String(req.headers.host || '').toLowerCase();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && isEmulator()) return `http://${host}`;
  if (configured) return configured;
  return `https://${host}`;
}

const BOTS = /bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit|monitor/i;
export const isBot = (req) => BOTS.test(String(req.headers['user-agent'] ?? ''));

// Limitador sencillo en memoria (por instancia del Worker): frena abusos básicos sin gastar
// lecturas/escrituras de Firestore. Los límites por email de los pagos pendientes son la defensa real.
const buckets = new Map();
export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    throw new PublicError(429, 'rate_limited', 'Demasiadas solicitudes. Espera un momento y vuelve a intentarlo.');
  }
}
