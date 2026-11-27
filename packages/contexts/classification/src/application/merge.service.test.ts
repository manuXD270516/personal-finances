import { isDomainError } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ClassificationMergeParticipant,
  MergeApplyResult,
  MergeConflict,
  MergeCount,
  MergeParticipantInput,
} from '../contracts/merge.js';
import { ClassificationService } from './classification.service.js';
import { ClassificationMergeService, sumCounts } from './merge.service.js';
import { InMemoryClassification } from './testing/in-memory.js';

const WS = '0190d000-0000-7000-8000-00000000000a';
const USER = '0190d000-0000-7000-8000-0000000000aa';

async function failure(p: Promise<unknown>): Promise<{ code: string; details: Record<string, unknown> }> {
  try {
    await p;
  } catch (err) {
    if (isDomainError(err)) return { code: err.code, details: { ...err.details } };
    throw err;
  }
  throw new Error('expected a DomainError');
}

/** Participante de prueba: registra lo que recibe y devuelve conteos y conflictos programados. */
class FakeParticipant implements ClassificationMergeParticipant {
  readonly previews: MergeParticipantInput[] = [];
  readonly applied: (MergeParticipantInput & { operationId: string })[] = [];
  failOnApply = false;
  constructor(
    readonly context: string,
    private readonly counts: readonly MergeCount[] = [],
    private readonly conflicts: readonly MergeConflict[] = [],
    private readonly log: string[] = [],
  ) {}

  async preview(input: MergeParticipantInput) {
    this.previews.push(input);
    return { counts: this.counts, conflicts: this.conflicts };
  }

  async apply(input: MergeParticipantInput & { operationId: string }): Promise<MergeApplyResult> {
    this.log.push(`apply:${this.context}`);
    if (this.failOnApply) throw new Error(`${this.context} failed`);
    this.applied.push(input);
    return { counts: this.counts };
  }
}

let mem: InMemoryClassification;
let svc: ClassificationService;
let merge: ClassificationMergeService;

beforeEach(() => {
  mem = new InMemoryClassification();
  svc = new ClassificationService(mem.deps());
  merge = new ClassificationMergeService(mem.deps());
});

const group = (name = 'Alimentación', kind: 'EXPENSE' | 'INCOME' = 'EXPENSE') =>
  svc.createCategoryGroup(USER, WS, { name, kind });

describe('Fusionar categorías', () => {
  it('[TC-CLASSIFICATION-MERGE-001] fusiona Super en Supermercado: la origen queda archivada y fusionada, con transición MERGE, anotación en la destino, evento y un registro por participante', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const mkt = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const tx = new FakeParticipant('transactions', [{ key: 'SPLITS_OPEN', count: 3 }]);
    const planning = new FakeParticipant('planning', [{ key: 'BUDGET_LINES', count: 1 }]);
    mem.participants.push(tx, planning);

    const result = await merge.mergeCategory(USER, WS, sup.id, sup.version, mkt.id);

    expect(result.source).toMatchObject({ isArchived: true, mergedIntoId: mkt.id, status: 'ARCHIVED' });
    expect(result.target.id).toBe(mkt.id);
    expect(result.counts).toEqual([
      { key: 'SPLITS_OPEN', count: 3 },
      { key: 'BUDGET_LINES', count: 1 },
      { key: 'DEFAULT_CATEGORY_COUNTERPARTIES', count: 0 },
      { key: 'SUBCATEGORIES_MOVED', count: 0 },
    ]);
    // Cada participante recibe el mismo operationId y la categoría origen y destino.
    for (const p of [tx, planning]) {
      expect(p.applied).toHaveLength(1);
      expect(p.applied[0]).toMatchObject({
        kind: 'CATEGORY',
        sourceId: sup.id,
        targetId: mkt.id,
        operationId: result.operationId,
      });
    }
    // Recorrido: MERGE en la origen (ACTIVE → ARCHIVED, destino y operación) y MERGED_FROM en la destino.
    const mergeStep = mem.steps.find((s) => s.action === 'classification.category.merged');
    expect(mergeStep).toMatchObject({
      kind: 'TRANSITION',
      transition: 'MERGE',
      fromState: 'ACTIVE',
      toState: 'ARCHIVED',
      machineVersion: 2,
      detailRefs: { mergedInto: mkt.id, operationId: result.operationId },
    });
    const received = mem.steps.find((s) => s.action === 'classification.category.merge_received');
    expect(received).toMatchObject({
      kind: 'ANNOTATION',
      aggregateId: mkt.id,
      changedFields: ['MERGED_FROM'],
      detailRefs: { mergedFrom: sup.id, operationId: result.operationId, reassigned: 3 },
    });
    // Evento al outbox, sin consumidores; un registro de auditoría por participante con el operationId.
    expect(mem.mergeEvents).toHaveLength(1);
    expect(mem.mergeEvents[0]).toMatchObject({
      eventType: 'classification.CategoriesMerged',
      aggregateId: sup.id,
      payload: { sourceCategoryId: sup.id, targetCategoryId: mkt.id, operationId: result.operationId },
    });
    const perContext = mem.audits.filter((a) => a.action === 'classification.merge.reassigned');
    expect(perContext).toHaveLength(2);
    expect(perContext.every((a) => a.correlationId === result.operationId)).toBe(true);
    expect(mem.audits.find((a) => a.action === 'classification.category.merged')?.correlationId).toBe(
      result.operationId,
    );
  });

  it('[TC-CLASSIFICATION-MERGE-001] aplica los participantes de a uno y en el orden de composición', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const mkt = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const log: string[] = [];
    for (const c of ['transactions', 'planning', 'commitments']) {
      mem.participants.push(new FakeParticipant(c, [], [], log));
    }
    await merge.mergeCategory(USER, WS, sup.id, sup.version, mkt.id);
    expect(log).toEqual(['apply:transactions', 'apply:planning', 'apply:commitments']);
  });

  it('[TC-CLASSIFICATION-MERGE-001] la categoría origen archivada también se fusiona (D497)', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const mkt = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const archived = await svc.archiveCategory(USER, WS, sup.id, sup.version);
    const result = await merge.mergeCategory(USER, WS, sup.id, archived.version, mkt.id);
    expect(result.source.archivedAt).toBe(archived.archivedAt);
    expect(mem.steps.find((s) => s.action === 'classification.category.merged')).toMatchObject({
      fromState: 'ARCHIVED',
      toState: 'ARCHIVED',
    });
  });

  it('[TC-CLASSIFICATION-MERGE-001] If-Match con una versión vieja ⇒ PRECONDITION_FAILED sin cambios', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const mkt = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const p = new FakeParticipant('transactions', [{ key: 'SPLITS_OPEN', count: 3 }]);
    mem.participants.push(p);
    expect((await failure(merge.mergeCategory(USER, WS, sup.id, 99, mkt.id))).code).toBe(
      'PRECONDITION_FAILED',
    );
    expect(p.applied).toHaveLength(0);
  });

  it('[TC-CLASSIFICATION-MERGE-001] la destino de otro workspace o inexistente ⇒ RESOURCE_NOT_FOUND', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const other = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Otra' });
    const failed = await failure(
      merge.mergeCategory(USER, '0190d000-0000-7000-8000-00000000000b', sup.id, sup.version, other.id),
    );
    expect(failed.code).toBe('RESOURCE_NOT_FOUND');
    expect(
      (
        await failure(
          merge.mergeCategory(USER, WS, sup.id, sup.version, '0190d000-0000-7000-8000-0000000000ff'),
        )
      ).code,
    ).toBe('RESOURCE_NOT_FOUND');
  });

  it('[TC-CLASSIFICATION-MERGE-009] un conflicto de un participante bloquea la fusión con CLASSIFICATION_MERGE_CONFLICT y nada cambia', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const mkt = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const conflict: MergeConflict = {
      reason: 'BUDGET_LINE_EXISTS',
      refs: [{ kind: 'BUDGET_LINE', id: '0190d000-0000-7000-8000-0000000000c1', label: '2026-11' }],
    };
    const p = new FakeParticipant('planning', [{ key: 'BUDGET_LINES', count: 1 }], [conflict]);
    mem.participants.push(p);

    const preview = await merge.previewCategoryMerge(USER, WS, sup.id, mkt.id);
    expect(preview.conflicts).toEqual([conflict]);

    const failed = await failure(merge.mergeCategory(USER, WS, sup.id, sup.version, mkt.id));
    expect(failed.code).toBe('CLASSIFICATION_MERGE_CONFLICT');
    expect(failed.details['conflicts']).toEqual([conflict]);
    expect(p.applied).toHaveLength(0);
    const after = await svc.archiveCategory(USER, WS, sup.id, sup.version); // sigue activa y sin fusionar
    expect(after.mergedIntoId).toBeNull();
    expect(mem.mergeEvents).toHaveLength(0);
    expect(mem.steps.some((s) => s.action === 'classification.category.merged')).toBe(false);
  });

  it('[TC-CLASSIFICATION-MERGE-008] la vista previa informa los conteos, los de CLASSIFICATION y no cambia nada', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const mkt = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    await svc.createCounterparty(USER, WS, { name: 'Hipermaxi', defaultCategoryId: sup.id });
    mem.participants.push(
      new FakeParticipant('transactions', [
        { key: 'SPLITS_OPEN', count: 3 },
        { key: 'SPLITS_CLOSED_KEPT', count: 2 },
      ]),
      new FakeParticipant('rules', [{ key: 'RULES', count: 1 }]),
    );
    mem.closedRanges = [{ from: '2026-10-01', to: '2026-10-31' }];
    const auditsBefore = mem.audits.length;

    const preview = await merge.previewCategoryMerge(USER, WS, sup.id, mkt.id);

    expect(preview.counts).toEqual([
      { key: 'SPLITS_OPEN', count: 3 },
      { key: 'SPLITS_CLOSED_KEPT', count: 2 },
      { key: 'RULES', count: 1 },
      { key: 'DEFAULT_CATEGORY_COUNTERPARTIES', count: 1 },
      { key: 'SUBCATEGORIES_MOVED', count: 0 },
    ]);
    expect(preview.conflicts).toEqual([]);
    expect(mem.audits).toHaveLength(auditsBefore);
    expect(mem.mergeEvents).toHaveLength(0);
    // Los participantes reciben los periodos cerrados.
    const seen = (mem.participants[0] as FakeParticipant).previews[0];
    expect(seen?.closedRanges).toEqual([{ from: '2026-10-01', to: '2026-10-31' }]);
    expect((await svc.archiveCategory(USER, WS, sup.id, sup.version)).mergedIntoId).toBeNull();
  });

  it('[TC-CLASSIFICATION-MERGE-017] la categoría por defecto de las contrapartes pasa a la destino con su anotación', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const mkt = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const hiper = await svc.createCounterparty(USER, WS, { name: 'Hipermaxi', defaultCategoryId: sup.id });
    const otra = await svc.createCounterparty(USER, WS, { name: 'Otra', defaultCategoryId: mkt.id });
    const result = await merge.mergeCategory(USER, WS, sup.id, sup.version, mkt.id);
    expect(result.counts.find((c) => c.key === 'DEFAULT_CATEGORY_COUNTERPARTIES')?.count).toBe(1);
    const q = await mem.counterparties.findById(WS, hiper.id);
    expect(q?.defaultCategoryId).toBe(mkt.id);
    expect((await mem.counterparties.findById(WS, otra.id))?.version).toBe(otra.version);
    expect(
      mem.steps.find((s) => s.aggregateId === hiper.id && s.action === 'classification.counterparty.updated'),
    ).toMatchObject({ kind: 'ANNOTATION', changedFields: ['defaultCategoryId'] });
  });

  it('[TC-CLASSIFICATION-MERGE-010] las subcategorías activas pasan a la destino conservando su id y se anotan como MOVED', async () => {
    const g = await group();
    const servicios = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Servicios' });
    const basicos = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Servicios básicos' });
    const luz = await svc.createCategory(USER, WS, { groupId: g.id, parentId: servicios.id, name: 'Luz' });
    const agua = await svc.createCategory(USER, WS, { groupId: g.id, parentId: servicios.id, name: 'Agua' });
    const result = await merge.mergeCategory(USER, WS, servicios.id, servicios.version, basicos.id);
    expect(result.counts.find((c) => c.key === 'SUBCATEGORIES_MOVED')?.count).toBe(2);
    for (const c of [luz, agua]) {
      expect(await mem.categories.findById(WS, c.id)).toMatchObject({
        parentId: basicos.id,
        isArchived: false,
      });
    }
    expect(mem.steps.filter((s) => s.action === 'classification.category.moved')).toHaveLength(2);
    expect(mem.mergeEvents[0]?.payload).toMatchObject({ movedSubcategoryIds: [luz.id, agua.id] });
  });

  it('[TC-CLASSIFICATION-MERGE-013] una subcategoría con nombre repetido bloquea la fusión con SUBCATEGORY_NAME_TAKEN', async () => {
    const g = await group();
    const servicios = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Servicios' });
    const basicos = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Servicios básicos' });
    await svc.createCategory(USER, WS, { groupId: g.id, parentId: servicios.id, name: 'Agua' });
    await svc.createCategory(USER, WS, { groupId: g.id, parentId: basicos.id, name: 'Agua' });
    const failed = await failure(merge.mergeCategory(USER, WS, servicios.id, servicios.version, basicos.id));
    expect(failed.code).toBe('CLASSIFICATION_MERGE_CONFLICT');
    expect(JSON.stringify(failed.details['conflicts'])).toContain('SUBCATEGORY_NAME_TAKEN');
    expect((await mem.categories.findById(WS, servicios.id))?.mergedIntoId).toBeNull();
  });

  it('[TC-CLASSIFICATION-MERGE-001] atomicidad: un participante que falla deja todo como estaba', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const mkt = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    await svc.createCounterparty(USER, WS, { name: 'Hipermaxi', defaultCategoryId: sup.id });
    const ok = new FakeParticipant('transactions', [{ key: 'SPLITS_OPEN', count: 3 }]);
    const bad = new FakeParticipant('planning');
    bad.failOnApply = true;
    mem.participants.push(ok, bad);
    const audits = mem.audits.length;
    await expect(merge.mergeCategory(USER, WS, sup.id, sup.version, mkt.id)).rejects.toThrow(
      'planning failed',
    );
    expect((await mem.categories.findById(WS, sup.id))?.mergedIntoId).toBeNull();
    expect(mem.audits).toHaveLength(audits);
    expect(mem.mergeEvents).toHaveLength(0);
  });

  it('[TC-CLASSIFICATION-MERGE-020] volver a fusionar una origen ya fusionada ⇒ CATEGORY_MERGED indicando la destino', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const mkt = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const otra = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Mercado' });
    const done = await merge.mergeCategory(USER, WS, sup.id, sup.version, mkt.id);
    const failed = await failure(merge.mergeCategory(USER, WS, sup.id, done.source.version, otra.id));
    expect(failed.code).toBe('CATEGORY_MERGED');
    expect(failed.details['mergedInto']).toBe(mkt.id);
    expect(mem.mergeEvents).toHaveLength(1);
  });

  it('[TC-CLASSIFICATION-MERGE-019] desarchivar una categoría fusionada ⇒ CATEGORY_MERGED', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const mkt = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const done = await merge.mergeCategory(USER, WS, sup.id, sup.version, mkt.id);
    const failed = await failure(svc.unarchiveCategory(USER, WS, sup.id, done.source.version));
    expect(failed.code).toBe('CATEGORY_MERGED');
    expect(failed.details['mergedInto']).toBe(mkt.id);
  });

  it('[TC-AUDIT-LIFECYCLE-029] una fusión rechazada no registra transiciones ni anotaciones', async () => {
    const g = await group();
    const sup = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Super' });
    const old = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Old Market' });
    const archived = await svc.archiveCategory(USER, WS, old.id, old.version);
    const steps = mem.steps.length;
    const audits = mem.audits.length;
    expect((await failure(merge.mergeCategory(USER, WS, sup.id, sup.version, archived.id))).code).toBe(
      'CATEGORY_ARCHIVED',
    );
    expect(mem.steps).toHaveLength(steps);
    expect(mem.audits).toHaveLength(audits);
  });
});

describe('Fusionar contrapartes', () => {
  it('[TC-CLASSIFICATION-MERGE-021] fusiona HIPERMAXI S.A. en Hipermaxi: alias y nombre pasan a la destino y la origen queda sin alias', async () => {
    const src = await svc.createCounterparty(USER, WS, { name: 'HIPERMAXI S.A.', aliases: ['hipermaxi sa'] });
    const dst = await svc.createCounterparty(USER, WS, { name: 'Hipermaxi' });
    mem.participants.push(new FakeParticipant('transactions', [{ key: 'TRANSACTIONS_OPEN', count: 4 }]));

    const result = await merge.mergeCounterparty(USER, WS, src.id, src.version, dst.id);

    expect(result.source).toMatchObject({ isArchived: true, mergedIntoId: dst.id, aliases: [] });
    expect(result.target.aliases).toEqual(['hipermaxi sa', 'HIPERMAXI S.A.']);
    expect(result.counts).toEqual([
      { key: 'TRANSACTIONS_OPEN', count: 4 },
      { key: 'ALIASES_MOVED', count: 1 },
    ]);
    expect(mem.steps.find((s) => s.action === 'classification.counterparty.merged')).toMatchObject({
      transition: 'MERGE',
      fromState: 'ACTIVE',
      toState: 'ARCHIVED',
      detailRefs: { mergedInto: dst.id, operationId: result.operationId },
    });
    expect(mem.steps.find((s) => s.action === 'classification.counterparty.merge_received')).toMatchObject({
      kind: 'ANNOTATION',
      aggregateId: dst.id,
      detailRefs: { mergedFrom: src.id, reassigned: 4 },
    });
    expect(mem.mergeEvents[0]).toMatchObject({
      eventType: 'classification.CounterpartiesMerged',
      payload: { movedAliases: ['hipermaxi sa'], operationId: result.operationId },
    });
  });

  it('[TC-CLASSIFICATION-MERGE-022] la destino sin categoría por defecto hereda la de la origen activa', async () => {
    const g = await group();
    const cat = await svc.createCategory(USER, WS, { groupId: g.id, name: 'Supermercado' });
    const src = await svc.createCounterparty(USER, WS, { name: 'HIPERMAXI S.A.', defaultCategoryId: cat.id });
    const dst = await svc.createCounterparty(USER, WS, { name: 'Hipermaxi' });
    const result = await merge.mergeCounterparty(USER, WS, src.id, src.version, dst.id);
    expect(result.target.defaultCategoryId).toBe(cat.id);
  });

  it('[TC-CLASSIFICATION-MERGE-023] [TC-AUDIT-LIFECYCLE-029] una destino archivada se rechaza con COUNTERPARTY_ARCHIVED sin dejar rastro', async () => {
    const src = await svc.createCounterparty(USER, WS, { name: 'HIPERMAXI S.A.' });
    const old = await svc.createCounterparty(USER, WS, { name: 'Hiper Viejo' });
    const archived = await svc.archiveCounterparty(USER, WS, old.id, old.version);
    const steps = mem.steps.length;
    const audits = mem.audits.length;
    expect((await failure(merge.mergeCounterparty(USER, WS, src.id, src.version, archived.id))).code).toBe(
      'COUNTERPARTY_ARCHIVED',
    );
    expect(mem.steps).toHaveLength(steps);
    expect(mem.audits).toHaveLength(audits);
  });

  it('[TC-CLASSIFICATION-MERGE-025] la vista previa de la fusión de contrapartes cuenta los alias a mover y no cambia nada', async () => {
    const src = await svc.createCounterparty(USER, WS, { name: 'HIPERMAXI S.A.', aliases: ['hipermaxi sa'] });
    const dst = await svc.createCounterparty(USER, WS, { name: 'Hipermaxi' });
    mem.participants.push(
      new FakeParticipant('transactions', [
        { key: 'TRANSACTIONS_OPEN', count: 4 },
        { key: 'TRANSACTIONS_CLOSED_KEPT', count: 1 },
      ]),
      new FakeParticipant('commitments', [{ key: 'SUBSCRIPTIONS', count: 1 }]),
      new FakeParticipant('rules', [{ key: 'RULES', count: 1 }]),
    );
    const preview = await merge.previewCounterpartyMerge(USER, WS, src.id, dst.id);
    expect(preview.counts).toEqual([
      { key: 'TRANSACTIONS_OPEN', count: 4 },
      { key: 'TRANSACTIONS_CLOSED_KEPT', count: 1 },
      { key: 'SUBSCRIPTIONS', count: 1 },
      { key: 'RULES', count: 1 },
      { key: 'ALIASES_MOVED', count: 1 },
    ]);
    expect(preview.conflicts).toEqual([]);
    expect((await mem.counterparties.findById(WS, src.id))?.aliases).toEqual(['hipermaxi sa']);
  });

  it('[TC-CLASSIFICATION-MERGE-027] desarchivar una contraparte fusionada ⇒ COUNTERPARTY_MERGED indicando la destino', async () => {
    const src = await svc.createCounterparty(USER, WS, { name: 'HIPERMAXI S.A.' });
    const dst = await svc.createCounterparty(USER, WS, { name: 'Hipermaxi' });
    const done = await merge.mergeCounterparty(USER, WS, src.id, src.version, dst.id);
    const failed = await failure(svc.unarchiveCounterparty(USER, WS, src.id, done.source.version));
    expect(failed.code).toBe('COUNTERPARTY_MERGED');
    expect(failed.details['mergedInto']).toBe(dst.id);
  });
});

describe('sumCounts', () => {
  it('[TC-CLASSIFICATION-MERGE-008] suma por clave y ordena según el catálogo de claves', () => {
    expect(
      sumCounts([
        [{ key: 'RULES', count: 1 }],
        [
          { key: 'SPLITS_OPEN', count: 2 },
          { key: 'RULES', count: 2 },
        ],
      ]),
    ).toEqual([
      { key: 'SPLITS_OPEN', count: 2 },
      { key: 'RULES', count: 3 },
    ]);
  });
});
