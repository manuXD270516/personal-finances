import { describe, expect, it } from 'vitest';
import { paintStatement } from '../../../../../../tests/fixtures/imports/statements-bo/pdf/paint-statement.js';
import { renderPdf } from '../../../test/support/render-pdf.js';
import { FilePdfLayoutRegistry } from './file-pdf-layout-registry.js';
import { probePdf } from './pdf-probe.js';
import { PdfjsTextExtractor } from './pdfjs-text-extractor.js';

const deps = {
  extractor: new PdfjsTextExtractor({
    timeoutMs: 30_000,
    maxPages: 200,
    maxTextItems: 300_000,
    maxTextChars: 4_194_304,
    workerMaxOldMb: 192,
  }),
  layouts: new FilePdfLayoutRegistry(),
  scale: 2,
  minPageTextChars: 20,
};

describe('diagnóstico local de extractos PDF (pnpm imports:pdf:probe)', () => {
  it('[TC-IMPORTS-PDF-047] informa la estructura del extracto sin montos, descripciones ni cuentas', async () => {
    const bytes = await renderPdf(paintStatement('GANADERO'));
    const text = (await probePdf(bytes, deps)).join('\n');
    expect(text).toContain('diseno: bo.ganadero.cuenta@1');
    expect(text).toContain('paginas leidas: 2');
    expect(text).toContain('filas reconocidas: 11');
    expect(text).toContain('lineas no reconocidas: ninguna');
    expect(text).toContain('verificacion OPENING_CLOSING: OK');
    expect(text).toContain('resultado: OK');
    // Ningún monto (con decimales), id largo, nombre ni glosa del fixture.
    expect(text).not.toMatch(/\d+[.,]\d{2}\b/u);
    expect(text).not.toMatch(/\d{3,}/u);
    for (const word of ['Transferencia', 'PERSONA', 'FICTICIA', 'TITULAR', 'Seguro', 'Banco', 'Intereses']) {
      expect(text).not.toContain(word);
    }
  }, 60_000);

  it('[TC-IMPORTS-PDF-047] ante una incoherencia informa MISMATCH sin revelar la diferencia', async () => {
    const bytes = await renderPdf(paintStatement('BCP', { drop: [3] }));
    const text = (await probePdf(bytes, deps)).join('\n');
    expect(text).toContain('verificacion OPENING_CLOSING: MISMATCH');
    expect(text).toContain('resultado: FALLO IMPORT_PDF_TOTALS_MISMATCH');
    expect(text).not.toMatch(/\d+[.,]\d{2}\b/u);
    expect(text).not.toContain('300');
  }, 60_000);

  it('informa extracción fallida, páginas sin texto y diseño desconocido por su código', async () => {
    const truncated = await renderPdf(paintStatement('BCP'), { truncate: 0.5 });
    expect((await probePdf(truncated, deps)).join('\n')).toContain('extraccion: FALLO (MALFORMED)');
    const scanned = await renderPdf(paintStatement('BCP'), { imagePages: [1] });
    expect((await probePdf(scanned, deps)).join('\n')).toContain('resultado: FALLO IMPORT_PDF_NO_TEXT');
  }, 60_000);
});
