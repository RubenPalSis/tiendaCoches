// Copia el código compartido (public/js/shared) a server/src/shared y las fotos del catálogo a public/media.
// Única fuente de verdad: public/js/shared. Se ejecuta antes de desplegar y de arrancar los emuladores.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'public/js/shared');
const to = join(root, 'server/src/shared');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('shared → server/src/shared');

// Fotos del catálogo importado de Wallapop (demo/img): Cloudflare las sirve como parte de la web
// en /media/catalogo/ (git ignora la copia). Las fotos nuevas del panel van a Cloudinary.
const media = join(root, 'public/media/catalogo');
rmSync(media, { recursive: true, force: true });
mkdirSync(media, { recursive: true });
cpSync(join(root, 'demo/img'), media, { recursive: true });
console.log('demo/img → public/media/catalogo');
