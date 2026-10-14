import { logger } from '../lib/log.js';
import { releaseStaleReservations, purgeExpired } from './order-service.js';
import { revokeRemovedAdmins } from '../admin/claims.js';
import { rebuildIndex } from '../catalog/catalog-index.js';
import { fixCategories } from '../catalog/fix-categories.js';

// Tarea horaria (Cron Trigger de Cloudflare, incluido en el plan gratuito; ver wrangler.toml):
//  - libera reservas caducadas cuyo webhook no llegó,
//  - borra pedidos nunca pagados (30 días) y eventos de Stripe antiguos (sustituye a las políticas TTL,
//    que en Firestore exigen facturación),
//  - retira el rol a administradores eliminados de ADMIN_EMAILS,
//  - reconstruye el índice del catálogo por si alguna actualización puntual falló
//    (lee todos los productos activos: ~50 lecturas/hora con un catálogo pequeño).
export async function runScheduled() {
  const tasks = {
    released: releaseStaleReservations,
    purged: purgeExpired,
    revoked: revokeRemovedAdmins,
    categories: fixCategories, // puntual; antes de reconstruir el índice
    index: rebuildIndex,
  };
  for (const [name, task] of Object.entries(tasks)) {
    try {
      const result = await task();
      logger.info(`Tarea programada: ${name}`, { result });
    } catch (err) {
      logger.error(`Tarea programada fallida: ${name}`, err);
    }
  }
}
