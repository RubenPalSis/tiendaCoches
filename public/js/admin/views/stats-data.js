// Lectura de estadísticas diarias (statistics/day_YYYY-MM-DD): 1 lectura por día del rango.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });

export const dayKeyOffset = (daysAgo) => dayFmt.format(new Date(Date.now() - daysAgo * 86_400_000));

export async function loadStats({ db, fs }, days) {
  const from = `day_${dayKeyOffset(days - 1)}`;
  const snap = await fs.getDocs(fs.query(
    fs.collection(db, 'statistics'),
    fs.where(fs.documentId(), '>=', from),
    fs.orderBy(fs.documentId()),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

const FIELDS = ['revenue', 'orders', 'itemsSold', 'pageViews', 'productViewsTotal', 'addToCart', 'checkoutStarted'];

export function sumStats(days) {
  const total = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const maps = { productSales: {}, productViews: {}, productAddToCart: {} };
  for (const d of days) {
    for (const f of FIELDS) total[f] += d[f] ?? 0;
    for (const m of Object.keys(maps)) {
      for (const [id, n] of Object.entries(d[m] ?? {})) maps[m][id] = (maps[m][id] ?? 0) + n;
    }
  }
  return { ...total, ...maps };
}

/** Serie diaria completa (rellena con 0 los días sin datos). */
export function dailySeries(days, count, field) {
  const byId = new Map(days.map((d) => [d.id, d]));
  return Array.from({ length: count }, (_, i) => {
    const key = dayKeyOffset(count - 1 - i);
    return { key, value: byId.get(`day_${key}`)?.[field] ?? 0 };
  });
}
