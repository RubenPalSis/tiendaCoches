// Fotos de productos y de la tienda en Cloudinary (plan gratuito, sin tarjeta).
// El navegador sube la foto directamente a Cloudinary con una firma que solo da el servidor
// a los administradores; las versiones pequeñas se piden por URL (c_limit,w_400…).
// En local (wrangler dev) se usa un almacén simulado (DEV_MEDIA) para no necesitar cuenta.
import { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME, CLOUDINARY_FOLDER, binding } from '../lib/config.js';
import { HttpsError } from '../lib/callable.js';
import { slugify } from '../shared/slug.js';

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** Firma de Cloudinary: SHA-1 de los parámetros ordenados + el secreto de la API. */
export async function cloudinarySignature(params, secret) {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return hex(await crypto.subtle.digest('SHA-1', enc.encode(toSign + secret)));
}

const configured = () => !!(CLOUDINARY_CLOUD_NAME.value() && CLOUDINARY_API_KEY.value() && CLOUDINARY_API_SECRET.value());
const devStore = () => binding('DEV_MEDIA');
const root = () => slugify(CLOUDINARY_FOLDER.value(), 40) || 'tienda';

/** Comprueba que un public_id pertenece a la carpeta de esta tienda (no se puede borrar nada más). */
const ownsId = (id) => typeof id === 'string' && id.startsWith(`${root()}/`) && /^[a-z0-9/_-]{3,200}$/i.test(id);

/**
 * Parámetros para que el panel suba una foto.
 * @param folder 'products/<id>' o 'store'
 * @returns {{ uploadUrl: string, fields: Record<string,string> }}
 */
export async function uploadParams({ folder, name }) {
  if (typeof folder !== 'string' || !/^(products\/[A-Za-z0-9]{1,40}|store)$/.test(folder)) {
    throw new HttpsError('invalid-argument', 'Carpeta de fotos no válida.');
  }
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const publicId = `${root()}/${folder}/${slugify(String(name ?? ''), 50) || 'foto'}-${stamp}`;

  if (configured()) {
    const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), allowed_formats: 'webp,jpg,jpeg,png' };
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME.value()}/image/upload`,
      fields: { ...params, api_key: CLOUDINARY_API_KEY.value(), signature: await cloudinarySignature(params, CLOUDINARY_API_SECRET.value()) },
    };
  }
  if (devStore()) return { uploadUrl: '/dev-media/upload', fields: { public_id: publicId } };
  throw new HttpsError('failed-precondition', 'Las fotos todavía no están configuradas (faltan los datos de Cloudinary).');
}

/** Borra fotos (al quitarlas de un producto o eliminarlo). Nunca lanza por una foto concreta. */
export async function deleteMedia({ publicIds }) {
  const ids = (Array.isArray(publicIds) ? publicIds : []).filter(ownsId).slice(0, 20);
  let deleted = 0;
  for (const publicId of ids) {
    if (configured()) {
      const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), invalidate: 'true' };
      const body = new URLSearchParams({ ...params, api_key: CLOUDINARY_API_KEY.value(), signature: await cloudinarySignature(params, CLOUDINARY_API_SECRET.value()) });
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME.value()}/image/destroy`, { method: 'POST', body }).catch(() => null);
      if (res?.ok) deleted += 1;
    } else if (devStore()) {
      await devStore().delete(publicId);
      deleted += 1;
    }
  }
  return { deleted };
}

// ---------- Almacén de fotos de desarrollo (solo `wrangler dev --env dev`) ----------

/** POST /dev-media/upload (multipart: file, public_id) → { public_id, secure_url } como Cloudinary. */
export async function devUpload(request) {
  const store = devStore();
  if (!store) return new Response('Not found', { status: 404 });
  const form = await request.formData();
  const file = form.get('file');
  const publicId = String(form.get('public_id') ?? '');
  if (!file || typeof file === 'string' || !ownsId(publicId)) return Response.json({ error: { message: 'Subida no válida' } }, { status: 400 });
  await store.put(publicId, await file.arrayBuffer(), { metadata: { type: file.type || 'image/webp' } });
  // Ruta relativa: funciona igual con localhost que con 127.0.0.1.
  return Response.json({ public_id: publicId, secure_url: `/dev-media/upload/v1/${publicId}` });
}

/** GET /dev-media/upload/[transformaciones/]v1/<public_id>: ignora las transformaciones (mismo archivo). */
export async function devServe(request) {
  const store = devStore();
  if (!store) return new Response('Not found', { status: 404 });
  const rest = new URL(request.url).pathname.replace(/^\/dev-media\/upload\//, '').split('/');
  const v = rest.findIndex((s) => /^v\d+$/.test(s));
  const publicId = decodeURIComponent(rest.slice(v + 1).join('/'));
  const { value, metadata } = await store.getWithMetadata(publicId, { type: 'arrayBuffer' });
  if (!value) return new Response('Not found', { status: 404 });
  return new Response(value, { headers: { 'Content-Type': metadata?.type || 'image/webp', 'Cache-Control': 'public, max-age=3600' } });
}
