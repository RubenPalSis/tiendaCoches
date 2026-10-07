// Utilidades sobre los datos públicos de la tienda (settings/store).

/** Enlace de WhatsApp con mensaje opcional. Devuelve '' si no hay número configurado. */
export function whatsappUrl(store, text = '') {
  let digits = String(store?.whatsapp ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 9) digits = `34${digits}`; // número español sin prefijo
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export const telUrl = (phone) => `tel:${String(phone ?? '').replace(/[^\d+]/g, '')}`;

const CATEGORY_ICONS = [
  [/motor|culata|turbo|inyecc|embrag|transmis|caja de cambio/, 'cog'],
  [/fren|disco|pastill/, 'disc'],
  [/luz|luces|faro|piloto|ilumin|optica|óptica/, 'bulb'],
  [/electr|sensor|centralita|alternador|arranque|motor de arranque/, 'zap'],
  [/bater/, 'battery'],
  [/carrocer|puerta|capo|capó|paragolpe|aleta|retrovisor|espejo/, 'car'],
  [/aceite|liquid|líquid|refriger|radiador|filtro/, 'droplet'],
  [/climat|aire|ventil/, 'wind'],
  [/interior|asiento|tapicer|salpicad/, 'seat'],
  [/suspens|amortig|direcc|rueda|llanta|neum/, 'wrench'],
];

export function categoryIcon(name) {
  const n = String(name ?? '').toLowerCase();
  return CATEGORY_ICONS.find(([re]) => re.test(n))?.[1] ?? 'wrench';
}
