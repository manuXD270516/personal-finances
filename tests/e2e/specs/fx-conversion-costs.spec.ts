import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  api,
  expectNoHorizontalScroll,
  go,
  newFinanceUser,
  openAccount,
  todayLaPaz,
} from '../src/finance.js';

/**
 * Costo de conversiones por la UI (openspec add-conversion-cost-analysis, tarea 8.1, TC-FX-COST-009): dos ventas por
 * "Binance P2P" y una compra sin contraparte con la referencia USDT/BOB 12.00, el análisis con las cifras de los
 * scenarios (0,5833 % y 30,00 BOB; Sin canal 1,6667 %), la exportación CSV y la vista accesible sin scroll horizontal
 * en móvil.
 */
test.describe('Costo de conversiones (fx/conversion-pricing)', () => {
  test('[TC-FX-COST-009] dos ventas por Binance P2P y una compra sin contraparte: tabla por canal, exportación CSV, axe y móvil', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'fxcost');
    const wallet = await openAccount(page, W, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '2000.000000');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '5000.00');
    const asOf = new Date(Date.now() - 3_600_000).toISOString();
    await api(page, 'POST', `${W}/fx-rates`, {
      base: 'USDT',
      quote: 'BOB',
      value: '12.00',
      rateType: 'P2P',
      asOf,
      sourceLabel: 'Referencia manual',
    });
    await api(
      page,
      'PUT',
      `${W}/fx-rate-preferences`,
      { data: [{ base: 'USDT', quote: 'BOB', rateType: 'P2P' }] },
      { 'if-match': '"1"' },
    );
    const today = todayLaPaz();
    const executedAt = new Date(Date.now() - 600_000).toISOString();
    const sale = (qty: string, quoted: string, net: string, fee?: string) =>
      api(page, 'POST', `${W}/conversions`, {
        transactionDate: today,
        sourceAccountId: wallet,
        targetAccountId: bank,
        sourceAmount: { amount: qty, currency: 'USDT' },
        targetAmount: { amount: net, currency: 'BOB' },
        quotedRate: { base: 'USDT', quote: 'BOB', value: quoted },
        ...(fee ? { fees: [{ type: 'PROVIDER', amount: { amount: fee, currency: 'BOB' } }] } : {}),
        provider: { name: 'Binance P2P' },
        executedAt,
      });
    await sale('100.000000', '11.90', '1190.00');
    await sale('300.000000', '11.94', '3580.00', '2.00');
    await api(page, 'POST', `${W}/conversions`, {
      transactionDate: today,
      sourceAccountId: bank,
      targetAccountId: wallet,
      sourceAmount: { amount: '610.00', currency: 'BOB' },
      targetAmount: { amount: '50.000000', currency: 'USDT' },
      quotedRate: { base: 'USDT', quote: 'BOB', value: '12.20' },
      executedAt,
    });

    await go(page, '/fx');
    await page.getByRole('link', { name: 'Ver costo de conversiones' }).click();
    const view = page.getByTestId('conversion-costs');
    await expect(view).toBeVisible();
    await expect(view.getByRole('heading', { level: 1, name: 'Costo de conversiones' })).toBeVisible();
    const binance = view.locator('[data-testid="cost-row"][data-channel="Binance P2P"]');
    await expect(binance).toHaveCount(1);
    await expect(binance.getByTestId('cost-converted')).toHaveText('4.800,00 BOB');
    await expect(binance.getByTestId('cost-spread-pct')).toHaveText('0,5833 %');
    await expect(binance.getByTestId('cost-total')).toContainText('30,00 BOB');
    await expect(binance).toContainText('Wallet USDT → Banco BOB');
    const none = view.locator('[data-testid="cost-row"][data-channel="Sin canal"]');
    await expect(none.getByTestId('cost-converted')).toHaveText('600,00 BOB');
    await expect(none.getByTestId('cost-spread-pct')).toHaveText('1,6667 %');
    await expect(none).toContainText('Banco BOB → Wallet USDT');

    // Exportación CSV: se descarga con su nombre y una fila por grupo.
    const download = page.waitForEvent('download');
    await view.getByTestId('costs-export').click();
    expect((await download).suggestedFilename()).toMatch(
      /^conversion-costs-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/u,
    );

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 });
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
