import { logger } from 'firebase-functions';
import { SITE_URL } from './config.js';

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

export function clientIp(req) {
  return (
    req.headers['fastly-client-ip'] ||
    String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() ||
    req.ip ||
    'unknown'
  );
}

/**
 * Origen público de la tienda para enlaces (Stripe, emails, canonical, sitemap).
 * Nunca se confía ciegamente en las cabeceras: SITE_URL (functions/.env) o una lista blanca.
 */
export function requestOrigin(req) {
  const configured = SITE_URL.value().trim().replace(/\/$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && process.env.FUNCTIONS_EMULATOR === 'true') return `http://${host}`;
  if (configured) return configured;
  const project = process.env.GCLOUD_PROJECT || '';
  const allowed = [`${project}.web.app`, `${project}.firebaseapp.com`];
  return `https://${allowed.includes(host) ? host : allowed[0]}`;
}

const BOTS = /bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit|monitor/i;
export const isBot = (req) => BOTS.test(String(req.headers['user-agent'] ?? ''));

// Limitador sencillo en memoria por instancia. Junto con MAX_INSTANCES frena abusos básicos
// sin coste de lecturas/escrituras en Firestore.
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
