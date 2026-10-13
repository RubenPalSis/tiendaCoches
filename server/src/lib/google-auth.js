// Autenticación con Google sin firebase-admin (no funciona en Workers), solo con WebCrypto:
//  - accessToken(): token OAuth de la cuenta de servicio para las APIs REST de Firestore y Authentication.
//  - verifyIdToken(): comprueba el token de sesión de Firebase Authentication que envía el panel.
import { FIREBASE_SERVICE_ACCOUNT, FIREBASE_AUTH_EMULATOR_HOST, projectId } from './config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/identitytoolkit',
  'https://www.googleapis.com/auth/cloud-platform',
].join(' ');

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(enc.encode(JSON.stringify(obj)));
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function serviceAccount() {
  const raw = FIREBASE_SERVICE_ACCOUNT.value();
  if (!raw) throw new Error('Falta el secreto FIREBASE_SERVICE_ACCOUNT');
  return JSON.parse(raw);
}

async function importPrivateKey(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

// El token dura 1 h; se reutiliza mientras el Worker siga vivo (ahorra la firma RSA en cada petición).
let cached = { token: '', exp: 0 };

export async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.exp - 120 > now) return cached.token;
  const sa = serviceAccount();
  const header = b64urlJson({ alg: 'RS256', typ: 'JWT' });
  const claims = b64urlJson({ iss: sa.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${b64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${await res.text()}`);
  const data = await res.json();
  cached = { token: data.access_token, exp: now + data.expires_in };
  return cached.token;
}

// ---------- Tokens de sesión de Firebase Authentication ----------

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwks = { keys: null, exp: 0 };

async function signingKey(kid) {
  if (!jwks.keys || Date.now() > jwks.exp) {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`No se pudieron descargar las claves de Firebase (${res.status})`);
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    jwks = { keys: (await res.json()).keys, exp: Date.now() + maxAge * 1000 };
  }
  const jwk = jwks.keys.find((k) => k.kid === kid);
  if (!jwk) return null;
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/**
 * Verifica un token de sesión de Firebase. Devuelve sus datos (uid, email, email_verified, admin…) o null.
 * Con el emulador de Authentication los tokens no van firmados: solo se aceptan en local.
 */
export async function verifyIdToken(token) {
  try {
    const [h, p, s] = String(token ?? '').split('.');
    if (!h || !p) return null;
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
    const project = projectId();
    const now = Math.floor(Date.now() / 1000);

    if (FIREBASE_AUTH_EMULATOR_HOST.value()) {
      if (header.alg !== 'none' && header.alg !== 'RS256') return null;
    } else {
      if (header.alg !== 'RS256' || !s) return null;
      const key = await signingKey(header.kid);
      if (!key) return null;
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(s), enc.encode(`${h}.${p}`));
      if (!ok) return null;
    }
    if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`) return null;
    if (!claims.sub || claims.exp <= now || claims.iat > now + 300) return null;
    return { ...claims, uid: claims.sub };
  } catch {
    return null;
  }
}
