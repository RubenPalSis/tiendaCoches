import { defineSecret, defineString } from 'firebase-functions/params';

export const REGION = 'europe-west1';
export const TIMEZONE = 'Europe/Madrid';

// Secretos en Google Secret Manager: `firebase functions:secrets:set NOMBRE`.
// En local se leen de functions/.secret.local (no se sube al repositorio).
export const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
export const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
// Formato: smtps://usuario:contraseña@servidor:465  — o "disabled" para no enviar emails.
export const SMTP_URL = defineSecret('SMTP_URL');

// Límite de instancias: evita que un pico de tráfico o un abuso dispare la factura.
export const MAX_INSTANCES = 5;

// Dominio público de la tienda (p. ej. https://www.mitienda.es). Vacío = dominio *.web.app del proyecto.
export const SITE_URL = defineString('SITE_URL', { default: '' });
