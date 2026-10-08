import { readFileSync } from 'node:fs';
import { isDomainError } from '@pf/shared-kernel';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { beforeEach, describe, expect, it } from 'vitest';
import { CustomFieldsQueries } from './custom-fields.queries.js';
import { CustomFieldsService, type DefineCustomFieldCommand } from './custom-fields.service.js';
import { InMemoryClassification } from './testing/in-memory.js';

const WS = '0190d000-0000-7000-8000-00000000000a';
const OTHER_WS = '0190d000-0000-7000-8000-00000000000b';
const USER = '0190d000-0000-7000-8000-0000000000aa';

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (isDomainError(err)) return err.code;
    throw err;
  }
  return undefined;
}

let mem: InMemoryClassification;
let svc: CustomFieldsService;
let q: CustomFieldsQueries;

beforeEach(() => {
  mem = new InMemoryClassification();
  svc = new CustomFieldsService(mem.deps());
  q = new CustomFieldsQueries(mem.deps());
});

const CENTRO_COSTO: DefineCustomFieldCommand = {
  key: 'centro_costo',
  label: 'Centro de costo',
  dataType: 'SELECT',
  target: 'TRANSACTION',
  required: false,
  options: [
    { key: 'casa', label: 'Casa' },
    { key: 'oficina', label: 'Oficina' },
  ],
};
const define = (over: Partial<DefineCustomFieldCommand> = {}) =>
  svc.define(USER, WS, { ...CENTRO_COSTO, ...over });

describe('Definir custom fields (tarea 3.1)', () => {
  it('[TC-CLASSIFICATION-CUSTOMFIELD-001] define el SELECT, audita, emite el evento y lo lista por objetivo', async () => {
    const f = await define();
    expect(f).toMatchObject({ key: 'centro_costo', version: 1, isArchived: false });
    expect((await q.list(USER, WS, { target: 'TRANSACTION' })).map((x) => x.key)).toEqual(['centro_costo']);
    expect(await q.list(USER, WS, { target: 'ACCOUNT' })).toEqual([]);
    expect(mem.audits.at(-1)).toMatchObject({
      action: 'classification.custom_field.defined',
      aggregateType: 'CustomFieldDefinition',
      aggregateId: f.id,
    });
    expect(mem.customFieldEvents).toHaveLength(1);
    expect(mem.customFieldEvents[0]).toMatchObject({
      eventType: 'classification.CustomFieldDefinitionChanged',
      payload: { key: 'centro_costo', change: 'DEFINED', dataType: 'SELECT', target: 'TRANSACTION' },
    });
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-001] SELECT sin opciones ⇒ VALIDATION_FAILED y no se crea nada', async () => {
    expect(await codeOf(define({ key: 'proyecto', options: [] }))).toBe('VALIDATION_FAILED');
    expect(await q.list(USER, WS)).toEqual([]);
    expect(mem.customFieldEvents).toHaveLength(0);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-002] clave repetida entre activas ⇒ CUSTOM_FIELD_KEY_TAKEN; clave inválida ⇒ VALIDATION_FAILED', async () => {
    const first = await define();
    const taken = define();
    expect(await codeOf(taken)).toBe('CUSTOM_FIELD_KEY_TAKEN');
    await expect(taken).rejects.toMatchObject({ details: { existingId: first.id } });
    expect(await codeOf(define({ key: 'Centro Costo' }))).toBe('VALIDATION_FAILED');
    // Otro workspace puede usar la misma clave.
    await svc.define(USER, OTHER_WS, CENTRO_COSTO);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-002] renombrar la etiqueta conserva clave e id; la clave no es editable', async () => {
    const f = await define();
    const renamed = await svc.update(USER, WS, f.id, 1, { label: 'Centro de gasto' });
    expect(renamed).toMatchObject({ id: f.id, key: 'centro_costo', label: 'Centro de gasto', version: 2 });
    expect(mem.audits.at(-1)?.changes).toEqual([
      { field: 'label', before: 'Centro de costo', after: 'Centro de gasto' },
    ]);
    expect(mem.customFieldEvents.at(-1)?.payload.change).toBe('UPDATED');
    // Un parche vacío no sube la versión ni emite evento.
    await svc.update(USER, WS, f.id, 2, { label: 'Centro de gasto' });
    expect(mem.customFieldEvents).toHaveLength(2);
    expect(await codeOf(svc.update(USER, WS, f.id, 1, { label: 'X' }))).toBe('PRECONDITION_FAILED');
  });

  it('límite de 50 definiciones activas por workspace', async () => {
    for (let i = 0; i < 50; i++) await define({ key: `campo_${i}`, dataType: 'TEXT', options: [] });
    expect(await codeOf(define({ key: 'otro', dataType: 'TEXT', options: [] }))).toBe('VALIDATION_FAILED');
  });
});

describe('Cambios protegidos y archivado (tareas 2.1, 3.1)', () => {
  it('[TC-CLASSIFICATION-CUSTOMFIELD-009] con valores: tipo/objetivo bloqueados, opción en uso protegida, agregar opción permitido', async () => {
    const f = await define();
    mem.usage.set(f.id, { hasValues: true, usedOptionKeys: new Set(['oficina']) });
    expect(await codeOf(svc.update(USER, WS, f.id, 1, { dataType: 'TEXT' }))).toBe(
      'CUSTOM_FIELD_TYPE_LOCKED',
    );
    expect(await codeOf(svc.update(USER, WS, f.id, 1, { target: 'ACCOUNT' }))).toBe(
      'CUSTOM_FIELD_TYPE_LOCKED',
    );
    expect(await codeOf(svc.update(USER, WS, f.id, 1, { options: [{ key: 'casa', label: 'Casa' }] }))).toBe(
      'CUSTOM_FIELD_OPTION_IN_USE',
    );
    const ok = await svc.update(USER, WS, f.id, 1, {
      options: [...CENTRO_COSTO.options!, { key: 'taller', label: 'Taller' }],
    });
    expect(ok.optionKeys).toEqual(['casa', 'oficina', 'taller']);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-008] archivar libera la clave; desarchivar con una activa igual ⇒ CUSTOM_FIELD_KEY_TAKEN', async () => {
    const f = await define();
    const archived = await svc.archive(USER, WS, f.id, 1);
    expect(archived.isArchived).toBe(true);
    expect(mem.customFieldEvents.at(-1)?.payload.change).toBe('ARCHIVED');
    expect((await q.list(USER, WS)).map((x) => x.key)).toEqual([]);
    expect((await q.list(USER, WS, { includeArchived: true })).map((x) => x.key)).toEqual(['centro_costo']);
    const again = await define();
    expect(again.id).not.toBe(f.id);
    expect(await codeOf(svc.unarchive(USER, WS, f.id, 2))).toBe('CUSTOM_FIELD_KEY_TAKEN');
    await svc.archive(USER, WS, again.id, 1);
    expect((await svc.unarchive(USER, WS, f.id, 2)).isArchived).toBe(false);
    expect(await codeOf(svc.archive(USER, WS, f.id, 1))).toBe('PRECONDITION_FAILED');
    expect(await codeOf(svc.unarchive(USER, WS, f.id, 3))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-008] una definición inexistente o de otro workspace ⇒ RESOURCE_NOT_FOUND', async () => {
    const f = await define();
    expect(await codeOf(q.get(USER, OTHER_WS, f.id))).toBe('RESOURCE_NOT_FOUND');
    expect(await codeOf(svc.archive(USER, OTHER_WS, f.id, 1))).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('ValidateCustomFieldValues (tarea 3.2)', () => {
  const validate = (
    values: Parameters<CustomFieldsQueries['validateCustomFieldValues']>[2]['items'][number]['values'],
    over: { target?: 'TRANSACTION' | 'ACCOUNT'; requireMandatory?: boolean; existing?: string[] } = {},
  ) =>
    q.validateCustomFieldValues(USER, WS, {
      target: over.target ?? 'TRANSACTION',
      requireMandatory: over.requireMandatory ?? false,
      items: [{ pointer: '/splits/0/customFields', values, existingFieldIds: over.existing ?? [] }],
    });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] valida por tipo, normaliza decimales y resuelve por clave o por id', async () => {
    const litros = await define({ key: 'litros', dataType: 'DECIMAL', options: [] });
    const cc = await define();
    const [r] = await validate([
      { key: 'litros', value: '35.1250' },
      { fieldId: cc.id, value: 'casa' },
    ]);
    expect(r?.set).toEqual([
      { fieldId: litros.id, key: 'litros', valueType: 'NUMBER', value: '35.125' },
      { fieldId: cc.id, key: 'centro_costo', valueType: 'TEXT', value: 'casa' },
    ]);
    expect(await codeOf(validate([{ key: 'litros', value: '1,5' }]))).toBe('CUSTOM_FIELD_VALUE_INVALID');
    expect(await codeOf(validate([{ key: 'centro_costo', value: 'taller' }]))).toBe(
      'CUSTOM_FIELD_VALUE_INVALID',
    );
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] el error apunta al valor; un valor inválido no deja nada persistido', async () => {
    await define({ key: 'cuota', dataType: 'NUMBER', options: [] });
    await expect(validate([{ key: 'cuota', value: '3.5' }])).rejects.toMatchObject({
      code: 'CUSTOM_FIELD_VALUE_INVALID',
      violations: [{ pointer: '/splits/0/customFields/0/value' }],
    });
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-004] un campo de cuenta en una transacción ⇒ CUSTOM_FIELD_TARGET_MISMATCH', async () => {
    await define({ key: 'sucursal', dataType: 'TEXT', target: 'ACCOUNT', options: [] });
    expect(await codeOf(validate([{ key: 'sucursal', value: 'Centro' }]))).toBe(
      'CUSTOM_FIELD_TARGET_MISMATCH',
    );
    const [r] = await validate([{ key: 'sucursal', value: 'Centro' }], { target: 'ACCOUNT' });
    expect(r?.set).toHaveLength(1);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-005] campo inexistente ⇒ REFERENCE_NOT_FOUND; sin fieldId ni key ⇒ VALIDATION_FAILED', async () => {
    expect(await codeOf(validate([{ key: 'no_existe', value: 'x' }]))).toBe('REFERENCE_NOT_FOUND');
    expect(await codeOf(validate([{ value: 'x' }]))).toBe('VALIDATION_FAILED');
    await define();
    expect(
      await codeOf(
        validate([
          { key: 'centro_costo', value: 'casa' },
          { key: 'centro_costo', value: 'oficina' },
        ]),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-006] obligatorio: se exige al validar con requireMandatory (considerando lo ya existente)', async () => {
    const cc = await define({ required: true });
    expect(await codeOf(validate([], { requireMandatory: true }))).toBe('CUSTOM_FIELD_REQUIRED');
    expect(await codeOf(validate([], { requireMandatory: false }))).toBeUndefined();
    expect(await codeOf(validate([], { requireMandatory: true, existing: [cc.id] }))).toBeUndefined();
    // Quitar el valor de un obligatorio al editar también se rechaza.
    expect(
      await codeOf(
        validate([{ key: 'centro_costo', value: null }], { requireMandatory: true, existing: [cc.id] }),
      ),
    ).toBe('CUSTOM_FIELD_REQUIRED');
    expect(
      await codeOf(validate([{ key: 'centro_costo', value: 'casa' }], { requireMandatory: true })),
    ).toBeUndefined();
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-006] un obligatorio de CUENTA no se exige en transacciones', async () => {
    await define({ key: 'sucursal', dataType: 'TEXT', target: 'ACCOUNT', required: true, options: [] });
    expect(await codeOf(validate([], { requireMandatory: true }))).toBeUndefined();
    expect(await codeOf(validate([], { requireMandatory: true, target: 'ACCOUNT' }))).toBe(
      'CUSTOM_FIELD_REQUIRED',
    );
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-008] asignar un campo archivado ⇒ CUSTOM_FIELD_ARCHIVED (por clave o id); lo archivado no se exige', async () => {
    const cc = await define({ required: true });
    await svc.archive(USER, WS, cc.id, 1);
    expect(await codeOf(validate([{ key: 'centro_costo', value: 'casa' }]))).toBe('CUSTOM_FIELD_ARCHIVED');
    expect(await codeOf(validate([{ fieldId: cc.id, value: 'casa' }]))).toBe('CUSTOM_FIELD_ARCHIVED');
    expect(await codeOf(validate([], { requireMandatory: true }))).toBeUndefined();
    // La clave liberada puede reutilizarse: ahora la clave resuelve a la definición activa nueva.
    const nuevo = await define();
    const [r] = await validate([{ key: 'centro_costo', value: 'casa' }]);
    expect(r?.set[0]?.fieldId).toBe(nuevo.id);
  });

  it('límite de 20 valores por registro', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 21; i++) {
      keys.push(`campo_${i}`);
      await define({ key: `campo_${i}`, dataType: 'TEXT', options: [] });
    }
    const all = (n: number) => keys.slice(0, n).map((key) => ({ key, value: 'x' }));
    expect((await validate(all(20)))[0]?.set).toHaveLength(20);
    expect(await codeOf(validate(all(21)))).toBe('VALIDATION_FAILED');
  });
});

describe('Contrato del evento', () => {
  it('classification.CustomFieldDefinitionChanged.v1: el payload producido cumple el schema (Ajv strict)', async () => {
    const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
      addFormatsModule) as unknown as (ajv: Ajv2020) => void;
    const EVENTS = new URL('../../../../../contracts/events/', import.meta.url);
    const load = (p: string) =>
      JSON.parse(readFileSync(new URL(p, EVENTS), 'utf8')) as Record<string, unknown>;
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const schema = load('classification/CustomFieldDefinitionChanged.v1.schema.json');
    ajv.addSchema(load('envelope.v1.schema.json'));
    ajv.addSchema(schema);
    const validate = ajv.compile({ $ref: `${String(schema['$id'])}#/$defs/Payload` });
    const f = await define();
    await svc.update(USER, WS, f.id, 1, { label: 'Otro' });
    await svc.archive(USER, WS, f.id, 2);
    await svc.unarchive(USER, WS, f.id, 3);
    expect(mem.customFieldEvents.map((e) => e.payload.change)).toEqual([
      'DEFINED',
      'UPDATED',
      'ARCHIVED',
      'UNARCHIVED',
    ]);
    for (const e of mem.customFieldEvents) {
      expect(validate(JSON.parse(JSON.stringify(e.payload))), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it('la atomicidad: si falla la auditoría no queda definición ni evento', async () => {
    const deps = mem.deps();
    const failing = new CustomFieldsService({
      ...deps,
      audit: {
        append: async () => {
          throw new Error('audit down');
        },
      },
    });
    await expect(failing.define(USER, WS, CENTRO_COSTO)).rejects.toThrow('audit down');
    expect(await q.list(USER, WS, { includeArchived: true })).toEqual([]);
    expect(mem.customFieldEvents).toHaveLength(0);
  });
});
