import { isValidPostalCode, provinceFromPostalCode } from './provinces.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s().-]{9,20}$/;
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** DNI (12345678Z) o NIE (X1234567L), con su letra de control. Espera el valor ya normalizado. */
export function isValidDni(v) {
  const m = /^([XYZ\d])(\d{7})([A-Z])$/.exec(v);
  if (!m) return false;
  const first = 'XYZ'.includes(m[1]) ? 'XYZ'.indexOf(m[1]) : m[1];
  return DNI_LETTERS[Number(`${first}${m[2]}`) % 23] === m[3];
}

/** CIF de empresa (B12345678), con su dígito o letra de control. Espera el valor ya normalizado. */
export function isValidCif(v) {
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(v);
  if (!m) return false;
  let sum = 0;
  [...m[2]].forEach((d, i) => {
    const n = Number(d) * (i % 2 === 0 ? 2 : 1);
    sum += Math.floor(n / 10) + (n % 10);
  });
  const digit = (10 - (sum % 10)) % 10;
  const letter = 'JABCDEFGHI'[digit];
  if ('PQRSNW'.includes(m[1])) return m[3] === letter;
  if ('ABEH'.includes(m[1])) return m[3] === String(digit);
  return m[3] === letter || m[3] === String(digit);
}

const FIELDS = {
  firstName: { label: 'Nombre', min: 2, max: 60 },
  lastName: { label: 'Apellidos', min: 2, max: 80 },
  email: { label: 'Email', min: 1, max: 120 },
  phone: { label: 'Teléfono', min: 1, max: 20 },
  dni: { label: 'DNI / NIE / CIF', min: 1, max: 12 },
  line1: { label: 'Dirección', min: 5, max: 120 },
  line2: { label: 'Piso, puerta…', min: 0, max: 80 },
  postalCode: { label: 'Código postal', min: 4, max: 10 },
  city: { label: 'Ciudad', min: 2, max: 60 },
  province: { label: 'Provincia', min: 2, max: 60 },
  country: { label: 'País', min: 2, max: 2 },
  notes: { label: 'Notas para la entrega', min: 0, max: 300 },
};

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Valida y normaliza los datos de envío del checkout.
 * @returns {{ ok: boolean, errors: Record<string,string>, value: object }}
 */
export function validateCheckoutForm(input, allowedCountries = ['ES']) {
  const value = {};
  const errors = {};

  for (const [key, rule] of Object.entries(FIELDS)) {
    const v = clean(input?.[key]);
    value[key] = v;
    if (v.length < rule.min) errors[key] = rule.min === 0 ? '' : `${rule.label}: campo obligatorio`;
    else if (v.length > rule.max) errors[key] = `${rule.label}: máximo ${rule.max} caracteres`;
  }

  value.email = value.email.toLowerCase();
  value.country = value.country.toUpperCase();
  value.dni = value.dni.toUpperCase().replace(/[\s.-]/g, '');

  if (!errors.email && !EMAIL.test(value.email)) errors.email = 'Introduce un email válido';
  if (!errors.phone && !PHONE.test(value.phone)) errors.phone = 'Introduce un teléfono válido';
  if (!errors.dni && !isValidDni(value.dni) && !isValidCif(value.dni)) errors.dni = 'Introduce un DNI, NIE o CIF válido';
  if (!allowedCountries.includes(value.country)) errors.country = 'No enviamos a este país';
  if (!errors.postalCode && !isValidPostalCode(value.postalCode, value.country)) {
    errors.postalCode = 'Código postal no válido';
  }
  if (value.country === 'ES' && !errors.postalCode) {
    value.province = provinceFromPostalCode(value.postalCode) ?? value.province;
    delete errors.province;
  }

  for (const k of Object.keys(errors)) if (!errors[k]) delete errors[k];
  return { ok: Object.keys(errors).length === 0, errors, value };
}

/** Valida la lista de artículos enviada por el navegador: solo ids y cantidades. */
export function validateCartItems(items, { maxLines, maxQtyPerLine }) {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, message: 'El carrito está vacío.' };
  if (items.length > maxLines) return { ok: false, message: `Máximo ${maxLines} productos distintos por pedido.` };
  const merged = new Map();
  for (const it of items) {
    const id = String(it?.id ?? '');
    const qty = Number(it?.qty);
    if (!/^[A-Za-z0-9]{1,40}$/.test(id) || !Number.isInteger(qty) || qty < 1) {
      return { ok: false, message: 'El carrito contiene datos no válidos.' };
    }
    merged.set(id, (merged.get(id) ?? 0) + qty);
  }
  for (const qty of merged.values()) {
    if (qty > maxQtyPerLine) return { ok: false, message: `Máximo ${maxQtyPerLine} unidades por producto.` };
  }
  return { ok: true, items: [...merged].map(([id, qty]) => ({ id, qty })) };
}
