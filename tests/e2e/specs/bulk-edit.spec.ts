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
 * Edición masiva por la UI (openspec add-bulk-edit 6.1 y 7.2; FR-TRANSACTIONS-033): se recategorizan y etiquetan tres
 * gastos con la vista previa obligatoria (TC-TRANSACTIONS-BULK-001, -002), una transacción con varios splits se señala
 * como no aplicable y se quita de la selección (TC-TRANSACTIONS-BULK-005) y un lote con una versión obsoleta se rechaza
 * completo con el error de ese ítem (TC-TRANSACTIONS-BULK-003). Sin violaciones serias de axe en el panel.
 */
type Json = Record<string, unknown>;

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

async function categoryId(page: Page, W: string, name: string): Promise<string> {
  const r = await api(page, 'GET', `${W}/categories?kind=EXPENSE&limit=200`);
  const hit = (r['data'] as { id: string; name: string }[]).find((c) => c.name === name);
  expect(hit, `categoría ${name}`).toBeDefined();
  return hit!.id;
}

async function expense(
  page: Page,
  W: string,
  bank: string,
  amount: string,
  description: string,
  cat: string,
) {
  return api(page, 'POST', `${W}/transactions`, {
    kind: 'EXPENSE',
    transactionDate: todayLaPaz(),
    accountId: bank,
    amount: bob(amount),
    description,
    splits: [{ amount: bob(amount), categoryId: cat }],
  });
}

const row = (page: Page, description: string) =>
  page.getByTestId('transaction-row').filter({ hasText: description });

test.describe('Edición masiva de transacciones', () => {
  test('[TC-TRANSACTIONS-BULK-001] [TC-TRANSACTIONS-BULK-002] [TC-TRANSACTIONS-BULK-005] recategorizar y etiquetar tres gastos con vista previa; un gasto dividido se quita de la selección', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'bulk');
    const bank = await openAccount(page, W, 'Bank A', 'BANK', 'BOB', '2395.90');
    const supermercado = await categoryId(page, W, 'Supermercado');
    const hogar = await categoryId(page, W, 'Hogar');
    await api(page, 'POST', `${W}/tags`, { name: 'familia' });
    const t1 = await expense(page, W, bank, '45.90', 'Compra uno', supermercado);
    const t2 = await expense(page, W, bank, '150.00', 'Compra dos', supermercado);
    const t3 = await expense(page, W, bank, '200.00', 'Compra tres', supermercado);
    const split = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('30.00'),
      description: 'Compra dividida',
      splits: [
        { amount: bob('20.00'), categoryId: supermercado },
        { amount: bob('10.00'), categoryId: supermercado },
      ],
    });

    await go(page, '/transacciones');
    await expect(page.getByTestId('transaction-row')).toHaveCount(4);
    // Sin selección, las acciones masivas están deshabilitadas.
    await expect(page.getByRole('button', { name: 'Recategorizar', exact: true })).toBeDisabled();

    for (const name of ['Compra uno', 'Compra dos', 'Compra tres', 'Compra dividida']) {
      await row(page, name).getByRole('checkbox').check();
    }
    await expect(page.getByTestId('bulk-selected')).toHaveText('4 seleccionadas');
    await page.getByRole('button', { name: 'Recategorizar', exact: true }).click();
    const panel = page.getByTestId('bulk-edit-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Edición masiva de 4 transacciones' })).toBeVisible();
    // La vista previa es obligatoria: sin cambios no hay nada que previsualizar.
    await expect(panel.getByTestId('bulk-preview')).toBeDisabled();
    await panel.getByLabel('Categoría nueva').selectOption({ label: 'Hogar' });
    await panel.getByLabel('Agregar etiquetas').selectOption({ label: 'familia' });
    await panel.getByTestId('bulk-preview').click();

    // 3 se pueden editar; el gasto dividido no (la categoría solo aplica a un único split).
    const result = panel.getByTestId('bulk-preview-result');
    await expect(result).toContainText('3 de 4 transacciones se pueden editar.');
    await expect(panel.getByTestId('bulk-blocked-item')).toHaveCount(1);
    await expect(panel.getByTestId('bulk-blocked-item')).toContainText('Compra dividida');
    await expect(panel.getByTestId('bulk-apply')).toBeDisabled();
    expect(await seriousViolations(page)).toEqual([]);
    await expectNoHorizontalScroll(page);
    // En móvil (360 px) el panel y la vista previa tampoco desbordan.
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(panel.getByTestId('bulk-preview-result')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Se quitan las que no se pueden editar y se vuelve a la vista previa de las tres restantes.
    await panel.getByTestId('bulk-drop-blocked').click();
    await expect(page.getByTestId('bulk-selected')).toHaveText('3 seleccionadas');
    await panel.getByLabel('Categoría nueva').selectOption({ label: 'Hogar' });
    await panel.getByLabel('Agregar etiquetas').selectOption({ label: 'familia' });
    await panel.getByTestId('bulk-preview').click();
    await expect(result).toContainText('3 de 3 transacciones se pueden editar.');
    await expect(panel.getByTestId('bulk-apply')).toBeEnabled();
    await panel.getByTestId('bulk-apply').click();

    const done = panel.getByTestId('bulk-result');
    await expect(done).toContainText('3 transacciones actualizadas');
    const bulkOperationId = await done.getAttribute('data-bulk-operation-id');
    expect(bulkOperationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await seriousViolations(page)).toEqual([]);

    // Las tres quedaron en "Hogar" con la etiqueta (versión 2) y la dividida no cambió.
    const tag = ((await api(page, 'GET', `${W}/tags`))['data'] as { id: string; name: string }[]).find(
      (x) => x.name === 'familia',
    )!;
    for (const tx of [t1, t2, t3]) {
      const read = await api(page, 'GET', `${W}/transactions/${String(tx['id'])}`);
      const splits = read['splits'] as { categoryId: string; tagIds: string[] }[];
      expect(splits[0]).toMatchObject({ categoryId: hogar, tagIds: [tag.id] });
      expect(read['version']).toBe(2);
    }
    const untouched = await api(page, 'GET', `${W}/transactions/${String(split['id'])}`);
    expect(untouched['version']).toBe(1);
    // El saldo no cambia: clasificar nunca toca el ledger.
    const account = await api(page, 'GET', `${W}/accounts/${bank}`);
    expect(account['balance']).toEqual(bob('1970.00'));
    // La lista refleja la categoría nueva y la selección se limpió.
    await expect(page.getByTestId('bulk-selected')).toHaveText('0 seleccionadas');
    await expect(row(page, 'Compra uno')).toContainText('Hogar');
    await context.close();
  });

  test('[TC-TRANSACTIONS-BULK-003] una transacción modificada tras la vista previa rechaza todo el lote y señala ese ítem; nada cambia', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'bulk-stale');
    const bank = await openAccount(page, W, 'Bank A', 'BANK', 'BOB', '1000.00');
    const supermercado = await categoryId(page, W, 'Supermercado');
    const hogar = await categoryId(page, W, 'Hogar');
    const t1 = await expense(page, W, bank, '45.90', 'Compra uno', supermercado);
    const t2 = await expense(page, W, bank, '150.00', 'Compra dos', supermercado);

    await go(page, '/transacciones');
    await row(page, 'Compra uno').getByRole('checkbox').check();
    await row(page, 'Compra dos').getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Recategorizar', exact: true }).click();
    const panel = page.getByTestId('bulk-edit-panel');
    await panel.getByLabel('Categoría nueva').selectOption({ label: 'Hogar' });
    await panel.getByTestId('bulk-preview').click();
    await expect(panel.getByTestId('bulk-preview-result')).toContainText(
      '2 de 2 transacciones se pueden editar.',
    );

    // Otro cambio se cuela entre la vista previa y la ejecución: la versión de "Compra dos" ya no es la vista.
    const edit = (await api(
      page,
      'PATCH',
      `${W}/transactions/${String(t2['id'])}`,
      { notes: 'cambiada' },
      {
        'if-match': `"${String(t2['version'])}"`,
      },
    )) as Json;
    expect(edit['version']).toBe(2);
    await panel.getByTestId('bulk-apply').click();

    const errors = panel.getByTestId('bulk-errors');
    await expect(errors).toBeVisible();
    await expect(errors.getByTestId('bulk-item-error')).toHaveCount(1);
    await expect(errors.getByTestId('bulk-item-error')).toContainText('Compra dos');
    await expect(errors.getByTestId('bulk-item-error')).toHaveAttribute(
      'data-error-code',
      'PRECONDITION_FAILED',
    );
    expect(await seriousViolations(page)).toEqual([]);
    for (const tx of [t1, t2]) {
      const read = await api(page, 'GET', `${W}/transactions/${String(tx['id'])}`);
      expect((read['splits'] as { categoryId: string }[])[0]!.categoryId).not.toBe(hogar);
    }
    await context.close();
  });

  test('[TC-TRANSACTIONS-BULK-002] "seleccionar todo lo filtrado" usa la vista previa del filtro y ejecuta con las versiones vistas; cleared en lote', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'bulk-filter');
    const bank = await openAccount(page, W, 'Bank A', 'BANK', 'BOB', '1000.00');
    const supermercado = await categoryId(page, W, 'Supermercado');
    await expense(page, W, bank, '45.90', 'Compra uno', supermercado);
    await expense(page, W, bank, '150.00', 'Compra dos', supermercado);
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'INCOME',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('500.00'),
      description: 'Sueldo',
    });

    await go(page, '/transacciones');
    await page.getByLabel('Tipo', { exact: true }).selectOption('EXPENSE');
    await expect(page.getByTestId('transaction-row')).toHaveCount(2);
    await page.getByTestId('bulk-select-filtered').click();
    const panel = page.getByTestId('bulk-edit-panel');
    await expect(panel.getByRole('heading', { name: 'Edición masiva de lo filtrado' })).toBeVisible();
    await panel.getByLabel('Confirmación').selectOption('cleared');
    await panel.getByTestId('bulk-preview').click();
    // Solo los dos gastos del filtro, no el ingreso.
    await expect(panel.getByTestId('bulk-preview-result')).toContainText(
      '2 de 2 transacciones se pueden editar.',
    );
    await panel.getByTestId('bulk-apply').click();
    await expect(panel.getByTestId('bulk-result')).toContainText('2 transacciones actualizadas');
    await expect(row(page, 'Compra uno').getByTestId('tx-status')).toHaveText('Confirmada');
    await expect(row(page, 'Compra dos').getByTestId('tx-status')).toHaveText('Confirmada');
    const income = (await api(page, 'GET', `${W}/transactions?kind=INCOME`))['data'] as { status: string }[];
    expect(income[0]!.status).toBe('POSTED');
    await context.close();
  });
});
