// Cálculo de gastos de envío: peso real, peso volumétrico, piezas voluminosas y medida máxima.
// No necesita emuladores: node --test tests/server/shipping.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateShipping, billableWeight, volumetricWeight, isBulky, dimsOf, findZone } from '../../public/js/shared/shipping.js';
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

test('kg adicional: por encima del último tramo se suma cada kg (o fracción)', () => {
  const zone = { ...RULES.zones[0], rates: [{ maxWeight: 15000, price: 1849 }], extraKgPrice: 122 };
  const rules = { ...RULES, zones: [zone] };
  const r = calculateShipping(rules, { items: [{ weight: 20500, quantity: 1 }], subtotal: 100, country: 'ES', postalCode: '28013' });
  assert.equal(r.cost, 1849 + 6 * 122, '20,5 kg → 6 kg adicionales');
});

test('límites por paquete de GLS: largo + perímetro 300 cm y 40 kg', async () => {
  const { girth, packageProblem } = await import('../../public/js/shared/shipping.js');
  const rules = { ...RULES, maxLength: 0, maxGirth: 300, maxPackageWeight: 40000 };
  assert.equal(girth({ length: 200, width: 30, height: 20 }), 300);
  assert.equal(packageProblem(rules, { weight: 3000, length: 200, width: 30, height: 20 }), null, 'justo 300 cm sí se envía');
  assert.match(packageProblem(rules, { weight: 6000, length: 190, width: 60, height: 50 }), /410 cm/);
  assert.match(packageProblem(rules, { weight: 41000 }), /40 kg/);
  const r = calculateShipping(rules, { items: [{ weight: 6000, length: 190, width: 60, height: 50, quantity: 1 }], subtotal: 1, country: 'ES', postalCode: '28013' });
  assert.equal(r.reason, 'too_big');
});

test('divisor volumétrico propio de la zona (Canarias marítimo)', () => {
  const zone = { ...RULES.zones[0], volumetricDivisor: 3000 };
  assert.equal(volumetricWeight(RULES, { length: 60, width: 50, height: 30 }, zone), 30000);
  assert.equal(volumetricWeight(RULES, { length: 60, width: 50, height: 30 }), 18000);
});

// ---------- Tarifa GLS Business Parcel 2026 (public/js/shared/gls-tariff.js) ----------
const { glsShippingRules, GLS_ZONES, GLS_TRACKING_URL, withIva } = await import('../../public/js/shared/gls-tariff.js');
const GLS = glsShippingRules({ bulkyLength: 120, zones: [{ id: 'peninsula', freeOver: 15000, deliveryTime: '48 h' }] });
const gls = (postalCode, items = [{ weight: 1000, quantity: 1 }], country = 'ES', rules = GLS) =>
  calculateShipping(rules, { items, subtotal: 5000, country, postalCode });
const allActive = { ...GLS, zones: GLS.zones.map((z) => ({ ...z, active: true })) };

test('GLS 2026: precios del documento × 1,21 redondeados al céntimo (sin IVA doble)', () => {
  const prices = (id) => GLS.zones.find((z) => z.id === id).rates.map((r) => r.price);
  assert.deepEqual(prices('peninsula'), [957, 997, 1117, 1437, 1849]); // 7,91 8,24 9,23 11,88 15,28 sin IVA
  assert.deepEqual(prices('baleares-mayores'), [1482]); // 12,25
  assert.deepEqual(prices('baleares-menores'), [1923]); // 15,89
  assert.deepEqual(prices('portugal'), [1026, 1071, 1198, 1542, 1984]); // 8,48 8,85 9,90 12,74 16,40
  // Fuera del territorio del IVA: sin IVA y desactivadas.
  assert.deepEqual(prices('canarias'), [2452]);
  assert.deepEqual(prices('andorra'), [1939, 1939, 1939, 1939, 2544]);
  assert.equal(withIva(1225), 1482);
  // Aplicar la tarifa sobre unas reglas que ya la tienen no vuelve a sumar el IVA.
  assert.deepEqual(glsShippingRules(GLS).zones, GLS.zones);
  // El checkout cobra el precio guardado tal cual.
  assert.equal(gls('28013').cost, 957);
});

test('GLS 2026: cada destino cae en su zona y en una sola', () => {
  const zone = (cp, country = 'ES') => findZone(allActive, country, cp)?.id;
  assert.equal(zone('28013'), 'peninsula');
  assert.equal(zone('08001'), 'peninsula');
  assert.equal(zone('07001'), 'baleares-mayores'); // Palma
  assert.equal(zone('07760'), 'baleares-menores'); // Ciutadella
  assert.equal(zone('07800'), 'baleares-menores'); // Ibiza
  assert.equal(zone('07860'), 'baleares-menores'); // Formentera
  assert.equal(zone('35001'), 'canarias');
  assert.equal(zone('38001'), 'canarias');
  assert.equal(zone('51001'), 'ceuta');
  assert.equal(zone('52001'), 'melilla');
  assert.equal(zone('1000-001', 'PT'), 'portugal');
  assert.equal(zone('4000-001', 'PT'), 'portugal');
  assert.equal(zone('AD500', 'AD'), 'andorra');
  // Sin solapamientos: todos los prefijos de 2 y 3 cifras de España y Portugal encajan en una sola zona.
  for (let i = 0; i < 1000; i += 1) {
    const cp = String(i).padStart(3, '0');
    const es = allActive.zones.filter((z) => findZone({ zones: [z] }, 'ES', `${cp}01`));
    assert.equal(es.length, 1, `ES ${cp}: ${es.map((z) => z.id)}`);
    const pt = allActive.zones.filter((z) => findZone({ zones: [z] }, 'PT', `${cp}0-001`));
    assert.ok(pt.length <= 1, `PT ${cp}`);
  }
});

test('GLS 2026: islas, Ceuta y Melilla nunca acaban en Península', () => {
  for (const cp of ['07001', '07701', '07800', '35001', '38001', '51001', '52001']) {
    const r = gls(cp);
    assert.notEqual(r.zone?.id, 'peninsula', cp);
  }
  // Canarias, Ceuta, Melilla y Andorra se crean desactivadas: no se puede pagar.
  for (const [cp, c] of [['35001', 'ES'], ['38001', 'ES'], ['51001', 'ES'], ['52001', 'ES'], ['AD500', 'AD']]) {
    assert.equal(gls(cp, undefined, c).ok, false, cp);
  }
  // Madeira y Azores no tienen precio en el documento.
  assert.equal(gls('9000-001', undefined, 'PT').reason, 'no_zone');
});

test('GLS 2026: kg adicional por encima del último tramo; sin tramos no hay envío', () => {
  // Ceuta y Melilla aunque alguien las active: zona sin tramos.
  assert.equal(gls('51001', undefined, 'ES', allActive).reason, 'no_rate');
  assert.equal(gls('52001', undefined, 'ES', allActive).reason, 'no_rate');
  // kg adicional con IVA: 1,01 € → 1,22 € (península), 6,34 → 7,67 (Mallorca), 7,36 → 8,91, 1,08 → 1,31 (Portugal).
  const extra = (id) => GLS.zones.find((z) => z.id === id).extraKgPrice;
  assert.deepEqual(['peninsula', 'baleares-mayores', 'baleares-menores', 'portugal'].map(extra), [122, 767, 891, 131]);
  assert.equal(extra('canarias'), 1364, 'sin IVA');
  assert.equal(extra('ceuta'), 0);
  // Baleares solo tiene el tramo de 1 kg; por encima, kg adicional (o fracción).
  assert.equal(gls('07001').cost, 1482);
  assert.equal(gls('07001', [{ weight: 1500, quantity: 1 }]).cost, 1482 + 767);
  assert.equal(gls('07800', [{ weight: 1001, quantity: 1 }]).cost, 1923 + 891);
  // Península y Portugal: tramos hasta 15 kg y kg adicional.
  assert.equal(gls('28013', [{ weight: 15000, quantity: 1 }]).cost, 1849);
  assert.equal(gls('28013', [{ weight: 15001, quantity: 1 }]).cost, 1849 + 122);
  assert.equal(gls('1000-001', [{ weight: 16000, quantity: 1 }], 'PT').cost, 1984 + 131);
  // Paragolpes con medidas «Grande» (120 × 50 × 30, 6 kg): 36 kg volumétricos → 21 kg adicionales.
  assert.equal(gls('28013', [{ weight: 6000, length: 120, width: 50, height: 30, quantity: 1 }]).cost, 1849 + 21 * 122);
});

test('GLS 2026: peso facturable, divisores y límites por paquete', () => {
  assert.equal(GLS.volumetricDivisor, 5000);
  assert.equal(GLS.maxGirth, 300);
  assert.equal(GLS.maxPackageWeight, 40000);
  assert.equal(GLS.zones.find((z) => z.id === 'canarias').volumetricDivisor, 3000);
  assert.ok(GLS.zones.filter((z) => z.id !== 'canarias').every((z) => z.volumetricDivisor === 0), 'el resto usa el general');
  // Lip 100 × 30 × 20 (2 kg): 60.000 cm³ / 5000 = 12 kg → tramo de 15 kg.
  const lip = { weight: 2000, length: 100, width: 30, height: 20, quantity: 1 };
  assert.equal(gls('28013', [lip]).weight, 12000);
  assert.equal(gls('28013', [lip]).cost, 1849);
  // En Canarias el mismo bulto pesa 20 kg (divisor 3000).
  assert.equal(billableWeight(GLS, lip, GLS.zones.find((z) => z.id === 'canarias')), 20000);
  // Varios artículos: cada unidad es un bulto y se suman sus pesos facturables (no sus medidas).
  const box = { weight: 2000, length: 30, width: 20, height: 20, quantity: 3 }; // 12.000 cm³ / 5000 = 2,4 kg > 2 kg reales
  assert.equal(gls('28013', [box]).weight, 3 * 2400);
  assert.equal(gls('28013', [box]).cost, 1437); // 7,2 kg → tramo de 10 kg
  // Límites por bulto: 190 × 60 × 50 = 410 cm de largo + perímetro; 41 kg reales.
  assert.equal(gls('28013', [{ weight: 5000, length: 190, width: 60, height: 50, quantity: 1 }]).reason, 'too_big');
  assert.equal(gls('28013', [{ weight: 41000, quantity: 1 }]).reason, 'too_big');
  assert.equal(gls('28013', [{ weight: 40000, length: 100, width: 50, height: 50, quantity: 1 }]).cost, 1849 + 35 * 122, '300 cm justos caben: 50 kg vol.');
});

test('GLS 2026: transportista, seguimiento oficial y datos del vendedor que se conservan', () => {
  assert.equal(GLS.carrier, 'GLS');
  assert.equal(GLS.trackingUrlTemplate, GLS_TRACKING_URL);
  assert.ok(GLS_TRACKING_URL.startsWith('https://www.gls-group.com/ES/'));
  const pen = GLS.zones.find((z) => z.id === 'peninsula');
  assert.equal(pen.freeOver, 15000);
  assert.equal(pen.deliveryTime, '48 h');
  assert.equal(GLS.bulkyLength, 120);
  const custom = glsShippingRules({ trackingUrlTemplate: 'https://mi.enlace/{tracking}', maxLength: 250, zones: [{ id: 'otra', countries: ['ES'] }] });
  assert.equal(custom.trackingUrlTemplate, 'https://mi.enlace/{tracking}');
  assert.equal(custom.maxLength, 250);
  assert.deepEqual(custom.zones.map((z) => z.id), GLS_ZONES.map((z) => z.id), 'las zonas ajenas se quitan (no se solapan)');
  assert.equal(new Set(custom.zones.map((z) => z.id)).size, custom.zones.length, 'sin zonas duplicadas');
});
