import { unitOfWorkKysely } from '@pf/platform/api';
import { dec } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type {
  MatchOccurrenceRow,
  MatchSuggestionRepository,
  SuggestionFilter,
} from '../application/ports/index.js';
import {
  MatchSuggestion,
  type AmountSpec,
  type ExpireReason,
  type OccurrenceStatus,
  type RecurringKind,
  type SuggestionState,
} from '../domain/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>();

const iso = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Decimal de la base a la escala de la moneda (`numeric(38,18)` devuelve 18 decimales). */
const canon = (value: string | null, scale: number): string | null =>
  value === null ? null : dec(value).toFixed(scale);

interface SuggestionRow {
  id: string;
  workspace_id: string;
  occurrence_id: string;
  definition_id: string;
  transaction_id: string;
  score: string;
  confidence: SuggestionState['confidence'];
  amount_delta: string | null;
  currency: string;
  scale: number;
  date_delta_days: number;
  counterparty_match: SuggestionState['counterparty'];
  ambiguous: boolean;
  status: SuggestionState['status'];
  expire_reason: ExpireReason | null;
  source_event_id: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  version: number;
}

const COLUMNS = sql.raw(`
  s.id, s.workspace_id, s.occurrence_id, s.definition_id, s.transaction_id, s.score::text AS score, s.confidence,
  s.amount_delta::text AS amount_delta, s.currency, c.scale, s.date_delta_days, s.counterparty_match, s.ambiguous,
  s.status, s.expire_reason, s.source_event_id, ${iso('s.created_at')} AS created_at,
  CASE WHEN s.decided_at IS NULL THEN NULL ELSE ${iso('s.decided_at')} END AS decided_at, s.decided_by, s.version`);

const toState = (r: SuggestionRow): SuggestionState => ({
  id: r.id,
  workspaceId: r.workspace_id,
  occurrenceId: r.occurrence_id,
  definitionId: r.definition_id,
  transactionId: r.transaction_id,
  score: dec(r.score).toFixed(2),
  confidence: r.confidence,
  amountDelta: canon(r.amount_delta, Number(r.scale)),
  currency: r.currency,
  dateDeltaDays: Number(r.date_delta_days),
  counterparty: r.counterparty_match,
  ambiguous: r.ambiguous,
  status: r.status,
  expireReason: r.expire_reason,
  sourceEventId: r.source_event_id,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  decidedBy: r.decided_by,
  version: Number(r.version),
});

interface MatchRow {
  id: string;
  definition_id: string;
  def_name: string;
  def_kind: RecurringKind;
  status: OccurrenceStatus;
  due_date: string;
  expected_type: AmountSpec['type'];
  expected_amount: string | null;
  expected_min: string | null;
  expected_max: string | null;
  currency: string;
  scale: number;
  account_id: string;
  to_account_id: string | null;
  counterparty_id: string | null;
  tol_pct: string | null;
  tol_days: number | null;
}

const MATCH_SELECT = sql.raw(`
  SELECT o.id, o.definition_id, d.name AS def_name, d.kind AS def_kind, o.status, o.due_date::text AS due_date,
         o.expected_type, o.expected_amount::text AS expected_amount, o.expected_min::text AS expected_min,
         o.expected_max::text AS expected_max, o.currency, c.scale, v.account_id, v.to_account_id, v.counterparty_id,
         d.matching_amount_tolerance_pct::text AS tol_pct, d.matching_date_window_days AS tol_days
    FROM commitments.recurring_occurrence o
    JOIN fx.currency c ON c.code = o.currency
    JOIN commitments.recurring_definition d ON d.workspace_id = o.workspace_id AND d.id = o.definition_id
    JOIN commitments.recurring_definition_version v
      ON v.definition_id = o.definition_id AND v.version_no = o.definition_version_no`);

const toMatchRow = (r: MatchRow): MatchOccurrenceRow => {
  const scale = Number(r.scale);
  return {
    definitionName: r.def_name,
    occurrence: {
      occurrenceId: r.id,
      definitionId: r.definition_id,
      kind: r.def_kind,
      status: r.status,
      dueDate: r.due_date,
      expected: {
        type: r.expected_type,
        amount: canon(r.expected_amount, scale),
        min: canon(r.expected_min, scale),
        max: canon(r.expected_max, scale),
      },
      currency: r.currency,
      accountId: r.account_id,
      toAccountId: r.to_account_id,
      counterpartyId: r.counterparty_id,
      tolerances: {
        amountTolerancePct: r.tol_pct === null ? null : dec(r.tol_pct).toFixed(2),
        dateWindowDays: r.tol_days === null ? null : Number(r.tol_days),
      },
    },
  };
};

export class PgMatchSuggestionRepository implements MatchSuggestionRepository {
  async insertIfAbsent(suggestion: MatchSuggestion): Promise<boolean> {
    const s = suggestion.snapshot;
    const res = await sql`
      INSERT INTO commitments.occurrence_match_suggestion
        (id, workspace_id, occurrence_id, definition_id, transaction_id, score, confidence, amount_delta, currency,
         date_delta_days, counterparty_match, ambiguous, status, expire_reason, source_event_id, created_at,
         decided_at, decided_by, version)
      VALUES (${s.id}::uuid, ${s.workspaceId}::uuid, ${s.occurrenceId}::uuid, ${s.definitionId}::uuid,
              ${s.transactionId}::uuid, ${s.score}::numeric, ${s.confidence}, ${s.amountDelta}::numeric, ${s.currency},
              ${s.dateDeltaDays}, ${s.counterparty}, ${s.ambiguous}, ${s.status}, ${s.expireReason},
              ${s.sourceEventId}::uuid, ${s.createdAt}::timestamptz, ${s.decidedAt}::timestamptz,
              ${s.decidedBy}::uuid, ${s.version})
      ON CONFLICT (occurrence_id, transaction_id) DO NOTHING`.execute(db());
    if (Number(res.numAffectedRows ?? 0) === 0) return false;
    suggestion.markPersisted();
    return true;
  }

  async findById(
    workspaceId: string,
    id: string,
    options: { readonly lock?: 'update' } = {},
  ): Promise<MatchSuggestion | null> {
    const { rows } = await sql<SuggestionRow>`
      SELECT ${COLUMNS}
        FROM commitments.occurrence_match_suggestion s
        JOIN fx.currency c ON c.code = s.currency
       WHERE s.workspace_id = ${workspaceId}::uuid AND s.id = ${id}::uuid
       ${options.lock === 'update' ? sql`FOR UPDATE OF s` : sql``}`.execute(db());
    return rows[0] ? MatchSuggestion.restore(toState(rows[0])) : null;
  }

  async save(suggestion: MatchSuggestion): Promise<boolean> {
    const s = suggestion.snapshot;
    const res = await sql`
      UPDATE commitments.occurrence_match_suggestion
         SET score = ${s.score}::numeric, confidence = ${s.confidence}, amount_delta = ${s.amountDelta}::numeric,
             date_delta_days = ${s.dateDeltaDays}, counterparty_match = ${s.counterparty},
             ambiguous = ${s.ambiguous}, status = ${s.status}, expire_reason = ${s.expireReason},
             source_event_id = ${s.sourceEventId}::uuid, decided_at = ${s.decidedAt}::timestamptz,
             decided_by = ${s.decidedBy}::uuid, version = ${s.version}
       WHERE workspace_id = ${s.workspaceId}::uuid AND id = ${s.id}::uuid
         AND version = ${suggestion.persistedVersion}`.execute(db());
    if (Number(res.numAffectedRows ?? 0) === 0) return false;
    suggestion.markPersisted();
    return true;
  }

  async listByTransaction(workspaceId: string, transactionId: string): Promise<MatchSuggestion[]> {
    const { rows } = await sql<SuggestionRow>`
      SELECT ${COLUMNS}
        FROM commitments.occurrence_match_suggestion s
        JOIN fx.currency c ON c.code = s.currency
       WHERE s.workspace_id = ${workspaceId}::uuid AND s.transaction_id = ${transactionId}::uuid
       ORDER BY s.created_at, s.id`.execute(db());
    return rows.map((r) => MatchSuggestion.restore(toState(r)));
  }

  async listByOccurrences(workspaceId: string, occurrenceIds: readonly string[]): Promise<MatchSuggestion[]> {
    if (occurrenceIds.length === 0) return [];
    const { rows } = await sql<SuggestionRow>`
      SELECT ${COLUMNS}
        FROM commitments.occurrence_match_suggestion s
        JOIN fx.currency c ON c.code = s.currency
       WHERE s.workspace_id = ${workspaceId}::uuid AND s.occurrence_id = ANY(${[...occurrenceIds]}::uuid[])
       ORDER BY s.created_at, s.id`.execute(db());
    return rows.map((r) => MatchSuggestion.restore(toState(r)));
  }

  async expireForOccurrences(
    workspaceId: string,
    occurrenceIds: readonly string[],
    reason: ExpireReason,
    options: { readonly exceptId?: string } = {},
  ): Promise<string[]> {
    if (occurrenceIds.length === 0) return [];
    const { rows } = await sql<{ id: string }>`
      UPDATE commitments.occurrence_match_suggestion
         SET status = 'EXPIRED', expire_reason = ${reason}, version = version + 1
       WHERE workspace_id = ${workspaceId}::uuid AND status = 'PROPOSED'
         AND occurrence_id = ANY(${[...occurrenceIds]}::uuid[])
         AND (${options.exceptId ?? null}::uuid IS NULL OR id <> ${options.exceptId ?? null}::uuid)
      RETURNING id`.execute(db());
    return rows.map((r) => r.id);
  }

  async expireForTransaction(
    workspaceId: string,
    transactionId: string,
    reason: ExpireReason,
    options: { readonly exceptId?: string } = {},
  ): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      UPDATE commitments.occurrence_match_suggestion
         SET status = 'EXPIRED', expire_reason = ${reason}, version = version + 1
       WHERE workspace_id = ${workspaceId}::uuid AND status = 'PROPOSED'
         AND transaction_id = ${transactionId}::uuid
         AND (${options.exceptId ?? null}::uuid IS NULL OR id <> ${options.exceptId ?? null}::uuid)
      RETURNING id`.execute(db());
    return rows.map((r) => r.id);
  }

  async list(workspaceId: string, filter: SuggestionFilter): Promise<MatchSuggestion[]> {
    const statuses = filter.statuses ? [...filter.statuses] : null;
    const after = filter.after ?? null;
    const { rows } = await sql<SuggestionRow>`
      SELECT ${COLUMNS}
        FROM commitments.occurrence_match_suggestion s
        JOIN fx.currency c ON c.code = s.currency
       WHERE s.workspace_id = ${workspaceId}::uuid
         AND (${statuses}::text[] IS NULL OR s.status = ANY(${statuses}::text[]))
         AND (${filter.occurrenceId ?? null}::uuid IS NULL OR s.occurrence_id = ${filter.occurrenceId ?? null}::uuid)
         AND (${filter.transactionId ?? null}::uuid IS NULL OR s.transaction_id = ${filter.transactionId ?? null}::uuid)
         AND (${filter.definitionId ?? null}::uuid IS NULL OR s.definition_id = ${filter.definitionId ?? null}::uuid)
         AND (${after?.[0] ?? null}::numeric IS NULL
              OR s.score < ${after?.[0] ?? null}::numeric
              OR (s.score = ${after?.[0] ?? null}::numeric AND s.id > ${after?.[1] ?? null}::uuid))
       ORDER BY s.score DESC, s.id
       ${filter.limit ? sql`LIMIT ${filter.limit}` : sql``}`.execute(db());
    return rows.map((r) => MatchSuggestion.restore(toState(r)));
  }

  async countProposed(workspaceId: string): Promise<number> {
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM commitments.occurrence_match_suggestion
       WHERE workspace_id = ${workspaceId}::uuid AND status = 'PROPOSED'`.execute(db());
    return Number(rows[0]?.n ?? 0);
  }

  async candidateOccurrences(
    workspaceId: string,
    input: {
      readonly kind: string;
      readonly accountId: string;
      readonly toAccountId: string | null;
      readonly from: string;
      readonly to: string;
    },
  ): Promise<MatchOccurrenceRow[]> {
    const transfer = input.kind === 'TRANSFER';
    const { rows } = await sql<MatchRow>`
      ${MATCH_SELECT}
       WHERE o.workspace_id = ${workspaceId}::uuid AND o.status IN ('SCHEDULED', 'DUE', 'OVERDUE')
         AND o.due_date BETWEEN ${input.from}::date AND ${input.to}::date
         AND d.kind = ${input.kind} AND d.kind <> 'LOAN_PAYMENT' AND v.account_id = ${input.accountId}::uuid
         ${transfer ? sql`AND v.to_account_id IS NOT DISTINCT FROM ${input.toAccountId}::uuid` : sql``}
       ORDER BY o.due_date, o.id`.execute(db());
    return rows.map(toMatchRow);
  }

  async occurrencesByIds(workspaceId: string, ids: readonly string[]): Promise<MatchOccurrenceRow[]> {
    if (ids.length === 0) return [];
    const { rows } = await sql<MatchRow>`
      ${MATCH_SELECT}
       WHERE o.workspace_id = ${workspaceId}::uuid AND o.id = ANY(${[...ids]}::uuid[])
         AND d.kind <> 'LOAN_PAYMENT'
       ORDER BY o.due_date, o.id`.execute(db());
    return rows.map(toMatchRow);
  }

  async linkedTransactionIds(workspaceId: string, transactionIds: readonly string[]): Promise<Set<string>> {
    if (transactionIds.length === 0) return new Set();
    const { rows } = await sql<{ transaction_id: string }>`
      SELECT o.transaction_id
        FROM commitments.recurring_occurrence o
       WHERE o.workspace_id = ${workspaceId}::uuid AND o.status IN ('MATERIALIZED', 'MATCHED')
         AND o.transaction_id = ANY(${[...transactionIds]}::uuid[])`.execute(db());
    return new Set(rows.map((r) => r.transaction_id));
  }
}
