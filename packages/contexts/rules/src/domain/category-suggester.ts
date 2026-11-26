import { MoneyDecimal } from '@pf/shared-kernel';
import { descriptionKey } from './rule-proposal.js';
import type { SubjectKind } from './types.js';

/**
 * Sugerencia de categoría por historial (openspec add-category-suggestions, FR-CLASSIFICATION-014, D476). Todo lo de este
 * archivo es puro y determinista: sin ML, sin reloj y sin entrada/salida. La evidencia ya viene filtrada (clasificada por
 * el usuario, un split, sin administradas por otro módulo, categoría activa y compatible con el tipo) por el servicio.
 */

/** Umbrales del sugeridor (decisión 3 del diseño; configurables con `RULES_CATEGORY_SUGGEST_*`). */
export interface CategorySuggestionThresholds {
  readonly minSupport: number;
  /** Decimal con 4 decimales (`0.7000`, D477). */
  readonly minConfidence: string;
  readonly highConfidence: string;
  readonly highMinSupport: number;
}

export const CATEGORY_SUGGESTION_DEFAULTS: CategorySuggestionThresholds = {
  minSupport: 2,
  minConfidence: '0.7000',
  highConfidence: '0.9000',
  highMinSupport: 5,
};

export type CategorySuggestionLevel = 'HIGH' | 'MEDIUM';
export type CategorySuggestionBasis = 'COUNTERPARTY' | 'DESCRIPTION' | 'BOTH';

/** Transacción de evidencia (lo mínimo que el índice necesita). */
export interface SuggestionEvidence {
  readonly kind: SubjectKind;
  readonly description: string | null;
  readonly counterpartyId: string | null;
  readonly categoryId: string;
}

/** Lo que se quiere clasificar. */
export interface SuggestionSubject {
  readonly kind: SubjectKind;
  readonly description: string | null;
  readonly counterpartyId: string | null;
}

export interface CategorySuggestion {
  readonly categoryId: string;
  /** `matches ÷ support`, 4 decimales HALF_EVEN. */
  readonly confidence: string;
  readonly level: CategorySuggestionLevel;
  /** Transacciones del patrón (mismo tipo) en cualquier categoría. */
  readonly support: number;
  /** Transacciones del patrón en la categoría sugerida. */
  readonly matches: number;
  readonly basis: CategorySuggestionBasis;
  /** Clave de descripción del sujeto (`null` si no tiene una utilizable o si la base es la contraparte). */
  readonly descriptionKey: string | null;
  /** Contraparte del patrón (`null` si la base es la descripción). */
  readonly counterpartyId: string | null;
}

const confidenceOf = (matches: number, support: number): string =>
  new MoneyDecimal(matches).div(support).toDecimalPlaces(4, MoneyDecimal.ROUND_HALF_EVEN).toFixed(4);

/** Categoría `EXPENSE` o `INCOME` que admite un tipo de transacción (el reembolso va a una categoría de gasto). */
export const categoryKindFor = (kind: SubjectKind): 'EXPENSE' | 'INCOME' =>
  kind === 'INCOME' ? 'INCOME' : 'EXPENSE';

interface PatternGroup {
  size: number;
  readonly byCategory: Map<string, number>;
}

interface Candidate {
  readonly basis: 'COUNTERPARTY' | 'DESCRIPTION';
  readonly categoryId: string;
  readonly support: number;
  readonly matches: number;
  readonly confidence: string;
}

const groupKey = (type: 'COUNTERPARTY' | 'DESCRIPTION', kind: SubjectKind, value: string): string =>
  `${type}\u0000${kind}\u0000${value}`;

/**
 * Índice de la evidencia: por `(patrón, valor, tipo)` el conteo por categoría. Se construye una vez (por consulta, por
 * importación o por mes del backtesting) y responde a cualquier número de sujetos sin volver a recorrer la evidencia.
 * El resultado no depende del orden de la evidencia.
 */
export class CategorySuggestionIndex {
  private readonly groups = new Map<string, PatternGroup>();

  private constructor(readonly size: number) {}

  static build(evidence: readonly SuggestionEvidence[]): CategorySuggestionIndex {
    const index = new CategorySuggestionIndex(evidence.length);
    const add = (type: 'COUNTERPARTY' | 'DESCRIPTION', value: string | null, row: SuggestionEvidence) => {
      if (value === null) return;
      const key = groupKey(type, row.kind, value);
      let group = index.groups.get(key);
      if (!group) {
        group = { size: 0, byCategory: new Map() };
        index.groups.set(key, group);
      }
      group.size += 1;
      group.byCategory.set(row.categoryId, (group.byCategory.get(row.categoryId) ?? 0) + 1);
    };
    for (const row of evidence) {
      add('COUNTERPARTY', row.counterpartyId, row);
      add('DESCRIPTION', descriptionKey(row.description), row);
    }
    return index;
  }

  private candidate(
    basis: 'COUNTERPARTY' | 'DESCRIPTION',
    kind: SubjectKind,
    value: string | null,
    thresholds: CategorySuggestionThresholds,
  ): Candidate | null {
    if (value === null) return null;
    const group = this.groups.get(groupKey(basis, kind, value));
    if (!group) return null;
    let top = 0;
    let topCategory: string | null = null;
    let tied = false;
    for (const [category, count] of group.byCategory) {
      if (count > top) {
        top = count;
        topCategory = category;
        tied = false;
      } else if (count === top) {
        tied = true;
      }
    }
    if (topCategory === null || tied || group.size < thresholds.minSupport) return null;
    const confidence = confidenceOf(top, group.size);
    if (new MoneyDecimal(confidence).lt(thresholds.minConfidence)) return null;
    return { basis, categoryId: topCategory, support: group.size, matches: top, confidence };
  }

  /**
   * Sugerencia para el sujeto o `null`. Dos patrones: la contraparte y la clave de descripción. Si coinciden en la
   * categoría, una sola sugerencia con base `BOTH` y la confianza mayor; si difieren, gana la de mayor confianza y, a
   * igual confianza, la de la contraparte (señal más precisa que el texto).
   */
  suggest(subject: SuggestionSubject, thresholds: CategorySuggestionThresholds): CategorySuggestion | null {
    const key = descriptionKey(subject.description);
    const byCounterparty = this.candidate('COUNTERPARTY', subject.kind, subject.counterpartyId, thresholds);
    const byDescription = this.candidate('DESCRIPTION', subject.kind, key, thresholds);
    if (!byCounterparty && !byDescription) return null;

    let chosen: Candidate;
    let basis: CategorySuggestionBasis;
    if (byCounterparty && byDescription) {
      const order = new MoneyDecimal(byCounterparty.confidence).comparedTo(byDescription.confidence);
      chosen = order >= 0 ? byCounterparty : byDescription;
      basis = byCounterparty.categoryId === byDescription.categoryId ? 'BOTH' : chosen.basis;
    } else {
      chosen = (byCounterparty ?? byDescription) as Candidate;
      basis = chosen.basis;
    }
    const high =
      new MoneyDecimal(chosen.confidence).gte(thresholds.highConfidence) &&
      chosen.support >= thresholds.highMinSupport;
    return {
      categoryId: chosen.categoryId,
      confidence: chosen.confidence,
      level: high ? 'HIGH' : 'MEDIUM',
      support: chosen.support,
      matches: chosen.matches,
      basis,
      descriptionKey: basis === 'COUNTERPARTY' ? null : key,
      counterpartyId: basis === 'DESCRIPTION' ? null : subject.counterpartyId,
    };
  }
}

// ───────────────────────────────────────────────────────────── backtesting (D477)

/** Un acierto o un fallo del backtesting: nivel y base de la sugerencia y si coincidió con lo que eligió el usuario. */
export interface BacktestSample {
  readonly level: CategorySuggestionLevel;
  readonly basis: CategorySuggestionBasis;
  readonly hit: boolean;
}

export interface BacktestFigures {
  readonly transactions: number;
  readonly suggestions: number;
  readonly hits: number;
  /** `hits ÷ suggestions`, 4 decimales HALF_EVEN; `null` sin sugerencias. */
  readonly precision: string | null;
  /** `suggestions ÷ transactions`, 4 decimales HALF_EVEN; `null` sin transacciones. */
  readonly coverage: string | null;
}

/** Precisión (aciertos sobre sugerencias) y cobertura (sugerencias sobre transacciones) con 4 decimales HALF_EVEN. */
export function backtestFigures(transactions: number, suggestions: number, hits: number): BacktestFigures {
  return {
    transactions,
    suggestions,
    hits,
    precision: suggestions === 0 ? null : confidenceOf(hits, suggestions),
    coverage: transactions === 0 ? null : confidenceOf(suggestions, transactions),
  };
}

/** Mínimo de meses del backtesting (D477). */
export const BACKTEST_MIN_MONTHS = 3;
