// Genera los PNG del ícono de la aplicación desde `src/ui/brand/app-icon.svg` (change add-pwa-install, tarea 5.3).
// Se corre una sola vez al cambiar el SVG y se versionan los PNG; no agrega dependencias al paquete: usa el Playwright
// de `tests/e2e` (Chromium ya instalado para el E2E).
//   node apps/web/scripts/generate-app-icons.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const require = createRequire(resolve(here, '../../../tests/e2e/package.json'));
const PLAYWRIGHT = '@playwright/test'; // nombre en variable: no es una dependencia de este paquete
const { chromium } = require(PLAYWRIGHT);

const svg = readFileSync(resolve(web, 'src/ui/brand/app-icon.svg'), 'utf8');
const TARGETS = [
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/icons/icon-maskable-512.png', 512],
  ['app/apple-icon.png', 180],
];

mkdirSync(resolve(web, 'public/icons'), { recursive: true });
const browser = await chromium.launch();
try {
  for (const [file, size] of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const body = svg.replace(/ width="512" height="512"/, ` width="${size}" height="${size}"`);
    await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${body}`);
    writeFileSync(
      resolve(web, file),
      await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } }),
    );
    await page.close();
  }
} finally {
  await browser.close();
}
