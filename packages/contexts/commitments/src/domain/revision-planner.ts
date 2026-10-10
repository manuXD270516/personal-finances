import { DomainError, LocalDate } from '@pf/shared-kernel';
import { isUnresolved, type OccurrenceStatus } from './lifecycle.js';
import {
  candidates,
  type Candidate,
  type ExistingOccurrence,
  type GeneratorSource,
} from './occurrence-generator.js';
import type { CancelReason } from './types.js';

/** Qué hacer con las ocurrencias al revisar, pausar, reanudar o terminar (design decisiones 14 y 15). Puro. */
export interface RevisionPlan {
  /** No resueltas que la nueva regla sigue produciendo: se reescriben (se descartan sus ediciones). */
  readonly rewrite: readonly { readonly id: string; readonly candidate: Candidate }[];
  /** Canceladas `SUPERSEDED` que la nueva regla vuelve a producir: se reinstauran y se reescriben. */
  readonly reinstate: readonly { readonly id: string; readonly candidate: Candidate }[];
  /** No resueltas que la nueva regla ya no produce: `CANCEL {SUPERSEDED}`. */
  readonly cancel: readonly string[];
  /** Fechas nuevas sin fila. */
  readonly insert: readonly Candidate[];
}

const RESOLVED: readonly OccurrenceStatus[] = ['MATERIALIZED', 'MATCHED', 'SKIPPED'];

/**
 * Guarda de la fecha efectiva (`RECURRING_REVISION_DATE_INVALID`): debe ser posterior a la fecha nominal de la última
 * ocurrencia resuelta y no anterior al inicio de la serie ni a la versión vigente.
 */
export function assertRevisionDate(input: {
  readonly effectiveFrom: LocalDate;
  readonly seriesStart: LocalDate;
  readonly currentEffectiveFrom: LocalDate;
  readonly existing: readonly ExistingOccurrence[];
}): void {
  const { effectiveFrom } = input;
  const invalid = (detail: string) =>
    new DomainError('RECURRING_REVISION_DATE_INVALID', detail).at('/effectiveFrom');
  if (effectiveFrom.compare(input.seriesStart) < 0)
    throw invalid('effectiveFrom precedes the start of the series');
  if (effectiveFrom.compare(input.currentEffectiveFrom) < 0) {
    throw invalid('effectiveFrom precedes the current version');
  }
  const lastResolved = input.existing
    .filter((o) => RESOLVED.includes(o.status))
    .map((o) => o.occurrenceDate)
    .sort()
    .at(-1);
  if (lastResolved !== undefined && effectiveFrom.compare(LocalDate.parse(lastResolved)) <= 0) {
    throw invalid(`effectiveFrom must be after the last resolved occurrence (${lastResolved})`);
  }
}

export const RevisionPlanner = {
  /**
   * Plan de una revisión "esta y las siguientes": para cada fecha ≥ `effectiveFrom` hasta `through` (high-water mark
   * de la generación) compara lo que produce la regla con lo existente. Las resueltas (`MATERIALIZED`, `MATCHED`,
   * `SKIPPED`) jamás se tocan.
   */
  planRevision(input: {
    readonly source: GeneratorSource;
    readonly effectiveFrom: LocalDate;
    readonly through: LocalDate | null;
    readonly existing: readonly ExistingOccurrence[];
    /** Motivos de cancelación que se reinstauran si la regla vuelve a producir la fecha (por omisión `SUPERSEDED`). */
    readonly reinstateReasons?: readonly CancelReason[];
  }): RevisionPlan {
    const { effectiveFrom, through } = input;
    const reinstateReasons: readonly CancelReason[] = input.reinstateReasons ?? ['SUPERSEDED'];
    const wanted =
      through !== null && through.compare(effectiveFrom) >= 0
        ? candidates(input.source, { from: effectiveFrom, to: through })
        : [];
    const byDate = new Map(input.existing.map((o) => [o.occurrenceDate, o] as const));
    const produced = new Set(wanted.map((c) => c.occurrenceDate.toString()));
    const rewrite: { id: string; candidate: Candidate }[] = [];
    const reinstate: { id: string; candidate: Candidate }[] = [];
    const insert: Candidate[] = [];
    for (const candidate of wanted) {
      const found = byDate.get(candidate.occurrenceDate.toString());
      if (!found) insert.push(candidate);
      else if (isUnresolved(found.status)) rewrite.push({ id: found.id, candidate });
      else if (
        found.status === 'CANCELLED' &&
        found.cancelReason !== null &&
        reinstateReasons.includes(found.cancelReason)
      ) {
        reinstate.push({ id: found.id, candidate });
      }
    }
    const cancel = input.existing
      .filter(
        (o) =>
          isUnresolved(o.status) &&
          LocalDate.parse(o.occurrenceDate).compare(effectiveFrom) >= 0 &&
          !produced.has(o.occurrenceDate),
      )
      .map((o) => o.id);
    return { rewrite, reinstate, cancel, insert };
  },

  /** Pausa: no resueltas con fecha nominal ≥ hoy se cancelan (`PAUSED`); las atrasadas anteriores quedan. */
  planPause(existing: readonly ExistingOccurrence[], today: LocalDate): readonly string[] {
    return existing
      .filter((o) => isUnresolved(o.status) && LocalDate.parse(o.occurrenceDate).compare(today) >= 0)
      .map((o) => o.id);
  },

  /** Reanudación: canceladas por la pausa con fecha nominal ≥ hoy se reinstauran; el intervalo pausado sigue cancelado. */
  planResume(existing: readonly ExistingOccurrence[], today: LocalDate): readonly string[] {
    return existing
      .filter(
        (o) =>
          o.status === 'CANCELLED' &&
          o.cancelReason === 'PAUSED' &&
          LocalDate.parse(o.occurrenceDate).compare(today) >= 0,
      )
      .map((o) => o.id);
  },

  /** Fin con fecha: no resueltas con fecha nominal posterior se cancelan (`ENDED`). */
  planEnd(existing: readonly ExistingOccurrence[], endDate: LocalDate): readonly string[] {
    return existing
      .filter((o) => isUnresolved(o.status) && LocalDate.parse(o.occurrenceDate).compare(endDate) > 0)
      .map((o) => o.id);
  },
} as const;

export const CANCEL_PAUSED: CancelReason = 'PAUSED';
export const CANCEL_SUPERSEDED: CancelReason = 'SUPERSEDED';
export const CANCEL_ENDED: CancelReason = 'ENDED';
