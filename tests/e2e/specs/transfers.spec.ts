import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { bff } from '../src/helpers.js';
import {
  accountRow,
  api,
  bob,
  expectNoHorizontalScroll,
  go,
  newFinanceUser,
  openAccount,
  todayLaPaz,
  userCategories,
} from '../src/finance.js';

/**
 * Transferencias por la UI (openspec add-transfers, tareas 6.1 y 7.2): ejemplo canónico A 1000.00 → B 300.00, pago
 * de tarjeta con QR (transferencia activo → pasivo, nunca gasto) y orientación a conversión entre monedas.
 */
test.describe('Transferencias entre cuentas propias y pago de tarjeta (transactions/transfers)', () => {
  test('[TC-TRANSACTIONS-TRANSFER-008] [TC-TRANSACTIONS-TRANSFER-007] [TC-TRANSACTIONS-CARDPAYMENT-001] [TC-ACCOUNTS-CREDITCARD-001] transferencia por QR de A a B y pago de la tarjeta con QR conservan el patrimonio; el gasto con tarjeta se cuenta una sola vez', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'transfer');
    const a = await openAccount(page, W, 'Bank A', 'BANK', 'BOB', '1000.00');
    const b = await openAccount(page, W, 'Bank B', 'BANK', 'BOB');
    const card = await openAccount(page, W, 'Visa', 'CREDIT_CARD', 'BOB');
    const [household] = await userCategories(page, W, 'EXPENSE');

    // A 1000.00 → B 300.00 por QR.
    await go(page, '/transferencias/nueva');
    const form = page.getByTestId('transfer-form');
    await form.getByLabel('Desde').selectOption(a);
    await form.getByLabel('Hacia').selectOption(b);
    await form.getByLabel('Monto (BOB)').fill('300');
    await form.getByLabel('Medio de pago').selectOption('QR');
    await form.getByRole('button', { name: 'Registrar transferencia' }).click();
    await expect(page.getByTestId('transaction-detail')).toHaveAttribute('data-kind', 'TRANSFER');
    await expect(page.getByTestId('detail-payment-method')).toHaveText('QR');
    await expect(page.getByTestId('tx-leg')).toHaveText([
      /Bank A: -300,00 BOB \(origen\)/,
      /Bank B: 300,00 BOB \(destino\)/,
    ]);
    await go(page, '/cuentas');
    await expect(accountRow(page, 'Bank A').getByTestId('account-balance')).toHaveText('700,00 BOB');
    await expect(accountRow(page, 'Bank B').getByTestId('account-balance')).toHaveText('300,00 BOB');
    await go(page, '/');
    await expect(page.getByTestId('net-worth-amount')).toHaveText(/1\.000,00\s*BOB/);

    // Compra de 350.00 con la tarjeta: la deuda sube y el patrimonio baja a 650.00.
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: card,
      amount: bob('350.00'),
      description: 'Compra hogar',
      splits: [{ amount: bob('350.00'), categoryId: household!.id }],
    });
    await go(page, '/');
    await expect(page.getByTestId('net-worth-amount')).toHaveText(/650,00\s*BOB/);

    // Atajo "Pagar tarjeta": solo tarjetas como destino, deuda visible, pago con QR por el total.
    await go(page, '/transacciones');
    await page.getByRole('link', { name: 'Pagar tarjeta' }).click();
    const pay = page.getByTestId('transfer-form');
    await expect(pay.getByRole('heading', { name: 'Pagar tarjeta de crédito' })).toBeVisible();
    await expect(pay.getByLabel('Tarjeta').locator('option')).toHaveText(['Elige una cuenta', 'Visa (BOB)']);
    await pay.getByLabel('Desde').selectOption(a);
    await pay.getByLabel('Tarjeta').selectOption(card);
    await expect(pay.getByTestId('card-owed')).toContainText('La tarjeta adeuda 350,00 BOB.');
    await pay.getByRole('button', { name: 'Pagar el total' }).click();
    await expect(pay.getByLabel('Monto (BOB)')).toHaveValue('350.00');
    await pay.getByLabel('Medio de pago').selectOption('QR');
    await pay.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(page.getByTestId('transaction-detail')).toHaveAttribute('data-kind', 'TRANSFER');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pago de tarjeta Visa');
    await expect(page.getByTestId('detail-payment-method')).toHaveText('QR');

    // A 700 − 350 = 350; la tarjeta queda en 0; patrimonio sigue en 650; el gasto del mes es 350 (una vez).
    await go(page, '/cuentas');
    await expect(accountRow(page, 'Bank A').getByTestId('account-balance')).toHaveText('350,00 BOB');
    await expect(accountRow(page, 'Visa').getByTestId('account-balance')).toHaveText('Adeuda 0,00 BOB');
    await go(page, '/');
    await expect(page.getByTestId('net-worth-amount')).toHaveText(/650,00\s*BOB/);
    await expect(page.getByTestId('expense-amount')).toHaveText(/350,00\s*BOB/);
    await expect(
      page
        .getByTestId('top-category')
        .filter({ hasText: household!.name })
        .getByTestId('top-category-amount'),
    ).toHaveText('350,00 BOB');
    await context.close();
  });

  test('[TC-TRANSACTIONS-TRANSFER-001] entre monedas distintas la UI no registra una transferencia y abre la conversión prellenada; la API la rechaza', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'mismatch');
    const bobAccount = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const usdAccount = await openAccount(page, W, 'Cuenta USD', 'BANK', 'USD');

    await page.setViewportSize({ width: 360, height: 780 });
    await go(page, '/transferencias/nueva');
    const form = page.getByTestId('transfer-form');
    await form.getByLabel('Desde').selectOption(bobAccount);
    await form.getByLabel('Hacia').selectOption(usdAccount);
    await form.getByLabel('Monto (BOB)').fill('100');
    await expect(form.getByTestId('transfer-mismatch')).toContainText('monedas distintas (BOB → USD)');
    await expect(form.getByRole('button', { name: 'Registrar transferencia' })).toBeDisabled();
    await expectNoHorizontalScroll(page);
    await form.getByTestId('open-conversion').click();
    await expect(page).toHaveURL(
      new RegExp(`/fx/conversiones/nueva\\?origen=${bobAccount}&destino=${usdAccount}&monto=100`),
    );
    const conversion = page.getByTestId('conversion-form');
    await expect(conversion.getByLabel('Desde la cuenta')).toHaveValue(bobAccount);
    await expect(conversion.getByLabel('Hacia la cuenta')).toHaveValue(usdAccount);
    await expect(conversion.getByLabel('Monto entregado BOB')).toHaveValue('100');

    const rejected = await bff(page, 'POST', `/api/bff/v1${W}/transfers`, {
      body: {
        transactionDate: todayLaPaz(),
        fromAccountId: bobAccount,
        toAccountId: usdAccount,
        amount: bob('100.00'),
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(rejected.status).toBe(422);
    expect(rejected.body).toMatchObject({
      code: 'TRANSFER_CURRENCY_MISMATCH',
      suggestedOperationId: 'createConversion',
    });
    await context.close();
  });
});
