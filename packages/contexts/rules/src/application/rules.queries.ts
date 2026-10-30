import { DomainError, MoneyDecimal } from '@pf/shared-kernel';
import type { CategoryOriginDto } from '@pf/transactions/contracts';
import {
  CompiledRuleSet,
  actionTargets,
  parseDefinition,
  previewRule,
  ruleStatus,
  type Action,
  type ActionCatalog,
  type CompiledNode,
  type ConditionTrace,
  type EvaluableRule,
  type EvaluationMode,
  type RuleOutcome,
  type RuleState,
  type RuleStatus,
  type RuleSubject,
  type RuleTrigger,
} from '../domain/index.js';
import type { RuleVersionRecord, RulesDeps } from './ports/index.js';

/** Máximo de sujetos por llamada de `evaluate` (D339). */
export const EVALUATION_MAX_SUBJECTS = 5000;
/** Meta de la cobertura de Phase 6 (docs/24 §5.6). */
export const COVERAGE_TARGET = '0.7000';
const UNUSED_DAYS = 90;
const DAY_MS = 86_400_000;

export interface RuleStats {
  readonly classifiedTransactions: number;
  readonly lastAppliedAt: string | null;
  readonly unusedFor90Days: boolean;
}

export interface RuleView {
  readonly rule: RuleState;
  readonly status: RuleStatus;
  /** Algún destino de sus acciones está archivado o ya no existe. */
  readonly needsAttention: boolean;
  readonly stats: RuleStats;
}

export interface ListRulesFilter {
  readonly enabled?: boolean;
  readonly trigger?: RuleTrigger;
  readonly includeArchived?: boolean;
  readonly needsAttention?: boolean;
}

/** Acción propuesta por una regla, en la forma del DSL (vista previa). */
export interface ProposedAction {
  readonly type: string;
  readonly categoryId?: string;
  readonly tagId?: string;
  readonly counterpartyId?: string;
  readonly fieldId?: string;
  readonly value?: string | boolean;
  readonly text?: string;
}

export interface PreviewResult {
  readonly matched: boolean;
  readonly conditions: readonly ConditionTrace[];
  readonly actions: readonly ProposedAction[];
  readonly skipped: readonly { readonly action: string; readonly reason: string }[];
}

export interface PreviewCommand {
  readonly ruleId?: string;
  readonly definition?: {
    readonly matchMode?: unknown;
    readonly conditions?: unknown;
    readonly actions?: unknown;
    readonly triggers?: unknown;
    readonly stopProcessing?: unknown;
  };
  readonly subject:
    | { readonly transactionId: string }
    | { readonly sample: Partial<Omit<RuleSubject, 'ref'>> & Pick<RuleSubject, 'amount'> };
  readonly trigger?: RuleTrigger;
  readonly mode?: EvaluationMode;
}

export interface CoverageQuery {
  readonly from?: string;
  readonly to?: string;
  readonly importJobId?: string;
}

export interface CoverageView {
  readonly count: number;
  readonly byOrigin: Readonly<Record<CategoryOriginDto, number>>;
  /** Clasificadas por reglas ÷ total, 4 decimales HALF_EVEN. */
  readonly ruleCoverage: string;
  readonly target: string;
  readonly meetsTarget: boolean;
  readonly byRule: readonly {
    readonly ruleId: string;
    readonly name: string;
    readonly version: number | null;
    readonly archived: boolean;
    readonly count: number;
  }[];
}

const toOutcomeActions = (o: RuleOutcome): ProposedAction[] => [
  ...(o.category ? [{ type: 'SET_CATEGORY', categoryId: o.category.categoryId }] : []),
  ...(o.counterparty ? [{ type: 'SET_COUNTERPARTY', counterpartyId: o.counterparty.counterpartyId }] : []),
  ...o.addTags.map((t) => ({ type: 'ADD_TAG', tagId: t.tagId })),
  ...o.removeTags.map((t) => ({ type: 'REMOVE_TAG', tagId: t.tagId })),
  ...o.customFields.map((f) => ({ type: 'SET_CUSTOM_FIELD', fieldId: f.fieldId, value: f.value })),
  ...(o.description ? [{ type: 'SET_DESCRIPTION', text: o.description.text }] : []),
  ...o.appendNotes.map((n) => ({ type: 'APPEND_NOTE', text: n.text })),
  ...(o.markForReview ? [{ type: 'MARK_FOR_REVIEW' }] : []),
  ...(o.exclude ? [{ type: 'EXCLUDE_FROM_IMPORT' }] : []),
];

/** Destinos activos de las acciones de un conjunto de reglas: `true` si alguno está archivado o no existe. */
export function hasArchivedTarget(actions: readonly Action[], catalog: ActionCatalog): boolean {
  const t = actionTargets(actions);
  return (
    t.categoryIds.some((id) => catalog.activeCategoryKind(id) === null) ||
    t.tagIds.some((id) => !catalog.isTagActive(id)) ||
    t.counterpartyIds.some((id) => !catalog.isCounterpartyActive(id)) ||
    t.customFieldIds.some((id) => !catalog.isCustomFieldActive(id))
  );
}

/**
 * Consultas de RULES: listado con estadísticas, versiones, evaluación sin efectos (`RuleEvaluationQuery`), vista previa
 * y cobertura. Ninguna escribe ni audita.
 */
export class RulesQueries {
  /** Árboles compilados por `(regla, versión)`: las versiones son inmutables, así que el caché nunca queda viejo. */
  private readonly compiled = new Map<string, CompiledNode>();

  constructor(private readonly deps: RulesDeps) {}

  private evict(): void {
    if (this.compiled.size > 5000) this.compiled.clear();
  }

  // ------------------------------------------------------------------ listados

  async list(workspaceId: string, filter: ListRulesFilter = {}): Promise<RuleView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const all = await this.deps.rules.listAll(workspaceId, {
        includeArchived: filter.includeArchived ?? false,
      });
      const views = await this.viewsOf(
        workspaceId,
        all.map((r) => r.snapshot),
      );
      return views.filter(
        (v) =>
          (filter.enabled === undefined || v.rule.enabled === filter.enabled) &&
          (filter.trigger === undefined || v.rule.triggers.includes(filter.trigger)) &&
          (filter.needsAttention === undefined || v.needsAttention === filter.needsAttention),
      );
    });
  }

  async get(workspaceId: string, id: string): Promise<RuleView> {
    return this.deps.uow.run(workspaceId, async () => {
      const rule = await this.deps.rules.findById(workspaceId, id);
      if (!rule) throw new DomainError('RESOURCE_NOT_FOUND', `rule ${id} not found`);
      return (await this.viewsOf(workspaceId, [rule.snapshot]))[0] as RuleView;
    });
  }

  /** Nombre y estado de las reglas dadas (incluye archivadas: las transacciones clasificadas las siguen mostrando). */
  async names(
    workspaceId: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly name: string; readonly archived: boolean }>> {
    return this.deps.uow.run(workspaceId, async () => {
      const found = await this.deps.rules.names(workspaceId, ids);
      return new Map(found.map((n) => [n.ruleId, { name: n.name, archived: n.archived }]));
    });
  }

  async versions(workspaceId: string, id: string): Promise<RuleVersionRecord[]> {
    return this.deps.uow.run(workspaceId, async () => {
      if (!(await this.deps.rules.findById(workspaceId, id))) {
        throw new DomainError('RESOURCE_NOT_FOUND', `rule ${id} not found`);
      }
      return this.deps.rules.listVersions(workspaceId, id);
    });
  }

  private async viewsOf(workspaceId: string, states: readonly RuleState[]): Promise<RuleView[]> {
    if (states.length === 0) return [];
    const catalog = await this.deps.catalog.load({
      workspaceId,
      actions: states.flatMap((s) => (s.archivedAt === null ? s.actions : [])),
    });
    const stats = new Map((await this.deps.coverage.ruleStats({ workspaceId })).map((s) => [s.ruleId, s]));
    const now = this.deps.clock.now().toDate().getTime();
    return states.map((rule): RuleView => {
      const s = stats.get(rule.id);
      const lastAppliedAt = s?.lastAppliedAt ?? null;
      const active = rule.enabled && rule.archivedAt === null;
      const old = now - new Date(rule.createdAt).getTime() >= UNUSED_DAYS * DAY_MS;
      const unused =
        active &&
        old &&
        (lastAppliedAt === null || now - new Date(lastAppliedAt).getTime() >= UNUSED_DAYS * DAY_MS);
      return {
        rule,
        status: ruleStatus(rule),
        needsAttention: rule.archivedAt === null && hasArchivedTarget(rule.actions, catalog),
        stats: { classifiedTransactions: s?.count ?? 0, lastAppliedAt, unusedFor90Days: unused },
      };
    });
  }

  // ------------------------------------------------------------------ evaluación

  /** `RuleEvaluationQuery.evaluate`: sin efectos, en la unidad de trabajo del llamador si existe. */
  async evaluate(input: {
    readonly workspaceId: string;
    readonly trigger: RuleTrigger;
    readonly mode: EvaluationMode;
    readonly subjects: readonly RuleSubject[];
  }): Promise<RuleOutcome[]> {
    if (input.subjects.length > EVALUATION_MAX_SUBJECTS) {
      throw new DomainError('VALIDATION_FAILED', `at most ${EVALUATION_MAX_SUBJECTS} subjects per call`).at(
        '/subjects',
      );
    }
    return this.deps.uow.run(input.workspaceId, async () => {
      const rules = await this.deps.rules.listEvaluable(input.workspaceId, input.trigger);
      return this.evaluateWith(input.workspaceId, rules, input.subjects, input.trigger, input.mode);
    });
  }

  /** Evalúa con reglas ya cargadas (dry-run y aplicación). */
  async evaluateWith(
    workspaceId: string,
    rules: readonly EvaluableRule[],
    subjects: readonly RuleSubject[],
    trigger: RuleTrigger,
    mode: EvaluationMode,
  ): Promise<RuleOutcome[]> {
    if (subjects.length === 0 || rules.length === 0) {
      return subjects.map((s) => emptyOutcome(s.ref));
    }
    this.evict();
    const set = CompiledRuleSet.compile(rules, trigger, this.compiled);
    if (set.size === 0) return subjects.map((s) => emptyOutcome(s.ref));
    const catalog = await this.deps.catalog.load({ workspaceId, actions: rules.flatMap((r) => r.actions) });
    return subjects.map((s) => set.evaluate(s, mode, catalog));
  }

  // ------------------------------------------------------------------ vista previa

  async preview(workspaceId: string, cmd: PreviewCommand): Promise<PreviewResult> {
    return this.deps.uow.run(workspaceId, async () => {
      let evaluable: EvaluableRule;
      if (cmd.ruleId !== undefined) {
        const rule = await this.deps.rules.findById(workspaceId, cmd.ruleId);
        if (!rule) throw new DomainError('RESOURCE_NOT_FOUND', `rule ${cmd.ruleId} not found`);
        const s = rule.snapshot;
        evaluable = { ...s, archived: s.archivedAt !== null };
      } else if (cmd.definition !== undefined) {
        const def = parseDefinition(cmd.definition);
        evaluable = {
          ...def,
          id: 'preview',
          version: 0,
          priority: 0,
          createdAt: this.deps.clock.now().toString(),
          enabled: true,
          archived: false,
        };
      } else {
        throw new DomainError('VALIDATION_FAILED', 'ruleId or definition is required').at('/definition');
      }
      const subject = await this.subjectOf(workspaceId, cmd.subject);
      const trigger = cmd.trigger ?? 'IMPORT';
      const catalog = await this.deps.catalog.load({ workspaceId, actions: evaluable.actions });
      const result = previewRule({
        rule: evaluable,
        subject,
        trigger,
        mode: cmd.mode ?? 'FILL_EMPTY',
        catalog,
      });
      return {
        matched: result.matched,
        conditions: result.conditions,
        actions: toOutcomeActions(result.outcome),
        skipped: result.outcome.skipped.map((s) => ({ action: s.action, reason: s.reason })),
      };
    });
  }

  private async subjectOf(workspaceId: string, raw: PreviewCommand['subject']): Promise<RuleSubject> {
    if ('transactionId' in raw) {
      const [found] = await this.deps.subjects.byIds({ workspaceId, transactionIds: [raw.transactionId] });
      if (!found) {
        throw new DomainError('RESOURCE_NOT_FOUND', `transaction ${raw.transactionId} not found`).at(
          '/subject/transactionId',
        );
      }
      return {
        ref: found.transactionId,
        kind: found.kind,
        accountId: found.accountId,
        date: found.date,
        amount: found.amount,
        description: found.description,
        counterpartyId: found.counterpartyId,
        counterpartyOrigin: found.counterpartyId === null ? null : 'USER',
        categoryId: found.categoryId,
        tagIds: found.tagIds,
        externalSource: found.externalSource,
        customFields: found.customFields,
        splitCount: found.splitCount,
        notes: found.notes,
      };
    }
    const s = raw.sample;
    return {
      ref: 'sample',
      kind: s.kind ?? 'EXPENSE',
      accountId: s.accountId ?? '',
      date: s.date ?? this.deps.clock.now().toString().slice(0, 10),
      amount: s.amount,
      description: s.description ?? null,
      counterpartyId: s.counterpartyId ?? null,
      counterpartyOrigin: s.counterpartyId ? 'USER' : null,
      categoryId: s.categoryId ?? null,
      tagIds: s.tagIds ?? [],
      externalSource: s.externalSource ?? null,
      customFields: s.customFields ?? [],
      splitCount: s.splitCount ?? 1,
      notes: s.notes ?? null,
    };
  }

  // ------------------------------------------------------------------ cobertura

  /** Cobertura de clasificación por reglas (D334): el cociente con 4 decimales HALF_EVEN junto a la meta. */
  async coverage(workspaceId: string, q: CoverageQuery): Promise<CoverageView> {
    const hasRange = q.from !== undefined || q.to !== undefined;
    if (q.importJobId === undefined && !hasRange) {
      throw new DomainError('VALIDATION_FAILED', 'from/to or importJobId is required').at('/from');
    }
    if (q.importJobId !== undefined && hasRange) {
      throw new DomainError('VALIDATION_FAILED', 'use importJobId or a date range, not both').at(
        '/importJobId',
      );
    }
    return this.deps.uow.run(workspaceId, async () => {
      const c = await this.deps.coverage.coverage({
        workspaceId,
        ...(q.from !== undefined ? { from: q.from } : {}),
        ...(q.to !== undefined ? { to: q.to } : {}),
        ...(q.importJobId !== undefined ? { importJobId: q.importJobId } : {}),
      });
      const names = new Map(
        (
          await this.deps.rules.names(
            workspaceId,
            c.byRule.map((r) => r.ruleId),
          )
        ).map((n) => [n.ruleId, n]),
      );
      const ratio =
        c.count === 0
          ? '0.0000'
          : new MoneyDecimal(c.byOrigin.RULE)
              .div(c.count)
              .toDecimalPlaces(4, MoneyDecimal.ROUND_HALF_EVEN)
              .toFixed(4);
      return {
        count: c.count,
        byOrigin: c.byOrigin,
        ruleCoverage: ratio,
        target: COVERAGE_TARGET,
        meetsTarget: new MoneyDecimal(ratio).gte(COVERAGE_TARGET),
        byRule: c.byRule.map((r) => {
          const n = names.get(r.ruleId);
          return {
            ruleId: r.ruleId,
            name: n?.name ?? r.ruleId,
            version: r.ruleVersion ?? n?.version ?? null,
            archived: n?.archived ?? false,
            count: r.count,
          };
        }),
      };
    });
  }
}

export function emptyOutcome(ref: string): RuleOutcome {
  return {
    ref,
    category: null,
    counterparty: null,
    addTags: [],
    removeTags: [],
    customFields: [],
    description: null,
    appendNotes: [],
    markForReview: null,
    exclude: null,
    matched: [],
    skipped: [],
  };
}
