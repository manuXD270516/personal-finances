import { dec, isDomainError } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CustomFieldDefinition } from './custom-field.js';
import {
  canonicalDecimal,
  isCalendarDate,
  normalizeCustomFieldValue,
  valueTypeOf,
  type CustomFieldDataType,
} from './custom-field-value.js';

const WS = '0190c000-0000-7000-8000-000000000001';
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (isDomainError(err)) return err.code;
    throw err;
  }
  return undefined;
};

let seq = 0;
const id = () => `0190c000-0000-7000-8000-${(++seq).toString(16).padStart(12, '0')}`;
const centroCosto = (over: Partial<Parameters<typeof CustomFieldDefinition.create>[0]> = {}) =>
  CustomFieldDefinition.create({
    id: id(),
    workspaceId: WS,
    key: 'centro_costo',
    label: 'Centro de costo',
    dataType: 'SELECT',
    target: 'TRANSACTION',
    required: false,
    options: [
      { key: 'casa', label: 'Casa' },
      { key: 'oficina', label: 'Oficina' },
    ],
    position: 0,
    ...over,
  });
const NO_USAGE = { hasValues: false, usedOptionKeys: new Set<string>() };
const IN_USE = { hasValues: true, usedOptionKeys: new Set(['oficina']) };

describe('CustomFieldDefinition (tarea 2.1)', () => {
  it('[TC-CLASSIFICATION-CUSTOMFIELD-001] define un SELECT con sus opciones ordenadas y lo deja activo', () => {
    const f = centroCosto();
    expect(f.snapshot()).toMatchObject({
      key: 'centro_costo',
      label: 'Centro de costo',
      dataType: 'SELECT',
      target: 'TRANSACTION',
      required: false,
      archivedAt: null,
      version: 1,
      options: [
        { key: 'casa', label: 'Casa', position: 0 },
        { key: 'oficina', label: 'Oficina', position: 1 },
      ],
    });
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-001] un SELECT sin opciones, o un tipo no SELECT con opciones ⇒ VALIDATION_FAILED', () => {
    expect(codeOf(() => centroCosto({ key: 'proyecto', options: [] }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => centroCosto({ dataType: 'TEXT', options: [{ key: 'a', label: 'A' }] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => centroCosto({ dataType: 'MULTI_SELECT' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => centroCosto({ dataType: 'MONEY' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => centroCosto({ target: 'TRANSFER' }))).toBe('VALIDATION_FAILED');
    expect(
      codeOf(() =>
        centroCosto({
          options: [
            { key: 'casa', label: 'Casa' },
            { key: 'casa', label: 'Otra' },
          ],
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-002] la clave debe ser snake_case de hasta 40 caracteres', () => {
    for (const key of ['Centro Costo', '1abc', 'centro-costo', '', 'a'.repeat(41), 'Ñandú']) {
      expect(
        codeOf(() => centroCosto({ key })),
        key,
      ).toBe('VALIDATION_FAILED');
    }
    expect(codeOf(() => centroCosto({ key: 'a'.repeat(40) }))).toBeUndefined();
    expect(codeOf(() => centroCosto({ key: 'cuota_2' }))).toBeUndefined();
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-002] la etiqueta se puede cambiar; la clave no tiene mutador', () => {
    const f = centroCosto();
    expect(f.update({ label: 'Centro de gasto' }, IN_USE)).toBe(true);
    expect(f.label).toBe('Centro de gasto');
    expect(f.key).toBe('centro_costo');
    expect(f.version).toBe(2);
    expect(f.update({ label: 'Centro de gasto' }, IN_USE)).toBe(false);
    expect(f.version).toBe(2);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-009] con valores el tipo y el objetivo están bloqueados', () => {
    const f = centroCosto();
    expect(codeOf(() => f.update({ dataType: 'TEXT' }, IN_USE))).toBe('CUSTOM_FIELD_TYPE_LOCKED');
    expect(codeOf(() => f.update({ target: 'ACCOUNT' }, IN_USE))).toBe('CUSTOM_FIELD_TYPE_LOCKED');
    expect(f.dataType).toBe('SELECT');
    expect(f.version).toBe(1);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-009] sin valores el tipo sí cambia (la definición es solo catálogo)', () => {
    const f = centroCosto();
    expect(f.update({ dataType: 'TEXT' }, NO_USAGE)).toBe(true);
    expect(f.snapshot()).toMatchObject({ dataType: 'TEXT', options: [] });
    expect(f.update({ target: 'ACCOUNT' }, NO_USAGE)).toBe(true);
    expect(f.target).toBe('ACCOUNT');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-009] una opción en uso no se elimina; agregar y renombrar sí', () => {
    const f = centroCosto();
    expect(codeOf(() => f.update({ options: [{ key: 'casa', label: 'Casa' }] }, IN_USE))).toBe(
      'CUSTOM_FIELD_OPTION_IN_USE',
    );
    expect(f.optionKeys).toEqual(['casa', 'oficina']);
    f.update(
      {
        options: [
          { key: 'casa', label: 'Hogar' },
          { key: 'oficina', label: 'Oficina' },
          { key: 'taller', label: 'Taller' },
        ],
      },
      IN_USE,
    );
    expect(f.options).toEqual([
      { key: 'casa', label: 'Hogar', position: 0 },
      { key: 'oficina', label: 'Oficina', position: 1 },
      { key: 'taller', label: 'Taller', position: 2 },
    ]);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-008] archivar y desarchivar; repetir ⇒ INVALID_STATUS_TRANSITION; archivada no se edita', () => {
    const f = centroCosto();
    f.archive('2026-10-08T12:00:00Z');
    expect(f.isArchived).toBe(true);
    expect(codeOf(() => f.archive('2026-10-08T12:00:00Z'))).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => f.update({ label: 'X' }, NO_USAGE))).toBe('CUSTOM_FIELD_ARCHIVED');
    f.unarchive();
    expect(f.isArchived).toBe(false);
    expect(codeOf(() => f.unarchive())).toBe('INVALID_STATUS_TRANSITION');
  });
});

const optionKeys = ['casa', 'oficina'];
const check = (dataType: CustomFieldDataType, raw: unknown) =>
  normalizeCustomFieldValue({ dataType, optionKeys }, raw, '/v');

describe('CustomFieldValueValidator (tarea 2.2)', () => {
  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] TEXT 1..500, NUMBER entero, DECIMAL exacto, DATE real, BOOLEAN, SELECT', () => {
    expect(check('TEXT', 'F-001234')).toEqual({ valueType: 'TEXT', value: 'F-001234' });
    expect(check('DECIMAL', '35.125')).toEqual({ valueType: 'NUMBER', value: '35.125' });
    expect(check('NUMBER', '3')).toEqual({ valueType: 'NUMBER', value: '3' });
    expect(check('DATE', '2028-02-29')).toEqual({ valueType: 'DATE', value: '2028-02-29' });
    expect(check('BOOLEAN', false)).toEqual({ valueType: 'BOOLEAN', value: false });
    expect(check('SELECT', 'casa')).toEqual({ valueType: 'TEXT', value: 'casa' });
  });

  it.each([
    ['TEXT', ''],
    ['TEXT', '   '],
    ['TEXT', 'x'.repeat(501)],
    ['TEXT', 5],
    ['NUMBER', '3.5'],
    ['NUMBER', 3],
    ['NUMBER', '1234567890123456'],
    ['NUMBER', '03'],
    ['NUMBER', '1e3'],
    ['DECIMAL', '1.1234567890123456789'],
    ['DECIMAL', '35,5'],
    ['DECIMAL', 35.125],
    ['DECIMAL', '.5'],
    ['DATE', '2026-02-30'],
    ['DATE', '2026-13-01'],
    ['DATE', '2027-02-29'],
    ['DATE', '26-02-03'],
    ['DATE', '2026-2-3'],
    ['BOOLEAN', 'si'],
    ['BOOLEAN', 'true'],
    ['BOOLEAN', 1],
    ['SELECT', 'taller'],
    ['SELECT', 'Casa'],
  ] as const)(
    '[TC-CLASSIFICATION-CUSTOMFIELD-003] %s rechaza %j con CUSTOM_FIELD_VALUE_INVALID',
    (type, raw) => {
      expect(codeOf(() => check(type, raw))).toBe('CUSTOM_FIELD_VALUE_INVALID');
    },
  );

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] DATE: años bisiestos y bordes de mes', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2100-02-29')).toBe(false);
    expect(isCalendarDate('2000-02-29')).toBe(true);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2026-12-31')).toBe(true);
    expect(isCalendarDate('0000-01-01')).toBe(false);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] valueTypeOf: NUMBER y DECIMAL comparten columna; SELECT es texto', () => {
    expect(valueTypeOf('NUMBER')).toBe(valueTypeOf('DECIMAL'));
    expect(valueTypeOf('SELECT')).toBe('TEXT');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] PBT: decimales de hasta 18 decimales conservan su valor exacto (string → Decimal → string)', () => {
    const decimalArb = fc
      .tuple(
        fc.boolean(),
        fc.bigInt({ min: 0n, max: 10n ** 20n - 1n }),
        fc.option(fc.stringMatching(/^[0-9]{1,18}$/u), { nil: undefined }),
      )
      .map(([neg, whole, frac]) => `${neg ? '-' : ''}${whole}${frac === undefined ? '' : `.${frac}`}`);
    fc.assert(
      fc.property(decimalArb, (text) => {
        const out = check('DECIMAL', text);
        const value = String(out.value);
        // Mismo valor numérico exacto (decimal.js, sin punto flotante) …
        expect(dec(value).equals(dec(text))).toBe(true);
        // … forma canónica idempotente y sin ceros finales …
        expect(canonicalDecimal(value)).toBe(value);
        expect(value).not.toMatch(/\.[0-9]*0$/u);
        expect(value).not.toBe('-0');
        // … que sobrevive al relleno de `numeric(38,18)` (la base devuelve 18 decimales).
        const [whole = '', frac = ''] = value.split('.');
        const padded = `${whole}.${frac.padEnd(18, '0')}`;
        expect(check('DECIMAL', padded).value).toBe(value);
      }),
    );
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] PBT: enteros NUMBER de hasta 15 dígitos ida y vuelta; 16 dígitos se rechazan', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 15n) + 1n, max: 10n ** 15n - 1n }), (n) => {
        expect(check('NUMBER', n.toString()).value).toBe(n.toString());
      }),
    );
    expect(codeOf(() => check('NUMBER', (10n ** 15n).toString()))).toBe('CUSTOM_FIELD_VALUE_INVALID');
  });
});
