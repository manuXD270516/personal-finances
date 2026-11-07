import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
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
 * Reportes financieros por la UI (openspec add-financial-reports, tarea 8.1, TC-REPORTING-REPORTS-026 y 038): se
 * registra el mes de los scenarios, se abre "Gastos por categoría", se entra a una categoría, se llega a la
 * transacción, se exporta el CSV y se compara con el mes anterior; el enlace de Q7 del Home abre el reporte de
 * ingresos y gastos con la misma comparación. Accesibilidad con axe y vista móvil sin scroll horizontal.
 */
const today = todayLaPaz();
const monthStart = `${today.slice(0, 8)}01`;
/** Primer día del mes anterior (siempre anterior o igual al mismo día del mes en curso). */
const previousMonthStart = (): string => {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 10);
};

async function expense(
  page: Parameters<typeof api>[0],
  W: string,
  accountId: string,
  categoryId: string,
  amount: string,
  date: string,
  extra: Record<string, unknown> = {},
) {
  return api(page, 'POST', `${W}/transactions`, {
    kind: 'EXPENSE',
    transactionDate: date,
    accountId,
    amount: bob(amount),
    splits: [{ amount: bob(amount), categoryId }],
    ...extra,
  });
}

test.describe('Reportes financieros (reporting/financial-reports)', () => {
  test('[TC-REPORTING-REPORTS-026] del gráfico de gastos por categoría a la transacción, exportación CSV, comparación, axe y móvil', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'reports');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const [food, other] = await userCategories(page, W, 'EXPENSE');
    const [salary] = await userCategories(page, W, 'INCOME');
    const base = await expense(page, W, bank, food!.id, '3500.00', monthStart);
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'REFUND',
      transactionDate: monthStart,
      accountId: bank,
      amount: bob('200.00'),
      refundOfTransactionId: base['id'],
      splits: [{ amount: bob('200.00'), categoryId: food!.id }],
    });
    await expense(page, W, bank, other!.id, '500.00', monthStart);
    await expense(page, W, bank, food!.id, '1000.00', previousMonthStart());
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'INCOME',
      transactionDate: monthStart,
      accountId: bank,
      amount: bob('12000.00'),
      splits: [{ amount: bob('12000.00'), categoryId: salary!.id }],
    });

    // Catálogo: 16 reportes, quince disponibles y el pronóstico planificado sin cifras.
    await go(page, '/reportes');
    const catalog = page.getByTestId('reports-catalog');
    await expect(catalog.getByTestId('catalog-entry')).toHaveCount(16);
    await expect(catalog.locator('[data-status="AVAILABLE"]')).toHaveCount(15);
    await expect(catalog.locator('[data-status="PLANNED"]').last()).toContainText('Pronóstico vs real');
    await catalog.getByRole('link', { name: 'Abrir reporte' }).nth(2).click();
    await expect(page).toHaveURL(/\/reportes\/gastos-por-categoria/u);

    // Gastos por categoría del mes: la categoría suma gasto menos reembolso (3.300,00 BOB).
    await go(page, `/reportes/gastos-por-categoria?from=${monthStart}&to=${today}&grouping=CALENDAR_MONTH`);
    const view = page.getByTestId('report-by-category');
    await expect(view).toBeVisible();
    const row = view.getByTestId('cat-row').filter({ hasText: food!.name });
    await expect(row).toContainText('3.300,00 BOB');
    await expect(page.getByTestId('conversion-block')).toContainText('Cómo se convirtió');

    // Drill-down: las porciones suman la cifra y llevan a la transacción.
    await row.getByTestId('drill-open').first().click();
    const panel = page.getByTestId('drill-down');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('drill-totals')).toContainText('3.300,00 BOB');
    await expect(panel.getByTestId('drill-row')).toHaveCount(2);
    const download = page.waitForEvent('download');
    await panel.getByTestId('drill-export').click();
    expect((await download).suggestedFilename()).toMatch(/^drill-down-expenses_by_category-.*\.csv$/u);
    await panel.getByTestId('drill-row').first().getByRole('link').click();
    await expect(page).toHaveURL(/\/transacciones\/[0-9a-f-]{36}/u);

    // Exportación del reporte y comparación con el periodo anterior (variación con texto e icono).
    await go(page, `/reportes/gastos-por-categoria?from=${monthStart}&to=${today}&grouping=CALENDAR_MONTH`);
    const csv = page.waitForEvent('download');
    await page.getByTestId('report-export').click();
    expect((await csv).suggestedFilename()).toMatch(/^expenses-by-category-.*\.csv$/u);
    await page.getByLabel('Comparar con').selectOption('PREVIOUS_PERIOD');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    const compared = view.getByTestId('cat-row').filter({ hasText: food!.name }).getByTestId('variation');
    await expect(compared).toContainText('+2.300,00 BOB');
    await expect(compared).toContainText('%');

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 });
    await expectNoHorizontalScroll(page);
    await context.close();
  });

  test('[TC-REPORTING-REPORTS-054] de la etiqueta a la porción, guardar la vista y volver a abrirla; axe y móvil', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'reportstag');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const [lodging, meals] = await userCategories(page, W, 'EXPENSE');
    const trip = await api(page, 'POST', `${W}/tags`, { name: 'Viaje Cusco' });
    const work = await api(page, 'POST', `${W}/tags`, { name: 'Trabajo' });
    await expense(page, W, bank, lodging!.id, '800.00', monthStart, {
      splits: [{ amount: bob('800.00'), categoryId: lodging!.id, tagIds: [trip['id'], work['id']] }],
    });
    await expense(page, W, bank, meals!.id, '200.00', monthStart, {
      splits: [{ amount: bob('200.00'), categoryId: meals!.id, tagIds: [trip['id']] }],
    });

    // Gastos por etiqueta: Viaje Cusco 1.000,00 y Trabajo 800,00 con el aviso de que no son aditivos.
    const tagsUrl = `/reportes/gastos-por-etiqueta?from=${monthStart}&to=${today}&grouping=CALENDAR_MONTH`;
    await go(page, tagsUrl);
    const view = page.getByTestId('report-by-tag');
    await expect(view.getByTestId('non-additive-note')).toBeVisible();
    await expect(view.getByTestId('tag-row').filter({ hasText: 'Viaje Cusco' })).toContainText(
      '1.000,00 BOB',
    );
    await expect(view.getByTestId('tag-row').filter({ hasText: 'Trabajo' })).toContainText('800,00 BOB');

    // De la etiqueta a sus categorías y a la porción de 800,00 con su transacción.
    await view
      .getByTestId('tag-row')
      .filter({ hasText: 'Viaje Cusco' })
      .getByTestId('tag-by-category')
      .click();
    await expect(page).toHaveURL(/\/reportes\/gastos-por-categoria\?.*tagId=/u);
    const byCategory = page.getByTestId('report-by-category');
    const row = byCategory.getByTestId('cat-row').filter({ hasText: lodging!.name });
    await expect(row).toContainText('800,00 BOB');
    await row.getByTestId('drill-open').first().click();
    const panel = page.getByTestId('drill-down');
    await expect(panel.getByTestId('drill-row')).toHaveCount(1);
    await expect(panel.getByTestId('drill-totals')).toContainText('800,00 BOB');
    await panel.getByTestId('drill-row').first().getByRole('link').click();
    await expect(page).toHaveURL(/\/transacciones\/[0-9a-f-]{36}/u);

    // Guardar la vista con un rango relativo y reabrirla desde el menú: restaura los filtros.
    await go(page, `${tagsUrl}&tagId=${trip['id']}`);
    const saved = page.getByTestId('saved-views');
    await saved.getByLabel('Nombre de la vista').fill('Gastos del viaje');
    await saved.getByLabel('Rango a guardar').selectOption('LAST_3');
    await saved.getByTestId('saved-view-save').click();
    await expect(saved.getByTestId('saved-view')).toContainText('Gastos del viaje');
    await go(page, '/reportes/gastos-por-etiqueta');
    await page.getByTestId('saved-views').getByRole('button', { name: 'Abrir Gastos del viaje' }).click();
    await expect(page.getByLabel('Desde (fecha de negocio)')).not.toHaveValue('');
    await expect(page.getByTestId('report-by-tag').getByTestId('tag-row')).toHaveCount(1);

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 });
    await expectNoHorizontalScroll(page);
    await context.close();
  });

  test('[TC-REPORTING-REPORTS-038] el enlace de Q7 del Home abre el reporte de ingresos y gastos con la misma comparación', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'reportshome');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const [food] = await userCategories(page, W, 'EXPENSE');
    await expense(page, W, bank, food!.id, '1800.00', monthStart);
    await expense(page, W, bank, food!.id, '1500.00', previousMonthStart());
    await go(page, '/');
    const link = page.getByTestId('expense-report-link');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/reportes\/ingresos-gastos\?.*compare=PREVIOUS_PERIOD_TO_DATE/u);
    const view = page.getByTestId('report-income-expenses');
    await expect(view).toBeVisible();
    await expect(view.getByTestId('ie-row').first()).toContainText('1.800,00 BOB');
    await expect(view.getByTestId('ie-row').first().getByTestId('variation')).toContainText('%');
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await context.close();
  });
});
