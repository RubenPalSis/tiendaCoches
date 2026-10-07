// Asignación del rol de administrador sin descargar claves privadas:
// la lista de emails administradores está en functions/.env (ADMIN_EMAILS=a@x.com,b@y.com).
// Al iniciar sesión en el panel, esta función añade (o retira) el custom claim admin=true.
// Seguridad: se exige email verificado y, además, el registro público debe estar DESACTIVADO en
// Firebase Authentication (solo existen las cuentas creadas desde la consola).
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { REGION } from '../lib/config.js';
import { auth } from '../lib/firebase.js';

export const ADMIN_EMAILS = defineString('ADMIN_EMAILS', { default: '' });

export const allowedAdmins = () =>
  ADMIN_EMAILS.value().split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

export const syncAdminClaim = onCall({ region: REGION, maxInstances: 2 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.');
  const email = String(request.auth.token.email ?? '').toLowerCase();
  const listed = !!email && allowedAdmins().includes(email);
  // Email verificado obligatorio: impide que alguien registre a su nombre un email de la lista.
  if (listed && request.auth.token.email_verified !== true) {
    return { admin: false, changed: false, reason: 'email_not_verified' };
  }
  const shouldBeAdmin = listed;
  const isAdmin = request.auth.token.admin === true;
  if (shouldBeAdmin !== isAdmin) {
    const user = await auth.getUser(request.auth.uid);
    await auth.setCustomUserClaims(request.auth.uid, { ...(user.customClaims ?? {}), admin: shouldBeAdmin });
  }
  return { admin: shouldBeAdmin, changed: shouldBeAdmin !== isAdmin };
});

/** Retira el rol a quien ya no esté en ADMIN_EMAILS y cierra sus sesiones (lo ejecuta la tarea programada). */
export async function revokeRemovedAdmins() {
  const allowed = allowedAdmins();
  let revoked = 0;
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (user.customClaims?.admin === true && !allowed.includes(String(user.email ?? '').toLowerCase())) {
        await auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: false });
        await auth.revokeRefreshTokens(user.uid);
        revoked += 1;
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return revoked;
}
