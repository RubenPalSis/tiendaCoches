// Búsqueda local sobre el índice del catálogo: instantánea y sin coste de lecturas.
const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const compact = (s) => normalize(s).replace(/[^a-z0-9]/g, '');

const haystacks = new WeakMap();

function haystack(p, categoryName) {
  let h = haystacks.get(p);
  if (!h) {
    h = {
      text: normalize([p.name, p.ref, p.brand, p.model, p.compat, categoryName].join(' ')),
      ref: compact(p.ref),
      name: normalize(p.name),
    };
    haystacks.set(p, h);
  }
  return h;
}

/** Devuelve los productos que contienen todas las palabras buscadas, ordenados por relevancia. */
export function search(products, query, categoriesById = new Map()) {
  const q = normalize(query).trim();
  if (!q) return products;
  const tokens = q.split(/\s+/).filter(Boolean);
  const qCompact = compact(q);

  const scored = [];
  for (const p of products) {
    const h = haystack(p, categoriesById.get(p.categoryId)?.name);
    // Las referencias se comparan sin espacios ni guiones: "0 986 494 123" = "0986494123".
    const refHit = qCompact.length >= 4 && h.ref && h.ref.includes(qCompact);
    if (!refHit && !tokens.every((t) => h.text.includes(t))) continue;
    let score = 0;
    if (refHit) score += h.ref === qCompact ? 100 : 50;
    if (h.name.startsWith(q)) score += 20;
    score += tokens.filter((t) => h.name.includes(t)).length * 5;
    if (p.stock > 0) score += 3;
    scored.push({ p, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.p);
}
