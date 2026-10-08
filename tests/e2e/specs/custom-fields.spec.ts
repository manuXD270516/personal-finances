import { expect, test } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz, userCategories } from '../src/finance.js';

/**
 * Campos personalizados por la UI (openspec add-custom-fields, tareas 6.1 y 7.2): definir "centro_costo" en
 * Clasificación → Campos personalizados, registrar un gasto con "Oficina" en el formulario de transacciones, verlo en el
 * detalle y filtrarlo en el registro; obligatoriedad en gastos nuevos; archivar conserva el valor histórico y retira el
 * campo del formulario; campos de cuenta.
 */
test.describe('Campos personalizados (classification/custom-fields)', () => {
  test('[TC-CLASSIFICATION-CUSTOMFIELD-001] [TC-TRANSACTIONS-CUSTOMFIELD-001] [TC-TRANSACTIONS-CUSTOMFIELD-002] definir "centro_costo", registrar un gasto con "Oficina" y filtrarlo', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const { context, page, W } = await newFinanceUser(browser, 'camposp');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const [food] = await userCategories(page, W, 'EXPENSE');

    // Definición por la UI: etiqueta, clave, tipo Selección y las opciones "Casa" y "Oficina".
    await go(page, '/clasificacion?vista=campos');
    await expect(page.getByRole('tab', { name: 'Campos personalizados' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const form = page.getByRole('form', { name: 'Nuevo campo personalizado' });
    await form.getByLabel('Etiqueta', { exact: true }).fill('Centro de costo');
    await form.getByLabel('Clave', { exact: true }).fill('centro_costo');
    await form.getByLabel('Tipo', { exact: true }).selectOption('SELECT');
    await form.getByLabel('Etiqueta de la opción 1').fill('Casa');
    await form.getByRole('button', { name: 'Agregar opción' }).click();
    await form.getByLabel('Etiqueta de la opción 2').fill('Oficina');
    await form.getByRole('button', { name: 'Crear campo' }).click();
    await expect(page.getByRole('status')).toHaveText('Campo «Centro de costo» creado.');
    const row = page.locator('[data-testid="custom-field"][data-key="centro_costo"]');
    await expect(row).toContainText('Selección');
    await expect(row).toContainText('Casa · Oficina');

    // Un gasto por la UI con "Oficina" y otro (API) con "Casa".
    await go(page, `/transacciones/nueva?cuenta=${bank}`);
    const tx = page.getByTestId('transaction-form');
    await tx.getByLabel('Monto (BOB)').fill('45,90');
    await tx.getByLabel('Descripción').fill('Papelería de la oficina');
    await tx.getByLabel('Categoría de la parte 1').selectOption({ label: food!.name });
    await tx.getByLabel('Centro de costo').selectOption({ label: 'Oficina' });
    await tx.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByTestId('transaction-detail')).toBeVisible();
    // El detalle muestra el valor del split con la etiqueta del campo y la de la opción.
    await expect(page.getByTestId('split-custom-fields')).toContainText('Centro de costoOficina');
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('200.00'),
      description: 'Luz de la casa',
      splits: [{ amount: bob('200.00'), categoryId: food!.id, customFields: { centro_costo: 'casa' } }],
    });

    // Filtro del registro por el campo: solo el gasto de "Oficina".
    await go(page, '/transacciones');
    await expect(page.getByTestId('transaction-row')).toHaveCount(2);
    await page.getByLabel('Campo personalizado', { exact: true }).selectOption({ label: 'Centro de costo' });
    await page
      .getByRole('search')
      .getByLabel('Centro de costo', { exact: true })
      .selectOption({ label: 'Oficina' });
    await expect(page.getByTestId('transactions-register')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('transaction-row')).toHaveCount(1);
    const only = page.getByTestId('transaction-row').first();
    await expect(only.getByTestId('tx-title')).toHaveText('Papelería de la oficina');
    await expect(only.getByTestId('tx-custom-fields')).toHaveText('Centro de costo: Oficina');
    await context.close();
  });

  test('[TC-CLASSIFICATION-CUSTOMFIELD-006] [TC-CLASSIFICATION-CUSTOMFIELD-008] obligatorio en gastos nuevos; archivar conserva el valor histórico y retira el campo del formulario', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const { context, page, W } = await newFinanceUser(browser, 'camposo');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const [food] = await userCategories(page, W, 'EXPENSE');
    const field = await api(page, 'POST', `${W}/custom-fields`, {
      key: 'factura',
      label: 'Factura',
      dataType: 'TEXT',
      target: 'TRANSACTION',
      required: true,
    });
    const gasto = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('30.00'),
      description: 'Con factura',
      splits: [{ amount: bob('30.00'), categoryId: food!.id, customFields: { factura: 'F-001234' } }],
    });

    // Un gasto nuevo sin el obligatorio no se registra y el campo señala el error.
    await go(page, `/transacciones/nueva?cuenta=${bank}`);
    const tx = page.getByTestId('transaction-form');
    await tx.getByLabel('Monto (BOB)').fill('10,00');
    await tx.getByLabel('Categoría de la parte 1').selectOption({ label: food!.name });
    await tx.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(
      tx.getByTestId('field-error').filter({ hasText: 'Este campo es obligatorio.' }),
    ).toBeVisible();
    await expect(page.getByTestId('transaction-detail')).toHaveCount(0);
    await tx.getByLabel('Factura').fill('F-777');
    await tx.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByTestId('transaction-detail')).toBeVisible();
    await expect(page.getByTestId('split-custom-fields')).toContainText('FacturaF-777');

    // Archivar el campo: ya no se ofrece en el formulario, pero el gasto previo sigue mostrando su valor.
    await go(page, '/clasificacion?vista=campos');
    await page.getByRole('button', { name: 'Archivar Factura' }).click();
    await expect(page.getByRole('status')).toHaveText('Campo «Factura» archivado.');
    await go(page, `/transacciones/nueva?cuenta=${bank}`);
    await expect(page.getByTestId('transaction-form').getByLabel('Factura')).toHaveCount(0);
    await go(page, `/transacciones/${String(gasto['id'])}`);
    await expect(page.getByTestId('split-custom-fields')).toContainText('Factura (archivado)F-001234');
    expect(String(field['id'])).not.toBe('');
    await context.close();
  });

  test('[TC-CLASSIFICATION-CUSTOMFIELD-005] campo de cuenta "sucursal": se edita en la cuenta y su saldo no cambia', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const { context, page, W } = await newFinanceUser(browser, 'camposc');
    const bank = await openAccount(page, W, 'Bank A', 'BANK', 'BOB', '1000.00');
    await api(page, 'POST', `${W}/custom-fields`, {
      key: 'sucursal',
      label: 'Sucursal',
      dataType: 'TEXT',
      target: 'ACCOUNT',
    });
    await go(page, `/cuentas/${bank}`);
    await expect(page.getByTestId('account-balance')).toContainText('1.000,00');
    await page.getByRole('button', { name: 'Editar' }).click();
    const form = page.getByTestId('account-form');
    await form.getByLabel('Sucursal').fill('Sucursal Centro');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByTestId('account-custom-field-values')).toContainText('SucursalSucursal Centro');
    await expect(page.getByTestId('account-balance')).toContainText('1.000,00');
    await context.close();
  });
});
