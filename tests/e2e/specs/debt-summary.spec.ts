import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  api,
  bob,
  expectNoHorizontalScroll,
  go,
  newFinanceUser,
  openAccount,
  todayLaPaz,
} from '../src/finance.js';

/**
 * Resumen de deudas (openspec add-debt-summary 7.1; TC-DEBT-SUMMARY-001, -003, -009 y -010):
 *
 * - Un usuario sin cuentas de pasivo ve en el Home la tarjeta "Deudas" con "No hay deudas registradas." y las acciones
 *   para registrar un préstamo o una tarjeta, sin montos en cero.
 * - Con un pasivo manual ("Deuda familiar", 2 000,00 BOB) y una cuenta de tarjeta ("Visa Oro", 1 120,50 BOB) el Home
 *   muestra el total adeudado consolidado (3 120,50 BOB), el resumen de `/debts` lista cada deuda, y pagar la tarjeta con
 *   una transferencia desde "Banco BOB" baja el total a 2 000,00 BOB y la tarjeta deja de listarse. Con todo pagado la
 *   tarjeta dice "No hay deudas pendientes." sin fecha ni vencimiento.
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

test.describe('Resumen de deudas (debt/loans)', () => {
  test('[TC-DEBT-SUMMARY-010] sin cuentas de pasivo la tarjeta "Deudas" del Home dice que no hay deudas registradas y ofrece registrar un préstamo o una tarjeta, sin ceros', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'deudas-vacio');
    await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');

    await go(page, '/');
    const card = page.getByTestId('debt-card');
    await expect(card).toHaveAttribute('data-state', 'NO_LIABILITIES');
    await expect(card).toContainText('No hay deudas registradas.');
    await expect(card.getByTestId('debt-card-register-loan')).toHaveAttribute('href', '/debts/nuevo');
    await expect(card.getByTestId('debt-card-register-card')).toHaveAttribute(
      'href',
      '/debts/tarjetas/nueva',
    );
    await expect(card).not.toContainText('0,00');

    const summary = await api(page, 'GET', `${W}/debts/summary`);
    expect(summary['status']).toBe('NO_LIABILITIES');
    await context.close();
  });

  test('[TC-DEBT-SUMMARY-001] [TC-DEBT-SUMMARY-003] [TC-DEBT-SUMMARY-009] [TC-DEBT-SUMMARY-010] total adeudado en el Home y en /debts; pagar la tarjeta lo actualiza y, saldado todo, la tarjeta dice que no hay deudas pendientes', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'deudas');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const family = await openAccount(page, W, 'Deuda familiar', 'MANUAL_LIABILITY', 'BOB', '2000.00');
    const visa = await openAccount(page, W, 'Visa Oro', 'CREDIT_CARD', 'BOB', '1120.50');

    // API: total 3120.50 BOB, ambas deudas son "otros pasivos" (sin perfil en Debt) y no estimables.
    const first = await api(page, 'GET', `${W}/debts/summary`);
    const totals = first['totals'] as {
      byCurrency: { amount: string }[];
      consolidated: { amount: { amount: string }; complete: boolean };
    };
    expect(totals.byCurrency.map((m) => m.amount)).toEqual(['3120.50']);
    expect(totals.consolidated.amount.amount).toBe('3120.50');
    expect(totals.consolidated.complete).toBe(true);
    expect((first['debtFree'] as { date: string | null }).date).toBeNull();

    // Home: tarjeta "Deudas" con el total y las deudas que no se pueden estimar.
    await go(page, '/');
    const card = page.getByTestId('debt-card');
    await expect(card).toHaveAttribute('data-state', 'ACTIVE');
    await expect(card.getByTestId('debt-card-owed')).toHaveText(/3\.120,50\s*BOB adeudados/);
    await expect(card.getByTestId('debt-card-debt-free')).toHaveAttribute('data-estimable', 'false');
    expect(await seriousViolations(page)).toEqual([]);

    // /debts: pestaña Resumen con una fila por deuda y moneda.
    await card.getByTestId('debt-card-link').click();
    await expect(page.getByTestId('debt-summary')).toBeVisible();
    await expect(page.getByTestId('debt-row')).toHaveCount(2);
    await expect(page.getByTestId('debt-consolidated')).toContainText('3.120,50 BOB');
    expect(await seriousViolations(page)).toEqual([]);
    await expectNoHorizontalScroll(page);

    // Pagar la tarjeta con una transferencia desde Banco BOB: el total baja a 2000.00 y Visa Oro deja de listarse.
    await api(page, 'POST', `${W}/transfers`, {
      transactionDate: todayLaPaz(),
      fromAccountId: bank,
      toAccountId: visa,
      amount: bob('1120.50'),
    });
    await go(page, '/debts?vista=resumen');
    await expect(page.getByTestId('debt-consolidated')).toContainText('2.000,00 BOB');
    await expect(page.getByTestId('debt-row')).toHaveCount(1);
    await expect(page.getByTestId('debt-row')).toHaveAttribute('data-name', 'Deuda familiar');

    // Saldar la deuda familiar: "No hay deudas pendientes." sin fecha estimada ni próximo vencimiento.
    await api(page, 'POST', `${W}/transfers`, {
      transactionDate: todayLaPaz(),
      fromAccountId: bank,
      toAccountId: family,
      amount: bob('2000.00'),
    });
    await go(page, '/');
    const settled = page.getByTestId('debt-card');
    await expect(settled).toHaveAttribute('data-state', 'NO_DEBT');
    await expect(settled).toContainText('No hay deudas pendientes.');
    await expect(settled).not.toContainText('libre de deudas');
    await expect(settled.getByTestId('debt-card-next-due')).toHaveCount(0);
    await context.close();
  });
});
