/**
 * Lógica pura de "Sugerir desde el historial" (openspec add-historical-budgets 6.1 y 6.2): tipos del contrato, armado de
 * la solicitud y de la confirmación, ajustes manuales por periodo y validación de lo que escribe el usuario. Sin React;
 * los montos son `DecimalString` (INV-001), nunca `number`.
 */
import { normalizeDecimalInput, parseAmount } from '../common/money';
import type { Money } from '../common/types';
import type { BudgetLineKind, BudgetNature, BudgetTargetKind } from './budget-logic';

export type SuggestionMethod = 'AVERAGE' | 'SAME_PERIOD_LAST_YEAR';
export type SuggestionLineStatus = 'OK' | 'INSUFFICIENT_HISTORY' | 'NOT_APPLICABLE';
export type SuggestionPeriodStatus =
  'USED' | 'OUTLIER' | 'INCOMPLETE' | 'BEFORE_FIRST_ACTIVITY' | 'NO_RATE' | 'IN_PROGRESS' | 'USER_EXCLUDED';
export const ROUNDING_INCREMENTS = [1, 5, 10, 50, 100] as const;

export interface SuggestionTarget {
  readonly kind: BudgetTargetKind;
  readonly id: string;
}

export interface SuggestionPeriod {
  readonly periodId: string | null;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly closed: boolean;
  readonly actual: Money | null;
  readonly status: SuggestionPeriodStatus | string;
}

export interface SuggestionExplanation {
  readonly method: SuggestionMethod;
  readonly periodsRequested: number;
  readonly adjustmentPercent: string;
  readonly roundingIncrement: number | null;
  readonly usedCount: number;
  readonly minValid: number;
  readonly outlierRule: 'TUKEY_1_5_IQR' | 'NONE_SMALL_SAMPLE' | string;
  readonly q1?: string | null;
  readonly q3?: string | null;
  readonly mean: string | null;
  readonly median: string | null;
  readonly suggested: Money | null;
  readonly periods: readonly SuggestionPeriod[];
}

export interface SuggestionLine {
  readonly target: SuggestionTarget;
  readonly targetName: string;
  readonly nature: BudgetNature;
  readonly kind: BudgetLineKind;
  readonly existingLineId: string | null;
  readonly currentAmount: Money | null;
  readonly suggestedAmount: Money | null;
  readonly difference: Money | null;
  readonly status: SuggestionLineStatus | string;
  readonly explanation: SuggestionExplanation | null;
}

export interface SuggestionWindowPeriod {
  readonly periodId: string | null;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly closed: boolean;
}

export interface SuggestionPreview {
  readonly periodId: string;
  readonly budgetId: string | null;
  readonly budgetVersion: number | null;
  readonly currency: string;
  readonly method: SuggestionMethod;
  readonly periods: number;
  readonly adjustmentPercent: string;
  readonly roundingIncrement: number | null;
  readonly token: string;
  readonly window: readonly SuggestionWindowPeriod[];
  readonly lines: readonly SuggestionLine[];
}

export const lineKey = (t: SuggestionTarget): string => `${t.kind}:${t.id}`;

/** Parámetros que elige el usuario antes de pedir la vista previa (texto tal como lo escribió). */
export interface SuggestionParams {
  readonly method: SuggestionMethod;
  readonly periods: string;
  readonly adjustment: string;
  readonly rounding: string;
}

export const defaultParams = (): SuggestionParams => ({
  method: 'AVERAGE',
  periods: '6',
  adjustment: '',
  rounding: '',
});

/** Ajustes manuales por línea: periodos excluidos y atípicos reincluidos (por id de periodo). */
export type Overrides = ReadonlyMap<
  string,
  { readonly exclude: readonly string[]; readonly include: readonly string[] }
>;

export type ParamsResult =
  | {
      readonly ok: true;
      readonly body: {
        readonly method: SuggestionMethod;
        readonly periods?: number;
        readonly adjustmentPercent?: string;
        readonly roundingIncrement?: number | null;
      };
    }
  | { readonly ok: false; readonly errors: Partial<Record<'periods' | 'adjustment', 'invalid'>> };

/** Valida N (1 a 12) y el ajuste (-100,00 a 1000,00 con hasta 2 decimales) tolerando el formato del locale. */
export function validateParams(params: SuggestionParams, locale: string): ParamsResult {
  const errors: Partial<Record<'periods' | 'adjustment', 'invalid'>> = {};
  let periods: number | undefined;
  if (params.method === 'AVERAGE') {
    const n = params.periods.trim();
    if (!/^\d{1,2}$/.test(n) || Number(n) < 1 || Number(n) > 12) errors.periods = 'invalid';
    else periods = Number(n);
  }
  let adjustmentPercent: string | undefined;
  const raw = params.adjustment.trim();
  if (raw !== '') {
    const negative = raw.startsWith('-');
    const normalized = normalizeDecimalInput(negative ? raw.slice(1) : raw, locale);
    const decimals = normalized?.split('.')[1]?.length ?? 0;
    const intPart = Number(normalized?.split('.')[0] ?? 'x');
    const limit = negative ? 100 : 1000;
    const exceeds =
      normalized !== null &&
      (intPart > limit || (intPart === limit && /[1-9]/.test(normalized.split('.')[1] ?? '')));
    if (normalized === null || decimals > 2 || exceeds) errors.adjustment = 'invalid';
    else adjustmentPercent = `${negative ? '-' : ''}${normalized}`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      method: params.method,
      ...(periods === undefined ? {} : { periods }),
      ...(adjustmentPercent === undefined ? {} : { adjustmentPercent }),
      roundingIncrement: params.rounding === '' ? null : Number(params.rounding),
    },
  };
}

export function requestBody(
  periodId: string,
  params: Extract<ParamsResult, { ok: true }>['body'],
  overrides: Overrides,
) {
  const list = [...overrides.entries()]
    .filter(([, o]) => o.exclude.length > 0 || o.include.length > 0)
    .map(([key, o]) => {
      const [kind, id] = key.split(':') as [BudgetTargetKind, string];
      return {
        target: { kind, id },
        ...(o.exclude.length > 0 ? { excludePeriodIds: [...o.exclude] } : {}),
        ...(o.include.length > 0 ? { includePeriodIds: [...o.include] } : {}),
      };
    });
  return { periodId, ...params, ...(list.length > 0 ? { overrides: list } : {}) };
}

/** Cambia el ajuste manual de un periodo de una línea: excluirlo, reincluirlo (atípico) o volver al cálculo. */
export function withOverride(
  overrides: Overrides,
  key: string,
  periodId: string,
  action: 'exclude' | 'include' | 'clear',
): Overrides {
  const next = new Map(overrides);
  const current = next.get(key) ?? { exclude: [], include: [] };
  const exclude = current.exclude.filter((id) => id !== periodId);
  const include = current.include.filter((id) => id !== periodId);
  if (action === 'exclude') exclude.push(periodId);
  if (action === 'include') include.push(periodId);
  if (exclude.length === 0 && include.length === 0) next.delete(key);
  else next.set(key, { exclude, include });
  return next;
}

/** Qué puede hacer el usuario con un periodo de la explicación (periodos incompletos o sin tasa nunca se incluyen). */
export function periodAction(
  p: Pick<SuggestionPeriod, 'periodId' | 'status'>,
): 'exclude' | 'include' | 'clear' | null {
  if (p.periodId === null) return null;
  if (p.status === 'USED') return 'exclude';
  if (p.status === 'OUTLIER') return 'include';
  if (p.status === 'USER_EXCLUDED') return 'clear';
  return null;
}

/** Línea elegible: tiene monto sugerido que se puede aplicar. */
export const isApplicable = (line: SuggestionLine): boolean =>
  line.status === 'OK' && line.suggestedAmount !== null;

export type DiffTone = 'UP' | 'DOWN' | 'SAME' | 'NONE';
export function diffTone(line: Pick<SuggestionLine, 'difference'>): DiffTone {
  const d = line.difference?.amount;
  if (d === undefined) return 'NONE';
  if (/^-?0*(\.0*)?$/.test(d)) return 'SAME';
  return d.startsWith('-') ? 'DOWN' : 'UP';
}

/** Monto escrito para una línea: vacío vale lo sugerido; negativo o con más decimales que la escala es inválido. */
export function parseEdited(
  raw: string,
  suggested: string,
  opts: { locale: string; currency: string; scale: number },
): { ok: true; value: string } | { ok: false } {
  if (raw.trim() === '') return { ok: true, value: suggested };
  const r = parseAmount(raw, { ...opts, allowZero: true });
  return r.ok ? { ok: true, value: r.value } : { ok: false };
}

export interface LinePick {
  readonly line: SuggestionLine;
  readonly amount: string;
}

/** Cuerpo de `confirmBudgetSuggestions`: solo las líneas elegidas, con el sugerido visto y el monto final. */
export function confirmBody(preview: SuggestionPreview, request: unknown, picks: readonly LinePick[]) {
  return {
    token: preview.token,
    request,
    lines: picks.map(({ line, amount }) => ({
      target: line.target,
      ...(line.existingLineId === null ? { kind: line.kind } : {}),
      amount: { amount, currency: preview.currency },
      suggestedAmount: line.suggestedAmount as Money,
    })),
  };
}
