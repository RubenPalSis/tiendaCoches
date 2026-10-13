// Entradas del índice público del catálogo (catalog/index y la versión estática de GitHub Pages).
const millis = (ts) => (ts?.toMillis ? ts.toMillis() : typeof ts === 'number' ? ts : 0);

export function toIndexEntry(id, p) {
  return {
    id,
    slug: p.slug,
    name: p.name,
    ref: p.reference || '',
    brand: p.brand || '',
    model: p.model || '',
    compat: (p.compatibility || '').slice(0, 300),
    categoryId: p.categoryId || '',
    price: p.price,
    comparePrice: p.comparePrice || null,
    condition: p.condition || 'new',
    img: p.images?.[0]?.sm || '',
    imgMd: p.images?.[0]?.md || '',
    stock: Math.max(0, p.stock || 0),
    reserved: (p.reserved || 0) > 0,
    featured: !!p.featured,
    weight: p.weight || 0,
    createdAt: millis(p.createdAt),
  };
}

export function toCategoryEntry(id, c) {
  return {
    id,
    name: c.name,
    slug: c.slug,
    description: c.description || '',
    order: c.order ?? 0,
    image: c.image || '',
  };
}
