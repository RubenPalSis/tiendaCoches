// Aplica la tarifa GLS Business Parcel 2026 (shared/gls-tariff.js) a settings/shipping una sola vez,
// sin que el vendedor tenga que hacerlo en el panel. Se lanza desde getSettings('shipping') antes de
// leer los envíos, así que el checkout ya cobra con la tarifa nueva desde la primera petición tras el
// despliegue. La marca en meta/migrations hace que no se repita: lo que el vendedor cambie después en
// Ajustes → Envíos no se pisa. Los envíos anteriores se guardan en meta/shipping-before-<tarifa>.
// Una segunda marca añade el kg adicional a las tiendas que ya tenían la tarifa sin él.
import { db, Timestamp } from '../lib/firebase.js';
import { GLS_TARIFF_ID, GLS_EXTRA_KG_ID, glsShippingRules, withGlsExtraKg } from '../shared/gls-tariff.js';

export const GLS_MIGRATION = `shipping-${GLS_TARIFF_ID}`;
export const GLS_EXTRA_KG_MIGRATION = `shipping-${GLS_EXTRA_KG_ID}`;

export async function applyGlsTariff() {
  const marker = db.doc('meta/migrations');
  // Lectura barata fuera de la transacción: es lo único que pasa una vez aplicadas.
  const done = (await marker.get()).data() ?? {};
  if (done[GLS_MIGRATION] && done[GLS_EXTRA_KG_MIGRATION]) return { skipped: true };
  const ref = db.doc('settings/shipping');
  return db.runTransaction(async (tx) => {
    const [m, snap] = await tx.getAll(marker, ref);
    const applied = m.data() ?? {};
    const now = Timestamp.now();
    if (!applied[GLS_MIGRATION]) {
      // La tarifa completa ya trae el kg adicional: se marcan las dos.
      const rules = glsShippingRules(snap.exists ? snap.data() : {});
      if (snap.exists) tx.set(db.doc(`meta/shipping-before-${GLS_TARIFF_ID}`), snap.data());
      tx.set(ref, rules);
      tx.set(marker, { [GLS_MIGRATION]: now, [GLS_EXTRA_KG_MIGRATION]: now }, { merge: true });
      return { applied: true, zones: rules.zones.length };
    }
    if (applied[GLS_EXTRA_KG_MIGRATION]) return { skipped: true };
    if (snap.exists) tx.set(ref, withGlsExtraKg(snap.data()));
    tx.set(marker, { [GLS_EXTRA_KG_MIGRATION]: now }, { merge: true });
    return { applied: true, extraKg: true };
  });
}
