// Cálculo de gastos de envío a partir de las reglas configurables (settings/shipping).
// Se usa igual en el navegador (vista previa) y en el servidor (importe que se cobra).
//
// Estructura de reglas:
// {
//   carrier: 'GLS',
//   defaultWeight: 2000,               // gramos si un producto no tiene peso
//   trackingUrlTemplate: 'https://…{tracking}…',
//   zones: [{
//     id, name, active, countries: ['ES'],
//     postalPrefixes: [],              // vacío = todos
//     excludePostalPrefixes: ['07', '35', '38', '51', '52'],
//     rates: [{ maxWeight: 2000, price: 590 }, …],   // gramos / céntimos, ordenados
//     freeOver: 9900,                  // céntimos; 0 o null = sin envío gratis
//     deliveryTime: '24–72 h laborables',
//   }]
// }

export const DEFAULT_SHIPPING_RULES = {
  carrier: 'GLS',
  defaultWeight: 2000,
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

export function totalWeight(rules, items) {
  const fallback = rules?.defaultWeight ?? 2000;
  return items.reduce((sum, it) => sum + (it.weight > 0 ? it.weight : fallback) * it.quantity, 0);
}

/**
 * @param rules  settings/shipping
 * @param input  { items: [{ weight, quantity }], subtotal, country, postalCode }
 * @returns { ok: true, cost, free, zone, weight } | { ok: false, reason, message }
 */
export function calculateShipping(rules, { items, subtotal, country, postalCode }) {
  const zone = findZone(rules, country, postalCode);
  if (!zone) {
    return { ok: false, reason: 'no_zone', message: 'Lo sentimos, todavía no enviamos a esta dirección.' };
  }
  const weight = totalWeight(rules, items);
  const rates = [...(zone.rates ?? [])].sort((a, b) => a.maxWeight - b.maxWeight);
  const rate = rates.find((r) => weight <= r.maxWeight);
  if (!rate) {
    return {
      ok: false,
      reason: 'too_heavy',
      message: 'El pedido supera el peso máximo de envío. Contacta con nosotros y te daremos un presupuesto.',
    };
  }
  const free = zone.freeOver > 0 && subtotal >= zone.freeOver;
  return { ok: true, cost: free ? 0 : rate.price, free, zone, weight };
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
