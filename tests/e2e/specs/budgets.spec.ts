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
  userCategories,
} from '../src/finance.js';

/**
 * Presupuestos (openspec add-budgets 7.3): se crea el plan del periodo actual, se agrega "Restaurantes"-like con un
 * máximo de 600,00 BOB y se registran gastos hasta cruzar el 50 % y el 90 %. El gastado sale de las transacciones; los
 * umbrales cruzados los registra el consumidor del worker (asíncrono), así que la pantalla se recarga hasta verlos.
 * Verifica progreso (restante, uso, estado con texto e icono), cruces, "disponible para gastar" en el Home, accesibilidad
 * (axe) y viewport móvil sin scroll horizontal.
 */
const PATH = '/planificacion/presupuestos';

/** Recarga la pantalla hasta que se cumpla `check` (los cruces los registra el worker en segundo plano). */
async function eventually(page: Page, check: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await go(page, PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Presupuestos' })).toBeVisible();
    await expect(page.getByText('Cargando el plan…')).toHaveCount(0);
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('la pantalla no llegó al estado esperado a tiempo');
    await page.waitForTimeout(1500);
  }
}

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

test.describe('Presupuestos', () => {
  test('[TC-PLANNING-BUDGET-001] [TC-PLANNING-BUDGET-006] [TC-PLANNING-THRESHOLD-003] [TC-PLANNING-THRESHOLD-006] plan del periodo, línea máxima 600,00 BOB y cruces del 50 % y 90 %', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'presupuestos');
    const bank = await openAccount(page, W, 'Banco presupuestos', 'BANK', 'BOB', '5000.00');
    const [food] = await userCategories(page, W, 'EXPENSE');
    const category = food!;

    // Los periodos los crea el worker de forma asíncrona (docs/33 D64): esperar al selector con opciones.
    await eventually(
      page,
      async () => (await page.getByTestId('period-selector').locator('option').count()) > 0,
    );
    await expect(page.getByTestId('budget-none')).toBeVisible();
    await expect(page.getByTestId('planning-nav')).toBeVisible();

    // 1. Crear el plan del periodo.
    await page.getByTestId('create-plan').click();
    await expect(page.getByRole('status').filter({ hasText: 'Plan creado.' })).toBeVisible();
    await expect(page.getByTestId('budget-lines-empty')).toBeVisible();

    // 2. Agregar la línea: máximo de 600,00 BOB (umbrales por defecto 50/75/90/100).
    await page.getByTestId('add-line').click();
    await page.getByTestId('form-target').selectOption({ label: category.name });
    await expect(page.getByTestId('form-kind')).toHaveValue('MAXIMUM');
    await page.getByTestId('form-planned').fill('600,00');
    await page.getByTestId('form-submit').click();
    await expect(page.getByRole('status').filter({ hasText: 'Línea agregada.' })).toBeVisible();
    const row = page.locator(`[data-testid="budget-lines-table"] tr[data-target-id="${category.id}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('line-planned')).toContainText('600,00 BOB');
    await expect(row.getByTestId('line-actual')).toContainText('0,00 BOB');
    await expect(row.getByTestId('line-thresholds')).toContainText('50 %');
    await expect(row.getByTestId('line-thresholds')).toContainText('100 %');

    // 3. Gasto de 280,00 BOB (46,7 %): sin cruces.
    const spend = (amount: string) =>
      api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: todayLaPaz(),
        accountId: bank,
        amount: bob(amount),
        splits: [{ amount: bob(amount), categoryId: category.id }],
      });
    await spend('280.00');
    await eventually(
      page,
      async () => (await row.getByTestId('line-actual').textContent())?.includes('280,00') ?? false,
    );
    await expect(row.getByTestId('line-usage')).toContainText('46,7 %');
    await expect(row.getByTestId('line-remaining')).toContainText('320,00 BOB');
    await expect(row.locator('[data-crossed="true"]')).toHaveCount(0);
    await expect(row.getByTestId('budget-status')).toHaveText(/Dentro del límite/);

    // 4. +30,00 BOB (51,7 %): cruza el 50 %.
    await spend('30.00');
    await eventually(page, async () => (await row.locator('[data-crossed="true"]').count()) === 1);
    await expect(row.getByTestId('line-usage')).toContainText('51,7 %');
    await expect(row.locator('[data-crossed="true"]')).toContainText('50 %');

    // 5. +240,00 BOB (91,7 %): cruzan el 75 % y el 90 % (un solo hecho con el más alto, los tres quedan registrados).
    await spend('240.00');
    await eventually(page, async () => (await row.locator('[data-crossed="true"]').count()) === 3);
    await expect(row.getByTestId('line-usage')).toContainText('91,7 %');
    await expect(row.getByTestId('line-remaining')).toContainText('50,00 BOB');
    // La proyección lineal del máximo aparece con su aviso solo si supera el tope; el estado sigue "Dentro del límite".
    await expect(row.getByTestId('line-projection')).not.toContainText('—');
    await expect(page.getByTestId('total-available')).toContainText('50,00 BOB');
    await expect(page.getByTestId('total-actual')).toContainText('550,00 BOB');

    // 6. Exceso: +60,00 BOB (610,00): estado "Excedido" con texto e icono, restante negativo.
    await spend('60.00');
    await eventually(
      page,
      async () => (await row.getByTestId('line-actual').textContent())?.includes('610,00') ?? false,
    );
    await expect(row.getByTestId('budget-status')).toHaveText(/Excedido/);
    await expect(row.getByTestId('budget-status').locator('[aria-hidden="true"]')).toHaveText('▲');
    await expect(row.getByTestId('line-remaining')).toContainText('-10,00 BOB');
    await expect(page.getByTestId('total-available')).toContainText('0,00 BOB');

    // 7. El Home muestra el disponible para gastar del plan del mes.
    await go(page, '/');
    await expect(page.getByTestId('budget-widget')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('budget-widget-available')).toContainText('0,00 BOB');
    await expect(page.getByTestId('budget-widget-detail')).toContainText('600,00 BOB');

    // 8. Accesibilidad y viewport móvil de la pantalla con datos.
    await go(page, PATH);
    await expect(page.getByTestId('budget-lines-table')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByRole('button', { name: /^Editar la línea/ }).click();
    await expect(page.getByTestId('budget-line-form-edit')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 360, height: 780 });
    await expectNoHorizontalScroll(page);
    await context.close();
  });

  test('[TC-PLANNING-BUDGET-007] un monto inválido y un objetivo repetido se muestran con el mensaje de su código', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'presupuestos-err');
    const [food] = await userCategories(page, W, 'EXPENSE');
    const category = food!;
    await eventually(
      page,
      async () => (await page.getByTestId('period-selector').locator('option').count()) > 0,
    );
    await page.getByTestId('create-plan').click();
    await expect(page.getByTestId('budget-lines-empty')).toBeVisible();
    await page.getByTestId('add-line').click();
    await page.getByTestId('form-target').selectOption({ label: category.name });
    // Más decimales que la moneda: se rechaza en el cliente, sin llamar a la API.
    await page.getByTestId('form-planned').fill('100,005');
    await page.getByTestId('form-submit').click();
    await expect(page.getByTestId('field-error')).toContainText('más decimales');
    await page.getByTestId('form-planned').fill('900,00');
    await page.getByTestId('form-submit').click();
    await expect(page.getByRole('status').filter({ hasText: 'Línea agregada.' })).toBeVisible();
    // Misma categoría otra vez: la API responde BUDGET_LINE_DUPLICATE_TARGET y la pantalla lo explica.
    await page.getByTestId('add-line').click();
    await page.getByTestId('form-target').selectOption({ label: category.name });
    await page.getByTestId('form-planned').fill('100,00');
    await page.getByTestId('form-submit').click();
    await expect(page.locator('[data-error-code="BUDGET_LINE_DUPLICATE_TARGET"]')).toContainText(
      'ya tiene una línea para esa categoría',
    );
    await context.close();
  });
});
