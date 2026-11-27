import { randomUUID } from 'node:crypto';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz, userCategories } from '../src/finance.js';
import { appUrl, createKeycloakUser, login, newUserPage } from '../src/helpers.js';

/**
 * Tema oscuro (openspec add-dark-theme, lote L3 de docs/78; D501): el tema sigue al sistema, la preferencia propia vive
 * en `preferences.theme` del perfil y una cookie espejo `pfos_theme` deja que el servidor ponga `data-theme`,
 * `color-scheme` y `theme-color` en el primer HTML (sin scripts en línea; CSP por nonce). Los usuarios de las pruebas
 * son nuevos (perfil sin tema); el VIEWER de la semilla se restaura al terminar. Capturas a 360 y a 1280 px.
 */

/** Fondo de `body` (`--pf-surface`) y texto (`--pf-fg`) calculados por esquema. */
const LIGHT = { bg: 'rgb(248, 250, 252)', fg: 'rgb(15, 23, 42)' } as const;
const DARK = { bg: 'rgb(18, 24, 33)', fg: 'rgb(226, 232, 240)' } as const;

async function bodyColors(page: Page) {
  return page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    fg: getComputedStyle(document.body).color,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  }));
}

const themeCookie = async (context: BrowserContext) =>
  (await context.cookies(appUrl())).find((c) => c.name === 'pfos_theme');

/** Guarda el tema por la API (como lo haría otro dispositivo): `PATCH /me` con la versión vigente. */
async function patchTheme(page: Page, theme: 'system' | 'light' | 'dark') {
  const me = await api(page, 'GET', '/me');
  await api(page, 'PATCH', '/me', { preferences: { theme } }, { 'if-match': `"${String(me['version'])}"` });
}

async function profile(page: Page) {
  const me = await api(page, 'GET', '/me');
  return {
    version: Number(me['version']),
    theme: (me['preferences'] as { theme?: string } | undefined)?.theme,
  };
}

const preferenceAudits = async (page: Page, W: string) =>
  (
    (await api(page, 'GET', `${W}/audit-log?action=identity.user.preferences_changed&limit=100`))[
      'data'
    ] as unknown[]
  ).length;

/** Capturas a 360 × 800 y a 1280 × 800 adjuntas al informe. */
async function shoot(page: Page, testInfo: TestInfo, name: string) {
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true });
  }
}

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
}

/** HTML crudo (antes de cualquier script) con la sesión y las cookies del contexto. */
async function rawHtml(context: BrowserContext, path: string): Promise<string> {
  const res = await context.request.get(`${appUrl()}${path}`);
  expect(res.status()).toBe(200);
  return res.text();
}

async function saveTheme(page: Page, label: 'Sistema' | 'Claro' | 'Oscuro') {
  const form = page.getByTestId('preferences-form');
  await form.getByRole('radio', { name: label }).check();
  await form.getByRole('button', { name: 'Guardar preferencias' }).click();
  await expect(page.getByTestId('preferences-notice')).toHaveText('Preferencias guardadas.');
}

/** Usuario nuevo con sesión; devuelve también las credenciales para volver a entrar en otro contexto. */
async function newCredentials() {
  const username = `tema-${randomUUID().slice(0, 8)}`;
  const password = `Pw-${randomUUID()}`;
  await createKeycloakUser(username, password);
  return { username, password };
}

async function loginIn(browser: Browser, username: string, password: string) {
  const context = await browser.newContext({ baseURL: appUrl() });
  const page = await context.newPage();
  await login(page, username, password);
  return { context, page };
}

test.describe('Tema oscuro (platform/web-interface)', () => {
  test('[TC-PLATFORM-THEME-001] sin preferencia guardada, Inicio sigue al sistema en oscuro', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await newFinanceUser(browser, 'tema-001');
    await page.emulateMedia({ colorScheme: 'dark' });
    await go(page, '/');
    const colors = await bodyColors(page);
    expect(colors.bg).toBe(DARK.bg);
    expect(colors.fg).toBe(DARK.fg);
    expect(colors.scheme).toContain('dark');
    expect(await themeCookie(context)).toBeUndefined();
    await shoot(page, testInfo, 'tema-inicio-oscuro');
    await context.close();
  });

  test('[TC-PLATFORM-THEME-002] la página pasa a oscuro sin recargar cuando cambia el sistema', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await newFinanceUser(browser, 'tema-002');
    await page.emulateMedia({ colorScheme: 'light' });
    await go(page, '/transacciones');
    const search = page.getByRole('search').getByLabel('Buscar', { exact: true });
    await search.fill('super');
    expect((await bodyColors(page)).bg).toBe(LIGHT.bg);
    await page.evaluate(() => {
      (window as unknown as { __pfMarca: number }).__pfMarca = 1;
    });
    let navigations = 0;
    page.on('framenavigated', () => (navigations += 1));
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => (await bodyColors(page)).bg).toBe(DARK.bg);
    expect(navigations).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pfMarca?: number }).__pfMarca)).toBe(1);
    await expect(search).toHaveValue('super');
    await shoot(page, testInfo, 'tema-transacciones-cambio-en-vivo');
    await context.close();
  });

  test('[TC-PLATFORM-THEME-003] la página pública de error de inicio de sesión respeta el oscuro del sistema', async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({ baseURL: appUrl(), colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto('/auth/error?reason=state');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect((await bodyColors(page)).bg).toBe(DARK.bg);
    expect(await seriousViolations(page)).toEqual([]);
    await shoot(page, testInfo, 'tema-auth-error-oscuro');
    await context.close();
  });

  test('[TC-PLATFORM-THEME-004] [TC-PLATFORM-THEME-005] elegir «Oscuro» aplica el tema sin recargar y queda auditado; volver a «Sistema» quita la cookie', async ({
    browser,
  }, testInfo) => {
    const { context, page, W } = await newFinanceUser(browser, 'tema-004');
    await page.emulateMedia({ colorScheme: 'light' });
    await go(page, '/preferencias');
    await expect(page.getByTestId('preferences-form')).toBeVisible();
    const before = await profile(page);
    expect(before.theme).toBeUndefined();
    const auditsBefore = await preferenceAudits(page, W);
    let navigations = 0;
    page.on('framenavigated', () => (navigations += 1));

    await saveTheme(page, 'Oscuro');
    await expect.poll(async () => (await bodyColors(page)).bg).toBe(DARK.bg);
    expect(navigations).toBe(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const after = await profile(page);
    expect(after.theme).toBe('dark');
    expect(after.version).toBeGreaterThan(before.version);
    expect(await preferenceAudits(page, W)).toBe(auditsBefore + 1);
    expect((await themeCookie(context))?.value).toBe('dark');
    await shoot(page, testInfo, 'tema-preferencias-oscuro');

    // TC-005: de «Oscuro» a «Sistema» (el sistema está en claro).
    await saveTheme(page, 'Sistema');
    await expect.poll(async () => (await bodyColors(page)).bg).toBe(LIGHT.bg);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
    expect((await profile(page)).theme).toBe('system');
    expect(await themeCookie(context)).toBeUndefined();
    await context.close();
  });

  test('[TC-PLATFORM-THEME-006] la barra superior no ofrece ningún control de tema (es, en y pt)', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'tema-006');
    for (const prefix of ['', '/en', '/pt']) {
      for (const path of ['/', '/transacciones', '/planificacion/presupuestos']) {
        const target = path === '/' ? prefix || '/' : `${prefix}${path}`;
        await go(page, target);
        const topbar = page.locator('header.pf-topbar');
        await expect(topbar).toBeVisible();
        const names = await topbar.evaluate((el) => [
          el.textContent ?? '',
          ...[...el.querySelectorAll('[aria-label], [title]')].map(
            (n) => `${n.getAttribute('aria-label') ?? ''} ${n.getAttribute('title') ?? ''}`,
          ),
        ]);
        expect(names.join(' | '), target).not.toMatch(/tema|theme|oscuro|dark|escuro|modo/i);
        await expect(topbar.getByRole('switch')).toHaveCount(0);
      }
    }
    await context.close();
  });

  test('[TC-PLATFORM-THEME-007] el VIEWER guarda su tema en el perfil', async ({ browser }) => {
    const { context, page } = await newUserPage(browser, 'viewer', '/preferencias');
    try {
      await page.emulateMedia({ colorScheme: 'dark' });
      await go(page, '/preferencias');
      await expect(page.getByTestId('preferences-form')).toBeVisible();
      await saveTheme(page, 'Claro');
      await expect.poll(async () => (await bodyColors(page)).bg).toBe(LIGHT.bg);
      expect((await profile(page)).theme).toBe('light');
    } finally {
      // La semilla es compartida: el VIEWER vuelve a «Sistema» para no cambiar a las demás suites.
      await patchTheme(page, 'system').catch(() => undefined);
      await context.close();
    }
  });

  test('[TC-PLATFORM-THEME-008] guardar otras preferencias no vuelve a escribir el tema', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'tema-008');
    await patchTheme(page, 'light');
    const patches: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && new URL(r.url()).pathname === '/api/bff/v1/me')
        patches.push(r.postData() ?? '');
    });
    await go(page, '/preferencias');
    const form = page.getByTestId('preferences-form');
    await expect(form.getByRole('radio', { name: 'Claro' })).toBeChecked();
    await form.getByLabel('Zona horaria').fill('America/Sao_Paulo');
    await form.getByRole('button', { name: 'Guardar preferencias' }).click();
    await expect(page.getByTestId('preferences-notice')).toHaveText('Preferencias guardadas.');
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0]!)).toEqual({ timezone: 'America/Sao_Paulo' });
    expect((await profile(page)).theme).toBe('light');
    await context.close();
  });

  test('[TC-PLATFORM-THEME-009] con «Claro» y el sistema oscuro, el HTML del servidor ya sale claro', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await newFinanceUser(browser, 'tema-009');
    await patchTheme(page, 'light');
    await context.addCookies([{ name: 'pfos_theme', value: 'light', url: appUrl() }]);
    await page.emulateMedia({ colorScheme: 'dark' });

    const html = await rawHtml(context, '/reportes');
    expect(html).toMatch(/<html[^>]*\sdata-theme="light"/);
    expect(html).toMatch(/<meta name="color-scheme" content="light"\s*\/?>/);

    await page.goto('/reportes', { waitUntil: 'domcontentloaded' });
    const early = await bodyColors(page);
    expect(early.bg).toBe(LIGHT.bg);
    expect(early.scheme).toContain('light');
    await page.screenshot({ path: testInfo.outputPath('tema-primera-pintura-claro.png') });
    await context.close();
  });

  test('[TC-PLATFORM-THEME-010] el tema oscuro no produce violaciones de la CSP', async ({ browser }) => {
    const { context, page } = await newFinanceUser(browser, 'tema-010');
    await patchTheme(page, 'dark');
    await context.addCookies([{ name: 'pfos_theme', value: 'dark', url: appUrl() }]);
    const violations: string[] = [];
    await page.exposeFunction('__pfTemaCsp', (v: string) => violations.push(v));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __pfTemaCsp(v: string): void }).__pfTemaCsp(
          `${location.href} ${e.effectiveDirective} ${e.blockedURI}`,
        );
      });
    });
    page.on('console', (m) => {
      if (/Refused to|Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    for (const path of ['/', '/transacciones', '/reportes', '/preferencias']) {
      await go(page, path);
      expect((await bodyColors(page)).bg, path).toBe(DARK.bg);
      const html = await rawHtml(context, path);
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag, tag).toContain('nonce=');
      expect(html).not.toMatch(/<style[\s>]/);
    }
    expect(violations).toEqual([]);
    await context.close();
  });

  test('[TC-PLATFORM-THEME-011] el tema cambiado en otro dispositivo se adopta al leer el perfil', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'tema-011');
    await patchTheme(page, 'dark');
    await context.addCookies([{ name: 'pfos_theme', value: 'light', url: appUrl() }]);
    await page.emulateMedia({ colorScheme: 'light' });
    await go(page, '/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(async () => (await bodyColors(page)).bg).toBe(DARK.bg);
    expect((await themeCookie(context))?.value).toBe('dark');
    expect(await rawHtml(context, '/transacciones')).toMatch(/<html[^>]*\sdata-theme="dark"/);
    await context.close();
  });

  test('[TC-PLATFORM-THEME-012] [TC-PLATFORM-THEME-013] el callback de login deja o quita la marca del tema', async ({
    browser,
  }) => {
    // Perfil «Oscuro»: el callback emite la cookie con el valor exacto y la primera página sale en oscuro.
    const dark = await newCredentials();
    const first = await loginIn(browser, dark.username, dark.password);
    await patchTheme(first.page, 'dark');
    await first.context.close();

    const context = await browser.newContext({ baseURL: appUrl() });
    const page = await context.newPage();
    const setCookies: string[] = [];
    page.on('response', async (res) => {
      if (new URL(res.url()).pathname === '/api/bff/auth/callback')
        setCookies.push((await res.allHeaders())['set-cookie'] ?? '');
    });
    await login(page, dark.username, dark.password);
    const header = setCookies
      .join('\n')
      .split('\n')
      .find((c) => c.startsWith('pfos_theme='));
    expect(header).toBeDefined();
    expect(header!.split(';')[0]).toBe('pfos_theme=dark');
    expect(header).toContain('Path=/');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toMatch(/HttpOnly/i);
    expect((await themeCookie(context))?.value).toBe('dark');
    expect(await rawHtml(context, '/')).toMatch(/<html[^>]*\sdata-theme="dark"/);
    await context.close();

    // Perfil «Sistema» con una cookie «light» previa en el navegador: el callback la borra.
    const system = await newCredentials();
    const seeded = await loginIn(browser, system.username, system.password);
    await seeded.context.close();
    const ctx2 = await browser.newContext({ baseURL: appUrl() });
    await ctx2.addCookies([{ name: 'pfos_theme', value: 'light', url: appUrl() }]);
    const page2 = await ctx2.newPage();
    await login(page2, system.username, system.password);
    expect(await themeCookie(ctx2)).toBeUndefined();
    await expect(page2.locator('html')).not.toHaveAttribute('data-theme', /.*/);
    await ctx2.close();
  });

  test('[TC-PLATFORM-THEME-016] el Home en oscuro no tiene tarjetas con colores fijos claros', async ({
    browser,
  }, testInfo) => {
    const { context, page, W } = await newFinanceUser(browser, 'tema-016');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const [food] = await userCategories(page, W, 'EXPENSE');
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('245.30'),
      splits: [{ amount: bob('245.30'), categoryId: food!.id }],
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await go(page, '/');
    await expect(page.getByTestId('top-categories')).toHaveAttribute('data-comparison', 'ready');
    const white = await page.evaluate(() =>
      [...document.querySelectorAll('.pf-home, .pf-home *')]
        .filter((el) => getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)')
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
    );
    expect(white).toEqual([]);
    await expect(page.locator('.pf-home')).toBeVisible();
    await shoot(page, testInfo, 'tema-home-oscuro');
    await context.close();
  });

  test('[TC-PLATFORM-THEME-017] el recorrido en oscuro distingue sus estados con contraste y texto', async ({
    browser,
  }, testInfo) => {
    const { context, page, W } = await newFinanceUser(browser, 'tema-017');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const created = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('60.00'),
      description: 'Gasto anulado',
    });
    const id = String(created['id']);
    await api(
      page,
      'POST',
      `${W}/transactions/${id}/void`,
      { reason: 'Prueba de tema' },
      { 'if-match': `"${String(created['version'])}"` },
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await go(page, `/transacciones/${id}`);
    await page.getByRole('tab', { name: 'Recorrido' }).click();
    const diagram = page.locator('[data-testid="lifecycle-diagram"]:visible');
    await expect(diagram).toHaveCount(1);

    const result = await diagram.evaluate((svg) => {
      const rgb = (v: string) => (v.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const c = [r, g, b].map((x) => {
          const s = x! / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
      };
      const ratio = (a: string, b: string) => {
        const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
        return (hi! + 0.05) / (lo! + 0.05);
      };
      const bg = getComputedStyle(document.body).backgroundColor;
      const nodes = [...svg.querySelectorAll('[data-testid="lifecycle-node"]')].map((n) => {
        const rect = n.querySelector('rect')!;
        const tone =
          n.getAttribute('data-current') === 'true'
            ? 'actual'
            : n.getAttribute('data-visited') === 'true'
              ? 'recorrido'
              : 'no alcanzado';
        return {
          tone,
          stroke: ratio(getComputedStyle(rect).stroke, bg),
          text: (n.textContent ?? '').trim(),
        };
      });
      const edges = [...svg.querySelectorAll('[data-testid="lifecycle-edge"]')].map((e) => ({
        traversed: e.getAttribute('data-traversed') === 'true',
        stroke: ratio(getComputedStyle(e.querySelector('path')!).stroke, bg),
        text: (e.querySelector('text')?.textContent ?? '').trim(),
      }));
      return { nodes, edges };
    });
    for (const tone of ['actual', 'recorrido', 'no alcanzado']) {
      const group = result.nodes.filter((n) => n.tone === tone);
      expect(group.length, tone).toBeGreaterThan(0);
      for (const n of group) {
        expect(n.stroke, `${tone} ${n.text}`).toBeGreaterThanOrEqual(3);
        expect(n.text.length, tone).toBeGreaterThan(0);
      }
    }
    expect(result.nodes.find((n) => n.tone === 'actual')!.text).toContain('(actual)');
    for (const e of result.edges.filter((x) => x.traversed)) {
      expect(e.stroke).toBeGreaterThanOrEqual(3);
      expect(e.text.length).toBeGreaterThan(0);
    }
    await shoot(page, testInfo, 'tema-recorrido-oscuro');
    await context.close();
  });

  test('[TC-PLATFORM-THEME-019] [TC-PLATFORM-THEME-020] el documento declara el esquema y el color de barra según la preferencia', async ({
    browser,
  }) => {
    const { context } = await newFinanceUser(browser, 'tema-019');

    // Sin cookie («Sistema»): los dos esquemas y un theme-color por esquema.
    const system = await rawHtml(context, '/transacciones');
    expect(system).toMatch(/<meta name="color-scheme" content="light dark"\s*\/?>/);
    const bars = system.match(/<meta name="theme-color"[^>]*>/g) ?? [];
    expect(bars).toHaveLength(2);
    expect(
      bars.some((t) => t.includes('(prefers-color-scheme: light)') && t.includes('content="#ffffff"')),
    ).toBe(true);
    expect(
      bars.some((t) => t.includes('(prefers-color-scheme: dark)') && t.includes('content="#0b0f14"')),
    ).toBe(true);
    expect(system).not.toMatch(/<html[^>]*data-theme/);

    // Con «Oscuro»: un solo esquema y un único theme-color con el fondo oscuro.
    await context.addCookies([{ name: 'pfos_theme', value: 'dark', url: appUrl() }]);
    const dark = await rawHtml(context, '/transacciones');
    expect(dark).toMatch(/<meta name="color-scheme" content="dark"\s*\/?>/);
    const darkBars = dark.match(/<meta name="theme-color"[^>]*>/g) ?? [];
    expect(darkBars).toHaveLength(1);
    expect(darkBars[0]).toContain('content="#0b0f14"');
    expect(darkBars[0]).not.toContain('media=');
    await context.close();
  });

  test('[TC-PLATFORM-THEME-021] la impresión sale en claro aunque el tema sea oscuro', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'tema-021');
    await patchTheme(page, 'dark');
    await context.addCookies([{ name: 'pfos_theme', value: 'dark', url: appUrl() }]);
    await page.emulateMedia({ colorScheme: 'dark' });
    await go(page, '/reportes/gastos-por-categoria');
    expect((await bodyColors(page)).bg).toBe(DARK.bg);
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
    const printed = await bodyColors(page);
    expect(printed.bg).toBe(LIGHT.bg);
    expect(printed.fg).toBe(LIGHT.fg);
    await context.close();
  });
});
