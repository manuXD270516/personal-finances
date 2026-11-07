import { MoneyDecimal, normalizeText } from '@pf/shared-kernel';
import { sha256Hex } from './sha256.js';
import type { RuleOutcome, SubjectKind } from './types.js';

/**
 * Sugerencia de reglas por clasificaciones manuales repetidas (openspec add-rule-suggestions, FR-RULES-011). Todo lo de
 * este archivo es puro y determinista: sin ML, sin reloj y sin entrada/salida. La evidencia ya viene filtrada (manual,
 * un split, sin administradas por otro módulo, categoría activa) por el servicio de aplicación.
 */

/** Umbrales del cálculo (decisión 8 del diseño; configurables con `RULES_SUGGEST_*`). */
export interface ProposalThresholds {
  readonly minSupport: number;
  /** Decimal con 4 decimales (`0.8000`). */
  readonly minConfidence: string;
  readonly highConfidence: string;
  readonly highMinSupport: number;
}

export const RULE_PROPOSAL_DEFAULTS: ProposalThresholds = {
  minSupport: 3,
  minConfidence: '0.8000',
  highConfidence: '0.9500',
  highMinSupport: 5,
};

export const PROPOSAL_MAX_WORDS = 5;
const MIN_LETTERS = 3;

/**
 * Clave canónica de una descripción (decisión 3): texto normalizado sin las palabras con dígitos o asteriscos ni las de
 * un solo carácter, hasta 5 palabras y con al menos 3 letras; `null` si no queda una clave utilizable.
 */
export function descriptionKey(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const words = normalizeText(raw)
    .split(' ')
    .filter((w) => w.length > 1 && !/[\d*]/u.test(w))
    .slice(0, PROPOSAL_MAX_WORDS);
  const key = words.join(' ');
  const letters = key.match(/\p{L}/gu)?.length ?? 0;
  return letters >= MIN_LETTERS ? key : null;
}

export const PROPOSAL_PATTERN_TYPES = ['DESCRIPTION', 'COUNTERPARTY'] as const;
export type ProposalPatternType = (typeof PROPOSAL_PATTERN_TYPES)[number];

/** Patrón de una sugerencia: qué se repite, de qué tipo de transacción y hacia qué categoría. */
export interface ProposalPattern {
  readonly type: ProposalPatternType;
  /** Clave de descripción o id de la contraparte. */
  readonly value: string;
  readonly kind: SubjectKind;
  readonly categoryId: string;
}

/** Huella estable de una sugerencia: SHA-256 hexadecimal de `v1|<tipo>|<valor>|<kind>|<categoría>`. */
export function proposalFingerprint(p: ProposalPattern): string {
  return sha256Hex(`v1|${p.type}|${p.value}|${p.kind}|${p.categoryId}`);
}

/** Transacción de evidencia (lo mínimo que el minero necesita). */
export interface ProposalEvidence {
  readonly transactionId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly kind: SubjectKind;
  readonly description: string | null;
  readonly counterpartyId: string | null;
  readonly categoryId: string;
}

export type ProposalConfidenceLevel = 'HIGH' | 'MEDIUM';

export interface ProposalCandidate {
  readonly suggestionId: string;
  readonly pattern: ProposalPattern;
  /** Transacciones de evidencia del patrón en la categoría sugerida. */
  readonly support: number;
  /** Transacciones de evidencia del patrón y del mismo tipo, en cualquier categoría. */
  readonly evidenceCount: number;
  /** `support ÷ evidenceCount`, 4 decimales HALF_EVEN. */
  readonly confidence: string;
  readonly level: ProposalConfidenceLevel;
  /** Ids de la evidencia a favor, de la más reciente a la más antigua. */
  readonly evidenceIds: readonly string[];
  /** Ids del patrón clasificados en otras categorías, de la más reciente a la más antigua. */
  readonly counterExampleIds: readonly string[];
}

/** Más reciente primero; el id desempata para que el orden no dependa del de entrada. */
const recency = (a: ProposalEvidence, b: ProposalEvidence): number =>
  a.date === b.date
    ? a.transactionId < b.transactionId
      ? 1
      : a.transactionId > b.transactionId
        ? -1
        : 0
    : a.date < b.date
      ? 1
      : -1;

const confidenceOf = (support: number, evidenceCount: number): string =>
  new MoneyDecimal(support).div(evidenceCount).toDecimalPlaces(4, MoneyDecimal.ROUND_HALF_EVEN).toFixed(4);

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Orden de las sugerencias: apoyo desc, confianza desc y patrón asc (tipo, valor, tipo de transacción, categoría). */
function compareCandidates(a: ProposalCandidate, b: ProposalCandidate): number {
  if (a.support !== b.support) return b.support - a.support;
  const conf = new MoneyDecimal(b.confidence).comparedTo(a.confidence);
  if (conf !== 0) return conf;
  return (
    cmp(a.pattern.type, b.pattern.type) ||
    cmp(a.pattern.value, b.pattern.value) ||
    cmp(a.pattern.kind, b.pattern.kind) ||
    cmp(a.pattern.categoryId, b.pattern.categoryId)
  );
}

/**
 * Agrupa la evidencia por `(tipo de patrón, valor, tipo de transacción)` y sugiere el grupo cuya categoría dominante
 * (única) tiene apoyo y confianza suficientes. Quita la sugerencia por descripción cuya evidencia está contenida en la
 * de una por contraparte con la misma categoría y el mismo tipo. Resultado ordenado y limitado a `limit`.
 */
export function mineProposals(
  evidence: readonly ProposalEvidence[],
  thresholds: ProposalThresholds,
  limit = Number.POSITIVE_INFINITY,
): ProposalCandidate[] {
  const sorted = [...evidence].sort(recency);
  const groups = new Map<
    string,
    { type: ProposalPatternType; value: string; kind: SubjectKind; rows: ProposalEvidence[] }
  >();
  const add = (type: ProposalPatternType, value: string | null, row: ProposalEvidence) => {
    if (value === null) return;
    const key = `${type}\u0000${value}\u0000${row.kind}`;
    let g = groups.get(key);
    if (!g) {
      g = { type, value, kind: row.kind, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(row);
  };
  for (const row of sorted) {
    add('DESCRIPTION', descriptionKey(row.description), row);
    add('COUNTERPARTY', row.counterpartyId, row);
  }

  const candidates: ProposalCandidate[] = [];
  for (const g of groups.values()) {
    const byCategory = new Map<string, ProposalEvidence[]>();
    for (const r of g.rows) {
      const list = byCategory.get(r.categoryId) ?? [];
      list.push(r);
      byCategory.set(r.categoryId, list);
    }
    let top = 0;
    let topCategory: string | null = null;
    let tied = false;
    for (const [category, rows] of byCategory) {
      if (rows.length > top) {
        top = rows.length;
        topCategory = category;
        tied = false;
      } else if (rows.length === top) {
        tied = true;
      }
    }
    if (topCategory === null || tied || top < thresholds.minSupport) continue;
    const confidence = confidenceOf(top, g.rows.length);
    if (new MoneyDecimal(confidence).lt(thresholds.minConfidence)) continue;
    const pattern: ProposalPattern = { type: g.type, value: g.value, kind: g.kind, categoryId: topCategory };
    const high =
      new MoneyDecimal(confidence).gte(thresholds.highConfidence) && top >= thresholds.highMinSupport;
    candidates.push({
      suggestionId: proposalFingerprint(pattern),
      pattern,
      support: top,
      evidenceCount: g.rows.length,
      confidence,
      level: high ? 'HIGH' : 'MEDIUM',
      evidenceIds: (byCategory.get(topCategory) as ProposalEvidence[]).map((r) => r.transactionId),
      counterExampleIds: g.rows.filter((r) => r.categoryId !== topCategory).map((r) => r.transactionId),
    });
  }

  // La contraparte es más estable que la glosa bancaria: descarta la descripción contenida en su evidencia.
  const counterparty = candidates.filter((c) => c.pattern.type === 'COUNTERPARTY');
  const deduped = candidates.filter((c) => {
    if (c.pattern.type !== 'DESCRIPTION') return true;
    return !counterparty.some(
      (cp) =>
        cp.pattern.categoryId === c.pattern.categoryId &&
        cp.pattern.kind === c.pattern.kind &&
        c.evidenceIds.every((id) => cp.evidenceIds.includes(id)),
    );
  });
  return deduped.sort(compareCandidates).slice(0, limit);
}

/** Regla activa en conflicto con una sugerencia: fija otra categoría sobre parte de su evidencia. */
export interface ProposalConflict {
  readonly ruleId: string;
  readonly version: number;
  readonly categoryId: string;
  readonly count: number;
}

export interface CoverageAssessment {
  /** Las reglas activas ya fijan la categoría sugerida en toda la evidencia a favor. */
  readonly covered: boolean;
  readonly conflicts: readonly ProposalConflict[];
}

/**
 * Cruza la evidencia a favor con lo que las reglas activas fijarían (evaluadas con la categoría vacía, con cualquier
 * disparador): cubierta en toda si fijan la categoría sugerida; en conflicto por cada regla que fija otra.
 */
export function assessCoverage(
  evidenceIds: readonly string[],
  suggestedCategoryId: string,
  categoryOf: (transactionId: string) => NonNullable<RuleOutcome['category']> | null,
): CoverageAssessment {
  let covered = evidenceIds.length > 0;
  const conflicts = new Map<string, { ruleId: string; version: number; categoryId: string; count: number }>();
  for (const id of evidenceIds) {
    const outcome = categoryOf(id);
    if (outcome?.categoryId !== suggestedCategoryId) covered = false;
    if (outcome && outcome.categoryId !== suggestedCategoryId) {
      const key = `${outcome.origin.ruleId}\u0000${outcome.origin.ruleVersion}\u0000${outcome.categoryId}`;
      const found = conflicts.get(key);
      if (found) found.count += 1;
      else
        conflicts.set(key, {
          ruleId: outcome.origin.ruleId,
          version: outcome.origin.ruleVersion,
          categoryId: outcome.categoryId,
          count: 1,
        });
    }
  }
  return {
    covered,
    conflicts: [...conflicts.values()].sort((a, b) => b.count - a.count || cmp(a.ruleId, b.ruleId)),
  };
}

export const PROPOSAL_DEFAULT_PRIORITY = 100;

/**
 * Prioridad propuesta: 100 sin conflictos; si hay, una unidad menor que la menor en conflicto (mínimo 0). Con la menor
 * ya en 0 no puede quedar antes (empata y decide la antigüedad, D333): `cannotOutrank`.
 */
export function proposedPriority(conflictPriorities: readonly number[]): {
  readonly priority: number;
  readonly cannotOutrank: boolean;
} {
  if (conflictPriorities.length === 0) {
    return { priority: PROPOSAL_DEFAULT_PRIORITY, cannotOutrank: false };
  }
  const min = Math.min(...conflictPriorities);
  return { priority: Math.max(0, min - 1), cannotOutrank: min <= 0 };
}

/** UUID estable de una sugerencia para el historial de auditoría (la huella tiene 64 hexadecimales). */
export function suggestionAggregateId(suggestionId: string): string {
  const h = suggestionId.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Condiciones de la regla sugerida: el patrón y el tipo de transacción (`matchMode ALL`). */
export function proposedConditions(pattern: ProposalPattern): readonly Record<string, unknown>[] {
  return [
    pattern.type === 'DESCRIPTION'
      ? { field: 'DESCRIPTION', operator: 'contains', value: pattern.value }
      : { field: 'COUNTERPARTY', operator: 'equals', value: pattern.value },
    { field: 'KIND', operator: 'equals', value: pattern.kind },
  ];
}

/** Nombre propuesto `<Categoría>: <patrón>`, truncado a 80 caracteres. */
export function proposedRuleName(categoryName: string, label: string): string {
  const name = `${categoryName}: ${label}`;
  return name.length <= 80 ? name : name.slice(0, 80).trimEnd();
}
