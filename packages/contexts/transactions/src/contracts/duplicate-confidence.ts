/**
 * Confianza y preselección de los candidatos a duplicado de una fila importada (openspec add-import-pipeline,
 * `transactions/duplicate-detection` «Vinculación preseleccionada de confianza alta»). Función pura sobre los
 * puntajes de `DuplicateCandidatesQuery.findForImport`: IMPORTS la usa con sus umbrales configurables
 * (`IMPORT_DUPLICATE_HIGH_SCORE` 0.90 y `IMPORT_DUPLICATE_LOW_SCORE` 0.60). Sin `number`: los puntajes se comparan
 * como enteros en diezmilésimas.
 */

export const DEFAULT_DUPLICATE_HIGH_SCORE = '0.9000' as const;
export const DEFAULT_DUPLICATE_LOW_SCORE = '0.6000' as const;

export type DuplicateConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DuplicateConfidenceResult {
  /** Candidato a vincular ya seleccionado (editable); `null` si no hay un único candidato de confianza alta. */
  readonly preselectedTransactionId: string | null;
  readonly confidences: readonly {
    readonly transactionId: string;
    readonly confidence: DuplicateConfidence;
  }[];
}

/** Puntaje `0.9000` como diezmilésimas; un texto que no sea decimal de hasta 4 decimales es un error de programación. */
export function scoreToUnits(score: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(score);
  if (!match) throw new RangeError(`invalid score ${score}`);
  return BigInt(match[1] as string) * 10_000n + BigInt((match[2] ?? '').padEnd(4, '0'));
}

/**
 * Un único candidato ≥ `high` y ningún otro ≥ `high` ⇒ preseleccionado; dos o más ≥ `high` ⇒ ninguno; `< low` ⇒
 * confianza baja (sin preselección). Todo candidato sigue exigiendo una decisión del usuario; esta función solo
 * propone.
 */
export function classifyDuplicateCandidates(
  candidates: readonly { readonly transactionId: string; readonly score: string }[],
  thresholds: { readonly high: string; readonly low: string } = {
    high: DEFAULT_DUPLICATE_HIGH_SCORE,
    low: DEFAULT_DUPLICATE_LOW_SCORE,
  },
): DuplicateConfidenceResult {
  const high = scoreToUnits(thresholds.high);
  const low = scoreToUnits(thresholds.low);
  const confidences = candidates.map((c) => {
    const units = scoreToUnits(c.score);
    const confidence: DuplicateConfidence = units >= high ? 'HIGH' : units < low ? 'LOW' : 'MEDIUM';
    return { transactionId: c.transactionId, confidence };
  });
  const highs = confidences.filter((c) => c.confidence === 'HIGH');
  return {
    preselectedTransactionId:
      highs.length === 1 ? (highs[0] as { transactionId: string }).transactionId : null,
    confidences,
  };
}
