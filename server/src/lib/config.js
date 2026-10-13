// Configuración del servidor (Cloudflare Worker).
// En producción los valores llegan en `env` (variables de wrangler.toml y secretos `wrangler secret put`);
// en las pruebas con Node se leen de process.env. worker.js llama a setEnv() en cada petición.
let current = {};

export function setEnv(env) {
  current = env ?? {};
}

const read = (name) => {
  const v = current[name] ?? globalThis.process?.env?.[name];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
};

/** Enlace a un recurso de Cloudflare (p. ej. DEV_MEDIA, el almacén de fotos de desarrollo). */
export const binding = (name) => current[name] ?? null;

/** Parámetro con la misma forma que firebase-functions/params: PARAM.value(). */
const param = (name, fallback = '') => ({ name, value: () => read(name) || fallback });

export const TIMEZONE = 'Europe/Madrid';

// Secretos (`npx wrangler secret put NOMBRE`; en local, archivo .dev.vars que git ignora).
export const STRIPE_SECRET_KEY = param('STRIPE_SECRET_KEY');
export const STRIPE_WEBHOOK_SECRET = param('STRIPE_WEBHOOK_SECRET');
export const BREVO_API_KEY = param('BREVO_API_KEY'); // vacío o "disabled" = no enviar emails
export const CLOUDINARY_API_SECRET = param('CLOUDINARY_API_SECRET');
// JSON de la cuenta de servicio de Firebase (acceso del servidor a Firestore y Authentication).
export const FIREBASE_SERVICE_ACCOUNT = param('FIREBASE_SERVICE_ACCOUNT');

// Variables públicas (wrangler.toml → [vars]).
export const SITE_URL = param('SITE_URL'); // https://www.mitienda.es; vacío = origen de la petición permitido
export const ADMIN_EMAILS = param('ADMIN_EMAILS');
export const FIREBASE_PROJECT_ID = param('FIREBASE_PROJECT_ID');
export const FIREBASE_WEB_CONFIG = param('FIREBASE_WEB_CONFIG'); // JSON público del SDK web (apiKey, authDomain…)
export const CLOUDINARY_CLOUD_NAME = param('CLOUDINARY_CLOUD_NAME');
export const CLOUDINARY_API_KEY = param('CLOUDINARY_API_KEY');
export const CLOUDINARY_FOLDER = param('CLOUDINARY_FOLDER', 'tienda');

// Solo en desarrollo local: emuladores de Firebase.
export const FIRESTORE_EMULATOR_HOST = param('FIRESTORE_EMULATOR_HOST');
export const FIREBASE_AUTH_EMULATOR_HOST = param('FIREBASE_AUTH_EMULATOR_HOST');

export const isEmulator = () => !!FIRESTORE_EMULATOR_HOST.value();

export function projectId() {
  const explicit = FIREBASE_PROJECT_ID.value() || read('GCLOUD_PROJECT');
  if (explicit) return explicit;
  try {
    return JSON.parse(FIREBASE_SERVICE_ACCOUNT.value()).project_id || '';
  } catch {
    return '';
  }
}
