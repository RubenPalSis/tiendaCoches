// Fotos en Cloudinary (plan gratuito). El navegador reduce la foto y la sube directamente a Cloudinary
// con una firma que solo da el servidor a los administradores; las versiones pequeñas se piden por URL.
import { adminAction } from './firebase.js';
import { processImage, SIZES } from './image-processor.js';

/** URL de Cloudinary con el ancho máximo indicado (c_limit no amplía fotos pequeñas). */
export const sizedUrl = (url, width) => url.replace('/upload/', `/upload/c_limit,w_${width}/`);

/**
 * Procesa y sube una foto.
 * @param folder 'products/<id>' o 'store'
 * @returns {Promise<{ sm, md, lg, publicId }>}
 */
export async function uploadImage(folder, baseName, file) {
  const processed = await processImage(file);
  const { uploadUrl, fields } = await adminAction('mediaUploadParams', { folder, name: baseName });
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', processed.blob, `foto.${processed.ext}`);
  let res;
  try {
    res = await fetch(uploadUrl, { method: 'POST', body: form });
  } catch {
    throw new Error('No se pudo subir la foto. Comprueba la conexión e inténtalo de nuevo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) throw new Error(data.error?.message || 'No se pudo subir la foto.');
  return { sm: sizedUrl(data.secure_url, SIZES.sm), md: sizedUrl(data.secure_url, SIZES.md), lg: data.secure_url, publicId: data.public_id };
}

/** Borra fotos de Cloudinary (al quitarlas de una pieza o eliminarla). No lanza: una foto huérfana no es grave. */
export async function deleteImages(images) {
  const publicIds = images.map((img) => img?.publicId).filter(Boolean);
  if (!publicIds.length) return;
  await adminAction('mediaDelete', { publicIds }).catch(() => {});
}
