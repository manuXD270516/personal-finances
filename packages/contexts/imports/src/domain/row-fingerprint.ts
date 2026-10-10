import { sha256Hex } from './sha256.js';

/**
 * `RowFingerprint` (docs/13 §7.2; decisión 7 de add-basic-csv-import): identidad determinista de una fila para la
 * idempotencia (INV-014). `SHA-256(canonical_json([workspaceId, accountId, bookingDate, signedAmount, currency,
 * descriptionKey, externalId ?? "", occurrenceIndex]))`.
 */

/**
 * Tarjeta enmascarada (`****1234`, `xxxx-1234`, `**** **** **** 1234`): una corrida de al menos 2 marcas, otras corridas
 * separadas por espacios o guiones y 2–4 dígitos. Las corridas se separan SIEMPRE por un separador no vacío y la
 * primera no puede continuar una palabra: sin cuantificadores anidados ambiguos (una descripción de 500 `x` no puede
 * disparar un backtracking exponencial, ReDoS).
 */
const MASKED_CARD = /(?<![a-z0-9])[*x•#]{2,}(?:[\s-]+[*x•#]{2,})*[\s-]*\d{2,4}/gu;

/** Descripción comparable: NFKC, minúsculas, sin acentos, sin dígitos de tarjeta enmascarada y espacios colapsados. */
export function descriptionKey(description: string | null): string {
  return (description ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(MASKED_CARD, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export interface FingerprintTuple {
  readonly bookingDate: string;
  /** Monto con signo (salida negativa) en la escala de la moneda. */
  readonly signedAmount: string;
  readonly description: string | null;
}

const tupleKey = (t: FingerprintTuple): string =>
  JSON.stringify([t.bookingDate, t.signedAmount, descriptionKey(t.description)]);

/**
 * `occurrenceIndex`: ordinal de cada fila entre las del MISMO archivo con igual (fecha, monto, descripción). Resuelve
 * dos compras idénticas el mismo día (0 y 1); un reimport del mismo rango lo recalcula igual.
 */
export function occurrenceIndexes(rows: readonly FingerprintTuple[]): number[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = tupleKey(row);
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    return index;
  });
}

export interface FingerprintInput extends FingerprintTuple {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly currency: string;
  /** Id estable del banco (OFX `FITID`); vacío en el CSV de Phase 3. */
  readonly externalId?: string;
  readonly occurrenceIndex: number;
}

/** Huella hexadecimal de 64 caracteres. */
export function rowFingerprint(input: FingerprintInput): string {
  return sha256Hex(
    JSON.stringify([
      input.workspaceId,
      input.accountId,
      input.bookingDate,
      input.signedAmount,
      input.currency,
      descriptionKey(input.description),
      input.externalId ?? '',
      input.occurrenceIndex,
    ]),
  );
}
