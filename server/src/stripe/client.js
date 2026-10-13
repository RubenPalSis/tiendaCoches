// Cliente mínimo de la API de Stripe con fetch (solo las llamadas que usa la tienda).
// Misma forma que la librería oficial (stripe.checkout.sessions.create…), que en Workers pesa y gasta CPU.
import { STRIPE_SECRET_KEY } from '../lib/config.js';
import { PublicError } from '../lib/http.js';

const API = 'https://api.stripe.com/v1';

/** Codifica objetos anidados como espera Stripe: line_items[0][price_data][currency]=eur */
export function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? formEncode(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === 'object') formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export class StripeError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Stripe ${status}`);
    this.status = status;
    this.type = body?.error?.type;
  }
}

function createClient(key) {
  async function request(method, path, params, { idempotencyKey } = {}) {
    const headers = { Authorization: `Bearer ${key}` };
    if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(`${API}${path}`, { method, headers, body: params ? formEncode(params) : undefined });
        const data = await res.json();
        if (res.ok) return data;
        lastError = new StripeError(res.status, data);
        if (res.status < 500 && res.status !== 429) throw lastError; // errores de datos: no se reintenta
      } catch (err) {
        if (err instanceof StripeError && err.status < 500 && err.status !== 429) throw err;
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
    throw lastError;
  }
  return {
    checkout: {
      sessions: {
        create: (params, opts) => request('POST', '/checkout/sessions', params, opts),
        expire: (id) => request('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, {}),
        retrieve: (id) => request('GET', `/checkout/sessions/${encodeURIComponent(id)}`),
      },
    },
    refunds: {
      create: (params, opts) => request('POST', '/refunds', params, opts),
    },
  };
}

let client;
let clientKey;
let testOverride;

/** Cliente de Stripe (perezoso). Los tests pueden inyectar un doble con setStripeForTests. */
export function getStripe() {
  if (testOverride) return testOverride;
  const key = STRIPE_SECRET_KEY.value();
  if (!key || !key.startsWith('sk_') || /dummy|pendiente/.test(key)) {
    throw new PublicError(503, 'payments_not_configured', 'Los pagos todavía no están configurados en esta tienda.');
  }
  if (!client || clientKey !== key) {
    client = createClient(key);
    clientKey = key;
  }
  return client;
}

export function setStripeForTests(fake) {
  testOverride = fake;
}

// ---------- Firma de los webhooks ----------

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Firma una carga como lo hace Stripe (también sirve para generar firmas en las pruebas). */
export async function signPayload(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payload}`)));
  return `t=${timestamp},v1=${sig}`;
}

/**
 * Verifica la cabecera Stripe-Signature y devuelve el evento. Lanza si la firma no es válida
 * o tiene más de 5 minutos (protege contra reenvíos de eventos antiguos).
 */
export async function constructEvent(payload, header, secret, toleranceSeconds = 300) {
  if (!secret) throw new Error('Falta STRIPE_WEBHOOK_SECRET');
  const parts = String(header ?? '').split(',').map((p) => p.split('='));
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!timestamp || !signatures.length) throw new Error('Cabecera de firma no válida');
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) throw new Error('Firma caducada');
  const expected = (await signPayload(payload, secret, timestamp)).split('v1=')[1];
  if (!signatures.some((s) => safeEqual(s, expected))) throw new Error('Firma no válida');
  return JSON.parse(payload);
}
