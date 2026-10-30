import type { AuditEntry } from '@pf/audit/contracts';
import { DomainError, FixedClock, Instant } from '@pf/shared-kernel';
import type {
  ClassificationCoverageQuery,
  ClassificationSubjectDto,
  RuleClassificationCommand,
} from '@pf/transactions/contracts';
import {
  Rule,
  actionTargets,
  type Action,
  type ActionCatalog,
  type EvaluableRule,
  type RuleState,
  type RuleTrigger,
} from '../../domain/index.js';
import {
  DEFAULT_RULES_SETTINGS,
  type ReferenceCatalog,
  type RuleNameRecord,
  type RuleRepository,
  type RuleVersionRecord,
  type RulesDeps,
} from '../ports/index.js';

/** Repositorio en memoria (los agregados se guardan como estado y se rehidratan en cada lectura). */
export class InMemoryRuleRepository implements RuleRepository {
  readonly states = new Map<string, RuleState>();
  readonly versions: RuleVersionRecord[] = [];
  /** Cada consulta de `listEvaluable` (la evaluación debe hacer UNA por llamada). */
  evaluableQueries = 0;

  async findById(workspaceId: string, id: string): Promise<Rule | null> {
    const s = this.states.get(id);
    return s && s.workspaceId === workspaceId ? Rule.rehydrate(s) : null;
  }

  async listAll(workspaceId: string, o: { includeArchived: boolean }): Promise<Rule[]> {
    return [...this.states.values()]
      .filter((s) => s.workspaceId === workspaceId && (o.includeArchived || s.archivedAt === null))
      .sort((a, b) => a.priority - b.priority || (a.createdAt < b.createdAt ? -1 : 1))
      .map((s) => Rule.rehydrate(s));
  }

  async listEvaluable(workspaceId: string, trigger: RuleTrigger): Promise<EvaluableRule[]> {
    this.evaluableQueries += 1;
    return [...this.states.values()]
      .filter(
        (s) =>
          s.workspaceId === workspaceId && s.enabled && s.archivedAt === null && s.triggers.includes(trigger),
      )
      .map((s) => ({ ...s, archived: false }));
  }

  async listEvaluableByIds(workspaceId: string, ids: readonly string[]): Promise<EvaluableRule[]> {
    return [...this.states.values()]
      .filter(
        (s) => s.workspaceId === workspaceId && s.enabled && s.archivedAt === null && ids.includes(s.id),
      )
      .map((s) => ({ ...s, archived: false }));
  }

  async countNonArchived(workspaceId: string): Promise<number> {
    return [...this.states.values()].filter((s) => s.workspaceId === workspaceId && s.archivedAt === null)
      .length;
  }

  async insert(rule: Rule): Promise<void> {
    this.states.set(rule.id, rule.snapshot);
  }

  async update(rule: Rule, expectedRowVersion: number): Promise<boolean> {
    const current = this.states.get(rule.id);
    if (!current || current.rowVersion !== expectedRowVersion) return false;
    this.states.set(rule.id, rule.snapshot);
    return true;
  }

  async insertVersion(state: RuleState, createdBy: string): Promise<void> {
    this.versions.push({
      ruleId: state.id,
      version: state.version,
      createdAt: state.updatedAt,
      createdBy,
      snapshot: {
        name: state.name,
        triggers: state.triggers,
        matchMode: state.matchMode,
        conditions: state.conditions,
        actions: state.actions,
        stopProcessing: state.stopProcessing,
        schemaVersion: state.schemaVersion,
      },
    });
  }

  async listVersions(_workspaceId: string, ruleId: string): Promise<RuleVersionRecord[]> {
    return this.versions.filter((v) => v.ruleId === ruleId).sort((a, b) => a.version - b.version);
  }

  async names(_workspaceId: string, ids: readonly string[]): Promise<RuleNameRecord[]> {
    return ids.flatMap((id) => {
      const s = this.states.get(id);
      return s ? [{ ruleId: id, name: s.name, archived: s.archivedAt !== null, version: s.version }] : [];
    });
  }
}

/** Catálogo en memoria: categorías con tipo, etiquetas, contrapartes y campos; todo lo no listado "no existe". */
export class InMemoryReferenceCatalog implements ReferenceCatalog {
  readonly categories = new Map<string, { kind: 'EXPENSE' | 'INCOME'; archived: boolean }>();
  readonly tags = new Map<string, { archived: boolean }>();
  readonly counterparties = new Map<string, { archived: boolean }>();
  readonly customFields = new Map<string, { archived: boolean }>();
  loads = 0;

  async assertActions({ actions }: { workspaceId: string; actions: readonly Action[] }): Promise<void> {
    const t = actionTargets(actions);
    for (const id of t.categoryIds) {
      const c = this.categories.get(id);
      if (!c) throw new DomainError('REFERENCE_NOT_FOUND', `category ${id} not found`);
      if (c.archived) throw new DomainError('CATEGORY_ARCHIVED', `category ${id} is archived`);
    }
    for (const id of t.tagIds) {
      const c = this.tags.get(id);
      if (!c) throw new DomainError('REFERENCE_NOT_FOUND', `tag ${id} not found`);
      if (c.archived) throw new DomainError('TAG_ARCHIVED', `tag ${id} is archived`);
    }
    for (const id of t.counterpartyIds) {
      const c = this.counterparties.get(id);
      if (!c) throw new DomainError('REFERENCE_NOT_FOUND', `counterparty ${id} not found`);
      if (c.archived) throw new DomainError('COUNTERPARTY_ARCHIVED', `counterparty ${id} is archived`);
    }
    for (const id of t.customFieldIds) {
      const c = this.customFields.get(id);
      if (!c) throw new DomainError('REFERENCE_NOT_FOUND', `custom field ${id} not found`);
      if (c.archived) throw new DomainError('CUSTOM_FIELD_ARCHIVED', `custom field ${id} is archived`);
    }
  }

  async load(): Promise<ActionCatalog> {
    this.loads += 1;
    return {
      activeCategoryKind: (id) => {
        const c = this.categories.get(id);
        return c && !c.archived ? c.kind : null;
      },
      isTagActive: (id) => this.tags.get(id)?.archived === false,
      isCounterpartyActive: (id) => this.counterparties.get(id)?.archived === false,
      isCustomFieldActive: (id) => this.customFields.get(id)?.archived === false,
    };
  }
}

export class InMemoryAudit {
  readonly entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/** Transacciones sintéticas para el dry-run, la vista previa y la aplicación. */
export class InMemorySubjects {
  readonly byId = new Map<string, ClassificationSubjectDto>();

  add(s: Partial<ClassificationSubjectDto> & { transactionId: string }): ClassificationSubjectDto {
    const full: ClassificationSubjectDto = {
      version: 1,
      status: 'POSTED',
      managedBy: null,
      date: '2026-09-10',
      kind: 'EXPENSE',
      accountId: 'acc-bob',
      amount: { amount: '100.00', currency: 'BOB' },
      description: 'HIPERMAXI SUC 12',
      notes: null,
      counterpartyId: null,
      categoryId: null,
      categoryOrigin: 'SYSTEM_DEFAULT',
      tagIds: [],
      externalSource: 'IMPORT',
      customFields: [],
      splitCount: 1,
      needsReview: false,
      ...s,
    };
    this.byId.set(full.transactionId, full);
    return full;
  }

  async list(input: { from: string; to: string; accountIds?: readonly string[]; limit: number }) {
    const all = [...this.byId.values()]
      .filter(
        (s) =>
          s.date >= input.from &&
          s.date <= input.to &&
          (!input.accountIds || input.accountIds.includes(s.accountId)),
      )
      .sort((a, b) =>
        a.date === b.date ? (a.transactionId < b.transactionId ? -1 : 1) : a.date < b.date ? -1 : 1,
      );
    const items = all.slice(0, input.limit);
    return { items, next: all.length > input.limit ? 'more' : null };
  }

  async byIds(input: { transactionIds: readonly string[] }) {
    return input.transactionIds.flatMap((id) => this.byId.get(id) ?? []);
  }
}

/** Clasificador en memoria: aplica los cambios al sujeto y sube la versión (todo o nada). */
export class InMemoryClassifier implements RuleClassificationCommand {
  readonly calls: Parameters<RuleClassificationCommand['applyBatch']>[0][] = [];
  closedDates = new Set<string>();

  constructor(private readonly subjects: InMemorySubjects) {}

  async applyBatch(input: Parameters<RuleClassificationCommand['applyBatch']>[0]) {
    this.calls.push(input);
    for (const item of input.items) {
      const s = this.subjects.byId.get(item.transactionId);
      if (!s || s.version !== item.expectedVersion) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'a transaction was modified concurrently');
      }
    }
    const applied: string[] = [];
    const notApplicable: { transactionId: string; reason: string }[] = [];
    for (const item of input.items) {
      const s = this.subjects.byId.get(item.transactionId) as ClassificationSubjectDto;
      if (this.closedDates.has(s.date)) {
        notApplicable.push({ transactionId: s.transactionId, reason: 'PERIOD_CLOSED' });
        continue;
      }
      const c = item.changes;
      this.subjects.byId.set(s.transactionId, {
        ...s,
        version: s.version + 1,
        categoryId: c.categoryId ?? s.categoryId,
        categoryOrigin: c.categoryId ? 'RULE' : s.categoryOrigin,
        counterpartyId: c.counterpartyId ?? s.counterpartyId,
        tagIds: [...new Set([...s.tagIds, ...(c.addTagIds ?? [])])].filter(
          (t) => !c.removeTagIds?.includes(t),
        ),
        needsReview: c.markForReview ? true : s.needsReview,
      });
      applied.push(s.transactionId);
    }
    return { applied, notApplicable };
  }
}

export class InMemoryCoverage implements Pick<ClassificationCoverageQuery, 'coverage' | 'ruleStats'> {
  stats: { ruleId: string; ruleVersion: number | null; count: number; lastAppliedAt: string | null }[] = [];
  next: Awaited<ReturnType<ClassificationCoverageQuery['coverage']>> = {
    count: 0,
    byOrigin: { MANUAL: 0, RULE: 0, COUNTERPARTY_DEFAULT: 0, SYSTEM_DEFAULT: 0, UNKNOWN: 0 },
    byRule: [],
  };
  async coverage() {
    return this.next;
  }
  async ruleStats() {
    return this.stats;
  }
}

export function createRulesWorld(now = '2026-10-20T14:00:00.000Z') {
  const rules = new InMemoryRuleRepository();
  const catalog = new InMemoryReferenceCatalog();
  const audit = new InMemoryAudit();
  const subjects = new InMemorySubjects();
  const classifier = new InMemoryClassifier(subjects);
  const coverage = new InMemoryCoverage();
  const clock = new FixedClock(Instant.parse(now));
  let seq = 0;
  const deps: RulesDeps = {
    uow: { run: (_ws, fn) => fn() },
    rules,
    catalog,
    subjects: subjects as unknown as RulesDeps['subjects'],
    coverage,
    classifier,
    audit,
    ids: { next: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` },
    clock,
    settings: DEFAULT_RULES_SETTINGS,
  };
  catalog.categories.set('cat-super', { kind: 'EXPENSE', archived: false });
  catalog.categories.set('cat-hogar', { kind: 'EXPENSE', archived: false });
  catalog.categories.set('cat-reembolsos', { kind: 'INCOME', archived: false });
  catalog.tags.set('tag-hogar', { archived: false });
  catalog.counterparties.set('cp-hipermaxi', { archived: false });
  return { deps, rules, catalog, audit, subjects, classifier, coverage, clock };
}
