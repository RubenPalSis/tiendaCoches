// Tarifa GLS Business Parcel 24-48 h 2026 del cliente («Tarifas paquetería 2026 TI D.pdf»).
// Fuente única: el servidor la aplica sola una vez (server/src/shipping/gls-tariff.js) y el panel la
// usa en «Cargar tarifa GLS» (Ajustes → Envíos).
//
// Los precios del documento son SIN IVA (céntimos por expedición). La tienda guarda los envíos con IVA
// incluido (lo que paga el cliente; Stripe no suma impuestos), así que aquí se suma el IVA que
// corresponde a cada destino: 21 % en península, Baleares y Portugal (venta a distancia UE, igual que
// los productos). Canarias y Andorra están fuera del territorio del IVA español (exportación, aduana):
// se guardan sin IVA y DESACTIVADAS; activarlas es una decisión fiscal del vendedor.
//
// Tramos del documento y, por encima del último, «kg adicional» proporcional a los kg que pasan del
// tramo (sin él, piezas grandes como los paragolpes, que pasan de 15 kg por peso volumétrico, no se
// podían pagar online). Así lo calcula GLS: 190×30×30 → 34,2 kg → 15,28 € + 19,2 × 1,01 € + IVA.
// Ceuta y Melilla no tienen precio en el documento: se crean desactivadas y sin tramos.
//
// Condiciones aplicadas: divisor volumétrico 5000 (terrestre) y 3000 en Canarias (marítimo) y 40 kg
// por paquete. Sin límite de largo + perímetro: GLS cotiza paragolpes de 190×30×30 (310 cm), así que
// el de 300 cm del documento dejaba fuera piezas que sí envían.

export const GLS_TARIFF_ID = 'gls-business-parcel-2026';
export const GLS_TARIFF_NAME = 'GLS Business Parcel 2026';
// Segunda migración: añade el kg adicional a las tiendas que ya tenían la tarifa aplicada sin él.
export const GLS_EXTRA_KG_ID = `${GLS_TARIFF_ID}-kg-adicional`;
// Tercera: quita el límite de largo + perímetro de 300 cm a las tiendas que lo tenían de la tarifa.
export const GLS_NO_GIRTH_ID = `${GLS_TARIFF_ID}-sin-perimetro`;
const OLD_GLS_GIRTH = 300;
// Página oficial de seguimiento de GLS España. Pide número y código postal y no admite el número en la
// URL, así que se enlaza tal cual (el email y la página del pedido muestran el número aparte).
export const GLS_TRACKING_URL = 'https://www.gls-group.com/ES/es/recibir-paquetes/seguimiento-envio/';

const IVA = 21;
/** Céntimos sin IVA → con IVA (precio × 1,21 redondeado al céntimo), en enteros para no arrastrar decimales. */
export const withIva = (cents, vat = IVA) => Math.round((cents * (100 + vat)) / 100);

const tiers = (prices) => [1, 3, 5, 10, 15].slice(0, prices.length).map((kg, i) => ({ maxWeight: kg * 1000, price: prices[i] }));

// Zonas sin solapamientos: cada código postal español encaja en una sola zona (ver tests).
// Baleares: Menorca 077…, Ibiza y Formentera 078…; Mallorca el resto de 07….
// Portugal sin Madeira ni Azores (9…), que no tienen precio en el documento.
export const GLS_ZONES = [
  { id: 'peninsula', name: 'Península', active: true, vat: IVA, countries: ['ES'], excludePostalPrefixes: ['07', '35', '38', '51', '52'], rates: tiers([791, 824, 923, 1188, 1528]), extraKgPrice: 101, deliveryTime: '24–48 h laborables' },
  { id: 'baleares-mayores', name: 'Baleares (Mallorca)', active: true, vat: IVA, countries: ['ES'], postalPrefixes: ['07'], excludePostalPrefixes: ['077', '078'], rates: tiers([1225]), extraKgPrice: 634 },
  { id: 'baleares-menores', name: 'Baleares (Menorca, Ibiza y Formentera)', active: true, vat: IVA, countries: ['ES'], postalPrefixes: ['077', '078'], rates: tiers([1589]), extraKgPrice: 736 },
  { id: 'canarias', name: 'Canarias', active: false, vat: 0, countries: ['ES'], postalPrefixes: ['35', '38'], rates: tiers([2452]), extraKgPrice: 1364, volumetricDivisor: 3000 },
  { id: 'ceuta', name: 'Ceuta', active: false, vat: 0, countries: ['ES'], postalPrefixes: ['51'], rates: [] },
  { id: 'melilla', name: 'Melilla', active: false, vat: 0, countries: ['ES'], postalPrefixes: ['52'], rates: [] },
  { id: 'portugal', name: 'Portugal', active: true, vat: IVA, countries: ['PT'], excludePostalPrefixes: ['9'], rates: tiers([848, 885, 990, 1274, 1640]), extraKgPrice: 108 },
  { id: 'andorra', name: 'Andorra', active: false, vat: 0, countries: ['AD'], rates: tiers([1939, 1939, 1939, 1939, 2544]), extraKgPrice: 206 },
];

/**
 * Reglas de envío completas con la tarifa (precios con el IVA de cada zona). Conserva el resto de
 * ajustes de envío actuales y, de las zonas con el mismo id, lo que no viene en la tarifa: envío
 * gratis, plazo de entrega y recargo por voluminoso. Las zonas que no son de la tarifa se quitan
 * para que no se solapen con las de GLS.
 */
export function glsShippingRules(current = {}) {
  const { configured, ...rest } = current ?? {};
  const byId = new Map((rest.zones ?? []).map((z) => [z.id, z]));
  return {
    ...rest,
    carrier: 'GLS',
    trackingUrlTemplate: rest.trackingUrlTemplate || GLS_TRACKING_URL,
    defaultWeight: rest.defaultWeight ?? 2000,
    volumetricDivisor: 5000,
    maxGirth: 0,
    maxPackageWeight: 40000,
    zones: GLS_ZONES.map(({ vat, ...z }) => {
      const prev = byId.get(z.id) ?? {};
      return {
        postalPrefixes: [],
        excludePostalPrefixes: [],
        volumetricDivisor: 0,
        ...z,
        rates: z.rates.map((r) => ({ maxWeight: r.maxWeight, price: withIva(r.price, vat) })),
        extraKgPrice: z.extraKgPrice ? withIva(z.extraKgPrice, vat) : 0,
        freeOver: prev.freeOver ?? 0,
        bulkySurcharge: prev.bulkySurcharge ?? 0,
        deliveryTime: prev.deliveryTime || z.deliveryTime || '',
      };
    }),
  };
}

/**
 * Pone el kg adicional de la tarifa (con IVA) en las zonas GLS que no lo tienen. Respeta el precio
 * que el vendedor haya puesto y las zonas sin tramos o que no son de la tarifa.
 */
export function withGlsExtraKg(rules = {}) {
  const tariff = new Map(GLS_ZONES.map((z) => [z.id, z]));
  return {
    ...rules,
    zones: (rules.zones ?? []).map((z) => {
      const t = tariff.get(z.id);
      if (!t?.extraKgPrice || z.extraKgPrice > 0 || !z.rates?.length) return z;
      return { ...z, extraKgPrice: withIva(t.extraKgPrice, t.vat) };
    }),
  };
}

/** Quita el límite de largo + perímetro si es el de 300 cm de la tarifa; respeta el que ponga el vendedor. */
export function withoutGlsGirth(rules = {}) {
  return rules.maxGirth === OLD_GLS_GIRTH ? { ...rules, maxGirth: 0 } : rules;
}
