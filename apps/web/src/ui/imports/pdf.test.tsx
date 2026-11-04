import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { problemMessage } from '../../errors/error-messages';
import { esContext, textOf } from '../test-support';
import { PdfReadingPanel } from './PdfReadingPanel';
import { ParseFailedPanel } from './ProcessingPanel';
import { DOCUMENT_ACCEPT, IMPORT_FORMATS, pdfFailureLines } from './pipeline-logic';
import { checkStatementFile } from './document-upload';
import type { ImportJob, ImportPdfInfo } from './types';

const f = esContext('Imports');
const bob = (amount: string) => ({ amount, currency: 'BOB' });

const PDF_OK: ImportPdfInfo = {
  layout: { id: 'bo.ganadero.cuenta', version: 1 },
  pagesRead: 2,
  pagesDeclared: 2,
  pagesWithoutText: [],
  coherence: { totals: 'OK', difference: null, balanceChain: 'OK', unrecognizedLines: [] },
  openingDifference: bob('640.00'),
  extractionFailure: null,
  warnings: [],
};

function job(over: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-pdf',
    accountId: 'acc-bob',
    status: 'AWAITING_REVIEW',
    originalName: 'extracto-marzo.pdf',
    fileSha256: 'a'.repeat(64),
    fileSizeBytes: 900,
    detected: { encoding: 'utf-8', delimiter: ',' },
    rowCount: 11,
    columnCount: 1,
    header: [],
    mapping: null,
    counters: {
      rows: 11,
      newRows: 11,
      alreadyImported: 0,
      probableDuplicates: 0,
      invalid: 0,
      toCreate: 11,
      skipped: 0,
      excluded: 0,
      created: 0,
      failed: 0,
    },
    progress: { attempt: 0, batchCount: 0, batchesDone: 0 },
    errors: [],
    warnings: [],
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    expiresAt: null,
    createdBy: 'u1',
    createdAt: '2026-10-20T14:00:00Z',
    updatedAt: '2026-10-20T14:00:00Z',
    version: 3,
    documentId: 'doc-1',
    format: 'PDF',
    source: 'FILE_PDF',
    pdf: PDF_OK,
    ...over,
  };
}

describe('lectura de extractos PDF en el asistente', () => {
  it('[TC-IMPORTS-PDF-001] el selector ofrece PDF y la validación previa lo acepta', () => {
    expect(DOCUMENT_ACCEPT).toContain('.pdf');
    expect(IMPORT_FORMATS).toContain('PDF');
    expect(checkStatementFile({ name: 'extracto.pdf', size: 900 })).toBe('ok');
  });

  it('[TC-IMPORTS-PDF-048] la vista previa muestra el diseño con su versión, las páginas, la coherencia y la diferencia del saldo inicial', () => {
    const html = renderToStaticMarkup(<PdfReadingPanel f={f} job={job()} />);
    const text = textOf(html);
    expect(text).toContain('Lectura del extracto PDF');
    expect(text).toContain('Diseño detectado: bo.ganadero.cuenta, versión 1.');
    expect(text).toContain('Páginas leídas: 2 de 2.');
    expect(text).toContain('cuadran con los movimientos leídos');
    expect(text).toMatch(
      /Diferencia entre el saldo inicial del extracto y el saldo de tu cuenta el día anterior: .*640[,.]00/u,
    );
    expect(text).toContain('puedes aprobar igual');
    // Una diferencia de cero se informa como coincidencia.
    const zero = textOf(
      renderToStaticMarkup(
        <PdfReadingPanel f={f} job={job({ pdf: { ...PDF_OK, openingDifference: bob('0.00') } })} />,
      ),
    );
    expect(zero).toContain('coincide con el saldo de tu cuenta');
  });

  it('[TC-IMPORTS-PDF-039] una cuenta sin dígitos registrados muestra la advertencia de cuenta no verificada', () => {
    const html = renderToStaticMarkup(
      <PdfReadingPanel
        f={f}
        job={job({ pdf: { ...PDF_OK, warnings: ['IMPORT_PDF_ACCOUNT_UNVERIFIED'] } })}
      />,
    );
    expect(textOf(html)).toContain('No pudimos verificar que el extracto sea de esta cuenta');
    expect(html).toContain('data-testid="import-pdf-warning-IMPORT_PDF_ACCOUNT_UNVERIFIED"');
  });

  it('no muestra nada para los demás formatos', () => {
    expect(renderToStaticMarkup(<PdfReadingPanel f={f} job={job({ format: 'OFX', pdf: null })} />)).toBe('');
  });

  it('[TC-IMPORTS-PDF-010] [TC-IMPORTS-PDF-049] un PDF escaneado muestra el rechazo y la alternativa en es, en y pt', () => {
    const failed = job({
      status: 'PARSE_FAILED',
      failure: { code: 'IMPORT_PDF_NO_TEXT', pointer: null },
      pdf: { ...PDF_OK, layout: null, coherence: null, openingDifference: null, pagesWithoutText: [1, 2] },
    });
    const html = renderToStaticMarkup(
      <ParseFailedPanel
        f={f}
        job={failed}
        message={(code) => problemMessage({ code }, 'es')}
        newHref="/es/imports/nueva"
      />,
    );
    const text = textOf(html);
    expect(text).toContain('Este PDF no tiene texto');
    expect(text).toContain('Descarga el extracto digital');
    expect(text).toContain('registra los movimientos a mano');
    expect(text).toContain('Páginas sin texto: 1, 2.');
    expect(text).toContain('no tiene filas');
    expect(problemMessage({ code: 'IMPORT_PDF_NO_TEXT' }, 'en')).toMatch(
      /Download the digital statement.*by hand/u,
    );
    expect(problemMessage({ code: 'IMPORT_PDF_NO_TEXT' }, 'pt')).toMatch(/Baixe o extrato digital.*à mão/u);
  });

  it('[TC-IMPORTS-PDF-033] una coherencia rota informa la diferencia y las páginas y líneas no leídas, sin textos', () => {
    const failed = job({
      status: 'PARSE_FAILED',
      failure: { code: 'IMPORT_PDF_TOTALS_MISMATCH', pointer: null },
      pdf: {
        ...PDF_OK,
        openingDifference: null,
        coherence: {
          totals: 'MISMATCH',
          difference: bob('300.25'),
          balanceChain: 'NOT_AVAILABLE',
          unrecognizedLines: [{ page: 2, line: 14 }],
        },
      },
    });
    const html = renderToStaticMarkup(
      <ParseFailedPanel f={f} job={failed} message={(code) => problemMessage({ code }, 'es')} newHref="/x" />,
    );
    const text = textOf(html);
    expect(text).toContain('no cuadran con los movimientos que leímos');
    expect(text).toMatch(/Diferencia entre los saldos del extracto y los movimientos leídos: .*300[,.]25/u);
    expect(text).toContain('(página:línea): 2:14.');
  });

  it('el motivo de una extracción fallida y la cuenta ajena tienen texto propio en los tres idiomas', () => {
    const failed = job({
      status: 'PARSE_FAILED',
      failure: { code: 'IMPORT_PDF_EXTRACTION_FAILED', pointer: null },
      pdf: {
        ...PDF_OK,
        layout: null,
        coherence: null,
        openingDifference: null,
        extractionFailure: 'TIMEOUT',
      },
    });
    const text = textOf(
      renderToStaticMarkup(
        <ParseFailedPanel
          f={f}
          job={failed}
          message={(c) => problemMessage({ code: c }, 'es')}
          newHref="/x"
        />,
      ),
    );
    expect(text).toContain('La lectura tardó más del tiempo permitido.');
    for (const lang of ['es', 'en', 'pt'] as const) {
      for (const code of [
        'IMPORT_PDF_NO_TEXT',
        'IMPORT_PDF_LAYOUT_UNKNOWN',
        'IMPORT_PDF_EXTRACTION_FAILED',
        'IMPORT_PDF_TOTALS_MISMATCH',
        'IMPORT_PDF_PAGE_COUNT_MISMATCH',
        'IMPORT_PDF_ACCOUNT_MISMATCH',
      ]) {
        expect(problemMessage({ code }, lang).length).toBeGreaterThan(20);
      }
    }
  });

  it('pdfFailureLines lista a lo sumo 10 líneas y nada más que estructura', () => {
    const lines = pdfFailureLines({
      ...PDF_OK,
      coherence: {
        totals: 'MISMATCH',
        difference: null,
        balanceChain: 'OK',
        unrecognizedLines: Array.from({ length: 12 }, (_, i) => ({ page: 1, line: i + 1 })),
      },
    });
    expect(lines.unrecognized).toBe('1:1, 1:2, 1:3, 1:4, 1:5, 1:6, 1:7, 1:8, 1:9, 1:10, …');
    expect(lines.noText).toBeNull();
    expect(lines.pages).toBeNull();
  });
});
