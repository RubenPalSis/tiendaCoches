// Protocolo de las funciones "callable" de Firebase implementado en el Worker:
// el panel sigue usando httpsCallableFromURL() del SDK web (envía { data } y el token de sesión,
// espera { result } o { error: { status, message } }).
import { verifyIdToken } from './google-auth.js';
import { logger } from './log.js';

const STATUS = {
  'invalid-argument': [400, 'INVALID_ARGUMENT'],
  'failed-precondition': [400, 'FAILED_PRECONDITION'],
  unauthenticated: [401, 'UNAUTHENTICATED'],
  'permission-denied': [403, 'PERMISSION_DENIED'],
  'not-found': [404, 'NOT_FOUND'],
  'resource-exhausted': [429, 'RESOURCE_EXHAUSTED'],
  internal: [500, 'INTERNAL'],
  unavailable: [503, 'UNAVAILABLE'],
};

export class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

/** Convierte un manejador (request: { data, auth }) en un manejador de Request. */
export function onCall(handler) {
  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: { status: 'INVALID_ARGUMENT', message: 'Método no permitido.' } });
    let data = null;
    try { data = (await request.json())?.data ?? null; } catch { /* cuerpo vacío o no JSON */ }
    const bearer = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    const token = bearer ? await verifyIdToken(bearer) : null;
    if (bearer && !token) return json(401, { error: { status: 'UNAUTHENTICATED', message: 'Sesión no válida. Vuelve a entrar.' } });
    try {
      const result = await handler({ data, auth: token ? { uid: token.uid, token } : null });
      return json(200, { result: result ?? null });
    } catch (err) {
      if (!(err instanceof HttpsError)) logger.error('Error en función del panel', err);
      const e = err instanceof HttpsError ? err : new HttpsError('internal', 'Error inesperado. Inténtalo de nuevo.');
      const [status, name] = STATUS[e.code] ?? STATUS.internal;
      return json(status, { error: { status: name, message: e.message, ...(e.details ? { details: e.details } : {}) } });
    }
  };
}
