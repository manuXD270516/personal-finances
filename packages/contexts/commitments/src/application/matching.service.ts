import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, LocalDate } from '@pf/shared-kernel';
import type { TransactionLinkDto } from '@pf/transactions/contracts';
import { COMMITMENTS_EVENTS, type OccurrenceMatchSuggestedV1 } from '../contracts/index.js';
import {
  MAX_DATE_WINDOW_DAYS,
  MatchSuggestion,
  OccurrenceMatcher,
  isEligibleTransaction,
  type ExpireReason,
  type MatchCandidate,
  type MatchTransaction,
  type SuggestionState,
} from '../domain/index.js';
import type { OccurrencesService } from './occurrences.service.js';
import type { CommitmentsDeps, MatchOccurrenceRow } from './ports/index.js';
import { publishEvent } from './recorder.js';
import { money, type OccurrenceDto } from './views.js';

export const MATCH_SUGGESTION_AGGREGATE = 'MatchSuggestion';
/** Métrica de resultados para calibrar los valores por omisión (design § Riesgos). */
export const MATCH_METRIC = 'commitments_match_suggestions_total';

const MATCH_AUDIT = 'commitments.match_suggestion';
const OPEN_STATUSES = ['SCHEDULED', 'DUE', 'OVERDUE'] as const;

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `match suggestion ${id} not found`);
const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

const toMatchTransaction = (t: TransactionLinkDto): MatchTransaction => ({
  transactionId: t.transactionId,
  kind: t.kind,
  status: t.status,
  businessDate: t.businessDate,
  amount: t.amount,
  accountId: t.accountId,
  toAccountId: t.toAccountId,
  counterpartyId: t.counterpartyId,
  externalRef: t.externalRef,
});

const pairKey = (occurrenceId: string, transactionId: string): string => `${occurrenceId}|${transactionId}`;

export interface MatchRunResult {
  /** Sugerencias nuevas o re-propuestas (producen `OccurrenceMatchSuggested.v1`). */
  readonly proposed: number;
  readonly refreshed: number;
  readonly expired: number;
}

const NOTHING: MatchRunResult = { proposed: 0, refreshed: 0, expired: 0 };

/**
 * Sugerencias de coincidencia entre ocurrencias y transacciones (openspec add-commitment-matching, FR-COMMITMENTS-010).
 * Lado asíncrono: los consumidores `commitments.occurrence-matcher` (hechos de Transactions) y
 * `commitments.match-backfill` (ocurrencias nuevas, reinstauradas o reescritas) evalúan con el servicio de dominio
 * `OccurrenceMatcher` y guardan sugerencias idempotentes (`UNIQUE (occurrence_id, transaction_id)`). Lado síncrono:
 * `confirm` y `dismiss`. Jamás cambia una ocurrencia ni una transacción por sí solo: solo `confirm` vincula, con la
 * confirmación explícita de un EDITOR u OWNER y reutilizando `LinkOccurrence` (D121).
 */
export class MatchingService {
  constructor(
    private readonly deps: CommitmentsDeps,
    private readonly occurrences: OccurrencesService,
  ) {}

  private async todayOf(workspaceId: string): Promise<{ today: LocalDate; at: string }> {
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    const now = this.deps.clock.now();
    return { today: LocalDate.ofInstant(now, calendar.timeZone), at: now.toString() };
  }

  private count(outcome: string, value = 1): void {
    if (value > 0) this.deps.metrics?.increment(MATCH_METRIC, { outcome }, value);
  }

  // ───────────────────────────────────────────────────────────── consumidor de Transactions

  /**
   * `transactions.TransactionCreated.v1` y `TransactionUpdated.v1` (con cambios financieros): relee la transacción y la
   * evalúa contra las ocurrencias no resueltas del workspace. Idempotente: el inbox deduplica el evento y el UNIQUE del
   * par deduplica la sugerencia; una transacción anulada o ya vinculada no genera sugerencias.
   */
  onTransactionChanged(input: {
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly eventId: string | null;
  }): Promise<MatchRunResult> {
    const { deps } = this;
    const { workspaceId } = input;
    return deps.uow.run(workspaceId, async () => {
      const [found] = await deps.links.getManyForLink({ workspaceId, transactionIds: [input.transactionId] });
      const existing = await deps.matching.listByTransaction(workspaceId, input.transactionId);
      if (!found) return NOTHING;
      const tx = toMatchTransaction(found);
      let candidates: readonly MatchCandidate[] = [];
      let dropReason: ExpireReason = 'INCOMPATIBLE';
      if (found.status === 'VOIDED') {
        dropReason = 'TRANSACTION_VOIDED';
      } else if (!isEligibleTransaction(tx)) {
        dropReason = 'INCOMPATIBLE';
      } else if ((await deps.matching.linkedTransactionIds(workspaceId, [tx.transactionId])).size > 0) {
        dropReason = 'SUPERSEDED';
      } else {
        const occurrences = await deps.matching.candidateOccurrences(workspaceId, {
          kind: tx.kind,
          accountId: tx.accountId,
          toAccountId: tx.toAccountId,
          from: LocalDate.parse(tx.businessDate).plusDays(-MAX_DATE_WINDOW_DAYS).toString(),
          to: LocalDate.parse(tx.businessDate).plusDays(MAX_DATE_WINDOW_DAYS).toString(),
        });
        candidates = OccurrenceMatcher.forTransaction(
          tx,
          occurrences.map((row) => row.occurrence),
        );
      }
      return this.reconcile({
        workspaceId,
        candidates,
        existing,
        expireMissing: true,
        dropReason,
        eventId: input.eventId,
        sources: new Map([[tx.transactionId, found.source]]),
      });
    });
  }

  /**
   * `transactions.TransactionVoided.v1`: expira (`TRANSACTION_VOIDED`) las propuestas de la transacción. No relee la
   * transacción: el hecho basta y no depende del orden de entrega.
   */
  onTransactionVoided(input: {
    readonly workspaceId: string;
    readonly transactionId: string;
  }): Promise<number> {
    const { deps } = this;
    return deps.uow.run(input.workspaceId, async () => {
      const ids = await deps.matching.expireForTransaction(
        input.workspaceId,
        input.transactionId,
        'TRANSACTION_VOIDED',
      );
      this.count('expired', ids.length);
      return ids.length;
    });
  }

  // ───────────────────────────────────────────────────────────── backfill

  /**
   * `commitments.OccurrencesGenerated.v1` y `RecurringDefinitionChanged.v1` (reinstauradas y reescritas): para las
   * ocurrencias cuya ventana de fechas ya empezó busca transacciones existentes no anuladas ni vinculadas y las sugiere
   * con los mismos criterios, sin repetir pares descartados.
   */
  onOccurrencesAvailable(input: {
    readonly workspaceId: string;
    readonly occurrenceIds: readonly string[];
    readonly eventId: string | null;
  }): Promise<MatchRunResult> {
    const { deps } = this;
    const { workspaceId } = input;
    if (input.occurrenceIds.length === 0) return Promise.resolve(NOTHING);
    return deps.uow.run(workspaceId, async () => {
      const { today } = await this.todayOf(workspaceId);
      const rows = (await deps.matching.occurrencesByIds(workspaceId, input.occurrenceIds)).filter(
        (row) =>
          (OPEN_STATUSES as readonly string[]).includes(row.occurrence.status) &&
          this.windowStarted(row, today),
      );
      if (rows.length === 0) return NOTHING;

      const accountIds = [...new Set(rows.map((r) => r.occurrence.accountId))];
      const windows = rows.map((r) => this.windowOf(r));
      const from = windows.map((w) => w.from).sort()[0] as string;
      const to = windows
        .map((w) => w.to)
        .sort()
        .at(-1) as string;
      const found = await deps.links.listLinkCandidates({ workspaceId, accountIds, from, to });
      const linked = await deps.matching.linkedTransactionIds(
        workspaceId,
        found.map((t) => t.transactionId),
      );
      const transactions = found.filter((t) => !linked.has(t.transactionId));
      const matchTransactions = transactions.map(toMatchTransaction);
      const sources = new Map(transactions.map((t) => [t.transactionId, t.source] as const));
      const existing = await deps.matching.listByOccurrences(
        workspaceId,
        rows.map((r) => r.occurrence.occurrenceId),
      );
      const total = { proposed: 0, refreshed: 0, expired: 0 };
      for (const row of rows) {
        const own = existing.filter((s) => s.occurrenceId === row.occurrence.occurrenceId);
        const candidates = OccurrenceMatcher.forOccurrence(row.occurrence, matchTransactions);
        const result = await this.reconcile({
          workspaceId,
          candidates,
          existing: own,
          expireMissing: true,
          dropReason: 'INCOMPATIBLE',
          eventId: input.eventId,
          sources,
        });
        total.proposed += result.proposed;
        total.refreshed += result.refreshed;
        total.expired += result.expired;
      }
      return total;
    });
  }

  private windowOf(row: MatchOccurrenceRow): { from: string; to: string } {
    const days = row.occurrence.tolerances.dateWindowDays ?? MAX_DATE_WINDOW_DAYS;
    const due = LocalDate.parse(row.occurrence.dueDate);
    return { from: due.plusDays(-days).toString(), to: due.plusDays(days).toString() };
  }

  /** La ventana de fechas ya empezó: `dueDate − ventana ≤ hoy` (design decisión 5). */
  private windowStarted(row: MatchOccurrenceRow, today: LocalDate): boolean {
    return LocalDate.parse(this.windowOf(row).from).compare(today) <= 0;
  }

  // ───────────────────────────────────────────────────────────── reconciliación

  /**
   * Aplica las candidatas del matcher sobre las sugerencias existentes del mismo grupo (una transacción o una
   * ocurrencia): crea las nuevas (`ON CONFLICT DO NOTHING`), recalcula las propuestas que siguen compatibles,
   * re-propone las expiradas por incompatibilidad (D136) y expira las propuestas que dejaron de serlo. Una descartada,
   * confirmada o expirada por otro motivo jamás cambia (D121/D136).
   */
  private async reconcile(input: {
    readonly workspaceId: string;
    readonly candidates: readonly MatchCandidate[];
    readonly existing: readonly MatchSuggestion[];
    readonly expireMissing: boolean;
    readonly dropReason: ExpireReason;
    readonly eventId: string | null;
    readonly sources: ReadonlyMap<string, string>;
  }): Promise<MatchRunResult> {
    const { deps } = this;
    const { workspaceId } = input;
    const at = deps.clock.now().toString();
    const byPair = new Map(input.existing.map((s) => [pairKey(s.occurrenceId, s.transactionId), s] as const));
    const seen = new Set<string>();
    let proposed = 0;
    let refreshed = 0;
    let expired = 0;

    for (const candidate of input.candidates) {
      const key = pairKey(candidate.occurrenceId, candidate.transactionId);
      seen.add(key);
      const current = byPair.get(key);
      const source = input.sources.get(candidate.transactionId) ?? 'MANUAL';
      if (!current) {
        const suggestion = MatchSuggestion.propose({
          id: deps.ids.next(),
          workspaceId,
          candidate,
          sourceEventId: input.eventId,
          at,
        });
        if (await deps.matching.insertIfAbsent(suggestion)) {
          await this.publishSuggested(suggestion, source);
          proposed += 1;
        }
        continue;
      }
      if (current.status === 'PROPOSED') {
        if (current.refresh(candidate)) {
          await this.persist(current);
          refreshed += 1;
        }
        continue;
      }
      if (current.status === 'EXPIRED' && current.snapshot.expireReason === 'INCOMPATIBLE') {
        current.repropose(candidate, input.eventId);
        await this.persist(current);
        await this.publishSuggested(current, source);
        proposed += 1;
      }
      // DISMISSED, CONFIRMED y las expiradas por otro motivo: nunca se tocan.
    }

    if (input.expireMissing) {
      for (const current of input.existing) {
        if (!current.proposed || seen.has(pairKey(current.occurrenceId, current.transactionId))) continue;
        current.expire(input.dropReason);
        await this.persist(current);
        expired += 1;
      }
    }
    this.count('proposed', proposed);
    this.count('expired', expired);
    return { proposed, refreshed, expired };
  }

  private async persist(suggestion: MatchSuggestion): Promise<void> {
    if (!(await this.deps.matching.save(suggestion))) {
      throw new DomainError(
        'CONCURRENCY_CONFLICT',
        `match suggestion ${suggestion.id} changed concurrently; the delivery is retried`,
      );
    }
  }

  private async publishSuggested(suggestion: MatchSuggestion, transactionOrigin: string): Promise<void> {
    const s = suggestion.snapshot;
    const payload: OccurrenceMatchSuggestedV1 = {
      workspaceId: s.workspaceId,
      suggestionId: s.id,
      occurrenceId: s.occurrenceId,
      definitionId: s.definitionId,
      transactionId: s.transactionId,
      score: s.score,
      confidence: s.confidence,
      amountDelta: s.amountDelta === null ? null : money(s.amountDelta, s.currency),
      dateDeltaDays: s.dateDeltaDays,
      ambiguous: s.ambiguous,
      transactionOrigin,
    };
    await publishEvent(
      this.deps,
      {
        workspaceId: s.workspaceId,
        aggregateType: MATCH_SUGGESTION_AGGREGATE,
        aggregateId: s.id,
        aggregateVersion: s.version,
      },
      COMMITMENTS_EVENTS.occurrenceMatchSuggested,
      payload,
    );
  }

  // ───────────────────────────────────────────────────────────── comandos del usuario

  /**
   * `ConfirmMatchSuggestion` (EDITOR/OWNER): `FOR UPDATE` de la sugerencia; si ya no está propuesta ⇒
   * `MATCH_SUGGESTION_NOT_PENDING`. Vincula con `LinkOccurrence` (`matchedBy = SUGGESTION`; mismas validaciones, y
   * expira `SUPERSEDED` las demás propuestas de la ocurrencia y de la transacción), marca `CONFIRMED` y audita, todo en
   * una unidad de trabajo. El hecho `RecurringOccurrenceMaterialized.v1 {mode: MATCHED, matchedBy: SUGGESTION}` lo
   * publica el vínculo.
   */
  async confirm(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly suggestionId: string;
    readonly expectedVersion?: number | undefined;
  }): Promise<{ readonly suggestion: MatchSuggestion; readonly occurrence: OccurrenceDto }> {
    const { deps } = this;
    const { at } = await this.todayOf(input.workspaceId);
    return deps.uow.run(input.workspaceId, async () => {
      const suggestion = await this.lock(input.workspaceId, input.suggestionId, input.expectedVersion);
      if (!suggestion.proposed) {
        throw new DomainError(
          'MATCH_SUGGESTION_NOT_PENDING',
          `match suggestion ${suggestion.id} is ${suggestion.status}`,
        );
      }
      const before = suggestion.snapshot;
      const occurrence = await this.occurrences.link({
        workspaceId: input.workspaceId,
        userId: input.userId,
        occurrenceId: before.occurrenceId,
        transactionId: before.transactionId,
        matchedBy: 'SUGGESTION',
        suggestionId: before.id,
      });
      suggestion.confirm(input.userId, at);
      await this.persist(suggestion);
      await this.audit(suggestion, 'confirmed', before);
      this.count('confirmed');
      return { suggestion, occurrence };
    });
  }

  /** `DismissMatchSuggestion` (EDITOR/OWNER): descarte permanente del par; no cambia la ocurrencia ni la transacción. */
  async dismiss(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly suggestionId: string;
    readonly expectedVersion?: number | undefined;
  }): Promise<MatchSuggestion> {
    const { deps } = this;
    const { at } = await this.todayOf(input.workspaceId);
    return deps.uow.run(input.workspaceId, async () => {
      const suggestion = await this.lock(input.workspaceId, input.suggestionId, input.expectedVersion);
      const before = suggestion.snapshot;
      suggestion.dismiss(input.userId, at);
      await this.persist(suggestion);
      await this.audit(suggestion, 'dismissed', before);
      this.count('dismissed');
      return suggestion;
    });
  }

  private async lock(workspaceId: string, id: string, expectedVersion?: number): Promise<MatchSuggestion> {
    const suggestion = await this.deps.matching.findById(workspaceId, id, { lock: 'update' });
    if (!suggestion) throw notFound(id);
    if (expectedVersion !== undefined && suggestion.version !== expectedVersion) {
      throw preconditionFailed(suggestion.version);
    }
    return suggestion;
  }

  /** Auditoría de la decisión del usuario (INV-029): en la misma unidad de trabajo, sin recorrido (D134). */
  private async audit(
    suggestion: MatchSuggestion,
    action: 'confirmed' | 'dismissed',
    before: SuggestionState,
  ): Promise<void> {
    const after = suggestion.snapshot;
    const changes: AuditChangeInput[] = [
      { field: 'status', before: before.status, after: after.status },
      { field: 'occurrenceId', before: null, after: after.occurrenceId },
      { field: 'transactionId', before: null, after: after.transactionId },
      { field: 'definitionId', before: null, after: after.definitionId },
      { field: 'score', before: null, after: after.score },
      { field: 'confidence', before: null, after: after.confidence },
      { field: 'dateDeltaDays', before: null, after: after.dateDeltaDays },
      { field: 'ambiguous', before: null, after: after.ambiguous },
      ...(after.amountDelta === null
        ? []
        : [{ field: 'amountDelta', before: null, after: money(after.amountDelta, after.currency) }]),
    ];
    await this.deps.audit.append({
      workspaceId: after.workspaceId,
      action: `${MATCH_AUDIT}.${action}`,
      aggregateType: MATCH_SUGGESTION_AGGREGATE,
      aggregateId: after.id,
      aggregateVersion: after.version,
      changes,
    });
  }
}
