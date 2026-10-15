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
 * Catálogo de referencia de instituciones y tasas por institución (openspec add-exchange-house-rate-providers, 7.2).
 * Usa el catálogo FICTICIO `reference/institutions/demo` (entidades inventadas: nunca el registro oficial) que el
 * `.env.example` ya apunta en desarrollo y E2E. Cubre: agregar dos entidades desde el catálogo, estado de soporte por
 * dimensión (incluida una no elegible con su razón), el aviso de catálogo ficticio, el panel de cobertura y una tasa
 * BANK_SELL como referencia de una conversión; con axe y vista móvil.
 */
test.describe('Catálogo de instituciones (accounts/institutions) y tasas por institución (fx)', () => {
  test('[TC-ACCOUNTS-INSTCATALOG-002] [TC-ACCOUNTS-INSTCATALOG-006] agregar dos entidades del catálogo ficticio, ver su soporte y la cobertura', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'instcat');
    await go(page, '/instituciones');

    const panel = page.getByTestId('catalog-panel');
    await panel.getByTestId('catalog-toggle').click();
    const catalog = panel.getByTestId('institution-catalog');
    await expect(catalog).toBeVisible();
    await expect(catalog.getByTestId('catalog-fictitious')).toContainText('entidades ficticias');
    await expect(catalog.getByTestId('catalog-source')).toContainText('versión 2026-09-30');
    // Catálogo completo salvo la entidad dada de baja (no se lista sin includeDelisted); trece vigentes.
    await expect(catalog.getByTestId('catalog-entry')).toHaveCount(13);

    // Estado de soporte por dimensión, con la razón de una entidad no elegible.
    const pyme = catalog.locator('[data-testid="catalog-entry"][data-code="BPY"]');
    await expect(pyme.getByTestId('support-rates')).toContainText('No elegible');
    const casa = catalog.locator('[data-testid="catalog-entry"][data-code="CCS"]');
    await expect(casa.getByTestId('catalog-not-adoptable')).toBeVisible();
    await expect(casa.getByRole('checkbox')).toBeDisabled();

    // Búsqueda y filtro por categoría.
    await catalog.getByLabel('Buscar por nombre o sigla').fill('illimani');
    await expect(catalog.getByTestId('catalog-entry')).toHaveCount(1);
    await catalog.getByLabel('Buscar por nombre o sigla').fill('');
    await catalog.getByLabel('Categoría').selectOption('SAVINGS_COOP');
    await expect(catalog.getByTestId('catalog-entry')).toHaveCount(2);
    await catalog.getByLabel('Categoría').selectOption('');

    // Selección múltiple y adopción.
    await catalog.getByLabel('Seleccionar Banco Andino Demo').check();
    await catalog.getByLabel('Seleccionar Banco Boliviano Demo').check();
    await catalog.getByRole('button', { name: 'Agregar seleccionadas (2)' }).click();
    await expect(page.getByRole('status')).toContainText('Instituciones agregadas: 2.');
    const rows = page.getByTestId('institution-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Banco Andino Demo' }).getByTestId('support-rates')).toContainText(
      'En verificación',
    );
    await expect(rows.filter({ hasText: 'Banco Boliviano Demo' }).getByTestId('support-rates')).toContainText(
      'Soportado',
    );
    await expect(
      catalog.locator('[data-testid="catalog-entry"][data-code="BAD"]').getByTestId('catalog-adopted'),
    ).toBeVisible();

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 });
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Panel de cobertura en Configuración (84,62 % de tasas resueltas en el catálogo ficticio).
    await go(page, '/configuracion');
    await page.getByTestId('coverage-toggle').click();
    const coverage = page.getByTestId('coverage');
    await expect(coverage).toBeVisible();
    await expect(coverage.getByTestId('coverage-summary')).toContainText('Cobertura incompleta.');
    await expect(
      coverage
        .locator('[data-testid="coverage-dimension"][data-dimension="rates"]')
        .getByTestId('coverage-resolved'),
    ).toContainText('84,62 %');
    await expect(coverage.getByTestId('coverage-not-eligible').first()).toBeVisible();
    const axeSettings = await new AxeBuilder({ page }).analyze();
    expect(axeSettings.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await context.close();
  });

  test('[TC-FX-INSTRATE-006] una tasa de venta a la entidad (BANK_SELL) es la referencia de una conversión y se ve en Tasas', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'instrate');
    const usd = await openAccount(page, W, 'Efectivo USD', 'CASH', 'USD', '500.00');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '0.00');
    // Moneda USD habilitada por el alta de la cuenta; la tasa por entidad se registra como referencia propia.
    const rate = await api(page, 'POST', `${W}/fx-rates`, {
      base: 'USD',
      quote: 'BOB',
      value: '6.9100',
      rateType: 'BANK_SELL',
      asOf: new Date(Date.now() - 3_600_000).toISOString(),
      sourceLabel: 'Venta a entidad (referencia manual)',
    });
    const rateId = String(rate['id']);
    const conv = await api(page, 'POST', `${W}/conversions`, {
      transactionDate: todayLaPaz(),
      sourceAccountId: usd,
      targetAccountId: bank,
      sourceAmount: { amount: '100.00', currency: 'USD' },
      targetAmount: { amount: '690.00', currency: 'BOB' },
      quotedRate: { base: 'USD', quote: 'BOB', value: '6.90' },
      referenceFxRateId: rateId,
      executedAt: new Date(Date.now() - 600_000).toISOString(),
    });
    expect(conv['conversion']).toMatchObject({ referenceRate: { fxRateId: rateId, rateType: 'BANK_SELL' } });

    await go(page, '/fx');
    await expect(page.getByTestId('rate-row').filter({ hasText: 'Venta a entidad' })).toHaveCount(1);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 });
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
