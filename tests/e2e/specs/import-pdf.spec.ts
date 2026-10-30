import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { renderPdf } from '../../../packages/contexts/imports/test/support/render-pdf.js';
import { paintStatement } from '../../fixtures/imports/statements-bo/pdf/paint-statement.js';
import { api, go, newFinanceUser } from '../src/finance.js';

/**
 * Importar un extracto PDF con texto (openspec add-pdf-statement-parser 7.4; TC-IMPORTS-PDF-048 y -049). Los PDF se
 * GENERAN por código con pdfkit desde los movimientos sintéticos (marca SINTETICO) y no se versionan.
 *
 * - «Banco BOB» con los últimos 4 dígitos «0001» y 2 640,00 BOB al 2026-01-01: el extracto de marzo de «Banco Pampa
 *   Demo» (2 páginas, 11 movimientos) llega a revisión con el diseño y su versión, las páginas leídas, los saldos del
 *   extracto y la diferencia de saldo inicial en cero; se aprueba y termina cuadrado con el saldo final del extracto.
 * - Un PDF de solo imágenes (escaneado) falla con la alternativa indicada, en es, en y pt.
 */
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

test.describe('Extractos PDF (imports/import-pipeline)', () => {
  test('[TC-IMPORTS-PDF-048] un extracto PDF coherente muestra el diseño, el saldo del extracto y la vista previa, y se importa', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const { context, page, W } = await newFinanceUser(browser, 'pdf');
    const account = String(
      (
        await api(page, 'POST', `${W}/accounts`, {
          name: 'Banco BOB',
          type: 'BANK',
          currency: 'BOB',
          accountNumberLast4: '0001',
          openingBalance: { amount: { amount: '2640.00', currency: 'BOB' }, date: '2026-01-01' },
        })
      )['id'],
    );
    const pdf = Buffer.from(await renderPdf(paintStatement('GANADERO')));

    await go(page, `/imports/nueva?cuenta=${account}`);
    await expect(page.getByTestId('import-doc-upload')).toBeVisible();
    await page.getByTestId('import-file').setInputFiles({
      name: 'extracto-marzo.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    await page.getByTestId('import-upload-submit').click();

    // El worker lee el PDF en el hilo aislado y la importación llega a la revisión.
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '3', { timeout: 120_000 });
    await expect(page.getByTestId('import-summary-counts')).toContainText('11 filas');
    await expect(page.getByTestId('import-pdf-layout')).toContainText('bo.ganadero.cuenta, versión 1');
    await expect(page.getByTestId('import-pdf-pages')).toContainText('Páginas leídas: 2 de 2.');
    await expect(page.getByTestId('import-pdf-coherence')).toContainText(
      'cuadran con los movimientos leídos',
    );
    await expect(page.getByTestId('statement-closing')).toContainText('12.050,66');
    // El saldo de la cuenta al 2026-02-28 es 2 640,00: la diferencia del saldo inicial es cero.
    await expect(page.getByTestId('import-pdf-opening')).toHaveAttribute('data-amount', '0.00');
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByTestId('import-approve').click();
    await page.getByRole('button', { name: 'Aprobar e importar' }).click();
    await expect(page.getByTestId('import-wizard')).toHaveAttribute('data-step', '4');
    await expect(page.getByTestId('import-result')).toHaveAttribute('data-status', 'COMPLETED', {
      timeout: 120_000,
    });
    await context.close();
  });

  test('[TC-IMPORTS-PDF-049] un PDF escaneado muestra el rechazo y la alternativa en es, en y pt', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { context, page, W } = await newFinanceUser(browser, 'pdf-scan');
    const account = String(
      (await api(page, 'POST', `${W}/accounts`, { name: 'Banco BOB', type: 'BANK', currency: 'BOB' }))['id'],
    );
    const scanned = Buffer.from(await renderPdf(paintStatement('GANADERO'), { imagePages: [1, 2] }));

    await go(page, `/imports/nueva?cuenta=${account}`);
    await page.getByTestId('import-file').setInputFiles({
      name: 'escaneado.pdf',
      mimeType: 'application/pdf',
      buffer: scanned,
    });
    await page.getByTestId('import-upload-submit').click();
    const failed = page.getByTestId('import-parse-failed');
    await expect(failed).toBeVisible({ timeout: 120_000 });
    await expect(failed).toContainText('Este PDF no tiene texto');
    await expect(failed).toContainText('Descarga el extracto digital');
    await expect(failed).toContainText('registra los movimientos a mano');
    await expect(page.getByTestId('import-pdf-pages-without-text')).toContainText('1, 2');
    expect(await seriousViolations(page)).toEqual([]);

    const imports = await api(page, 'GET', `${W}/imports?accountId=${account}&limit=5`);
    const importId = String((imports['data'] as { id: string }[])[0]?.id);
    await go(page, `/en/imports/${importId}`);
    await expect(page.getByTestId('import-parse-failed')).toContainText('This PDF has no text');
    await expect(page.getByTestId('import-parse-failed')).toContainText('Download the digital statement');
    await go(page, `/pt/imports/${importId}`);
    await expect(page.getByTestId('import-parse-failed')).toContainText('Este PDF não tem texto');
    await expect(page.getByTestId('import-parse-failed')).toContainText('Baixe o extrato digital');
    await context.close();
  });
});
