import { LocalDate, MoneyDecimal, dec, type Decimal } from '@pf/shared-kernel';
import type { AmountSpec } from '../amount-spec.js';
import type { OccurrenceStatus } from '../lifecycle.js';
import type { RecurringKind } from '../types.js';
import { resolveTolerances, type MatchToleranceOverrides, type MatchTolerances } from './match-tolerances.js';

/** Espacio de nombres de `externalRef` de las transacciones que creó una ocurrencia (nunca se sugieren). */
export const OCCURRENCE_EXTERNAL_NAMESPACE = 'commitments.occurrence';

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type CounterpartyMatch = 'MATCH' | 'UNKNOWN';

/** Transacción tal como la evalúa el matcher (forma de `TransactionLinkDto`). */
export interface MatchTransaction {
  readonly transactionId: string;
  readonly kind: string;
  readonly status: string;
  readonly businessDate: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly counterpartyId: string | null;
  readonly externalRef: { readonly namespace: string; readonly id: string } | null;
}

/** Ocurrencia no resuelta con los datos de la versión de su definición que usa el matcher. */
export interface MatchOccurrence {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly kind: RecurringKind;
  readonly status: OccurrenceStatus;
  readonly dueDate: string;
  readonly expected: AmountSpec;
  readonly currency: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly counterpartyId: string | null;
  readonly tolerances: MatchToleranceOverrides;
}

/** Resultado de comparar un par; ya incluye el puntaje, la confianza, los motivos y la ambigüedad del conjunto. */
export interface MatchCandidate {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly transactionId: string;
  /** 0..100 con 2 decimales (texto). */
  readonly score: string;
  readonly confidence: MatchConfidence;
  /** Diferencia absoluta de monto contra lo esperado (distancia al rango en `MIN_MAX`); `null` en `VARIABLE`. */
  readonly amountDelta: string | null;
  readonly currency: string;
  /** Distancia absoluta en días entre la fecha de negocio y el vencimiento. */
  readonly dateDeltaDays: number;
  readonly counterparty: CounterpartyMatch;
  /** Las dos mejores candidatas del conjunto empatan en puntaje. */
  readonly ambiguous: boolean;
  /** Fecha de negocio de la transacción y vencimiento de la ocurrencia (desempate del ranking). */
  readonly businessDate: string;
  readonly dueDate: string;
}

const MATCHABLE_KINDS: readonly string[] = ['INCOME', 'EXPENSE', 'TRANSFER'];
const OPEN_STATUSES: readonly OccurrenceStatus[] = ['SCHEDULED', 'DUE', 'OVERDUE'];

const AMOUNT_WEIGHT = dec('50');
const DATE_WEIGHT = dec('30');
const VARIABLE_AMOUNT_SCORE = dec('25');
const COUNTERPARTY_MATCH_SCORE = dec('20');
const COUNTERPARTY_UNKNOWN_SCORE = dec('10');

const decimalsOf = (amount: string): number => amount.split('.')[1]?.length ?? 0;

/** Una transacción es elegible si no está anulada, es de un tipo emparejable y no la creó una ocurrencia. */
export function isEligibleTransaction(tx: MatchTransaction): boolean {
  return (
    tx.status !== 'VOIDED' &&
    MATCHABLE_KINDS.includes(tx.kind) &&
    tx.externalRef?.namespace !== OCCURRENCE_EXTERNAL_NAMESPACE
  );
}

interface AmountEvaluation {
  readonly score: Decimal;
  readonly delta: Decimal | null;
}

/** Compara el monto contra la tolerancia del tipo; `null` si queda fuera (filtro duro). */
function evaluateAmount(
  tx: MatchTransaction,
  expected: AmountSpec,
  tolerances: MatchTolerances,
): AmountEvaluation | null {
  const value = dec(tx.amount.amount);
  const tolerance = dec(tolerances.amountTolerancePct).div(100);
  // distancia al valor/rango esperado y margen admitido (misma unidad que la distancia)
  const within = (distance: Decimal, margin: Decimal): AmountEvaluation | null => {
    if (distance.gt(margin)) return null;
    if (margin.isZero()) return { score: AMOUNT_WEIGHT, delta: distance };
    return { score: AMOUNT_WEIGHT.mul(dec('1').sub(distance.div(margin))), delta: distance };
  };
  switch (expected.type) {
    case 'FIXED':
    case 'ESTIMATED': {
      const amount = dec(expected.amount ?? '0');
      return within(value.sub(amount).abs(), amount.mul(tolerance));
    }
    case 'MIN_MAX': {
      const min = dec(expected.min ?? '0');
      const max = dec(expected.max ?? '0');
      if (value.lt(min)) return within(min.sub(value), min.mul(tolerance));
      if (value.gt(max)) return within(value.sub(max), max.mul(tolerance));
      return { score: AMOUNT_WEIGHT, delta: dec('0') };
    }
    case 'VARIABLE':
      return value.gt(0) ? { score: VARIABLE_AMOUNT_SCORE, delta: null } : null;
  }
}

const sameAccounts = (tx: MatchTransaction, occ: MatchOccurrence): boolean =>
  tx.accountId === occ.accountId && (occ.kind !== 'TRANSFER' || tx.toAccountId === occ.toAccountId);

const confidenceOf = (score: Decimal): MatchConfidence =>
  score.gte(80) ? 'HIGH' : score.gte(60) ? 'MEDIUM' : 'LOW';

const byRank = (a: MatchCandidate, b: MatchCandidate, tiebreak: (c: MatchCandidate) => string): number => {
  const score = dec(b.score).cmp(dec(a.score));
  if (score !== 0) return score;
  if (a.dateDeltaDays !== b.dateDeltaDays) return a.dateDeltaDays - b.dateDeltaDays;
  const key = tiebreak(a).localeCompare(tiebreak(b));
  if (key !== 0) return key;
  return `${a.occurrenceId}${a.transactionId}`.localeCompare(`${b.occurrenceId}${b.transactionId}`);
};

/** Marca ambiguas las candidatas empatadas con la mejor cuando las dos primeras tienen el mismo puntaje. */
function rank(
  candidates: MatchCandidate[],
  tiebreak: (c: MatchCandidate) => string,
): readonly MatchCandidate[] {
  const sorted = [...candidates].sort((a, b) => byRank(a, b, tiebreak));
  const [first, second] = sorted;
  if (!first || !second || first.score !== second.score) return sorted;
  return sorted.map((c) => (c.score === first.score ? { ...c, ambiguous: true } : c));
}

/**
 * Servicio de dominio puro `OccurrenceMatcher` (openspec add-commitment-matching, design decisiones 2 y 3; docs/04
 * §3.7). Compara transacciones con ocurrencias no resueltas con filtros duros (tipo, cuenta(s), moneda, ventana de
 * fechas, contraparte no contradictoria y tolerancia de monto por tipo) y puntúa de forma explicable y determinista:
 * `score = monto (0..50) + fecha (0..30) + contraparte (10 ó 20)`, HALF_EVEN a 2 decimales. No tiene efectos: jamás
 * resuelve una ocurrencia ni toca una transacción (FR-COMMITMENTS-010: solo sugiere).
 */
export const OccurrenceMatcher = {
  /** Compara un par; `null` si algún filtro duro lo excluye. */
  evaluate(tx: MatchTransaction, occ: MatchOccurrence): MatchCandidate | null {
    if (!isEligibleTransaction(tx)) return null;
    if (!OPEN_STATUSES.includes(occ.status)) return null;
    if (tx.kind !== occ.kind) return null;
    if (!sameAccounts(tx, occ)) return null;
    if (tx.amount.currency !== occ.currency) return null;

    const tolerances = resolveTolerances(occ.expected.type, occ.tolerances);
    const days = Math.abs(
      LocalDate.parse(tx.businessDate).toEpochDay() - LocalDate.parse(occ.dueDate).toEpochDay(),
    );
    if (days > tolerances.dateWindowDays) return null;

    const bothCounterparties = tx.counterpartyId !== null && occ.counterpartyId !== null;
    if (bothCounterparties && tx.counterpartyId !== occ.counterpartyId) return null;
    const counterparty: CounterpartyMatch = bothCounterparties ? 'MATCH' : 'UNKNOWN';
    if (occ.expected.type === 'VARIABLE' && counterparty !== 'MATCH') return null;

    const amount = evaluateAmount(tx, occ.expected, tolerances);
    if (!amount) return null;

    const dateScore = DATE_WEIGHT.mul(
      dec('1').sub(dec(String(days)).div(String(tolerances.dateWindowDays + 1))),
    );
    const counterpartyScore =
      counterparty === 'MATCH' ? COUNTERPARTY_MATCH_SCORE : COUNTERPARTY_UNKNOWN_SCORE;
    const score = amount.score
      .add(dateScore)
      .add(counterpartyScore)
      .toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_EVEN);
    return {
      occurrenceId: occ.occurrenceId,
      definitionId: occ.definitionId,
      transactionId: tx.transactionId,
      score: score.toFixed(2),
      confidence: confidenceOf(score),
      amountDelta: amount.delta === null ? null : amount.delta.toFixed(decimalsOf(tx.amount.amount)),
      currency: tx.amount.currency,
      dateDeltaDays: days,
      counterparty,
      ambiguous: false,
      businessDate: tx.businessDate,
      dueDate: occ.dueDate,
    };
  },

  /** Ocurrencias candidatas de UNA transacción, de la mejor a la peor. */
  forTransaction(tx: MatchTransaction, occurrences: readonly MatchOccurrence[]): readonly MatchCandidate[] {
    const found: MatchCandidate[] = [];
    for (const occ of occurrences) {
      const candidate = OccurrenceMatcher.evaluate(tx, occ);
      if (candidate) found.push(candidate);
    }
    return rank(found, (c) => c.dueDate);
  },

  /** Transacciones candidatas de UNA ocurrencia (por ejemplo, al generarla tarde), de la mejor a la peor. */
  forOccurrence(occ: MatchOccurrence, transactions: readonly MatchTransaction[]): readonly MatchCandidate[] {
    const found: MatchCandidate[] = [];
    for (const tx of transactions) {
      const candidate = OccurrenceMatcher.evaluate(tx, occ);
      if (candidate) found.push(candidate);
    }
    return rank(found, (c) => c.businessDate);
  },
} as const;
