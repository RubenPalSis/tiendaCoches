// Envío gestionado a mano por el vendedor (portal de GLS, agencia o ParcelShop).
// No crea envíos: el número de seguimiento se introduce desde el panel.
export const manualProvider = {
  id: 'manual',
  automatic: false,
  async createShipment() {
    throw new Error('El proveedor manual no crea envíos: introduce el número de seguimiento en el panel.');
  },
  async getStatus() {
    return null;
  },
};

// Para integrar GLS en el futuro: crear ./gls.js con la misma interfaz, guardar las credenciales
// con `firebase functions:secrets:set GLS_…` y registrarlo en ./index.js. No se implementa hasta
// conocer el servicio concreto de GLS del cliente y su documentación oficial.
