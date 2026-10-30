import { DomainError } from '@pf/shared-kernel';
import type { ReadOptions, ReadOutcome, StatementReaderPort } from '../../application/ports/index.js';
import { sniffCsv } from '../../domain/csv-sniffer.js';
import { OfxReader } from '../../domain/ofx-reader.js';
import { QifReader } from '../../domain/qif-reader.js';
import type { SniffResult, StatementFormat } from '../../domain/statement.js';
import { sniffStatementFormat } from '../../domain/statement-sniffer.js';
import { JsonStatementReader } from './json-statement-reader.js';
import { readXlsxTable } from './xlsx-reader.js';

/**
 * Lectores por formato detrás del puerto `StatementReaderPort` (openspec add-import-pipeline decisión 5): CSV, XLSX y
 * los formatos autodescritos OFX, QIF y JSON. Puro y sin base de datos: opera sobre los bytes de un documento ya
 * verificado por DOCUMENTS. El PDF queda fuera (change propio, pregunta 1).
 */
export class DefaultStatementReader implements StatementReaderPort {
  private readonly ofx = new OfxReader();
  private readonly qif = new QifReader();
  private readonly json = new JsonStatementReader();

  sniff(head: Uint8Array): SniffResult | null {
    return sniffStatementFormat(head);
  }

  read(format: StatementFormat, bytes: Uint8Array, options: ReadOptions): ReadOutcome {
    const parseOptions = {
      timeZone: options.timeZone,
      maxRows: options.maxRows,
      accountCurrency: options.accountCurrency,
      currencyScale: options.currencyScale,
      dateOrder: options.dateOrder,
    };
    switch (format) {
      case 'PDF':
        // El PDF necesita extracción asíncrona en un hilo aislado: lo lee `ProcessImportService` con el puerto de PDF.
        return { kind: 'FAILED', failure: { code: 'IMPORT_UNSUPPORTED_FORMAT', pointer: null } };
      case 'OFX':
        return { kind: 'RECORDS', parsed: this.ofx.parse(bytes, parseOptions) };
      case 'QIF':
        return { kind: 'RECORDS', parsed: this.qif.parse(bytes, parseOptions) };
      case 'JSON':
        return { kind: 'RECORDS', parsed: this.json.parse(bytes, parseOptions) };
      case 'XLSX': {
        const table = readXlsxTable(bytes, {
          sheet: options.sheet,
          maxRows: options.maxRows,
          maxColumns: options.maxColumns,
        });
        if (!table.ok) return { kind: 'FAILED', failure: table.failure };
        return {
          kind: 'TABLE',
          records: table.records,
          columnCount: table.columnCount,
          encoding: 'utf-8',
          delimiter: ',',
        };
      }
      case 'CSV': {
        try {
          const sniffed = sniffCsv(bytes, { maxRows: options.maxRows, maxColumns: options.maxColumns });
          return {
            kind: 'TABLE',
            records: sniffed.records,
            columnCount: sniffed.columnCount,
            encoding: sniffed.encoding,
            delimiter: sniffed.delimiter,
          };
        } catch (error) {
          if (error instanceof DomainError && error.code === 'IMPORT_TOO_MANY_ROWS') {
            return { kind: 'FAILED', failure: { code: 'IMPORT_TOO_MANY_ROWS', pointer: null } };
          }
          if (error instanceof DomainError && error.code === 'IMPORT_UNSUPPORTED_FORMAT') {
            return { kind: 'FAILED', failure: { code: 'IMPORT_UNSUPPORTED_FORMAT', pointer: null } };
          }
          throw error;
        }
      }
    }
  }
}
