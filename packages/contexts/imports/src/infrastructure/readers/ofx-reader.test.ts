import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv, decodeCsv, detectDelimiter, sniffCsv } from '../../domain/csv-sniffer.js';
import { ofxSgmlOf, syntheticMovements } from '../../domain/large-statement.test-support.js';
import { OfxReader, parseOfxDateTime } from '../../domain/ofx-reader.js';
import type { ParseOptions } from '../../domain/statement.js';

const DIR = resolve(__dirname, '../../../../../../tests/fixtures/imports');
const bytes = (rel: string) => new Uint8Array(readFileSync(resolve(DIR, rel)));
const OPTIONS: ParseOptions = {
  timeZone: 'America/La_Paz',
  maxRows: 5000,
  accountCurrency: 'BOB',
  currencyScale: 2,
};
const reader = new OfxReader();

describe('lector OFX', () => {
  it('[TC-IMPORTS-PIPELINE-013] DTPOSTED 20260301020000[0:UTC] en America/La_Paz es la fecha de negocio 2026-02-28', () => {
    expect(parseOfxDateTime('20260301020000[0:UTC]', 'America/La_Paz')).toEqual({
      date: '2026-02-28',
      time: '22:00:00',
    });
    const parsed = reader.parse(bytes('ofx/extracto-sgml.ofx'), OPTIONS);
    expect(parsed.records[0]?.bookingDate).toBe('2026-02-28');
  });

  it('una fecha sin desfase es literal y con desfase negativo se convierte', () => {
    expect(parseOfxDateTime('20260305', 'America/La_Paz')).toEqual({ date: '2026-03-05', time: null });
    expect(parseOfxDateTime('20260310120000', 'America/La_Paz')).toEqual({
      date: '2026-03-10',
      time: '12:00:00',
    });
    expect(parseOfxDateTime('20260402100000[-4:BOT]', 'America/La_Paz')).toEqual({
      date: '2026-04-02',
      time: '10:00:00',
    });
    expect(parseOfxDateTime('20260230', 'America/La_Paz')).toBeNull();
    expect(parseOfxDateTime('basura', 'America/La_Paz')).toBeNull();
  });

  it('[TC-IMPORTS-PIPELINE-014] el FITID es el identificador externo, el monto es una salida y NAME la descripción', () => {
    const parsed = reader.parse(bytes('ofx/extracto-sgml.ofx'), OPTIONS);
    expect(parsed.failure).toBeNull();
    expect(parsed.records).toHaveLength(3);
    expect(parsed.records[0]).toEqual({
      line: 1,
      bookingDate: '2026-02-28',
      time: '22:00:00',
      valueDate: null,
      amount: '-245.30',
      currency: 'BOB',
      description: 'COMPRA SUPERMERCADO SINTETICO',
      externalId: '2026030100017',
      reference: null,
      counterparty: null,
      runningBalance: null,
      issues: [],
    });
    // NAME + MEMO, entidades decodificadas, número de cheque como referencia no única.
    expect(parsed.records[2]).toMatchObject({
      description: 'PAGO SERVICIOS FACTURA SINTETICA & OTROS',
      reference: '1042',
      amount: '-235.38',
      time: '12:00:00',
    });
  });

  it('[TC-IMPORTS-PIPELINE-015] el saldo contable final y su fecha son el saldo del extracto', () => {
    const parsed = reader.parse(bytes('ofx/extracto-sgml.ofx'), OPTIONS);
    expect(parsed.statement).toEqual({
      openingBalance: null,
      closingBalance: '1019.32',
      closingDate: '2026-03-31',
      periodFrom: '2026-03-01',
      periodTo: '2026-03-31',
    });
  });

  it('[TC-IMPORTS-PIPELINE-016] un OFX en USD para una cuenta en BOB deja todas sus filas con IMPORT_CURRENCY_MISMATCH', () => {
    const parsed = reader.parse(bytes('ofx/extracto-usd.ofx'), OPTIONS);
    expect(parsed.declaredCurrency).toBe('USD');
    expect(parsed.records).toHaveLength(2);
    for (const r of parsed.records) {
      expect(r.issues).toContainEqual({ code: 'IMPORT_CURRENCY_MISMATCH', severity: 'ERROR' });
    }
  });

  it('[TC-IMPORTS-PIPELINE-011] lee OFX 2.x XML (comentarios, memo vacío, saldo) igual que el 1.x', () => {
    const parsed = reader.parse(bytes('ofx/extracto-xml.ofx'), OPTIONS);
    expect(parsed.failure).toBeNull();
    expect(parsed.records.map((r) => [r.bookingDate, r.amount, r.externalId, r.description])).toEqual([
      ['2026-04-02', '-120.00', '2026040200001', 'CAFE CENTRAL'],
      ['2026-04-15', '300.50', '2026041500002', 'TRANSFERENCIA RECIBIDA'],
    ]);
    expect(parsed.statement?.closingBalance).toBe('180.50');
    expect(parsed.statement?.closingDate).toBe('2026-04-30');
  });

  it('[TC-IMPORTS-PIPELINE-023] un XML con DTD y entidad externa se rechaza sin resolverla', () => {
    const parsed = reader.parse(bytes('ofx/extracto-xxe.ofx'), OPTIONS);
    expect(parsed.records).toEqual([]);
    expect(parsed.failure).toEqual({ code: 'IMPORT_PARSE_FAILED', pointer: 'dtd' });
  });

  it('una entidad desconocida queda literal (no se resuelve) y la profundidad está acotada', () => {
    const doc = `<OFX><STMTTRNRS><STMTRS><CURDEF>BOB<BANKTRANLIST><STMTTRN><DTPOSTED>20260301<TRNAMT>-1.00<FITID>A1<NAME>&xxe; &lt;b&gt;</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></OFX>`;
    const ok = reader.parse(new TextEncoder().encode(doc), OPTIONS);
    expect(ok.records[0]?.description).toBe('&xxe; <b>');
    const deep = `<OFX>${'<A>'.repeat(40)}`;
    expect(reader.parse(new TextEncoder().encode(deep), OPTIONS).failure).toEqual({
      code: 'IMPORT_PARSE_FAILED',
      pointer: 'depth',
    });
  });

  it('un archivo que no es OFX o binario falla la lectura', () => {
    expect(reader.parse(new TextEncoder().encode('hola'), OPTIONS).failure?.code).toBe('IMPORT_PARSE_FAILED');
    expect(reader.parse(new Uint8Array([0, 1, 2]), OPTIONS).failure?.code).toBe('IMPORT_PARSE_FAILED');
  });

  it('un monto con exceso de decimales o una fecha inválida invalidan la fila sin redondear', () => {
    const doc = `<OFX><STMTTRNRS><STMTRS><CURDEF>BOB<BANKTRANLIST><STMTTRN><DTPOSTED>20261340<TRNAMT>-1.005<FITID>A1<NAME>X</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></OFX>`;
    const out = reader.parse(new TextEncoder().encode(doc), OPTIONS).records[0];
    expect(out?.amount).toBeNull();
    expect(out?.bookingDate).toBeNull();
    expect(out?.issues.map((i) => i.code)).toEqual(['IMPORT_INVALID_DATE', 'IMPORT_INVALID_AMOUNT']);
  });

  it('[TC-IMPORTS-PIPELINE-067] un OFX de 5001 movimientos falla con IMPORT_TOO_MANY_ROWS y sin filas', () => {
    const limit = 5000;
    const within = reader.parse(ofxSgmlOf(syntheticMovements(limit)), OPTIONS);
    expect(within.failure).toBeNull();
    expect(within.records).toHaveLength(limit);
    const over = reader.parse(ofxSgmlOf(syntheticMovements(limit + 1)), OPTIONS);
    expect(over.records).toEqual([]);
    expect(over.failure).toEqual({ code: 'IMPORT_TOO_MANY_ROWS', pointer: null });
  });

  it('[TC-IMPORTS-PIPELINE-055] tres meses solapados en CSV y OFX suman 115 movimientos distintos', () => {
    const ofx = reader.parse(bytes('tres-meses/feb-mar.ofx'), OPTIONS);
    const csvBytes = bytes('tres-meses/enero-15feb.csv');
    const sniffed = sniffCsv(csvBytes, { maxRows: 5000, maxColumns: 50 });
    const csvKeys = sniffed.records.slice(1).map((r) => {
      const [d, desc, amount] = r.cells as [string, string, string];
      const iso = `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
      return `${iso}|${amount.replace(',', '.')}|${desc}`;
    });
    const ofxKeys = ofx.records.map((r) => `${r.bookingDate}|${r.amount}|${r.description}`);
    expect(csvKeys).toHaveLength(52);
    expect(ofxKeys).toHaveLength(75);
    expect(new Set([...csvKeys, ...ofxKeys]).size).toBe(115);
    expect(new Set(ofxKeys.filter((k) => csvKeys.includes(k))).size).toBe(12);
  });

  it('[TC-IMPORTS-PIPELINE-068] un CSV de 51 columnas falla con IMPORT_UNSUPPORTED_FORMAT', () => {
    const header = Array.from({ length: 51 }, (_, i) => `c${i}`).join(',');
    const row = Array.from({ length: 51 }, () => 'x').join(',');
    expect(() =>
      sniffCsv(new TextEncoder().encode(`${header}\n${row}\n`), { maxRows: 5000, maxColumns: 50 }),
    ).toThrowError(expect.objectContaining({ code: 'IMPORT_UNSUPPORTED_FORMAT' }) as Error);
    // contraste: 50 columnas pasan
    const ok = `${header.split(',').slice(0, 50).join(',')}\n${row.split(',').slice(0, 50).join(',')}\n`;
    expect(sniffCsv(new TextEncoder().encode(ok), { maxRows: 5000, maxColumns: 50 }).columnCount).toBe(50);
    expect(parseCsv(decodeCsv(new TextEncoder().encode('a,b')).text, detectDelimiter('a,b'))).toHaveLength(1);
  });
});
