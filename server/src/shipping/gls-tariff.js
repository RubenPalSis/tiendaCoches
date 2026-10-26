// Aplica la tarifa GLS Business Parcel 2026 (shared/gls-tariff.js) a settings/shipping una sola vez,
// sin que el vendedor tenga que hacerlo en el panel. Se lanza desde getSettings('shipping') antes de
// leer los envíos, así que el checkout ya cobra con la tarifa nueva desde la primera petición tras el
// despliegue. La marca en meta/migrations hace que no se repita: lo que el vendedor cambie después en
// Ajustes → Envíos no se pisa. Los envíos anteriores se guardan en meta/shipping-before-<tarifa>.
// Marcas posteriores corrigen una vez las tiendas que ya tenían la tarifa: añadir el kg adicional y
// quitar el límite de largo + perímetro de 300 cm.
import { db, Timestamp } from '../lib/firebase.js';
import { GLS_TARIFF_ID, GLS_EXTRA_KG_ID, GLS_NO_GIRTH_ID, glsShippingRules, withGlsExtraKg, withoutGlsGirth } from '../shared/gls-tariff.js';

export const GLS_MIGRATION = `shipping-${GLS_TARIFF_ID}`;
export const GLS_EXTRA_KG_MIGRATION = `shipping-${GLS_EXTRA_KG_ID}`;
export const GLS_NO_GIRTH_MIGRATION = `shipping-${GLS_NO_GIRTH_ID}`;

// Correcciones en orden, para las tiendas que ya tenían la tarifa aplicada.
const FIXES = [
  [GLS_EXTRA_KG_MIGRATION, withGlsExtraKg],
  [GLS_NO_GIRTH_MIGRATION, withoutGlsGirth],
];
const ALL = [GLS_MIGRATION, ...FIXES.map(([id]) => id)];

export async function applyGlsTariff() {
  const marker = db.doc('meta/migrations');
  // Lectura barata fuera de la transacción: es lo único que pasa una vez aplicadas.
  const done = (await marker.get()).data() ?? {};
  if (ALL.every((id) => done[id])) return { skipped: true };
  const ref = db.doc('settings/shipping');
  return db.runTransaction(async (tx) => {
    const [m, snap] = await tx.getAll(marker, ref);
    const applied = m.data() ?? {};
    const now = Timestamp.now();
    if (!applied[GLS_MIGRATION]) {
      // La tarifa completa ya trae las correcciones: se marcan todas.
      const rules = glsShippingRules(snap.exists ? snap.data() : {});
      if (snap.exists) tx.set(db.doc(`meta/shipping-before-${GLS_TARIFF_ID}`), snap.data());
      tx.set(ref, rules);
      tx.set(marker, Object.fromEntries(ALL.map((id) => [id, now])), { merge: true });
      return { applied: true, zones: rules.zones.length };
    }
    const pending = FIXES.filter(([id]) => !applied[id]);
    if (!pending.length) return { skipped: true };
    if (snap.exists) tx.set(ref, pending.reduce((rules, [, fix]) => fix(rules), snap.data()));
    tx.set(marker, Object.fromEntries(pending.map(([id]) => [id, now])), { merge: true });
    return { applied: true, fixes: pending.map(([id]) => id) };
  });
}
