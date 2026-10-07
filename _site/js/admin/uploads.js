import { storage, st } from './firebase.js';
import { processImage } from './image-processor.js';
import { slugify } from '../shared/slug.js';

const CACHE = 'public, max-age=31536000, immutable';

// Las fotos son públicas (reglas de Storage): guardamos la URL sin token para que sea estable.
function publicUrl(downloadUrl) {
  const url = new URL(downloadUrl);
  url.searchParams.delete('token');
  return url.toString();
}

/**
 * Procesa y sube una foto en 3 tamaños.
 * @param folder 'products/<id>' o 'store'
 * @returns {Promise<{ sm, md, lg, paths: { sm, md, lg } }>}
 */
export async function uploadImage(folder, baseName, file) {
  const processed = await processImage(file);
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const name = `${slugify(baseName, 50) || 'foto'}-${stamp}`;
  const result = { paths: {} };
  for (const size of ['sm', 'md', 'lg']) {
    const path = `${folder}/${name}-${size}.${processed.ext}`;
    const ref = st.ref(storage, path);
    await st.uploadBytes(ref, processed[size], { contentType: processed.type, cacheControl: CACHE });
    result[size] = publicUrl(await st.getDownloadURL(ref));
    result.paths[size] = path;
  }
  return result;
}

export async function deleteImage(image) {
  const paths = Object.values(image?.paths ?? {});
  await Promise.all(paths.map((p) => st.deleteObject(st.ref(storage, p)).catch(() => {})));
}
