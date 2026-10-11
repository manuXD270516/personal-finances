import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';

/**
 * Préstamos (openspec add-loans 7.1 y 7.2; TC-DEBT-LOAN-001, -012, -019, -035, -040 y TC-DEBT-AMORT-001, -014, -017..019):
 *
 * - Préstamo vehicular (50 000,00 BOB, 11,50 %, 24 cuotas, 30/360, desembolso 15/10/2026, primera cuota 15/11/2026): se
 *   registra por el formulario con la vista previa en vivo (cuota 2.342,02 BOB), se desembolsa, la cuota 1 aparece como
 *   compromiso, se paga la cuota 1 (2342.02 BOB) y la deuda baja a 48.137,15 BOB con 479,17 de interés como gasto.
 * - Comparación con la tabla del banco: una tabla sintética idéntica salvo UN centavo en la cuota 24 (interés y cuota);
 *   el reporte marca esa cuota, se explica la diferencia y queda EXPLAINED. Una tabla con una fecha inválida muestra los
 *   errores por fila con el foco en ellos.
 *
 * Las fechas del cronograma son fijas (las exige la tabla del banco de referencia); las fechas de pago usan "hoy" en
 * America/La_Paz, así que el reloj real del stack no rompe la prueba.
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

const daysFrom = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

interface Money {
  amount: string;
  currency: string;
}
interface Installment {
  n: number;
  dueDate: string;
  principal: string;
  interest: string;
  fees: string;
  insurance: string;
  taxes: string;
  total: string;
}

const vehicleLoan = (accounts: { bank: string }, overrides: Record<string, unknown> = {}) => ({
  name: 'Vehículo',
  principal: { amount: '50000.00', currency: 'BOB' },
  annualRate: '0.115',
  dayCount: 'D30_360',
  frequency: 'MONTHLY',
  termInstallments: 24,
  method: 'FRENCH',
  disbursementDate: '2026-10-15',
  firstDueDate: '2026-11-15',
  account: { create: { name: 'Préstamo vehicular' } },
  disbursementAccountId: accounts.bank,
  paymentAccountId: accounts.bank,
  ...overrides,
});

test.describe('Préstamos (debt/loans)', () => {
  test('[TC-DEBT-LOAN-001] [TC-DEBT-LOAN-012] [TC-DEBT-LOAN-019] [TC-DEBT-LOAN-035] [TC-DEBT-LOAN-040] registrar el préstamo vehicular, desembolsar, ver la cuota como compromiso y pagar la cuota 1', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'prestamo');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');

    // Alta: formulario con la vista previa en vivo (tasa en %, montos como texto).
    await go(page, '/debts/nuevo');
    await page.getByTestId('loan-name').fill('Vehículo');
    await page.getByTestId('loan-principal').fill('50000.00');
    await page.getByTestId('loan-rate').fill('11.50');
    await page.getByTestId('loan-term').fill('24');
    await page.getByTestId('loan-disbursement-date').fill('2026-10-15');
    await page.getByTestId('loan-first-due').fill('2026-11-15');
    await page.getByTestId('loan-new-account-name').fill('Préstamo vehicular');
    await page.getByTestId('loan-disbursement-account').selectOption(bank);
    await page.getByTestId('loan-payment-account').selectOption(bank);
    await expect(page.getByTestId('preview-installment')).toContainText('2.342,02 BOB');
    await expect(page.getByTestId('preview-row')).toHaveCount(24);
    await expect(page.getByTestId('preview-row').first()).toContainText('479,17');
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByTestId('loan-submit').click();

    // Detalle del borrador → desembolsar.
    await expect(page.getByTestId('loan-detail')).toHaveAttribute('data-status', 'DRAFT');
    const loanId = page.url().match(/\/debts\/([0-9a-f-]{36})/)![1]!;
    await page.getByTestId('loan-disburse').click();
    await page.getByTestId('disburse-submit').click();
    await expect(page.getByTestId('loan-detail')).toHaveAttribute('data-status', 'ACTIVE');
    await expect(page.getByTestId('loan-status-message')).toHaveText('Préstamo desembolsado.');
    await expect(page.getByTestId('loan-outstanding-principal')).toContainText('Deuda 50.000,00 BOB');
    await expect(page.getByTestId('installment-row')).toHaveCount(24);
    expect(await seriousViolations(page)).toEqual([]);

    // La cuota 1 es un compromiso (Q4/Q8) con su definición administrada por el préstamo.
    const loan = await api(page, 'GET', `${W}/loans/${loanId}`);
    const definitionId = String(loan['recurringDefinitionId']);
    const occurrences = (await api(page, 'GET', `${W}/recurring/${definitionId}/occurrences?limit=100`))[
      'data'
    ] as { kind: string; dueDate: string; managedBy: string }[];
    expect(occurrences[0]).toMatchObject({ kind: 'LOAN_PAYMENT', managedBy: 'DEBT', dueDate: '2026-11-15' });
    // En Próximos pagos solo si cae dentro del horizonte (90 días): depende del reloj real del stack.
    if (daysFrom(todayLaPaz(), '2026-11-15') <= 90) {
      await go(page, '/pagos-proximos');
      await page.getByTestId('upcoming-days').selectOption('90');
      await expect(page.getByTestId('upcoming-table')).toContainText('Vehículo');
    }

    // Recurrentes: la cuota no se aprueba ni se edita; ofrece "Registrar pago" hacia el préstamo.
    await go(page, '/recurring');
    const row = page.locator('[data-testid="occurrence-row"][data-name*="Vehículo"]').first();
    if ((await row.count()) > 0) {
      await expect(row.getByTestId('occurrence-register-payment')).toBeVisible();
      await expect(row.locator('[data-action="approve"]')).toHaveCount(0);
    }

    // Pagar la cuota 1 desde el detalle: el formulario viene con la cuota pendiente y la cuenta de pago.
    await go(page, `/debts/${loanId}`);
    await page.getByTestId('loan-pay').click();
    await expect(page.getByTestId('payment-amount')).toHaveValue('2342.02');
    await expect(page.getByTestId('payment-account')).toHaveValue(bank);
    await page.getByTestId('payment-date').fill(todayLaPaz());
    await page.getByTestId('payment-submit').click();
    await expect(page.getByTestId('loan-status-message')).toHaveText('Pago registrado.');
    await expect(page.getByTestId('loan-outstanding-principal')).toContainText('Deuda 48.137,15 BOB');
    await expect(page.locator('[data-testid="installment-row"][data-n="1"]')).toHaveAttribute(
      'data-state',
      'PAID',
    );
    await expect(page.getByTestId('payment-row')).toHaveCount(1);
    await expect(page.getByTestId('loan-paid-totals').locator('[data-component="interest"]')).toHaveText(
      '479,17 BOB',
    );

    // Interés como gasto: el pago es una transacción LOAN_PAYMENT con su desglose; el principal no es gasto.
    const payments = (await api(page, 'GET', `${W}/loans/${loanId}/payments`))['data'] as {
      transactionId: string;
      interest: string;
      principal: string;
    }[];
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ interest: '479.17', principal: '1862.85' });
    const tx = await api(page, 'GET', `${W}/transactions/${payments[0]!.transactionId}`);
    expect(tx['kind']).toBe('LOAN_PAYMENT');
    expect(tx['loanId']).toBe(loanId);
    const splits = tx['splits'] as { amount: Money }[];
    expect(splits.map((s) => s.amount.amount)).toContain('479.17');

    // Transacciones: distintivo "Préstamo", desglose y sin anular desde allí.
    await go(page, `/transacciones/${payments[0]!.transactionId}`);
    await expect(page.getByTestId('tx-loan-badge')).toHaveText('Préstamo');
    await expect(page.getByTestId('tx-loan-link')).toHaveAttribute('href', new RegExp(`/debts/${loanId}$`));
    await expect(page.getByTestId('tx-loan-breakdown')).toContainText('479,17 BOB');
    await expect(page.getByRole('button', { name: /^Anular/ })).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);

    // Recorrido del préstamo.
    await go(page, `/debts/${loanId}`);
    await page.getByRole('tab', { name: 'Recorrido' }).click();
    await expect(page.locator('[data-testid="lifecycle-diagram"]:visible')).toHaveCount(1);
    await context.close();
  });

  test('[TC-DEBT-AMORT-014] [TC-DEBT-AMORT-017] [TC-DEBT-AMORT-018] [TC-DEBT-AMORT-019] comparar con una tabla del banco con un centavo de diferencia en la cuota 24, ver el reporte y explicar la diferencia', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'comparar');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const created = await api(page, 'POST', `${W}/loans`, vehicleLoan({ bank }, { disburseNow: true }));
    const loanId = String(created['id']);

    // Tabla sintética = cronograma del sistema, salvo 1 centavo menos de interés (y de cuota) en la cuota 24.
    const system = (await api(page, 'GET', `${W}/loans/${loanId}/installments`))['data'] as Installment[];
    expect(system).toHaveLength(24);
    const cents = (v: string): bigint => BigInt(v.replace('.', ''));
    const fromCents = (c: bigint): string => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
    const comma = (v: string): string => v.replace('.', ',');
    const ddmmyyyy = (d: string): string => d.split('-').reverse().join('/');
    const bankRows = system.map((i) =>
      i.n === 24
        ? { ...i, interest: fromCents(cents(i.interest) - 1n), total: fromCents(cents(i.total) - 1n) }
        : i,
    );
    const table = [
      'Nro;Fecha;Capital;Interés;Cuota',
      ...bankRows.map((i) =>
        [i.n, ddmmyyyy(i.dueDate), comma(i.principal), comma(i.interest), comma(i.total)].join(';'),
      ),
    ].join('\n');

    await go(page, `/debts/${loanId}`);
    await page.getByTestId('loan-compare').click();
    await expect(page.getByTestId('compare-page')).toBeVisible();

    // Una fecha inválida: nada se guarda y los errores por fila reciben el foco.
    const broken = table.split('\n');
    broken[3] = broken[3]!.replace(/^(\d+;)[^;]+/, '$199/99/2026');
    await page.getByTestId('reference-text').fill(broken.join('\n'));
    await page.getByTestId('reference-detect').click();
    await expect(page.getByTestId('reference-mapping')).toBeVisible();
    await page.getByTestId('reference-upload').click();
    await expect(page.getByTestId('reference-errors')).toBeFocused();
    await expect(page.getByTestId('reference-error').first()).toContainText('Fila');
    expect(await seriousViolations(page)).toEqual([]);

    // La tabla correcta: separador, columnas, formato de fecha y decimal detectados.
    await page.getByTestId('reference-text').fill(table);
    await page.getByTestId('reference-detect').click();
    await expect(page.getByTestId('reference-detected')).toContainText('24 filas');
    await expect(page.getByTestId('reference-delimiter')).toHaveValue(';');
    await expect(page.getByTestId('reference-map-installmentNo')).toHaveValue('Nro');
    await expect(page.getByTestId('reference-map-interest')).toHaveValue('Interés');
    await expect(page.getByTestId('reference-date-format')).toHaveValue('DD/MM/YYYY');
    await expect(page.getByTestId('reference-decimal')).toHaveValue(',');
    await page.getByTestId('reference-upload').click();

    // Reporte: 23 de 24 coinciden, la primera diferencia es la cuota 24 y es de un centavo.
    await expect(page.getByTestId('comparison')).toBeVisible();
    await expect(page.getByTestId('comparison-status')).toContainText('Con diferencias sin explicar');
    await expect(page.getByTestId('comparison-matched')).toContainText('23 de 24 cuotas coinciden');
    await expect(page.getByTestId('comparison-first')).toContainText('cuota 24');
    const row24 = page.locator('[data-testid="comparison-row"][data-n="24"]');
    await expect(row24).toHaveAttribute('data-status', 'DIFFERENT');
    await expect(row24.locator('td[data-component="interest"]')).toHaveText('-0,01');
    await expect(row24.locator('td[data-component="total"]')).toHaveText('-0,01');
    await expect(page.locator('[data-testid="comparison-row"][data-n="23"]')).toHaveAttribute(
      'data-status',
      'MATCH',
    );
    await expect(page.getByTestId('comparison-principal')).toContainText(
      'banco 50.000,00 frente a préstamo 50.000,00',
    );
    await expect(page.getByTestId('comparison-suggestions')).toContainText('última cuota');
    expect(await seriousViolations(page)).toEqual([]);

    // Exportar el reporte en CSV (descarga del BFF).
    const href = await page.getByTestId('comparison-export').getAttribute('href');
    expect(href).toContain('/comparison/export');
    const csv = await page.evaluate(async (url) => {
      const r = await fetch(url as string, { credentials: 'same-origin' });
      return { status: r.status, type: r.headers.get('content-type') ?? '', text: await r.text() };
    }, href);
    expect(csv.status).toBe(200);
    expect(csv.type).toContain('text/csv');
    expect(csv.text.split('\n').length).toBeGreaterThan(24);

    // Explicar la diferencia: queda EXPLAINED y persiste al recargar.
    await page
      .getByTestId('comparison-explain-text')
      .fill('El banco redondea el interés de la última cuota.');
    await page.getByTestId('comparison-explain-submit').click();
    await expect(page.getByTestId('comparison-status')).toContainText('Diferencia explicada');
    await expect(page.getByTestId('comparison-explanation')).toContainText('redondea el interés');
    await go(page, `/debts/${loanId}/comparar`);
    await expect(page.getByTestId('comparison-status')).toContainText('Diferencia explicada');
    await context.close();
  });
});
