import type { TransactionLinkDto } from '@pf/transactions/contracts';
import { DomainError, LocalDate } from '@pf/shared-kernel';
import {
  MAX_MATCH_CANDIDATE_ROWS,
  type MatchCandidateDto,
  type MatchConfidenceDto,
  type MatchCounterpartyDto,
  type MoneyDto,
  type OccurrenceMatchCandidatesQuery,
} from '../contracts/index.js';
import {
  MAX_DATE_WINDOW_DAYS,
  OccurrenceMatcher,
  type MatchSuggestion,
  type SuggestionStatus,
} from '../domain/index.js';
import type { CommitmentsDeps, MatchOccurrenceRow } from './ports/index.js';
import { amountDto, money, type RecurringAmountDto } from './views.js';

/** Ocurrencia de una sugerencia (`MatchSuggestionOccurrence` del contrato HTTP). */
export interface SuggestionOccurrenceDto {
  readonly id: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly kind: string;
  readonly status: string;
  readonly dueDate: string;
  readonly expected: RecurringAmountDto;
  readonly accountId: string;
  readonly toAccountId: string | null;
}

/** Transacción de una sugerencia (`MatchSuggestionTransaction` del contrato HTTP). */
export interface SuggestionTransactionDto {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly businessDate: string;
  readonly amount: MoneyDto;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly counterpartyId: string | null;
  readonly source: string;
}

/** `MatchSuggestion` del contrato HTTP. */
export interface SuggestionDto {
  readonly id: string;
  readonly occurrence: SuggestionOccurrenceDto | null;
  readonly transaction: SuggestionTransactionDto | null;
  readonly score: string;
  readonly confidence: MatchConfidenceDto;
  readonly reasons: {
    readonly amountDelta: MoneyDto | null;
    readonly dateDeltaDays: number;
    readonly counterparty: MatchCounterpartyDto;
  };
  readonly ambiguous: boolean;
  readonly status: SuggestionStatus;
  readonly expireReason: string | null;
  readonly createdAt: string;
  readonly version: number;
}

const occurrenceSummary = (row: MatchOccurrenceRow): SuggestionOccurrenceDto => {
  const o = row.occurrence;
  return {
    id: o.occurrenceId,
    definitionId: o.definitionId,
    definitionName: row.definitionName,
    kind: o.kind,
    status: o.status,
    dueDate: o.dueDate,
    expected: amountDto(o.expected, o.currency),
    accountId: o.accountId,
    toAccountId: o.toAccountId,
  };
};

const transactionSummary = (t: TransactionLinkDto): SuggestionTransactionDto => ({
  id: t.transactionId,
  kind: t.kind,
  status: t.status,
  businessDate: t.businessDate,
  amount: t.amount,
  accountId: t.accountId,
  toAccountId: t.toAccountId,
  counterpartyId: t.counterpartyId,
  source: t.source,
});

export interface SuggestionListFilter {
  readonly statuses?: readonly SuggestionStatus[] | undefined;
  readonly occurrenceId?: string | undefined;
  readonly transactionId?: string | undefined;
  readonly definitionId?: string | undefined;
  readonly limit?: number | undefined;
  readonly after?: readonly [string, string] | undefined;
}

/**
 * Consultas de las sugerencias de coincidencia y contrato `OccurrenceMatchCandidatesQuery` (openspec
 * add-commitment-matching, decisiones 10 y 12): lectura directa de la fuente de verdad, sin proyecciones.
 */
export class MatchingQueries implements OccurrenceMatchCandidatesQuery {
  constructor(private readonly deps: CommitmentsDeps) {}

  /** Arma los DTO de las sugerencias con su ocurrencia y su transacción (una consulta por tipo de dato). */
  async toDtos(workspaceId: string, suggestions: readonly MatchSuggestion[]): Promise<SuggestionDto[]> {
    if (suggestions.length === 0) return [];
    const occurrences = new Map(
      (
        await this.deps.matching.occurrencesByIds(workspaceId, [
          ...new Set(suggestions.map((s) => s.occurrenceId)),
        ])
      ).map((row) => [row.occurrence.occurrenceId, row] as const),
    );
    const transactions = new Map(
      (
        await this.deps.links.getManyForLink({
          workspaceId,
          transactionIds: [...new Set(suggestions.map((s) => s.transactionId))],
        })
      ).map((t) => [t.transactionId, t] as const),
    );
    return suggestions.map((suggestion) => {
      const s = suggestion.snapshot;
      const occurrence = occurrences.get(s.occurrenceId);
      const transaction = transactions.get(s.transactionId);
      return {
        id: s.id,
        occurrence: occurrence ? occurrenceSummary(occurrence) : null,
        transaction: transaction ? transactionSummary(transaction) : null,
        score: s.score,
        confidence: s.confidence,
        reasons: {
          amountDelta: s.amountDelta === null ? null : money(s.amountDelta, s.currency),
          dateDeltaDays: s.dateDeltaDays,
          counterparty: s.counterparty,
        },
        ambiguous: s.ambiguous,
        status: s.status,
        expireReason: s.expireReason,
        createdAt: s.createdAt,
        version: s.version,
      };
    });
  }

  /** `ListMatchSuggestions`: por puntaje descendente; devuelve además el contador de propuestas del workspace. */
  list(
    workspaceId: string,
    filter: SuggestionListFilter,
  ): Promise<{ readonly data: SuggestionDto[]; readonly proposedCount: number }> {
    return this.deps.uow.run(workspaceId, async () => {
      const found = await this.deps.matching.list(workspaceId, filter);
      return {
        data: await this.toDtos(workspaceId, found),
        proposedCount: await this.deps.matching.countProposed(workspaceId),
      };
    });
  }

  /** Una sugerencia por id (para responder confirmar y descartar). */
  async get(workspaceId: string, suggestion: MatchSuggestion): Promise<SuggestionDto> {
    const [dto] = await this.deps.uow.run(workspaceId, () => this.toDtos(workspaceId, [suggestion]));
    return dto as SuggestionDto;
  }

  /**
   * `OccurrenceMatchCandidatesQuery.findCandidates` (Phase 6, vista previa de un import): candidatas de cada fila SIN
   * persistir nada. Una consulta de ocurrencias por (tipo, cuenta, destino) y rango de fechas; máx. 500 filas.
   */
  findCandidates(
    input: Parameters<OccurrenceMatchCandidatesQuery['findCandidates']>[0],
  ): ReturnType<OccurrenceMatchCandidatesQuery['findCandidates']> {
    const { workspaceId, rows } = input;
    if (rows.length > MAX_MATCH_CANDIDATE_ROWS) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `at most ${MAX_MATCH_CANDIDATE_ROWS} rows per call are supported`,
      ).at('/rows');
    }
    return this.deps.uow.run(workspaceId, async () => {
      const groups = new Map<string, (typeof rows)[number][]>();
      for (const row of rows) {
        const key = [row.kind, row.accountId, row.kind === 'TRANSFER' ? (row.toAccountId ?? '') : ''].join(
          '|',
        );
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const candidatesByRow = new Map<string, MatchCandidateDto[]>();
      for (const group of groups.values()) {
        const first = group[0] as (typeof rows)[number];
        const dates = group.map((r) => r.businessDate).sort();
        const found = await this.deps.matching.candidateOccurrences(workspaceId, {
          kind: first.kind,
          accountId: first.accountId,
          toAccountId: first.kind === 'TRANSFER' ? (first.toAccountId ?? null) : null,
          from: LocalDate.parse(dates[0] as string)
            .plusDays(-MAX_DATE_WINDOW_DAYS)
            .toString(),
          to: LocalDate.parse(dates.at(-1) as string)
            .plusDays(MAX_DATE_WINDOW_DAYS)
            .toString(),
        });
        const names = new Map(found.map((r) => [r.occurrence.occurrenceId, r] as const));
        for (const row of group) {
          const ranked = OccurrenceMatcher.forTransaction(
            {
              transactionId: row.rowRef,
              kind: row.kind,
              status: 'POSTED',
              businessDate: row.businessDate,
              amount: row.amount,
              accountId: row.accountId,
              toAccountId: row.kind === 'TRANSFER' ? (row.toAccountId ?? null) : null,
              counterpartyId: row.counterpartyId ?? null,
              externalRef: null,
            },
            found.map((r) => r.occurrence),
          );
          candidatesByRow.set(
            row.rowRef,
            ranked.map((c): MatchCandidateDto => {
              const source = names.get(c.occurrenceId) as MatchOccurrenceRow;
              return {
                occurrenceId: c.occurrenceId,
                definitionId: c.definitionId,
                definitionName: source.definitionName,
                dueDate: c.dueDate,
                expected: { ...source.occurrence.expected, currency: source.occurrence.currency },
                score: c.score,
                confidence: c.confidence,
                amountDelta: c.amountDelta === null ? null : money(c.amountDelta, c.currency),
                dateDeltaDays: c.dateDeltaDays,
                counterparty: c.counterparty,
                ambiguous: c.ambiguous,
              };
            }),
          );
        }
      }
      return rows.map((r) => ({ rowRef: r.rowRef, candidates: candidatesByRow.get(r.rowRef) ?? [] }));
    });
  }
}
