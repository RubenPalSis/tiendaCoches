// Aplicación automática de la tarifa GLS 2026 a settings/shipping (server/src/shipping/gls-tariff.js).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearFirestore } from './helpers.js';

process.env.GCLOUD_PROJECT = 'demo-tienda-test-gls';

const { db, FieldValue } = await import('../../server/src/lib/firebase.js');
const { applyGlsTariff, GLS_MIGRATION, GLS_EXTRA_KG_MIGRATION, GLS_NO_GIRTH_MIGRATION } = await import('../../server/src/shipping/gls-tariff.js');
const { getSettings } = await import('../../server/src/lib/settings.js');
const { calculateShipping } = await import('../../server/src/shared/shipping.js');
const { GLS_TRACKING_URL } = await import('../../server/src/shared/gls-tariff.js');

const OLD = {
  carrier: 'Otra', trackingUrlTemplate: '', defaultWeight: 2000, volumetricDivisor: 6000, bulkyLength: 130, maxLength: 0,
  zones: [
    { id: 'peninsula', name: 'Península', active: true, countries: ['ES'], postalPrefixes: [], excludePostalPrefixes: ['07'],
      rates: [{ maxWeight: 30000, price: 595 }], freeOver: 12000, bulkySurcharge: 1500, deliveryTime: '24–72 h' },
    { id: 'ceuta-melilla', name: 'Ceuta y Melilla', active: false, countries: ['ES'], postalPrefixes: ['51', '52'], rates: [{ maxWeight: 1000, price: 3787 }] },
  ],
};
const shippingDoc = async () => (await db.doc('settings/shipping').get()).data();

beforeEach(() => clearFirestore());

test('sustituye zonas y precios por la tarifa y conserva lo demás', async () => {
  await db.doc('settings/shipping').set(OLD);
  await db.doc('settings/store').set({ name: 'Mi tienda' });
  assert.deepEqual(await applyGlsTariff(), { applied: true, zones: 8 });

  const s = await shippingDoc();
  assert.equal(s.carrier, 'GLS');
  assert.equal(s.trackingUrlTemplate, GLS_TRACKING_URL);
  assert.equal(s.volumetricDivisor, 5000);
  assert.equal(s.maxGirth, 0);
  assert.equal(s.maxPackageWeight, 40000);
  assert.equal(s.bulkyLength, 130, 'ajuste que no es de la tarifa');
  assert.deepEqual(s.zones.map((z) => z.id), ['peninsula', 'baleares-mayores', 'baleares-menores', 'canarias', 'ceuta', 'melilla', 'portugal', 'andorra']);
  const pen = s.zones[0];
  assert.deepEqual(pen.rates.map((r) => r.price), [957, 997, 1117, 1437, 1849]);
  assert.equal(pen.freeOver, 12000);
  assert.equal(pen.bulkySurcharge, 1500);
  assert.deepEqual(s.zones.filter((z) => z.active).map((z) => z.id), ['peninsula', 'baleares-mayores', 'baleares-menores', 'portugal']);
  assert.deepEqual(s.zones.find((z) => z.id === 'ceuta').rates, [], 'sin el precio antiguo de Ceuta y Melilla');

  assert.deepEqual((await db.doc('meta/shipping-before-gls-business-parcel-2026').get()).data(), OLD, 'copia de seguridad');
  assert.deepEqual((await db.doc('settings/store').get()).data(), { name: 'Mi tienda' }, 'otros ajustes intactos');
  assert.equal(pen.extraKgPrice, 122);
  const marks = (await db.doc('meta/migrations').get()).data();
  assert.ok(marks[GLS_MIGRATION] && marks[GLS_EXTRA_KG_MIGRATION] && marks[GLS_NO_GIRTH_MIGRATION]);
});

test('tienda con la tarifa ya aplicada sin kg adicional: lo añade una vez y respeta al vendedor', async () => {
  await applyGlsTariff();
  const before = await shippingDoc();
  // Como quedó la tarifa antes del kg adicional; el vendedor puso el suyo en Portugal.
  const zones = before.zones.map((z) => ({ ...z, extraKgPrice: z.id === 'portugal' ? 200 : 0 }));
  await db.doc('settings/shipping').set({ ...before, zones });
  await db.doc('meta/migrations').update({ [GLS_EXTRA_KG_MIGRATION]: FieldValue.delete() });

  assert.deepEqual(await applyGlsTariff(), { applied: true, fixes: [GLS_EXTRA_KG_MIGRATION] });
  const s = await shippingDoc();
  const extra = (id) => s.zones.find((z) => z.id === id).extraKgPrice;
  assert.equal(extra('peninsula'), 122);
  assert.equal(extra('baleares-mayores'), 767);
  assert.equal(extra('portugal'), 200, 'precio del vendedor');
  assert.equal(extra('ceuta'), 0, 'zona sin tramos');
  assert.deepEqual(s.zones.map((z) => z.rates), before.zones.map((z) => z.rates), 'tramos intactos');

  await db.doc('settings/shipping').set({ ...s, zones: s.zones.map((z) => ({ ...z, extraKgPrice: 0 })) });
  assert.deepEqual(await applyGlsTariff(), { skipped: true });
  assert.equal((await shippingDoc()).zones[0].extraKgPrice, 0, 'si el vendedor lo quita después, no vuelve');
});

test('tienda con el límite de 300 cm de la tarifa: lo quita una vez; respeta otro límite del vendedor', async () => {
  await applyGlsTariff();
  const before = await shippingDoc();
  await db.doc('settings/shipping').set({ ...before, maxGirth: 300 });
  await db.doc('meta/migrations').update({ [GLS_NO_GIRTH_MIGRATION]: FieldValue.delete() });

  assert.deepEqual(await applyGlsTariff(), { applied: true, fixes: [GLS_NO_GIRTH_MIGRATION] });
  assert.deepEqual(await shippingDoc(), before, 'solo cambia maxGirth');
  const at = (rules) => calculateShipping(rules, { items: [{ weight: 8000, length: 190, width: 30, height: 30, quantity: 1 }], subtotal: 1, country: 'ES', postalCode: '28013' });
  assert.equal(at(await shippingDoc()).cost, 4191, 'el paragolpes de 190 × 30 × 30 ya se puede pagar');

  await db.doc('settings/shipping').set({ ...before, maxGirth: 250 });
  await db.doc('meta/migrations').update({ [GLS_NO_GIRTH_MIGRATION]: FieldValue.delete() });
  await applyGlsTariff();
  assert.equal((await shippingDoc()).maxGirth, 250, 'límite propio del vendedor');
});

test('una sola vez: no duplica zonas ni pisa lo que cambie después el vendedor', async () => {
  await applyGlsTariff();
  const first = await shippingDoc();
  assert.equal(first.zones.length, 8);
  const edited = { ...first, zones: first.zones.map((z) => (z.id === 'peninsula' ? { ...z, rates: [{ maxWeight: 15000, price: 1000 }] } : z)) };
  await db.doc('settings/shipping').set(edited);

  assert.deepEqual(await applyGlsTariff(), { skipped: true });
  assert.deepEqual(await Promise.all([applyGlsTariff(), applyGlsTariff()]), [{ skipped: true }, { skipped: true }]);
  assert.deepEqual(await shippingDoc(), edited);
});

test('a la vez desde dos instancias: se aplica una vez', async () => {
  await db.doc('settings/shipping').set(OLD);
  const results = await Promise.all([applyGlsTariff(), applyGlsTariff(), applyGlsTariff()]);
  assert.equal(results.filter((r) => r.applied).length, 1);
  assert.equal((await shippingDoc()).zones.length, 8);
});

test('sin envíos configurados: la tienda queda configurada con la tarifa', async () => {
  assert.equal((await applyGlsTariff()).applied, true);
  assert.equal((await db.doc('meta/shipping-before-gls-business-parcel-2026').get()).exists, false);
  assert.equal((await shippingDoc()).zones.length, 8);
});

test('getSettings (checkout y catálogo) lee ya la tarifa nueva y se mantiene al recargar', async () => {
  await db.doc('settings/shipping').set(OLD);
  const rules = await getSettings('shipping', { fresh: true });
  assert.equal(rules.configured, true);
  assert.equal(rules.carrier, 'GLS');
  const at = (postalCode, country = 'ES') => calculateShipping(rules, { items: [{ weight: 1000, quantity: 1 }], subtotal: 5000, country, postalCode });
  assert.equal(at('28013').cost, 957);
  assert.equal(at('07001').cost, 1482);
  assert.equal(at('07701').cost, 1923);
  assert.equal(at('1100-001', 'PT').cost, 1026);
  assert.equal(at('35001').ok, false);
  assert.equal(at('51001').ok, false);
  // «Recargar»: otra lectura desde Firestore devuelve lo mismo.
  assert.deepEqual((await getSettings('shipping', { fresh: true })).zones, rules.zones);
});
