// Capturas responsive + errores de consola. Uso: node tests/e2e/screens.js [ruta ...]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:5000';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
const WIDTHS = (process.env.WIDTHS || '320,375,390,414,768,1366,1920').split(',').map(Number);
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/'];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let problems = 0;

for (const path of paths) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: width < 800 ? 800 : 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const name = `${path.replace(/[^a-z0-9]+/gi, '_') || 'home'}_${width}.png`;
    await page.screenshot({ path: OUT + name, fullPage: process.env.FULL !== '0' });
    const flag = overflow > 1 ? ` ⚠ scroll horizontal ${overflow}px` : '';
    if (flag || errors.length) problems += 1;
    console.log(`${path} @${width}${flag}${errors.length ? `\n   errores: ${errors.join(' | ')}` : ''}`);
    await page.close();
  }
}
await browser.close();
console.log(problems ? `\n${problems} capturas con problemas` : '\nSin problemas detectados');
