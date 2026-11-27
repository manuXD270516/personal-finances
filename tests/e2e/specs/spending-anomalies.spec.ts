import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { prepareAnomalyHistory, triggerAnomalyPass } from '../src/anomalies.js';
import { api, expectNoHorizontalScroll, go, newFinanceUser } from '../src/finance.js';

/**
 * Gastos atípicos (openspec add-spending-anomaly-detection, tarea 7.2) con un workspace personal cuya historia de
 * «Restaurantes» se prepara por API (el worker del stack no lee los workspaces demo) y un gasto de 304.00 BOB de ayer. El
 * trabajo diario `forecasting.schedule` (mediana y MAD en TypeScript, sin el servicio de pronósticos) lo marca; el OWNER mira
 * la lista con el motivo, la marca en el listado y el detalle de la transacción, lo descarta con un motivo y lo restaura, y
 * las preferencias de notificaciones muestran el tipo apagado por omisión. Sin violaciones serias de axe ni scroll horizontal.
 */

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')) }));
}

test.describe('Gastos atípicos con la detección diaria del worker (forecast/anomaly-detection)', () => {
  test('[TC-FORECAST-ANOMALY-016] [TC-FORECAST-ANOMALY-017] [TC-FORECAST-ANOMALY-018] [TC-FORECAST-ANOMALY-019] [TC-NOTIFICATIONS-ANOMALY-001] el OWNER ve el gasto atípico con su motivo, su marca en la transacción, lo descarta y lo restaura', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const { page, W } = await newFinanceUser(browser, 'anomalias');
    const { atypical } = await prepareAnomalyHistory(page, W);

    // La detección diaria corre en el worker cuando se le pide (el cron del stack es el diario).
    await triggerAnomalyPass();
    await expect
      .poll(async () => ((await api(page, 'GET', `${W}/spending-anomalies`))['items'] as unknown[]).length, {
        timeout: 180_000,
        intervals: [2_000, 3_000, 5_000],
      })
      .toBe(1);

    // Lista: fecha, monto, categoría y motivo por plantilla; sin palabras de error ni de fraude.
    await go(page, '/gastos-atipicos');
    const row = page.getByTestId('anomaly-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('304,00 BOB');
    await expect(row).toContainText('Restaurantes');
    await expect(page.getByTestId('anomaly-reasons')).toContainText(
      '3,8 veces la mediana de "Restaurantes" (80,00 BOB en los últimos 12 meses, 12 gastos)',
    );
    const text = (await page.getByTestId('spending-anomalies-view').innerText()).toLowerCase();
    expect(text).not.toMatch(/\b(error|fraude)\b/);
    const violations = await seriousViolations(page);
    expect(violations, JSON.stringify(violations)).toEqual([]);

    // Marca en el listado y el detalle de la transacción, con el enlace a la lista.
    await go(page, '/transacciones');
    const txRow = page.locator(`[data-testid="transaction-row"][data-transaction-id="${atypical}"]`);
    await expect(txRow.getByTestId('tx-anomaly-mark')).toBeVisible();
    await expect(txRow.getByTestId('tx-anomaly-mark')).toHaveText('Atípico');
    await go(page, `/transacciones/${atypical}`);
    const detail = page.getByTestId('tx-anomaly-detail');
    await expect(detail).toContainText('3,8 veces la mediana de "Restaurantes"');
    await expect(detail.getByTestId('tx-anomaly-link')).toHaveAttribute('href', /\/gastos-atipicos$/);
    const detailViolations = await seriousViolations(page);
    expect(detailViolations, JSON.stringify(detailViolations)).toEqual([]);

    // Descartar con un motivo: sale de los abiertos, figura entre los descartados y la marca desaparece.
    await go(page, '/gastos-atipicos');
    await page.getByTestId('anomaly-dismiss-reason').selectOption('EXPECTED_ONE_OFF');
    await page.getByTestId('anomaly-dismiss').click();
    await expect(page.getByTestId('anomalies-status')).toContainText('no atípico');
    await expect(page.getByTestId('anomalies-empty')).toBeVisible();
    await page.getByLabel('Estado').selectOption('DISMISSED');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Descartado el');
    await expect(row).toContainText('Gasto puntual esperado');
    await expect(page).toHaveURL(/estado=DISMISSED/);
    await go(page, `/transacciones/${atypical}`);
    await expect(page.getByTestId('tx-anomaly-detail')).toHaveCount(0);

    // Restaurar: vuelve a los abiertos con su marca.
    await go(page, '/gastos-atipicos?estado=DISMISSED');
    await page.getByTestId('anomaly-restore').click();
    await expect(page.getByTestId('anomalies-status')).toContainText('restaurado');
    await page.getByLabel('Estado').selectOption('OPEN');
    await expect(row).toHaveCount(1);
    await go(page, `/transacciones/${atypical}`);
    await expect(page.getByTestId('tx-anomaly-detail')).toBeVisible();

    // La API deja un solo descarte y una sola restauración auditados.
    const audit = await api(page, 'GET', `${W}/audit-log?limit=50`);
    const actions = (audit['data'] as { action: string }[]).map((e) => e.action);
    expect(actions.filter((a) => a === 'forecasting.spending_anomaly.dismissed')).toHaveLength(1);
    expect(actions.filter((a) => a === 'forecasting.spending_anomaly.restored')).toHaveLength(1);

    // Preferencias: el aviso por notificación llega apagado en los dos canales.
    await go(page, '/preferencias');
    await expect(page.getByTestId('pref-SPENDING_ANOMALY-inApp')).not.toBeChecked();
    await expect(page.getByTestId('pref-SPENDING_ANOMALY-email')).not.toBeChecked();
    await expect(page.getByTestId('pref-BUDGET_THRESHOLD-inApp')).toBeChecked();

    // Móvil: la lista es una tarjeta por gasto, sin scroll horizontal.
    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, '/gastos-atipicos');
    await expect(row).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    await page.context().close();
  });
});
