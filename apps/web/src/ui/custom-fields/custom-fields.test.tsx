import { readFileSync } from 'node:fs';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CustomFieldsPanel } from '../classification/CustomFieldsPanel';
import { optionsPayload, slugKey } from '../classification/custom-fields-logic';
import type { WorkspaceContext } from '../common/workspace';
import { esContext, textOf } from '../test-support';
import { EMPTY_TRANSACTION_FILTERS, transactionsQuery } from '../transactions/logic';
import { CustomFieldInputs } from './CustomFieldInputs';
import { CustomFieldValuesView } from './CustomFieldValuesView';
import {
  buildFieldsPayload,
  customFieldParams,
  displayValue,
  normalizeDecimal,
  parseFieldValue,
  toInputText,
  valuesOf,
  type CustomFieldDefinition,
} from './logic';

const f = esContext('CustomFields');
const messages = JSON.parse(
  readFileSync(new URL('../../../messages/es.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const def = (
  over: Partial<CustomFieldDefinition> & Pick<CustomFieldDefinition, 'key' | 'dataType'>,
): CustomFieldDefinition => ({
  id: `id-${over.key}`,
  label: over.key,
  target: 'TRANSACTION',
  required: false,
  options: [],
  position: 0,
  version: 1,
  ...over,
});
const centroCosto = def({
  key: 'centro_costo',
  label: 'Centro de costo',
  dataType: 'SELECT',
  options: [
    { key: 'casa', label: 'Casa', position: 0 },
    { key: 'oficina', label: 'Oficina', position: 1 },
  ],
});
const litros = def({ key: 'litros', label: 'Litros', dataType: 'DECIMAL', position: 1 });
const cuota = def({ key: 'cuota', label: 'Cuota', dataType: 'NUMBER', position: 2 });
const garantia = def({ key: 'garantia_hasta', label: 'Garantía hasta', dataType: 'DATE', position: 3 });
const deducible = def({ key: 'deducible', label: 'Deducible', dataType: 'BOOLEAN', position: 4 });
const factura = def({ key: 'factura', label: 'Factura', dataType: 'TEXT', position: 5, required: true });

describe('valores escritos → valores exactos (add-custom-fields 6.1, INV-001)', () => {
  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] DECIMAL tolerante al locale se envía como string con punto, jamás como número', () => {
    expect(parseFieldValue(litros, '35,125', 'es-BO')).toEqual({ ok: true, value: '35.125' });
    expect(parseFieldValue(litros, '1.234,50', 'es-BO')).toEqual({ ok: true, value: '1234.50' });
    expect(parseFieldValue(litros, '-0,5', 'es-BO')).toEqual({ ok: true, value: '-0.5' });
    expect(parseFieldValue(litros, '1.1234567890123456789', 'en-US')).toEqual({
      ok: false,
      error: 'INVALID_DECIMAL',
    });
    expect(parseFieldValue(litros, 'abc', 'es-BO')).toEqual({ ok: false, error: 'INVALID_DECIMAL' });
    expect(normalizeDecimal('12,5', 'es-BO')).toBe('12.5');
    const r = parseFieldValue(litros, '35.125', 'en-US');
    expect(r.ok && typeof r.value).toBe('string');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] NUMBER entero, DATE real, BOOLEAN y vacíos', () => {
    expect(parseFieldValue(cuota, '3', 'es-BO')).toEqual({ ok: true, value: '3' });
    expect(parseFieldValue(cuota, '3,5', 'es-BO')).toEqual({ ok: false, error: 'INVALID_INTEGER' });
    expect(parseFieldValue(cuota, '1234567890123456', 'es-BO')).toEqual({
      ok: false,
      error: 'INVALID_INTEGER',
    });
    expect(parseFieldValue(garantia, '2028-02-29', 'es-BO')).toEqual({ ok: true, value: '2028-02-29' });
    expect(parseFieldValue(garantia, '2026-02-30', 'es-BO')).toEqual({ ok: false, error: 'INVALID_DATE' });
    expect(parseFieldValue(deducible, 'false', 'es-BO')).toEqual({ ok: true, value: false });
    expect(parseFieldValue(deducible, 'true', 'es-BO')).toEqual({ ok: true, value: true });
    expect(parseFieldValue(factura, '   ', 'es-BO')).toEqual({ ok: true, value: null });
    expect(parseFieldValue(factura, 'x'.repeat(501), 'es-BO')).toEqual({ ok: false, error: 'TOO_LONG' });
  });
});

describe('cuerpo de customFields (altas y ediciones)', () => {
  const defs = [centroCosto, litros, factura];

  it('[TC-CLASSIFICATION-CUSTOMFIELD-006] al crear solo viajan los campos con valor y los obligatorios vacíos se señalan', () => {
    expect(
      buildFieldsPayload(defs, { centro_costo: 'casa', litros: '35,125' }, 'es-BO', {
        requireMandatory: true,
      }),
    ).toEqual({
      values: { centro_costo: 'casa', litros: '35.125' },
      errors: { factura: 'REQUIRED' },
    });
    expect(
      buildFieldsPayload(defs, { centro_costo: 'casa', litros: '35,125', factura: 'F-1' }, 'es-BO', {
        requireMandatory: true,
      }),
    ).toEqual({ values: { centro_costo: 'casa', litros: '35.125', factura: 'F-1' }, errors: {} });
    expect(
      buildFieldsPayload(defs, { litros: 'x', factura: 'F-1' }, 'es-BO', { requireMandatory: true }).errors,
    ).toEqual({
      litros: 'INVALID_DECIMAL',
    });
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-007] al editar solo viajan los campos tocados que cambiaron; vaciar uno con valor lo quita (null); un registro previo sin el obligatorio no bloquea', () => {
    const original = { centro_costo: 'casa', litros: '35.125' };
    // Sin tocar nada: intactos (un decimal guardado "35.125" no se reinterpreta como miles en es-BO).
    expect(buildFieldsPayload(defs, {}, 'es-BO', { original, requireMandatory: false })).toEqual({
      values: undefined,
      errors: {},
    });
    // Cambiar la selección y vaciar el decimal.
    expect(
      buildFieldsPayload(defs, { centro_costo: 'oficina', litros: '' }, 'es-BO', {
        original,
        requireMandatory: false,
      }),
    ).toEqual({ values: { centro_costo: 'oficina', litros: null }, errors: {} });
    // Reescribir el mismo decimal con otra forma equivale al guardado (no se envía).
    expect(
      buildFieldsPayload(defs, { centro_costo: 'casa', litros: '35,1250' }, 'es-BO', {
        original,
        requireMandatory: false,
      }),
    ).toEqual({ values: undefined, errors: {} });
    // Editar un registro previo sin el obligatorio (factura) no lo exige.
    expect(
      buildFieldsPayload(defs, { centro_costo: 'oficina' }, 'es-BO', { original, requireMandatory: false })
        .errors,
    ).toEqual({});
  });

  it('el decimal guardado se muestra con el separador del locale y vuelve a interpretarse igual', () => {
    expect(toInputText(litros, '35.125', 'es-BO')).toBe('35,125');
    expect(toInputText(litros, '35.125', 'en-US')).toBe('35.125');
    expect(toInputText(deducible, false, 'es-BO')).toBe('false');
    expect(toInputText(litros, null, 'es-BO')).toBe('');
    for (const locale of ['es-BO', 'en-US', 'pt-BR']) {
      expect(parseFieldValue(litros, toInputText(litros, '1234.5678', locale), locale)).toEqual({
        ok: true,
        value: '1234.5678',
      });
      expect(parseFieldValue(litros, toInputText(litros, '35.125', locale), locale)).toEqual({
        ok: true,
        value: '35.125',
      });
    }
  });

  it('los campos archivados no se editan: su valor histórico se conserva y se muestra con su etiqueta', () => {
    const archived = def({
      key: 'viejo',
      label: 'Campo viejo',
      dataType: 'TEXT',
      archivedAt: '2026-10-01T00:00:00Z',
    });
    const original = { viejo: 'dato', centro_costo: 'casa' };
    expect(
      buildFieldsPayload([centroCosto], {}, 'es-BO', { original, requireMandatory: false }).values,
    ).toBeUndefined();
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={messages}>
        <CustomFieldValuesView definitions={[centroCosto, archived]} values={original} f={f} />
      </NextIntlClientProvider>,
    );
    expect(textOf(html)).toContain('Campo viejo (archivado)dato');
    expect(textOf(html)).toContain('Centro de costoCasa');
  });

  it('displayValue y valuesOf: etiqueta de la opción, Sí/No, fecha local y orden de las definiciones', () => {
    const labels = { yes: 'Sí', no: 'No', date: (iso: string) => iso.split('-').reverse().join('/') };
    expect(displayValue(centroCosto, 'oficina', labels)).toBe('Oficina');
    expect(displayValue(deducible, false, labels)).toBe('No');
    expect(displayValue(garantia, '2028-02-29', labels)).toBe('29/02/2028');
    expect(displayValue(litros, '35.125', labels)).toBe('35.125');
    const items = valuesOf([litros, centroCosto], { litros: '1', centro_costo: 'casa', desconocido: 'x' });
    expect(items.map((i) => i.key)).toEqual(['centro_costo', 'litros', 'desconocido']);
  });
});

describe('filtro del registro [TC-TRANSACTIONS-CUSTOMFIELD-002]', () => {
  it('igualdad y rango como customField[clave], [gte] y [lte]; decimales normalizados; valores inválidos se omiten', () => {
    const eq = { key: 'centro_costo', eq: 'oficina', from: '', to: '' };
    expect(customFieldParams(centroCosto, eq, 'es-BO')).toEqual([['customField[centro_costo]', 'oficina']]);
    const range = { key: 'litros', eq: '', from: '10,5', to: '40' };
    expect(customFieldParams(litros, range, 'es-BO')).toEqual([
      ['customField[litros][gte]', '10.5'],
      ['customField[litros][lte]', '40'],
    ]);
    expect(customFieldParams(litros, { ...range, from: 'abc', to: '' }, 'es-BO')).toEqual([]);
    expect(customFieldParams(undefined, eq, 'es-BO')).toEqual([]);
    const q = transactionsQuery({ ...EMPTY_TRANSACTION_FILTERS, customField: eq }, null, {
      definition: centroCosto,
      locale: 'es-BO',
    });
    expect(q.get('customField[centro_costo]')).toBe('oficina');
    expect(q.toString()).toContain('customField%5Bcentro_costo%5D=oficina');
    expect(transactionsQuery(EMPTY_TRANSACTION_FILTERS).toString()).toBe('limit=50');
  });
});

describe('controles dinámicos por tipo (a11y: cada control con su etiqueta)', () => {
  it('SELECT, DECIMAL, NUMBER, DATE, BOOLEAN y TEXT con etiqueta, inputmode y marca de obligatorio', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={messages}>
        <CustomFieldInputs
          fields={[centroCosto, litros, cuota, garantia, deducible, factura]}
          draft={{ centro_costo: 'oficina', litros: '35,125' }}
          errors={{ factura: 'REQUIRED' }}
          f={f}
          idPrefix="split-0-cf"
          suffix="(1)"
          onChange={() => undefined}
        />
      </NextIntlClientProvider>,
    );
    const text = textOf(html);
    for (const label of [
      'Centro de costo (1)',
      'Litros (1)',
      'Cuota (1)',
      'Garantía hasta (1)',
      'Deducible (1)',
      'Factura (1)',
    ])
      expect(text).toContain(label);
    expect(html).toContain('<option value="oficina" selected="">Oficina</option>');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('type="date"');
    expect(html).toContain('aria-required="true"');
    expect(text).toContain('Este campo es obligatorio.');
    expect(html).toContain('aria-invalid="true"');
    expect((html.match(/<label /g) ?? []).length).toBe(6);
  });
});

describe('pantalla Campos personalizados (add-custom-fields 6.1)', () => {
  const ctx = {
    base: '/workspaces/w1',
    canEdit: true,
    formatLocale: 'es-BO',
    timeZone: 'America/La_Paz',
    uiLocale: 'es',
    me: { id: 'u1' },
    api: { get: () => new Promise(() => undefined) },
  } as unknown as WorkspaceContext;
  const render = (canEdit: boolean, definitions: readonly CustomFieldDefinition[]) =>
    renderToStaticMarkup(
      <NextIntlClientProvider locale="es" messages={messages}>
        <CustomFieldsPanel ctx={{ ...ctx, canEdit }} definitions={definitions} run={async () => true} />
      </NextIntlClientProvider>,
    );

  it('lista las definiciones con tipo, entidad, obligatorio y archivado; un VIEWER no ve acciones ni formulario', () => {
    const archived = def({
      key: 'viejo',
      label: 'Viejo',
      dataType: 'TEXT',
      archivedAt: '2026-10-01T00:00:00Z',
      position: 9,
    });
    const editor = render(true, [centroCosto, factura, archived]);
    const text = textOf(editor);
    expect(text).toContain('Centro de costo');
    expect(text).toContain('Casa · Oficina');
    expect(text).toContain('Selección');
    expect(text).toContain('obligatorio');
    expect(text).toContain('archivado');
    expect(editor).toContain('aria-label="Subir Factura"');
    expect(editor).toContain('aria-label="Desarchivar Viejo"');
    expect(editor).toContain('data-testid="custom-field-form"');
    const viewer = render(false, [centroCosto]);
    expect(viewer).not.toContain('custom-field-form');
    expect(viewer).not.toContain('Archivar');
    expect(textOf(render(true, []))).toContain('Aún no hay campos personalizados.');
  });
});

describe('claves y opciones (formulario de definición)', () => {
  it('slugKey: minúsculas sin acentos, guion bajo, empieza con letra y ≤ 40 caracteres', () => {
    expect(slugKey('Centro de costo')).toBe('centro_costo'.replace('centro_costo', 'centro_de_costo'));
    expect(slugKey('Número de factura')).toBe('numero_de_factura');
    expect(slugKey('2026 meta')).toBe('c_2026_meta');
    expect(slugKey('  ¡Hola!  ')).toBe('hola');
    expect(slugKey('x'.repeat(60)).length).toBe(40);
    expect(slugKey('')).toBe('');
  });

  it('optionsPayload: claves derivadas, sin repetidos ni vacías', () => {
    expect(
      optionsPayload([
        { key: '', label: 'Casa' },
        { key: 'oficina', label: 'Oficina' },
        { key: '', label: '' },
      ]),
    ).toEqual({
      options: [
        { key: 'casa', label: 'Casa' },
        { key: 'oficina', label: 'Oficina' },
      ],
    });
    expect(optionsPayload([{ key: '', label: '' }])).toEqual({ error: 'optionsRequired' });
    expect(
      optionsPayload([
        { key: 'a', label: 'A' },
        { key: 'a', label: 'B' },
      ]),
    ).toEqual({ error: 'optionKeyDuplicated' });
    expect(optionsPayload([{ key: 'A!', label: 'A' }])).toEqual({ error: 'optionKeyInvalid' });
    expect(optionsPayload([{ key: 'a', label: '' }])).toEqual({ error: 'optionLabelRequired' });
  });
});
