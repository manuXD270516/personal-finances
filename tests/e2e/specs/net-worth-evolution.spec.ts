import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, bob, expectNoHorizontalScroll, go, newFinanceUser, openAccount } from '../src/finance.js';

/**
 * Evolución del patrimonio (openspec add-net-worth-evolution, tarea 7.2): la serie de tres meses cerrados más el mes
 * en curso, calculada del ledger real (cuentas con saldo inicial y movimientos con fecha) y de tasas manuales con la
 * fecha de cada fin de mes, se muestra en la tarjeta del Home (últimos 6 periodos) y en la vista completa `/patrimonio`
 * con sus valores, la tabla alternativa accesible, las tasas usadas por periodo y sin violaciones serias de axe.
 */

const now = new Date();
const [Y, M] = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz',
  year: 'numeric',
  month: '2-digit',
})
  .format(now)
  .split('-')
  .map(Number) as [number, number];
/** Primer día, día 15 y último día del mes calendario `back` meses antes del actual (fechas de negocio). */
const month = (back: number) => {
  const first = new Date(Date.UTC(Y, M - 1 - back, 1));
  const last = new Date(Date.UTC(Y, M - back, 0));
  const text = (d: Date) => d.toISOString().slice(0, 10);
  return {
    label: text(first).slice(0, 7),
    first: text(first),
    middle: `${text(first).slice(0, 8)}15`,
    last: text(last),
  };
};

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

test.describe('Evolución del patrimonio (reporting/net-worth)', () => {
  test('[TC-REPORTING-NETWORTH-006] [TC-REPORTING-NETWORTH-007] la serie de tres meses del dataset de prueba se muestra con sus valores en el Home y en la vista completa; sin violaciones serias de axe; móvil', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { context, page, W } = await newFinanceUser(browser, 'nw-evo');
    const [m3, m2, m1, m0] = [month(3), month(2), month(1), month(0)] as const;

    // Banco BOB 2000.00 desde el inicio del primer mes; ingreso de 500.00 y gasto de 100.00 en los meses siguientes.
    const bankBody = {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: bob('2000.00'), date: m3.first },
    };
    const bank = String((await api(page, 'POST', `${W}/accounts`, bankBody))['id']);
    await api(page, 'POST', `${W}/accounts`, {
      name: 'Wallet USDT',
      type: 'CRYPTO_WALLET',
      currency: 'USDT',
      openingBalance: { amount: { amount: '100.000000', currency: 'USDT' }, date: m3.first },
    });
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'INCOME',
      transactionDate: m2.middle,
      accountId: bank,
      amount: bob('500.00'),
    });
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: m1.middle,
      accountId: bank,
      amount: bob('100.00'),
    });
    // Una tasa USDT/BOB con la fecha de cada fin de mes y otra de hoy: cada punto usa la suya (INV-012).
    const rates: readonly [string, string][] = [
      [`${m3.last}T20:00:00Z`, '10.00'],
      [`${m2.last}T20:00:00Z`, '10.50'],
      [`${m1.last}T20:00:00Z`, '11.00'],
      [new Date(now.getTime() - 60_000).toISOString(), '12.00'],
    ];
    for (const [asOf, value] of rates) {
      await api(page, 'POST', `${W}/fx-rates`, {
        base: 'USDT',
        quote: 'BOB',
        value,
        rateType: 'PARALLEL',
        asOf,
        sourceLabel: 'Casa de cambio centro',
      });
    }
    await api(page, 'POST', `${W}/periods`, { through: m0.last });
    // Una cuenta más del Home solo para tener algo más que mostrar en el resto del tablero.
    await openAccount(page, W, 'Caja', 'CASH', 'BOB');

    const expected: [string, string][] = [
      [m3.label, '3.000,00'],
      [m2.label, '3.550,00'],
      [m1.label, '3.500,00'],
      [m0.label, '3.600,00'],
    ];

    // Tarjeta compacta del Home.
    await go(page, '/');
    const card = page.getByTestId('net-worth-evolution-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Evolución del patrimonio' })).toBeVisible();
    await expect(card.getByTestId('net-worth-chart')).toBeVisible();
    for (const [label, net] of expected) {
      await expect(card.locator(`[data-testid="net-worth-row"][data-period="${label}"]`)).toContainText(net);
    }
    await expect(card.getByTestId('net-worth-flag-notice')).toContainText('configuración actual');
    const homeViolations = await seriousViolations(page);
    expect(homeViolations, JSON.stringify(homeViolations)).toEqual([]);

    // Vista completa.
    await card.getByTestId('net-worth-evolution-link').click();
    await expect(page).toHaveURL(/\/patrimonio$/);
    const full = page.getByTestId('net-worth-evolution');
    await expect(full.getByRole('heading', { level: 1, name: 'Evolución del patrimonio' })).toBeVisible();
    await expect(full.getByTestId('net-worth-table')).toBeVisible();
    for (const [label, net] of expected) {
      await expect(full.locator(`[data-testid="net-worth-row"][data-period="${label}"]`)).toContainText(net);
    }
    // El periodo en curso es parcial; los anteriores traen su variación con signo.
    await expect(full.locator(`[data-testid="net-worth-row"][data-period="${m0.label}"]`)).toContainText(
      'En curso (parcial)',
    );
    await expect(full.locator(`[data-testid="net-worth-row"][data-period="${m2.label}"]`)).toContainText(
      '+550,00 BOB',
    );
    // Tasas usadas por periodo: la de su fin de mes (10, 10,5, 11) y no la de hoy (12).
    const rateList = full.getByTestId('net-worth-rates');
    await expect(rateList).toContainText('USDT/BOB 10');
    await expect(rateList).toContainText('USDT/BOB 10,5');
    await expect(rateList).toContainText('USDT/BOB 11');
    const fullViolations = await seriousViolations(page);
    expect(fullViolations, JSON.stringify(fullViolations)).toEqual([]);

    // Móvil: sin scroll horizontal de la página.
    await page.setViewportSize({ width: 375, height: 812 });
    await go(page, '/patrimonio');
    await expect(page.getByTestId('net-worth-chart')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
