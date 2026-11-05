import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import type { CategoryOriginDto, ClassificationEvidenceDto } from '@pf/transactions/contracts';
import {
  CompiledRuleSet,
  PROPOSAL_PATTERN_TYPES,
  SKIP_REASONS,
  SUBJECT_KINDS,
  assessCoverage,
  mineProposals,
  parseDefinition,
  proposalFingerprint,
  proposedConditions,
  proposedPriority,
  proposedRuleName,
  suggestionAggregateId,
  type Action,
  type EvaluableRule,
  type ProposalCandidate,
  type ProposalConfidenceLevel,
  type ProposalPattern,
  type RuleDefinition,
  type RuleOutcome,
} from '../domain/index.js';
import { toSubject } from './dry-run.service.js';
import type { RuleProposalDecisionRecord, RulesDeps } from './ports/index.js';
import type { RulesQueries } from './rules.queries.js';

const DAY_MS = 86_400_000;
const MAX_EVIDENCE_SHOWN = 20;
const MAX_PREVIEW_ITEMS = 200;

export interface ProposalEvidenceView {
  readonly transactionId: string;
  readonly date: string;
  readonly description: string | null;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly accountId: string;
  readonly categoryId: string;
  readonly categoryOrigin: CategoryOriginDto;
}

export interface ProposalConflictView {
  readonly ruleId: string;
  readonly name: string;
  readonly version: number;
  readonly priority: number;
  readonly categoryId: string;
  readonly count: number;
}

/** Regla propuesta en la forma de `RuleInput` (sin `fromSuggestion`: el cliente lo agrega al aceptar). */
export interface ProposedRuleView {
  readonly name: string;
  readonly priority: number;
  readonly matchMode: 'ALL';
  readonly conditions: readonly Record<string, unknown>[];
  readonly actions: readonly { readonly type: 'SET_CATEGORY'; readonly categoryId: string }[];
  readonly triggers: readonly ['IMPORT', 'RETROACTIVE'];
  readonly stopProcessing: false;
}

export interface RuleProposalView {
  readonly suggestionId: string;
  readonly pattern: ProposalPattern;
  readonly patternLabel?: string;
  readonly categoryName: string;
  readonly support: number;
  /** Evidencia del patrón y del mismo tipo en cualquier categoría (el denominador de la confianza). */
  readonly evidenceCount: number;
  readonly confidence: string;
  readonly confidenceLevel: ProposalConfidenceLevel;
  readonly proposedRule: ProposedRuleView;
  readonly evidence: readonly ProposalEvidenceView[];
  readonly counterExamples: readonly ProposalEvidenceView[];
  readonly conflicts: readonly ProposalConflictView[];
  readonly warnings: readonly 'CANNOT_OUTRANK'[];
  readonly status: 'OPEN' | 'DISMISSED';
}

export interface RuleProposalList {
  readonly generatedAt: string;
  readonly from: string;
  readonly to: string;
  readonly scanned: number;
  readonly truncated: boolean;
  readonly items: readonly RuleProposalView[];
}

export interface ListProposalsQuery {
  readonly windowDays?: number;
  readonly includeDismissed?: boolean;
}

export type ProposalOutcome = 'WOULD_FILL' | 'ALREADY_IN_CATEGORY' | 'OTHER_CATEGORY' | 'NOT_APPLICABLE';

export interface ProposalPreviewItem {
  readonly transactionId: string;
  readonly date: string;
  readonly description: string | null;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly currentCategoryId: string | null;
  readonly currentOrigin: CategoryOriginDto;
  readonly proposedCategoryId: string;
  readonly outcome: ProposalOutcome;
  readonly reasons: readonly string[];
}

export interface ProposalPreview {
  readonly from: string;
  readonly to: string;
  readonly scanned: number;
  readonly truncated: boolean;
  readonly matched: number;
  readonly wouldFill: number;
  readonly alreadyInCategory: number;
  readonly otherCategory: number;
  readonly notApplicable: number;
  readonly items: readonly ProposalPreviewItem[];
}

export interface PreviewProposalCommand {
  readonly suggestionId: unknown;
  readonly pattern: unknown;
  readonly definition?: {
    readonly matchMode?: unknown;
    readonly conditions?: unknown;
    readonly actions?: unknown;
    readonly triggers?: unknown;
    readonly stopProcessing?: unknown;
  };
  readonly windowDays?: number;
}

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

/** Valida la forma del patrón que envía el cliente y que la huella corresponda a él. */
export function parseProposalPattern(
  suggestionId: unknown,
  raw: unknown,
  pointer = '/pattern',
): ProposalPattern {
  if (typeof suggestionId !== 'string' || !/^[0-9a-f]{64}$/u.test(suggestionId)) {
    throw invalid('suggestionId must be a 64-character hexadecimal fingerprint', '/suggestionId');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('pattern is required', pointer);
  const p = raw as Record<string, unknown>;
  const extra = Object.keys(p).filter((k) => !['type', 'value', 'kind', 'categoryId'].includes(k));
  if (extra.length > 0) throw invalid(`unknown property ${extra[0]}`, `${pointer}/${extra[0]}`);
  if (typeof p['type'] !== 'string' || !(PROPOSAL_PATTERN_TYPES as readonly string[]).includes(p['type'])) {
    throw invalid('type must be DESCRIPTION or COUNTERPARTY', `${pointer}/type`);
  }
  if (typeof p['value'] !== 'string' || p['value'].length < 1 || p['value'].length > 200) {
    throw invalid('value must have between 1 and 200 characters', `${pointer}/value`);
  }
  if (typeof p['kind'] !== 'string' || !(SUBJECT_KINDS as readonly string[]).includes(p['kind'])) {
    throw invalid(`kind must be one of ${SUBJECT_KINDS.join(', ')}`, `${pointer}/kind`);
  }
  if (typeof p['categoryId'] !== 'string' || p['categoryId'].length === 0) {
    throw invalid('categoryId is required', `${pointer}/categoryId`);
  }
  const pattern = p as unknown as ProposalPattern;
  if (proposalFingerprint(pattern) !== suggestionId) {
    throw invalid('suggestionId does not match the pattern', '/suggestionId');
  }
  return pattern;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Resultado del cálculo de candidatos (antes de cruzarlos con reglas y decisiones). */
interface Mined {
  readonly from: string;
  readonly to: string;
  readonly scanned: number;
  readonly truncated: boolean;
  readonly byId: ReadonlyMap<string, ClassificationEvidenceDto>;
  readonly candidates: readonly ProposalCandidate[];
}

const evidenceView = (e: ClassificationEvidenceDto): ProposalEvidenceView => ({
  transactionId: e.transactionId,
  date: e.date,
  description: e.description,
  amount: e.amount,
  accountId: e.accountId,
  categoryId: e.categoryId as string,
  categoryOrigin: e.categoryOrigin,
});

/**
 * Evidencia y patrones (decisiones 2 a 4 de add-rule-suggestions). Lee la evidencia de TRANSACTIONS en la unidad de trabajo
 * del llamador, descarta las categorías archivadas con UN lote al catálogo y agrupa en memoria. Sin efectos.
 */
export async function mineEvidence(deps: RulesDeps, workspaceId: string, windowDays: number): Promise<Mined> {
  const s = deps.settings.suggest;
  const to = await deps.calendar.today(workspaceId);
  const from = addDays(to, -windowDays);
  const page = await deps.subjects.listEvidence({ workspaceId, from, to, limit: s.maxEvidence });
  const categoryIds = [...new Set(page.items.flatMap((i) => (i.categoryId === null ? [] : [i.categoryId])))];
  const catalog = await deps.catalog.load({
    workspaceId,
    actions: categoryIds.map((categoryId) => ({ type: 'SET_CATEGORY' as const, categoryId })),
  });
  const usable = page.items.filter((i) => i.categoryId !== null && catalog.activeCategoryKind(i.categoryId));
  const candidates = mineProposals(
    usable.map((i) => ({
      transactionId: i.transactionId,
      date: i.date,
      kind: i.kind,
      description: i.description,
      counterpartyId: i.counterpartyId,
      categoryId: i.categoryId as string,
    })),
    s,
  );
  return {
    from,
    to,
    scanned: page.items.length,
    truncated: page.truncated,
    byId: new Map(usable.map((i) => [i.transactionId, i])),
    candidates,
  };
}

/** Instantánea (apoyo, evidencia del patrón y confianza) de una sugerencia al decidirla; `null` si ya no se calcula. */
export async function snapshotOf(
  deps: RulesDeps,
  workspaceId: string,
  suggestionId: string,
): Promise<{ readonly support: number; readonly evidenceCount: number; readonly confidence: string } | null> {
  const mined = await mineEvidence(deps, workspaceId, deps.settings.suggest.windowDays);
  const found = mined.candidates.find((c) => c.suggestionId === suggestionId);
  return found
    ? { support: found.support, evidenceCount: found.evidenceCount, confidence: found.confidence }
    : null;
}

/** Cambios de auditoría de una decisión sobre una sugerencia (los valores compuestos no se usan: todo es escalar). */
export function decisionChanges(record: RuleProposalDecisionRecord): AuditChangeInput[] {
  const all: AuditChangeInput[] = [
    { field: 'decision', before: null, after: record.decision },
    { field: 'patternType', before: null, after: record.patternType },
    { field: 'patternValue', before: null, after: record.patternValue },
    { field: 'kind', before: null, after: record.kind },
    { field: 'categoryId', before: null, after: record.categoryId },
    { field: 'ruleId', before: null, after: record.ruleId },
    { field: 'support', before: null, after: record.support },
    { field: 'evidenceCount', before: null, after: record.evidenceCount },
    { field: 'confidence', before: null, after: record.confidence },
  ];
  return all.filter((c) => c.after !== null);
}

const decided = () =>
  new DomainError('RULE_SUGGESTION_DECIDED', 'the suggestion was already accepted or dismissed');

/**
 * Sugerencias de reglas (openspec add-rule-suggestions, FR-RULES-011). Se calculan solo cuando un usuario las pide: listar y
 * probar no escriben ni auditan; descartar y restaurar sí (misma unidad de trabajo). Aceptar es `RulesService.createRule`
 * con `fromSuggestion`. Sin jobs ni consumidores (D249).
 */
export class RuleProposalsService {
  constructor(
    private readonly deps: RulesDeps,
    private readonly queries: RulesQueries,
  ) {}

  private windowOf(raw: number | undefined): number {
    const s = this.deps.settings.suggest;
    const days = raw ?? s.windowDays;
    if (!Number.isInteger(days) || days < 1 || days > s.maxWindowDays) {
      throw invalid(`windowDays must be an integer between 1 and ${s.maxWindowDays}`, '/windowDays');
    }
    return days;
  }

  // ------------------------------------------------------------------ listar

  async list(workspaceId: string, query: ListProposalsQuery = {}): Promise<RuleProposalList> {
    const windowDays = this.windowOf(query.windowDays);
    return this.deps.uow.run(workspaceId, async () => {
      const mined = await mineEvidence(this.deps, workspaceId, windowDays);
      const decisions = new Map(
        (await this.deps.decisions.list(workspaceId)).map((d) => [d.suggestionId, d]),
      );
      const visible = mined.candidates.filter((c) => {
        const d = decisions.get(c.suggestionId);
        if (d?.decision === 'ACCEPTED') return false;
        return d === undefined || query.includeDismissed === true;
      });

      // Reglas activas evaluadas sobre la evidencia como si su categoría estuviera vacía, con cualquier disparador.
      const rules = (await this.deps.rules.listAll(workspaceId, { includeArchived: false }))
        .map((r) => r.snapshot)
        .filter((r) => r.enabled);
      const evaluable: EvaluableRule[] = rules.map((r) => ({ ...r, archived: false }));
      const ids = [...new Set(visible.flatMap((c) => c.evidenceIds))];
      const outcomes = await this.queries.evaluateWith(
        workspaceId,
        evaluable,
        ids.map((id) => ({
          ...toSubject(mined.byId.get(id) as ClassificationEvidenceDto),
          categoryId: null,
        })),
        'RETROACTIVE',
        'FILL_EMPTY',
        { triggerFilter: 'ANY' },
      );
      const categoryOf = new Map<string, RuleOutcome['category']>(
        ids.map((id, i) => [id, (outcomes[i] as RuleOutcome).category]),
      );
      const ruleById = new Map(rules.map((r) => [r.id, r]));

      const open: { c: ProposalCandidate; conflicts: ProposalConflictView[] }[] = [];
      for (const c of visible) {
        const coverage = assessCoverage(
          c.evidenceIds,
          c.pattern.categoryId,
          (id) => categoryOf.get(id) ?? null,
        );
        if (coverage.covered) continue;
        open.push({
          c,
          conflicts: coverage.conflicts.map((k) => {
            const rule = ruleById.get(k.ruleId);
            return {
              ruleId: k.ruleId,
              name: rule?.name ?? k.ruleId,
              version: k.version,
              priority: rule?.priority ?? 0,
              categoryId: k.categoryId,
              count: k.count,
            };
          }),
        });
        if (open.length >= this.deps.settings.suggest.maxResults) break;
      }

      const describe = await this.deps.catalog.describe({
        workspaceId,
        categoryIds: open.flatMap(({ c }) => [c.pattern.categoryId]),
        counterpartyIds: open.flatMap(({ c }) =>
          c.pattern.type === 'COUNTERPARTY' ? [c.pattern.value] : [],
        ),
      });
      const items = open.map(({ c, conflicts }): RuleProposalView => {
        const categoryName = describe.categories.get(c.pattern.categoryId)?.name ?? c.pattern.categoryId;
        const label =
          c.pattern.type === 'COUNTERPARTY'
            ? (describe.counterparties.get(c.pattern.value)?.name ?? c.pattern.value)
            : c.pattern.value;
        const { priority, cannotOutrank } = proposedPriority(conflicts.map((k) => k.priority));
        const shown = (list: readonly string[]) =>
          list
            .slice(0, MAX_EVIDENCE_SHOWN)
            .map((id) => evidenceView(mined.byId.get(id) as ClassificationEvidenceDto));
        return {
          suggestionId: c.suggestionId,
          pattern: c.pattern,
          ...(c.pattern.type === 'COUNTERPARTY' ? { patternLabel: label } : {}),
          categoryName,
          support: c.support,
          evidenceCount: c.evidenceCount,
          confidence: c.confidence,
          confidenceLevel: c.level,
          proposedRule: {
            name: proposedRuleName(categoryName, label),
            priority,
            matchMode: 'ALL',
            conditions: proposedConditions(c.pattern),
            actions: [{ type: 'SET_CATEGORY', categoryId: c.pattern.categoryId }],
            triggers: ['IMPORT', 'RETROACTIVE'],
            stopProcessing: false,
          },
          evidence: shown(c.evidenceIds),
          counterExamples: shown(c.counterExampleIds),
          conflicts,
          warnings: cannotOutrank ? ['CANNOT_OUTRANK'] : [],
          status: decisions.get(c.suggestionId)?.decision === 'DISMISSED' ? 'DISMISSED' : 'OPEN',
        };
      });
      return {
        generatedAt: this.deps.clock.now().toString(),
        from: mined.from,
        to: mined.to,
        scanned: mined.scanned,
        truncated: mined.truncated,
        items,
      };
    });
  }

  // ------------------------------------------------------------------ vista previa

  /**
   * Prueba una sugerencia (tal cual o editada) sobre las transacciones de la ventana con el evaluador del dry-run y una
   * regla transitoria (sin id persistido ni caché): cuenta qué completaría, qué ya está en la categoría y qué tiene otra.
   */
  async preview(workspaceId: string, cmd: PreviewProposalCommand): Promise<ProposalPreview> {
    const pattern = parseProposalPattern(cmd.suggestionId, cmd.pattern);
    const windowDays = this.windowOf(cmd.windowDays);
    return this.deps.uow.run(workspaceId, async () => {
      const definition: RuleDefinition = parseDefinition(
        cmd.definition ?? {
          matchMode: 'ALL',
          conditions: proposedConditions(pattern),
          actions: [{ type: 'SET_CATEGORY', categoryId: pattern.categoryId }],
        },
      );
      const transient: EvaluableRule = {
        ...definition,
        id: 'suggestion-preview',
        version: 0,
        priority: 0,
        createdAt: this.deps.clock.now().toString(),
        enabled: true,
        archived: false,
        triggers: [...new Set([...definition.triggers, 'RETROACTIVE' as const])],
      };
      const setCategory = definition.actions.find(
        (a): a is Extract<Action, { type: 'SET_CATEGORY' }> => a.type === 'SET_CATEGORY',
      );
      const proposedCategoryId = setCategory?.categoryId ?? pattern.categoryId;
      const to = await this.deps.calendar.today(workspaceId);
      const from = addDays(to, -windowDays);
      const page = await this.deps.subjects.list({
        workspaceId,
        from,
        to,
        limit: this.deps.settings.dryRunMaxTransactions,
      });
      const catalog = await this.deps.catalog.load({ workspaceId, actions: definition.actions });
      const set = CompiledRuleSet.compile([transient], 'RETROACTIVE');
      const counts = { matched: 0, wouldFill: 0, alreadyInCategory: 0, otherCategory: 0, notApplicable: 0 };
      const items: ProposalPreviewItem[] = [];
      for (const subject of page.items) {
        const outcome = set.evaluate(toSubject(subject), 'FILL_EMPTY', catalog);
        if (outcome.matched.length === 0) continue;
        counts.matched += 1;
        const reasons: string[] = [];
        let result: ProposalOutcome;
        const skip = outcome.skipped.find((k) => k.action === 'SET_CATEGORY');
        if (outcome.category) {
          if (subject.managedBy !== null) reasons.push('TRANSACTION_MANAGED_EXTERNALLY');
          if (subject.status === 'RECONCILED') reasons.push('TRANSACTION_RECONCILED');
          result = reasons.length === 0 ? 'WOULD_FILL' : 'NOT_APPLICABLE';
        } else if (skip?.reason === SKIP_REASONS.notEmpty) {
          result = subject.categoryId === proposedCategoryId ? 'ALREADY_IN_CATEGORY' : 'OTHER_CATEGORY';
        } else {
          if (skip) reasons.push(skip.reason);
          result = 'NOT_APPLICABLE';
        }
        if (result === 'WOULD_FILL') counts.wouldFill += 1;
        else if (result === 'ALREADY_IN_CATEGORY') counts.alreadyInCategory += 1;
        else if (result === 'OTHER_CATEGORY') counts.otherCategory += 1;
        else counts.notApplicable += 1;
        items.push({
          transactionId: subject.transactionId,
          date: subject.date,
          description: subject.description,
          amount: subject.amount,
          currentCategoryId: subject.categoryId,
          currentOrigin: subject.categoryOrigin,
          proposedCategoryId,
          outcome: result,
          reasons,
        });
      }
      items.sort((a, b) =>
        a.date === b.date ? (a.transactionId < b.transactionId ? 1 : -1) : a.date < b.date ? 1 : -1,
      );
      return {
        from,
        to,
        scanned: page.items.length,
        truncated: page.next !== null,
        ...counts,
        items: items.slice(0, MAX_PREVIEW_ITEMS),
      };
    });
  }

  // ------------------------------------------------------------------ descartar y restaurar

  async dismiss(
    userId: string,
    workspaceId: string,
    suggestionId: unknown,
    rawPattern: unknown,
  ): Promise<void> {
    const pattern = parseProposalPattern(suggestionId, rawPattern);
    const id = suggestionId as string;
    await this.deps.uow.run(workspaceId, async () => {
      if (await this.deps.decisions.find(workspaceId, id)) throw decided();
      const snapshot = await snapshotOf(this.deps, workspaceId, id);
      const record: RuleProposalDecisionRecord = {
        suggestionId: id,
        patternType: pattern.type,
        patternValue: pattern.value,
        kind: pattern.kind,
        categoryId: pattern.categoryId,
        decision: 'DISMISSED',
        ruleId: null,
        support: snapshot?.support ?? null,
        evidenceCount: snapshot?.evidenceCount ?? null,
        confidence: snapshot?.confidence ?? null,
        decidedAt: this.deps.clock.now().toString(),
        decidedBy: userId,
      };
      if (!(await this.deps.decisions.insert(workspaceId, record))) throw decided();
      await this.deps.audit.append({
        workspaceId,
        action: 'rules.suggestion.dismissed',
        aggregateType: 'RuleSuggestion',
        aggregateId: suggestionAggregateId(id),
        actor: { type: 'USER', userId },
        changes: decisionChanges(record),
      });
    });
  }

  async restore(userId: string, workspaceId: string, suggestionId: unknown): Promise<void> {
    if (typeof suggestionId !== 'string' || !/^[0-9a-f]{64}$/u.test(suggestionId)) {
      throw invalid('suggestionId must be a 64-character hexadecimal fingerprint', '/suggestionId');
    }
    await this.deps.uow.run(workspaceId, async () => {
      const found = await this.deps.decisions.find(workspaceId, suggestionId);
      if (!found) throw new DomainError('RESOURCE_NOT_FOUND', `suggestion ${suggestionId} has no decision`);
      if (found.decision === 'ACCEPTED') throw decided();
      if (!(await this.deps.decisions.deleteDismissed(workspaceId, suggestionId))) throw decided();
      await this.deps.audit.append({
        workspaceId,
        action: 'rules.suggestion.restored',
        aggregateType: 'RuleSuggestion',
        aggregateId: suggestionAggregateId(suggestionId),
        actor: { type: 'USER', userId },
        changes: [
          { field: 'decision', before: found.decision, after: null },
          { field: 'patternType', before: found.patternType, after: null },
          { field: 'patternValue', before: found.patternValue, after: null },
          { field: 'kind', before: found.kind, after: null },
          { field: 'categoryId', before: found.categoryId, after: null },
        ],
      });
    });
  }
}
