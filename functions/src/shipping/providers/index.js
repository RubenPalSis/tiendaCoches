// Proveedores de envío. Interfaz común preparada para una futura integración automática con GLS.
//
//   createShipment(order) → Promise<{ trackingNumber: string, trackingUrl?: string, labelPdfBase64?: string }>
//   getStatus(trackingNumber) → Promise<{ status: string, delivered: boolean }>
//
// Hoy solo existe el proveedor "manual": el vendedor gestiona el envío con GLS como siempre
// y escribe el número de seguimiento en el panel (acción adminAction → setStatus 'shipped').
import { manualProvider } from './manual.js';

const providers = { manual: manualProvider };

export function getShippingProvider(id = 'manual') {
  const provider = providers[id];
  if (!provider) throw new Error(`Proveedor de envío desconocido: ${id}`);
  return provider;
}
