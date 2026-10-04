import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { W1, bff, newUserPage } from '../src/helpers.js';
import {
  accountRow,
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
 * Registro de transacciones por la UI (openspec add-transaction-recording, tareas 6.1, 6.2 y 7.2): formulario con
 * splits, edición financiera (reversa + nuevo asiento), confirmación individual y en lote, anulación, medio de pago
 * (QR), contrapartes en línea, reembolso, ajuste, duplicar y el historial como línea de tiempo (visible para VIEWER).
 */

const txIdOf = (page: Page) => page.url().split('/transacciones/')[1]!.split('?')[0]!;

async function recordInUi(
  page: Page,
  input: {
    kind?: 'Gasto' | 'Ingreso' | 'Reembolso' | 'Ajuste';
    accountId: string;
    amount: string;
    description?: string;
    paymentMethod?: string;
    category?: string;
    newCounterparty?: string;
  },
): Promise<string> {
  await go(page, `/transacciones/nueva?cuenta=${input.accountId}`);
  const form = page.getByTestId('transaction-form');
  if (input.kind) await form.getByRole('radio', { name: input.kind, exact: true }).check();
  await form.getByLabel('Monto (BOB)').fill(input.amount);
  if (input.description) await form.getByLabel('Descripción').fill(input.description);
  if (input.paymentMethod) await form.getByLabel('Medio de pago').selectOption(input.paymentMethod);
  if (input.newCounterparty) {
    await form.getByLabel('Contraparte').fill(input.newCounterparty);
    await form.getByTestId('create-counterparty').click();
    await expect(form.getByTestId('counterparty-status')).toHaveText(
      `Contraparte «${input.newCounterparty}» creada y seleccionada.`,
    );
  }
  if (input.category)
    await form.getByLabel('Categoría de la parte 1').selectOption({ label: input.category });
  await form.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByTestId('transaction-detail')).toBeVisible();
  return txIdOf(page);
}

test.describe('Transacciones: formulario, registro, detalle e historial (transactions/*)', () => {
  test('[TC-TRANSACTIONS-SPLIT-001] [TC-TRANSACTIONS-EDIT-001] [TC-TRANSACTIONS-CLEARED-002] gasto dividido, edición del monto con reversa, confirmación individual y en lote, anulación de otro y saldos en pantalla', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'gastos');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '1000.00');
    const [c1, c2] = await userCategories(page, W, 'EXPENSE');

    // Gasto de 150,00 dividido en dos categorías en partes iguales (restante por asignar = 0).
    await go(page, `/transacciones/nueva?cuenta=${bank}`);
    const form = page.getByTestId('transaction-form');
    await expect(form.getByRole('radio', { name: 'Gasto', exact: true })).toBeChecked();
    await form.getByLabel('Monto (BOB)').fill('150,00');
    await form.getByLabel('Descripción').fill('Compra mixta');
    await form.getByLabel('Categoría de la parte 1').selectOption({ label: c1!.name });
    await form.getByRole('button', { name: 'Agregar parte' }).click();
    await form.getByLabel('Categoría de la parte 2').selectOption({ label: c2!.name });
    await form.getByLabel('Monto de la parte 1 (BOB)').fill('100');
    await form.getByLabel('Monto de la parte 2 (BOB)').fill('40');
    await expect(form.getByTestId('split-remaining')).toHaveText('Restante por asignar: 10,00 BOB');
    await form.getByRole('button', { name: 'Repartir en partes iguales' }).click();
    await expect(form.getByLabel('Monto de la parte 1 (BOB)')).toHaveValue('75.00');
    await expect(form.getByTestId('split-remaining')).toHaveText('Restante por asignar: 0 (cuadra).');
    await form.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText('Movimiento registrado.')).toBeVisible();
    const spent = txIdOf(page);
    await expect(page.getByTestId('tx-split-amount')).toHaveText(['75,00 BOB', '75,00 BOB']);
    await expect(page.getByTestId('detail-revision')).toHaveText('1');

    // Editar el monto a 120,00: reversa + nuevo asiento (revisión 2), visible en la línea de tiempo.
    await page.getByRole('button', { name: 'Editar' }).click();
    const edit = page.getByTestId('transaction-form');
    await edit.getByLabel('Monto (BOB)').fill('120,00');
    await edit.getByRole('button', { name: 'Repartir en partes iguales' }).click();
    await edit.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados: reversa y nuevo asiento (revisión 2).')).toBeVisible();
    await expect(page.getByTestId('detail-revision')).toHaveText('2');
    await expect(page.getByTestId('tx-split-amount')).toHaveText(['60,00 BOB', '60,00 BOB']);

    // Confirmar (cleared): no toca el ledger, solo el estado.
    await page.getByRole('button', { name: 'Marcar como confirmada' }).click();
    await expect(page.getByText('Transacción confirmada.')).toBeVisible();
    // El historial (diff de auditoría) vive en su pestaña; "Recorrido" lo cubre lifecycle.spec.ts.
    await page.getByRole('tab', { name: 'Historial de cambios' }).click();
    const entries = page.getByTestId('timeline-entry');
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(0)).toHaveAttribute('data-to', 'POSTED');
    await expect(entries.nth(0).getByTestId('timeline-transition')).toHaveText('— → Contabilizada');
    await expect(entries.nth(1).getByTestId('timeline-revision')).toContainText('Revisión contable 1 → 2');
    await expect(entries.nth(1).locator('tr[data-field="amount"]')).toHaveText(/150,00 BOB\s*120,00 BOB/);
    await expect(entries.nth(1).getByTestId('timeline-who')).toContainText('por ti');
    await expect(entries.nth(2).getByTestId('timeline-transition')).toHaveText('Contabilizada → Confirmada');

    // Anular otro gasto con motivo: reversa, estado terminal y motivo en el historial.
    const other = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('30.00'),
      description: 'Cargo repetido',
    });
    await go(page, `/transacciones/${String(other['id'])}`);
    await page.getByRole('button', { name: 'Anular' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Sí, anular' })).toBeDisabled();
    await dialog.getByLabel('Motivo').fill('Duplicado del banco');
    await dialog.getByRole('button', { name: 'Sí, anular' }).click();
    await expect(page.getByText('Transacción anulada.')).toBeVisible();
    await expect(page.getByTestId('tx-status').first()).toHaveText('Anulada');
    await page.getByRole('tab', { name: 'Historial de cambios' }).click();
    const last = page.getByTestId('timeline-entry').last();
    await expect(last).toHaveAttribute('data-from', 'POSTED');
    await expect(last).toHaveAttribute('data-to', 'VOIDED');
    await expect(last.getByTestId('timeline-reason')).toHaveText('Motivo: Duplicado del banco');

    // Lote: dos gastos marcados como confirmados en una sola operación (todo o nada).
    for (const [description, amount] of [
      ['Café', '10.00'],
      ['Taxi', '20.00'],
    ] as const) {
      await api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: todayLaPaz(),
        accountId: bank,
        amount: bob(amount),
        description,
      });
    }
    await go(page, '/transacciones');
    await page.getByLabel('Seleccionar «Café»').check();
    await page.getByLabel('Seleccionar «Taxi»').check();
    await page.getByRole('button', { name: 'Marcar como confirmadas (2)' }).click();
    await expect(page.getByText('2 transacciones marcadas como confirmadas.')).toBeVisible();
    for (const name of ['Café', 'Taxi', 'Compra mixta']) {
      await expect(
        page.getByTestId('transaction-row').filter({ hasText: name }).getByTestId('tx-status'),
      ).toHaveText('Confirmada');
    }
    await expect(
      page.getByTestId('transaction-row').filter({ hasText: 'Cargo repetido' }).getByTestId('tx-status'),
    ).toHaveText('Anulada');

    // Saldos en pantalla: 1000 − 120 − 10 − 20 = 850.00 (la anulada no cuenta).
    await go(page, '/cuentas');
    await expect(accountRow(page, 'Banco BOB').getByTestId('account-balance')).toHaveText('850,00 BOB');
    await go(page, `/transacciones/${spent}`);
    await expect(page.getByTestId('tx-amount')).toContainText('−120,00 BOB');

    // Móvil (360 px): registro y formulario sin scroll horizontal.
    await page.setViewportSize({ width: 360, height: 780 });
    await go(page, '/transacciones');
    await expect(page.getByTestId('transaction-row').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await go(page, '/transacciones/nueva');
    await expect(page.getByTestId('transaction-form')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await context.close();
  });

  test('[TC-TRANSACTIONS-QR-001] [TC-TRANSACTIONS-QR-002] [TC-TRANSACTIONS-PAYMETHOD-002] [TC-CLASSIFICATION-COUNTERPARTY-002] [TC-TRANSACTIONS-REFUND-001] pagos y cobros con QR, contrapartes en línea, reembolso, ajuste y duplicar como pendiente', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'qr');
    const bank = await openAccount(page, W, 'Bank A', 'BANK', 'BOB', '1000.00');
    const [health] = await userCategories(page, W, 'EXPENSE');
    const [freelance] = await userCategories(page, W, 'INCOME');

    // Compra pagada con QR a "Farmacia Demo" (creada en línea).
    const farmacia = await recordInUi(page, {
      accountId: bank,
      amount: '85,50',
      description: 'Farmacia Demo',
      paymentMethod: 'QR',
      newCounterparty: 'Farmacia Demo',
      category: health!.name,
    });
    await expect(page.getByTestId('detail-payment-method')).toHaveText('QR');
    await expect(page.getByTestId('detail-counterparty')).toHaveText('Farmacia Demo');
    await expect(page.getByTestId('tx-amount')).toContainText('−85,50 BOB');

    // Contraparte nueva en línea y gasto de 35.00 que la referencia.
    await recordInUi(page, { accountId: bank, amount: '35', newCounterparty: 'Panadería Don Pepe' });
    await expect(page.getByTestId('detail-counterparty')).toHaveText('Panadería Don Pepe');

    // "hipermaxi" cuando "Hipermaxi" ya existe (creada después de abrir el formulario): 409 NAME_TAKEN con
    // existingId y la UI selecciona la existente.
    await go(page, `/transacciones/nueva?cuenta=${bank}`);
    // Catálogos ya cargados (cuentas y contrapartes llegan juntos) antes de crear "Hipermaxi" por fuera.
    await expect(page.locator(`select[name="accountId"] option[value="${bank}"]`)).toBeAttached();
    const hipermaxi = await api(page, 'POST', `${W}/counterparties`, { name: 'Hipermaxi', kind: 'MERCHANT' });
    const form = page.getByTestId('transaction-form');
    await form.getByLabel('Contraparte').fill('hipermaxi');
    const nameTaken = page.waitForResponse(
      (r) => r.url().endsWith('/counterparties') && r.request().method() === 'POST',
    );
    await form.getByTestId('create-counterparty').click();
    expect((await nameTaken).status()).toBe(409);
    await expect(form.getByTestId('counterparty-status')).toHaveText(
      '«Hipermaxi» ya existía: se seleccionó la existente.',
    );
    await expect(form.getByLabel('Contraparte')).toHaveValue('Hipermaxi');
    const cps = await api(page, 'GET', `${W}/counterparties?q=Hipermaxi`);
    expect((cps['data'] as { id: string }[]).map((c) => c.id)).toEqual([String(hipermaxi['id'])]);

    // Cobro recibido por QR.
    await recordInUi(page, {
      kind: 'Ingreso',
      accountId: bank,
      amount: '300',
      description: 'Cobro Cliente Demo',
      paymentMethod: 'QR',
      newCounterparty: 'Cliente Demo',
      category: freelance!.name,
    });
    await expect(page.getByTestId('tx-amount')).toContainText('+300,00 BOB');
    await expect(page.getByTestId('detail-payment-method')).toHaveText('QR');

    // Sin medio de pago: se registra normalmente con el medio vacío.
    const plain = await recordInUi(page, { accountId: bank, amount: '20', description: 'Kiosco' });
    await expect(page.getByTestId('detail-payment-method')).toHaveText('—');

    // Reembolso parcial de la farmacia en su misma categoría (reduce el gasto; no es ingreso).
    await go(page, `/transacciones/nueva?cuenta=${bank}&tipo=REFUND`);
    const refund = page.getByTestId('transaction-form');
    await expect(refund.getByRole('radio', { name: 'Reembolso', exact: true })).toBeChecked();
    await refund.getByLabel('Monto (BOB)').fill('50');
    await expect(refund.locator(`option[value="${farmacia}"]`)).toBeAttached();
    await refund.getByLabel('Gasto que se reembolsa').selectOption(farmacia);
    await refund.getByLabel('Categoría de la parte 1').selectOption({ label: health!.name });
    await refund.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByTestId('tx-amount')).toContainText('+50,00 BOB');

    // Ajuste con motivo (sin splits).
    await go(page, `/transacciones/nueva?cuenta=${bank}&tipo=ADJUSTMENT`);
    const adj = page.getByTestId('transaction-form');
    await adj.getByLabel('Monto (BOB)').fill('12,50');
    await adj.getByLabel('Efecto en el saldo').selectOption('DECREASE');
    await adj.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(adj.getByText('El ajuste necesita un motivo.')).toBeVisible();
    await adj.getByLabel('Motivo del ajuste').fill('Diferencia de arqueo');
    await adj.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByTestId('transaction-detail')).toHaveAttribute('data-kind', 'ADJUSTMENT');

    // Filtro por medio de pago QR: solo la compra y el cobro.
    await go(page, '/transacciones');
    await page.getByLabel('Medio de pago').selectOption('QR');
    // La lista ya muestra el resultado de la consulta filtrada (no la carga inicial sin filtros).
    const register = page.getByTestId('transactions-register');
    await expect(register).toHaveAttribute('data-shown-query', /(^|&)paymentMethod=QR(&|$)/);
    await expect(register).toHaveAttribute('aria-busy', 'false');
    const rows = page.getByTestId('transaction-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.getByTestId('tx-payment-method')).toHaveText(['QR', 'QR']);

    // Saldo: 1000 − 85.50 − 35 + 300 − 20 + 50 − 12.50 = 1197.00; gasto del mes 85.50 + 35 + 20 − 50 = 90.50.
    await go(page, '/cuentas');
    await expect(accountRow(page, 'Bank A').getByTestId('account-balance')).toHaveText('1.197,00 BOB');
    await go(page, '/');
    await expect(page.getByTestId('income-amount')).toHaveText(/300,00\s*BOB/);
    await expect(page.getByTestId('expense-amount')).toHaveText(/90,50\s*BOB/);
    await expect(
      page.getByTestId('top-category').filter({ hasText: health!.name }).getByTestId('top-category-amount'),
    ).toHaveText('35,50 BOB');

    // Duplicar el gasto del kiosco como pendiente: aviso de posible duplicado no bloqueante; luego contabilizar.
    await go(page, `/transacciones/${plain}`);
    await page.getByRole('link', { name: 'Duplicar' }).click();
    const dup = page.getByTestId('transaction-form');
    await expect(page.getByText('Duplicando un movimiento')).toBeVisible();
    await expect(dup.getByLabel('Monto (BOB)')).toHaveValue('20.00');
    await expect(dup.getByTestId('duplicate-warning')).toBeVisible();
    await dup.getByLabel('Estado').selectOption('PENDING');
    await dup.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByTestId('duplicate-notice')).toBeVisible();
    await expect(page.getByTestId('tx-status').first()).toHaveText('Pendiente');
    await page.getByRole('button', { name: 'Contabilizar' }).click();
    await expect(page.getByText('Transacción contabilizada.')).toBeVisible();
    await expect(page.getByTestId('tx-status').first()).toHaveText('Contabilizada');
    await context.close();
  });

  test('[TC-TRANSACTIONS-HISTORY-002] un VIEWER ve la línea de tiempo de un gasto que un EDITOR editó de 120.00 a 102.00 BOB, sin acciones de edición', async ({
    browser,
  }) => {
    const editor = await newUserPage(browser, 'editor');
    const select = await bff(editor.page, 'PUT', '/api/bff/session', { body: { activeWorkspaceId: W1 } });
    expect(select.status).toBeLessThan(300);
    const W = `/workspaces/${W1}`;
    const suffix = randomUUID().slice(0, 8);
    const bank = await openAccount(editor.page, W, `Banco historial ${suffix}`, 'BANK', 'BOB', '1000.00');
    // Sin categoría: la Minimal Seed provisiona W1 como cualquier workspace ("Sin categoría" de sistema).
    const created = await api(editor.page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: todayLaPaz(),
      accountId: bank,
      amount: bob('120.00'),
      description: `Historial ${suffix}`,
    });
    const id = String(created['id']);
    await go(editor.page, `/transacciones/${id}`);
    await editor.page.getByRole('button', { name: 'Editar' }).click();
    await editor.page.getByTestId('transaction-form').getByLabel('Monto (BOB)').fill('102,00');
    await editor.page
      .getByTestId('transaction-form')
      .getByRole('button', { name: 'Guardar cambios' })
      .click();
    await expect(editor.page.getByTestId('detail-revision')).toHaveText('2');
    await editor.context.close();

    const viewer = await newUserPage(browser, 'viewer', `/transacciones/${id}`);
    const page = viewer.page;
    await expect(page.getByTestId('transaction-detail')).toBeVisible();
    await page.getByRole('tab', { name: 'Historial de cambios' }).click();
    const entries = page.getByTestId('timeline-entry');
    await expect(entries).toHaveCount(2);
    const edited = entries.nth(1);
    await expect(edited.locator('tr[data-field="amount"]')).toHaveText(/120,00 BOB\s*102,00 BOB/);
    await expect(edited.getByTestId('timeline-who')).toContainText('por el usuario …');
    await expect(edited.getByTestId('timeline-revision')).toContainText('Revisión contable 1 → 2');
    // Solo entradas de esta transacción (ninguna de otras entidades ni de otros workspaces).
    for (const action of await entries.evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-action') ?? ''),
    )) {
      expect(action.startsWith('transactions.transaction.')).toBe(true);
    }
    // VIEWER: sin acciones de edición ni de estado.
    await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Anular' })).toHaveCount(0);
    await viewer.context.close();
  });
});
