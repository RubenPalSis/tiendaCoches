import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { REGION, TIMEZONE } from '../lib/config.js';
import { releaseStaleReservations } from './order-service.js';
import { revokeRemovedAdmins } from '../admin/claims.js';

// Tarea horaria: libera reservas caducadas cuyo webhook no llegó y retira el rol a administradores
// eliminados de ADMIN_EMAILS.
// Cloud Scheduler incluye 3 tareas gratuitas por cuenta de facturación; esta es la única.
export const releaseExpiredReservations = onSchedule(
  { schedule: 'every 60 minutes', timeZone: TIMEZONE, region: REGION },
  async () => {
    const released = await releaseStaleReservations();
    if (released) logger.info(`Reservas liberadas: ${released}`);
    const revoked = await revokeRemovedAdmins();
    if (revoked) logger.info(`Administradores revocados: ${revoked}`);
  },
);
