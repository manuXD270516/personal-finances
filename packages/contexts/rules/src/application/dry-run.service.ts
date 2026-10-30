import { createHash } from 'node:crypto';
import type { AuditEntry } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import type {
  ClassificationSubjectDto,
  RuleClassificationItemDto,
  RuleRefDto,
} from '@pf/transactions/contracts';
import type { EvaluableRule, EvaluationMode, RuleOutcome, RuleSubject } from '../domain/index.js';
import type { RulesDeps } from './ports/index.js';
import type { RulesQueries } from './rules.queries.js';

const MAX_NOTES = 4000;
const DAY_MS = 86_400_000;

export interface DryRunCommand {
  /** Reglas a ejecutar; ausente ⇒ todas las activas con disparador retroactivo. */
  readonly ruleIds?: readonly string[];
  readonly from: string;
  readonly to: string;
  readonly accountIds?: readonly string[];
  readonly mode: EvaluationMode;
}

export interface DryRunChange {
  /** `categoryId`, `counterpartyId`, `tagAdded`, `tagRemoved`, `customField:<fieldId>`, `description`, `notes`, `needsReview`. */
  readonly field: string;
  readonly before: string | boolean | null;
  readonly after: string | boolean | null;
  readonly ruleId: string;
  readonly ruleVersion: number;
}

export interface DryRunItem {
  readonly transactionId: string;
  readonly version: number;
  readonly applicable: boolean;
  readonly reasons: readonly string[];
  readonly changes: readonly DryRunChange[];
}

export interface DryRunResult {
  readonly scanned: number;
  readonly changed: number;
  readonly truncated: boolean;
  /** Huella de las reglas (id y versión) y el modo: si una regla cambia, la aplicación se rechaza. */
  readonly token: string;
  readonly items: readonly DryRunItem[];
}

export interface ApplyDryRunCommand {
  readonly token: string;
  readonly ruleIds?: readonly string[];
  readonly mode: EvaluationMode;
  /** Las transacciones a aplicar con la versión que mostró el dry-run (hasta 500 por operación). */
  readonly items: readonly { readonly transactionId: string; readonly version: number }[];
}

export interface ApplyDryRunResult {
  readonly bulkOperationId: string;
  readonly applied: number;
  readonly notApplicable: readonly { readonly transactionId: string; readonly reason: string }[];
}

const stale = (detail: string) => new DomainError('RULE_DRY_RUN_STALE', `the dry-run is stale: ${detail}`);

/** Token: SHA-256 de las reglas (id y versión, ordenadas) y el modo. */
export function dryRunToken(rules: readonly EvaluableRule[], mode: EvaluationMode): string {
  const parts = rules.map((r) => `${r.id}@${r.version}`).sort();
  return createHash('sha256')
    .update(JSON.stringify({ rules: parts, mode }))
    .digest('hex');
}

const toSubject = (s: ClassificationSubjectDto): RuleSubject => ({
  ref: s.transactionId,
  kind: s.kind,
  accountId: s.accountId,
  date: s.date,
  amount: s.amount,
  description: s.description,
  counterpartyId: s.counterpartyId,
  counterpartyOrigin: s.counterpartyId === null ? null : 'USER',
  categoryId: s.categoryId,
  tagIds: s.tagIds,
  externalSource: s.externalSource,
  customFields: s.customFields,
  splitCount: s.splitCount,
  notes: s.notes,
});

function composeNotes(current: string | null, appended: readonly string[]): string | null {
  if (appended.length === 0) return null;
  const next = [current ?? '', ...appended].filter((t) => t.length > 0).join('\n');
  return next.length > MAX_NOTES ? null : next;
}

/** Cambios que un resultado de reglas produce sobre un sujeto (los que difieren del valor actual). */
export function changesOf(subject: ClassificationSubjectDto, outcome: RuleOutcome): DryRunChange[] {
  const o = (origin: { ruleId: string; ruleVersion: number }) => ({
    ruleId: origin.ruleId,
    ruleVersion: origin.ruleVersion,
  });
  const out: DryRunChange[] = [];
  if (outcome.category && outcome.category.categoryId !== subject.categoryId) {
    out.push({
      field: 'categoryId',
      before: subject.categoryId,
      after: outcome.category.categoryId,
      ...o(outcome.category.origin),
    });
  }
  if (outcome.counterparty && outcome.counterparty.counterpartyId !== subject.counterpartyId) {
    out.push({
      field: 'counterpartyId',
      before: subject.counterpartyId,
      after: outcome.counterparty.counterpartyId,
      ...o(outcome.counterparty.origin),
    });
  }
  for (const t of outcome.addTags)
    out.push({ field: 'tagAdded', before: null, after: t.tagId, ...o(t.origin) });
  for (const t of outcome.removeTags) {
    out.push({ field: 'tagRemoved', before: t.tagId, after: null, ...o(t.origin) });
  }
  for (const f of outcome.customFields) {
    const current = subject.customFields.find((c) => c.fieldId === f.fieldId)?.value ?? null;
    out.push({ field: `customField:${f.fieldId}`, before: current, after: f.value, ...o(f.origin) });
  }
  if (outcome.description && outcome.description.text !== subject.description) {
    out.push({
      field: 'description',
      before: subject.description,
      after: outcome.description.text,
      ...o(outcome.description.origin),
    });
  }
  const first = outcome.appendNotes[0];
  if (first) {
    const next = composeNotes(
      subject.notes,
      outcome.appendNotes.map((n) => n.text),
    );
    if (next !== null) out.push({ field: 'notes', before: subject.notes, after: next, ...o(first.origin) });
  }
  if (outcome.markForReview && !subject.needsReview) {
    out.push({ field: 'needsReview', before: false, after: true, ...o(outcome.markForReview) });
  }
  return out;
}

/** Cambios aplicables en la forma que acepta `RuleClassificationCommand` (con regla y versión por campo). */
export function appliedItemOf(
  subject: ClassificationSubjectDto,
  outcome: RuleOutcome,
  expectedVersion: number,
): RuleClassificationItemDto | null {
  const changes = changesOf(subject, outcome);
  if (changes.length === 0) return null;
  const refs: RuleRefDto[] = [];
  const ref = (field: string, c: { ruleId: string; ruleVersion: number }) =>
    refs.push({ field, ruleId: c.ruleId, ruleVersion: c.ruleVersion });
  const categoryChange = changes.find((c) => c.field === 'categoryId');
  const reviewChange = changes.find((c) => c.field === 'needsReview');
  const addTagIds: string[] = [];
  const removeTagIds: string[] = [];
  const customFields: { fieldId: string; value: string | boolean }[] = [];
  let counterpartyId: string | undefined;
  let description: string | undefined;
  let notesAdded: string[] = [];
  for (const c of changes) {
    if (c.field === 'tagAdded') {
      addTagIds.push(c.after as string);
      ref(`TAG:${c.after as string}`, c);
    } else if (c.field === 'tagRemoved') {
      removeTagIds.push(c.before as string);
    } else if (c.field.startsWith('customField:')) {
      const fieldId = c.field.slice('customField:'.length);
      customFields.push({ fieldId, value: c.after as string | boolean });
      ref(`CUSTOM_FIELD:${fieldId}`, c);
    } else if (c.field === 'counterpartyId') {
      counterpartyId = c.after as string;
      ref('COUNTERPARTY', c);
    } else if (c.field === 'description') {
      description = c.after as string;
      ref('DESCRIPTION', c);
    } else if (c.field === 'notes') {
      notesAdded = outcome.appendNotes.map((n) => n.text);
      ref('NOTES', c);
    }
  }
  return {
    transactionId: subject.transactionId,
    expectedVersion,
    changes: {
      ...(categoryChange ? { categoryId: categoryChange.after as string } : {}),
      ...(addTagIds.length > 0 ? { addTagIds } : {}),
      ...(removeTagIds.length > 0 ? { removeTagIds } : {}),
      ...(counterpartyId !== undefined ? { counterpartyId } : {}),
      ...(customFields.length > 0 ? { customFields } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(notesAdded.length > 0 ? { appendNotes: notesAdded } : {}),
      ...(reviewChange ? { markForReview: true } : {}),
    },
    ...(categoryChange
      ? { categoryRule: { ruleId: categoryChange.ruleId, ruleVersion: categoryChange.ruleVersion } }
      : {}),
    ruleRefs: refs,
    ...(reviewChange
      ? { reviewRule: { ruleId: reviewChange.ruleId, ruleVersion: reviewChange.ruleVersion } }
      : {}),
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/**
 * Dry-run retroactivo y su aplicación (openspec add-rule-engine decisión 10). El dry-run no persiste nada; la aplicación
 * reutiliza el dominio de la edición masiva de TRANSACTIONS (atómica, versión por ítem, periodos cerrados no
 * aplicables, un `bulkOperationId` común y origen `RULE`).
 */
export class RuleDryRunService {
  constructor(
    private readonly deps: RulesDeps,
    private readonly queries: RulesQueries,
  ) {}

  private assertWindow(cmd: Pick<DryRunCommand, 'from' | 'to'>): void {
    const valid = (d: string) =>
      /^\d{4}-\d{2}-\d{2}$/u.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
    if (!valid(cmd.from)) throw new DomainError('VALIDATION_FAILED', 'from must be YYYY-MM-DD').at('/from');
    if (!valid(cmd.to)) throw new DomainError('VALIDATION_FAILED', 'to must be YYYY-MM-DD').at('/to');
    const days = daysBetween(cmd.from, cmd.to);
    if (days < 1) throw new DomainError('VALIDATION_FAILED', 'from must not be after to').at('/to');
    if (days > this.deps.settings.dryRunMaxDays) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `the range has at most ${this.deps.settings.dryRunMaxDays} days`,
      ).at('/to');
    }
  }

  private async loadRules(
    workspaceId: string,
    ruleIds: readonly string[] | undefined,
  ): Promise<EvaluableRule[]> {
    if (ruleIds === undefined || ruleIds.length === 0) {
      return this.deps.rules.listEvaluable(workspaceId, 'RETROACTIVE');
    }
    const found = await this.deps.rules.listEvaluableByIds(workspaceId, ruleIds);
    // Una selección explícita se ejecuta aunque la regla no tenga el disparador retroactivo.
    return found.map((r) => ({ ...r, triggers: [...new Set([...r.triggers, 'RETROACTIVE' as const])] }));
  }

  async dryRun(workspaceId: string, cmd: DryRunCommand): Promise<DryRunResult> {
    this.assertWindow(cmd);
    return this.deps.uow.run(workspaceId, async () => {
      const rules = await this.loadRules(workspaceId, cmd.ruleIds);
      const max = this.deps.settings.dryRunMaxTransactions;
      const page = await this.deps.subjects.list({
        workspaceId,
        from: cmd.from,
        to: cmd.to,
        ...(cmd.accountIds && cmd.accountIds.length > 0 ? { accountIds: cmd.accountIds } : {}),
        limit: max,
      });
      const outcomes = await this.queries.evaluateWith(
        workspaceId,
        rules,
        page.items.map(toSubject),
        'RETROACTIVE',
        cmd.mode,
      );
      const items: DryRunItem[] = [];
      for (const [i, subject] of page.items.entries()) {
        const changes = changesOf(subject, outcomes[i] as RuleOutcome);
        if (changes.length === 0) continue;
        const reasons: string[] = [];
        if (subject.managedBy !== null) reasons.push('TRANSACTION_MANAGED_EXTERNALLY');
        if (subject.status === 'RECONCILED') reasons.push('TRANSACTION_RECONCILED');
        items.push({
          transactionId: subject.transactionId,
          version: subject.version,
          applicable: reasons.length === 0,
          reasons,
          changes,
        });
      }
      return {
        scanned: page.items.length,
        changed: items.length,
        truncated: page.next !== null,
        token: dryRunToken(rules, cmd.mode),
        items,
      };
    });
  }

  async apply(userId: string, workspaceId: string, cmd: ApplyDryRunCommand): Promise<ApplyDryRunResult> {
    const max = this.deps.settings.applyMaxItems;
    if (cmd.items.length === 0 || cmd.items.length > max) {
      throw new DomainError('VALIDATION_FAILED', `between 1 and ${max} transactions`).at('/items');
    }
    if (new Set(cmd.items.map((i) => i.transactionId)).size !== cmd.items.length) {
      throw new DomainError('VALIDATION_FAILED', 'a transaction appears more than once').at('/items');
    }
    return this.deps.uow.run(workspaceId, async () => {
      const rules = await this.loadRules(workspaceId, cmd.ruleIds);
      if (dryRunToken(rules, cmd.mode) !== cmd.token) throw stale('the rules changed');
      const subjects = new Map(
        (
          await this.deps.subjects.byIds({
            workspaceId,
            transactionIds: cmd.items.map((i) => i.transactionId),
          })
        ).map((s) => [s.transactionId, s]),
      );
      for (const item of cmd.items) {
        const s = subjects.get(item.transactionId);
        if (!s) throw stale(`transaction ${item.transactionId} is no longer available`);
        if (s.version !== item.version) throw stale(`transaction ${item.transactionId} changed`);
      }
      const ordered = cmd.items.map((i) => subjects.get(i.transactionId) as ClassificationSubjectDto);
      const outcomes = await this.queries.evaluateWith(
        workspaceId,
        rules,
        ordered.map(toSubject),
        'RETROACTIVE',
        cmd.mode,
      );
      const notApplicable: { transactionId: string; reason: string }[] = [];
      const toApply: RuleClassificationItemDto[] = [];
      for (const [i, subject] of ordered.entries()) {
        if (subject.managedBy !== null) {
          notApplicable.push({
            transactionId: subject.transactionId,
            reason: 'TRANSACTION_MANAGED_EXTERNALLY',
          });
          continue;
        }
        if (subject.status === 'RECONCILED') {
          notApplicable.push({ transactionId: subject.transactionId, reason: 'TRANSACTION_RECONCILED' });
          continue;
        }
        const item = appliedItemOf(subject, outcomes[i] as RuleOutcome, subject.version);
        if (item) toApply.push(item);
      }
      const bulkOperationId = this.deps.ids.next();
      let applied: readonly string[] = [];
      if (toApply.length > 0) {
        try {
          const result = await this.deps.classifier.applyBatch({
            workspaceId,
            actorUserId: userId,
            operationId: bulkOperationId,
            items: toApply,
          });
          applied = result.applied;
          notApplicable.push(...result.notApplicable);
        } catch (err) {
          if (err instanceof DomainError && err.code === 'CONCURRENCY_CONFLICT') {
            throw stale('a transaction changed during the application');
          }
          throw err;
        }
      }
      const entry: AuditEntry = {
        workspaceId,
        action: 'rules.dry_run.applied',
        aggregateType: 'RuleDryRunApplication',
        aggregateId: bulkOperationId,
        correlationId: bulkOperationId,
        actor: { type: 'USER', userId },
        origin: 'rule',
        changes: [
          { field: 'bulkOperationId', before: null, after: bulkOperationId },
          { field: 'count', before: null, after: applied.length },
          { field: 'ruleIds', before: null, after: JSON.stringify(rules.map((r) => r.id).sort()) },
        ],
      };
      await this.deps.audit.append(entry);
      return { bulkOperationId, applied: applied.length, notApplicable };
    });
  }
}
