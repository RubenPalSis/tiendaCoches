// Arreglo puntual de categorías en producción (server/src/catalog/fix-categories.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearFirestore } from './helpers.js';

process.env.GCLOUD_PROJECT = 'demo-tienda-test-fixcat';

const { db } = await import('../../server/src/lib/firebase.js');
const { fixCategories } = await import('../../server/src/catalog/fix-categories.js');

test('renombra las categorías antiguas y pasa los paragolpes de Difusores a Bodykit, una sola vez', async () => {
  await clearFirestore('demo-tienda-test-fixcat');
  await db.doc('categories/difusores').set({ name: 'Difusores y paragolpes', order: 4, active: true });
  await db.doc('categories/taloneras').set({ name: 'Taloneras y body kits', order: 5, active: true });
  await db.doc('products/a').set({ name: 'Paragolpes BMW E39 M5', categoryId: 'difusores' });
  await db.doc('products/b').set({ name: 'Difusor Trasero BMW E39 Doble Salida', categoryId: 'difusores' });
  await db.doc('products/c').set({ name: 'Añadidos Taloneras F10-F11', categoryId: 'taloneras' });

  assert.deepEqual(await fixCategories(), { moved: 1 });
  assert.equal((await db.doc('categories/difusores').get()).data().name, 'Difusores');
  assert.equal((await db.doc('categories/taloneras').get()).data().name, 'Añadidos y taloneras');
  assert.equal((await db.doc('categories/bodykit-paragolpes').get()).data().name, 'Bodykit y paragolpes');
  assert.equal((await db.doc('products/a').get()).data().categoryId, 'bodykit-paragolpes');
  assert.equal((await db.doc('products/b').get()).data().categoryId, 'difusores');
  assert.equal((await db.doc('products/c').get()).data().categoryId, 'taloneras');

  // Si luego el vendedor vuelve a cambiar algo desde el panel, no se pisa.
  await db.doc('products/a').update({ categoryId: 'difusores' });
  assert.deepEqual(await fixCategories(), { skipped: true });
  assert.equal((await db.doc('products/a').get()).data().categoryId, 'difusores');
});
