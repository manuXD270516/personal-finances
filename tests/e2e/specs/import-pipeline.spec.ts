import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';

/**
 * Importar un extracto OFX como documento (openspec add-import-pipeline 8.6; TC-IMPORTS-PIPELINE-002, -004, -007, -044,
 * -048, -057, -059, -062). Datos SINTÉTICOS: el OFX se arma en la prueba con fechas relativas a hoy (La Paz).
 *
 * - "Banco BOB" con 4 000,00 BOB, "Caja BOB" y un gasto manual "COMPRA SUPERMERCADO" de 245,30 (hace 5 días) con la
 *   contraparte "Supermercado Demo" (alias «COMPRA SUPERMERCADO»); un compromiso «Internet» de 199,00 que vence hoy.
 * - Se sube el OFX como documento (propósito «extracto para importar»): la importación pasa por subida, procesando con
 *   su etapa y llega a revisión. La fila del supermercado es un posible duplicado con puntaje; si el sistema la
 *   preseleccionó (confianza alta) cuenta como decisión y, si no, se omite a mano.
 * - «PAGO TARJETA» de 400,00 se marca como transferencia a «Caja BOB»; «TIGO INTERNET» de 199,00 confirma su coincidencia
 *   con el compromiso; se aprueba y, con el saldo final del OFX igual al saldo contable, la importación ofrece la
 *   reconciliación.
 * - Se deshace (vista previa: 3 transacciones a anular) y se vuelve a importar el mismo archivo: las 4 filas dejan de ser
 *   «ya importadas» para las anuladas.
 */
const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const ofxDate = (iso: string): string => iso.replaceAll('-', '');

function statement(today: string, closing: string): string {
  const tx = (date: string, amount: string, fitid: string, name: string) =>
    `<STMTTRN>\n<TRNTYPE>${amount.startsWith('-') ? 'DEBIT' : 'CREDIT'}\n<DTPOSTED>${ofxDate(date)}\n<TRNAMT>${amount}\n<FITID>${fitid}\n<NAME>${name}\n<MEMO>SINTETICO\n</STMTTRN>\n`;
  return [
    'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n',
    '<OFX>\n<BANKMSGSRSV1>\n<STMTTRNRS>\n<TRNUID>1\n<STMTRS>\n<CURDEF>BOB\n',
    '<BANKACCTFROM>\n<BANKID>SINTETICO\n<ACCTID>000-SINTETICO\n<ACCTTYPE>CHECKING\n</BANKACCTFROM>\n',
    `<BANKTRANLIST>\n<DTSTART>${ofxDate(addDays(today, -5))}\n<DTEND>${ofxDate(today)}\n`,
    tx(addDays(today, -5), '-245.30', 'E2E-0001', 'COMPRA SUPERMERCADO'),
    tx(addDays(today, -4), '-400.00', 'E2E-0002', 'PAGO TARJETA'),
    tx(today, '-199.00', 'E2E-0003', 'TIGO INTERNET'),
    tx(addDays(today, -3), '8000.00', 'E2E-0004', 'ABONO SUELDO'),
    `</BANKTRANLIST>\n<LEDGERBAL>\n<BALAMT>${closing}\n<DTASOF>${ofxDate(today)}\n</LEDGERBAL>\n`,
    '</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>\n',
  ].join('');
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

test.describe('Pipeline de importación (imports/import-pipeline)', () => {
  test('[TC-IMPORTS-PIPELINE-002] [TC-IMPORTS-PIPELINE-004] [TC-IMPORTS-PIPELINE-007] [TC-IMPORTS-PIPELINE-044] [TC-IMPORTS-PIPELINE-048] [TC-IMPORTS-PIPELINE-057] [TC-IMPORTS-PIPELINE-059] [TC-IMPORTS-PIPELINE-062] importar un OFX como documento, resolver el duplicado, marcar la transferencia, confirmar la coincidencia, aprobar, ver la reconciliación, deshacer y reimportar', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const { context, page, W } = await newFinanceUser(browser, 'pipeline');
    const today = todayLaPaz();
    const bank = await openAccount(page, W, 'Banco BOB', 'BANK', 'BOB', '4000.00');
    await openAccount(page, W, 'Caja BOB', 'CASH', 'BOB', '0.00');

    const counterparty = String(
      (
        await api(page, 'POST', `${W}/counterparties`, {
          name: 'Supermercado Demo',
          kind: 'MERCHANT',
          aliases: ['COMPRA SUPERMERCADO'],
        })
      )['id'],
    );
    await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: addDays(today, -5),
      accountId: bank,
      amount: bob('245.30'),
      description: 'COMPRA SUPERMERCADO',
      counterpartyId: counterparty,
    });
    await api(page, 'POST', `${W}/recurring`, {
      name: 'Internet',
      kind: 'EXPENSE',
      template: {
        accountId: bank,
        amount: { type: 'FIXED', amount: bob('199.00') },
        schedule: { cadence: 'MONTHLY', startDate: today },
        materialization: { mode: 'PENDING_APPROVAL' },
      },
    });

    // 4 000,00 − 245,30 (manual) − 400,00 − 199,00 + 8 000,00 = 11 155,70 BOB al terminar.
    const ofx = statement(today, '11155.70');

    // Paso 1: subir el OFX como documento.
    await go(page, `/imports/nueva?cuenta=${bank}`);
    await expect(page.getByTestId('import-doc-upload')).toBeVisible();
    await expect(page.getByTestId('import-legacy-note')).toBeAttached();
    await page.getByTestId('import-file').setInputFiles({
      name: 'extracto-pipeline.ofx',
      mimeType: 'application/x-ofx',
      buffer: Buffer.from(ofx, 'latin1'),
    });
    await page.getByTestId('import-upload-submit').click();

    // Procesando en el worker (o ya en revisión si fue muy rápido): llega al paso 3 con sus filas.
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '3', { timeout: 120_000 });
    await expect(page.getByTestId('import-summary-counts')).toContainText('4 filas');

    // El posible duplicado muestra el puntaje y sus señales; vinculado de entrada si es de confianza alta.
    const duplicate = page.locator('[data-testid="import-row"][data-classification="DUPLICATE_PROBABLE"]');
    await expect(duplicate).toHaveCount(1);
    const detail = page.locator('[data-testid="import-row-detail"]').filter({ hasText: 'Puntaje' });
    await expect(detail.getByTestId('candidate-score')).toContainText(/Puntaje 0\.\d{4}/);
    await expect(detail.getByTestId('candidate-signals')).toContainText('monto');
    if ((await page.getByTestId('row-preselected-note').count()) === 0) {
      await duplicate.getByTestId('import-decide-SKIP').click();
    }
    await expect(duplicate).toHaveAttribute('data-decision', 'SKIP');

    // «PAGO TARJETA» como transferencia a «Caja BOB».
    const cardRow = page.locator('[data-testid="import-row"]').filter({ hasText: 'PAGO TARJETA' });
    await cardRow.locator('xpath=following-sibling::tr[1]').getByTestId('row-edit-toggle').click();
    await page.getByTestId('editor-kind').selectOption('TRANSFER');
    await page.getByTestId('editor-counter-account').selectOption({ label: 'Caja BOB (BOB)' });
    await page.getByTestId('editor-save-movement').click();
    await expect(page.getByTestId('row-kind').filter({ hasText: 'Transferencia' })).toBeVisible();

    // «TIGO INTERNET»: la coincidencia con el compromiso se confirma a mano; sin eso no se vincula.
    const internetDetail = page
      .locator('[data-testid="import-row-detail"]')
      .filter({ has: page.getByTestId('row-occurrences') });
    await expect(internetDetail).toHaveCount(1);
    await internetDetail.getByTestId('occurrence-confirm').click();
    await expect(internetDetail.getByTestId('row-occurrence')).toHaveAttribute('data-confirmed', 'true');

    // Saldo del extracto: el OFX trae 11 155,70 y el saldo resultante coincide.
    await expect(page.getByTestId('statement-closing')).toContainText('11.155,70');
    await expect(page.getByTestId('statement-difference')).toHaveAttribute('data-zero', 'true');
    expect(await seriousViolations(page)).toEqual([]);

    // Aprobar.
    await page.getByTestId('import-approve').click();
    await page.getByRole('button', { name: 'Aprobar e importar' }).click();
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '4');
    await expect(page.getByTestId('import-result')).toHaveAttribute('data-status', 'COMPLETED', {
      timeout: 120_000,
    });

    // La importación cuadra con el extracto: ofrece la reconciliación con la fecha y el saldo del OFX.
    await expect(page.getByTestId('import-reconcile-offer')).toContainText('11.155,70');
    await expect(page.getByTestId('import-reconcile-link')).toHaveAttribute(
      'href',
      /reconciliar\?fecha=.*&saldo=11155\.70/,
    );
    expect(await seriousViolations(page)).toEqual([]);

    // Deshacer: la vista previa anuncia 3 transacciones a anular (la fila omitida no creó ninguna).
    await page.getByTestId('revert-open').click();
    await expect(page.getByTestId('revert-counts')).toContainText('Se anularán 3 transacciones');
    await page.getByTestId('revert-all').click();
    await page.getByTestId('revert-confirm').getByRole('button', { name: 'Deshacer' }).click();
    await expect(page.getByTestId('import-rolled-back')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('import-rolled-back')).toContainText('Importación deshecha');

    // El saldo vuelve a 4 000,00 − 245,30 = 3 754,70 BOB.
    const account = await api(page, 'GET', `${W}/accounts/${bank}`);
    expect(JSON.stringify(account)).toContain('3754.70');

    // Reimportar el mismo archivo: las 3 anuladas vuelven a ser nuevas.
    await go(page, `/imports/nueva?cuenta=${bank}`);
    await page.getByTestId('import-file').setInputFiles({
      name: 'extracto-pipeline.ofx',
      mimeType: 'application/x-ofx',
      buffer: Buffer.from(ofx, 'latin1'),
    });
    await page.getByTestId('import-upload-submit').click();
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '3', { timeout: 120_000 });
    await expect(page.locator('[data-testid="import-row"][data-classification="NEW"]')).toHaveCount(3);
    await context.close();
  });

  test('[TC-IMPORTS-PIPELINE-065] la página de perfiles de mapeo carga sin violaciones graves de accesibilidad', async ({
    browser,
  }) => {
    const { context, page } = await newFinanceUser(browser, 'perfiles');
    await go(page, '/imports/perfiles');
    await expect(page.getByTestId('import-profiles')).toBeVisible();
    await expect(page.getByTestId('profiles-empty')).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await context.close();
  });
});
