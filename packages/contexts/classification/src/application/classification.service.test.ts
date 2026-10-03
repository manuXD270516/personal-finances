import { readFileSync } from 'node:fs';
import { isDomainError } from '@pf/shared-kernel';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { NameTakenError } from '../domain/errors.js';
import { ClassificationQueries } from './classification.queries.js';
import { ClassificationService } from './classification.service.js';
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
let svc: ClassificationService;
let q: ClassificationQueries;

beforeEach(() => {
  mem = new InMemoryClassification();
  svc = new ClassificationService(mem.deps());
  q = new ClassificationQueries(mem.deps());
});

const expenseGroup = (name = 'Alimentación') => svc.createCategoryGroup(USER, WS, { name, kind: 'EXPENSE' });

describe('Categorías y grupos (tarea 4.1)', () => {
  it('[TC-CLASSIFICATION-CATEGORY-001] crea con icono y color; nombre duplicado entre hermanas ⇒ NAME_TAKEN sin crear', async () => {
    const g = await expenseGroup();
    const c = await svc.createCategory(USER, WS, {
      groupId: g.id,
      name: 'Supermercado',
      icon: 'cart',
      color: '#2E7D32',
    });
    expect(c).toMatchObject({
      kind: 'EXPENSE',
      icon: 'cart',
      color: '#2E7D32',
      isArchived: false,
      version: 1,
    });
    const dup = svc.createCategory(USER, WS, { groupId: g.id, name: 'supermercado' });
    await expect(dup).rejects.toBeInstanceOf(NameTakenError);
    await expect(dup).rejects.toMatchObject({ code: 'NAME_TAKEN', existingId: c.id });
    expect((await q.listCategories(USER, WS)).map((x) => x.name)).toEqual(['Supermercado']);
    // Mismo nombre bajo otro padre del mismo grupo sí se permite (design §5).
    const otra = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Restaurantes' });
    await svc.createCategory(USER, WS, { groupId: g.id, parentId: c.id, name: 'Otros' });
    await svc.createCategory(USER, WS, { groupId: g.id, parentId: otra.id, name: 'Otros' });
    expect(mem.audits.map((a) => a.action)).toContain('classification.category.created');
  });

  it('[TC-CLASSIFICATION-KIND-001] mover a un grupo de ingreso ⇒ CATEGORY_KIND_MISMATCH sin cambios; a otro de gasto se acepta y mueve sus subcategorías', async () => {
    const alimentacion = await expenseGroup();
    const ingresos = await svc.createCategoryGroup(USER, WS, { name: 'Ingresos laborales', kind: 'INCOME' });
    const ocio = await expenseGroup('Ocio');
    const rest = await svc.createCategory(USER, WS, { groupId: alimentacion.id, name: 'Restaurantes' });
    const sub = await svc.createCategory(USER, WS, {
      groupId: alimentacion.id,
      parentId: rest.id,
      name: 'Pizza',
    });
    expect(await codeOf(svc.updateCategory(USER, WS, rest.id, 1, { groupId: ingresos.id }))).toBe(
      'CATEGORY_KIND_MISMATCH',
    );
    expect((await q.getCategory(USER, WS, rest.id)).groupId).toBe(alimentacion.id);
    const moved = await svc.updateCategory(USER, WS, rest.id, 1, { groupId: ocio.id });
    expect(moved).toMatchObject({ groupId: ocio.id, kind: 'EXPENSE', version: 2 });
    expect((await q.getCategory(USER, WS, sub.id)).groupId).toBe(ocio.id);
  });

  it('[TC-CLASSIFICATION-RENAME-001] renombrar conserva id y audita nombre anterior y nuevo', async () => {
    const g = await expenseGroup();
    const c = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const renamed = await svc.updateCategory(USER, WS, c.id, 1, { name: 'Supermercado' });
    expect(renamed).toMatchObject({ id: c.id, name: 'Supermercado', version: 2 });
    expect(mem.audits.at(-1)).toMatchObject({
      action: 'classification.category.updated',
      aggregateId: c.id,
      changes: [{ field: 'name', before: 'Super', after: 'Supermercado' }],
    });
    expect(await codeOf(svc.updateCategory(USER, WS, c.id, 1, { name: 'X' }))).toBe('PRECONDITION_FAILED');
  });

  it('[TC-CLASSIFICATION-ARCHIVE-003] archivar en cascada: padre e hijas en la misma operación, un evento por categoría', async () => {
    const g = await expenseGroup('Vivienda');
    const sb = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Servicios básicos' });
    const luz = await svc.createCategory(USER, WS, { groupId: g.id, parentId: sb.id, name: 'Luz' });
    const agua = await svc.createCategory(USER, WS, { groupId: g.id, parentId: sb.id, name: 'Agua' });
    await svc.archiveCategory(USER, WS, sb.id, 1);
    for (const id of [sb.id, luz.id, agua.id])
      expect((await q.getCategory(USER, WS, id)).isArchived).toBe(true);
    expect(mem.events.map((e) => [e.aggregateId, e.payload.cascadedFromCategoryId])).toEqual([
      [sb.id, null],
      [luz.id, sb.id],
      [agua.id, sb.id],
    ]);
    // Desarchivar una subcategoría con padre archivado ⇒ CATEGORY_ARCHIVED.
    expect(await codeOf(svc.unarchiveCategory(USER, WS, luz.id, 2))).toBe('CATEGORY_ARCHIVED');
  });

  it('[TC-CLASSIFICATION-ARCHIVE-001] archivar conserva identidad y datos; el archivado es reversible', async () => {
    const g = await expenseGroup('Ocio');
    const gym = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Old Gym', color: '#6A1B9A' });
    const archived = await svc.archiveCategory(USER, WS, gym.id, 1);
    expect(archived).toMatchObject({
      id: gym.id,
      name: 'Old Gym',
      color: '#6A1B9A',
      archivedAt: expect.any(String),
    });
    const restored = await svc.unarchiveCategory(USER, WS, gym.id, 2);
    expect(restored).toMatchObject({ id: gym.id, archivedAt: null, version: 3 });
  });

  it('archivar un grupo exige categorías archivadas (CATEGORY_GROUP_NOT_EMPTY); desarchivar valida NAME_TAKEN', async () => {
    const g = await expenseGroup('Ocio');
    const c = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Cine' });
    expect(await codeOf(svc.archiveCategoryGroup(USER, WS, g.id, 1))).toBe('CATEGORY_GROUP_NOT_EMPTY');
    await svc.archiveCategory(USER, WS, c.id, 1);
    await svc.archiveCategoryGroup(USER, WS, g.id, 1);
    await expenseGroup('ocio');
    expect(await codeOf(svc.unarchiveCategoryGroup(USER, WS, g.id, 2))).toBe('NAME_TAKEN');
  });

  it('reordenar hermanas activas: orden persistente; un conjunto distinto ⇒ VALIDATION_FAILED', async () => {
    const g = await expenseGroup();
    const a = await svc.createCategory(USER, WS, { groupId: g.id, name: 'A' });
    const b = await svc.createCategory(USER, WS, { groupId: g.id, name: 'B' });
    const c = await svc.createCategory(USER, WS, { groupId: g.id, name: 'C' });
    await svc.reorderCategories(USER, WS, { groupId: g.id, parentId: null, orderedIds: [c.id, a.id, b.id] });
    expect((await q.listCategories(USER, WS)).map((x) => x.name)).toEqual(['C', 'A', 'B']);
    expect(
      await codeOf(
        svc.reorderCategories(USER, WS, { groupId: g.id, parentId: null, orderedIds: [a.id, b.id] }),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('Categorías de sistema (tarea 4.2)', () => {
  it('[TC-CLASSIFICATION-SYSTEM-001] un workspace nuevo sin catálogo tiene exactamente las 11 de sistema; reprovisionar no duplica', async () => {
    await svc.onWorkspaceCreated({ workspaceId: WS, userId: USER, seedDefaultCategories: false });
    const all = await q.listCategories(USER, WS, { includeArchived: true });
    expect(all).toHaveLength(11);
    expect(all.every((c) => c.isSystem)).toBe(true);
    expect(new Set(all.map((c) => c.systemCode)).size).toBe(11);
    const again = await svc.provisionSystemCategories(USER, WS);
    expect(again).toMatchObject({ createdCategories: 0, createdGroups: 0, skipped: 11 });
    expect(await q.listCategories(USER, WS, { includeArchived: true })).toHaveLength(11);
    expect((await q.listCategoryGroups(USER, WS)).map((g) => `${g.kind}:${g.name}`)).toEqual([
      'EXPENSE:Finanzas',
      'EXPENSE:Otros gastos',
      'INCOME:Otros ingresos',
    ]);
    // La provisión al crear el workspace no escribe auditoría propia (la cubre identity.workspace.created).
    expect(mem.audits).toEqual([]);
  });

  it('[TC-CLASSIFICATION-SYSTEM-002] archivar o renombrar FEES ⇒ SYSTEM_CATEGORY_IMMUTABLE; el color sí cambia', async () => {
    await svc.provisionSystemCategories(USER, WS);
    const fees = (await q.listCategories(USER, WS)).find((c) => c.systemCode === 'FEES');
    if (!fees) throw new Error('FEES missing');
    expect(await codeOf(svc.archiveCategory(USER, WS, fees.id, 1))).toBe('SYSTEM_CATEGORY_IMMUTABLE');
    expect(await codeOf(svc.updateCategory(USER, WS, fees.id, 1, { name: 'Cargos' }))).toBe(
      'SYSTEM_CATEGORY_IMMUTABLE',
    );
    const colored = await svc.updateCategory(USER, WS, fees.id, 1, { color: '#C62828' });
    expect(colored).toMatchObject({ systemCode: 'FEES', color: '#C62828', isArchived: false });
    // El grupo que contiene categorías de sistema no se archiva (regla de grupo no vacío).
    expect(await codeOf(svc.archiveCategoryGroup(USER, WS, fees.groupId, 1))).toBe(
      'CATEGORY_GROUP_NOT_EMPTY',
    );
  });
});

describe('Tags y counterparties (tarea 4.4)', () => {
  it('[TC-CLASSIFICATION-TAG-001] crea con color; nombre equivalente ⇒ NAME_TAKEN', async () => {
    await svc.createTag(USER, WS, { name: 'Trabajo' });
    const t = await svc.createTag(USER, WS, { name: 'Viaje Santa Cruz 2026', color: '#1565C0' });
    expect(t).toMatchObject({ color: '#1565C0', isArchived: false });
    expect(await codeOf(svc.createTag(USER, WS, { name: 'trabajo' }))).toBe('NAME_TAKEN');
  });

  it('[TC-CLASSIFICATION-TAG-005] renombrar un tag conserva su id (las asignaciones no cambian)', async () => {
    const t = await svc.createTag(USER, WS, { name: 'Viaje SCZ' });
    const r = await svc.updateTag(USER, WS, t.id, 1, { name: 'Viaje Santa Cruz 2026' });
    expect(r).toMatchObject({ id: t.id, name: 'Viaje Santa Cruz 2026', version: 2 });
    expect(mem.audits.at(-1)?.changes).toEqual([
      { field: 'name', before: 'Viaje SCZ', after: 'Viaje Santa Cruz 2026' },
    ]);
  });

  it('[TC-CLASSIFICATION-COUNTERPARTY-001] default category activa; nombre equivalente ⇒ NAME_TAKEN; default archivada ⇒ CATEGORY_ARCHIVED', async () => {
    const g = await expenseGroup();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const gym = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Old Gym' });
    await svc.archiveCategory(USER, WS, gym.id, 1);
    const tigo = await svc.createCounterparty(USER, WS, { name: 'Tigo Bolivia', kind: 'SERVICE_PROVIDER' });
    const hiper = await svc.createCounterparty(USER, WS, {
      name: 'Hipermaxi',
      kind: 'MERCHANT',
      defaultCategoryId: sup.id,
    });
    expect(hiper).toMatchObject({ defaultCategoryId: sup.id, isArchived: false });
    await expect(svc.createCounterparty(USER, WS, { name: 'TIGO bolivia' })).rejects.toMatchObject({
      code: 'NAME_TAKEN',
      existingId: tigo.id,
    });
    expect(
      await codeOf(
        svc.createCounterparty(USER, WS, { name: 'Gimnasio X', kind: 'MERCHANT', defaultCategoryId: gym.id }),
      ),
    ).toBe('CATEGORY_ARCHIVED');
  });

  it('[TC-CLASSIFICATION-ALIAS-002] un alias en uso por otra counterparty ⇒ COUNTERPARTY_ALIAS_TAKEN sin cambios', async () => {
    await svc.createCounterparty(USER, WS, { name: 'PedidosYa', aliases: ['pedidos ya'] });
    const yaigo = await svc.createCounterparty(USER, WS, { name: 'Yaigo' });
    expect(await codeOf(svc.updateCounterparty(USER, WS, yaigo.id, 1, { aliases: ['Pedidos Ya'] }))).toBe(
      'COUNTERPARTY_ALIAS_TAKEN',
    );
    expect((await q.getCounterparty(USER, WS, yaigo.id)).aliases).toEqual([]);
  });

  it('sugerencia de categoría: DEFAULT, luego LAST_USED (activa y del tipo), si no NONE', async () => {
    const g = await expenseGroup();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const cp = await svc.createCounterparty(USER, WS, { name: 'Fidalga' });
    expect(await q.getCategorySuggestion(USER, WS, cp.id, 'EXPENSE')).toEqual({
      categoryId: null,
      source: 'NONE',
    });
    mem.lastUsed.set(`${cp.id}:EXPENSE`, sup.id);
    expect(await q.getCategorySuggestion(USER, WS, cp.id, 'EXPENSE')).toEqual({
      categoryId: sup.id,
      source: 'LAST_USED',
    });
    await svc.updateCounterparty(USER, WS, cp.id, 1, { defaultCategoryId: sup.id });
    expect(await q.getCategorySuggestion(USER, WS, cp.id, 'EXPENSE')).toEqual({
      categoryId: sup.id,
      source: 'DEFAULT',
    });
  });
});

describe('ValidateClassification (tarea 4.5)', () => {
  it('[TC-CLASSIFICATION-ARCHIVE-002] categoría archivada ⇒ CATEGORY_ARCHIVED y no aparece en el listado por defecto', async () => {
    const g = await expenseGroup('Ocio');
    const gym = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Old Gym' });
    await svc.archiveCategory(USER, WS, gym.id, 1);
    expect(
      await codeOf(
        q.validateClassification(USER, WS, { categoryIds: [{ categoryId: gym.id, splitKind: 'EXPENSE' }] }),
      ),
    ).toBe('CATEGORY_ARCHIVED');
    expect((await q.listCategories(USER, WS)).map((c) => c.id)).not.toContain(gym.id);
    expect(
      (await q.listCategories(USER, WS, { includeArchived: true })).find((c) => c.id === gym.id)?.archivedAt,
    ).toEqual(expect.any(String));
  });

  it('[TC-CLASSIFICATION-KIND-002] ingreso con categoría de gasto ⇒ CATEGORY_KIND_MISMATCH; reembolso con gasto se acepta', async () => {
    const g = await expenseGroup();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    expect(
      await codeOf(
        q.validateClassification(USER, WS, { categoryIds: [{ categoryId: sup.id, splitKind: 'INCOME' }] }),
      ),
    ).toBe('CATEGORY_KIND_MISMATCH');
    await q.validateClassification(USER, WS, { categoryIds: [{ categoryId: sup.id, splitKind: 'REFUND' }] });
    expect(
      await codeOf(
        q.validateClassification(USER, OTHER_WS, {
          categoryIds: [{ categoryId: sup.id, splitKind: 'EXPENSE' }],
        }),
      ),
    ).toBe('REFERENCE_NOT_FOUND');
  });

  it('[TC-CLASSIFICATION-TAG-004] tag archivado ⇒ TAG_ARCHIVED y fuera del listado por defecto', async () => {
    const t = await svc.createTag(USER, WS, { name: 'Viaje Santa Cruz 2026' });
    await svc.archiveTag(USER, WS, t.id, 1);
    expect(await codeOf(q.validateClassification(USER, WS, { tagIds: [t.id] }))).toBe('TAG_ARCHIVED');
    expect(await q.listTags(USER, WS)).toEqual([]);
  });

  it('[TC-CLASSIFICATION-COUNTERPARTY-004] counterparty archivada ⇒ COUNTERPARTY_ARCHIVED y fuera del listado por defecto', async () => {
    const entel = await svc.createCounterparty(USER, WS, { name: 'Entel', kind: 'SERVICE_PROVIDER' });
    await svc.archiveCounterparty(USER, WS, entel.id, 1);
    expect(await codeOf(q.validateClassification(USER, WS, { counterpartyId: entel.id }))).toBe(
      'COUNTERPARTY_ARCHIVED',
    );
    expect(await q.listCounterparties(USER, WS)).toEqual([]);
  });

  it('[TC-CLASSIFICATION-DELETE-001] INV-019 (propiedades): ∀ secuencia crear/archivar/desarchivar, toda referencia sigue resolviendo', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.constantFrom('create', 'archive', 'unarchive'), fc.nat(20)), { maxLength: 25 }),
        async (ops) => {
          const m = new InMemoryClassification();
          const s = new ClassificationService(m.deps());
          const qq = new ClassificationQueries(m.deps());
          const g = await s.createCategoryGroup(USER, WS, { name: 'G', kind: 'EXPENSE' });
          const refs: string[] = [];
          for (const [op, n] of ops) {
            if (op === 'create' || refs.length === 0) {
              refs.push((await s.createCategory(USER, WS, { groupId: g.id, name: `C${refs.length}` })).id);
              continue;
            }
            const id = refs[n % refs.length] as string;
            const cur = await qq.getCategory(USER, WS, id);
            if (op === 'archive' && !cur.isArchived) await s.archiveCategory(USER, WS, id, cur.version);
            if (op === 'unarchive' && cur.isArchived) await s.unarchiveCategory(USER, WS, id, cur.version);
          }
          // Toda referencia histórica resuelve a una categoría existente (archivada o no): no hay borrado.
          for (const id of refs) expect((await qq.getCategory(USER, WS, id)).id).toBe(id);
          expect(await qq.listCategories(USER, WS, { includeArchived: true })).toHaveLength(refs.length);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('Contrato del evento (tarea 5.4)', () => {
  it('classification.CategoryArchived.v1: el payload producido cumple el schema (Ajv strict)', async () => {
    const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
      addFormatsModule) as unknown as (ajv: Ajv2020) => void;
    const EVENTS = new URL('../../../../../contracts/events/', import.meta.url);
    const load = (p: string) =>
      JSON.parse(readFileSync(new URL(p, EVENTS), 'utf8')) as Record<string, unknown>;
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const schema = load('classification/CategoryArchived.v1.schema.json');
    ajv.addSchema(load('envelope.v1.schema.json'));
    ajv.addSchema(schema);
    const validate = ajv.compile({ $ref: `${String(schema['$id'])}#/$defs/Payload` });
    const g = await expenseGroup('Vivienda');
    const sb = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Servicios básicos' });
    await svc.createCategory(USER, WS, { groupId: g.id, parentId: sb.id, name: 'Luz' });
    await svc.archiveCategory(USER, WS, sb.id, 1);
    expect(mem.events).toHaveLength(2);
    for (const e of mem.events) {
      expect(validate(JSON.parse(JSON.stringify(e.payload))), JSON.stringify(validate.errors)).toBe(true);
    }
  });
});
