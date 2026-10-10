import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount } from '../src/finance.js';

/**
 * Importar un extracto CSV (openspec add-basic-csv-import 7.4; TC-IMPORTS-CSV-001, -006, -015, -016, -020, -021, -022,
 * -023, -026):
 *
 * - Se crea "Banco BOB" con 4 000,00 BOB y un gasto manual "Supermercado" de 245,30 del 02/10/2026. Desde el detalle de la
 *   cuenta se abre el asistente (cuenta preseleccionada) y se sube `extracto-octubre` (windows-1252, `;`, coma decimal).
 * - Mapeo explícito (fecha col. 1, descripción col. 2, monto con signo col. 3 "negativo es salida", dd/MM/yyyy, coma).
 * - Revisión: la fila del supermercado es un posible duplicado de ese gasto; "Aprobar" está bloqueado hasta omitirla.
 *   Saldo resultante: 4 000,00 − 245,30 − 36,00 + 8 000,00 = 11 718,70 BOB. Pantalla de revisión sin violaciones axe.
 * - Se aprueba, el worker crea 3 transacciones SIN categoría (café ×2 idénticos y sueldo) y el import queda COMPLETED.
 * - Se sube el mismo archivo otra vez: aviso de archivo ya importado, el mapeo viene precargado y las 4 filas figuran
 *   "ya importadas" (0 nuevas): no hay nada que aprobar y no se duplica nada (INV-014).
 */
const CSV = fileURLToPath(new URL('../../fixtures/imports/csv/extracto-octubre/input.csv', import.meta.url));

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

interface TransactionRow {
  id: string;
  kind: string;
  source: string;
  status: string;
  description: string | null;
  splits: { categoryId: string }[];
}

const transactionsOf = async (page: Page, W: string, account: string): Promise<TransactionRow[]> =>
  (await api(page, 'GET', `${W}/transactions?accountId=${account}&limit=100`))['data'] as TransactionRow[];

/** Elige las columnas del extracto de octubre y aplica el mapeo. */
async function fillMapping(page: Page): Promise<void> {
  await page.getByTestId('mapping-date').selectOption('0');
  await page.getByTestId('mapping-description').selectOption('1');
  await page.getByTestId('mapping-amount').selectOption('2');
  await page.getByTestId('mapping-sign').selectOption('NEGATIVE_IS_OUTFLOW');
  await page.getByTestId('mapping-date-format').selectOption('dd/MM/yyyy');
  await page.getByTestId('mapping-decimal').selectOption(',');
}

test.describe('Importar CSV (imports/import-pipeline)', () => {
  test('[TC-IMPORTS-CSV-001] [TC-IMPORTS-CSV-006] [TC-IMPORTS-CSV-015] [TC-IMPORTS-CSV-016] [TC-IMPORTS-CSV-020] [TC-IMPORTS-CSV-021] [TC-IMPORTS-CSV-022] [TC-IMPORTS-CSV-023] importar el extracto de octubre, omitir el posible duplicado, aprobar y reimportar sin duplicar', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'csv');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '4000.00');
    const manual = String(
      (
        await api(page, 'POST', `${W}/transactions`, {
          kind: 'EXPENSE',
          transactionDate: '2026-10-02',
          accountId: bank,
          amount: bob('245.30'),
          description: 'Supermercado',
        })
      )['id'],
    );

    const before = await transactionsOf(page, W, bank);

    // Paso 1 (Archivo): desde el detalle de la cuenta, con la cuenta preseleccionada.
    await go(page, `/cuentas/${bank}`);
    await page.getByTestId('import-csv').click();
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '1');
    await expect(page.getByTestId('import-steps').locator('[aria-current="step"]')).toContainText('Archivo');
    await expect(page.getByTestId('import-account')).toHaveValue(bank);
    await page.getByTestId('import-file').setInputFiles(CSV);
    await page.getByTestId('import-upload-submit').click();

    // Paso 2 (Columnas): codificación y separador detectados, muestra con tildes bien leídas y el foco en el paso.
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '2');
    await expect(page.getByTestId('import-detected')).toContainText(
      'Windows-1252, separador punto y coma, 3 columnas',
    );
    await expect(page.getByTestId('import-file-name')).toContainText('input.csv');
    await expect(page.getByTestId('mapping-sample')).toContainText('PAGO QR CAFÉ');
    await expect(page.getByTestId('import-step-heading')).toBeFocused();
    expect(await seriousViolations(page)).toEqual([]);

    // Sin elegir las columnas no hay vista previa: el formulario lista lo que falta.
    await page.getByTestId('mapping-apply').click();
    await expect(page.getByTestId('mapping-errors')).toContainText('Columna de la fecha: Es obligatorio.');
    await expect(page.getByTestId('mapping-errors')).toBeFocused();

    await fillMapping(page);
    await page.getByTestId('mapping-apply').click();

    // Paso 3 (Revisar): 3 nuevas y 1 posible duplicado del gasto manual; "Aprobar" bloqueado hasta decidir.
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '3');
    await expect(page.getByTestId('import-summary-counts')).toContainText(
      '4 filas · 3 nuevas · 0 ya importadas · 1 posibles duplicados · 0 con errores',
    );
    await expect(page.getByTestId('import-transfer-notice')).toContainText(
      'no deben importarse como gasto o ingreso',
    );
    const approve = page.getByTestId('import-approve');
    await expect(approve).toBeDisabled();
    await expect(page.getByTestId('import-approve-blocked')).toContainText(
      'Decide el posible duplicado pendiente para poder aprobar.',
    );
    await expect(page.getByTestId('import-pending')).toContainText('Falta decidir 1 posible duplicado.');

    const duplicateRow = page.locator('[data-testid="import-row"][data-classification="DUPLICATE_PROBABLE"]');
    await expect(duplicateRow).toHaveCount(1);
    await expect(duplicateRow).toContainText('COMPRA SUPERMERCADO');
    const candidate = page.getByTestId('import-candidate');
    await expect(candidate).toContainText('02/10/2026');
    await expect(candidate).toContainText('245,30 BOB');
    await expect(candidate).toContainText('gasto');
    await expect(candidate).toContainText('Supermercado');

    // Omitir ("es el mismo") con el teclado: el foco se queda en el botón y desbloquea la aprobación.
    const skip = duplicateRow.getByTestId('import-decide-SKIP');
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(skip).toHaveAttribute('aria-pressed', 'true');
    await expect(skip).toBeFocused();
    await expect(page.getByTestId('import-pending')).toContainText('No hay decisiones pendientes.');
    await expect(approve).toBeEnabled();
    await expect(page.getByTestId('totals-resulting')).toContainText('11.718,70 BOB');
    expect(await seriousViolations(page)).toEqual([]);

    // Resumen previo a la aprobación: sin categoría y con el saldo actual → resultante.
    await approve.click();
    const confirm = page.getByTestId('import-approve-confirm');
    await expect(confirm).toBeFocused();
    await expect(confirm).toContainText('Se crearán 3 transacciones.');
    await expect(confirm).toContainText('Salidas: 36,00 BOB. Entradas: 8.000,00 BOB.');
    await expect(confirm).toContainText('Saldo actual 3.754,70 BOB, saldo resultante 11.718,70 BOB.');
    await expect(confirm).toContainText('quedan sin categoría');
    await confirm.getByRole('button', { name: 'Aprobar e importar' }).click();

    // Paso 4 (Resultado): el worker crea las transacciones y el import termina COMPLETED.
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '4');
    await expect(page.getByTestId('import-result')).toHaveAttribute('data-status', 'COMPLETED', {
      timeout: 120_000,
    });
    await expect(page.getByTestId('import-done')).toContainText('se crearon 3 transacciones sin categoría');
    await expect(page.getByTestId('result-created')).toHaveText('3');
    await expect(page.getByTestId('result-skipped')).toHaveText('1');

    // Las 3 transacciones nuevas existen, son del import y están sin categoría (categorías de sistema).
    const categories = (await api(page, 'GET', `${W}/categories?limit=200`))['data'] as {
      id: string;
      systemCode: string | null;
    }[];
    const uncategorized = new Set(
      categories
        .filter((c) => c.systemCode === 'UNCATEGORIZED' || c.systemCode === 'UNCATEGORIZED_INCOME')
        .map((c) => c.id),
    );
    const afterFirst = await transactionsOf(page, W, bank);
    const imported = afterFirst.filter((t) => t.source === 'IMPORT');
    expect(afterFirst).toHaveLength(before.length + 3);
    expect(imported).toHaveLength(3);
    expect(imported.every((t) => t.splits.every((s) => uncategorized.has(s.categoryId)))).toBe(true);
    expect(afterFirst.find((t) => t.id === manual)?.source).not.toBe('IMPORT');
    const account = await api(page, 'GET', `${W}/accounts/${bank}`);
    expect(account['balance']).toEqual({ amount: '11718.70', currency: 'BOB' });

    // El enlace del resultado lleva a Transacciones con las 3 nuevas.
    await page.getByTestId('result-transactions-link').click();
    await expect(page.getByTestId('transaction-row').filter({ hasText: 'ABONO SUELDO' })).toHaveCount(1);
    await expect(page.getByTestId('transaction-row').filter({ hasText: 'PAGO QR CAFÉ' })).toHaveCount(2);

    // Reimportar el mismo archivo: aviso no bloqueante, mapeo precargado y las 4 filas ya importadas.
    await go(page, `/imports/nueva?cuenta=${bank}`);
    await page.getByTestId('import-file').setInputFiles(CSV);
    await page.getByTestId('import-upload-submit').click();
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '2');
    await expect(page.getByTestId('import-already-warning')).toContainText('ya se importó en esta cuenta');
    await expect(page.getByTestId('import-previous-link')).toBeVisible();
    await expect(page.getByTestId('mapping-date')).toHaveValue('0');
    await expect(page.getByTestId('mapping-date-format')).toHaveValue('dd/MM/yyyy');
    await expect(page.getByTestId('mapping-decimal')).toHaveValue(',');
    await page.getByTestId('mapping-apply').click();
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '3');
    await expect(page.getByTestId('import-summary-counts')).toContainText(
      '4 filas · 0 nuevas · 4 ya importadas · 0 posibles duplicados · 0 con errores',
    );
    await expect(
      page.locator('[data-testid="import-row"][data-classification="DUPLICATE_EXACT"]'),
    ).toHaveCount(4);
    // No hay nada que crear: no se puede aprobar. Se cancela la importación y no cambia nada.
    await expect(page.getByTestId('import-approve')).toBeDisabled();
    await page.getByTestId('import-cancel').click();
    await page
      .getByTestId('import-cancel-confirm')
      .getByRole('button', { name: 'Cancelar importación' })
      .click();
    await expect(page.getByTestId('import-cancelled')).toBeVisible();
    expect(await transactionsOf(page, W, bank)).toHaveLength(before.length + 3);

    // La lista de importaciones muestra ambas: la completada y la cancelada.
    await go(page, '/imports');
    await expect(page.getByTestId('import-item')).toHaveCount(2);
    await expect(page.locator('[data-testid="import-item"][data-status="COMPLETED"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="import-item"][data-status="CANCELLED"]')).toHaveCount(1);
    expect(await seriousViolations(page)).toEqual([]);
    await context.close();
  });

  test('[TC-IMPORTS-CSV-001] [TC-IMPORTS-CSV-003] [TC-IMPORTS-CSV-005] el archivo se valida antes de subir: vacío, extensión ajena y cuenta sin elegir', async ({
    browser,
  }) => {
    const { context, page, W } = await newFinanceUser(browser, 'csvval');
    await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '100.00');
    await go(page, '/imports/nueva');
    await page.getByTestId('import-upload-submit').click();
    const errors = page.getByTestId('field-error');
    await expect(errors).toHaveCount(2);
    await expect(errors.first()).toContainText('Elige la cuenta destino.');
    await page.getByTestId('import-account').selectOption({ label: 'Banco BOB (BOB)' });
    await page.getByTestId('import-file').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: Buffer.from('no es un csv'),
    });
    await page.getByTestId('import-upload-submit').click();
    await expect(page.getByTestId('field-error')).toContainText('El archivo debe ser .csv, .txt o .tsv.');
    expect(await seriousViolations(page)).toEqual([]);
    await context.close();
  });
});
