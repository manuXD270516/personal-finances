import { classifyDuplicateCandidates, scoreToUnits } from '@pf/transactions/contracts';
import type { ExistingLink } from '../domain/duplicate-classifier.js';
import type { CandidateConfidence, RowCandidate } from '../domain/preview-types.js';

/**
 * Clasificación de duplicados con puntaje (openspec add-import-pipeline decisión 9; `transactions/duplicate-detection`;
 * D325/D327): extiende el clasificador de Phase 3 con el puntaje determinista de TRANSACTIONS, la preselección de un
 * único candidato de confianza alta y el identificador del banco.
 *
 *   1. Exacto por huella (vínculo ACTIVO a una transacción no anulada) o por identificador del banco (idem).
 *   2. Exacto dentro del archivo: un segundo identificador igual ⇒ `DUPLICATE_EXACT` con `duplicateOfRow`.
 *   3. Probable: candidatos de TRANSACTIONS en la ventana (±3 días, monto exacto). Asignación 1:1 voraz por puntaje
 *      descendente, |Δ días|, id y línea: cada movimiento existente se empareja con UNA sola fila. TODO candidato exige
 *      decisión (baja confianza incluida); el puntaje solo ordena y preselecciona.
 *   4. Si no, `NEW`.
 * Puro y determinista.
 */

export interface MatchableRow {
  readonly rowRef: string;
  readonly lineNumber: number;
  readonly bookingDate: string;
  readonly fingerprint: string;
  /** Identificador del banco de la fila, si trae. */
  readonly externalId: string | null;
}

export interface ScoredCandidate {
  readonly transactionId: string;
  readonly kind: string | null;
  readonly date: string | null;
  readonly amount: { readonly amount: string; readonly currency: string } | null;
  readonly description: string | null;
  readonly score: string;
  readonly signals: RowCandidate['signals'];
}

export interface MatchedRow {
  readonly rowRef: string;
  readonly classification: 'NEW' | 'DUPLICATE_EXACT' | 'DUPLICATE_PROBABLE';
  /** Transacción vinculada (exacto) o candidato asignado (probable). */
  readonly matchedTransactionId: string | null;
  /** Hasta 3 candidatos de la fila (probable), con confianza y preselección. */
  readonly candidates: readonly RowCandidate[];
  /** Línea de la primera fila del archivo con el mismo identificador (duplicado dentro del archivo). */
  readonly duplicateOfRow: number | null;
  /** Puntaje del candidato preseleccionado. */
  readonly decidedScore: string | null;
  /** `true` si el sistema preseleccionó «omitir vinculando» (cuenta como decisión). */
  readonly preselected: boolean;
}

export interface MatchResult {
  readonly rows: readonly MatchedRow[];
  /** Huellas cuyo vínculo apuntaba a una transacción anulada: se superan en la misma unidad de trabajo. */
  readonly supersededFingerprints: readonly string[];
}

export const MAX_ROW_CANDIDATES = 3;

const dayNumber = (date: string): number =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

export function classifyWithScores(input: {
  readonly rows: readonly MatchableRow[];
  readonly fingerprintLinks: ReadonlyMap<string, ExistingLink>;
  /** Vínculos por identificador del banco. */
  readonly externalLinks: ReadonlyMap<
    string,
    { readonly transactionId: string; readonly transactionStatus: string }
  >;
  /** Candidatos por `rowRef` (ya sin transacciones vinculadas a otra fila). */
  readonly candidates: ReadonlyMap<string, readonly ScoredCandidate[]>;
  readonly thresholds: { readonly high: string; readonly low: string };
}): MatchResult {
  const superseded: string[] = [];
  const exact = new Map<string, MatchedRow>();
  const open: MatchableRow[] = [];
  const firstOfExternal = new Map<string, number>();

  const exactRow = (
    rowRef: string,
    transactionId: string | null,
    duplicateOfRow: number | null,
  ): MatchedRow => ({
    rowRef,
    classification: 'DUPLICATE_EXACT',
    matchedTransactionId: transactionId,
    candidates: [],
    duplicateOfRow,
    decidedScore: null,
    preselected: false,
  });

  for (const row of input.rows) {
    const byFingerprint = input.fingerprintLinks.get(row.fingerprint);
    if (byFingerprint && byFingerprint.transactionStatus !== 'VOIDED') {
      exact.set(row.rowRef, exactRow(row.rowRef, byFingerprint.transactionId, null));
      continue;
    }
    if (byFingerprint) superseded.push(row.fingerprint);
    if (row.externalId !== null) {
      const byExternal = input.externalLinks.get(row.externalId);
      if (byExternal && byExternal.transactionStatus !== 'VOIDED') {
        exact.set(row.rowRef, exactRow(row.rowRef, byExternal.transactionId, null));
        continue;
      }
      const first = firstOfExternal.get(row.externalId);
      if (first !== undefined) {
        // Segundo movimiento del mismo archivo con el mismo identificador: no crea (INV-014).
        exact.set(row.rowRef, exactRow(row.rowRef, null, first));
        continue;
      }
      firstOfExternal.set(row.externalId, row.lineNumber);
    }
    open.push(row);
  }

  interface Pair {
    readonly row: MatchableRow;
    readonly candidate: ScoredCandidate;
    readonly units: bigint;
    readonly distance: number;
  }
  const pairs: Pair[] = [];
  for (const row of open) {
    for (const candidate of input.candidates.get(row.rowRef) ?? []) {
      pairs.push({
        row,
        candidate,
        units: scoreToUnits(candidate.score),
        distance:
          candidate.date === null ? 99 : Math.abs(dayNumber(row.bookingDate) - dayNumber(candidate.date)),
      });
    }
  }
  pairs.sort(
    (a, b) =>
      (a.units === b.units ? 0 : a.units > b.units ? -1 : 1) ||
      a.distance - b.distance ||
      a.candidate.transactionId.localeCompare(b.candidate.transactionId) ||
      a.row.lineNumber - b.row.lineNumber,
  );
  const assigned = new Map<string, ScoredCandidate>();
  const used = new Set<string>();
  for (const pair of pairs) {
    if (assigned.has(pair.row.rowRef) || used.has(pair.candidate.transactionId)) continue;
    assigned.set(pair.row.rowRef, pair.candidate);
    used.add(pair.candidate.transactionId);
  }

  const rows = input.rows.map((row): MatchedRow => {
    const hit = exact.get(row.rowRef);
    if (hit) return hit;
    const chosen = assigned.get(row.rowRef);
    if (!chosen) {
      return {
        rowRef: row.rowRef,
        classification: 'NEW',
        matchedTransactionId: null,
        candidates: [],
        duplicateOfRow: null,
        decidedScore: null,
        preselected: false,
      };
    }
    // Se presentan primero el asignado y luego los demás por puntaje (los ya tomados por otra fila se omiten).
    const own = (input.candidates.get(row.rowRef) ?? []).filter(
      (c) => c.transactionId === chosen.transactionId || !used.has(c.transactionId),
    );
    const shown = [chosen, ...own.filter((c) => c.transactionId !== chosen.transactionId)].slice(
      0,
      MAX_ROW_CANDIDATES,
    );
    const verdict = classifyDuplicateCandidates(
      shown.map((c) => ({ transactionId: c.transactionId, score: c.score })),
      input.thresholds,
    );
    const confidenceOf = new Map(verdict.confidences.map((c) => [c.transactionId, c.confidence] as const));
    const preselected = verdict.preselectedTransactionId === chosen.transactionId;
    return {
      rowRef: row.rowRef,
      classification: 'DUPLICATE_PROBABLE',
      matchedTransactionId: chosen.transactionId,
      candidates: shown.map((c): RowCandidate => ({
        ...c,
        confidence: (confidenceOf.get(c.transactionId) ?? 'MEDIUM') as CandidateConfidence,
        preselected: preselected && c.transactionId === chosen.transactionId,
      })),
      duplicateOfRow: null,
      decidedScore: preselected ? chosen.score : null,
      preselected,
    };
  });
  return { rows, supersededFingerprints: superseded };
}
