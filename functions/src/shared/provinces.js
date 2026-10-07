// Los dos primeros dígitos del código postal español identifican la provincia.
export const PROVINCES = {
  '01': 'Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería', '05': 'Ávila',
  '06': 'Badajoz', '07': 'Illes Balears', '08': 'Barcelona', '09': 'Burgos', '10': 'Cáceres',
  '11': 'Cádiz', '12': 'Castellón', '13': 'Ciudad Real', '14': 'Córdoba', '15': 'A Coruña',
  '16': 'Cuenca', '17': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa',
  '21': 'Huelva', '22': 'Huesca', '23': 'Jaén', '24': 'León', '25': 'Lleida',
  '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid', '29': 'Málaga', '30': 'Murcia',
  '31': 'Navarra', '32': 'Ourense', '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas',
  '36': 'Pontevedra', '37': 'Salamanca', '38': 'Santa Cruz de Tenerife', '39': 'Cantabria', '40': 'Segovia',
  '41': 'Sevilla', '42': 'Soria', '43': 'Tarragona', '44': 'Teruel', '45': 'Toledo',
  '46': 'Valencia', '47': 'Valladolid', '48': 'Bizkaia', '49': 'Zamora', '50': 'Zaragoza',
  '51': 'Ceuta', '52': 'Melilla',
};

export function provinceFromPostalCode(postalCode) {
  const cp = String(postalCode ?? '').trim();
  if (!/^\d{5}$/.test(cp)) return null;
  return PROVINCES[cp.slice(0, 2)] ?? null;
}

const POSTAL_PATTERNS = {
  ES: /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/,
  PT: /^\d{4}-?\d{3}$/,
  AD: /^AD\d{3}$/i,
  FR: /^\d{5}$/,
};

export function isValidPostalCode(postalCode, country = 'ES') {
  const pattern = POSTAL_PATTERNS[country] ?? /^[A-Za-z0-9 -]{3,10}$/;
  return pattern.test(String(postalCode ?? '').trim());
}
