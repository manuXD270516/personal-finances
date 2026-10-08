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
 * Reconciliación por cuenta (openspec add-reconciliation 6.1 y 7.2; docs/33 D74, D111): se reconcilia "Bank A" con
 * diferencia 0 y con un ajuste de 5.00 BOB (TC-TRANSACTIONS-RECONCILIATION-006, -008), se confirma una transacción
 * dentro de la sesión con la diferencia en vivo y se marca una transacción como conciliada sin extracto, con su marca,
 * su filtro y el indicador por cuenta. Fechas relativas a hoy en America/La_Paz (la cuenta se abre hoy).
 */
type Json = Record<string, unknown>;

async function movement(
  page: Page,
  W: string,
  accountId: string,
  kind: 'EXPENSE' | 'INCOME',
  amount: string,
  status: 'POSTED' | 'CLEARED',
  description: string,
): Promise<Json> {
  return api(page, 'POST', `${W}/transactions`, {
    kind,
    status,
    transactionDate: todayLaPaz(),
    accountId,
    amount: bob(amount),
    description,
  });
}

/** Escenario de Bank A: saldo inicial 1000.00; G1 150.00 y I1 2500.00 confirmados; G2 45.90 sin confirmar. */
async function bankA(page: Page, W: string) {
  const bank = await openAccount(page, W, 'Bank A', 'BANK', 'BOB', '1000.00');
  const g1 = await movement(page, W, bank, 'EXPENSE', '150.00', 'CLEARED', 'G1');
  const i1 = await movement(page, W, bank, 'INCOME', '2500.00', 'CLEARED', 'I1');
  const g2 = await movement(page, W, bank, 'EXPENSE', '45.90', 'POSTED', 'G2');
  return { bank, g1, i1, g2 };
}

async function startFromAccount(page: Page, bank: string, balance: string) {
  await go(page, `/cuentas/${bank}`);
  await page.getByTestId('reconcile-account').click();
  await expect(page.getByTestId('reconciliation-start')).toBeVisible();
  await page.getByLabel('Saldo del extracto (BOB)').fill(balance);
  await page.getByRole('button', { name: 'Iniciar conciliación' }).click();
  await expect(page.getByTestId('reconciliation-summary')).toBeVisible();
}

const status = async (page: Page, W: string, id: string) =>
  String((await api(page, 'GET', `${W}/transactions/${id}`))['status']);

test.describe('Reconciliación por cuenta', () => {
  test('[TC-TRANSACTIONS-RECONCILIATION-006] reconciliar Bank A con diferencia 0: G1 e I1 quedan reconciliadas contra el extracto y G2 no cambia', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'rec-cero');
    const { bank, g1, i1, g2 } = await bankA(page, W);

    await go(page, `/cuentas/${bank}`);
    await expect(page.getByTestId('reconciliation-indicator')).toContainText('Sin conciliar');
    await startFromAccount(page, bank, '3.350,00');
    await expect(page.getByTestId('rec-cleared-balance')).toContainText('3.350,00');
    await expect(page.getByTestId('rec-difference')).toContainText('0,00');
    await expect(page.getByTestId('rec-difference')).toContainText('Cuadra');
    // Solo se listan posted y cleared: G1, I1 y G2.
    await expect(page.getByTestId('reconciliation-row')).toHaveCount(3);
    await expectNoHorizontalScroll(page);

    await page.getByTestId('finish-reconciliation').click();
    await expect(page.getByText('Conciliación finalizada', { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId('reconciliation-status').first()).toHaveText('Completada');
    await expect(page.getByTestId('reconciliation-completed-items')).toContainText('2 transacciones');

    for (const id of [g1['id'], i1['id']]) {
      const tx = await api(page, 'GET', `${W}/transactions/${String(id)}`);
      expect(tx).toMatchObject({ status: 'RECONCILED', reconciliationMode: 'STATEMENT', systemFlags: [] });
    }
    expect(await status(page, W, String(g2['id']))).toBe('POSTED');
    // El saldo contable no cambia: 1000.00 − 150.00 + 2500.00 − 45.90.
    const account = await api(page, 'GET', `${W}/accounts/${bank}`);
    expect((account['balance'] as { amount: string }).amount).toBe('3304.10');
    // Recorrido de la sesión: iniciar y finalizar con los saldos del extracto.
    await page.getByRole('tab', { name: 'Recorrido' }).click();
    await expect(page.getByTestId('lifecycle-entry')).toHaveCount(2);
    await expect(page.getByTestId('rec-lifecycle-complete')).toContainText('diferencia');
    await context.close();
  });

  test('[TC-TRANSACTIONS-RECONCILIATION-005] la diferencia se recalcula en vivo al confirmar G2 dentro de la sesión', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'rec-vivo');
    const { bank, g2 } = await bankA(page, W);
    await startFromAccount(page, bank, '3.304,10');
    await expect(page.getByTestId('rec-difference')).toContainText('-45,90');
    await expect(page.getByTestId('rec-difference')).toContainText('Sobra confirmado');
    // La casilla es controlada por el servidor: se marca al volver la respuesta (no `check()`, que exige el cambio inmediato).
    await page.getByRole('checkbox', { name: 'Confirmada en el extracto: G2' }).click();
    await expect(page.getByRole('checkbox', { name: 'Confirmada en el extracto: G2' })).toBeChecked();
    await expect(page.getByTestId('rec-difference')).toContainText('0,00');
    await expect(page.getByTestId('rec-difference')).toContainText('Cuadra');
    expect(await status(page, W, String(g2['id']))).toBe('CLEARED');
    await page.getByTestId('finish-reconciliation').click();
    await expect(page.getByTestId('reconciliation-status').first()).toHaveText('Completada');
    expect(await status(page, W, String(g2['id']))).toBe('RECONCILED');
    await context.close();
  });

  test('[TC-TRANSACTIONS-RECONCILIATION-008] reconciliar con un ajuste de 5.00 BOB: motivo obligatorio y saldo contable final', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'rec-ajuste');
    const { bank, g1 } = await bankA(page, W);
    await startFromAccount(page, bank, '3.345,00');
    await expect(page.getByTestId('rec-difference')).toContainText('-5,00');
    await expect(page.getByTestId('rec-difference-hint')).toContainText('Lo confirmado supera al extracto');
    await page.getByTestId('finish-reconciliation').click();
    const panel = page.getByTestId('adjustment-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('ajuste de disminución');
    const confirm = panel.getByRole('button', { name: 'Crear el ajuste y finalizar' });
    await expect(confirm).toBeDisabled();
    await panel.getByLabel('Motivo del ajuste').fill('comisión bancaria no registrada');
    await confirm.click();
    await expect(page.getByText('Conciliación finalizada', { exact: false }).first()).toBeVisible();
    await expect(page.getByTestId('reconciliation-status').first()).toHaveText('Completada');
    expect(await status(page, W, String(g1['id']))).toBe('RECONCILED');
    // 1000.00 − 150.00 + 2500.00 − 45.90 − 5.00 = 3299.10.
    const account = await api(page, 'GET', `${W}/accounts/${bank}`);
    expect((account['balance'] as { amount: string }).amount).toBe('3299.10');
    const session = (await api(page, 'GET', `${W}/reconciliations?accountId=${bank}`))['data'] as Json[];
    const adjustment = await api(
      page,
      'GET',
      `${W}/transactions/${String(session[0]!['adjustmentTransactionId'])}`,
    );
    expect(adjustment).toMatchObject({
      kind: 'ADJUSTMENT',
      status: 'RECONCILED',
      adjustmentDirection: 'DECREASE',
      amount: bob('5.00'),
    });
    await context.close();
  });

  test('[TC-TRANSACTIONS-RECONCILIATION-016] [TC-TRANSACTIONS-RECONCILIATION-018] conciliar sin extracto: marca visible, filtro del listado e indicador de la cuenta', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'rec-cash');
    const cash = await openAccount(page, W, 'Caja BOB', 'CASH', 'BOB', '500.00');
    const spend = await movement(page, W, cash, 'EXPENSE', '80.00', 'CLEARED', 'Compra en efectivo');
    await go(page, `/transacciones/${String(spend['id'])}`);
    await page.getByTestId('reconcile-without-statement').click();
    await expect(page.getByRole('alertdialog')).toContainText('sin extracto');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sí, marcar como conciliada' }).click();
    await expect(page.getByTestId('tx-without-statement').first()).toHaveText(
      'Conciliada sin extracto — pendiente de revisión',
    );
    await expect(page.getByTestId('detail-reconciliation-mode')).toContainText('Sin extracto');
    const tx = await api(page, 'GET', `${W}/transactions/${String(spend['id'])}`);
    expect(tx).toMatchObject({
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
      systemFlags: ['RECONCILED_WITHOUT_STATEMENT'],
    });

    // Filtro del listado: solo las conciliadas sin extracto, combinable con la cuenta.
    await movement(page, W, cash, 'EXPENSE', '10.00', 'CLEARED', 'Otra compra');
    await go(page, `/transacciones?cuenta=${cash}&sinExtracto=1`);
    await expect(page.getByTestId('transaction-row')).toHaveCount(1);
    await expect(page.getByTestId('transaction-row')).toContainText('Compra en efectivo');
    await expect(page.getByTestId('tx-without-statement')).toHaveCount(1);

    // Indicador por cuenta: conciliada sin extracto al corte de hoy, con enlace al listado filtrado.
    await go(page, `/cuentas/${cash}`);
    await expect(page.getByTestId('reconciliation-indicator-without-statement')).toContainText(
      '1 transacción',
    );
    await page.getByRole('link', { name: 'Revisarlas' }).click();
    await expect(page.getByTestId('transaction-row')).toHaveCount(1);
    await context.close();
  });
});
