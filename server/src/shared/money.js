// Todos los importes se manejan en céntimos (enteros) para evitar errores de redondeo.
const formatter = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

export function formatPrice(cents) {
  return formatter.format((Number(cents) || 0) / 100);
}

/** "12,50" | "12.5" | 12.5 → 1250. Devuelve null si no es un importe válido. */
export function toCents(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
  const normalized = String(value ?? '').trim().replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(parseFloat(normalized) * 100);
}

/** 1250 → "12,50" (para inputs de formularios). */
export function centsToInput(cents) {
  if (cents == null) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function discountPercent(price, comparePrice) {
  if (!comparePrice || comparePrice <= price) return 0;
  return Math.round((1 - price / comparePrice) * 100);
}
