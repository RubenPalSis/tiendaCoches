// Tarifa GLS Business Parcel 2026 del cliente («Tarifas paqueteria 2026 TI D.pdf», en vigor desde el
// 1 de febrero de 2026). Precios por expedición SIN IVA en céntimos; «Cargar tarifa GLS» los pasa al
// formulario de envíos con el IVA sumado (los precios de la tienda son IVA incluido).
// Reglas de la tarifa: factor volumétrico 200 kg/m³ (divisor 5000; Canarias marítimo 333 kg/m³ → 3000),
// largo + perímetro máximo 300 cm y 40 kg por paquete. Por encima de 15 kg (islas: de 1 kg), «kg adicional».

export const GLS_TARIFF_NAME = 'GLS Business Parcel 2026';
export const IVA = 0.21;

const tiers = (prices) => [1, 3, 5, 10, 15].slice(0, prices.length).map((kg, i) => ({ maxWeight: kg * 1000, price: prices[i] }));

// Orden importante: la primera zona que encaja con el código postal es la que se aplica.
const ZONES = [
  { id: 'peninsula', name: 'Península', active: true, countries: ['ES'], excludePostalPrefixes: ['07', '35', '38', '51', '52'], rates: tiers([791, 824, 923, 1188, 1528]), extraKgPrice: 101, deliveryTime: '24–48 h laborables' },
  // Menorca (077…) e Ibiza y Formentera (078…), antes que Mallorca (resto de 07…).
  { id: 'baleares-menores', name: 'Baleares (Menorca, Ibiza y Formentera)', active: true, countries: ['ES'], postalPrefixes: ['077', '078'], rates: tiers([1589]), extraKgPrice: 736 },
  { id: 'baleares-mayores', name: 'Baleares (Mallorca)', active: true, countries: ['ES'], postalPrefixes: ['07'], rates: tiers([1225]), extraKgPrice: 634 },
  // Fuera del territorio del IVA (aduana/DUA): se cargan desactivadas.
  { id: 'canarias', name: 'Canarias', active: false, countries: ['ES'], postalPrefixes: ['35', '38'], rates: tiers([2452]), extraKgPrice: 1364, volumetricDivisor: 3000 },
  { id: 'ceuta-melilla', name: 'Ceuta y Melilla', active: false, countries: ['ES'], postalPrefixes: ['51', '52'], rates: tiers([3130]), extraKgPrice: 206 },
  { id: 'andorra', name: 'Andorra', active: false, countries: ['AD'], rates: tiers([1939, 1939, 1939, 1939, 2544]), extraKgPrice: 206 },
  { id: 'portugal', name: 'Portugal', active: true, countries: ['PT'], excludePostalPrefixes: ['9'], rates: tiers([848, 885, 990, 1274, 1640]), extraKgPrice: 108 },
  { id: 'madeira-azores', name: 'Madeira y Azores', active: false, countries: ['PT'], postalPrefixes: ['9'], rates: tiers([8050]), extraKgPrice: 1700 },
];

const withIva = (cents) => Math.round(cents * (1 + IVA));

/**
 * Zonas y límites de la tarifa con IVA, conservando de las zonas actuales (mismo id) lo que no viene
 * en la tarifa: envío gratis, plazo de entrega y recargo por voluminoso.
 */
export function glsShippingRules(currentZones = []) {
  const byId = new Map(currentZones.map((z) => [z.id, z]));
  return {
    volumetricDivisor: 5000,
    maxGirth: 300,
    maxPackageWeight: 40000,
    zones: ZONES.map((z) => {
      const prev = byId.get(z.id) ?? {};
      return {
        postalPrefixes: [],
        excludePostalPrefixes: [],
        volumetricDivisor: 0,
        ...z,
        rates: z.rates.map((r) => ({ maxWeight: r.maxWeight, price: withIva(r.price) })),
        extraKgPrice: withIva(z.extraKgPrice),
        freeOver: prev.freeOver ?? 0,
        bulkySurcharge: prev.bulkySurcharge ?? 0,
        deliveryTime: prev.deliveryTime || z.deliveryTime || '',
      };
    }),
  };
}
