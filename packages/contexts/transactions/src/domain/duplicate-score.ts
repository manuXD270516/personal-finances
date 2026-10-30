import { daysBetween } from './duplicate-detector.js';

/**
 * `DuplicateScore` (openspec add-import-pipeline, `transactions/duplicate-detection`; docs/13 §8.2): puntaje
 * determinista de un candidato a duplicado de una fila importada,
 *
 *   0.40 × monto + 0.25 × fecha + 0.20 × descripción + 0.10 × contraparte + 0.05 × origen
 *
 * con `monto` = 1 (la consulta exige el monto exacto), `fecha` = 1 / 0.8 / 0.5 / 0.3 a 0 / 1 / 2 / 3 días (0 si la ventana configurada admite más),
 * `descripción` = Jaro-Winkler sobre descripciones normalizadas (0.5 si el candidato —o la fila— no tiene),
 * `contraparte` = 1 si ambas la tienen y coinciden, 0 si difieren, 0.5 en otro caso, y `origen` = 0 solo si el
 * candidato tiene un identificador del banco distinto del de la fila. Toda la aritmética es entera/racional
 * (`bigint`): sin `number` ni coma flotante para los puntajes, así que el mismo dato da siempre el mismo puntaje
 * con 4 decimales HALF_EVEN. Orden: puntaje descendente, menor diferencia de días, identificador.
 */

const TEN_THOUSAND = 10_000n;

export interface ScoredRow {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly description: string | null;
  readonly counterpartyId: string | null;
  /** Identificador del banco de la fila (FITID / referencia única), si lo trae. */
  readonly externalId: string | null;
}

export interface ScoredCandidate {
  readonly transactionId: string;
  readonly date: string;
  readonly description: string | null;
  readonly counterpartyId: string | null;
  /** Identificador del banco del candidato (`imports.ext:*` o `imports.provider:*`), `null` si no tiene. */
  readonly bankExternalId: string | null;
}

export interface DuplicateSignals {
  readonly amount: string;
  readonly date: string;
  readonly description: string;
  readonly counterparty: string;
  readonly origin: string;
}

export interface DuplicateScoreResult {
  /** Texto decimal con 4 decimales (`0.9000`). */
  readonly score: string;
  readonly signals: DuplicateSignals;
  readonly daysApart: number;
}

export interface Ratio {
  readonly n: bigint;
  readonly d: bigint;
}

/** Cociente entero redondeado HALF_EVEN (`n`, `d` > 0). */
function divHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d) return q + 1n;
  if (r2 < d) return q;
  return q % 2n === 0n ? q : q + 1n;
}

/** Texto decimal de 4 decimales de `ratio` (0..1), HALF_EVEN. */
export function formatRatio4(ratio: Ratio): string {
  const scaled = divHalfEven(ratio.n * TEN_THOUSAND, ratio.d);
  const whole = scaled / TEN_THOUSAND;
  const frac = (scaled % TEN_THOUSAND).toString().padStart(4, '0');
  return `${whole}.${frac}`;
}

/** NFKC, minúsculas, sin acentos, sin dígitos de tarjeta enmascarada y espacios colapsados. */
export function normalizeForScore(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[*x•]{2,}\s*\d{2,6}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Jaro-Winkler exacto (racional) sobre puntos de código; prefijo ≤ 4, factor 0.1, bonificación si Jaro ≥ 0.7. */
export function jaroWinkler(a: string, b: string): Ratio {
  const s1 = Array.from(a);
  const s2 = Array.from(b);
  const l1 = s1.length;
  const l2 = s2.length;
  if (l1 === 0 && l2 === 0) return { n: 1n, d: 1n };
  if (l1 === 0 || l2 === 0) return { n: 0n, d: 1n };
  const window = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
  const m1 = new Array<boolean>(l1).fill(false);
  const m2 = new Array<boolean>(l2).fill(false);
  let matches = 0;
  for (let i = 0; i < l1; i++) {
    const from = Math.max(0, i - window);
    const to = Math.min(l2 - 1, i + window);
    for (let j = from; j <= to; j++) {
      if (!m2[j] && s1[i] === s2[j]) {
        m1[i] = true;
        m2[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return { n: 0n, d: 1n };
  let k = 0;
  let halfTranspositions = 0;
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) halfTranspositions++;
    k++;
  }
  const t = BigInt(Math.floor(halfTranspositions / 2));
  const m = BigInt(matches);
  const bl1 = BigInt(l1);
  const bl2 = BigInt(l2);
  // jaro = (m/l1 + m/l2 + (m - t)/m) / 3
  const jn = m * m * bl2 + m * m * bl1 + (m - t) * bl1 * bl2;
  const jd = 3n * bl1 * bl2 * m;
  if (jn * 10n < jd * 7n) return { n: jn, d: jd };
  let prefix = 0;
  while (prefix < 4 && prefix < Math.min(l1, l2) && s1[prefix] === s2[prefix]) prefix++;
  const p = BigInt(prefix);
  // jw = jaro + prefix × 0.1 × (1 − jaro)
  return { n: jn * (10n - p) + p * jd, d: jd * 10n };
}

/** Peso de la fecha en diezmilésimas (0.25 × {1, 0.8, 0.5, 0.3}). */
const DATE_WEIGHT: readonly bigint[] = [2500n, 2000n, 1250n, 750n];
const AMOUNT_WEIGHT = 4000n;
const COUNTERPARTY_WEIGHT = 1000n;
const ORIGIN_WEIGHT = 500n;
const DESCRIPTION_WEIGHT = 2000n;

const DATE_SIGNAL = ['1.0000', '0.8000', '0.5000', '0.3000'] as const;

/** Puntaje como entero en diezmilésimas (para ordenar sin coma flotante). */
function scoreUnits(score: string): bigint {
  const [w = '0', f = '0000'] = score.split('.');
  return BigInt(w) * TEN_THOUSAND + BigInt(f);
}

export const DuplicateScore = {
  of(row: ScoredRow, candidate: ScoredCandidate): DuplicateScoreResult {
    const days = daysBetween(row.date, candidate.date);
    const rowText = normalizeForScore(row.description);
    const candidateText = normalizeForScore(candidate.description);
    const description: Ratio =
      rowText === '' || candidateText === '' ? { n: 1n, d: 2n } : jaroWinkler(rowText, candidateText);

    let counterpartyWeight: bigint;
    let counterpartySignal: string;
    if (row.counterpartyId !== null && candidate.counterpartyId !== null) {
      const same = row.counterpartyId === candidate.counterpartyId;
      counterpartyWeight = same ? COUNTERPARTY_WEIGHT : 0n;
      counterpartySignal = same ? '1.0000' : '0.0000';
    } else {
      counterpartyWeight = COUNTERPARTY_WEIGHT / 2n;
      counterpartySignal = '0.5000';
    }
    const originDiffers = candidate.bankExternalId !== null && candidate.bankExternalId !== row.externalId;
    const originWeight = originDiffers ? 0n : ORIGIN_WEIGHT;

    const fixed = AMOUNT_WEIGHT + (DATE_WEIGHT[days] ?? 0n) + counterpartyWeight + originWeight;
    return {
      score: formatRatio4({
        n: fixed * description.d + DESCRIPTION_WEIGHT * description.n,
        d: description.d * TEN_THOUSAND,
      }),
      signals: {
        amount: '1.0000',
        date: DATE_SIGNAL[days] ?? '0.0000',
        description: formatRatio4(description),
        counterparty: counterpartySignal,
        origin: originDiffers ? '0.0000' : '1.0000',
      },
      daysApart: days,
    };
  },

  /** Candidatos ordenados: puntaje descendente, menor diferencia de días e identificador (determinista). */
  rank<T extends ScoredCandidate>(
    row: ScoredRow,
    candidates: readonly T[],
  ): readonly (T & DuplicateScoreResult)[] {
    return candidates
      .map((c) => ({ ...c, ...DuplicateScore.of(row, c) }))
      .sort((x, y) => {
        const dScore = scoreUnits(y.score) - scoreUnits(x.score);
        if (dScore !== 0n) return dScore > 0n ? 1 : -1;
        if (x.daysApart !== y.daysApart) return x.daysApart - y.daysApart;
        return x.transactionId < y.transactionId ? -1 : x.transactionId > y.transactionId ? 1 : 0;
      });
  },
};
