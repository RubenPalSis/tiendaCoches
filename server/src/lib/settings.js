import { db } from './firebase.js';
import { DEFAULT_SHIPPING_RULES } from '../shared/shipping.js';
import { LIMITS } from '../shared/constants.js';
import { logger } from './log.js';
import { applyGlsTariff } from '../shipping/gls-tariff.js';

export const DEFAULT_STORE = {
  name: 'Recambios Online',
  tagline: 'Recambios y piezas para tu vehículo',
  ownerName: '',
  taxId: '',
  address: '',
  email: '',
  phone: '',
  whatsapp: '',
  usedWarranty: '',
  notificationEmail: '',
  emailFrom: '',
  topbar: ['Envíos con GLS', 'Pago 100% seguro con Stripe', 'Atención personalizada'],
  logoUrl: '',
  ogImage: '',
  heroKicker: '',
  heroTitle: '',
  heroHighlight: '',
  heroLead: '',
  heroImage: '',
  about: '',
  instagram: '',
  facebook: '',
  wallapop: '',
};

export const DEFAULT_CHECKOUT = {
  enabled: true,
  closedMessage: 'La tienda está cerrada temporalmente. Vuelve en unos días.',
  maxQtyPerLine: LIMITS.maxQtyPerLine,
  termsVersion: '1',
};

const DEFAULTS = { store: DEFAULT_STORE, shipping: DEFAULT_SHIPPING_RULES, checkout: DEFAULT_CHECKOUT };

const cache = new Map();
const TTL = 30_000;

// La tarifa GLS 2026 se aplica una vez por instancia antes de leer los envíos (no hace nada si ya
// está aplicada). Si Firestore falla, se reintenta en la siguiente lectura.
let glsTariff = null;
function ensureGlsTariff() {
  glsTariff ??= applyGlsTariff()
    .then((result) => { if (result.applied) logger.info('Tarifa GLS 2026 aplicada a los envíos', result); })
    .catch((err) => { glsTariff = null; logger.error('No se pudo aplicar la tarifa GLS 2026', err); });
  return glsTariff;
}

/** Lee settings/{name} con caché en memoria de 30 s. `configured` indica si existe el documento. */
export async function getSettings(name, { fresh = false } = {}) {
  const hit = cache.get(name);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.value;
  if (name === 'shipping') await ensureGlsTariff();
  const snap = await db.doc(`settings/${name}`).get();
  const value = { ...DEFAULTS[name], ...(snap.exists ? snap.data() : {}), configured: snap.exists };
  cache.set(name, { at: Date.now(), value });
  return value;
}

/** Datos de la tienda que se pueden mostrar públicamente. */
export function publicStore(store) {
  const { notificationEmail, emailFrom, configured, ...rest } = store;
  return rest;
}
