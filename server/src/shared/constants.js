export const CONDITIONS = {
  new: 'Nuevo',
  used: 'Usado',
  refurbished: 'Reacondicionado',
};

// Tamaños rápidos para el panel: el vendedor elige un tamaño en vez de pesar cada pieza.
export const SIZE_PRESETS = [
  { id: 'S', label: 'Pequeño (hasta 2 kg)', weight: 2000 },
  { id: 'M', label: 'Mediano (2–5 kg)', weight: 5000 },
  { id: 'L', label: 'Grande (5–15 kg)', weight: 15000 },
  { id: 'XL', label: 'Muy grande (15–30 kg)', weight: 30000 },
];

export const LIMITS = {
  maxQtyPerLine: 10,
  maxLines: 20,
  maxImages: 8,
  reservationMinutes: 30, // mínimo que permite Stripe para expirar una sesión de Checkout
};

export const ORDER_STATUS = {
  pending: { label: 'Pendiente de pago', tone: 'muted' },
  paid: { label: 'Pagado', tone: 'info' },
  preparing: { label: 'Preparando', tone: 'warning' },
  shipped: { label: 'Enviado', tone: 'accent' },
  delivered: { label: 'Entregado', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
  expired: { label: 'Pago no completado', tone: 'muted' },
};

export const PAYMENT_STATUS = {
  pending: 'Pendiente',
  paid: 'Pagado',
  expired: 'Caducado',
  failed: 'Fallido',
  refunded: 'Reembolsado',
  partially_refunded: 'Reembolso parcial',
};

// Transiciones permitidas desde el panel (cancelar tiene su propia acción).
export const ORDER_TRANSITIONS = {
  paid: ['preparing', 'shipped'],
  preparing: ['paid', 'shipped'],
  shipped: ['preparing', 'delivered'],
  delivered: ['shipped'],
};

export const CANCELLABLE = ['pending', 'paid', 'preparing'];

export const COUNTRIES = { ES: 'España', PT: 'Portugal', AD: 'Andorra', FR: 'Francia' };
