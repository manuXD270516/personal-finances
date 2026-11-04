import {
  PdfExtractionError,
  detectLayout,
  findPagesWithoutText,
  layoutMatches,
  readPdfStatement,
  withCurrencyMismatch,
  type ImportFailure,
  type ImportPdfInfo,
  type ParsedStatement,
  type PdfLayout,
  type PdfLayoutRef,
  type PdfReadInfo,
} from '../../domain/index.js';
import type { PdfLayoutRegistry, PdfTextExtractor } from './ports.js';

/**
 * Lectura de un extracto PDF en la etapa `PARSE` (openspec add-pdf-statement-parser decisiones 3, 4, 6, 10, 11 y 13):
 * extracción en el hilo aislado → páginas sin texto → resolución del diseño (el fijado por el perfil, o la detección
 * por literales) → reconstrucción y coherencia → cuenta y moneda. La etapa es atómica: nada se escribe hasta que la
 * coherencia cuadra (falla cerrada, D347). Sin datos del titular: solo los últimos 4 dígitos de la cuenta.
 */
export interface PdfReadInput {
  readonly bytes: Uint8Array;
  readonly accountCurrency: string;
  readonly scale: number;
  readonly maxRows: number;
  /** Últimos 4 dígitos registrados de la cuenta destino (`null` ⇒ cuenta sin verificar). */
  readonly accountLast4: string | null;
  /** Diseño fijado por el perfil de la cuenta o de la institución. */
  readonly pinned: PdfLayoutRef | null;
}

export type PdfOutcome =
  | {
      readonly kind: 'RECORDS';
      readonly parsed: ParsedStatement;
      readonly pdf: ImportPdfInfo;
      readonly layout: PdfLayout;
    }
  | { readonly kind: 'FAILED'; readonly failure: ImportFailure; readonly pdf: ImportPdfInfo | null };

export interface PdfReaderSettings {
  /** `IMPORT_PDF_MIN_PAGE_TEXT_CHARS`: bajo este número de caracteres una página es «sin texto». */
  readonly minPageTextChars: number;
}

const baseInfo = (extra: Partial<ImportPdfInfo> = {}): ImportPdfInfo => ({
  layout: null,
  pagesRead: 0,
  pagesDeclared: null,
  pagesWithoutText: [],
  coherence: null,
  openingDifference: null,
  extractionFailure: null,
  warnings: [],
  ...extra,
});

const failed = (code: ImportFailure['code'], pdf: ImportPdfInfo | null): PdfOutcome => ({
  kind: 'FAILED',
  failure: { code, pointer: null },
  pdf,
});

function toInfo(info: PdfReadInfo, currency: string, warnings: ImportPdfInfo['warnings']): ImportPdfInfo {
  return {
    layout: info.layout,
    pagesRead: info.pagesRead,
    pagesDeclared: info.pagesDeclared,
    pagesWithoutText: info.pagesWithoutText,
    coherence:
      info.coherence === null
        ? null
        : {
            totals: info.coherence.totals,
            difference:
              info.coherence.difference === null ? null : { amount: info.coherence.difference, currency },
            balanceChain: info.coherence.runningBalance,
            unrecognizedLines: info.coherence.unrecognizedLines,
          },
    openingDifference: null,
    extractionFailure: null,
    warnings,
  };
}

export class PdfStatementReader {
  constructor(
    private readonly extractor: PdfTextExtractor,
    private readonly layouts: PdfLayoutRegistry,
    private readonly settings: PdfReaderSettings,
  ) {}

  /** Diseño publicado por referencia (para la huella y la UI), o `null`. */
  layoutOf(ref: PdfLayoutRef): PdfLayout | null {
    return this.layouts.get(ref.id, ref.version);
  }

  async read(input: PdfReadInput): Promise<PdfOutcome> {
    let doc;
    try {
      doc = await this.extractor.extract(input.bytes);
    } catch (err) {
      const reason = err instanceof PdfExtractionError ? err.reason : 'MALFORMED';
      return failed('IMPORT_PDF_EXTRACTION_FAILED', baseInfo({ extractionFailure: reason }));
    }

    const candidates = this.layouts.candidates();
    const blank = candidates.flatMap((l) => l.page.blankPageLiterals);
    const withoutText = findPagesWithoutText(doc, this.settings.minPageTextChars, blank);
    if (withoutText.length > 0) {
      return failed(
        'IMPORT_PDF_NO_TEXT',
        baseInfo({ pagesRead: doc.pages.length, pagesWithoutText: withoutText }),
      );
    }

    let layout: PdfLayout | null;
    if (input.pinned) {
      const pinned = this.layouts.get(input.pinned.id, input.pinned.version);
      layout = pinned && layoutMatches(doc, pinned) ? pinned : null;
    } else {
      layout = detectLayout(doc, candidates);
    }
    if (layout === null) {
      return failed('IMPORT_PDF_LAYOUT_UNKNOWN', baseInfo({ pagesRead: doc.pages.length }));
    }

    const read = readPdfStatement(doc, layout, { scale: input.scale, maxRows: input.maxRows });
    if (!read.ok) {
      return failed(read.code, toInfo(read.info, input.accountCurrency, []));
    }

    // Cuenta (D353): distinto ⇒ falla; sin dígitos registrados o ilegibles ⇒ advertencia.
    const warnings: 'IMPORT_PDF_ACCOUNT_UNVERIFIED'[] = [];
    const printed = read.info.accountLast4;
    if (input.accountLast4 !== null && printed !== null) {
      if (input.accountLast4.toLowerCase() !== printed.toLowerCase()) {
        return failed('IMPORT_PDF_ACCOUNT_MISMATCH', toInfo(read.info, input.accountCurrency, []));
      }
    } else {
      warnings.push('IMPORT_PDF_ACCOUNT_UNVERIFIED');
    }

    if (read.records.length > input.maxRows) {
      return { kind: 'FAILED', failure: { code: 'IMPORT_TOO_MANY_ROWS', pointer: null }, pdf: null };
    }
    const declared = read.info.currency;
    const records =
      declared !== null && declared !== input.accountCurrency
        ? withCurrencyMismatch(read.records)
        : read.records;
    return {
      kind: 'RECORDS',
      layout,
      pdf: toInfo(read.info, input.accountCurrency, warnings),
      parsed: {
        format: 'PDF',
        records,
        statement: read.statement,
        declaredCurrency: declared,
        failure: null,
        needsMapping: [],
      },
    };
  }
}
