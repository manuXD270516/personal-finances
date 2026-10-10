import { descriptionKey } from './row-fingerprint.js';
import type { Classification, Direction } from './types.js';

/**
 * `DuplicateClassifier` (decisión 8 de add-basic-csv-import; docs/13 §7.4 y §8 en su subconjunto de Phase 3):
 *   1. Exacto: la huella tiene un vínculo ACTIVO a una transacción no anulada ⇒ `DUPLICATE_EXACT`. Si esa transacción
 *      está anulada, el vínculo queda superado (`supersededFingerprints`) y la fila se evalúa de nuevo.
 *   2. Probable: movimientos existentes del mismo monto, moneda y dirección a ±ventana días. La similitud de
 *      descripción solo ORDENA candidatos (las glosas bancarias difieren de las manuales). Asignación 1:1 greedy por
 *      |Δ fecha| ascendente, luego similitud descendente, luego id de transacción y luego línea: cada movimiento
 *      existente se empareja con UNA sola fila.
 *   3. Si no, `NEW`.
 * Puro y determinista: el mismo insumo produce siempre el mismo resultado.
 */

export interface ClassifiableRow {
  /** Identificador estable de la fila dentro del job (el id del staging). */
  readonly rowRef: string;
  readonly lineNumber: number;
  readonly bookingDate: string;
  readonly direction: Direction;
  readonly description: string | null;
  /** Huella hexadecimal. */
  readonly fingerprint: string;
}

export interface ExistingLink {
  readonly fingerprint: string;
  readonly transactionId: string;
  /** Estado actual de la transacción vinculada (`VOIDED` ⇒ el vínculo queda superado). */
  readonly transactionStatus: string;
}

export interface DuplicateCandidate {
  readonly transactionId: string;
  readonly kind: string;
  readonly date: string;
  readonly description: string | null;
}

export interface RowClassification {
  readonly rowRef: string;
  readonly classification: Extract<Classification, 'NEW' | 'DUPLICATE_EXACT' | 'DUPLICATE_PROBABLE'>;
  /** Transacción vinculada (exacto) o candidato asignado (probable). */
  readonly matchedTransactionId: string | null;
}

export interface ClassificationResult {
  readonly rows: readonly RowClassification[];
  /** Huellas cuyo vínculo apuntaba a una transacción anulada: se marcan `SUPERSEDED` en la misma unidad de trabajo. */
  readonly supersededFingerprints: readonly string[];
}

const dayNumber = (date: string): number =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

/** Similitud 0..1 de descripciones normalizadas: prefijo común sobre el largo del menor (solo para ordenar). */
function similarity(a: string | null, b: string | null): number {
  const x = descriptionKey(a);
  const y = descriptionKey(b);
  if (x === '' || y === '') return 0;
  if (x === y) return 1;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i += 1;
  return i / Math.max(x.length, y.length);
}

export function classifyRows(input: {
  readonly rows: readonly ClassifiableRow[];
  readonly links: ReadonlyMap<string, ExistingLink>;
  /** Candidatos por `rowRef` (ya filtrados por monto, moneda, dirección y ventana; sin transacciones ya vinculadas). */
  readonly candidates: ReadonlyMap<string, readonly DuplicateCandidate[]>;
}): ClassificationResult {
  const superseded: string[] = [];
  const exact = new Map<string, RowClassification>();
  const open: ClassifiableRow[] = [];
  for (const row of input.rows) {
    const link = input.links.get(row.fingerprint);
    if (link && link.transactionStatus !== 'VOIDED') {
      exact.set(row.rowRef, {
        rowRef: row.rowRef,
        classification: 'DUPLICATE_EXACT',
        matchedTransactionId: link.transactionId,
      });
    } else {
      if (link) superseded.push(row.fingerprint);
      open.push(row);
    }
  }

  interface Pair {
    readonly row: ClassifiableRow;
    readonly candidate: DuplicateCandidate;
    readonly distance: number;
    readonly score: number;
  }
  const pairs: Pair[] = [];
  for (const row of open) {
    for (const candidate of input.candidates.get(row.rowRef) ?? []) {
      pairs.push({
        row,
        candidate,
        distance: Math.abs(dayNumber(row.bookingDate) - dayNumber(candidate.date)),
        score: similarity(row.description, candidate.description),
      });
    }
  }
  pairs.sort(
    (a, b) =>
      a.distance - b.distance ||
      b.score - a.score ||
      a.candidate.transactionId.localeCompare(b.candidate.transactionId) ||
      a.row.lineNumber - b.row.lineNumber,
  );
  const assigned = new Map<string, string>();
  const used = new Set<string>();
  for (const pair of pairs) {
    if (assigned.has(pair.row.rowRef) || used.has(pair.candidate.transactionId)) continue;
    assigned.set(pair.row.rowRef, pair.candidate.transactionId);
    used.add(pair.candidate.transactionId);
  }

  const rows = input.rows.map((row): RowClassification => {
    const hit = exact.get(row.rowRef);
    if (hit) return hit;
    const candidate = assigned.get(row.rowRef);
    return candidate
      ? { rowRef: row.rowRef, classification: 'DUPLICATE_PROBABLE', matchedTransactionId: candidate }
      : { rowRef: row.rowRef, classification: 'NEW', matchedTransactionId: null };
  });
  return { rows, supersededFingerprints: superseded };
}
