import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';
import { newUserPage } from '../src/helpers.js';

/**
 * Pronósticos de gasto e ingreso (openspec add-expense-forecasts, tarea 8.2) con el perfil `ml` del stack (servicio
 * `finance-ml` real, FORECASTING_ENABLED=true) y un workspace con historia preparada por API. El OWNER del workspace demo abre `/pronosticos`
 * (todavía sin pronóstico), solicita una corrida y la ve completada; cambia el horizonte, mira el rango probable, los
 * conocidos y los motivos, y revisa el aviso de no asesoría en español e inglés. Un VIEWER (sembrado en W1) no ve el
 * botón de la corrida.
 */

/**
 * Workspace personal (no demo) con 8 meses de gasto en una categoría y dos recurrentes. Se prepara por API: el worker
 * del stack no lee los workspaces demo (PF002 preexistente con el directorio de workspaces).
 */
async function prepareHistory(page: Page, W: string): Promise<void> {
  const account = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '50000.00');
  const group = String(
    (await api(page, 'POST', `${W}/category-groups`, { name: 'Vida diaria', kind: 'EXPENSE' }))['id'],
  );
  const category = String(
    (await api(page, 'POST', `${W}/categories`, { groupId: group, name: 'Restaurantes' }))['id'],
  );
  const [y, m] = todayLaPaz().split('-').map(Number) as [number, number];
  await api(page, 'POST', `${W}/periods`, { through: `${y + 1}-12-31` });
  for (let i = 8; i >= 1; i -= 1) {
    const idx = y * 12 + (m - 1) - i;
    const date = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-10`;
    const amount = (900 + (8 - i) * 25).toFixed(2);
    for (const day of ['10', '17', '24']) {
      await api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: `${date.slice(0, 8)}${day}`,
        accountId: account,
        amount: bob((Number(amount) / 3).toFixed(2)),
        splits: [{ amount: bob((Number(amount) / 3).toFixed(2)), categoryId: category }],
      });
    }
  }
  const next = y * 12 + m;
  const start = `${Math.floor(next / 12)}-${String((next % 12) + 1).padStart(2, '0')}-10`;
  for (const [name, kind, amount] of [
    ['Alquiler', 'EXPENSE', '2500.00'],
    ['Sueldo', 'INCOME', '8000.00'],
  ] as const) {
    await api(page, 'POST', `${W}/recurring`, {
      name,
      kind,
      template: {
        accountId: account,
        amount: { type: 'FIXED', amount: bob(amount) },
        ...(kind === 'EXPENSE' ? { categoryId: category } : {}),
        schedule: { cadence: 'MONTHLY', startDate: start },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
  }
}

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')) }));
}

test.describe('Pronósticos con el servicio finance-ml y un workspace con historia preparada por API (forecast/expense-forecasting)', () => {
  test('[TC-FORECAST-EXPENSE-015] [TC-FORECAST-EXPENSE-016] [TC-FORECAST-EXPENSE-018] el OWNER solicita una corrida, la ve completada y lee esperado con rango probable, conocidos, motivos y el aviso de no asesoría', async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const { page, W, workspaceId } = await newFinanceUser(browser, 'forecasts');
    await prepareHistory(page, W);

    await go(page, '/pronosticos');
    // Sin pronóstico todavía: lo dice y ofrece el botón (OWNER).
    await expect(page.getByTestId('forecast-none')).toBeVisible();
    await expect(page.getByTestId('forecast-disclaimer')).toContainText(
      'estimaciones estadísticas y no constituyen asesoría financiera',
    );
    await page.getByTestId('forecast-run').first().click();
    await expect(page.getByTestId('forecast-run-pending')).toBeVisible();

    // La corrida la procesa el worker (cada minuto) con el servicio real; la vista se actualiza sola.
    await expect(page.getByTestId('forecast-series-card')).toBeVisible({ timeout: 600_000 });
    await expect(page.getByTestId('forecast-headline')).toContainText(
      /Esperado: ~Bs [\d.,]+ · Rango probable: Bs [\d.,]+ – Bs [\d.,]+ \(80 %\)/,
    );
    const text = (await page.getByTestId('forecasts-root').innerText()).toLowerCase();
    expect(text).not.toContain('vas a gastar');
    expect(text).not.toContain('exactamente');

    // Horizonte por omisión de 3 periodos; cambiarlo actualiza la tabla accesible y la URL.
    await expect(page.getByTestId('forecast-horizon-3')).toBeChecked();
    await expect(page.getByTestId('forecast-row')).toHaveCount(3);
    await page.getByTestId('forecast-horizon-6').check();
    await expect(page.getByTestId('forecast-row')).toHaveCount(6);
    await expect(page).toHaveURL(/horizonte=6/);
    await page.getByTestId('forecast-horizon-3').check();
    await expect(page.getByTestId('forecast-row')).toHaveCount(3);

    // Detalle del periodo: rango del 95 %, conocidos aparte de la banda variable y motivos que explican el valor.
    await expect(page.getByTestId('forecast-range-95')).toContainText('Rango probable del 95 %');
    await expect(page.getByTestId('forecast-known')).toBeVisible();
    await expect(page.getByTestId('forecast-why')).toContainText('Promedio de los últimos 6 periodos');
    await expect(page.getByTestId('forecast-confidence')).toContainText(/Confianza: (baja|media|alta)/);
    await expect(page.getByTestId('forecast-meta')).toContainText('Modelo:');
    // El gráfico SVG tiene título y descripción y la tabla equivalente existe.
    await expect(page.getByTestId('forecast-chart').locator('svg title').first()).toBeAttached();
    await expect(page.getByTestId('forecast-table')).toBeVisible();

    // Cambiar a otra serie (una categoría) mantiene la vista accesible.
    const options = await page.getByTestId('forecast-series').locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1);
    await page.getByTestId('forecast-series').selectOption({ index: 1 });
    await expect(page.getByTestId('forecast-series-card')).toBeVisible();

    const violations = await seriousViolations(page);
    expect(violations, JSON.stringify(violations)).toEqual([]);

    // TC-016: el aviso de no asesoría financiera en inglés.
    await go(page, '/en/pronosticos');
    await expect(page.getByTestId('forecast-disclaimer')).toContainText(
      'Forecasts are statistical estimates and are not financial advice.',
    );

    // La API informa la descomposición y los conocidos del primer periodo.
    const latest = await api(page, 'GET', `/workspaces/${workspaceId}/forecasts/latest?horizon=3`);
    const total = (
      latest['series'] as { scope: string; points: { period: string; components: unknown }[] }[]
    ).find((s) => s.scope === 'TOTAL_EXPENSE');
    expect(total?.points).toHaveLength(3);
    expect(total?.points[0]?.components).not.toBeNull();
    const known = await api(
      page,
      'GET',
      `/workspaces/${workspaceId}/forecasts/latest/known-items?scope=TOTAL_EXPENSE&period=${total!.points[0]!.period}`,
    );
    expect(Array.isArray(known['items'])).toBe(true);
  });

  test('[TC-FORECAST-EXPENSE-018] un VIEWER abre la vista y no ve el botón para solicitar una corrida', async ({
    browser,
  }) => {
    const viewer = await newUserPage(browser, 'viewer', '/pronosticos');
    await expect(viewer.page.getByTestId('forecasts-page')).toBeVisible();
    await expect(viewer.page.getByTestId('forecast-disclaimer')).toBeVisible();
    await expect(viewer.page.getByTestId('forecast-run')).toHaveCount(0);
    await viewer.context.close();
  });
});
