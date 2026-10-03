import { expect, test } from '@playwright/test';
import { accountRow, api, go, newFinanceUser, openAccount } from '../src/finance.js';

/**
 * Tasas manuales y conversión por la UI (openspec add-manual-conversions, tareas 6.1–6.3 y 7.2), sin red: tasa P2P
 * 6.95, conversión canónica 100.000000 USDT → 685.00 BOB con fee de 5.00 BOB (efectiva 6.85, spread 0.72 %) y
 * corrección posterior de la tasa que no recalcula la conversión.
 */
test.describe('Cripto y FX: tasas manuales y conversiones (fx/market-rates, transactions/conversions)', () => {
  test('[TC-FX-RATE-001] [TC-TRANSACTIONS-CONVERSION-001] [TC-FX-HISTORICAL-002] [TC-TRANSACTIONS-CONVERSION-009] tasa P2P 6.95, conversión canónica con resumen antes de confirmar y corrección de la tasa sin recalcular', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'fx');
    const wallet = await openAccount(page, W, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '150.000000');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');

    // Tasa manual P2P USDT/BOB 6.95 con su fuente.
    await go(page, '/fx');
    const rateForm = page.getByTestId('rate-form');
    await rateForm.getByLabel('Moneda base').selectOption('USDT');
    await rateForm.getByLabel('Moneda cotizada').selectOption('BOB');
    await rateForm.getByLabel('Valor (1 USDT = ? BOB)').fill('6,95');
    await rateForm.getByLabel('Tipo de tasa').selectOption('P2P');
    await rateForm.getByLabel('Fuente (p. ej. casa de cambio)').fill('Mediana Binance P2P');
    await rateForm.getByRole('button', { name: 'Registrar tasa' }).click();
    await expect(page.getByRole('status')).toHaveText('Tasa registrada: 1 USDT = 6,95 BOB.');
    const pair = page.locator('[data-testid="rate-pair"][data-pair="USDT/BOB"]');
    const p2pRow = pair.getByTestId('rate-row').filter({ hasText: 'P2P' });
    await expect(p2pRow.getByTestId('rate-value')).toHaveText('1 USDT = 6,95 BOB');
    await expect(p2pRow).toContainText('manual · Mediana Binance P2P');
    const rates = await api(page, 'GET', `${W}/fx-rates?base=USDT&quote=BOB&rateType=P2P`);
    const rate = (rates['data'] as { id: string; value: string; source: string }[])[0]!;
    expect(rate).toMatchObject({ value: '6.95', source: 'MANUAL' });

    // Conversión: dos montos + cotizada, referencia explícita (la P2P) y comisión de 5.00 BOB descontada.
    await page.getByRole('link', { name: 'Nueva conversión' }).click();
    const form = page.getByTestId('conversion-form');
    await form.getByLabel('Desde la cuenta').selectOption(wallet);
    await form.getByLabel('Hacia la cuenta').selectOption(bank);
    await form.getByLabel('Monto entregado USDT').fill('100');
    await form.getByLabel('Monto recibido BOB').fill('685');
    await form.getByLabel('Tasa cotizada (1 USDT = ? BOB)').fill('6,90');
    await expect(form.locator(`option[value="${rate.id}"]`)).toBeAttached();
    await form.getByLabel('Tasa de referencia').selectOption(rate.id);
    await form.getByRole('button', { name: 'Agregar comisión' }).click();
    await form.getByLabel('Monto de la comisión 1').fill('5');
    await expect(form.getByRole('button', { name: 'Registrar conversión' })).toBeDisabled();
    await form.getByRole('button', { name: 'Calcular resumen' }).click();
    const preview = page.getByTestId('conversion-preview');
    await expect(preview.getByTestId('pricing-effective')).toHaveText('6,85 BOB/USDT');
    await expect(preview.getByTestId('pricing-reference')).toHaveText('6,95 BOB/USDT · P2P · manual');
    await expect(preview.getByTestId('pricing-spread')).toContainText('0,72 %');
    await expect(preview.getByTestId('pricing-target')).toContainText('685,00 BOB');
    await form.getByRole('button', { name: 'Registrar conversión' }).click();

    const detail = page.getByTestId('conversion-detail');
    await expect(detail).toBeVisible();
    await expect(page.getByTestId('transaction-detail')).toHaveAttribute('data-kind', 'CONVERSION');
    await expect(detail.getByTestId('pricing-effective')).toHaveText('6,85 BOB/USDT');
    await expect(detail.getByTestId('pricing-quoted')).toHaveText('6,90 BOB/USDT');
    await expect(detail.getByTestId('pricing-spread')).toContainText('0,72 %');
    await expect(detail.getByTestId('pricing-fees')).toHaveText('Comisión del proveedor 5,00 BOB');
    await expect(detail.getByTestId('pricing-source')).toHaveText('100,000000 USDT');
    const conversionUrl = page.url();

    // Saldos: 150 − 100 = 50.000000 USDT; 1000 + 685 = 1685.00 BOB.
    await go(page, '/cuentas');
    await expect(accountRow(page, 'Wallet USDT').getByTestId('account-balance')).toHaveText('50,000000 USDT');
    await expect(accountRow(page, 'Banco BOB').getByTestId('account-balance')).toHaveText('1.685,00 BOB');

    // Corregir la tasa (nueva versión con motivo; la original queda como reemplazada).
    await go(page, '/fx');
    await page
      .locator('[data-testid="rate-pair"][data-pair="USDT/BOB"]')
      .getByTestId('rate-row')
      .filter({ hasText: 'P2P' })
      .getByRole('button', { name: 'Corregir' })
      .click();
    const correct = page.getByTestId('rate-correct-form');
    await correct.getByLabel('Valor corregido').fill('6,99');
    await correct.getByLabel('Motivo de la corrección').fill('error de tipeo');
    await correct.getByRole('button', { name: 'Guardar corrección' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Tasa USDT/BOB corregida: la versión anterior se conserva como reemplazada.',
    );
    await page.getByLabel('Mostrar versiones reemplazadas').check();
    const versions = page
      .locator('[data-testid="rate-pair"][data-pair="USDT/BOB"]')
      .getByTestId('rate-row')
      .filter({ hasText: 'P2P' });
    await expect(versions).toHaveCount(2);
    await expect(versions.nth(0)).toContainText('1 USDT = 6,99 BOB');
    await expect(versions.nth(0)).toContainText('vigente');
    await expect(versions.nth(1)).toHaveAttribute('data-superseded', 'true');
    await expect(versions.nth(1)).toContainText('1 USDT = 6,95 BOB');

    // La conversión histórica no se recalcula con la tasa corregida.
    await page.goto(conversionUrl);
    const again = page.getByTestId('conversion-detail');
    await expect(again.getByTestId('pricing-reference')).toHaveText('6,95 BOB/USDT · P2P · manual');
    await expect(again.getByTestId('pricing-effective')).toHaveText('6,85 BOB/USDT');
    await expect(again.getByTestId('pricing-spread')).toContainText('0,72 %');
    await context.close();
  });
});
