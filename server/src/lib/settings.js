import { db } from './firebase.js';
import { DEFAULT_SHIPPING_RULES } from '../shared/shipping.js';
import { LIMITS } from '../shared/constants.js';

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

/** Lee settings/{name} con caché en memoria de 30 s. `configured` indica si existe el documento. */
export async function getSettings(name, { fresh = false } = {}) {
  const hit = cache.get(name);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.value;
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
