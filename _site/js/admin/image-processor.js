// Comprime y redimensiona las fotos EN EL NAVEGADOR antes de subirlas (gratis y rápido desde el móvil).
// Genera 3 tamaños: sm (400 px), md (800 px) y lg (1600 px) en WebP (JPEG si el navegador no lo soporta).
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

/** @returns {Promise<{ sm: Blob, md: Blob, lg: Blob, ext: string, type: string }>} */
export async function processImage(file) {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" no es una imagen.`);
  if (file.size > 25 * 1024 * 1024) throw new Error(`"${file.name}" es demasiado grande (máx. 25 MB).`);
  const bitmap = await loadBitmap(file);
  const out = {};
  for (const [key, side] of Object.entries(SIZES)) out[key] = await resize(bitmap, side);
  bitmap.close?.();
  const type = out.lg.type;
  return { ...out, type, ext: type === 'image/webp' ? 'webp' : 'jpg' };
}
