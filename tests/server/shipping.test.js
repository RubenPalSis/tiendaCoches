// Cálculo de gastos de envío: peso real, peso volumétrico, piezas voluminosas y medida máxima.
// No necesita emuladores: node --test tests/server/shipping.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateShipping, billableWeight, volumetricWeight, isBulky, dimsOf } from '../../public/js/shared/shipping.js';
import { toIndexEntry } from '../../public/js/shared/catalog.js';

const RULES = {
  carrier: 'GLS', defaultWeight: 2000, volumetricDivisor: 5000, bulkyLength: 120, maxLength: 250,
  zones: [{
    id: 'peninsula', name: 'Península', active: true, countries: ['ES'], postalPrefixes: [], excludePostalPrefixes: ['07'],
    rates: [{ maxWeight: 2000, price: 500 }, { maxWeight: 10000, price: 900 }, { maxWeight: 40000, price: 1900 }, { maxWeight: 100000, price: 3900 }],
    freeOver: 20000, bulkySurcharge: 1500, deliveryTime: '24-72h',
  }],
};
const ship = (items, subtotal = 5000) => calculateShipping(RULES, { items, subtotal, country: 'ES', postalCode: '28013' });

test('sin medidas: se cobra por peso real (como antes)', () => {
  const r = ship([{ weight: 1500, quantity: 1 }]);
  assert.equal(r.ok, true);
  assert.equal(r.weight, 1500);
  assert.equal(r.cost, 500);
  assert.equal(r.surcharge, 0);
});

test('pieza grande y ligera: cuenta el peso volumétrico (largo × ancho × alto / divisor)', () => {
  const lip = { weight: 3000, length: 100, width: 30, height: 20, quantity: 1 }; // 60.000 cm³ / 5000 = 12 kg
  assert.equal(volumetricWeight(RULES, lip), 12000);
  assert.equal(billableWeight(RULES, lip), 12000);
  const r = ship([lip]);
  assert.equal(r.weight, 12000);
  assert.equal(r.realWeight, 3000);
  assert.equal(r.cost, 1900);
});

test('pieza pequeña y pesada: cuenta el peso real', () => {
  assert.equal(billableWeight(RULES, { weight: 8000, length: 20, width: 20, height: 20 }), 8000);
});

test('divisor 0: solo peso real', () => {
  assert.equal(billableWeight({ ...RULES, volumetricDivisor: 0 }, { weight: 3000, length: 200, width: 60, height: 40 }), 3000);
});

test('medidas incompletas se ignoran', () => {
  assert.equal(volumetricWeight(RULES, { weight: 1000, length: 200, width: 60 }), 0);
});

test('pieza voluminosa: recargo por unidad, también con envío gratis', () => {
  const bumper = { weight: 6000, length: 180, width: 50, height: 30, quantity: 2 }; // 54 kg cada uno → 108 kg
  assert.equal(isBulky(RULES, bumper), true);
  const heavy = ship([{ ...bumper, quantity: 1 }], 25000);
  assert.equal(heavy.free, true);
  assert.equal(heavy.bulky, 1);
  assert.equal(heavy.cost, 1500, 'envío gratis pero se mantiene el recargo');
  const two = ship([bumper]);
  assert.equal(two.ok, false, '108 kg supera el último tramo');
  assert.equal(two.reason, 'too_heavy');
});

test('el lado más largo decide, en cualquier orden', () => {
  assert.equal(isBulky(RULES, { length: 30, width: 150, height: 20 }), true);
  assert.equal(isBulky({ ...RULES, bulkyLength: 0 }, { length: 30, width: 150, height: 20 }), false);
});

test('medida máxima: no se puede pagar online', () => {
  const r = ship([{ weight: 5000, length: 260, width: 20, height: 20, quantity: 1 }]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_big');
});

test('reglas guardadas antes de existir las medidas: divisor 5000 y voluminoso desde 120 cm', () => {
  const old = { defaultWeight: 2000, zones: [{ ...RULES.zones[0], bulkySurcharge: undefined }] };
  const r = calculateShipping(old, { items: [{ weight: 1000, length: 150, width: 20, height: 10, quantity: 1 }], subtotal: 100, country: 'ES', postalCode: '28013' });
  assert.equal(r.weight, 6000);
  assert.equal(r.bulky, 1);
  assert.equal(r.surcharge, 0);
});

test('índice público: las medidas viajan como dims y se recuperan con dimsOf', () => {
  const e = toIndexEntry('p1', { slug: 's', name: 'n', price: 1, weight: 2000, length: 120, width: 40, height: 15 });
  assert.deepEqual(e.dims, [120, 40, 15]);
  assert.deepEqual(dimsOf(e), { length: 120, width: 40, height: 15 });
  assert.equal(toIndexEntry('p2', { slug: 's', name: 'n', price: 1 }).dims, undefined);
});
