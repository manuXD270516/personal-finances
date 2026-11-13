import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, go, newFinanceUser } from '../src/finance.js';
import { prepareForecastHistory as prepareHistory } from '../src/forecast-history.js';
import { newUserPage } from '../src/helpers.js';

/**
 * Pronósticos de gasto e ingreso (openspec add-expense-forecasts, tarea 8.2) con el perfil `ml` del stack (servicio
 * `finance-ml` real, FORECASTING_ENABLED=true) y un workspace con historia preparada por API. El OWNER del workspace demo abre `/pronosticos`
 * (todavía sin pronóstico), solicita una corrida y la ve completada; cambia el horizonte, mira el rango probable, los
 * conocidos y los motivos, y revisa el aviso de no asesoría en español e inglés. Un VIEWER (sembrado en W1) no ve el
 * botón de la corrida.
 */

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
