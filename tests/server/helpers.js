// Utilidades comunes de las pruebas del servidor (emuladores de Firestore y Authentication).
process.env.GCLOUD_PROJECT ??= 'demo-tienda-test';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

const project = () => process.env.GCLOUD_PROJECT;

/** Borra todos los documentos del emulador de Firestore (equivale al antiguo recursiveDelete). */
export async function clearFirestore() {
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project()}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`No se pudo vaciar el emulador de Firestore (${res.status}). ¿Está en marcha?`);
}

/**
 * Crea un usuario en el emulador de Authentication (en el proyecto de la prueba) y devuelve un token
 * de sesión con el mismo formato que los del emulador (sin firmar; el servidor solo los acepta con
 * FIREBASE_AUTH_EMULATOR_HOST). El emulador solo inicia sesión en su proyecto por defecto, y así las
 * pruebas no tocan los datos de desarrollo.
 */
export async function emulatorUser(email, { verified = true, claims } = {}) {
  const base = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${project()}`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };
  const created = await fetch(`${base}/accounts`, {
    method: 'POST', headers,
    body: JSON.stringify({ email, password: 'secret123', emailVerified: verified, ...(claims ? { customAttributes: JSON.stringify(claims) } : {}) }),
  }).then((r) => r.json());
  const uid = created.localId;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = {
    iss: `https://securetoken.google.com/${project()}`, aud: project(), sub: uid, user_id: uid,
    iat: now, exp: now + 3600, auth_time: now, email, email_verified: verified, ...(claims ?? {}),
  };
  return { uid, idToken: `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.` };
}

export async function clearAuth() {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${project()}/accounts`, { method: 'DELETE' });
}

/**
 * Marca la tarifa GLS 2026 (y su kg adicional) como ya aplicada, para las pruebas que usan sus propias reglas de envío
 * (si no, la primera lectura de settings/shipping las sustituiría por la tarifa).
 */
export async function skipGlsTariff(db) {
  await db.doc('meta/migrations').set({ 'shipping-gls-business-parcel-2026': true, 'shipping-gls-business-parcel-2026-kg-adicional': true }, { merge: true });
}
