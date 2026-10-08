import type { RateAttributionDto, ResolvedRateDto } from '@pf/fx/contracts';
import type { Money } from '@pf/shared-kernel';
import type {
  BudgetLineKindDto,
  BudgetLineStatusDto,
  BudgetMoneyDto,
  BudgetNatureDto,
  BudgetTargetKindDto,
  BudgetVsActual,
} from '../contracts/index.js';
import type { BudgetView, LineView } from './budget-calculator.js';
import type { OmittedLineDto } from './template-view.js';

const money = (m: Money): BudgetMoneyDto => m.toJSON();
const moneyOrNull = (m: Money | null): BudgetMoneyDto | null => (m === null ? null : money(m));

export interface BudgetLineProgressDto {
  readonly reference: BudgetMoneyDto;
  readonly effectivePlanned: BudgetMoneyDto;
  readonly minimum: BudgetMoneyDto | null;
  readonly rolloverIn: BudgetMoneyDto | null;
  readonly rolloverStatus: 'NONE' | 'PROVISIONAL' | 'FINAL';
  readonly actual: BudgetMoneyDto;
  readonly actualComplete: boolean;
  readonly unconverted: readonly BudgetMoneyDto[];
  readonly remaining: BudgetMoneyDto;
  readonly difference: BudgetMoneyDto;
  readonly utilization: string | null;
  readonly projection: BudgetMoneyDto | null;
  readonly status: BudgetLineStatusDto;
  readonly crossedThresholds: readonly string[];
}

export interface BudgetLineDto {
  readonly id: string;
  readonly target: { readonly kind: BudgetTargetKindDto; readonly id: string };
  readonly nature: BudgetNatureDto;
  readonly kind: BudgetLineKindDto;
  readonly planned: BudgetMoneyDto | null;
  readonly min: BudgetMoneyDto | null;
  readonly max: BudgetMoneyDto | null;
  readonly percent: string | null;
  readonly incomeBasis: 'EXPECTED' | 'ACTUAL' | null;
  readonly rolloverPolicy: 'NONE' | 'CARRY_POSITIVE' | 'CARRY_ALL';
  readonly rolloverCap: BudgetMoneyDto | null;
  readonly thresholds: readonly string[];
  readonly source: 'MANUAL' | 'TEMPLATE' | 'CLONE';
  readonly overridden: boolean;
  readonly version: number;
  readonly progress: BudgetLineProgressDto;
}

export interface BudgetTotalsDto {
  readonly planned: BudgetMoneyDto;
  readonly actual: BudgetMoneyDto;
  readonly remaining: BudgetMoneyDto;
  readonly availableToSpend: BudgetMoneyDto;
  readonly expectedIncome: BudgetMoneyDto;
  readonly actualIncome: BudgetMoneyDto;
  readonly toAssign: BudgetMoneyDto | null;
  readonly complete: boolean;
  readonly unconverted: readonly BudgetMoneyDto[];
}

export interface BudgetMetaDto {
  readonly generatedAt: string;
  readonly timeZone: string;
  readonly rateWindowDays: number;
  readonly ratesUsed: readonly ResolvedRateDto[];
  readonly attributions: readonly RateAttributionDto[];
}

/** Versión de template de la que nació el plan (o que heredó al clonar), con el nombre del template. */
export interface BudgetTemplateRefDto {
  readonly templateId: string;
  readonly versionNo: number;
  readonly name: string;
}

/** Origen del plan más allá de `origin` (add-budget-templates decisiones 2 y 4). */
export interface BudgetOriginDto {
  readonly templateVersion: BudgetTemplateRefDto | null;
  readonly clonedFromBudgetId: string | null;
}

export const NO_ORIGIN: BudgetOriginDto = { templateVersion: null, clonedFromBudgetId: null };

export interface BudgetDto extends BudgetOriginDto {
  readonly id: string;
  readonly periodId: string;
  readonly periodLabel: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly periodStatus: string;
  readonly currency: string;
  readonly origin: 'EMPTY' | 'TEMPLATE' | 'CLONE';
  readonly zeroBased: boolean;
  readonly lines: readonly BudgetLineDto[];
  readonly totals: BudgetTotalsDto;
  readonly meta: BudgetMetaDto;
  readonly version: number;
  readonly createdAt: string | null;
  /** Solo en la respuesta de creación: líneas del origen que no se copiaron. */
  readonly omittedLines?: readonly OmittedLineDto[];
}

export interface BudgetSummaryDto {
  readonly id: string;
  readonly periodId: string;
  readonly periodLabel: string;
  readonly currency: string;
  readonly zeroBased: boolean;
  readonly lineCount: number;
  readonly totals: Pick<
    BudgetTotalsDto,
    'planned' | 'actual' | 'remaining' | 'availableToSpend' | 'complete'
  >;
  readonly version: number;
}

/** Los montos de una línea están en la moneda del plan, a la escala de esa moneda. */
export function toLineDto(view: LineView, currency: string): BudgetLineDto {
  const amount = (value: string | null): BudgetMoneyDto | null =>
    value === null ? null : { amount: value, currency };
  const s = view.line.snapshot;
  const p = view.progress;
  return {
    id: s.id,
    target: s.target,
    nature: s.nature,
    kind: s.kind,
    planned: amount(s.planned),
    min: amount(s.min),
    max: amount(s.max),
    percent: s.percent,
    incomeBasis: s.incomeBasis,
    rolloverPolicy: s.rolloverPolicy,
    rolloverCap: amount(s.rolloverCap),
    thresholds: s.thresholds,
    source: s.source,
    overridden: s.overridden,
    version: s.version,
    progress: {
      reference: money(p.reference),
      effectivePlanned: money(p.effectivePlanned),
      minimum: moneyOrNull(p.minimum),
      rolloverIn: moneyOrNull(view.rolloverIn),
      rolloverStatus: view.rolloverStatus,
      actual: money(p.actual),
      actualComplete: view.actualComplete,
      unconverted: view.unconverted.map(money),
      remaining: money(p.remaining),
      difference: money(p.difference),
      utilization: p.utilization,
      projection: moneyOrNull(p.projection),
      status: p.status,
      crossedThresholds: view.crossedThresholds,
    },
  };
}

export function toBudgetDto(view: BudgetView, origin: BudgetOriginDto = NO_ORIGIN): BudgetDto {
  const code = view.currency.code;
  const snapshot = view.budget.snapshot;
  const attributions = new Map<string, RateAttributionDto>();
  for (const r of view.ratesUsed) if (r.attribution) attributions.set(r.attribution.provider, r.attribution);
  const t = view.totals;
  return {
    id: snapshot.id,
    periodId: snapshot.periodId,
    periodLabel: view.period.label,
    periodStart: view.period.snapshot.periodStart,
    periodEnd: view.period.snapshot.periodEnd,
    periodStatus: view.period.status,
    currency: code,
    origin: snapshot.origin,
    templateVersion: origin.templateVersion,
    clonedFromBudgetId: origin.clonedFromBudgetId,
    zeroBased: snapshot.zeroBased,
    lines: view.lines.map((l) => toLineDto(l, code)),
    totals: {
      planned: money(t.planned),
      actual: money(t.actual),
      remaining: money(t.remaining),
      availableToSpend: money(t.availableToSpend),
      expectedIncome: money(t.expectedIncome),
      actualIncome: money(t.actualIncome),
      toAssign: moneyOrNull(t.toAssign),
      complete: view.complete,
      unconverted: view.unconverted.map(money),
    },
    meta: {
      generatedAt: view.generatedAt,
      timeZone: view.timeZone,
      rateWindowDays: view.windowDays,
      ratesUsed: view.ratesUsed,
      attributions: [...attributions.values()],
    },
    version: snapshot.version,
    createdAt: snapshot.createdAt,
  };
}

export function toSummaryDto(view: BudgetView): BudgetSummaryDto {
  const t = view.totals;
  return {
    id: view.budget.id,
    periodId: view.budget.periodId,
    periodLabel: view.period.label,
    currency: view.currency.code,
    zeroBased: view.budget.zeroBased,
    lineCount: view.lines.length,
    totals: {
      planned: money(t.planned),
      actual: money(t.actual),
      remaining: money(t.remaining),
      availableToSpend: money(t.availableToSpend),
      complete: view.complete,
    },
    version: view.budget.version,
  };
}

/** Forma pública para `add-month-closing` (`BudgetVsActualQuery`). */
export function toBudgetVsActual(view: BudgetView): BudgetVsActual {
  const t = view.totals;
  return {
    budgetId: view.budget.id,
    currency: view.currency.code,
    lines: view.lines.map((l) => ({
      budgetLineId: l.line.id,
      target: l.line.target,
      nature: l.line.nature,
      kind: l.line.kind,
      reference: money(l.progress.reference),
      actual: money(l.progress.actual),
      actualComplete: l.actualComplete,
      status: l.progress.status,
    })),
    totals: {
      planned: money(t.planned),
      actual: money(t.actual),
      remaining: money(t.remaining),
      availableToSpend: money(t.availableToSpend),
      complete: view.complete,
      unconverted: view.unconverted.map(money),
    },
    ratesUsed: view.ratesUsed,
  };
}
