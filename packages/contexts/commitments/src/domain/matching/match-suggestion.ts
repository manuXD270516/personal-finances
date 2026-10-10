import { DomainError } from '@pf/shared-kernel';
import type { CounterpartyMatch, MatchCandidate, MatchConfidence } from './occurrence-matcher.js';

export const SUGGESTION_STATUSES = ['PROPOSED', 'CONFIRMED', 'DISMISSED', 'EXPIRED'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const EXPIRE_REASONS = [
  'TRANSACTION_VOIDED',
  'OCCURRENCE_RESOLVED',
  'OCCURRENCE_CANCELLED',
  'INCOMPATIBLE',
  'SUPERSEDED',
] as const;
export type ExpireReason = (typeof EXPIRE_REASONS)[number];

/** Estado persistible de una sugerencia (fechas `YYYY-MM-DD`, instantes RFC 3339 UTC, montos como texto decimal). */
export interface SuggestionState {
  readonly id: string;
  readonly workspaceId: string;
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly transactionId: string;
  /** 0..100 con 2 decimales. */
  readonly score: string;
  readonly confidence: MatchConfidence;
  readonly amountDelta: string | null;
  readonly currency: string;
  readonly dateDeltaDays: number;
  readonly counterparty: CounterpartyMatch;
  readonly ambiguous: boolean;
  readonly status: SuggestionStatus;
  readonly expireReason: ExpireReason | null;
  readonly sourceEventId: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly version: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const notPending = (id: string, status: SuggestionStatus) =>
  new DomainError('MATCH_SUGGESTION_NOT_PENDING', `match suggestion ${id} is ${status}, not PROPOSED`);

const evaluation = (c: MatchCandidate) => ({
  score: c.score,
  confidence: c.confidence,
  amountDelta: c.amountDelta,
  currency: c.currency,
  dateDeltaDays: c.dateDeltaDays,
  counterparty: c.counterparty,
  ambiguous: c.ambiguous,
});

/**
 * AR `MatchSuggestion` (openspec add-commitment-matching, design decisión 4 y 8): propuesta de coincidencia entre una
 * ocurrencia y una transacción. NO es un elemento financiero y no tiene máquina de recorrido (D134): sus decisiones
 * (confirmar, descartar) quedan en la auditoría y la vinculación aparece en el recorrido de la ocurrencia.
 *
 *   PROPOSED → CONFIRMED | DISMISSED | EXPIRED{motivo}      EXPIRED{INCOMPATIBLE} → PROPOSED (REPROPOSE, D136)
 *
 * `CONFIRMED` y `DISMISSED` son terminales: un par descartado nunca vuelve a proponerse.
 */
export class MatchSuggestion {
  private constructor(
    private state: SuggestionState,
    private persisted: number,
  ) {}

  /** Versión leída o escrita por última vez en la base (control optimista). */
  get persistedVersion(): number {
    return this.persisted;
  }

  /** El repositorio lo invoca tras insertar o guardar. */
  markPersisted(): void {
    this.persisted = this.state.version;
  }

  static propose(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly candidate: MatchCandidate;
    readonly sourceEventId: string | null;
    readonly at: string;
  }): MatchSuggestion {
    const c = input.candidate;
    return new MatchSuggestion(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        occurrenceId: c.occurrenceId,
        definitionId: c.definitionId,
        transactionId: c.transactionId,
        ...evaluation(c),
        status: 'PROPOSED',
        expireReason: null,
        sourceEventId: input.sourceEventId,
        createdAt: input.at,
        decidedAt: null,
        decidedBy: null,
        version: 1,
      },
      0,
    );
  }

  static restore(state: SuggestionState): MatchSuggestion {
    return new MatchSuggestion({ ...state }, state.version);
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get occurrenceId(): string {
    return this.state.occurrenceId;
  }
  get transactionId(): string {
    return this.state.transactionId;
  }
  get status(): SuggestionStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): SuggestionState {
    return { ...this.state };
  }
  get proposed(): boolean {
    return this.state.status === 'PROPOSED';
  }

  /** `CONFIRM`: el EDITOR u OWNER acepta la coincidencia (el vínculo lo hace `LinkOccurrence` en la misma UoW). */
  confirm(by: string, at: string): void {
    this.assertProposed();
    this.apply({ status: 'CONFIRMED', decidedAt: at, decidedBy: by });
  }

  /** `DISMISS`: descarte permanente del par. */
  dismiss(by: string, at: string): void {
    this.assertProposed();
    this.apply({ status: 'DISMISSED', decidedAt: at, decidedBy: by });
  }

  /** `EXPIRE`: la sugerencia deja de aplicar (anulación, ocurrencia resuelta o cancelada, incompatibilidad). */
  expire(reason: ExpireReason): void {
    this.assertProposed();
    this.apply({ status: 'EXPIRED', expireReason: reason });
  }

  /** `REPROPOSE` (D136): solo una expirada por incompatibilidad vuelve a `PROPOSED` si una edición la hace compatible. */
  repropose(candidate: MatchCandidate, sourceEventId: string | null): void {
    if (this.state.status !== 'EXPIRED' || this.state.expireReason !== 'INCOMPATIBLE') {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        `match suggestion ${this.state.id} (${this.state.status}) cannot be proposed again`,
      );
    }
    this.apply({
      ...evaluation(candidate),
      status: 'PROPOSED',
      expireReason: null,
      sourceEventId,
    });
  }

  /** Recalcula puntaje, confianza y motivos de una propuesta que sigue siendo compatible; `false` si nada cambió. */
  refresh(candidate: MatchCandidate): boolean {
    this.assertProposed();
    const next = evaluation(candidate);
    const same = (Object.keys(next) as (keyof typeof next)[]).every((k) => next[k] === this.state[k]);
    if (same) return false;
    this.apply(next);
    return true;
  }

  private assertProposed(): void {
    if (this.state.status !== 'PROPOSED') throw notPending(this.state.id, this.state.status);
  }

  private apply(patch: Partial<Mutable<SuggestionState>>): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
  }
}
