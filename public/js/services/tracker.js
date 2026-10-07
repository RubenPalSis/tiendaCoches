// Estadísticas propias sin cookies ni identificadores (contadores agregados por día).
import { STATIC_MODE } from '../core/api.js';

const sent = new Set();

export function track(event, id) {
  if (STATIC_MODE) return;
  const key = `${event}:${id ?? ''}:${location.pathname}`;
  if (event !== 'cart' && sent.has(key)) return;
  sent.add(key);
  const body = JSON.stringify(id ? { e: event, id } : { e: event });
  try {
    if (navigator.sendBeacon?.('/api/track', new Blob([body], { type: 'application/json' }))) return;
  } catch { /* ignorar */ }
  fetch('/api/track', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
}
