// Usuarios de Firebase Authentication por API REST (lo que antes hacía firebase-admin/auth):
// leer y cambiar el permiso de administrador (custom claim) y cerrar sesiones.
import { FIREBASE_AUTH_EMULATOR_HOST, projectId } from './config.js';
import { accessToken } from './google-auth.js';

function base() {
  const host = FIREBASE_AUTH_EMULATOR_HOST.value();
  return `${host ? `http://${host}/` : 'https://'}identitytoolkit.googleapis.com/v1/projects/${projectId()}`;
}

async function call(path, body, method = 'POST') {
  const token = FIREBASE_AUTH_EMULATOR_HOST.value() ? 'owner' : await accessToken();
  const res = await fetch(`${base()}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Authentication ${res.status}: ${data?.error?.message ?? ''}`);
  return data;
}

const toUser = (u) => ({
  uid: u.localId,
  email: u.email ?? '',
  emailVerified: !!u.emailVerified,
  customClaims: u.customAttributes ? JSON.parse(u.customAttributes) : {},
});

export const auth = {
  async getUser(uid) {
    const { users = [] } = await call('accounts:lookup', { localId: [uid] });
    if (!users[0]) throw new Error('Usuario no encontrado');
    return toUser(users[0]);
  },
  async setCustomUserClaims(uid, claims) {
    await call('accounts:update', { localId: uid, customAttributes: JSON.stringify(claims ?? {}) });
  },
  async revokeRefreshTokens(uid) {
    await call('accounts:update', { localId: uid, validSince: String(Math.floor(Date.now() / 1000)) });
  },
  async listUsers(maxResults = 1000, pageToken) {
    const qs = new URLSearchParams({ maxResults: String(maxResults), ...(pageToken ? { nextPageToken: pageToken } : {}) });
    const data = await call(`accounts:batchGet?${qs}`, undefined, 'GET');
    return { users: (data.users ?? []).map(toUser), pageToken: data.nextPageToken || undefined };
  },
};
