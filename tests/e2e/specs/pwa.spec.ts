import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';
import { appUrl, SESSION_COOKIE } from '../src/helpers.js';

/**
 * Aplicación instalable (openspec add-pwa-install, lote L6 de docs/78; D504: solo instalable, sin service worker).
 * Solo Chromium: Playwright no dispara el `beforeinstallprompt` real, así que la prueba despacha uno sintético con
 * `prompt()` y `userChoice` simulados. Instalar de verdad (TC-PLATFORM-PWA-013 y -016) es manual, en dispositivos.
 */

const MANIFEST_PATH = '/manifest.webmanifest';

/** Directivas de la CSP de la web, en su orden (`apps/web/src/security/csp.ts`): la instalación no agrega ninguna. */
const CSP_DIRECTIVES = [
  'default-src',
  'script-src',
  'style-src',
  'style-src-attr',
  'img-src',
  'font-src',
  'connect-src',
  'object-src',
  'base-uri',
  'form-action',
  'frame-ancestors',
  'upgrade-insecure-requests',
];

interface Manifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  lang: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
  shortcuts: { name: string; url: string }[];
}

async function fetchManifest(page: Page) {
  const res = await page.request.get(new URL(MANIFEST_PATH, appUrl()).href, { maxRedirects: 0 });
  return { res, body: (await res.json()) as Manifest };
}

/** Los avisos reales de Chromium se descartan para que solo cuente el sintético que despacha la prueba. */
async function blockRealInstallPrompt(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener(
      'beforeinstallprompt',
      (e) => {
        if (e.isTrusted) e.stopImmediatePropagation();
      },
      true,
    );
  });
}

/** Despacha un `beforeinstallprompt` sintético; cuenta las llamadas a `prompt()` en `window.__pfPrompted`. */
async function dispatchInstallPrompt(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted') {
  await page.evaluate((o) => {
    const w = window as unknown as { __pfPrompted?: number };
    w.__pfPrompted = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    event.prompt = () => {
      w.__pfPrompted = (w.__pfPrompted ?? 0) + 1;
      return Promise.resolve();
    };
    event.userChoice = Promise.resolve({ outcome: o });
    window.dispatchEvent(event);
  }, outcome);
}

const prompted = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pfPrompted?: number }).__pfPrompted ?? 0);

/** Capturas a 360 × 800 y a 1280 × 800 adjuntas al informe. */
async function shoot(page: Page, testInfo: TestInfo, name: string) {
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true });
  }
}

/** Registra las violaciones de CSP de la página (evento y mensajes «Refused to» de la consola). */
async function watchViolations(page: Page): Promise<string[]> {
  const found: string[] = [];
  await page.exposeFunction('__pfCspReport', (what: string) => found.push(what));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __pfCspReport(w: string): void }).__pfCspReport(
        `${e.effectiveDirective} ${e.blockedURI}`,
      );
    });
  });
  page.on('console', (m) => {
    if (/Refused to|Content Security Policy/i.test(m.text())) found.push(m.text());
  });
  return found;
}

/** Ancho y alto del encabezado IHDR de un PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe('Aplicación instalable (platform/web-interface)', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(
      browserName !== 'chromium',
      'El aviso de instalación es de Chromium (D500: Limited availability).',
    );
  });

  test('[TC-PLATFORM-PWA-001] el manifiesto se sirve sin sesión, sin redirección y con la identidad relativa', async ({
    playwright,
  }) => {
    const anonymous = await playwright.request.newContext({ ignoreHTTPSErrors: true });
    const res = await anonymous.get(new URL(MANIFEST_PATH, appUrl()).href, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/json/);
    expect(res.headers()['location']).toBeUndefined();
    const m = (await res.json()) as Manifest;
    expect(m).toMatchObject({
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      lang: 'es-BO',
      name: 'PFOS — Finanzas personales',
      short_name: 'PFOS',
    });
    await anonymous.dispose();
  });

  test('[TC-PLATFORM-PWA-002] Inicio, Transacciones y el error de inicio de sesión enlazan el manifiesto en es, en y pt sin violaciones de CSP', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'pwa-002');
    const violations = await watchViolations(page);
    for (const prefix of ['', '/en', '/pt']) {
      for (const path of ['/', '/transacciones', '/auth/error']) {
        await page.goto(`${prefix}${path}`.replace(/\/$/, '') || '/');
        await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', MANIFEST_PATH);
      }
    }
    expect(violations).toEqual([]);
    await context.close();
  });

  test('[TC-PLATFORM-PWA-003] el manifiesto declara el atajo «Registrar gasto» al alta, dentro del alcance', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'pwa-003');
    const { body } = await fetchManifest(page);
    expect(body.shortcuts).toEqual([
      expect.objectContaining({ name: 'Registrar gasto', url: '/transacciones/nueva' }),
    ]);
    expect(body.shortcuts[0]!.url.startsWith(body.scope)).toBe(true);
    await go(page, body.shortcuts[0]!.url);
    await expect(page).toHaveURL(/\/transacciones\/nueva$/);
    await context.close();
  });

  test('[TC-PLATFORM-PWA-004] [TC-PLATFORM-PWA-005] los íconos del manifiesto y el de iOS responden sin sesión como PNG del tamaño declarado', async ({
    browser,
    playwright,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'pwa-004');
    const { body } = await fetchManifest(page);
    await go(page, '/');
    const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    expect(apple, 'la página declara el ícono de iOS').toBeTruthy();
    const anonymous = await playwright.request.newContext({ ignoreHTTPSErrors: true });
    const icons = [
      ...body.icons.map((i) => ({ src: i.src, size: Number(i.sizes.split('x')[0]) })),
      { src: apple!, size: 180 },
    ];
    expect(icons.map((i) => i.size).sort()).toEqual([180, 192, 512, 512]);
    expect(body.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of icons) {
      const res = await anonymous.get(new URL(icon.src, appUrl()).href, { maxRedirects: 0 });
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()['content-type'], icon.src).toContain('image/png');
      expect(pngSize(await res.body()), icon.src).toEqual({ width: icon.size, height: icon.size });
    }
    await anonymous.dispose();
    await context.close();
  });

  test('[TC-PLATFORM-PWA-006] con el aviso del navegador aparece «Instalar la aplicación», se opera con el teclado y abre el diálogo', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await newFinanceUser(browser, 'pwa-006');
    await blockRealInstallPrompt(page);
    await go(page, '/preferencias');
    const button = page.getByRole('button', { name: 'Instalar la aplicación' });
    await expect(button).toHaveCount(0);
    await dispatchInstallPrompt(page, 'accepted');
    await expect(button).toBeVisible();
    await shoot(page, testInfo, 'pwa-instalar');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => prompted(page)).toBe(1);
    await context.close();
  });

  test('[TC-PLATFORM-PWA-007] [TC-PLATFORM-PWA-017] sin aviso del navegador no hay botón ni enlace de instalación, solo el texto fijo para iPhone', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await newFinanceUser(browser, 'pwa-007');
    await blockRealInstallPrompt(page);
    await go(page, '/preferencias');
    const section = page.getByTestId('install-app');
    await expect(section.getByTestId('install-ios-hint')).toHaveText(
      'En iPhone o iPad: Compartir → Agregar a pantalla de inicio.',
    );
    await expect(page.getByTestId('install-button')).toHaveCount(0);
    await expect(section.getByRole('button')).toHaveCount(0);
    await expect(section.getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /instalar/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /instalar/i })).toHaveCount(0);
    await shoot(page, testInfo, 'pwa-sin-aviso');
    await context.close();
  });

  test('[TC-PLATFORM-PWA-008] con la aplicación instalada (display-mode: standalone) no aparece el botón ni el texto', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'pwa-008');
    await blockRealInstallPrompt(page);
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === '(display-mode: standalone)'
          ? ({ ...original('(min-width: 0px)'), matches: true, media: query } as MediaQueryList)
          : original(query);
    });
    await go(page, '/preferencias');
    await expect(page.getByTestId('preferences-form')).toBeVisible();
    await dispatchInstallPrompt(page);
    await expect(page.getByTestId('install-app')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Instalar la aplicación' })).toHaveCount(0);
    await context.close();
  });

  test('[TC-PLATFORM-PWA-009] el botón desaparece sin recargar la página al aceptar la instalación y con appinstalled', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'pwa-009');
    await blockRealInstallPrompt(page);
    await go(page, '/preferencias');
    const button = page.getByRole('button', { name: 'Instalar la aplicación' });

    await dispatchInstallPrompt(page, 'accepted');
    await button.click();
    await expect(button).toHaveCount(0);
    expect(await prompted(page)).toBe(1);

    // En un documento nuevo, un aviso y el evento appinstalled del sistema (instalación hecha desde la barra del navegador).
    await page.reload();
    await expect(page.getByTestId('preferences-form')).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __pfMarca: number }).__pfMarca = 1;
    });
    await dispatchInstallPrompt(page, 'accepted');
    await expect(button).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(button).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pfMarca?: number }).__pfMarca)).toBe(1);
    await context.close();
  });

  test('[TC-PLATFORM-PWA-010] [TC-PLATFORM-PWA-011] [TC-PLATFORM-PWA-012] sin service worker, con la CSP intacta y sin datos guardados sin conexión', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'pwa-010');
    const cash = await openAccount(page, W, 'Caja BOB', 'CASH', 'BOB', '500.00');
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      status: 'CLEARED',
      transactionDate: todayLaPaz(),
      accountId: cash,
      amount: bob('45.00'),
      description: 'Supermercado Norte',
    });
    for (const path of ['/', '/transacciones', '/transacciones/nueva', '/preferencias']) await go(page, path);

    // 010: ningún service worker registrado para el origen.
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(
      0,
    );
    expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(0);

    // 011: las directivas de la CSP son las de siempre; no aparecen worker-src ni manifest-src.
    const res = await context.request.get(`${appUrl()}/preferencias`);
    const policy = res.headers()['content-security-policy'] ?? '';
    expect(policy.split(';').map((d) => d.trim().split(' ')[0])).toEqual(CSP_DIRECTIVES);
    expect(policy).not.toMatch(/worker-src|manifest-src/);

    // 012: sin conexión la recarga no muestra el gasto visto antes.
    await go(page, '/transacciones');
    await expect(page.getByText('Supermercado Norte').first()).toBeVisible();
    await context.setOffline(true);
    await page.reload().catch(() => undefined);
    expect(await page.content()).not.toContain('Supermercado Norte');
    expect(await page.content()).not.toContain('45.00');
    await context.setOffline(false);
    await context.close();
  });

  test('[TC-PLATFORM-PWA-014] [TC-PLATFORM-PWA-015] la cookie de sesión conserva nombre y atributos y los colores del manifiesto son los del tema claro', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'pwa-014');
    const { body } = await fetchManifest(page);
    await go(page, '/');
    const cookie = (await context.cookies(appUrl())).find((c) => c.name === SESSION_COOKIE);
    expect(cookie, 'cookie de sesión con su nombre __Host-').toBeDefined();
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, path: '/', sameSite: 'Lax' });
    expect(cookie!.domain).toBe(new URL(appUrl()).hostname);

    // 015: los colores del manifiesto son los de la superficie clara (`--pf-bg`).
    await page.emulateMedia({ colorScheme: 'light' });
    const surface = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--pf-bg');
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect(surface).toBe('rgb(255, 255, 255)');
    expect(body.theme_color).toBe('#ffffff');
    expect(body.background_color).toBe('#ffffff');
    await context.close();
  });
});
