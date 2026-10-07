// Roles: un email de ADMIN_EMAILS obtiene acceso; cualquier otra cuenta se rechaza.
// Requiere emuladores + functions/.env.local con ADMIN_EMAILS=admin@demo.test,otro-admin@demo.test
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { initializeApp } from '../../functions/node_modules/firebase-admin/lib/esm/app/index.js';
import { getAuth } from '../../functions/node_modules/firebase-admin/lib/esm/auth/index.js';

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
const BASE = process.env.BASE_URL || 'http://localhost:5000';
initializeApp({ projectId: 'demo-tienda' });
for (const [email, emailVerified] of [['otro-admin@demo.test', true], ['intruso@demo.test', true], ['sin-verificar@demo.test', false]]) {
  try { await getAuth().createUser({ email, password: 'demo1234', emailVerified }); } catch { /* ya existe */ }
  const u = await getAuth().getUserByEmail(email);
  await getAuth().updateUser(u.uid, { emailVerified });
}

const browser = await chromium.launch();
const cases = [['otro-admin@demo.test', true], ['intruso@demo.test', false], ['sin-verificar@demo.test', 'verify']];
for (const [email, expected] of cases) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/admin/`);
  await page.fill('#l-email', email);
  await page.fill('#l-pass', 'demo1234');
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('.kpis, .login .notice--error, #send-verify', { timeout: 20000 });
  const granted = (await page.locator('.kpis').count()) > 0;
  const verify = (await page.locator('#send-verify').count()) > 0;
  assert.equal(verify ? 'verify' : granted, expected, email);
  console.log(`✔ ${email}: ${verify ? 'en la lista pero sin verificar → pide verificar el email' : granted ? 'acceso concedido (en ADMIN_EMAILS)' : 'acceso denegado'}`);
  await page.close();
}
await browser.close();
process.exit(0);
