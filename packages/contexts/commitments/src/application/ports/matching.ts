import type { ExpireReason, MatchOccurrence, MatchSuggestion, SuggestionStatus } from '../../domain/index.js';

export interface SuggestionFilter {
  readonly statuses?: readonly SuggestionStatus[] | undefined;
  readonly occurrenceId?: string | undefined;
  readonly transactionId?: string | undefined;
  readonly definitionId?: string | undefined;
  readonly limit?: number | undefined;
  /** Posición del cursor (keyset): `[score, id]` del último elemento de la página anterior. */
  readonly after?: readonly [string, string] | undefined;
}

/** Ocurrencia con el nombre de su definición, para las vistas y la vista previa de imports. */
export interface MatchOccurrenceRow {
  readonly occurrence: MatchOccurrence;
  readonly definitionName: string;
}

/**
 * Persistencia de las sugerencias de coincidencia y lecturas de ocurrencias para el matching (openspec
 * add-commitment-matching, decisiones 2, 4, 6). La inserción es `INSERT … ON CONFLICT (occurrence_id, transaction_id)
 * DO NOTHING`: un mismo par nunca se duplica y un par descartado nunca revive.
 */
export interface MatchSuggestionRepository {
  /** `false` si el par ya existía (cualquier estado). */
  insertIfAbsent(suggestion: MatchSuggestion): Promise<boolean>;
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly lock?: 'update' },
  ): Promise<MatchSuggestion | null>;
  /** Control optimista por `persistedVersion`; `false` si cambió. */
  save(suggestion: MatchSuggestion): Promise<boolean>;
  /** Todas las sugerencias de una transacción (cualquier estado). */
  listByTransaction(workspaceId: string, transactionId: string): Promise<MatchSuggestion[]>;
  /** Todas las sugerencias de las ocurrencias dadas (cualquier estado). */
  listByOccurrences(workspaceId: string, occurrenceIds: readonly string[]): Promise<MatchSuggestion[]>;
  /**
   * Expira las `PROPOSED` de las ocurrencias dadas (misma unidad de trabajo que la resolución); devuelve los ids
   * expirados. `exceptId` conserva la sugerencia que se confirma.
   */
  expireForOccurrences(
    workspaceId: string,
    occurrenceIds: readonly string[],
    reason: ExpireReason,
    options?: { readonly exceptId?: string },
  ): Promise<string[]>;
  /** Expira las `PROPOSED` de una transacción; devuelve los ids expirados. */
  expireForTransaction(
    workspaceId: string,
    transactionId: string,
    reason: ExpireReason,
    options?: { readonly exceptId?: string },
  ): Promise<string[]>;
  list(workspaceId: string, filter: SuggestionFilter): Promise<MatchSuggestion[]>;
  countProposed(workspaceId: string): Promise<number>;

  // ── lecturas de ocurrencias para el matching (mismo schema `commitments`)
  /**
   * Ocurrencias no resueltas (`SCHEDULED|DUE|OVERDUE`) del tipo dado, con vencimiento en `[from, to]` y cuya
   * versión vigente de la definición usa la cuenta de origen dada (y, en transferencias, la de destino).
   */
  candidateOccurrences(
    workspaceId: string,
    input: {
      readonly kind: string;
      readonly accountId: string;
      readonly toAccountId: string | null;
      readonly from: string;
      readonly to: string;
    },
  ): Promise<MatchOccurrenceRow[]>;
  /** Las ocurrencias dadas (cualquier estado) con los datos de su versión; las inexistentes no figuran. */
  occurrencesByIds(workspaceId: string, ids: readonly string[]): Promise<MatchOccurrenceRow[]>;
  /** De las transacciones dadas, las que ya resuelven una ocurrencia (`MATERIALIZED|MATCHED`). */
  linkedTransactionIds(workspaceId: string, transactionIds: readonly string[]): Promise<Set<string>>;
}
