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
 * Fusión de categorías por la UI (openspec add-category-and-counterparty-merge, tarea 7.2; TC-CLASSIFICATION-MERGE-001).
 * Datos SINTÉTICOS: «Super» con 3 gastos del mes que suman 320,50 BOB y «Supermercado» con 2 que suman 1.240,00 BOB.
 *
 * - «Fusionar en…» abre el diálogo; al elegir «Supermercado» se carga la vista previa (3 porciones, sin conflictos) y el
 *   aviso de que no se deshace; confirmar exige la casilla y el botón lleva el nombre de la destino.
 * - Tras fusionar, el estado lo anuncia, «Super» sale del listado y, con archivadas, queda «fusionada en Supermercado»
 *   sin «Desarchivar».
 * - El reporte de gastos por categoría del mes muestra «Supermercado» = 1.560,50 BOB y no muestra «Super».
 * Sin violaciones serias de axe (diálogo abierto y reporte) ni desborde horizontal.
 */
async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

interface CategoryDto {
  readonly id: string;
  readonly name: string;
  readonly mergedInto?: { readonly id: string; readonly name: string } | null;
  readonly archivedAt?: string | null;
}

/** Categoría de gasto de primer nivel con ese nombre: la del catálogo sugerido si existe; si no, se crea. */
async function expenseCategory(page: Page, W: string, name: string): Promise<string> {
  const list = await api(page, 'GET', `${W}/categories?kind=EXPENSE&limit=200`);
  const found = (list['data'] as CategoryDto[]).find((c) => c.name === name);
  if (found) return found.id;
  const groups = await api(page, 'GET', `${W}/category-groups?limit=200`);
  const group = (groups['data'] as { id: string; kind: string }[]).find((g) => g.kind === 'EXPENSE');
  expect(group, 'grupo de gastos').toBeDefined();
  return String((await api(page, 'POST', `${W}/categories`, { groupId: group!.id, name }))['id']);
}

test.describe('Fusión de categorías (classification/categories)', () => {
  test('[TC-CLASSIFICATION-MERGE-001] fusionar «Super» en «Supermercado» con vista previa y confirmación: el reporte del mes suma 1.560,50 BOB', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'fusion');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const sup = await expenseCategory(page, W, 'Super');
    const mercado = await expenseCategory(page, W, 'Supermercado');
    const today = todayLaPaz();
    const monthStart = `${today.slice(0, 8)}01`;
    const spend = (categoryId: string, amount: string, description: string) =>
      api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: today,
        accountId: bank,
        amount: bob(amount),
        description,
        splits: [{ amount: bob(amount), categoryId }],
      });
    for (const [amount, i] of [
      ['100.00', 1],
      ['120.50', 2],
      ['100.00', 3],
    ] as const) {
      await spend(sup, amount, `Compra corta ${i}`);
    }
    await spend(mercado, '800.00', 'Compra grande 1');
    await spend(mercado, '440.00', 'Compra grande 2');

    await go(page, '/clasificacion');
    const source = page.locator('[data-testid="category"][data-category="Super"]');
    await expect(source).toBeVisible();
    await source.getByRole('button', { name: 'Fusionar «Super» en otra' }).click();

    // Diálogo: sin destino no hay vista previa y no se puede confirmar.
    const dialog = page.getByRole('alertdialog', { name: 'Fusionar «Super»' });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Fusionar', exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Fusionar en', { exact: true }).selectOption({ label: 'Supermercado' });

    // Vista previa de solo lectura: 3 porciones se reasignan, sin conflictos y con el aviso de que no se deshace.
    const preview = dialog.getByTestId('merge-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('[data-count-key="SPLITS_OPEN"]')).toContainText(
      'Porciones de transacciones que se reasignan: 3',
    );
    await expect(dialog.getByTestId('merge-conflicts')).toHaveCount(0);
    await expect(dialog.getByTestId('merge-irreversible')).toContainText('La fusión no se puede deshacer');
    expect(await seriousViolations(page)).toEqual([]);

    // Confirmación explícita: la casilla habilita el botón con el nombre de la destino.
    const confirmNamed = dialog.getByRole('button', { name: 'Fusionar en «Supermercado»' });
    await expect(confirmNamed).toBeDisabled();
    await dialog.getByLabel('Entiendo que no se puede deshacer').check();
    await expect(confirmNamed).toBeEnabled();
    await confirmNamed.click();

    await expect(page.getByRole('status')).toHaveText('Categoría «Super» fusionada en «Supermercado».');
    await expect(dialog).toHaveCount(0);
    await expect(source).toHaveCount(0);

    // Con archivadas: «Super» queda fusionada en «Supermercado» y no se puede desarchivar.
    await page.getByLabel('Mostrar archivadas').check();
    const merged = page.locator('[data-testid="category"][data-category="Super"]');
    await expect(merged).toBeVisible();
    await expect(merged.getByTestId('category-merged-into')).toHaveText('fusionada en Supermercado');
    await expect(merged.getByRole('button', { name: 'Desarchivar «Super»' })).toHaveCount(0);
    const read = await api(page, 'GET', `${W}/categories/${sup}`);
    expect((read as unknown as CategoryDto).mergedInto?.name).toBe('Supermercado');
    expect((read as unknown as CategoryDto).archivedAt).toBeTruthy();

    // Reporte de gastos por categoría del mes: 320,50 + 1.240,00 = 1.560,50 BOB en «Supermercado»; «Super» no aparece.
    await go(page, `/reportes/gastos-por-categoria?from=${monthStart}&to=${today}&grouping=CALENDAR_MONTH`);
    const view = page.getByTestId('report-by-category');
    await expect(view).toBeVisible();
    await expect(view.getByTestId('cat-row').filter({ hasText: 'Supermercado' })).toContainText(
      '1.560,50 BOB',
    );
    await expect(view.getByTestId('cat-row').filter({ hasText: /\bSuper\b/u })).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
