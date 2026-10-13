// Punto de entrada del servidor de la tienda: un Cloudflare Worker (plan gratuito).
// Los archivos de /public los sirve Cloudflare directamente (Static Assets); aquí solo llegan las
// rutas dinámicas declaradas en wrangler.toml → assets.run_worker_first.
import { setEnv, FIREBASE_WEB_CONFIG, isEmulator, projectId } from './lib/config.js';
import { toReq, createRes } from './lib/express.js';
import { SECURITY_HEADERS } from './lib/security-headers.js';
import { logger } from './lib/log.js';
import { api } from './api/router.js';
import { seo } from './seo/handler.js';
import { stripeWebhook } from './stripe/webhook.js';
import { adminAction } from './admin/order-actions.js';
import { syncAdminClaim } from './admin/claims.js';
import { devUpload, devServe } from './media/media.js';
import { runScheduled } from './orders/scheduled.js';

// Respuestas que Cloudflare guarda en su caché (por centro de datos) durante su s-maxage.
const CACHEABLE = /^\/(api\/catalog|producto\/|categoria\/|sitemap\.xml|robots\.txt)/;

function withSecurityHeaders(response) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
  return res;
}

/** Ejecuta un manejador al estilo Express (req, res) y devuelve un Response. */
async function express(handler, request) {
  const req = await toReq(request);
  const res = createRes();
  await handler(req, res);
  return res.toResponse();
}

/** Caché de Cloudflare para GET: usa s-maxage como duración en la caché y max-age para el navegador. */
async function cached(request, ctx, produce) {
  const cache = globalThis.caches?.default;
  // En local (emuladores) sin caché: los cambios se ven al momento.
  if (!cache || request.method !== 'GET' || isEmulator()) return produce();
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await produce();
  const sMaxAge = /s-maxage=(\d+)/.exec(response.headers.get('Cache-Control') ?? '')?.[1];
  if (response.status === 200 && sMaxAge) {
    const copy = new Response(response.clone().body, response);
    copy.headers.set('Cache-Control', `public, max-age=${sMaxAge}`);
    ctx.waitUntil(cache.put(request, copy));
  }
  return response;
}

function firebaseWebConfig() {
  let config = null;
  try { config = JSON.parse(FIREBASE_WEB_CONFIG.value() || 'null'); } catch { /* JSON mal escrito */ }
  if (!config && isEmulator()) config = { apiKey: 'demo-key', authDomain: `${projectId()}.firebaseapp.com`, projectId: projectId() };
  if (!config) return Response.json({ error: 'Falta FIREBASE_WEB_CONFIG en wrangler.toml' }, { status: 503 });
  return Response.json(config, { headers: { 'Cache-Control': 'public, max-age=600' } });
}

async function route(request, env, ctx) {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith('/api/')) return cached(request, ctx, () => express(api, request));
  if (pathname === '/stripe/webhook') return express(stripeWebhook, request);
  if (pathname === '/fn/adminAction') {
    const response = await adminAction(request);
    // Tras cambios del panel, el catálogo de este centro de datos (el del administrador) se refresca al momento.
    if (response.ok && globalThis.caches?.default) ctx.waitUntil(caches.default.delete(new URL('/api/catalog', request.url)));
    return response;
  }
  if (pathname === '/fn/syncAdminClaim') return syncAdminClaim(request);
  if (pathname === '/__/firebase/init.json') return firebaseWebConfig();
  if (pathname === '/dev-media/upload' && request.method === 'POST') return devUpload(request);
  if (pathname.startsWith('/dev-media/')) return devServe(request);
  if (CACHEABLE.test(pathname)) return cached(request, ctx, () => express(seo, request));
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    setEnv(env);
    try {
      return withSecurityHeaders(await route(request, env, ctx));
    } catch (err) {
      logger.error('Error no controlado en el Worker', err);
      return withSecurityHeaders(new Response('Error temporal. Inténtalo de nuevo en unos segundos.', { status: 500 }));
    }
  },

  async scheduled(event, env, ctx) {
    setEnv(env);
    ctx.waitUntil(runScheduled());
  },
};
