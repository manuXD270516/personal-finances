import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';

/**
 * Banda del gasto variable predicho en el calendario de flujo de caja y en el Home (openspec
 * add-predicted-cash-flow-band, tareas 7.2 y 6): con el perfil `ml` del stack (servicio `finance-ml` real,
 * FORECASTING_ENABLED=true) y un workspace personal con historia preparada por API (el worker del stack no lee los
 * workspaces demo: PF002 preexistente con el directorio de workspaces). El OWNER solicita una corrida, espera a que
 * termine y ve en `/flujo-de-caja` el área de la banda, la línea del esperado y la probabilidad de déficit con su
 * explicación del 80 %; en el Home, Q3 suma el gasto esperado con su rango probable y Q8 la probabilidad de déficit en
 * una línea aparte del riesgo. La función deshabilitada (calendario y Home como en Phase 7) la cubre la prueba de API,
 * porque el stack de E2E trae el pronóstico siempre habilitado.
 */

async function prepareHistory(page: Page, W: string): Promise<void> {
  const account = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '50000.00');
  const group = String(
    (await api(page, 'POST', `${W}/category-groups`, { name: 'Vida diaria', kind: 'EXPENSE' }))['id'],
  );
  const category = String(
    (await api(page, 'POST', `${W}/categories`, { groupId: group, name: 'Restaurantes' }))['id'],
  );
  const today = todayLaPaz();
  const [y, m] = today.split('-').map(Number) as [number, number];
  await api(page, 'POST', `${W}/periods`, { through: `${y + 1}-12-31` });
  for (let i = 8; i >= 1; i -= 1) {
    const idx = y * 12 + (m - 1) - i;
    const month = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
    const amount = (300 + (8 - i) * 10).toFixed(2);
    for (const day of ['10', '17', '24']) {
      await api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: `${month}-${day}`,
        accountId: account,
        amount: bob(amount),
        splits: [{ amount: bob(amount), categoryId: category }],
      });
    }
  }
  // Un gasto de hoy: el Home tiene datos en Q3 y la banda descuenta lo ya gastado del periodo.
  await api(page, 'POST', `${W}/transactions`, {
    kind: 'EXPENSE',
    transactionDate: today,
    accountId: account,
    amount: bob('120.00'),
    splits: [{ amount: bob('120.00'), categoryId: category }],
  });
  const next = y * 12 + m;
  const start = `${Math.floor(next / 12)}-${String((next % 12) + 1).padStart(2, '0')}-10`;
  await api(page, 'POST', `${W}/recurring`, {
    name: 'Alquiler',
    kind: 'EXPENSE',
    template: {
      accountId: account,
      amount: { type: 'FIXED', amount: bob('2500.00') },
      categoryId: category,
      schedule: { cadence: 'MONTHLY', startDate: start },
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    },
  });
}

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')) }));
}

test.describe('Banda del gasto variable predicho con el servicio finance-ml (reporting/cash-flow-calendar, reporting/dashboard)', () => {
  test('[TC-REPORTING-PREDICTED-006] [TC-REPORTING-PREDICTED-009] [TC-REPORTING-PREDICTED-010] el calendario muestra la banda y la probabilidad de déficit y el Home suma el gasto esperado y la probabilidad aparte del riesgo', async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const { page, W, workspaceId } = await newFinanceUser(browser, 'band');
    await prepareHistory(page, W);

    // Sin pronóstico el calendario lo dice y no dibuja la banda; el Home queda como siempre.
    await go(page, '/flujo-de-caja');
    await expect(page.getByTestId('cash-flow-currency').first()).toBeVisible();
    await expect(page.getByTestId('cash-flow-predicted-unavailable').first()).toHaveAttribute(
      'data-reason',
      'NO_FORECAST',
    );
    await expect(page.getByTestId('cash-flow-band-area')).toHaveCount(0);

    // Solicita la corrida; la procesa el worker (cada minuto) con el servicio real.
    await api(page, 'POST', `${W}/forecasts`);
    await expect
      .poll(
        async () => {
          const latest = await api(
            page,
            'GET',
            `/workspaces/${workspaceId}/forecasts/latest?scope=LIQUID_VARIABLE_OUTFLOW`,
          );
          return `${latest['status']}:${(latest['series'] as unknown[]).length}`;
        },
        { timeout: 600_000, intervals: [5_000] },
      )
      .toBe('AVAILABLE:1');

    // ── Calendario de 30 días: la banda (área y línea del esperado), la probabilidad y la explicación del 80 %.
    await go(page, '/flujo-de-caja');
    await expect(page.getByTestId('cash-flow-band-area')).toBeVisible();
    await expect(page.getByTestId('cash-flow-band-expected')).toBeAttached();
    const predicted = page.getByTestId('cash-flow-predicted');
    await expect(predicted).toBeVisible();
    await expect(page.getByTestId('cash-flow-predicted-likelihood')).toContainText(/Déficit .* en BOB/);
    await expect(page.getByTestId('cash-flow-predicted-help')).toContainText(
      'límite superior del intervalo del 80 %',
    );
    // La tabla equivalente trae las columnas de la banda.
    await page.getByTestId('cash-flow-table-details').locator('summary').click();
    await expect(page.getByTestId('cash-flow-table')).toContainText('Con gasto alto');
    // El riesgo de los pagos conocidos sigue aparte y sin cambios.
    await expect(page.getByTestId('cash-flow-risk-card')).toHaveAttribute('data-risk', 'NONE');
    const violations = await seriousViolations(page);
    expect(violations, JSON.stringify(violations)).toEqual([]);

    // La API informa la banda por moneda sin tocar la serie principal.
    const calendar = await api(page, 'GET', `${W}/reports/cash-flow-calendar?horizon=30`);
    const bobBlock = (
      calendar['currencies'] as { currency: string; predicted: { status: string; series: unknown[] } }[]
    ).find((c) => c.currency === 'BOB');
    expect(bobBlock?.predicted.status).toBe('AVAILABLE');
    expect(bobBlock?.predicted.series).toHaveLength(31);

    // ── Home: Q3 con el gasto esperado y su rango; Q8 con la probabilidad de déficit en una línea aparte.
    await go(page, '/');
    const q3 = page.locator('[data-question="Q3"]').first();
    await expect(q3.getByTestId('expense-expected')).toContainText(
      /Esperado: ~[\d.,]+ BOB · Rango probable: [\d.,]+ BOB a [\d.,]+ BOB \(80 %\)/,
    );
    const q8 = page.locator('[data-question="Q8"]').first();
    await expect(q8.getByTestId('cash-flow-q8-risk')).toBeVisible();
    await expect(q8.getByTestId('cash-flow-q8-predicted')).toContainText(/déficit .* en BOB/);
  });
});
