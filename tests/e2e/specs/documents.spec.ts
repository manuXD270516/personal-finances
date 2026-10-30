import { AxeBuilder } from '@axe-core/playwright';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { api, bob, go, newFinanceUser, openAccount, todayLaPaz } from '../src/finance.js';

/**
 * Adjuntos de documentos (openspec add-document-attachments 7.4; TC-DOCUMENTS-ATTACH-022): el EDITOR adjunta un
 * comprobante desde el detalle de un gasto (SHA-256 en el navegador, subida directa a la cuarentena con progreso,
 * verificación y vínculo), lo descarga por la API con los mismos bytes, y un PNG renombrado «factura.pdf» se rechaza con
 * el motivo traducido y no se adjunta. La página /documentos lista los documentos y el uso de la cuota sin violaciones
 * graves de accesibilidad.
 */
const pdf = (label: string): Buffer => {
  const content = deflateSync(Buffer.from(`BT /F1 12 Tf 20 100 Td (${label}) Tj ET`));
  return Buffer.concat([
    Buffer.from(
      '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n',
      'latin1',
    ),
    Buffer.from(`4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    content,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
};

const png = (): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    Buffer.from([0, 0, 0, 10, 0, 0, 0, 10, 8, 2, 0, 0, 0]),
    Buffer.alloc(4),
    Buffer.alloc(4),
    Buffer.from('IEND'),
    Buffer.alloc(4),
  ]);

test.describe('Adjuntos de documentos (documents/attachments)', () => {
  test('[TC-DOCUMENTS-ATTACH-022] adjuntar un comprobante a un gasto, descargarlo y ver rechazado un PNG renombrado', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { context, page, W } = await newFinanceUser(browser, 'adjuntos');
    const caja = await openAccount(page, W, 'Caja adjuntos', 'CASH', 'BOB', '500.00');
    const expense = await api(page, 'POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: todayLaPaz(),
      accountId: caja,
      amount: bob('150.00'),
      description: 'Supermercado',
    });
    const transactionId = String(expense['id']);

    await go(page, `/transacciones/${transactionId}`);
    const section = page.getByTestId('attachments');
    await expect(section).toBeVisible();
    await expect(section.getByTestId('attachments-empty')).toBeVisible();

    // Adjunta el comprobante: el detalle lo muestra con su nombre y tamaño y un botón de descarga.
    const content = pdf('Ticket supermercado 150.00');
    await section.getByTestId('attachment-file').setInputFiles({
      name: 'ticket-supermercado.pdf',
      mimeType: 'application/pdf',
      buffer: content,
    });
    const item = section.getByTestId('attachment-item');
    await expect(item).toHaveCount(1, { timeout: 60_000 });
    await expect(item).toContainText('ticket-supermercado.pdf');
    await expect(item.getByTestId('attachment-download')).toBeVisible();

    // La descarga entrega los mismos bytes.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      item.getByTestId('attachment-download').click(),
    ]);
    const path = await download.path();
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path).equals(content)).toBe(true);
    expect(download.suggestedFilename()).toBe('ticket-supermercado.pdf');

    // Un PNG renombrado «factura.pdf» se rechaza por su contenido y no se adjunta.
    await section.getByTestId('attachment-file').setInputFiles({
      name: 'factura.pdf',
      mimeType: 'application/pdf',
      buffer: png(),
    });
    await expect(section.getByTestId('attachment-rejected')).toContainText('factura.pdf', {
      timeout: 60_000,
    });
    await expect(section.getByTestId('attachment-rejected')).toContainText('no coincide con su tipo');
    await expect(section.getByTestId('attachment-item')).toHaveCount(1);

    // Quitar el adjunto (con confirmación) lo desvincula del gasto.
    await item.getByTestId('attachment-remove').click();
    await page.getByTestId('attachment-remove-confirm').getByRole('button', { name: 'Quitar' }).click();
    await expect(section.getByTestId('attachments-empty')).toBeVisible();

    // La página de documentos lista el comprobante (sin vínculo) con el uso de la cuota; sin violaciones graves de a11y.
    await go(page, '/documentos');
    await expect(page.getByTestId('documents-row')).toHaveCount(1);
    await expect(page.getByTestId('documents-usage')).toContainText('5 GB');
    await expect(page.getByTestId('documents-purge-notice')).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await context.close();
  });
});
