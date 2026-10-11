import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';

/**
 * Amortización avanzada (openspec add-loan-amortization-advanced 7.1 y 7.2; TC-DEBT-AMORT-031, -032, -034, -036,
 * -040..044 y TC-DEBT-LOAN-047, -051):
 *
 * - Préstamo de 12 000,00 BOB al 12 % a 12 cuotas con la primera cuota el día 1 del mes siguiente (periodo regular 30/360:
 *   las cifras no dependen del reloj real): prepago de 3 000,00 BOB con la vista previa comparada de ambas opciones,
 *   reduciendo el plazo; el cronograma vigente pasa a la versión 2, el historial conserva la versión 1 y el compromiso
 *   (ocurrencias) espera la cuota de la versión nueva.
 * - Simulador: avalanche frente a snowball con dos préstamos demo (3 000,00 al 12 % a 12 cuotas y 12 000,00 al 24 % a 24).
 */
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

/** Día 1 del mes de `today` y del siguiente: periodos regulares sin cuotas vencidas a la fecha de hoy. */
function regularDates(): { disbursementDate: string; firstDueDate: string } {
  const [year, month] = todayLaPaz().split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  return {
    disbursementDate: `${year}-${pad(month)}-01`,
    firstDueDate: `${next[0]}-${pad(next[1]!)}-01`,
  };
}

const loanBody = (
  bank: string,
  name: string,
  principal: string,
  rate: string,
  term: number,
  dates: { disbursementDate: string; firstDueDate: string },
) => ({
  name,
  principal: { amount: principal, currency: 'BOB' },
  annualRate: rate,
  dayCount: 'D30_360',
  frequency: 'MONTHLY',
  termInstallments: term,
  method: 'FRENCH',
  ...dates,
  account: { create: { name: `Cuenta ${name}` } },
  disbursementAccountId: bank,
  paymentAccountId: bank,
  disburseNow: true,
});

test.describe('Amortización avanzada (debt/amortization)', () => {
  test('[TC-DEBT-AMORT-036] [TC-DEBT-AMORT-031] [TC-DEBT-AMORT-034] [TC-DEBT-LOAN-047] [TC-DEBT-LOAN-051] prepago reduciendo el plazo con vista previa comparada, nueva versión del cronograma y ocurrencias actualizadas', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'prepago');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const created = await api(
      page,
      'POST',
      `${W}/loans`,
      loanBody(bank, 'Auto', '12000.00', '0.12', 12, regularDates()),
    );
    const loanId = String(created['id']);
    const definitionId = String(created['recurringDefinitionId']);

    await go(page, `/debts/${loanId}`);
    await expect(page.getByTestId('installment-row')).toHaveCount(12);
    await expect(page.getByTestId('loan-prepay')).toBeVisible();
    // Tasa fija: no ofrece el cambio de tasa.
    await expect(page.getByTestId('loan-rate-change')).toHaveCount(0);

    // Vista previa comparada: reducir el plazo (misma cuota, menos cuotas) frente a reducir la cuota (mismas fechas).
    await page.getByTestId('loan-prepay').click();
    await page.getByTestId('prepayment-amount').fill('3000.00');
    await page.getByTestId('prepayment-date').fill(todayLaPaz());
    await page.getByTestId('prepayment-fee').fill('30.00');
    await page.getByTestId('prepayment-preview-button').click();
    const term = page.locator('[data-testid="prepayment-option-row"][data-option="REDUCE_TERM"]');
    const installment = page.locator(
      '[data-testid="prepayment-option-row"][data-option="REDUCE_INSTALLMENT"]',
    );
    await expect(term).toContainText('1.066,19 BOB');
    await expect(installment).toContainText('799,64 BOB');
    await expect(term.getByTestId('prepayment-saved')).not.toHaveText('0,00 BOB');
    expect(await seriousViolations(page)).toEqual([]);

    // Confirmar reduciendo el plazo: el cronograma vigente es la versión 2 con 9 cuotas.
    await page.getByTestId('prepayment-option-REDUCE_TERM').check();
    await page.getByTestId('prepayment-submit').click();
    await expect(page.getByTestId('loan-status-message')).toHaveText('Pago extraordinario registrado.');
    await expect(page.getByTestId('loan-outstanding-principal')).toContainText('Deuda 9.000,00 BOB');
    await expect(page.getByTestId('installment-row')).toHaveCount(9);
    await expect(page.getByTestId('version-row')).toHaveCount(2);
    await expect(page.locator('[data-testid="version-row"][data-version="2"]')).toHaveAttribute(
      'data-current',
      'true',
    );
    await expect(page.locator('[data-testid="version-row"][data-version="2"]')).toContainText(
      'Pago extraordinario',
    );
    await expect(page.locator('[data-testid="version-row"][data-version="1"]')).toContainText('Inicial');
    expect(await seriousViolations(page)).toEqual([]);

    // La versión 1 sigue consultable con sus 12 cuotas.
    await page.locator('[data-testid="version-row"][data-version="1"]').getByRole('button').click();
    await expect(page.getByTestId('loan-version-view').getByTestId('installment-row')).toHaveCount(12);

    // Compromisos: la última ocurrencia generada espera una cuota de la versión nueva (la cuota con la misma fecha cambia
    // de monto y las cuotas que desaparecen no quedan sin resolver).
    const installments = (await api(page, 'GET', `${W}/loans/${loanId}/installments`))['data'] as {
      n: number;
      dueDate: string;
      total: string;
    }[];
    expect(installments).toHaveLength(9);
    const occurrences = (await api(page, 'GET', `${W}/recurring/${definitionId}/occurrences?limit=100`))[
      'data'
    ] as {
      occurrenceDate: string;
      status: string;
      expected: { amount: { amount: string } | string };
    }[];
    const live = occurrences.filter((o) => o.status !== 'CANCELLED');
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((o) => o.occurrenceDate <= installments.at(-1)!.dueDate)).toBe(true);

    // El gasto "Comisiones de préstamo" y el pago extraordinario figuran en los pagos.
    await expect(page.getByTestId('payment-row')).toHaveCount(1);
    await expect(page.getByTestId('payment-row')).toContainText('Pago extraordinario (Reducir el plazo)');
    await context.close();
  });

  test('[TC-DEBT-AMORT-042] [TC-DEBT-AMORT-043] [TC-DEBT-AMORT-044] el simulador compara avalanche y snowball con dos préstamos demo sin crear nada', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'simulador');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const dates = regularDates();
    await api(page, 'POST', `${W}/loans`, loanBody(bank, 'Préstamo A', '3000.00', '0.12', 12, dates));
    await api(page, 'POST', `${W}/loans`, loanBody(bank, 'Préstamo B', '12000.00', '0.24', 24, dates));
    const countsBefore = await api(page, 'GET', `${W}/loans`);

    await go(page, '/debts');
    await page.getByTestId('open-simulator').click();
    await expect(page.getByTestId('simulator-page')).toBeVisible();
    await page.getByTestId('simulator-monthly-extra').fill('500.00');
    await page.getByTestId('simulator-run').click();
    await expect(page.getByTestId('simulator-table')).toBeVisible();
    const row = (strategy: string) =>
      page.locator(`[data-testid="simulator-row"][data-strategy="${strategy}"]`);
    await expect(row('NONE').locator('[data-field="interest"]')).toHaveText('3.425,46 BOB');
    await expect(row('AVALANCHE').locator('[data-field="interest"]')).toHaveText('1.815,57 BOB');
    await expect(row('AVALANCHE').locator('[data-field="saved"]')).toHaveText('1.609,89 BOB');
    await expect(row('SNOWBALL').locator('[data-field="interest"]')).toHaveText('2.000,08 BOB');
    await expect(row('SNOWBALL').locator('[data-field="saved"]')).toHaveText('1.425,38 BOB');
    await expect(page.getByTestId('simulator-chart')).toBeVisible();
    await expect(page.getByTestId('simulator-legend').locator('li')).toHaveCount(3);
    expect(await seriousViolations(page)).toEqual([]);

    // Exportar a CSV (descarga en el navegador) y no persistir nada.
    const download = page.waitForEvent('download');
    await page.getByTestId('simulator-export').click();
    expect((await download).suggestedFilename()).toBe('simulacion.csv');
    expect(await api(page, 'GET', `${W}/loans`)).toEqual(countsBefore);
    await context.close();
  });
});
