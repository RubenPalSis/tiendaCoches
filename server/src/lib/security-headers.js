// Cabeceras de seguridad de las respuestas del Worker (API, páginas de producto/categoría…).
// Las de los archivos estáticos están en public/_headers: deben coincidir (lo comprueba
// tests/server/worker.test.js).
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.gstatic.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com",
  "font-src 'self'",
  'connect-src \'self\' https://*.googleapis.com https://www.gstatic.com https://api.cloudinary.com http://127.0.0.1:9099 http://localhost:9099 http://127.0.0.1:8080 http://localhost:8080',
  "frame-src 'self' https://*.firebaseapp.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': CSP,
};
