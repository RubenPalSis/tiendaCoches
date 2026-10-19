// Cálculo de gastos de envío a partir de las reglas configurables (settings/shipping).
// Se usa igual en el navegador (vista previa) y en el servidor (importe que se cobra).
//
// Las agencias (GLS incluida) cobran por el MAYOR entre el peso real y el peso volumétrico
// (largo × ancho × alto en cm / divisor). Cada unidad de un producto se considera un bulto.
//
// Estructura de reglas:
// {
//   carrier: 'GLS',
//   defaultWeight: 2000,               // gramos si un producto no tiene peso
//   volumetricDivisor: 5000,           // cm³ por kg; 0 = solo peso real
//   bulkyLength: 120,                  // cm: lado más largo a partir del cual el bulto es voluminoso; 0 = nunca
//   maxLength: 0,                      // cm: lado más largo que se puede enviar sin presupuesto; 0 = sin límite
//   maxGirth: 0,                       // cm: largo + perímetro (largo + 2×ancho + 2×alto) máximo por bulto; 0 = sin límite
//   maxPackageWeight: 0,               // gramos: peso real máximo por bulto; 0 = sin límite
//   trackingUrlTemplate: 'https://…{tracking}…',
//   zones: [{
//     id, name, active, countries: ['ES'],
//     postalPrefixes: [],              // vacío = todos
//     excludePostalPrefixes: ['07', '35', '38', '51', '52'],
//     rates: [{ maxWeight: 2000, price: 590 }, …],   // gramos / céntimos, ordenados
//     extraKgPrice: 122,               // céntimos por kg (o fracción) por encima del último tramo; 0 = no se envía
//     volumetricDivisor: 3000,         // opcional: divisor propio de la zona (p. ej. Canarias, marítimo)
//     freeOver: 9900,                  // céntimos; 0 o null = sin envío gratis (no incluye el recargo)
//     bulkySurcharge: 1500,            // céntimos por cada bulto voluminoso
//     deliveryTime: '24–72 h laborables',
//   }]
// }

export const DEFAULT_SHIPPING_RULES = {
  carrier: 'GLS',
  defaultWeight: 2000,
  volumetricDivisor: 5000,
  bulkyLength: 120,
  maxLength: 0,
  maxGirth: 0,
  maxPackageWeight: 0,
  trackingUrlTemplate: '',
  zones: [
    {
      id: 'peninsula',
      name: 'Península',
      active: true,
      countries: ['ES'],
      postalPrefixes: [],
      excludePostalPrefixes: ['07', '35', '38', '51', '52'],
      rates: [
        { maxWeight: 2000, price: 0 },
        { maxWeight: 5000, price: 0 },
        { maxWeight: 15000, price: 0 },
        { maxWeight: 30000, price: 0 },
      ],
      freeOver: 0,
      bulkySurcharge: 0,
      deliveryTime: '24–72 h laborables',
    },
  ],
};

function matchesZone(zone, country, postalCode) {
  if (!zone.active || !zone.countries?.includes(country)) return false;
  const cp = String(postalCode ?? '').trim().toUpperCase();
  if (zone.excludePostalPrefixes?.some((p) => p && cp.startsWith(p))) return false;
  if (zone.postalPrefixes?.length) return zone.postalPrefixes.some((p) => p && cp.startsWith(p));
  return true;
}

export function findZone(rules, country, postalCode) {
  return (rules?.zones ?? []).find((z) => matchesZone(z, country, postalCode)) ?? null;
}

export function shippableCountries(rules) {
  const set = new Set();
  for (const z of rules?.zones ?? []) if (z.active) z.countries?.forEach((c) => set.add(c));
  return [...set];
}

/** Medidas de una entrada del índice público ({ dims: [l, a, h] }) en el formato de calculateShipping. */
export const dimsOf = (entry) => (entry?.dims?.length === 3
  ? { length: entry.dims[0], width: entry.dims[1], height: entry.dims[2] }
  : {});

/** Medidas del bulto en cm, de mayor a menor (lado más largo primero); [] si no tiene medidas. */
export function packageDims(item) {
  const dims = [item.length, item.width, item.height].map((v) => Number(v) || 0);
  return dims.every((v) => v > 0) ? dims.sort((a, b) => b - a) : [];
}

/** Peso volumétrico de un bulto en gramos (0 si no tiene medidas o está desactivado). */
export function volumetricWeight(rules, item, zone) {
  const divisor = zone?.volumetricDivisor || (rules?.volumetricDivisor ?? DEFAULT_SHIPPING_RULES.volumetricDivisor);
  const dims = packageDims(item);
  if (!divisor || !dims.length) return 0;
  return Math.ceil((dims[0] * dims[1] * dims[2] * 1000) / divisor);
}

const realWeight = (rules, item) => (item.weight > 0 ? item.weight : (rules?.defaultWeight ?? 2000));

/** Peso que cobra la agencia por un bulto: el mayor entre el real y el volumétrico (gramos). */
export function billableWeight(rules, item, zone) {
  return Math.max(realWeight(rules, item), volumetricWeight(rules, item, zone));
}

export function isBulky(rules, item) {
  const limit = rules?.bulkyLength ?? DEFAULT_SHIPPING_RULES.bulkyLength;
  return limit > 0 && (packageDims(item)[0] ?? 0) > limit;
}

/** Largo + perímetro de un bulto en cm (largo + 2 × ancho + 2 × alto); 0 si no tiene medidas. */
export function girth(item) {
  const [l, w, h] = packageDims(item);
  return l ? l + 2 * w + 2 * h : 0;
}

/** Motivo por el que un bulto no se puede enviar con la tarifa (medidas o peso por bulto), o null. */
export function packageProblem(rules, item) {
  const maxLength = rules?.maxLength ?? 0;
  if (maxLength > 0 && (packageDims(item)[0] ?? 0) > maxLength) return `mide más de ${maxLength} cm`;
  const maxGirth = rules?.maxGirth ?? 0;
  if (maxGirth > 0 && girth(item) > maxGirth) return `su largo + perímetro (${girth(item)} cm) supera ${maxGirth} cm`;
  const maxWeight = rules?.maxPackageWeight ?? 0;
  if (maxWeight > 0 && realWeight(rules, item) > maxWeight) return `pesa más de ${maxWeight / 1000} kg`;
  return null;
}

/** Peso facturable total del pedido (gramos). */
export function totalWeight(rules, items, zone) {
  return items.reduce((sum, it) => sum + billableWeight(rules, it, zone) * it.quantity, 0);
}

/** Precio de la zona para un peso: su tramo o, por encima del último, el último + kg adicionales. */
export function ratePrice(zone, weight) {
  const rates = [...(zone.rates ?? [])].sort((a, b) => a.maxWeight - b.maxWeight);
  const rate = rates.find((r) => weight <= r.maxWeight);
  if (rate) return rate.price;
  const last = rates.at(-1);
  if (!last || !(zone.extraKgPrice > 0)) return null;
  return last.price + Math.ceil((weight - last.maxWeight) / 1000) * zone.extraKgPrice;
}

/**
 * @param rules  settings/shipping
 * @param input  { items: [{ weight, length, width, height, quantity }], subtotal, country, postalCode }
 * @returns { ok: true, cost, free, zone, weight, realWeight, bulky, surcharge } | { ok: false, reason, message }
 */
export function calculateShipping(rules, { items, subtotal, country, postalCode }) {
  const zone = findZone(rules, country, postalCode);
  if (!zone) {
    return { ok: false, reason: 'no_zone', message: 'Lo sentimos, todavía no enviamos a esta dirección.' };
  }
  if (items.some((it) => packageProblem(rules, it))) {
    return {
      ok: false,
      reason: 'too_big',
      message: 'Alguna pieza supera las medidas o el peso máximo de envío por paquete. Contacta con nosotros y te daremos un presupuesto.',
    };
  }
  const weight = totalWeight(rules, items, zone);
  const real = items.reduce((sum, it) => sum + realWeight(rules, it) * it.quantity, 0);
  const price = ratePrice(zone, weight);
  if (price == null) {
    return {
      ok: false,
      reason: 'too_heavy',
      message: 'El pedido supera el peso máximo de envío. Contacta con nosotros y te daremos un presupuesto.',
    };
  }
  const bulky = items.reduce((sum, it) => sum + (isBulky(rules, it) ? it.quantity : 0), 0);
  // El recargo por bulto voluminoso se cobra siempre: la agencia lo cobra aunque el envío sea gratis.
  const surcharge = bulky * (zone.bulkySurcharge ?? 0);
  const free = zone.freeOver > 0 && subtotal >= zone.freeOver;
  return { ok: true, cost: (free ? 0 : price) + surcharge, free, zone, weight, realWeight: real, bulky, surcharge };
}

/** Importe de envío más bajo de la zona principal, para mostrar "Envío desde X". */
export function cheapestRate(rules) {
  const zone = (rules?.zones ?? []).find((z) => z.active);
  if (!zone?.rates?.length) return null;
  return Math.min(...zone.rates.map((r) => r.price));
}

export function freeShippingThreshold(rules) {
  const zone = (rules?.zones ?? []).find((z) => z.active);
  return zone?.freeOver > 0 ? zone.freeOver : null;
}

export function trackingUrl(rules, trackingNumber) {
  const tpl = rules?.trackingUrlTemplate;
  if (!tpl || !trackingNumber) return '';
  return tpl.replace('{tracking}', encodeURIComponent(trackingNumber));
}
