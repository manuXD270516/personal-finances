import { expect, test, type Page } from '@playwright/test';
import { bff } from '../src/helpers.js';
import {
  accountRow,
  api,
  expectNoHorizontalScroll,
  go,
  newFinanceUser,
  openAccount,
  todayLaPaz,
} from '../src/finance.js';

/**
 * Pantallas de cuentas (openspec add-accounts-management, tareas 7.1, 7.2 y 8.2) contra el stack `pfos-e2e`, sin
 * red (`FX_PROVIDER_* = none`): las tasas son manuales y se registran desde la pantalla `/fx`.
 */

async function createAccountInUi(
  page: Page,
  input: { name: string; type: string; opening?: string; identifier?: string; excludeFromNetWorth?: boolean },
): Promise<string> {
  await go(page, '/cuentas/nueva');
  const form = page.getByTestId('account-form');
  await form.getByLabel('Nombre', { exact: true }).fill(input.name);
  await form.getByLabel('Tipo de cuenta').selectOption(input.type);
  if (input.identifier) {
    await form.getByLabel('Número de cuenta o tarjeta (opcional)').fill(input.identifier);
    await form.getByLabel('Número de cuenta o tarjeta (opcional)').press('Tab');
  }
  if (input.excludeFromNetWorth) await form.getByLabel('Incluir en el patrimonio neto').uncheck();
  if (input.opening) await form.getByLabel('Saldo inicial en BOB').fill(input.opening);
  await form.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('status')).toHaveText('Cuenta creada.');
  return page.url().split('/cuentas/')[1]!.split('?')[0]!;
}

test.describe('Cuentas: listado, alta, edición, archivo y reactivación (accounts/account-management)', () => {
  test('[TC-ACCOUNTS-MASK-001] [TC-ACCOUNTS-ARCHIVE-001] [TC-ACCOUNTS-NETWORTH-001] Banco BOB con 10000.00 y Visa adeudando 2000.00 dan patrimonio 8000.00; el identificador nunca sale completo del navegador; archivar y reactivar', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'cuentas');
    const sent: string[] = [];
    page.on('request', (r) => sent.push(`${r.url()} ${r.postData() ?? ''}`));

    // Alta de "Banco BOB" con saldo inicial (entrada es-BO "10.000,00") e identificador completo.
    await createAccountInUi(page, {
      name: 'Banco BOB',
      type: 'BANK',
      opening: '10.000,00',
      identifier: 'DEMO-000123456789',
    });
    await expect(page.getByTestId('account-balance')).toHaveText('10.000,00 BOB');
    await expect(page.getByTestId('account-mask')).toHaveText('•••• 6789');
    const createBody = sent.find((s) => s.includes('/accounts ') && s.includes('"Banco BOB"'));
    expect(createBody).toContain('"accountNumberLast4":"6789"');
    // Minimización (NFR-SEC-015): el valor completo nunca se envió a ningún lado, así que no puede estar en la
    // base, la auditoría, los eventos ni los logs.
    expect(sent.join('\n')).not.toContain('000123456789');
    const tooLong = await bff(page, 'POST', `/api/bff/v1${W}/accounts`, {
      body: { name: 'Otra', type: 'BANK', currency: 'BOB', accountNumberLast4: '123456789' },
      headers: { 'idempotency-key': `k-${Date.now()}-mask-too-long` },
    });
    expect([400, 422]).toContain(tooLong.status);
    expect(tooLong.body?.['code']).toBe('VALIDATION_FAILED');

    // Visa: al elegir tarjeta de crédito la liquidez propuesta es "No líquida"; su saldo es lo que se adeuda.
    await go(page, '/cuentas/nueva');
    await page.getByLabel('Tipo de cuenta').selectOption('CREDIT_CARD');
    await expect(page.getByLabel('Liquidez')).toHaveValue('ILLIQUID');
    const visa = await createAccountInUi(page, { name: 'Visa BOB', type: 'CREDIT_CARD', opening: '2000' });
    await expect(page.getByTestId('account-balance')).toHaveText('Adeuda 2.000,00 BOB');

    // Una cuenta excluida del patrimonio conserva su saldo pero no suma.
    await createAccountInUi(page, {
      name: 'Caja reservada',
      type: 'CASH',
      opening: '500',
      excludeFromNetWorth: true,
    });
    await expect(page.getByTestId('account-balance')).toHaveText('500,00 BOB');

    await go(page, '/cuentas');
    await expect(accountRow(page, 'Banco BOB').getByTestId('account-balance')).toHaveText('10.000,00 BOB');
    await expect(accountRow(page, 'Banco BOB').getByTestId('account-mask')).toHaveText('•••• 6789');
    await expect(accountRow(page, 'Visa BOB').getByTestId('account-balance')).toHaveText(
      'Adeuda 2.000,00 BOB',
    );
    await expect(accountRow(page, 'Caja reservada')).toContainText('excluida del patrimonio neto');

    // Home: patrimonio 10000.00 − 2000.00 = 8000.00 BOB (la caja excluida no suma).
    await go(page, '/');
    await expect(page.getByTestId('net-worth-amount')).toHaveText(/8\.000,00\s*BOB/);
    await expect(page.getByTestId('net-worth-liabilities')).toHaveText('2.000,00 BOB');

    // Archivar la Visa (con confirmación): desaparece del listado por defecto y sigue consultable.
    await go(page, `/cuentas/${visa}`);
    await page.getByRole('button', { name: 'Archivar' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('¿Archivar «Visa BOB»?');
    await confirm.getByRole('button', { name: 'Sí, archivar' }).click();
    await expect(page.getByRole('status')).toHaveText('Cuenta archivada.');
    await expect(page.getByTestId('account-status')).toHaveText('Archivada');
    await go(page, '/cuentas');
    await expect(accountRow(page, 'Banco BOB')).toBeVisible();
    await expect(accountRow(page, 'Visa BOB')).toHaveCount(0);
    await page.getByLabel('Mostrar archivadas').check();
    await expect(accountRow(page, 'Visa BOB').getByTestId('account-status')).toHaveText('Archivada');
    await expect(accountRow(page, 'Visa BOB').getByTestId('account-balance')).toHaveText(
      'Adeuda 2.000,00 BOB',
    );

    // Reactivar: vuelve al listado y su historial muestra ambas transiciones.
    await go(page, `/cuentas/${visa}`);
    await page.getByRole('button', { name: 'Reactivar' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sí, reactivar' }).click();
    await expect(page.getByRole('status')).toHaveText('Cuenta reactivada.');
    await expect(page.getByTestId('account-status')).toHaveCount(0);
    const history = page.getByTestId('audit-history');
    await expect(history.locator('li[data-action="accounts.account.archived"]')).toContainText(
      'Cuenta archivada',
    );
    await expect(history.locator('li[data-action="accounts.account.reactivated"]')).toContainText(
      'Cuenta reactivada',
    );
    await go(page, '/cuentas');
    await expect(accountRow(page, 'Visa BOB')).toBeVisible();

    // Móvil (360 px): el listado se lee sin scroll horizontal.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.reload();
    await expect(accountRow(page, 'Banco BOB')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await context.close();
  });

  test('[TC-ACCOUNTS-LIST-001] el listado muestra el equivalente en BOB con fecha y fuente de la tasa manual y "sin tasa" cuando no hay', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'equiv');
    await openAccount(page, W, 'USD Savings', 'SAVINGS', 'USD', '500.00');
    await openAccount(page, W, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '10.000000');
    await openAccount(page, W, 'Credit Card', 'CREDIT_CARD', 'BOB', '350.00');

    // Sin ninguna tasa: el equivalente no se inventa.
    await go(page, '/cuentas');
    await expect(accountRow(page, 'USD Savings').getByTestId('account-no-rate')).toHaveText(
      'Sin tasa a BOB: equivalente no disponible',
    );
    await expect(accountRow(page, 'Credit Card').getByTestId('account-balance')).toHaveText(
      'Adeuda 350,00 BOB',
    );

    // Tasa manual USD/BOB 6.96 registrada desde la pantalla de tasas (prellenada por query como desde el Home).
    await go(page, '/fx?base=USD&quote=BOB');
    const form = page.getByTestId('rate-form');
    await expect(form.getByLabel('Moneda base')).toHaveValue('USD');
    await form.getByLabel('Valor (1 USD = ? BOB)').fill('6,96');
    await form.getByLabel('Tipo de tasa').selectOption('PARALLEL');
    await form.getByLabel('Fuente (p. ej. casa de cambio)').fill('Casa de cambio centro');
    await form.getByRole('button', { name: 'Registrar tasa' }).click();
    await expect(page.getByRole('status')).toHaveText('Tasa registrada: 1 USD = 6,96 BOB.');

    await go(page, '/cuentas');
    const usd = accountRow(page, 'USD Savings');
    await expect(usd.getByTestId('account-balance')).toHaveText('500,00 USD');
    const [y, m, d] = todayLaPaz().split('-');
    const date = new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${y}-${m}-${d}T00:00:00Z`),
    );
    await expect(usd.getByTestId('account-base-equivalent')).toHaveText(
      `≈ 3.480,00 BOB · tasa del ${date} · manual`,
    );
    await expect(accountRow(page, 'Wallet USDT').getByTestId('account-no-rate')).toBeVisible();

    // Una tasa posterior cambia el equivalente mostrado; nada se persiste ni se recalcula en el pasado.
    await api(page, 'POST', `${W}/fx-rates`, {
      base: 'USD',
      quote: 'BOB',
      value: '6.97',
      rateType: 'PARALLEL',
      asOf: new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });
    await page.reload();
    await expect(accountRow(page, 'USD Savings').getByTestId('account-base-equivalent')).toContainText(
      '≈ 3.485,00 BOB',
    );
    await expect(accountRow(page, 'USD Savings').getByTestId('account-balance')).toHaveText('500,00 USD');
    await context.close();
  });

  test('[TC-ACCOUNTS-LIQUIDITY-001] la liquidez se propone según el tipo y solo lo líquido es dinero disponible; cambiarla no crea asientos', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'liquidez');
    await openAccount(page, W, 'Bank A', 'BANK', 'BOB', '1000.00');
    await go(page, '/cuentas/nueva');
    const expected = {
      BANK: 'LIQUID',
      SAVINGS: 'LIQUID',
      INVESTMENT: 'SEMI_LIQUID',
      LOAN: 'ILLIQUID',
      VIRTUAL: 'ILLIQUID',
    };
    for (const [type, liquidity] of Object.entries(expected)) {
      await page.getByLabel('Tipo de cuenta').selectOption(type);
      await expect(page.getByLabel('Liquidez')).toHaveValue(liquidity);
    }
    const inversion = await createAccountInUi(page, {
      name: 'Inversión',
      type: 'INVESTMENT',
      opening: '5000',
    });
    await go(page, '/');
    await expect(page.getByTestId('liquid-balance-amount')).toHaveText(/1\.000,00\s*BOB/);

    // Marcarla como líquida desde la edición (If-Match): 6000.00 disponibles y ningún movimiento nuevo.
    await go(page, `/cuentas/${inversion}`);
    await page.getByRole('button', { name: 'Editar' }).click();
    const form = page.getByTestId('account-form');
    await expect(form.getByLabel('Tipo de cuenta')).toBeDisabled();
    await form.getByLabel('Liquidez').selectOption('LIQUID');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toHaveText('Cambios guardados.');
    await go(page, '/');
    await expect(page.getByTestId('liquid-balance-amount')).toHaveText(/6\.000,00\s*BOB/);
    const movements = await api(page, 'GET', `${W}/transactions?accountId=${inversion}`);
    expect((movements['data'] as { kind: string }[]).filter((t) => t.kind !== 'OPENING_BALANCE')).toEqual([]);
    await context.close();
  });
});
