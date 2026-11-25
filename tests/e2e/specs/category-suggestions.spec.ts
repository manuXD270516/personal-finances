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
 * Sugerencias de categoría por historial por la UI (openspec add-category-suggestions 7.2; TC-CLASSIFICATION-AUTO-012,
 * -013 y -014). Datos SINTÉTICOS: el historial de TC-CLASSIFICATION-AUTO-001 (9 «PEDIDOSYA» en Restaurantes y 1 en
 * Supermercado, clasificados a mano).
 *
 * - Alta manual: al escribir «PEDIDOSYA *8812» el formulario muestra «Restaurantes» con confianza alta y su motivo SIN
 *   asignarla; la consulta es un POST con la descripción en el cuerpo (nunca en la URL); se acepta, se registra y el gasto
 *   queda en «Restaurantes» con origen manual; el resultado ACCEPTED queda en el informe del mes.
 * - Importación: la vista previa muestra la sugerencia por fila y «Aceptar sugerencias de confianza alta» las aplica
 *   en lote como edición manual; la fila sin historial no cambia.
 * Sin violaciones serias de axe ni desborde horizontal a 360 px.
 */
async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
}

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function categoryId(page: Page, W: string, name: string): Promise<string> {
  const r = await api(page, 'GET', `${W}/categories?kind=EXPENSE&limit=200`);
  const hit = (r['data'] as { id: string; name: string }[]).find((c) => c.name === name);
  expect(hit, `categoría ${name}`).toBeDefined();
  return hit!.id;
}

/** 9 «PEDIDOSYA» en Restaurantes y 1 en Supermercado, con fechas pasadas relativas a hoy. */
async function pedidosYa(page: Page, W: string, bank: string): Promise<{ rest: string; super: string }> {
  const rest = await categoryId(page, W, 'Restaurantes');
  const sup = await categoryId(page, W, 'Supermercado');
  const today = todayLaPaz();
  for (let i = 0; i < 10; i += 1) {
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: addDays(today, -(i + 1)),
      accountId: bank,
      amount: bob('30.00'),
      description: `PEDIDOSYA *88${i}`,
      splits: [{ amount: bob('30.00'), categoryId: i === 9 ? sup : rest }],
    });
  }
  return { rest, super: sup };
}

test.describe('Sugerencias de categoría (classification/auto-classification)', () => {
  test('[TC-CLASSIFICATION-AUTO-012] [TC-CLASSIFICATION-AUTO-013] escribir la descripción muestra la sugerencia sin asignarla; aceptarla y guardar deja el gasto en Restaurantes con origen manual', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page, W } = await newFinanceUser(browser, 'sugerida');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '4000.00');
    const cats = await pedidosYa(page, W, bank);

    await go(page, `/transacciones/nueva?cuenta=${bank}`);
    const form = page.getByTestId('transaction-form');
    await form.getByLabel('Monto (BOB)').fill('50,00');

    // La consulta es un POST y la descripción viaja en el cuerpo, nunca en la URL.
    const request = page.waitForRequest(
      (r) => r.url().includes('/category-suggestions/query') && r.method() === 'POST',
    );
    await form.getByLabel('Descripción').fill('PEDIDOSYA *8812');
    const sent = await request;
    expect(sent.url()).not.toMatch(/pedidosya/iu);
    expect(sent.postData() ?? '').toContain('PEDIDOSYA *8812');

    // La sugerencia aparece con su nivel y su motivo, sin asignar la categoría.
    const chip = form.getByTestId('category-suggestion');
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toHaveAttribute('data-level', 'HIGH');
    await expect(form.getByTestId('category-suggestion-label')).toContainText('Restaurantes');
    await expect(form.getByTestId('category-suggestion-label')).toContainText('confianza alta');
    await expect(form.getByTestId('category-suggestion-reason')).toContainText(
      'Elegiste "Restaurantes" en 9 de 10 gastos parecidos a "pedidosya"',
    );
    await expect(form.getByLabel('Categoría de la parte 1')).toHaveValue('');
    expect(await seriousViolations(page)).toEqual([]);

    // Aceptar: la categoría queda elegida en el formulario y se guarda con origen manual.
    await form.getByTestId('category-suggestion-accept').click();
    await expect(form.getByLabel('Categoría de la parte 1')).toHaveValue(cats.rest);
    await expect(form.getByTestId('category-suggestion-label')).toContainText(
      'Categoría sugerida aceptada: Restaurantes',
    );
    await form.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByTestId('transaction-detail')).toBeVisible();
    const list = await api(page, 'GET', `${W}/transactions?limit=5`);
    const saved = (
      list['data'] as { description: string; splits: { categoryId: string; categoryOrigin: string }[] }[]
    ).find((t) => t.description === 'PEDIDOSYA *8812');
    expect(saved?.splits[0]).toMatchObject({ categoryId: cats.rest, categoryOrigin: 'MANUAL' });

    // El resultado ACCEPTED con canal MANUAL_ENTRY queda en el informe del mes (reintentos mientras llega).
    const today = todayLaPaz();
    await expect
      .poll(
        async () => {
          const stats = await api(
            page,
            'GET',
            `${W}/category-suggestions/stats?from=${today.slice(0, 7)}-01&to=${today.slice(0, 7)}-28`,
          );
          return (stats['bySurface'] as { surface: string; accepted: number }[]).find(
            (s) => s.surface === 'MANUAL_ENTRY',
          )?.accepted;
        },
        { timeout: 20_000 },
      )
      .toBe(1);

    // La tarjeta de la vista de reglas muestra la tasa del mes.
    await go(page, '/reglas');
    await page.getByRole('tab', { name: 'Cobertura' }).click();
    await expect(page.getByTestId('acceptance-card')).toBeVisible();
    await expect(page.getByTestId('acceptance-summary')).toContainText('1 mostradas · 1 aceptadas');
    expect(await seriousViolations(page)).toEqual([]);

    await page.setViewportSize({ width: 360, height: 800 });
    await go(page, `/transacciones/nueva?cuenta=${bank}`);
    await page.getByTestId('transaction-form').getByLabel('Descripción').fill('PEDIDOSYA *9001');
    await expect(page.getByTestId('category-suggestion')).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    await context.close();
  });

  test('[TC-CLASSIFICATION-AUTO-014] la vista previa del import muestra la sugerencia por fila y «Aceptar sugerencias de confianza alta» las aplica en lote como edición manual', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const { context, page, W } = await newFinanceUser(browser, 'lote');
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '4000.00');
    const cats = await pedidosYa(page, W, bank);
    const today = todayLaPaz();
    const ofxDate = (iso: string) => iso.replaceAll('-', '');
    const tx = (date: string, amount: string, fitid: string, name: string) =>
      `<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>${ofxDate(date)}\n<TRNAMT>${amount}\n<FITID>${fitid}\n<NAME>${name}\n<MEMO>SINTETICO\n</STMTTRN>\n`;
    const ofx = [
      'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n',
      '<OFX>\n<BANKMSGSRSV1>\n<STMTTRNRS>\n<TRNUID>1\n<STMTRS>\n<CURDEF>BOB\n',
      `<BANKTRANLIST>\n<DTSTART>${ofxDate(addDays(today, -30))}\n<DTEND>${ofxDate(today)}\n`,
      tx(addDays(today, -25), '-71.00', 'SUG-0001', 'PEDIDOSYA 101'),
      tx(addDays(today, -24), '-72.00', 'SUG-0002', 'PEDIDOSYA 102'),
      tx(addDays(today, -23), '-73.00', 'SUG-0003', 'PEDIDOSYA 103'),
      tx(addDays(today, -22), '-74.00', 'SUG-0004', 'COMERCIO NUEVO SIN HISTORIAL'),
      '</BANKTRANLIST>\n</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>\n',
    ].join('');

    await go(page, `/imports/nueva?cuenta=${bank}`);
    await page.getByTestId('import-file').setInputFiles({
      name: 'extracto-sugerencias.ofx',
      mimeType: 'application/x-ofx',
      buffer: Buffer.from(ofx, 'latin1'),
    });
    await page.getByTestId('import-upload-submit').click();
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '3', { timeout: 120_000 });
    await expect(page.getByTestId('import-summary-counts')).toContainText('4 filas');

    // Tres filas con sugerencia de nivel alta y una sin historial.
    const suggestions = page.getByTestId('import-row-suggestion');
    await expect(suggestions).toHaveCount(3);
    await expect(suggestions.first()).toHaveAttribute('data-level', 'HIGH');
    await expect(suggestions.first()).toContainText('Sugerida: Restaurantes · confianza alta');
    await expect(page.getByTestId('import-row-suggestion-reason').first()).toContainText(
      'Elegiste "Restaurantes" en 9 de 10 gastos parecidos a "pedidosya"',
    );
    expect(await seriousViolations(page)).toEqual([]);

    // Filtro «Con sugerencia»: solo esas tres filas.
    await page.getByTestId('import-filter-HAS_SUGGESTION').click();
    await expect(page.getByTestId('import-row')).toHaveCount(3);
    await page.getByTestId('import-filter-HAS_SUGGESTION').click();
    await expect(page.getByTestId('import-row')).toHaveCount(4);

    // Aceptar en lote las de nivel alta: quedan con la categoría sugerida y origen manual; la otra no cambia.
    await page.getByTestId('accept-suggestions-high').click();
    await expect(page.getByTestId('import-notice')).toContainText('Se aceptaron 3 sugerencias de categoría.');
    await expect(page.getByTestId('import-row-suggestion')).toHaveCount(0);
    const imports = (await api(page, 'GET', `${W}/imports?limit=5`))['data'] as { id: string }[];
    const preview = await api(page, 'GET', `${W}/imports/${imports[0]!.id}/preview?limit=50`);
    const rows = preview['rows'] as { description: string; edits: { categoryId?: string } | null }[];
    expect(rows.filter((r) => r.description.startsWith('PEDIDOSYA'))).toHaveLength(3);
    expect(
      rows
        .filter((r) => r.description.startsWith('PEDIDOSYA'))
        .every((r) => r.edits?.categoryId === cats.rest),
    ).toBe(true);
    expect(rows.find((r) => r.description.startsWith('COMERCIO'))?.edits?.categoryId).toBeUndefined();

    await page.setViewportSize({ width: 360, height: 800 });
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
