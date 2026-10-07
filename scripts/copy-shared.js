// Copia el código compartido (public/js/shared) a functions/src/shared.
// Única fuente de verdad: public/js/shared. Se ejecuta antes de desplegar y de arrancar los emuladores.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'public/js/shared');
const to = join(root, 'functions/src/shared');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('shared → functions/src/shared');
