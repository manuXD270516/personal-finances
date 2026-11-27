import { expect, test } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount } from '../src/finance.js';
import { importSyntheticCsv, loadAllPreviewRows, syntheticStatement } from '../src/import-fixture.js';
import { inpReport, installInpObserver, readInp, resetInp, type InpRow } from '../src/inp.js';

/**
 * Medición INFORMATIVA de INP (refine-data-tables, M-30; TC-PLATFORM-TABLES-017) con un extracto sintético de
 * 2 000 filas generado aquí (ningún dato real): abrir una fila de la vista previa (decidir un posible duplicado),
 * filtrar, aprobar y una edición masiva de transacciones. Adjunta el informe y lo imprime; NO falla por el valor.
 * `PF_INP_ROWS` cambia el tamaño del extracto (por omisión 2 000).
 */
const ROWS = Number(process.env['PF_INP_ROWS'] ?? 2000);

test('[TC-PLATFORM-TABLES-017] INP de abrir fila, filtrar, aprobar y edición masiva con 2 000 filas', async ({
  browser,
}, testInfo) => {
  test.setTimeout(Number(process.env['PF_INP_TIMEOUT'] ?? 900_000));
  const { page, W } = await newFinanceUser(browser, 'inp');
  await installInpObserver(page);
  const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '500000.00');
  const { rowAt } = syntheticStatement(ROWS);
  // Tres gastos manuales equivalentes a filas del extracto: posibles duplicados sobre los que decidir.
  for (const n of [5, 10, 15]) {
    const r = rowAt(n);
    const [d, m] = r.date.split('/');
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: `2026-${m}-${d}`,
      accountId: bank,
      amount: bob(r.amount.replace('-', '').replace(',', '.')),
      description: r.description,
    });
  }
  const started = Date.now();
  await importSyntheticCsv(page, bank, testInfo.outputPath('extracto-sintetico.csv'), ROWS);
  console.log(`[inp] importación hasta la vista previa: ${Math.round((Date.now() - started) / 1000)}s`);
  await loadAllPreviewRows(page);
  const rows: InpRow[] = [];
  const t0 = Date.now();
  const step = (name: string) => console.log(`[inp] ${name} +${Math.round((Date.now() - t0) / 1000)}s`);
  step('vista previa cargada, filas en el DOM: ' + String(await page.getByTestId('import-row').count()));
  const probable = page.locator('[data-testid="import-row"][data-classification="DUPLICATE_PROBABLE"]');

  // 1) Abrir una fila: decidir un posible duplicado (reescribe la tabla con todas las filas cargadas).
  await resetInp(page);
  await probable.first().getByRole('button').first().click();
  await expect(probable.first()).toHaveAttribute('data-decision', /.+/);
  rows.push({ flow: 'abrir fila (decidir)', ms: await readInp(page) });
  for (let i = 1; i < 3; i += 1) {
    await probable.nth(i).getByRole('button').first().click();
    await expect(probable.nth(i)).toHaveAttribute('data-decision', /.+/);
  }

  step('fila decidida');
  // 2) Filtrar: solo las filas nuevas.
  await resetInp(page);
  await page.getByTestId('import-filter-NEW').click();
  await expect(page.getByTestId('import-filter-NEW')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('import-row').first().waitFor();
  rows.push({ flow: 'filtrar', ms: await readInp(page) });

  step('filtrado');
  // 3) Aprobar (abrir el resumen y confirmar).
  await resetInp(page);
  await page.getByTestId('import-approve').click();
  await page.getByTestId('import-approve-confirm').waitFor();
  await page.getByTestId('import-approve-confirm').getByRole('button').last().click();
  rows.push({ flow: 'aprobar', ms: await readInp(page) });

  step('aprobado');
  // 4) Edición masiva de transacciones sobre todo lo filtrado.
  await expect
    .poll(
      async () =>
        ((await api(page, 'GET', `${W}/transactions?accountId=${bank}&limit=5`))['data'] as unknown[]).length,
      { timeout: 300_000 },
    )
    .toBeGreaterThan(3);
  await go(page, '/transacciones');
  await page.getByTestId('transaction-row').first().waitFor();
  await resetInp(page);
  await page.getByTestId('bulk-select-filtered').click();
  const panel = page.getByTestId('bulk-edit-panel');
  await panel.getByLabel('Categoría nueva').selectOption({ index: 1 });
  await panel.getByTestId('bulk-preview').click();
  await expect(panel.getByTestId('bulk-preview-result')).toBeVisible({ timeout: 120_000 });
  rows.push({ flow: 'edición masiva', ms: await readInp(page) });

  const report = inpReport(rows);
  console.log(report.text);
  await testInfo.attach('inp', {
    body: JSON.stringify(report.rows, null, 2),
    contentType: 'application/json',
  });
  expect(report.rows).toHaveLength(4);
});
