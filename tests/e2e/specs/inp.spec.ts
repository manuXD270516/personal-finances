import { expect, test, type Browser, type TestInfo } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount } from '../src/finance.js';
import { importSyntheticCsv, loadAllPreviewRows, syntheticStatement } from '../src/import-fixture.js';
import { inpReport, installInpObserver, readInp, resetInp, SLOW_CPU_RATE, type InpRow } from '../src/inp.js';

/**
 * Medición INFORMATIVA de INP (refine-data-tables, M-30; TC-PLATFORM-TABLES-017) con un extracto sintético de
 * 2 000 filas generado aquí (ningún dato real): abrir una fila de la vista previa (decidir un posible duplicado),
 * filtrar, aprobar y una edición masiva de transacciones. Adjunta el informe y lo imprime; NO falla por el valor.
 * `PF_INP_ROWS` cambia el tamaño del extracto (por omisión 2 000).
 *
 * Change refine-perceived-performance (TC-PLATFORM-PERCEIVED-004, -005 y -022): los flujos se miden con las
 * transiciones activas (`reducedMotion: 'no-preference'`) y se repiten con el procesador ralentizado ×4
 * (`Emulation.setCPUThrottlingRate`, solo Chromium) en un segundo usuario; el informe muestra las dos columnas. La
 * mediana de tres corridas locales decide qué vistas conservan la transición (`VIEW_TRANSITION_EXCLUDED`). `PF_INP_SLOW=0`
 * omite la segunda pasada.
 */
const ROWS = Number(process.env['PF_INP_ROWS'] ?? 2000);
const SLOW = process.env['PF_INP_SLOW'] !== '0';

/** Un usuario nuevo, un extracto de ROWS filas y los cuatro flujos; con `cpuSlowdown` la CPU va ralentizada en los flujos. */
async function measureFlows(
  browser: Browser,
  testInfo: TestInfo,
  label: string,
  cpuSlowdown?: number,
): Promise<InpRow[]> {
  const { page, W } = await newFinanceUser(browser, 'inp');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
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
  await importSyntheticCsv(page, bank, testInfo.outputPath(`extracto-sintetico-${label}.csv`), ROWS);
  console.log(
    `[inp:${label}] importación hasta la vista previa: ${Math.round((Date.now() - started) / 1000)}s`,
  );
  await loadAllPreviewRows(page);
  const rows: InpRow[] = [];
  const t0 = Date.now();
  const step = (name: string) =>
    console.log(`[inp:${label}] ${name} +${Math.round((Date.now() - t0) / 1000)}s`);
  step('vista previa cargada, filas en el DOM: ' + String(await page.getByTestId('import-row').count()));
  const probable = page.locator('[data-testid="import-row"][data-classification="DUPLICATE_PROBABLE"]');

  const cdp = cpuSlowdown ? await page.context().newCDPSession(page) : undefined;
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown! });
  try {
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
  } finally {
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }

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
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown! });
  try {
    await resetInp(page);
    await page.getByTestId('bulk-select-filtered').click();
    const panel = page.getByTestId('bulk-edit-panel');
    await panel.getByLabel('Categoría nueva').selectOption({ index: 1 });
    await panel.getByTestId('bulk-preview').click();
    await expect(panel.getByTestId('bulk-preview-result')).toBeVisible({ timeout: 120_000 });
    rows.push({ flow: 'edición masiva', ms: await readInp(page) });
  } finally {
    await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  await page.context().close();
  return rows;
}

test('[TC-PLATFORM-TABLES-017] [TC-PLATFORM-PERCEIVED-004] [TC-PLATFORM-PERCEIVED-005] [TC-PLATFORM-PERCEIVED-022] INP de abrir fila, filtrar, aprobar y edición masiva con 2 000 filas, con transiciones y con la CPU ×4', async ({
  browser,
}, testInfo) => {
  test.setTimeout(Number(process.env['PF_INP_TIMEOUT'] ?? 1_800_000));
  const desktop = await measureFlows(browser, testInfo, 'escritorio');
  const slow = SLOW ? await measureFlows(browser, testInfo, `cpu-x${SLOW_CPU_RATE}`, SLOW_CPU_RATE) : [];
  const report = inpReport(
    desktop.map((row, i) => ({ ...row, ...(slow[i] ? { slowMs: slow[i]!.ms } : {}) })),
  );
  console.log(report.text);
  await testInfo.attach('inp', {
    body: JSON.stringify(report.rows, null, 2),
    contentType: 'application/json',
  });
  expect(report.rows).toHaveLength(4);
});
