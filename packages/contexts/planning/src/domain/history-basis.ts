import { DomainError } from '@pf/shared-kernel';
import {
  SUGGESTION_METHODS,
  type OutlierRule,
  type PeriodUseStatus,
  type SuggestionMethod,
} from './historical-budget-estimator.js';
import type { BudgetLineKind } from './budget-types.js';

export interface BasisMoney {
  readonly amount: string;
  readonly currency: string;
}

export interface HistoryBasisPeriod {
  readonly periodId: string | null;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly closed: boolean;
  readonly actual: string | null;
  readonly status: PeriodUseStatus;
}

/**
 * Base de una sugerencia aplicada (`planning.budget_line.history_basis`, `schemaVersion` 1; openspec
 * add-historical-budgets decisión 8). Montos como texto decimal, nunca `number`. Una edición posterior de la línea NO la
 * borra: la vista compara el monto vigente con `applied`.
 */
export interface HistoryBasisState {
  readonly schemaVersion: 1;
  readonly method: SuggestionMethod;
  readonly periodsRequested: number;
  readonly adjustmentPercent: string;
  readonly roundingIncrement: number | null;
  readonly suggested: BasisMoney;
  readonly applied: BasisMoney;
  readonly mean: string | null;
  readonly median: string | null;
  readonly q1: string | null;
  readonly q3: string | null;
  readonly outlierRule: OutlierRule;
  readonly minValid: number;
  readonly usedCount: number;
  readonly periods: readonly HistoryBasisPeriod[];
  readonly computedAt: string;
  readonly operationId: string;
}

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const STATUSES: readonly string[] = [
  'USED',
  'OUTLIER',
  'INCOMPLETE',
  'BEFORE_FIRST_ACTIVITY',
  'NO_RATE',
  'IN_PROGRESS',
  'USER_EXCLUDED',
];

const bad = (detail: string) => new DomainError('VALIDATION_FAILED', `history basis: ${detail}`);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const decimal = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !DECIMAL.test(v)) throw bad(`${field} must be a decimal string`);
  return v;
};
const decimalOrNull = (v: unknown, field: string): string | null =>
  v === null || v === undefined ? null : decimal(v, field);
const text = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || v === '') throw bad(`${field} must be a text`);
  return v;
};
const money = (v: unknown, field: string): BasisMoney => {
  if (!isObject(v)) throw bad(`${field} must be {amount, currency}`);
  return {
    amount: decimal(v['amount'], `${field}.amount`),
    currency: text(v['currency'], `${field}.currency`),
  };
};

/** VO `HistoryBasis`: valida la forma persistida (jsonb) y la entrega tipada. */
export const HistoryBasis = {
  parse(raw: unknown): HistoryBasisState {
    if (!isObject(raw)) throw bad('must be an object');
    if (raw['schemaVersion'] !== 1) throw bad('schemaVersion must be 1');
    const method = raw['method'];
    if (!(SUGGESTION_METHODS as readonly unknown[]).includes(method)) throw bad('method is not valid');
    const periods = raw['periods'];
    if (!Array.isArray(periods)) throw bad('periods must be a list');
    const rounding = raw['roundingIncrement'];
    if (rounding !== null && rounding !== undefined && typeof rounding !== 'number') {
      throw bad('roundingIncrement must be a number or null');
    }
    const count = (v: unknown, field: string): number => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw bad(`${field} must be a count`);
      return v;
    };
    const outlierRule = raw['outlierRule'] ?? 'NONE_SMALL_SAMPLE';
    if (outlierRule !== 'TUKEY_1_5_IQR' && outlierRule !== 'NONE_SMALL_SAMPLE') throw bad('outlierRule');
    return {
      schemaVersion: 1,
      method: method as SuggestionMethod,
      periodsRequested: count(raw['periodsRequested'], 'periodsRequested'),
      adjustmentPercent: decimal(raw['adjustmentPercent'] ?? '0.00', 'adjustmentPercent'),
      roundingIncrement: rounding === undefined ? null : (rounding as number | null),
      suggested: money(raw['suggested'], 'suggested'),
      applied: money(raw['applied'], 'applied'),
      mean: decimalOrNull(raw['mean'], 'mean'),
      median: decimalOrNull(raw['median'], 'median'),
      q1: decimalOrNull(raw['q1'], 'q1'),
      q3: decimalOrNull(raw['q3'], 'q3'),
      outlierRule,
      minValid: count(raw['minValid'] ?? 1, 'minValid'),
      usedCount: count(raw['usedCount'], 'usedCount'),
      periods: periods.map((p, i): HistoryBasisPeriod => {
        if (!isObject(p)) throw bad(`periods[${i}] must be an object`);
        const status = p['status'];
        if (typeof status !== 'string' || !STATUSES.includes(status)) throw bad(`periods[${i}].status`);
        const periodId = p['periodId'];
        return {
          periodId: typeof periodId === 'string' ? periodId : null,
          label: text(p['label'], `periods[${i}].label`),
          start: text(p['start'], `periods[${i}].start`),
          end: text(p['end'], `periods[${i}].end`),
          closed: p['closed'] === true,
          actual: decimalOrNull(p['actual'], `periods[${i}].actual`),
          status: status as PeriodUseStatus,
        };
      }),
      computedAt: text(raw['computedAt'], 'computedAt'),
      operationId: text(raw['operationId'], 'operationId'),
    };
  },
} as const;

/** Campo de la línea que una sugerencia reemplaza según su tipo (openspec "Líneas a las que se aplica"). */
export function anchorFieldOf(kind: BudgetLineKind): 'planned' | 'min' | 'max' | null {
  switch (kind) {
    case 'FIXED':
    case 'MAXIMUM':
      return 'planned';
    case 'MINIMUM':
      return 'min';
    case 'RANGE':
      return 'max';
    case 'PERCENT_OF_INCOME':
      return null;
  }
}
