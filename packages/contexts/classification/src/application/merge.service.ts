import type { AuditChangeInput, LifecycleEventRefDto, LifecycleStepInput } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import {
  MERGE_COUNT_KEYS,
  type ClassificationMergeParticipant,
  type MergeConflict,
  type MergeCount,
  type MergeKind,
  type MergeParticipantInput,
} from '../contracts/merge.js';
import type { Category } from '../domain/category.js';
import { CATEGORY_LIFECYCLE, COUNTERPARTY_LIFECYCLE } from '../domain/classification-lifecycle.js';
import type { Counterparty } from '../domain/counterparty.js';
import { notFound } from '../domain/errors.js';
import { CategoryMergePolicy, CounterpartyMergePolicy } from '../domain/merge-policy.js';
import {
  CATEGORY_FIELDS,
  COUNTERPARTY_FIELDS,
  categoryView,
  counterpartyView,
  diff,
  preconditionFailed,
  transitionStep,
} from './classification.service.js';
import type { ClassificationDeps } from './ports/index.js';

/**
 * Fusión de categorías y contrapartes (openspec add-category-and-counterparty-merge, decisiones 1 a 7). Una única
 * unidad de trabajo: valida con la política pura, pide la vista previa de todos los participantes (conflictos ⇒
 * `CLASSIFICATION_MERGE_CONFLICT` sin cambios), aplica de a uno y en orden fijo (nunca en paralelo sobre el mismo
 * cliente), marca la origen, audita con el `operationId` y publica el evento al outbox. Sin consumidores nuevos (D249).
 */

export interface CategoryMergePreview {
  readonly source: Category;
  readonly target: Category;
  readonly counts: readonly MergeCount[];
  readonly conflicts: readonly MergeConflict[];
}

export interface CategoryMergeResult {
  readonly source: Category;
  readonly target: Category;
  readonly counts: readonly MergeCount[];
  readonly operationId: string;
}

export interface CounterpartyMergePreview {
  readonly source: Counterparty;
  readonly target: Counterparty;
  readonly counts: readonly MergeCount[];
  readonly conflicts: readonly MergeConflict[];
}

export interface CounterpartyMergeResult {
  readonly source: Counterparty;
  readonly target: Counterparty;
  readonly counts: readonly MergeCount[];
  readonly operationId: string;
}

/** `CLASSIFICATION_MERGE_CONFLICT` (409): los conflictos viajan en `details.conflicts`. */
export const mergeConflictError = (conflicts: readonly MergeConflict[]): DomainError =>
  new DomainError('CLASSIFICATION_MERGE_CONFLICT', 'the merge has conflicts that must be resolved first', {
    details: { conflicts },
  });

/** Suma conteos por clave y los ordena según `MERGE_COUNT_KEYS`. */
export function sumCounts(lists: readonly (readonly MergeCount[])[]): MergeCount[] {
  const total = new Map<string, number>();
  for (const list of lists) for (const c of list) total.set(c.key, (total.get(c.key) ?? 0) + c.count);
  return MERGE_COUNT_KEYS.filter((k) => total.has(k)).map((key) => ({ key, count: total.get(key) ?? 0 }));
}

const countOf = (counts: readonly MergeCount[], key: MergeCount['key']): number =>
  counts.find((c) => c.key === key)?.count ?? 0;

export class ClassificationMergeService {
  constructor(private readonly deps: ClassificationDeps) {}

  private now(): string {
    return this.deps.clock.now().toString();
  }

  private run<T>(userId: string, workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.deps.uow.run({ userId, workspaceId }, fn);
  }

  // ------------------------------------------------------------------ vista previa (solo lectura)

  /** Corre los `preview` de todos los participantes, de a uno (orden fijo), y los de CLASSIFICATION. */
  private async previewAll(
    base: MergeParticipantInput,
  ): Promise<{ counts: MergeCount[]; conflicts: MergeConflict[] }> {
    const counts: (readonly MergeCount[])[] = [];
    const conflicts: MergeConflict[] = [];
    for (const p of this.deps.mergeParticipants) {
      const r = await p.preview(base);
      counts.push(r.counts);
      conflicts.push(...r.conflicts);
    }
    return { counts: sumCounts(counts), conflicts };
  }

  previewCategoryMerge(
    userId: string,
    workspaceId: string,
    sourceId: string,
    targetId: string,
  ): Promise<CategoryMergePreview> {
    return this.run(userId, workspaceId, async () => {
      const { source, target, plan, base } = await this.categoryContext(
        userId,
        workspaceId,
        sourceId,
        targetId,
      );
      const rest = await this.previewAll(base);
      const defaults = await this.defaultCategoryCounterparties(workspaceId, source.id);
      return {
        source,
        target,
        counts: sumCounts([
          rest.counts,
          [
            { key: 'DEFAULT_CATEGORY_COUNTERPARTIES', count: defaults.length },
            { key: 'SUBCATEGORIES_MOVED', count: plan.movedSubcategories.length },
          ],
        ]),
        conflicts: [...plan.conflicts, ...rest.conflicts],
      };
    });
  }

  previewCounterpartyMerge(
    userId: string,
    workspaceId: string,
    sourceId: string,
    targetId: string,
  ): Promise<CounterpartyMergePreview> {
    return this.run(userId, workspaceId, async () => {
      const { source, target, plan, base } = await this.counterpartyContext(
        userId,
        workspaceId,
        sourceId,
        targetId,
      );
      const rest = await this.previewAll(base);
      return {
        source,
        target,
        counts: sumCounts([rest.counts, [{ key: 'ALIASES_MOVED', count: plan.movedAliases.length }]]),
        conflicts: rest.conflicts,
      };
    });
  }

  // ------------------------------------------------------------------ categorías

  private async categoryContext(userId: string, workspaceId: string, sourceId: string, targetId: string) {
    const source = await this.deps.categories.findById(workspaceId, sourceId);
    if (!source) throw notFound('category');
    const target = await this.deps.categories.findById(workspaceId, targetId);
    if (!target) throw notFound('category');
    const all = await this.deps.categories.listAll(workspaceId);
    const plan = CategoryMergePolicy.plan(source, target, all);
    const closedRanges = await this.deps.closedPeriods.closedRanges(workspaceId);
    const base: MergeParticipantInput = {
      userId,
      workspaceId,
      kind: 'CATEGORY',
      sourceId,
      targetId,
      closedRanges,
    };
    return { source, target, plan, base };
  }

  private async defaultCategoryCounterparties(workspaceId: string, categoryId: string) {
    return (await this.deps.counterparties.listAll(workspaceId)).filter(
      (c) => c.defaultCategoryId === categoryId,
    );
  }

  /** Fusiona la categoría `sourceId` (versión `expectedVersion`) en `targetId` (design decisiones 1, 2 y 5). */
  mergeCategory(
    userId: string,
    workspaceId: string,
    sourceId: string,
    expectedVersion: number,
    targetId: string,
  ): Promise<CategoryMergeResult> {
    return this.run(userId, workspaceId, async () => {
      const current = await this.deps.categories.findById(workspaceId, sourceId);
      if (!current) throw notFound('category');
      if (current.version !== expectedVersion) throw preconditionFailed(current.version);
      const { source, target, plan, base } = await this.categoryContext(
        userId,
        workspaceId,
        sourceId,
        targetId,
      );
      const rest = await this.previewAll(base);
      const conflicts = [...plan.conflicts, ...rest.conflicts];
      if (conflicts.length > 0) throw mergeConflictError(conflicts);

      const operationId = this.deps.ids.next();
      const at = this.now();
      const applied = await this.applyAll({ ...base, operationId }, userId);
      const before = categoryView(source);

      // Subcategorías activas de la origen: pasan a ser hijas de la destino conservando sus porciones.
      const group = await this.deps.groups.findById(workspaceId, target.groupId);
      if (!group) throw notFound('category group');
      for (const child of plan.movedSubcategories) {
        const childBefore = categoryView(child);
        const v = child.version;
        child.moveTo(group, target, false);
        await this.saveCategory(child, v);
        await this.deps.lifecycle.record(
          {
            workspaceId,
            action: 'classification.category.moved',
            aggregateType: 'Category',
            aggregateId: child.id,
            aggregateVersion: child.version,
            changes: diff(childBefore, categoryView(child), CATEGORY_FIELDS),
            correlationId: operationId,
            actor: { type: 'USER', userId },
          },
          [
            {
              kind: 'ANNOTATION',
              changedFields: ['MOVED'],
              detailRefs: { operationId, mergedInto: target.id },
            },
          ],
        );
      }
      // Contrapartes con la origen como categoría por defecto (CLASSIFICATION es participante de sí misma).
      const defaults = await this.defaultCategoryCounterparties(workspaceId, source.id);
      for (const cp of defaults) {
        const cpBefore = counterpartyView(cp);
        const v = cp.version;
        cp.update({ defaultCategoryId: target.id });
        await this.saveCounterparty(cp, v);
        await this.deps.lifecycle.record(
          {
            workspaceId,
            action: 'classification.counterparty.updated',
            aggregateType: 'Counterparty',
            aggregateId: cp.id,
            aggregateVersion: cp.version,
            changes: diff(cpBefore, counterpartyView(cp), COUNTERPARTY_FIELDS),
            correlationId: operationId,
            actor: { type: 'USER', userId },
          },
          [{ kind: 'ANNOTATION', changedFields: ['defaultCategoryId'], detailRefs: { operationId } }],
        );
      }

      const counts = sumCounts([
        applied,
        [
          { key: 'DEFAULT_CATEGORY_COUNTERPARTIES', count: defaults.length },
          { key: 'SUBCATEGORIES_MOVED', count: plan.movedSubcategories.length },
        ],
      ]);
      const movedSubcategoryIds = plan.movedSubcategories.map((c) => c.id);

      source.merge(target.id, at);
      await this.saveCategory(source, expectedVersion);
      const eventId = this.deps.ids.next();
      await this.deps.outbox.append({
        eventId,
        eventType: 'classification.CategoriesMerged',
        eventVersion: 1,
        aggregateType: 'Category',
        aggregateId: source.id,
        aggregateVersion: source.version,
        workspaceId,
        occurredAt: at,
        actor: { type: 'USER', id: userId },
        payload: {
          sourceCategoryId: source.id,
          targetCategoryId: target.id,
          movedSubcategoryIds,
          counts,
          operationId,
          mergedAt: at,
        },
      });
      const ref: LifecycleEventRefDto = { eventId, eventType: 'classification.CategoriesMerged.v1' };
      await this.deps.lifecycle.record(
        {
          workspaceId,
          action: 'classification.category.merged',
          aggregateType: 'Category',
          aggregateId: source.id,
          aggregateVersion: source.version,
          changes: diff(before, categoryView(source), CATEGORY_FIELDS),
          correlationId: operationId,
          actor: { type: 'USER', userId },
        },
        [
          {
            ...transitionStep(source.lastTransition, CATEGORY_LIFECYCLE),
            detailRefs: { mergedInto: target.id, operationId },
            events: [ref],
          },
        ],
      );
      // La destino no cambia de estado: una anotación con la origen y las referencias reasignadas.
      await this.deps.lifecycle.record(
        {
          workspaceId,
          action: 'classification.category.merge_received',
          aggregateType: 'Category',
          aggregateId: target.id,
          aggregateVersion: target.version,
          changes: [],
          correlationId: operationId,
          actor: { type: 'USER', userId },
        },
        [annotationMergedFrom(source.id, operationId, this.reassigned(counts, 'CATEGORY'))],
      );
      return { source, target, counts, operationId };
    });
  }

  // ------------------------------------------------------------------ contrapartes

  private async counterpartyContext(userId: string, workspaceId: string, sourceId: string, targetId: string) {
    const source = await this.deps.counterparties.findById(workspaceId, sourceId);
    if (!source) throw notFound('counterparty');
    const target = await this.deps.counterparties.findById(workspaceId, targetId);
    if (!target) throw notFound('counterparty');
    const all = await this.deps.counterparties.listAll(workspaceId);
    const activeCategoryIds = new Set(
      (await this.deps.categories.listAll(workspaceId)).filter((c) => !c.isArchived).map((c) => c.id),
    );
    const plan = CounterpartyMergePolicy.plan(source, target, all, activeCategoryIds);
    const closedRanges = await this.deps.closedPeriods.closedRanges(workspaceId);
    const base: MergeParticipantInput = {
      userId,
      workspaceId,
      kind: 'COUNTERPARTY',
      sourceId,
      targetId,
      closedRanges,
    };
    return { source, target, plan, base };
  }

  /** Fusiona la contraparte `sourceId` (versión `expectedVersion`) en `targetId`. */
  mergeCounterparty(
    userId: string,
    workspaceId: string,
    sourceId: string,
    expectedVersion: number,
    targetId: string,
  ): Promise<CounterpartyMergeResult> {
    return this.run(userId, workspaceId, async () => {
      const current = await this.deps.counterparties.findById(workspaceId, sourceId);
      if (!current) throw notFound('counterparty');
      if (current.version !== expectedVersion) throw preconditionFailed(current.version);
      const { source, target, plan, base } = await this.counterpartyContext(
        userId,
        workspaceId,
        sourceId,
        targetId,
      );
      const rest = await this.previewAll(base);
      if (rest.conflicts.length > 0) throw mergeConflictError(rest.conflicts);

      const operationId = this.deps.ids.next();
      const at = this.now();
      const applied = await this.applyAll({ ...base, operationId }, userId);
      const counts = sumCounts([applied, [{ key: 'ALIASES_MOVED', count: plan.movedAliases.length }]]);
      const sourceBefore = counterpartyView(source);
      const targetBefore = counterpartyView(target);
      const targetVersion = target.version;

      // Primero la origen (suelta sus alias), después la destino (los recibe): los alias activos son únicos.
      source.merge(target.id, at);
      await this.saveCounterparty(source, expectedVersion);
      target.absorb({ aliases: plan.aliases, defaultCategoryId: plan.defaultCategoryId });
      if (target.version !== targetVersion) await this.saveCounterparty(target, targetVersion);

      const eventId = this.deps.ids.next();
      await this.deps.outbox.append({
        eventId,
        eventType: 'classification.CounterpartiesMerged',
        eventVersion: 1,
        aggregateType: 'Counterparty',
        aggregateId: source.id,
        aggregateVersion: source.version,
        workspaceId,
        occurredAt: at,
        actor: { type: 'USER', id: userId },
        payload: {
          sourceCounterpartyId: source.id,
          targetCounterpartyId: target.id,
          movedAliases: plan.movedAliases,
          counts,
          operationId,
          mergedAt: at,
        },
      });
      const ref: LifecycleEventRefDto = { eventId, eventType: 'classification.CounterpartiesMerged.v1' };
      await this.deps.lifecycle.record(
        {
          workspaceId,
          action: 'classification.counterparty.merged',
          aggregateType: 'Counterparty',
          aggregateId: source.id,
          aggregateVersion: source.version,
          changes: diff(sourceBefore, counterpartyView(source), COUNTERPARTY_FIELDS),
          correlationId: operationId,
          actor: { type: 'USER', userId },
        },
        [
          {
            ...transitionStep(source.lastTransition, COUNTERPARTY_LIFECYCLE),
            detailRefs: { mergedInto: target.id, operationId },
            events: [ref],
          },
        ],
      );
      const changed = diff(targetBefore, counterpartyView(target), COUNTERPARTY_FIELDS).map((c) => c.field);
      await this.deps.lifecycle.record(
        {
          workspaceId,
          action: 'classification.counterparty.merge_received',
          aggregateType: 'Counterparty',
          aggregateId: target.id,
          aggregateVersion: target.version,
          changes: diff(targetBefore, counterpartyView(target), COUNTERPARTY_FIELDS),
          correlationId: operationId,
          actor: { type: 'USER', userId },
        },
        [annotationMergedFrom(source.id, operationId, this.reassigned(counts, 'COUNTERPARTY'), changed)],
      );
      return { source, target, counts, operationId };
    });
  }

  // ------------------------------------------------------------------ comunes

  /** Aplica los participantes de a uno y en orden fijo; deja un registro de auditoría por contexto participante. */
  private async applyAll(
    input: MergeParticipantInput & { readonly operationId: string },
    userId: string,
  ): Promise<MergeCount[]> {
    const counts: (readonly MergeCount[])[] = [];
    for (const p of this.deps.mergeParticipants) {
      const r = await p.apply(input);
      counts.push(r.counts);
      await this.auditParticipant(p, input, r.counts, userId);
    }
    return sumCounts(counts);
  }

  private auditParticipant(
    participant: ClassificationMergeParticipant,
    input: MergeParticipantInput & { readonly operationId: string },
    counts: readonly MergeCount[],
    userId: string,
  ): Promise<void> {
    const changes: AuditChangeInput[] = [
      { field: 'kind', before: null, after: input.kind },
      { field: 'sourceId', before: null, after: input.sourceId },
      { field: 'targetId', before: null, after: input.targetId },
      { field: 'context', before: null, after: participant.context },
      ...counts.map((c) => ({ field: c.key, before: null, after: c.count })),
    ];
    return this.deps.audit.append({
      workspaceId: input.workspaceId,
      action: 'classification.merge.reassigned',
      aggregateType: 'ClassificationMerge',
      aggregateId: input.operationId,
      changes,
      correlationId: input.operationId,
      actor: { type: 'USER', userId },
    });
  }

  /** Referencias reasignadas a la destino (suma de los conteos que cambian de dueño; excluye las que se conservan). */
  private reassigned(counts: readonly MergeCount[], kind: MergeKind): number {
    const keys = kind === 'CATEGORY' ? (['SPLITS_OPEN'] as const) : (['TRANSACTIONS_OPEN'] as const);
    return keys.reduce((n, k) => n + countOf(counts, k), 0);
  }

  private async saveCategory(category: Category, expected: number): Promise<void> {
    if (!(await this.deps.categories.update(category, expected))) {
      throw preconditionFailed(
        (await this.deps.categories.findById(category.workspaceId, category.id))?.version,
      );
    }
  }

  private async saveCounterparty(cp: Counterparty, expected: number): Promise<void> {
    if (!(await this.deps.counterparties.update(cp, expected))) {
      throw preconditionFailed((await this.deps.counterparties.findById(cp.workspaceId, cp.id))?.version);
    }
  }
}

/** Anotación `MERGED_FROM` de la destino: la origen, la operación y las porciones o transacciones reasignadas. */
function annotationMergedFrom(
  sourceId: string,
  operationId: string,
  reassigned: number,
  extraFields: readonly string[] = [],
): LifecycleStepInput {
  return {
    kind: 'ANNOTATION',
    changedFields: ['MERGED_FROM', ...extraFields],
    detailRefs: { mergedFrom: sourceId, operationId, reassigned },
  };
}
