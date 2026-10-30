import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { IMPORT_FILE_SCHEMA } from '../../domain/import-file-schema.js';
import { parseProfileOptions } from '../../domain/profile-options.js';
import type { ParseOptions } from '../../domain/statement.js';
import { JsonStatementReader } from './json-statement-reader.js';

const ROOT = resolve(__dirname, '../../../../../..');
const bytes = (rel: string) => new Uint8Array(readFileSync(resolve(ROOT, 'tests/fixtures/imports', rel)));
const OPTIONS: ParseOptions = {
  timeZone: 'America/La_Paz',
  maxRows: 5000,
  accountCurrency: 'BOB',
  currencyScale: 2,
};
const reader = new JsonStatementReader();
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

describe('lector JSON propio', () => {
  it('[TC-IMPORTS-PIPELINE-020] un JSON v1 con 3 movimientos en BOB produce 3 filas', () => {
    const parsed = reader.parse(bytes('json/valido.json'), OPTIONS);
    expect(parsed.failure).toBeNull();
    expect(parsed.records).toHaveLength(3);
    expect(parsed.records.map((r) => [r.bookingDate, r.amount, r.externalId, r.time])).toEqual([
      ['2026-05-02', '-18.50', 'J-0001', '09:30:00'],
      ['2026-05-10', '500.00', null, null],
      ['2026-05-20', '-245.00', null, null],
    ]);
    expect(parsed.records[1]?.counterparty).toBe('Empleador Demo');
    expect(parsed.statement).toEqual({
      openingBalance: '1000.00',
      closingBalance: '1236.50',
      closingDate: '2026-05-31',
      periodFrom: '2026-05-01',
      periodTo: '2026-05-31',
    });
  });

  it('[TC-IMPORTS-PIPELINE-021] un monto escrito como número falla en la ubicación del monto del segundo movimiento', () => {
    const parsed = reader.parse(bytes('json/monto-numero.json'), OPTIONS);
    expect(parsed.records).toEqual([]);
    expect(parsed.failure).toEqual({ code: 'IMPORT_PARSE_FAILED', pointer: '/movements/1/amount' });
  });

  it('un JSON que no es del esquema o está mal formado falla con su puntero', () => {
    expect(reader.parse(new TextEncoder().encode('{'), OPTIONS).failure).toEqual({
      code: 'IMPORT_PARSE_FAILED',
      pointer: '',
    });
    const wrongVersion = reader.parse(
      encode({ schema: 'pfos.import-file', version: 2, currency: 'BOB', movements: [] }),
      OPTIONS,
    );
    expect(wrongVersion.failure?.pointer).toBe('/version');
    const extra = reader.parse(
      encode({
        schema: 'pfos.import-file',
        version: 1,
        currency: 'BOB',
        movements: [{ date: '2026-01-01', amount: '1', x: 1 }],
      }),
      OPTIONS,
    );
    expect(extra.failure?.pointer).toBe('/movements/0');
  });

  it('un exceso de decimales o una fecha inexistente invalidan la fila y otra moneda las invalida todas', () => {
    const base = { schema: 'pfos.import-file', version: 1 };
    const out = reader.parse(
      encode({
        ...base,
        currency: 'BOB',
        movements: [
          { date: '2026-02-30', amount: '1.00' },
          { date: '2026-02-01', amount: '1.005' },
        ],
      }),
      OPTIONS,
    );
    expect(out.records[0]?.issues.map((i) => i.code)).toEqual(['IMPORT_INVALID_DATE']);
    expect(out.records[1]?.issues.map((i) => i.code)).toEqual(['IMPORT_INVALID_AMOUNT']);
    const usd = reader.parse(
      encode({ ...base, currency: 'USD', movements: [{ date: '2026-02-01', amount: '1.00' }] }),
      OPTIONS,
    );
    expect(usd.records[0]?.issues).toContainEqual({ code: 'IMPORT_CURRENCY_MISMATCH', severity: 'ERROR' });
  });

  it('el límite de filas corta la lectura', () => {
    const doc = {
      schema: 'pfos.import-file',
      version: 1,
      currency: 'BOB',
      movements: Array.from({ length: 3 }, () => ({ date: '2026-01-01', amount: '1.00' })),
    };
    expect(reader.parse(encode(doc), { ...OPTIONS, maxRows: 2 }).failure?.code).toBe('IMPORT_TOO_MANY_ROWS');
  });

  it('[TC-IMPORTS-PIPELINE-011] el detector reconoce el JSON propio por su contenido', () => {
    expect(reader.sniff(bytes('json/valido.json'))?.confidence).toBe('HIGH');
    expect(reader.sniff(new TextEncoder().encode('Fecha;Monto'))).toBeNull();
  });
});

describe('esquemas de contracts/imports', () => {
  const read = (name: string) =>
    JSON.parse(readFileSync(resolve(ROOT, 'contracts/imports', name), 'utf8')) as Record<string, unknown>;

  it('el esquema ejecutable es idéntico al del contrato y sus ejemplos son válidos', () => {
    const file = read('import-file.v1.schema.json');
    expect(file).toEqual(JSON.parse(JSON.stringify(IMPORT_FILE_SCHEMA)));
    const validate = new Ajv2020({ strict: true }).compile(file);
    for (const example of file['examples'] as unknown[]) expect(validate(example)).toBe(true);
  });

  it('imports.profile.v1 es un esquema 2020-12 válido y sus ejemplos cumplen el esquema y el parser', () => {
    const schema = read('imports.profile.v1.schema.json');
    const ajv = new Ajv2020({ strict: true });
    const validate = ajv.compile(schema);
    const examples = schema['examples'] as { mapping?: unknown }[];
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(validate(example)).toBe(true);
      parseProfileOptions(example.mapping ? 'CSV' : 'OFX', example);
    }
  });
});
