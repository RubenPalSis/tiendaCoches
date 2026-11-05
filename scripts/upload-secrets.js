// Sube los secretos de secretos.env al Worker de producción (wrangler secret bulk).
// Solo envía los que tienen valor; CLOUDFLARE_API_TOKEN se usa para autenticarse, no se sube.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'secretos.env');
const WORKER_SECRETS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'GMAIL_APP_PASSWORD', 'CLOUDINARY_API_SECRET'];

if (!existsSync(file)) {
  console.error('No existe secretos.env en la raíz del proyecto.');
  process.exit(1);
}

const vars = {};
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && m[2]) vars[m[1]] = m[2];
}

const secrets = {};
for (const key of WORKER_SECRETS) if (vars[key]) secrets[key] = vars[key];

if (vars.FIREBASE_SERVICE_ACCOUNT_FILE) {
  const saPath = resolve(root, vars.FIREBASE_SERVICE_ACCOUNT_FILE);
  if (existsSync(saPath)) secrets.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(JSON.parse(readFileSync(saPath, 'utf8')));
  else console.warn(`Aviso: no se encuentra ${vars.FIREBASE_SERVICE_ACCOUNT_FILE}; FIREBASE_SERVICE_ACCOUNT no se sube.`);
}

const names = Object.keys(secrets);
if (!names.length) {
  console.error('secretos.env no tiene ningún secreto relleno.');
  process.exit(1);
}

console.log(`Subiendo: ${names.join(', ')}`);
const env = { ...process.env };
if (vars.CLOUDFLARE_API_TOKEN) env.CLOUDFLARE_API_TOKEN = vars.CLOUDFLARE_API_TOKEN;
execFileSync('npx', ['wrangler', 'secret', 'bulk'], { cwd: root, env, input: JSON.stringify(secrets), stdio: ['pipe', 'inherit', 'inherit'] });
