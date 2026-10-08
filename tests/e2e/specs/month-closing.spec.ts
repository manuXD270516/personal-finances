import { randomUUID } from 'node:crypto';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { bff } from '../src/helpers.js';
import { api, bob, expectNoHorizontalScroll, go, newFinanceUser, todayLaPaz } from '../src/finance.js';

/**
 * Cierre de mes (openspec add-month-closing 7.3): pantalla "Cierre de mes", "Reporte de cierre" y política de cierre.
 *
 * - Prueba 1 (siempre corre): el periodo actual aún no terminó, así que la pantalla muestra el checklist, avisa que
 *   no se puede cerrar y deshabilita "Cerrar mes"; el reporte de un periodo nunca cerrado lo dice; el OWNER cambia la
 *   política de cierre y queda guardada; accesibilidad (axe) y viewport móvil.
 * - Prueba 2 (flujo de octubre): requiere un periodo YA TERMINADO en la zona del workspace (`periodEnd` < hoy). Con el
 *   reloj real de la pila un workspace nuevo solo tiene el periodo actual, así que la prueba se omite con su motivo
 *   cuando no hay uno; con un reloj controlado por el harness (o un workspace con periodos pasados) concilia la cuenta,
 *   cierra reconociendo las advertencias, comprueba que un gasto del periodo se rechaza, reabre como OWNER, agrega la
 *   comisión, vuelve a cerrar (versión 2), compara versiones y exporta el CSV.
 */
interface Period {
  readonly id: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: string;
}

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
}

/** Los periodos los crea el worker de forma asíncrona (docs/33 D64): espera a que existan. */
async function periodsOf(page: Page, W: string): Promise<Period[]> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const r = await api(page, 'GET', `${W}/periods?limit=100`);
    const data = r['data'] as Period[];
    if (data.length > 0) return data;
    if (Date.now() > deadline) throw new Error('los periodos no llegaron a tiempo');
    await page.waitForTimeout(1500);
  }
}

test.describe('Cierre de mes', () => {
  test('[TC-PLANNING-CLOSE-005] [TC-PLANNING-CHECKLIST-002] el periodo actual no se puede cerrar todavía; el reporte de un periodo sin cierre lo dice; el OWNER guarda la política', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'cierre-actual');
    const periods = await periodsOf(page, W);
    const today = todayLaPaz();
    const current = periods.find((p) => p.periodStart <= today && today <= p.periodEnd)!;

    // Cierre de mes del periodo actual: checklist visible, aviso "aún no termina" y botón deshabilitado.
    await go(page, `/planificacion/periodos/${current.id}/cierre`);
    await expect(page.getByRole('heading', { level: 1, name: 'Cierre de mes' })).toBeVisible();
    await expect(page.getByTestId('planning-nav')).toBeVisible();
    await expect(page.getByTestId('close-checklist')).toBeVisible();
    await expect(page.getByTestId('close-not-ended')).toBeVisible();
    await expect(page.getByTestId('close-month')).toBeDisabled();
    await expect(page.getByTestId('close-block-reason')).toHaveAttribute('data-block', 'NOT_ENDED');
    // El ítem de recurrentes no está disponible hasta la Fase 3 y el informativo no bloquea.
    await expect(
      page.locator('[data-testid="checklist-item"][data-kind="UNRESOLVED_RECURRING"]'),
    ).toHaveAttribute('data-tone', 'NOT_AVAILABLE');
    // El recorrido del periodo y su exportación están en la pantalla.
    await expect(page.getByTestId('period-lifecycle-export-csv')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // Reporte de un periodo nunca cerrado: sin montos inventados.
    await go(page, `/planificacion/periodos/${current.id}/reporte`);
    await expect(page.getByRole('heading', { level: 1, name: 'Reporte de cierre' })).toBeVisible();
    await expect(page.getByTestId('report-never-closed')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // Entrada "Cierre de mes" en la navegación de planificación (sin periodo en la ruta).
    await go(page, '/planificacion/periodos');
    await page.getByTestId('planning-nav').getByRole('link', { name: 'Cierre de mes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cierre de mes' })).toBeVisible();
    await expect(page.getByTestId('period-selector')).toBeVisible();

    // Política de cierre en la configuración (OWNER): bajar las pendientes a advertencia y persistirlo.
    await go(page, '/configuracion');
    const policy = page.getByTestId('closing-policy');
    await expect(policy).toBeVisible();
    await expect(page.getByTestId('policy-PENDING_TRANSACTIONS-BLOCKING')).toBeChecked();
    await expect(page.getByTestId('policy-save')).toBeDisabled();
    await page.getByTestId('policy-PENDING_TRANSACTIONS-WARNING').check();
    await page.getByTestId('policy-save').click();
    await expect(page.getByTestId('policy-notice')).toHaveText('Política de cierre guardada.');
    await go(page, '/configuracion');
    await expect(page.getByTestId('policy-PENDING_TRANSACTIONS-WARNING')).toBeChecked();
    const saved = await api(page, 'GET', `${W}/planning/closing-policy`);
    expect(saved['version']).toBe(2);
    expect(saved['severities']).toMatchObject({ PENDING_TRANSACTIONS: 'WARNING' });
    expect(await seriousViolations(page)).toEqual([]);

    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of [
      `/planificacion/periodos/${current.id}/cierre`,
      `/planificacion/periodos/${current.id}/reporte`,
      '/configuracion',
    ]) {
      await go(page, path);
      await expect(page.locator('main, [role="main"]').first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
    await context.close();
  });

  test('[TC-PLANNING-EXIT-001] [TC-PLANNING-RECLOSE-001] [TC-PLANNING-RECLOSE-002] [TC-PLANNING-REPORT-003] flujo de octubre: conciliar, cerrar con advertencia reconocida, rechazar un gasto, reabrir, agregar la comisión, re-cerrar, comparar versiones y exportar CSV', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'cierre-octubre');
    const periods = await periodsOf(page, W);
    const today = todayLaPaz();
    const target = [...periods]
      .filter((p) => (p.status === 'ACTIVE' || p.status === 'REOPENED') && p.periodEnd < today)
      .sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1))[0];
    test.skip(
      target === undefined,
      'requiere un periodo terminado: el reloj real de la pila solo da el periodo actual (usar un reloj controlado)',
    );
    const period = target!;
    const base = `/planificacion/periodos/${period.id}`;

    // Cuenta con saldo inicial 1000,00 al inicio del periodo y un gasto sin categoría de 100,00 (advertencia).
    const account = String(
      (
        await api(page, 'POST', `${W}/accounts`, {
          name: 'Banco cierre',
          type: 'BANK',
          currency: 'BOB',
          openingBalance: { amount: bob('1000.00'), date: period.periodStart },
        })
      )['id'],
    );
    const expense = (amount: string, description: string) =>
      api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        status: 'CLEARED',
        transactionDate: period.periodEnd,
        accountId: account,
        amount: bob(amount),
        description,
      });
    await expense('100.00', 'Compra sin categoría');

    // 1. Conciliar la cuenta contra el extracto (900,00): diferencia 0.
    const reconcile = async (balance: string) => {
      await go(page, `/cuentas/${account}`);
      await page.getByTestId('reconcile-account').click();
      await page.getByLabel('Saldo del extracto (BOB)').fill(balance);
      await page.getByRole('button', { name: 'Iniciar conciliación' }).click();
      await expect(page.getByTestId('reconciliation-summary')).toBeVisible();
      await page.getByTestId('finish-reconciliation').click();
      await expect(page.getByTestId('reconciliation-status').first()).toHaveText('Completada');
    };
    await reconcile('900,00');

    // 2. Cierre con la advertencia (sin categoría) reconocida de forma explícita.
    await go(page, `${base}/cierre`);
    await expect(page.getByTestId('close-summary')).toHaveAttribute('data-requires-ack', 'true');
    await expect(page.getByTestId('close-month')).toBeDisabled();
    await page.getByTestId('close-note').fill('Cierre de octubre');
    await page.getByTestId('acknowledge-warnings').check();
    await expect(page.getByTestId('close-month')).toBeEnabled();
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('close-month').click();
    await expect(page.getByTestId('close-result')).toContainText('Versión 1 del cierre guardada.');
    await expect(page.getByTestId('close-closed')).toBeVisible();
    await expect(page.getByTestId('reopen')).toBeVisible();

    // 3. Un gasto con fecha del periodo se rechaza (PERIOD_CLOSED).
    const rejected = await bff(page, 'POST', `/api/bff/v1${W}/transactions`, {
      body: {
        kind: 'EXPENSE',
        transactionDate: period.periodEnd,
        accountId: account,
        amount: bob('5.00'),
        description: 'Comisión bancaria',
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ code: 'PERIOD_CLOSED' });

    // 4. Reabrir como OWNER: el motivo es obligatorio.
    await page.getByTestId('reopen').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reabrir', exact: true }).click();
    await expect(page.getByTestId('field-error')).toHaveText('Indica el motivo de la reapertura.');
    await page.getByTestId('reopen-reason').fill('Falta la comisión bancaria');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reabrir', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'reabierto' })).toBeVisible();
    await expect(page.getByTestId('close-month')).toBeVisible();

    // 5. Agregar la comisión (5,00), conciliar de nuevo (895,00) y re-cerrar: versión 2.
    await expense('5.00', 'Comisión bancaria');
    await reconcile('895,00');
    await go(page, `${base}/cierre`);
    const ack = page.getByTestId('acknowledge-warnings');
    if (await ack.isVisible()) await ack.check();
    await expect(page.getByTestId('close-month')).toBeEnabled();
    await page.getByTestId('close-month').click();
    await expect(page.getByTestId('close-result')).toContainText('Versión 2 del cierre guardada.');

    // 6. Reporte: versión vigente (2) y anterior (1), comparación exacta y exportación CSV.
    await go(page, `${base}/reporte`);
    await expect(page.getByTestId('report-version')).toHaveValue('2');
    await expect(page.getByTestId('report-version').locator('option')).toHaveCount(2);
    await expect(page.getByTestId('kpi-expense-value')).toContainText('105,00 BOB');
    await expect(page.getByTestId('close-diff')).toHaveAttribute('data-from', '1');
    await expect(page.getByTestId('close-diff')).toHaveAttribute('data-to', '2');
    await expect(page.getByTestId('diff-expense')).toContainText('+5,00 BOB');
    await expect(page.getByTestId('diff-net-worth')).toContainText('-5,00 BOB');
    expect(await seriousViolations(page)).toEqual([]);
    const href = await page.getByTestId('close-report-export-csv').getAttribute('href');
    expect(href).toContain('format=csv&closeNo=2');
    const csv = await page.request.get(href!);
    expect(csv.ok()).toBe(true);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain('Banco cierre');
    await page.getByTestId('report-version').selectOption('1');
    await expect(page.getByTestId('kpi-expense-value')).toContainText('100,00 BOB');

    // 7. El recorrido del periodo muestra cerrar, reabrir y volver a cerrar.
    await go(page, `${base}/cierre`);
    await expect(page.getByTestId('lifecycle-entry').filter({ hasText: 'Reabrir' })).toHaveCount(1);
    await expect(page.getByTestId('period-lifecycle-close-no')).toHaveCount(2);
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
