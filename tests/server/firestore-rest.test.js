// Capa REST de Firestore (server/src/lib/firestore.js) contra el emulador: mismas semánticas que firebase-admin.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearFirestore } from './helpers.js';

process.env.GCLOUD_PROJECT = 'demo-tienda-rest';

const { db, FieldValue, Timestamp } = await import('../../server/src/lib/firestore.js');

beforeEach(clearFirestore);

test('set, get y tipos de datos (enteros, decimales, fechas, mapas, listas, null)', async () => {
  const when = Timestamp.fromMillis(1760000000123);
  await db.doc('t/a').set({ n: 5, d: 1.5, s: 'hola', b: true, z: null, when, list: [1, 'x', { y: 2 }], map: { k: 'v', inner: { deep: 1 } }, empty: [] });
  const snap = await db.doc('t/a').get();
  assert.equal(snap.exists, true);
  const d = snap.data();
  assert.deepEqual({ ...d, when: undefined }, { n: 5, d: 1.5, s: 'hola', b: true, z: null, when: undefined, list: [1, 'x', { y: 2 }], map: { k: 'v', inner: { deep: 1 } }, empty: [] });
  assert.ok(d.when instanceof Timestamp);
  assert.equal(d.when.toMillis(), 1760000000123);
  assert.equal((await db.doc('t/missing').get()).exists, false);
});

test('set con merge fusiona mapas en profundidad; update sustituye el mapa y admite rutas con punto', async () => {
  await db.doc('t/b').set({ a: { x: 1, y: 2 }, keep: 1 });
  await db.doc('t/b').set({ a: { y: 3, z: 4 } }, { merge: true });
  assert.deepEqual((await db.doc('t/b').get()).data(), { a: { x: 1, y: 3, z: 4 }, keep: 1 });
  await db.doc('t/b').update({ 'a.x': 9 });
  assert.deepEqual((await db.doc('t/b').get()).data().a, { x: 9, y: 3, z: 4 });
  await db.doc('t/b').update({ a: { only: true } });
  assert.deepEqual((await db.doc('t/b').get()).data().a, { only: true });
  await assert.rejects(db.doc('t/none').update({ a: 1 }), /404|NOT_FOUND/);
});

test('FieldValue: increment (también anidado), serverTimestamp, arrayUnion y delete', async () => {
  await db.doc('t/c').set({ stock: 3, tags: ['a'], gone: 'x' });
  await db.doc('t/c').update({
    stock: FieldValue.increment(-1), at: FieldValue.serverTimestamp(), tags: FieldValue.arrayUnion('a', 'b'), gone: FieldValue.delete(),
  });
  await db.doc('t/c').set({ views: { '123abc': FieldValue.increment(2), other: FieldValue.increment(1) } }, { merge: true });
  await db.doc('t/c').set({ views: { '123abc': FieldValue.increment(1) } }, { merge: true });
  const d = (await db.doc('t/c').get()).data();
  assert.equal(d.stock, 2);
  assert.ok(d.at instanceof Timestamp);
  assert.deepEqual(d.tags, ['a', 'b']);
  assert.equal('gone' in d, false);
  assert.deepEqual(d.views, { '123abc': 3, other: 1 });
});

test('consultas con varios filtros, límite y recuento', async () => {
  const batch = db.batch();
  for (let i = 0; i < 6; i += 1) batch.set(db.collection('orders').doc(`o${i}`), { status: i % 2 ? 'paid' : 'pending', n: i, customer: { email: i < 2 ? 'a@x.com' : 'b@x.com' } });
  await batch.commit();
  const pending = await db.collection('orders').where('status', '==', 'pending').where('n', '<', 4).get();
  assert.deepEqual(pending.docs.map((d) => d.id).sort(), ['o0', 'o2']);
  const one = await db.collection('orders').where('customer.email', '==', 'a@x.com').limit(1).get();
  assert.equal(one.size, 1);
  assert.equal((await db.collection('orders').where('status', '==', 'paid').count().get()).data().count, 3);
  await one.docs[0].ref.update({ touched: true });
  assert.equal((await one.docs[0].ref.get()).data().touched, true);
});

test('transacciones: las concurrentes no pierden escrituras (se reintentan)', async () => {
  await db.doc('t/counter').set({ seq: 0 });
  await Promise.all(Array.from({ length: 8 }, () => db.runTransaction(async (tx) => {
    const snap = await tx.get(db.doc('t/counter'));
    tx.set(db.doc('t/counter'), { seq: snap.data().seq + 1 }, { merge: true });
  })));
  assert.equal((await db.doc('t/counter').get()).data().seq, 8);
});

test('transacciones: un error dentro anula todas las escrituras', async () => {
  await db.doc('t/d').set({ v: 1 });
  await assert.rejects(db.runTransaction(async (tx) => {
    const [snap] = await tx.getAll(db.doc('t/d'));
    tx.update(db.doc('t/d'), { v: snap.data().v + 1 });
    throw new Error('fallo');
  }), /fallo/);
  assert.equal((await db.doc('t/d').get()).data().v, 1);
  assert.equal(db.collection('orders').doc().id.length, 20);
});
