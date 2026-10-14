// Arreglo puntual (2026-10-14) de la tienda publicada: scripts/update-categories.js creó las
// categorías nuevas pero no renombró las que ya existían con el mismo id, así que en producción
// seguían «Difusores y paragolpes» (con los paragolpes dentro) y «Taloneras y body kits».
// Se ejecuta en la tarea horaria una sola vez (marca en meta/migrations); después no hace nada.
import { logger } from '../lib/log.js';
import { db, Timestamp } from '../lib/firebase.js';

const MIGRATION = 'categories-2026-10-14';

const CATEGORIES = {
  difusores: { name: 'Difusores', description: 'Difusores traseros deportivos.', order: 4 },
  'bodykit-paragolpes': { name: 'Bodykit y paragolpes', description: 'Paragolpes deportivos y body kits completos.', order: 3 },
  taloneras: { name: 'Añadidos y taloneras', description: 'Añadidos, taloneras y faldones laterales.', order: 5 },
};

const isBumper = (name) => /\b(paragolpes|parachoques|body ?kit|kit (de )?carrocer)/i.test(name) && !/\bdifusor/i.test(name);

export async function fixCategories() {
  const marker = db.doc('meta/migrations');
  if ((await marker.get()).data()?.[MIGRATION]) return { skipped: true };
  const now = Timestamp.now();

  for (const [id, data] of Object.entries(CATEGORIES)) {
    const ref = db.doc(`categories/${id}`);
    if ((await ref.get()).exists) await ref.update({ ...data, active: true, updatedAt: now });
    else await ref.set({ ...data, slug: id, image: '', active: true, createdAt: now, updatedAt: now });
  }

  let moved = 0;
  for (const doc of (await db.collection('products').where('categoryId', '==', 'difusores').get()).docs) {
    if (!isBumper(doc.data().name)) continue;
    await doc.ref.update({ categoryId: 'bodykit-paragolpes', updatedAt: now });
    moved += 1;
  }

  await marker.set({ [MIGRATION]: now }, { merge: true });
  logger.info('Categorías corregidas', { moved });
  return { moved };
}
