import { describe, expect, it } from 'vitest';
import { paintLargeStatement } from '../../../../../../tests/fixtures/imports/statements-bo/pdf/paint-statement.js';
import { renderPdf } from '../../../test/support/render-pdf.js';
import { PdfStatementReader } from '../../application/pdf/pdf-statement-reader.js';
import { FilePdfLayoutRegistry } from './file-pdf-layout-registry.js';
import { PdfjsTextExtractor } from './pdfjs-text-extractor.js';

/**
 * Un extracto de 100 páginas y 5 000 movimientos (D329) se lee completo y coherente con los límites por omisión. La
 * medición de tiempo (≤ 30 s hasta la revisión, TC-IMPORTS-PDF-046) vive en el benchmark `imports.perf.ts`: CI corre los
 * paquetes en paralelo y un umbral ajustado sobre una sola medición sería inestable; aquí solo un tope holgado.
 */
describe('extracto PDF grande', () => {
  it('[TC-IMPORTS-PDF-046] 100 páginas y 5 000 movimientos se leen completos, con la coherencia en orden', async () => {
    const bytes = await renderPdf(paintLargeStatement(5000, 50));
    const reader = new PdfStatementReader(
      new PdfjsTextExtractor({
        timeoutMs: 30_000,
        maxPages: 200,
        maxTextItems: 300_000,
        maxTextChars: 4_194_304,
        workerMaxOldMb: 192,
      }),
      new FilePdfLayoutRegistry(),
      { minPageTextChars: 20 },
    );
    const started = performance.now();
    const outcome = await reader.read({
      bytes,
      accountCurrency: 'BOB',
      scale: 2,
      maxRows: 5000,
      accountLast4: '0001',
      pinned: null,
    });
    const elapsed = performance.now() - started;
    expect(
      outcome.kind,
      JSON.stringify(outcome.kind === 'FAILED' ? [outcome.failure, outcome.pdf] : ''),
    ).toBe('RECORDS');
    if (outcome.kind !== 'RECORDS') return;
    expect(outcome.parsed.records).toHaveLength(5000);
    expect(outcome.pdf).toMatchObject({ pagesRead: 100, pagesDeclared: 100, coherence: { totals: 'OK' } });
    expect(outcome.parsed.records.every((r) => r.issues.length === 0)).toBe(true);
    // Tope holgado (la cifra real se mide en el benchmark): solo detecta una regresión de órdenes de magnitud.
    expect(elapsed).toBeLessThan(120_000);
  }, 240_000);
});
