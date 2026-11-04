import { describe, expect, it } from 'vitest';
import {
  loadExpected,
  paintStatement,
  type EntityId,
  type ExpectedMovement,
  type PaintOptions,
} from '../../../../../../tests/fixtures/imports/statements-bo/pdf/paint-statement.js';
import { renderPdf, type RenderOptions } from '../../../test/support/render-pdf.js';
import { PdfStatementReader } from '../../application/pdf/pdf-statement-reader.js';
import { FilePdfLayoutRegistry } from './file-pdf-layout-registry.js';
import { PdfjsTextExtractor } from './pdfjs-text-extractor.js';

/**
 * PDF REALES generados por código con `pdfkit` (sintéticos, en memoria, jamás versionados) leídos con PDF.js en el
 * hilo aislado y reconstruidos por el motor: oráculo = `expected.json` de cada entidad (TC-IMPORTS-PDF-045).
 */
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

const LAST4: Record<EntityId, string> = { BCP: '1000', GANADERO: '0001', BNB: '0001' };
const ENTITIES: readonly EntityId[] = ['BCP', 'GANADERO', 'BNB'];

async function readPdf(entity: EntityId, paint: PaintOptions = {}, render: RenderOptions = {}) {
  const bytes = await renderPdf(paintStatement(entity, paint), render);
  return reader.read({
    bytes,
    accountCurrency: 'BOB',
    scale: 2,
    maxRows: 5000,
    accountLast4: LAST4[entity],
    pinned: null,
  });
}

const timeOf = (t: string): string => (t.length === 5 ? `${t}:00` : t);

describe('extractos PDF generados leídos con PDF.js (golden)', () => {
  it.each(ENTITIES)(
    '[TC-IMPORTS-PDF-045] el PDF generado de %s se lee exactamente igual a sus movimientos sintéticos',
    async (entity) => {
      const expected = loadExpected(entity);
      const outcome = await readPdf(entity);
      expect(outcome.kind).toBe('RECORDS');
      if (outcome.kind !== 'RECORDS') return;
      expect(outcome.parsed.statement).toMatchObject({
        openingBalance: expected.statement.openingBalance,
        closingBalance: expected.statement.closingBalance,
        periodFrom: expected.statement.periodFrom,
        periodTo: expected.statement.periodTo,
      });
      expect(outcome.parsed.records).toHaveLength(expected.movements.length);
      outcome.parsed.records.forEach((r, i) => {
        const m = expected.movements[i] as ExpectedMovement;
        expect([r.bookingDate, timeOf(r.time ?? ''), r.amount, r.description, r.runningBalance]).toEqual([
          m.date,
          timeOf(m.time),
          m.amount,
          m.description,
          m.balance,
        ]);
        expect(r.issues).toEqual([]);
      });
      expect(outcome.pdf.coherence).toMatchObject({ totals: 'OK' });
      expect(outcome.pdf.warnings).toEqual([]);
    },
    60_000,
  );

  it.each(ENTITIES)(
    '[TC-IMPORTS-PDF-016] [TC-IMPORTS-PDF-018] el orden de dibujo y el texto carácter por carácter no cambian el resultado (%s)',
    async (entity) => {
      const base = await readPdf(entity);
      expect(base.kind).toBe('RECORDS');
      // Orden de dibujo aleatorio (celdas completas) y texto carácter por carácter, por separado: con glifos sueltos Y
      // barajados PDF.js reordena letras sueltas contiguas en el orden de dibujo (caso patológico que no ocurre en un extracto).
      for (const paint of [{ shuffleSeed: 11 }, { charByChar: true }]) {
        const variant = await readPdf(entity, paint);
        expect(variant.kind).toBe('RECORDS');
        if (base.kind === 'RECORDS' && variant.kind === 'RECORDS') {
          expect(variant.parsed.records).toEqual(base.parsed.records);
          expect(variant.parsed.statement).toEqual(base.parsed.statement);
        }
      }
    },
    120_000,
  );

  it('[TC-IMPORTS-PDF-008] un extracto con contraseña solo de propietario se lee como cualquier otro', async () => {
    const outcome = await readPdf('BCP', {}, { ownerPassword: 'propietario-sintetico' });
    expect(outcome.kind).toBe('RECORDS');
    if (outcome.kind === 'RECORDS') expect(outcome.parsed.records).toHaveLength(4);
  }, 60_000);

  it('[TC-IMPORTS-PDF-010] un PDF de solo imágenes falla con IMPORT_PDF_NO_TEXT', async () => {
    const outcome = await readPdf('GANADERO', {}, { imagePages: [1, 2] });
    expect(outcome).toMatchObject({ kind: 'FAILED', failure: { code: 'IMPORT_PDF_NO_TEXT' } });
    if (outcome.kind === 'FAILED') expect(outcome.pdf?.pagesWithoutText).toEqual([1, 2]);
  }, 60_000);

  it('[TC-IMPORTS-PDF-011] una página de solo imagen entre páginas con texto rechaza el PDF indicando la página', async () => {
    const outcome = await readPdf('GANADERO', {}, { imagePages: [2] });
    expect(outcome).toMatchObject({ kind: 'FAILED', failure: { code: 'IMPORT_PDF_NO_TEXT' } });
    if (outcome.kind === 'FAILED') expect(outcome.pdf?.pagesWithoutText).toEqual([2]);
  }, 60_000);

  it('[TC-IMPORTS-PDF-007] un PDF truncado falla la extracción sin filas', async () => {
    const outcome = await readPdf('GANADERO', {}, { truncate: 0.6 });
    expect(outcome).toMatchObject({ kind: 'FAILED', failure: { code: 'IMPORT_PDF_EXTRACTION_FAILED' } });
    if (outcome.kind === 'FAILED') expect(outcome.pdf?.extractionFailure).toBe('MALFORMED');
  }, 60_000);

  it('[TC-IMPORTS-PDF-009] el autor declarado en los metadatos del PDF no llega a ningún resultado', async () => {
    const outcome = await readPdf('BCP', {}, { author: 'AUTOR-SECRETO-SINTETICO' });
    expect(outcome.kind).toBe('RECORDS');
    expect(JSON.stringify(outcome)).not.toContain('AUTOR-SECRETO');
  }, 60_000);
});
