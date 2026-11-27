import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
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
import { importSyntheticCsv, loadAllPreviewRows } from '../src/import-fixture.js';

/**
 * Tablas de datos (change refine-data-tables, lote L5; TC-PLATFORM-TABLES-001..023): región con nombre y foco,
 * cabecera y columna fijas, impresión, semántica a 360 px, pista de desplazamiento, orden por columna, medidas y
 * detalle de préstamo sin desbordamiento. Capturas a 360 y 1280 px en `testInfo.outputPath`.
 */
async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

async function shots(page: Page, testInfo: TestInfo, name: string, locator?: Locator) {
  for (const [w, h] of [
    [360, 800],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await (locator ?? page).screenshot({ path: testInfo.outputPath(`${name}-${w}.png`) });
  }
}

const regionOf = (page: Page, testId: string) =>
  page.locator('.pf-table-wrap').filter({ has: page.getByTestId(testId) });

async function loan(page: Page, W: string, bank: string): Promise<string> {
  const created = await api(page, 'POST', `${W}/loans`, {
    name: 'Préstamo personal',
    principal: bob('12000.00'),
    annualRate: '0.12',
    dayCount: 'D30_360',
    frequency: 'MONTHLY',
    termInstallments: 36,
    method: 'FRENCH',
    disbursementDate: '2026-10-15',
    firstDueDate: '2026-11-15',
    account: { create: { name: 'Préstamo personal' } },
    disbursementAccountId: bank,
    paymentAccountId: bank,
    disburseNow: true,
  });
  return String(created['id']);
}

test.describe('Tablas de datos (platform/web-interface)', () => {
  test('[TC-PLATFORM-TABLES-001] [TC-PLATFORM-TABLES-007] [TC-PLATFORM-TABLES-008] [TC-PLATFORM-TABLES-009] [TC-PLATFORM-TABLES-010] [TC-PLATFORM-TABLES-023] cronograma de 36 cuotas a 360 px: región con foco, pista de desplazamiento, semántica, impresión y detalle sin desbordamiento', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    const { page, W } = await newFinanceUser(browser, 'tablas');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const id = await loan(page, W, bank);
    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, `/debts/${id}`);

    // 023: la página no se desplaza a lo ancho y los saldos se leen completos.
    await expectNoHorizontalScroll(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const t of [
      'loan-outstanding-principal',
      'loan-account-balance',
      'loan-unreconciled',
      'loan-paid-totals',
    ]) {
      const box = await page.getByTestId(t).boundingBox();
      expect(box, t).not.toBeNull();
      expect(box!.x + box!.width, t).toBeLessThanOrEqual(360);
    }
    await page.screenshot({ path: testInfo.outputPath('loan-detail-360.png'), fullPage: true });

    // 001: la región tiene nombre y recibe el foco con Tab; la flecha derecha la desplaza.
    const region = regionOf(page, 'installments-table');
    await expect(region).toHaveAttribute('role', 'region');
    await expect(region).toHaveAttribute('aria-label', /.+/);
    await expect(region).toHaveAttribute('tabindex', '0');
    let focused = false;
    for (let i = 0; i < 120 && !focused; i += 1) {
      await page.keyboard.press('Tab');
      focused = await region.evaluate((el) => document.activeElement === el);
    }
    expect(focused).toBe(true);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await region.evaluate((el) => (el.scrollLeft = 0));

    // 008: tabla con encabezados y filas; solo la región se desplaza a lo ancho.
    const table = page.getByTestId('installments-table');
    expect(await table.getByRole('columnheader').count()).toBeGreaterThan(3);
    expect(await table.getByRole('row').count()).toBeGreaterThan(36);
    expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    // 009 y 010: pista al inicio (máscara con la banda final) y sin ella en la última columna.
    const supported = await page.evaluate(() => CSS.supports('animation-timeline', 'scroll()'));
    if (supported) {
      expect(await region.evaluate((el) => getComputedStyle(el).maskImage)).not.toBe('none');
      await expect
        .poll(() => region.evaluate((el) => getComputedStyle(el).getPropertyValue('--pf-fade-end').trim()))
        .not.toBe('0px');
      await region.evaluate((el) => (el.scrollLeft = el.scrollWidth));
      await expect
        .poll(() => region.evaluate((el) => getComputedStyle(el).getPropertyValue('--pf-fade-end').trim()))
        .toBe('0px');
      await region.evaluate((el) => (el.scrollLeft = 0));
    }
    await region.screenshot({ path: testInfo.outputPath('schedule-hint-360.png') });

    // 007: al imprimir, sin alto máximo ni desplazamiento propio, con la fila de encabezados repetible.
    await page.emulateMedia({ media: 'print' });
    expect(await region.evaluate((el) => getComputedStyle(el).maxBlockSize)).toBe('none');
    expect(await region.evaluate((el) => getComputedStyle(el).overflowY)).toBe('visible');
    expect(await table.locator('thead').evaluate((el) => getComputedStyle(el).display)).toBe(
      'table-header-group',
    );
    expect(await page.getByTestId('installment-row').count()).toBe(36);
    const pdf = await page.pdf({ format: 'A4' });
    expect(pdf.byteLength).toBeGreaterThan(1000);
    await page.emulateMedia({ media: 'screen' });
    await shots(page, testInfo, 'loan-schedule', region);
  });

  test('[TC-PLATFORM-TABLES-003] [TC-PLATFORM-TABLES-005] axe a 360 px en Transacciones, el cronograma y la lista de préstamos; tabla corta sin desplazamiento vertical propio', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { page, W } = await newFinanceUser(browser, 'tablasaxe');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const id = await loan(page, W, bank);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of ['/transacciones', `/debts/${id}`, '/debts']) {
      await go(page, path);
      expect(await seriousViolations(page), path).toEqual([]);
    }
    // 005: la lista de préstamos es una tabla corta: sin alto máximo ni desplazamiento vertical.
    const short = regionOf(page, 'loans-table');
    expect(await short.evaluate((el) => getComputedStyle(el).maxBlockSize)).toBe('none');
    expect(await short.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  });

  test('[TC-PLATFORM-TABLES-003] [TC-PLATFORM-TABLES-004] [TC-PLATFORM-TABLES-006] vista previa de 200 filas: cabecera fija alineada y opaca, columna Fecha fija como encabezado de fila, axe a 360 px', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(300_000);
    const { page, W } = await newFinanceUser(browser, 'tablasprev');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '50000.00');
    await importSyntheticCsv(page, bank, testInfo.outputPath('extracto-200.csv'), 200);
    await loadAllPreviewRows(page);
    await expect(page.getByTestId('import-row')).toHaveCount(200);
    const region = regionOf(page, 'import-preview');
    await expect(region).toHaveClass(/pf-table-wrap--tall/);

    // 004: con la fila 150 a la vista, los encabezados siguen arriba, alineados y con fondo opaco.
    await page.setViewportSize({ width: 1280, height: 800 });
    await region.scrollIntoViewIfNeeded();
    await page.locator('[data-testid="import-row"][data-line="150"]').scrollIntoViewIfNeeded();
    const geometry = await region.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const ths = [...el.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect());
      const cells = [...(el.querySelector('tbody tr')?.children ?? [])].map((c) => c.getBoundingClientRect());
      const bg = getComputedStyle(el.querySelector('thead th')!).backgroundColor;
      return {
        top: r.top,
        thTop: ths[0]!.top,
        aligned: ths.every((t, i) => Math.abs(t.left - cells[i]!.left) < 2),
        bg,
        scrolled: el.scrollTop,
      };
    });
    expect(geometry.scrolled).toBeGreaterThan(0);
    expect(Math.abs(geometry.thTop - geometry.top)).toBeLessThan(4);
    expect(geometry.aligned).toBe(true);
    expect(geometry.bg).toMatch(/^rgb\(/); // sin canal alfa: opaco
    await shots(page, testInfo, 'import-preview-header', region);

    // 006: la columna Fecha es el encabezado de la fila y queda fija al desplazar a lo ancho a 360 px.
    await page.setViewportSize({ width: 360, height: 800 });
    const firstRowHeader = page.getByTestId('import-row').first().locator('th[scope="row"]');
    await expect(firstRowHeader).toContainText(/\d{2}\/\d{2}\/\d{4}/);
    await region.evaluate((el) => {
      el.scrollTop = 0;
      el.scrollLeft = el.scrollWidth;
    });
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const left = await firstRowHeader.evaluate((th) => th.getBoundingClientRect().left);
    const regionLeft = await region.evaluate((el) => el.getBoundingClientRect().left);
    expect(Math.abs(left - regionLeft)).toBeLessThan(4);

    // 003: sin violaciones serias en la vista previa a 360 px.
    expect(await seriousViolations(page)).toEqual([]);
  });

  test('[TC-PLATFORM-TABLES-011] [TC-PLATFORM-TABLES-012] [TC-PLATFORM-TABLES-013] orden del reporte de gastos por categoría por Monto (valor, aria-sort, anuncio único) y con teclado en Categoría', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { page, W } = await newFinanceUser(browser, 'tablasorden');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '50000.00');
    const cats = await userCategories(page, W, 'EXPENSE');
    const amounts = ['1234.56', '999.00', '45.30'];
    const today = todayLaPaz();
    for (const [i, amount] of amounts.entries()) {
      await api(page, 'POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: today,
        accountId: bank,
        amount: bob(amount),
        splits: [{ amount: bob(amount), categoryId: cats[i]!.id }],
      });
    }
    const monthStart = `${today.slice(0, 8)}01`;
    await go(page, `/reportes/gastos-por-categoria?from=${monthStart}&to=${today}&grouping=CALENDAR_MONTH`);
    const view = page.getByTestId('report-by-category');
    await expect(view.getByTestId('cat-row')).toHaveCount(3);
    const names = () =>
      view
        .getByTestId('cat-row')
        .evaluateAll((rows) => rows.map((r) => r.querySelector('td')?.textContent ?? ''));

    // 011-012: Monto de mayor a menor, solo ese th declara aria-sort y el anuncio es único.
    await view.getByRole('button', { name: 'Monto' }).click();
    const order = await names();
    expect(order[0]).toContain(cats[0]!.name);
    expect(order[1]).toContain(cats[1]!.name);
    expect(order[2]).toContain(cats[2]!.name);
    await expect(view.locator('th[aria-sort]')).toHaveCount(1);
    await expect(view.locator('th[aria-sort="descending"]')).toContainText('Monto');
    await expect(page.getByTestId('sort-status')).toHaveText('Ordenado por Monto, de mayor a menor');
    await expect(page.getByRole('status').filter({ hasText: 'Ordenado por' })).toHaveCount(1);

    // 013: con el teclado, Tab hasta el botón Categoría y Enter; el foco sigue en el botón.
    const button = view.getByRole('button', { name: 'Categoría' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(view.locator('th[aria-sort="ascending"]')).toContainText('Categoría');
    await expect(button).toBeFocused();
  });
});
