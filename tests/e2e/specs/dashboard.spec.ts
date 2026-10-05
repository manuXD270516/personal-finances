import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { bff, createKeycloakUser, env, login } from '../src/helpers.js';

/**
 * Home de Phase 1 (openspec add-basic-dashboard, tarea 7.2). Sin red: los providers del stack E2E apuntan a simulados
 * que solo responden durante `fx-providers.spec.ts` (y el cron corre cada 24 h), así que aquí la tasa "del provider" se
 * registra como lo haría la ingesta (fila `PROVIDER`/`PARALELO_BO` en el workspace del usuario, como `pf_app` bajo RLS);
 * la API nunca llama a un provider.
 */

/** Hoy (fecha de negocio) en America/La_Paz. */
const todayLaPaz = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** Primer día del mes anterior (siempre dentro del tramo "a la fecha" con el que compara el Home). */
const firstOfPreviousMonth = (today: string): string => {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return `${py}-${String(pm).padStart(2, '0')}-01`;
};

/** Tasa PARALLEL de paralelo.bo para el workspace, con vigencia `asOf` (simula una muestra del provider). */
async function providerRate(workspaceId: string, base: string, value: string, asOf: Date): Promise<void> {
  const db = new Client({ connectionString: env()['DATABASE_URL']! });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`, [
      workspaceId,
    ]);
    await db.query(
      `INSERT INTO fx.exchange_rate (id, workspace_id, base_currency, quote_currency, rate, rate_type, as_of,
                                     as_of_date, source, provider, fetched_at)
       VALUES ($1, $2, $3, 'BOB', $4, 'PARALLEL', $5, ($5::timestamptz AT TIME ZONE 'America/La_Paz')::date,
               'PROVIDER', 'PARALELO_BO', $5)`,
      [randomUUID(), workspaceId, base, value, asOf.toISOString()],
    );
    await db.query('COMMIT');
  } finally {
    await db.end();
  }
}

async function ok(
  page: Page,
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const r = await bff(page, method, `/api/bff/v1${path}`, {
    body,
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
  expect(r.status, `${method} ${path} ${JSON.stringify(r.body)}`).toBeLessThan(300);
  return r.body ?? {};
}

test.describe('Home: preguntas del dinero en Phase 1 (reporting/dashboard, reporting/net-worth)', () => {
  test('[TC-REPORTING-DASHBOARD-005] salario, gastos, reembolso y conversión canónica se ven en el Home con la tasa paralela y su atribución; providers caídos marcan la tasa obsoleta; móvil', async ({
    browser,
  }, testInfo) => {
    const username = `dash-${randomUUID().slice(0, 8)}`;
    const password = `Pw-${randomUUID()}`;
    await createKeycloakUser(username, password);
    const context = await browser.newContext({ baseURL: env()['WEB_PUBLIC_URL']! });
    const page = await context.newPage();
    await login(page, username, password);
    const me = await bff(page, 'GET', '/api/bff/v1/me');
    const ws = (me.body?.['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
    const W = `/workspaces/${ws}`;

    // Workspace nuevo y sin cuentas: Q1 NO_DATA (sin 0.00 BOB) y Q4/Q5/Q8/Q9 no disponibles, sin montos.
    await page.reload();
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByTestId('liquid-balance-no-accounts')).toBeVisible();
    await expect(page.getByTestId('liquid-balance-amount')).toHaveCount(0);
    for (const q of ['Q4', 'Q5', 'Q8', 'Q9']) {
      const widget = page.getByTestId(`question-${q}`);
      await expect(widget).toHaveAttribute('data-status', 'NOT_AVAILABLE_IN_PHASE');
      await expect(widget).toContainText('Aún no disponible');
      await expect(widget).not.toContainText(/\d+,\d{2}/);
    }

    const today = todayLaPaz();
    const bob = (amount: string) => ({ amount, currency: 'BOB' });
    const banco = (
      await ok(page, 'POST', `${W}/accounts`, {
        name: 'Banco BOB',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: bob('1000.00'), date: today },
      })
    )['id'];
    const wallet = (
      await ok(page, 'POST', `${W}/accounts`, {
        name: 'Wallet USDT',
        type: 'CRYPTO_WALLET',
        currency: 'USDT',
        openingBalance: { amount: { amount: '150.000000', currency: 'USDT' }, date: today },
      })
    )['id'];
    const cats = await bff(page, 'GET', `/api/bff/v1${W}/categories?kind=EXPENSE`);
    const expenseCats = (
      cats.body?.['data'] as { id: string; name: string; systemCode: string | null }[]
    ).filter((c) => c.systemCode === null);
    const [sup, res] = [expenseCats[0]!.id, expenseCats[1]!.id];
    const [supName, resName] = [expenseCats[0]!.name, expenseCats[1]!.name];
    // Mes anterior (FR-REPORTING-004): 1000.00 de la primera categoría con una tarjeta (pasivo, no líquida: el dinero
    // disponible no cambia), el día 1, dentro del tramo "a la fecha" con el que compara el Home.
    const visa = (
      await ok(page, 'POST', `${W}/accounts`, { name: 'Visa', type: 'CREDIT_CARD', currency: 'BOB' })
    )['id'];
    await ok(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: firstOfPreviousMonth(today),
      accountId: visa,
      amount: bob('1000.00'),
      splits: [{ amount: bob('1000.00'), categoryId: sup }],
    });
    // Providers caídos: la última muestra de paralelo.bo es de hace 3 h (obsoleta; umbral PARALLEL 60 min).
    await providerRate(ws, 'USDT', '12.02', new Date(Date.now() - 3 * 3_600_000));
    await ok(page, 'POST', `${W}/transactions`, {
      kind: 'INCOME',
      transactionDate: today,
      accountId: banco,
      amount: bob('8000.00'),
    });
    await ok(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: today,
      accountId: banco,
      amount: bob('1200.00'),
      splits: [{ amount: bob('1200.00'), categoryId: sup }],
    });
    const resto = await ok(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: today,
      accountId: banco,
      amount: bob('300.00'),
      splits: [{ amount: bob('300.00'), categoryId: res }],
    });
    await ok(page, 'POST', `${W}/transactions`, {
      kind: 'REFUND',
      transactionDate: today,
      accountId: banco,
      amount: bob('200.00'),
      refundOfTransactionId: resto['id'],
      splits: [{ amount: bob('200.00'), categoryId: res }],
    });
    // Conversión canónica: 100.000000 USDT → 685.00 BOB a cotizada 6.90 con fee de 5.00 BOB.
    await ok(page, 'POST', `${W}/conversions`, {
      transactionDate: today,
      sourceAccountId: wallet,
      targetAccountId: banco,
      sourceAmount: { amount: '100.000000', currency: 'USDT' },
      targetAmount: bob('685.00'),
      quotedRate: { base: 'USDT', quote: 'BOB', value: '6.90' },
      fees: [{ type: 'PROVIDER', amount: bob('5.00') }],
      executedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await page.reload();
    const dash = page.getByTestId('dashboard');
    await expect(dash).toBeVisible();
    // Ingresos 8000.00; gastos 1200.00 + 300.00 − 200.00 + 5.00 = 1305.00; ahorro 6695.00 (83.7 %).
    await expect(page.getByTestId('income-amount')).toHaveText(/8\.000,00\s*BOB/);
    await expect(page.getByTestId('expense-amount')).toHaveText(/1\.305,00\s*BOB/);
    await expect(page.getByTestId('savings-amount')).toHaveText(/6\.695,00\s*BOB/);
    await expect(page.getByTestId('savings-rate')).toContainText('83,7');

    // D50: jerarquía del Home — h1 de la página, dinero disponible destacado y "Este mes" justo después; <title> por
    // la Metadata API.
    await expect(page).toHaveTitle('Inicio · PFOS');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inicio');
    await expect(dash.locator('h2')).toHaveText([
      '¿Cuánto dinero tengo?',
      'Este mes',
      'Patrimonio y cuentas',
      'Próximamente',
    ]);
    const month = page.getByTestId('month-overview');
    await expect(month.getByRole('heading', { level: 3 })).toHaveText([
      '¿Cuánto ingresó?',
      '¿Cuánto gasté?',
      '¿Cuánto ahorré?',
      'Principales categorías de gasto',
    ]);
    // Top de categorías con la variación contra el mismo tramo del mes anterior, en texto (no solo color).
    const top = month.getByTestId('top-categories');
    await expect(top).toHaveAttribute('data-comparison', 'ready');
    const row = (name: string) =>
      top.getByTestId('top-category').filter({ has: page.getByText(name, { exact: true }) });
    await expect(row(supName).getByTestId('top-category-amount')).toHaveText('1.200,00 BOB');
    await expect(row(supName).getByTestId('top-category-trend')).toHaveAttribute('data-trend', 'up');
    await expect(row(supName).getByTestId('top-category-delta')).toHaveText('+200,00 BOB');
    await expect(row(supName).getByTestId('top-category-trend-label')).toHaveText('más que el mes anterior');
    await expect(row(supName).getByTestId('top-category-previous')).toContainText('1.000,00 BOB');
    // Restaurantes: 300.00 − 200.00 de reembolso = 100.00, sin gasto el mes anterior ⇒ "nuevo".
    await expect(row(resName).getByTestId('top-category-amount')).toHaveText('100,00 BOB');
    await expect(row(resName).getByTestId('top-category-trend')).toHaveAttribute('data-trend', 'new');
    await page.screenshot({ path: testInfo.outputPath('home-desktop.png'), fullPage: true });
    // Banco 1000 + 8000 − 1200 − 300 + 200 + 685 = 8385.00; 50.000000 USDT × 12.02 = 601.00 ⇒ 8986.00 BOB.
    const liquid = page.getByTestId('liquid-balance');
    await expect(page.getByTestId('liquid-balance-amount')).toHaveText(/8\.986,00\s*BOB/);
    const badge = liquid.getByTestId('rate-badge').first();
    await expect(badge.getByTestId('rate-value')).toContainText('USDT/BOB 12,02');
    await expect(badge.getByTestId('rate-attribution')).toContainText('Fuente: paralelo.bo');
    await expect(badge.getByTestId('rate-attribution')).toContainText('CC BY 4.0');
    await expect(badge.getByTestId('rate-stale')).toHaveText('obsoleta');
    await expect(badge.getByTestId('rate-age')).toContainText(/hace (2|3) h/);

    // El provider vuelve: muestra de hace 5 min ⇒ ya no obsoleta, mismo consolidado.
    await providerRate(ws, 'USDT', '12.02', new Date(Date.now() - 5 * 60_000));
    await page.reload();
    await expect(page.getByTestId('liquid-balance-amount')).toHaveText(/8\.986,00\s*BOB/);
    const fresh = page.getByTestId('liquid-balance').getByTestId('rate-badge').first();
    await expect(fresh).toHaveAttribute('data-stale', 'false');
    await expect(fresh.getByTestId('rate-stale')).toHaveCount(0);
    await expect(page.getByTestId('attributions')).toContainText('Fuente: paralelo.bo');

    // Viewport móvil: el Home se lee sin scroll horizontal.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await expect(page.getByTestId('liquid-balance-amount')).toBeVisible();
    await expect(page.getByTestId('expense-amount')).toHaveText(/1\.305,00\s*BOB/);
    await expect(page.getByTestId('top-categories')).toHaveAttribute('data-comparison', 'ready');
    await page.screenshot({ path: testInfo.outputPath('home-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});
