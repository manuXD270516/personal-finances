import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CSV_BOM, CsvWriter, csvCell, neutralizeCell } from './csv.js';
import { ZipFormatError, ZipReader, ZipWriter } from './zip.js';

const at = new Date('2026-10-09T12:00:00Z');

describe('ZIP (formato pfos-export)', () => {
  it('[TC-IDENTITY-EXPORT-003] escribe y lee entradas deflate y store, con nombres UTF-8 y CRC verificado', () => {
    const w = new ZipWriter(at);
    const json = Buffer.from('{"a":"45.90"}\n'.repeat(2000));
    w.add('manifest.json', Buffer.from('{}'));
    w.add('json/transactions.jsonl', json);
    w.add('csv/ñandú.csv', Buffer.from('a,b\r\n'));
    w.add('vacio.txt', Buffer.alloc(0));
    const zip = w.finish();
    expect(zip.subarray(0, 2).toString('ascii')).toBe('PK');
    const r = ZipReader.open(zip);
    expect(r.names()).toEqual(['manifest.json', 'json/transactions.jsonl', 'csv/ñandú.csv', 'vacio.txt']);
    expect(r.read('json/transactions.jsonl').equals(json)).toBe(true);
    expect(r.read('vacio.txt')).toHaveLength(0);
    expect(r.sizeOf('manifest.json')).toBe(2);
    expect(zip.length).toBeLessThan(json.length);
  });

  it('[TC-IDENTITY-RESTORE-004] un byte alterado dentro de una entrada se detecta (CRC/deflate)', () => {
    const w = new ZipWriter(at);
    w.add('json/a.jsonl', Buffer.from('"45.90"'));
    const zip = Buffer.from(w.finish());
    const pos = zip.indexOf(Buffer.from('45.90'));
    expect(pos).toBeGreaterThan(0);
    zip[pos + 3] = 0x38;
    expect(() => ZipReader.open(zip).read('json/a.jsonl')).toThrow(ZipFormatError);
  });

  it('[TC-IDENTITY-RESTORE-004] rechaza un archivo que no es ZIP, truncado o con directorio central dañado', () => {
    expect(() => ZipReader.open(Buffer.from('no es un zip, ni cerca de serlo.'))).toThrow(ZipFormatError);
    const w = new ZipWriter(at);
    w.add('a.txt', Buffer.from('hola'));
    const zip = w.finish();
    expect(() => ZipReader.open(zip.subarray(0, zip.length - 10))).toThrow(ZipFormatError);
    const broken = Buffer.from(zip);
    broken.writeUInt32LE(0, zip.length - 22 + 16);
    expect(() => ZipReader.open(broken)).toThrow(ZipFormatError);
  });

  it('defiende contra nombres peligrosos, duplicados, exceso de entradas y bombas de descompresión', () => {
    for (const name of ['../evil.txt', '/abs.txt', 'a/../b.txt', 'a\\b.txt', 'dir/']) {
      const w = new ZipWriter(at);
      w.add(name, Buffer.from('x'));
      expect(() => ZipReader.open(w.finish()), name).toThrow(ZipFormatError);
    }
    const dup = new ZipWriter(at);
    dup.add('a.txt', Buffer.from('1'));
    dup.add('a.txt', Buffer.from('2'));
    expect(() => ZipReader.open(dup.finish())).toThrow(/duplicada/u);
    const many = new ZipWriter(at);
    for (let i = 0; i < 5; i += 1) many.add(`f${i}.txt`, Buffer.from('x'));
    expect(() =>
      ZipReader.open(many.finish(), { maxEntries: 4, maxEntryBytes: 10, maxTotalBytes: 100 }),
    ).toThrow(/demasiadas/u);
    const big = new ZipWriter(at);
    big.add('big.bin', Buffer.alloc(1000, 0));
    expect(() =>
      ZipReader.open(big.finish(), { maxEntries: 4, maxEntryBytes: 500, maxTotalBytes: 100 }),
    ).toThrow(/grande/u);
    // Cabecera mentirosa: declara 10 bytes pero el flujo deflate expande mucho más ⇒ se corta por `maxOutputLength`.
    const liar = new ZipWriter(at);
    liar.add('big.bin', Buffer.alloc(100_000, 1));
    const zip = Buffer.from(liar.finish());
    const central = zip.length - 22 - 46 - 'big.bin'.length;
    zip.writeUInt32LE(10, central + 24);
    zip.writeUInt32LE(10, 22);
    expect(() => ZipReader.open(zip).read('big.bin')).toThrow(ZipFormatError);
    void deflateRawSync;
  });
});

describe('CSV (RFC 4180 + neutralización de fórmulas)', () => {
  it('[TC-IDENTITY-EXPORT-003] una descripción con fórmula sale neutralizada con comilla simple', () => {
    expect(neutralizeCell('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      expect(csvCell(`${lead}cmd`).replace(/^"/u, '').startsWith("'"), JSON.stringify(lead)).toBe(true);
    }
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('Almuerzo')).toBe('Almuerzo');
  });

  it('[TC-IDENTITY-EXPORT-003] los montos exactos (incluso negativos) no se neutralizan; un falso monto sí', () => {
    expect(csvCell('-45.90', { numeric: true })).toBe('-45.90');
    expect(csvCell('100.000000', { numeric: true })).toBe('100.000000');
    expect(csvCell('-45.90')).toBe("'-45.90");
    expect(csvCell('=1+1', { numeric: true })).toBe("'=1+1");
    expect(csvCell('-1e5', { numeric: true })).toBe("'-1e5");
  });

  it('escapa comillas, comas y saltos de línea, usa CRLF y BOM UTF-8', () => {
    const w = new CsvWriter(['fecha', 'descripcion', 'monto']);
    w.row(['2026-10-01', 'dijo "hola", y\nse fue', { n: '45.90' }]);
    w.row(['2026-10-02', null, { n: null }]);
    const text = w.toBuffer().toString('utf8');
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text.slice(1)).toBe(
      'fecha,descripcion,monto\r\n2026-10-01,"dijo ""hola"", y\nse fue",45.90\r\n2026-10-02,,\r\n',
    );
  });
});
