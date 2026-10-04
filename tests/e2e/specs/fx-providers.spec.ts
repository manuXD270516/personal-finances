import { expect, test, type Page } from '@playwright/test';
import { api, go, newFinanceUser } from '../src/finance.js';
import { FxProviderSim, minutesAgo, pastDays, triggerPoll } from '../src/fx-sim.js';
import { W1, bff, newUserPage } from '../src/helpers.js';

/**
 * `/fx` → Proveedores con providers SIMULADOS (add-market-rate-providers 6.1, 6.2 y 7.2): un servidor HTTP local del
 * harness hace de paralelo.bo y bo.dolarapi.com (nunca la red real) y cada ciclo de consulta lo dispara la prueba.
 * Escenarios: principal OK (12.02 con atribución), principal caído (12.055 de respaldo), ambos caídos (12.02 obsoleta
 * con antigüedad) y anomalía 13.50 confirmada por un EDITOR (el VIEWER solo la ve).
 *
 * La consulta reparte cada muestra a todos los workspaces activos: cada escenario usa un workspace creado en el momento
 * justo (la carga histórica de paralelo.bo le da solo días cerrados ≥ 2 días atrás, siempre obsoletos).
 */

interface Feed {
  base: string;
  quote: string;
  rateType: string;
  lastRate: { value: string } | null;
}
interface Status {
  provider: 'PARALELO_BO' | 'DOLARAPI_BO';
  health: string;
  lastAttemptAt: string | null;
  consecutiveFailures: number;
  feeds: Feed[];
  backfill: { status: string };
}

const sim = new FxProviderSim();
const HISTORY = pastDays(6, 2).map((day) => ({ day, value: '12.02' }));

async function statuses(page: Page, W: string): Promise<Status[]> {
  return (await api(page, 'GET', `${W}/fx-providers/status`))['data'] as Status[];
}
const of = (list: Status[], p: Status['provider']) => list.find((s) => s.provider === p)!;
const feed = (s: Status, base: string, rateType = 'PARALLEL') =>
  s.feeds.find((f) => f.base === base && f.quote === 'BOB' && f.rateType === rateType);

/** Dispara un ciclo y espera a que ambos providers registren un intento nuevo. */
async function poll(page: Page, W: string): Promise<void> {
  const before = await statuses(page, W);
  await triggerPoll();
  await expect
    .poll(
      async () => {
        const now = await statuses(page, W);
        return (['PARALELO_BO', 'DOLARAPI_BO'] as const).every(
          (p) =>
            of(now, p).lastAttemptAt !== null && of(now, p).lastAttemptAt !== of(before, p).lastAttemptAt,
        );
      },
      { timeout: 60_000, intervals: [500, 1000] },
    )
    .toBe(true);
}

const valuation = (page: Page, pair: string, rateType = 'PARALLEL') =>
  page.locator(`[data-testid="valuation-rate"][data-pair="${pair}"][data-rate-type="${rateType}"]`);
const card = (page: Page, provider: string) =>
  page.locator(`[data-testid="provider-card"][data-provider="${provider}"]`);

async function openProviders(page: Page): Promise<void> {
  await go(page, '/fx?vista=proveedores');
  await expect(page.getByRole('tab', { name: 'Proveedores' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('fx-providers')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('Proveedores de tasas de mercado simulados (fx/market-rate-providers)', () => {
  test.beforeAll(async () => {
    await sim.start();
  });
  test.afterAll(async () => {
    await sim.stop();
  });

  test('[TC-FX-PROVIDER-012] [TC-FX-PROVIDER-015] [TC-FX-PROVIDER-016] principal OK: 12.02 de paralelo.bo con atribución CC BY 4.0, compra/venta y carga histórica', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    sim.paralelo = {
      rate: { median: '12.02', buy: '12.12', sell: '11.92', at: minutesAgo(3) },
      history: HISTORY,
    };
    sim.dolarapi = {
      binance: { compra: '12.04', venta: '12.07', at: minutesAgo(5) },
      oficial: { compra: '12', venta: '12', at: minutesAgo(60) },
    };
    const { context, page, W, workspaceId } = await newFinanceUser(browser, 'fxa');
    await poll(page, W);
    await expect
      .poll(async () => feed(of(await statuses(page, W), 'PARALELO_BO'), 'USD')?.lastRate?.value ?? null, {
        timeout: 30_000,
      })
      .toMatch(/^12\.02/);

    await openProviders(page);
    const usd = valuation(page, 'USD/BOB');
    await expect(usd.getByTestId('rate-badge')).toHaveAttribute('data-selection', 'PRIMARY');
    await expect(usd.getByTestId('valuation-level')).toHaveText('(principal)');
    await expect(usd.getByTestId('rate-value')).toContainText('USD/BOB 12,02');
    const attribution = usd.getByTestId('rate-attribution');
    await expect(attribution.getByRole('link', { name: 'Fuente: paralelo.bo' })).toHaveAttribute(
      'href',
      'https://paralelo.bo',
    );
    await expect(attribution.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    );
    await expect(usd.getByTestId('rate-stale')).toHaveCount(0);
    await expect(usd.getByTestId('rate-age')).toContainText('hace');

    const paralelo = card(page, 'PARALELO_BO');
    await expect(paralelo).toHaveAttribute('data-health', 'HEALTHY');
    await expect(paralelo.getByTestId('provider-health')).toHaveText('Saludable');
    // D39: compra = BOB que pagas al comprar 1 USD (12,12); venta = BOB que recibes al venderlo (11,92).
    const sides = paralelo.locator('[data-testid="quote-sides"][data-pair="USD/BOB"]');
    await expect(sides.getByTestId('quote-buy')).toHaveText('Compra 12,12 BOB');
    await expect(sides.getByTestId('quote-sell')).toHaveText('Venta 11,92 BOB');
    await expect(
      card(page, 'DOLARAPI_BO').getByRole('link', { name: 'Fuente: bo.dolarapi.com' }),
    ).toHaveAttribute('href', 'https://bo.dolarapi.com');
    // Carga histórica del workspace nuevo (5 días cerrados del simulado).
    await expect
      .poll(async () => of(await statuses(page, W), 'PARALELO_BO').backfill.status, { timeout: 60_000 })
      .toBe('COMPLETED');
    await page.reload();
    await expect(card(page, 'PARALELO_BO').getByTestId('provider-backfill')).toHaveAttribute(
      'data-status',
      'COMPLETED',
    );
    await expect(card(page, 'PARALELO_BO').getByTestId('provider-backfill')).toContainText('completada');

    // La tasa de provider también lleva su atribución en la pestaña Tasas.
    await page.getByRole('tab', { name: 'Tasas' }).click();
    const usdPair = page.locator('[data-testid="rate-pair"][data-pair="USD/BOB"]');
    await expect(usdPair.getByRole('link', { name: 'Fuente: paralelo.bo' }).first()).toBeVisible();

    // Las solicitudes al provider no llevan datos del usuario (NFR-COMP-001): sin query, cookies ni credenciales.
    expect(sim.requests.length).toBeGreaterThan(0);
    for (const r of sim.requests) {
      expect(r.method).toBe('GET');
      expect(r.url).not.toContain('?');
      expect(r.url).not.toContain(workspaceId);
      expect(r.headers['cookie']).toBeUndefined();
      expect(r.headers['authorization']).toBeUndefined();
    }
    await context.close();
  });

  test('[TC-FX-PROVIDER-007] principal caído: la valoración usa 12.055 de bo.dolarapi.com como respaldo y el estado muestra la falla', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    sim.paralelo = { rate: null, history: HISTORY };
    sim.dolarapi = { ...sim.dolarapi, binance: { compra: '12.04', venta: '12.07', at: minutesAgo(5) } };
    const { context, page, W } = await newFinanceUser(browser, 'fxb');
    await poll(page, W);
    await expect
      .poll(async () => feed(of(await statuses(page, W), 'DOLARAPI_BO'), 'USD')?.lastRate?.value ?? null, {
        timeout: 30_000,
      })
      .toMatch(/^12\.055/);

    await openProviders(page);
    const usd = valuation(page, 'USD/BOB');
    await expect(usd.getByTestId('rate-badge')).toHaveAttribute('data-selection', 'FALLBACK');
    await expect(usd.getByTestId('rate-value')).toContainText('USD/BOB 12,055');
    await expect(usd.getByTestId('rate-level')).toHaveText('respaldo');
    await expect(
      usd.getByTestId('rate-attribution').getByRole('link', { name: 'Fuente: bo.dolarapi.com' }),
    ).toHaveAttribute('href', 'https://bo.dolarapi.com');
    await expect(usd.getByTestId('rate-attribution')).not.toContainText('CC BY');
    const paralelo = card(page, 'PARALELO_BO');
    await expect(paralelo).toHaveAttribute('data-health', 'DOWN');
    await expect(paralelo.getByTestId('provider-error')).toContainText('No disponible (HTTP 503)');
    await expect(card(page, 'DOLARAPI_BO')).toHaveAttribute('data-health', 'HEALTHY');
    await context.close();
  });

  test('[TC-FX-PROVIDER-008] ambos caídos: la última conocida 12.02 se muestra obsoleta con su antigüedad', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    sim.paralelo = { rate: null, history: HISTORY };
    sim.dolarapi = { ...sim.dolarapi, binance: null };
    const { context, page, W } = await newFinanceUser(browser, 'fxc');
    // Solo la carga histórica (días cerrados de hace ≥ 2 días) alimenta este workspace.
    await expect
      .poll(
        async () => ((await api(page, 'GET', `${W}/fx-rates?source=PROVIDER&limit=5`))['data'] as []).length,
        {
          timeout: 60_000,
        },
      )
      .toBeGreaterThan(0);
    await poll(page, W);

    await openProviders(page);
    const usd = valuation(page, 'USD/BOB');
    await expect(usd.getByTestId('rate-badge')).toHaveAttribute('data-selection', 'LAST_KNOWN_STALE');
    await expect(usd.getByTestId('rate-value')).toContainText('USD/BOB 12,02');
    await expect(usd.getByTestId('rate-stale')).toHaveText('obsoleta');
    await expect(usd.getByTestId('rate-level')).toHaveText('última conocida');
    await expect(usd.getByTestId('rate-age')).toHaveText(/^hace \d+ d$/);
    await expect(usd.getByTestId('rate-attribution')).toContainText('Fuente: paralelo.bo');
    await expect(card(page, 'PARALELO_BO')).toHaveAttribute('data-health', 'DOWN');
    await expect(card(page, 'DOLARAPI_BO')).toHaveAttribute('data-health', 'DOWN');
    await expect(card(page, 'DOLARAPI_BO').getByTestId('provider-error')).toContainText('(HTTP 503)');
    await context.close();
  });

  test('[TC-FX-PROVIDER-010] anomalía 13.50: el VIEWER la ve sin poder revisarla; el EDITOR la confirma con motivo y pasa a valorar', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    sim.paralelo = { rate: { median: '13.50', at: minutesAgo(1) }, history: HISTORY };
    const viewer = await newUserPage(browser, 'viewer');
    expect(
      (await bff(viewer.page, 'PUT', '/api/bff/session', { body: { activeWorkspaceId: W1 } })).status,
    ).toBe(200);
    const W = `/workspaces/${W1}`;
    await poll(viewer.page, W);
    await expect
      .poll(
        async () =>
          (
            (
              await api(
                viewer.page,
                'GET',
                `${W}/fx-rates?source=PROVIDER&base=USD&quote=BOB&rateType=PARALLEL&limit=20`,
              )
            )['data'] as { value: string; anomaly: { status: string } | null }[]
          ).some((r) => r.value.startsWith('13.5') && r.anomaly?.status === 'PENDING'),
        { timeout: 30_000 },
      )
      .toBe(true);

    await openProviders(viewer.page);
    const inbox = viewer.page.getByTestId('anomaly-inbox');
    const pending = inbox.locator('[data-testid="anomaly"][data-pair="USD/BOB"]');
    await expect(pending.getByTestId('anomaly-value')).toHaveText('1 USD = 13,50 BOB');
    await expect(pending.getByTestId('anomaly-variation')).toHaveText('variación +12,31 % (umbral 5 %)');
    await expect(inbox).toContainText('Solo lectura');
    await expect(inbox.getByTestId('anomaly-review-form')).toHaveCount(0);
    // Pendiente: la valoración sigue con 12.02.
    await expect(valuation(viewer.page, 'USD/BOB').getByTestId('rate-value')).toContainText('USD/BOB 12,02');
    await viewer.context.close();

    const editor = await newUserPage(browser, 'editor');
    expect(
      (await bff(editor.page, 'PUT', '/api/bff/session', { body: { activeWorkspaceId: W1 } })).status,
    ).toBe(200);
    await openProviders(editor.page);
    const form = editor.page
      .getByTestId('anomaly-inbox')
      .locator('[data-testid="anomaly"][data-pair="USD/BOB"]')
      .getByTestId('anomaly-review-form');
    await form.getByRole('button', { name: 'Confirmar' }).click();
    await expect(form.getByTestId('field-error')).toHaveText('El motivo debe tener al menos 3 caracteres.');
    await form.getByLabel('Motivo').fill('Devaluación verificada en casas de cambio');
    await form.getByRole('button', { name: 'Confirmar' }).click();
    await expect(editor.page.getByTestId('fx-providers').getByRole('status')).toContainText(
      'Anomalía confirmada: 1 USD = 13,50 BOB',
    );
    const usd = valuation(editor.page, 'USD/BOB');
    await expect(usd.getByTestId('rate-value')).toContainText('USD/BOB 13,5');
    await expect(usd.getByTestId('rate-badge')).toHaveAttribute('data-selection', 'PRIMARY');
    await expect(
      editor.page.locator('[data-testid="anomaly-reviewed"][data-status="CONFIRMED"]').first(),
    ).toContainText('motivo: Devaluación verificada en casas de cambio');
    await editor.context.close();
  });
});
