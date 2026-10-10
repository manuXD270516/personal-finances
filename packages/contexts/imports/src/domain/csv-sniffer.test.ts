import { describe, expect, it } from 'vitest';
import { decodeCsv, detectDelimiter, parseCsv, sniffCsv } from './csv-sniffer.js';

const LIMITS = { maxRows: 5000, maxColumns: 50 };
const latin1 = (s: string): Uint8Array => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('CsvSniffer', () => {
  it('[TC-IMPORTS-CSV-001] detecta windows-1252, punto y coma, encabezado y 4 filas', () => {
    const text =
      'Fecha;Descripción;Monto\r\n01/10/2026;COMPRA SUPERMERCADO;-245,30\r\n02/10/2026;PAGO QR CAFÉ;-18,00\r\n' +
      '02/10/2026;PAGO QR CAFÉ;-18,00\r\n05/10/2026;ABONO SUELDO;8.000,00\r\n';
    const result = sniffCsv(latin1(text), LIMITS);
    expect(result.encoding).toBe('windows-1252');
    expect(result.delimiter).toBe(';');
    expect(result.columnCount).toBe(3);
    expect(result.records).toHaveLength(5);
    expect(result.records[0]?.cells).toEqual(['Fecha', 'Descripción', 'Monto']);
    expect(result.records[3]?.cells[1]).toBe('PAGO QR CAFÉ');
    expect(result.records[4]?.line).toBe(5);
  });

  it('UTF-8 con BOM se reconoce y el BOM no entra en la primera celda', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Fecha,Monto\n01/10/2026,1\n')]);
    const r = sniffCsv(bytes, LIMITS);
    expect(r.encoding).toBe('utf-8');
    expect(r.records[0]?.cells[0]).toBe('Fecha');
  });

  it('UTF-8 sin BOM válido gana sobre windows-1252 y se normaliza a NFC', () => {
    const nfd = 'Descripción;Monto\nx;1\n';
    const r = decodeCsv(utf8(nfd));
    expect(r.encoding).toBe('utf-8');
    expect(r.text.startsWith('Descripción')).toBe(true);
  });

  it('los bytes de windows-1252 en 0x80–0x9F se mapean (euro, comillas tipográficas)', () => {
    const r = decodeCsv(Uint8Array.from([0x80, 0x3b, 0x93, 0x41, 0x94]));
    expect(r.text).toBe('€;“A”');
    expect(r.encoding).toBe('windows-1252');
  });

  it('[TC-IMPORTS-CSV-005] un PNG renombrado (NUL) es IMPORT_UNSUPPORTED_FORMAT', () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    expect(() => sniffCsv(png, LIMITS)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_UNSUPPORTED_FORMAT' }),
    );
  });

  it('muchos caracteres de control sin NUL también es binario', () => {
    const bytes = Uint8Array.from(Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? 0x01 : 0x41)));
    expect(() => decodeCsv(bytes)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_UNSUPPORTED_FORMAT' }),
    );
  });

  it('un archivo vacío es IMPORT_UNSUPPORTED_FORMAT', () => {
    expect(() => sniffCsv(new Uint8Array(), LIMITS)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_UNSUPPORTED_FORMAT' }),
    );
  });

  it('más de 50 columnas es IMPORT_UNSUPPORTED_FORMAT', () => {
    const row = Array.from({ length: 51 }, (_, i) => `c${i}`).join(',');
    expect(() => sniffCsv(utf8(`${row}\n${row}\n`), LIMITS)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_UNSUPPORTED_FORMAT' }),
    );
  });

  it('[TC-IMPORTS-CSV-004] 5 001 filas de datos es IMPORT_TOO_MANY_ROWS y 5 000 pasa', () => {
    const build = (n: number) =>
      'Fecha,Descripcion,Monto\n' +
      Array.from({ length: n }, (_, i) => `01/10/2026,x${i},-1.00`).join('\n') +
      '\n';
    expect(sniffCsv(utf8(build(5000)), LIMITS).records).toHaveLength(5001);
    expect(() => sniffCsv(utf8(build(5001)), LIMITS)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_TOO_MANY_ROWS' }),
    );
  });
});

describe('detectDelimiter', () => {
  it.each([
    ['a,b,c\n1,2,3\n', ','],
    ['a;b;c\n1;2;3\n', ';'],
    ['a\tb\tc\n1\t2\t3\n', '\t'],
    ['a|b|c\n1|2|3\n', '|'],
  ])('%j → %j', (text, expected) => {
    expect(detectDelimiter(text)).toBe(expected);
  });

  it('ignora los delimitadores dentro de comillas y prefiere la consistencia', () => {
    const text = 'Fecha;Descripción;Monto\n01/10;"COMPRA, S.A., LA PAZ";-1,50\n02/10;"OTRA, X";-2,00\n';
    expect(detectDelimiter(text)).toBe(';');
  });

  it('sin delimitador reconocible usa la coma', () => {
    expect(detectDelimiter('solo una columna\notra\n')).toBe(',');
  });
});

describe('parseCsv (RFC 4180)', () => {
  it('campos entrecomillados con comillas escapadas, saltos de línea y delimitadores', () => {
    const records = parseCsv('a,"b ""q"" , c","d\ne"\n1,2,3\n', ',');
    expect(records).toEqual([
      { line: 1, cells: ['a', 'b "q" , c', 'd\ne'] },
      { line: 3, cells: ['1', '2', '3'] },
    ]);
  });

  it('CRLF, CR y LF; omite líneas vacías conservando la línea física', () => {
    const records = parseCsv('a,b\r\n\r\n1,2\r3,4', ',');
    expect(records.map((r) => [r.line, r.cells])).toEqual([
      [1, ['a', 'b']],
      [3, ['1', '2']],
      [4, ['3', '4']],
    ]);
  });

  it('una celda vacía entre delimitadores y un último campo vacío se conservan', () => {
    expect(parseCsv('a,,c,\n', ',')[0]?.cells).toEqual(['a', '', 'c', '']);
  });

  it('una línea solo con delimitadores o con comillas vacías se omite', () => {
    expect(parseCsv('a,b\n,\n""\n1,2\n', ',').map((r) => r.line)).toEqual([1, 4]);
  });
});
