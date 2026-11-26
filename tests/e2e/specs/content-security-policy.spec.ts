import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';
import { appUrl, env } from '../src/helpers.js';
import { ROOT } from '../src/stack.js';

/**
 * CSP de la web (openspec add-web-content-security-policy, NFR-SEC-008; TC-SECURITY-CSP-001..006): `proxy.ts` emite una
 * CSP aplicada con nonce por petición y la suite falla ante CUALQUIER violación en las pantallas de la navegación, la
 * subida de un documento y las páginas públicas de auth, en es/en/pt. El stack E2E no tiene Caddy delante: lo que
 * se prueba es la política de la propia web (la de Caddy, TC-SECURITY-CSP-007/008, se comprueba en el borde).
 */

interface Violation {
  readonly doc: string;
  readonly directive: string;
  readonly blocked: string;
  readonly sample: string;
}

/** Registra en Node cada `securitypolicyviolation` y los mensajes «Refused to …» de la consola (todas las frames). */
async function watchViolations(page: Page): Promise<Violation[]> {
  const found: Violation[] = [];
  await page.exposeFunction('__pfCspReport', (v: Violation) => found.push(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __pfCspReport(v: unknown): void }).__pfCspReport({
        doc: location.href,
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        sample: e.sample,
      });
    });
  });
  page.on('console', (m) => {
    if (/Refused to|Content Security Policy/i.test(m.text()))
      found.push({ doc: page.url(), directive: 'console', blocked: '', sample: m.text() });
  });
  return found;
}

/** Violaciones ocurridas en documentos de la web (no en Keycloak, que gestiona su propia cabecera). */
const ofApp = (violations: readonly Violation[]) =>
  violations.filter((v) => v.doc.startsWith(appUrl()) || v.directive === 'console');

/** Rutas de la navegación principal: se leen del código de `apps/web` para que una sección nueva entre sola. */
function navPaths(): string[] {
  const source = readFileSync(`${ROOT}/apps/web/src/ui/shell/nav.ts`, 'utf8');
  const block = /export const NAV_ITEMS[\s\S]*?\n\];/.exec(source)?.[0] ?? '';
  const paths = [...block.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]!);
  expect(paths.length).toBeGreaterThan(10);
  return paths;
}

/** Páginas fuera de la sidebar que también cargan scripts propios (gráficos, listas, preferencias). */
const EXTRA_PATHS = [
  '/patrimonio',
  '/disponible',
  '/pagos-proximos',
  '/notificaciones',
  '/preferencias',
  '/reportes/tendencias',
];

const cspDirective = (policy: string, name: string): string[] =>
  policy
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .find(([n]) => n === name)
    ?.slice(1) ?? [];

const nonceOf = (policy: string): string =>
  /'nonce-([^']+)'/.exec(cspDirective(policy, 'script-src').join(' '))?.[1] ?? '';

/** HTML crudo de una página, con la sesión del contexto, y la cabecera de política de la respuesta. */
async function fetchPage(
  context: BrowserContext,
  path: string,
): Promise<{ html: string; policy: string; headers: Record<string, string> }> {
  const res = await context.request.get(`${appUrl()}${path}`);
  expect(res.status()).toBe(200);
  const headers = res.headers();
  return { html: await res.text(), policy: headers['content-security-policy'] ?? '', headers };
}

const pdf = (label: string): Buffer => {
  const content = deflateSync(Buffer.from(`BT /F1 12 Tf 20 100 Td (${label}) Tj ET`));
  return Buffer.concat([
    Buffer.from(
      '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n',
      'latin1',
    ),
    Buffer.from(`4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    content,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
};

test.describe('CSP de la web (security/access-control)', () => {
  test('[TC-SECURITY-CSP-001] [TC-SECURITY-CSP-002] [TC-SECURITY-CSP-006] la cabecera es aplicada, con nonce distinto en cada carga que llevan todos los scripts, y sin style en línea', async ({
    browser,
  }) => {
    const { context } = await newFinanceUser(browser, 'csp-cabecera');

    const first = await fetchPage(context, '/');
    const second = await fetchPage(context, '/');
    expect(first.headers['content-security-policy-report-only']).toBeUndefined();

    const nonce = nonceOf(first.policy);
    expect(Buffer.from(nonce, 'base64').length).toBeGreaterThanOrEqual(16);
    expect(nonceOf(second.policy)).not.toBe(nonce);

    const script = cspDirective(first.policy, 'script-src');
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(cspDirective(first.policy, 'frame-ancestors')).toEqual(["'none'"]);
    expect(cspDirective(first.policy, 'object-src')).toEqual(["'none'"]);
    expect(cspDirective(first.policy, 'base-uri')).toEqual(["'none'"]);
    expect(cspDirective(first.policy, 'form-action')).toEqual(["'self'"]);
    // Estilos: hojas con self y nonce; los atributos en línea que React emite al renderizar quedan permitidos (D457).
    expect(cspDirective(first.policy, 'style-src')).toEqual(["'self'", `'nonce-${nonce}'`]);
    expect(cspDirective(first.policy, 'style-src-attr')).toEqual(["'unsafe-inline'"]);

    // Todos los scripts del HTML llevan el nonce de la cabecera de SU respuesta.
    for (const { html, policy } of [first, second]) {
      const tags = html.match(/<script\b[^>]*>/g) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag, tag).toContain(`nonce="${nonceOf(policy)}"`);
      expect(html).not.toMatch(/<style[\s>]/);
    }
  });

  test('[TC-SECURITY-CSP-003] connect-src es self más el origen de subida configurado, y nada más', async ({
    browser,
  }) => {
    const { context } = await newFinanceUser(browser, 'csp-connect');
    const { policy } = await fetchPage(context, '/');
    const filesOrigin = new URL(env()['OBJECT_STORAGE_PUBLIC_ENDPOINT']!).origin;
    expect(cspDirective(policy, 'connect-src')).toEqual(["'self'", filesOrigin]);
    expect(cspDirective(policy, 'img-src')).toEqual(["'self'", 'data:', 'blob:']);
    expect(cspDirective(policy, 'font-src')).toEqual(["'self'"]);
    expect(cspDirective(policy, 'default-src')).toEqual(["'self'"]);
  });

  test('[TC-SECURITY-CSP-005] las páginas públicas de auth (es, en y pt) llevan CSP con nonce propio y se muestran sin violaciones', async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: appUrl() });
    const page = await context.newPage();
    const violations = await watchViolations(page);
    const nonces = new Set<string>();
    for (const path of ['/auth/error', '/en/auth/error', '/pt/auth/error', '/auth/error?reason=expired']) {
      const res = await page.goto(path);
      const policy = res?.headers()['content-security-policy'] ?? '';
      expect(policy, path).toContain('nonce-');
      nonces.add(nonceOf(policy));
      await expect(page.getByRole('main')).toBeVisible();
      const html = await page.content();
      expect(html).not.toMatch(/<style[\s>]/);
    }
    expect(nonces.size).toBe(4);
    expect(ofApp(violations)).toEqual([]);
    await context.close();
  });

  test('[TC-SECURITY-CSP-001] [TC-SECURITY-CSP-006] todas las pantallas de la navegación (es), una por idioma (en y pt) y el 404 se muestran sin violaciones de CSP', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page, W } = await newFinanceUser(browser, 'csp-nav');
    // Datos para que las vistas con gráfico (Home, flujo de caja, reportes, patrimonio) dibujen algo.
    const caja = await openAccount(page, W, 'Caja CSP', 'CASH', 'BOB', '3000.00');
    for (const [amount, description] of [
      ['150.00', 'Supermercado'],
      ['80.00', 'Transporte'],
    ] as const)
      await api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        status: 'POSTED',
        transactionDate: todayLaPaz(),
        accountId: caja,
        amount: bob(amount),
        description,
      });

    const violations = await watchViolations(page);
    const visited: string[] = [];
    for (const path of [...navPaths(), ...EXTRA_PATHS, '/en', '/pt/flujo-de-caja', '/en/reportes']) {
      await go(page, path);
      visited.push(path);
    }
    // Ruta inexistente: 404 propio renderizado por petición (con nonce), no el prerenderizado de Next.
    const missing = await page.goto('/es/ruta-que-no-existe');
    expect(missing?.status()).toBe(404);
    expect(missing?.headers()['content-security-policy']).toContain('nonce-');
    await expect(page.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeVisible();

    expect(visited.length).toBeGreaterThan(20);
    expect(ofApp(violations)).toEqual([]);
    await context.close();
  });

  test('[TC-SECURITY-CSP-006] el calendario de flujo de caja de 30 días, el Home y los reportes se muestran con estilos y gráficos', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'csp-vistas');
    const caja = await openAccount(page, W, 'Caja vistas', 'CASH', 'BOB', '2000.00');
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: todayLaPaz(),
      accountId: caja,
      amount: bob('120.00'),
      description: 'Comida',
    });
    const violations = await watchViolations(page);
    await go(page, '/flujo-de-caja');
    await expect(page.locator('.pf-cf').first()).toBeVisible();
    // La hoja estática se aplicó: la rejilla de la vista usa `display: grid` (regla de `.pf-cf` en cash-flow.css).
    await expect(page.locator('.pf-cf').first()).toHaveCSS('display', 'grid');
    await go(page, '/');
    await expect(page.locator('.pf-home').first()).toBeVisible();
    await go(page, '/reportes/ingresos-gastos');
    await expect(page.getByTestId('report-ingresos-gastos')).toBeVisible();
    expect(ofApp(violations)).toEqual([]);
    await context.close();
  });

  test('[TC-SECURITY-CSP-003] adjuntar un PDF a una transacción funciona bajo la CSP, y una conexión a otro origen queda bloqueada', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { context, page, W } = await newFinanceUser(browser, 'csp-subida');
    const caja = await openAccount(page, W, 'Caja subida', 'CASH', 'BOB', '500.00');
    const expense = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: todayLaPaz(),
      accountId: caja,
      amount: bob('120.00'),
      description: 'Supermercado CSP',
    });
    const violations = await watchViolations(page);
    await go(page, `/transacciones/${String(expense['id'])}`);
    const section = page.getByTestId('attachments');
    await expect(section).toBeVisible();
    await section.getByTestId('attachment-file').setInputFiles({
      name: 'comprobante.pdf',
      mimeType: 'application/pdf',
      buffer: pdf('Comprobante CSP 120.00'),
    });
    const item = section.getByTestId('attachment-item');
    await expect(item).toHaveCount(1, { timeout: 60_000 });
    await expect(item).toContainText('comprobante.pdf');
    expect(ofApp(violations)).toEqual([]);

    // Una conexión a otro origen la bloquea connect-src y se registra la violación.
    const outcome = await page.evaluate(() =>
      fetch('https://example.invalid/').then(
        () => 'ok',
        () => 'blocked',
      ),
    );
    expect(outcome).toBe('blocked');
    await expect
      .poll(() => ofApp(violations).filter((v) => v.directive === 'connect-src').length)
      .toBeGreaterThan(0);
    await context.close();
  });

  test('[TC-SECURITY-CSP-006] un elemento style en línea sin el nonce de la petición no se aplica y registra una violación', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'csp-inyeccion');
    const violations = await watchViolations(page);
    await go(page, '/');
    expect(ofApp(violations)).toEqual([]);
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = 'body{outline:5px solid red}';
      document.head.appendChild(style);
    });
    await expect
      .poll(() =>
        ofApp(violations)
          .map((v) => v.directive)
          .filter((d) => d !== 'console'),
      )
      .toContain('style-src-elem');
    await context.close();
  });

  test('[TC-SECURITY-CSP-004] un sitio ajeno no puede enmarcar la web: frame-ancestors none', async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: appUrl() });
    const page = await context.newPage();
    const framer = 'http://sitio-ajeno.test/';
    await page.route(framer, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><iframe id="victima" src="${appUrl()}/auth/error" width="600" height="400"></iframe>`,
      }),
    );
    await page.goto(framer);
    // El navegador bloquea el enmarcado y reemplaza el iframe por su página de error: ninguna frame muestra la web.
    const children = () =>
      page
        .frames()
        .filter((f) => f !== page.mainFrame())
        .map((f) => f.url());
    await expect.poll(children).toEqual([expect.stringMatching(/^chrome-error:/)]);
    for (const frame of page.frames())
      await expect(frame.locator('[data-testid="ready"], main')).toHaveCount(0);
    const res = await context.request.get(`${appUrl()}/auth/error`);
    expect(cspDirective(res.headers()['content-security-policy'] ?? '', 'frame-ancestors')).toEqual([
      "'none'",
    ]);
    await context.close();
  });
});
