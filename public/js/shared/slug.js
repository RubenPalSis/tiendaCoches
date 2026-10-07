// URLs amigables: /producto/faro-delantero-seat-ibiza-<id20>
// El id de Firestore (20 caracteres) va al final para que la URL siga funcionando aunque cambie el nombre.
const FIRESTORE_ID = /^[A-Za-z0-9]{20}$/;

export function slugify(text, maxLength = 80) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

export function productSlug(name, id) {
  const base = slugify(name, 70);
  return base ? `${base}-${id}` : id;
}

export function productPath(product) {
  return `/producto/${product.slug || productSlug(product.name, product.id)}`;
}

export function categoryPath(category) {
  return `/categoria/${category.slug}`;
}

/** Extrae el id del final de un slug de producto. Devuelve null si no es válido. */
export function productIdFromSlug(slug) {
  const candidate = String(slug ?? '').slice(-20);
  return FIRESTORE_ID.test(candidate) ? candidate : null;
}
