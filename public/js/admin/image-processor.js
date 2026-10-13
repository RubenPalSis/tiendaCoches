// Comprime y redimensiona las fotos EN EL NAVEGADOR antes de subirlas (gratis y rápido desde el móvil).
// Se sube una sola versión de 1600 px en WebP (JPEG si el navegador no lo soporta); las de 400 y 800 px
// las genera Cloudinary al pedirlas por URL (ver uploads.js).
export const SIZES = { sm: 400, md: 800, lg: 1600 };

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' }); // respeta la rotación EXIF
    } catch { /* algunos formatos (p. ej. HEIC) no son compatibles */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Formato de imagen no compatible. Usa JPG, PNG o WebP.'));
    img.src = URL.createObjectURL(file);
  });
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function resize(bitmap, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let blob = await toBlob(canvas, 'image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.85);
  return blob;
}

/** @returns {Promise<{ blob: Blob, ext: string, type: string }>} */
export async function processImage(file) {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" no es una imagen.`);
  if (file.size > 25 * 1024 * 1024) throw new Error(`"${file.name}" es demasiado grande (máx. 25 MB).`);
  const bitmap = await loadBitmap(file);
  const blob = await resize(bitmap, SIZES.lg);
  bitmap.close?.();
  return { blob, type: blob.type, ext: blob.type === 'image/webp' ? 'webp' : 'jpg' };
}
