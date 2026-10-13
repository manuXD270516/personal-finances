/**
 * Tipos y lógica pura de "Costo de conversiones" (openspec add-conversion-cost-analysis, FR-FX-011, US-183). Los
 * importes son `DecimalString` en la moneda de reporte (INV-001): nunca `number`.
 */
import type { Money } from '../dashboard/types';

export type ConversionCostGrouping = 'FINANCIAL_PERIOD' | 'CALENDAR_MONTH';
export type ConversionCostExclusionReason = 'NO_REFERENCE' | 'NO_QUOTED_RATE' | 'NO_REPORTING_RATE';

export interface ConversionCostGroup {
  readonly period: { readonly label: string; readonly from: string; readonly to: string };
  readonly channel: {
    readonly kind: 'COUNTERPARTY' | 'NAMED' | 'NONE';
    readonly counterpartyId: string | null;
    readonly name: string | null;
  };
  readonly sourceAccountId: string;
  readonly sourceAccountName: string;
  readonly targetAccountId: string;
  readonly targetAccountName: string;
  readonly pair: { readonly base: string; readonly quote: string };
  readonly conversions: number;
  readonly converted: Money;
  readonly spreadPct: string | null;
  readonly spreadAmount: Money;
  readonly fees: Money;
  readonly costTotal: Money;
  readonly costComplete: boolean;
  readonly unvaluedFees: readonly Money[];
  readonly excluded: readonly {
    readonly reason: ConversionCostExclusionReason;
    readonly count: number;
    readonly amounts: readonly Money[];
  }[];
  readonly alternative: { readonly spreadPct: string | null; readonly excludedCount: number } | null;
}

export interface ConversionCostAnalysis {
  readonly reportingCurrency: string;
  readonly grouping: ConversionCostGrouping;
  readonly from: string;
  readonly to: string;
  readonly groups: readonly ConversionCostGroup[];
  readonly totals: {
    readonly conversions: number;
    readonly converted: Money;
    readonly spreadAmount: Money;
    readonly fees: Money;
    readonly costTotal: Money;
    readonly excludedCount: number;
    readonly costComplete: boolean;
  };
  readonly meta: { readonly generatedAt: string; readonly timeZone: string; readonly rateWindowDays: number };
}

export interface CostFilters {
  readonly from: string;
  readonly to: string;
  readonly grouping: ConversionCostGrouping;
  readonly compare: boolean;
}

export const DEFAULT_COST_FILTERS: CostFilters = {
  from: '',
  to: '',
  grouping: 'FINANCIAL_PERIOD',
  compare: false,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Error de los filtros (`null` si son válidos): fechas bien formadas y `from` no posterior a `to`. */
export function filterError(filters: CostFilters): 'DATE' | 'RANGE' | null {
  for (const v of [filters.from, filters.to]) if (v !== '' && !DATE.test(v)) return 'DATE';
  if (filters.from !== '' && filters.to !== '' && filters.from > filters.to) return 'RANGE';
  return null;
}

/** Query de la API (`/reports/conversion-costs`): solo lo que el usuario fijó. */
export function costQuery(filters: CostFilters, withCompare = true): string {
  const q = new URLSearchParams();
  if (filters.from) q.set('from', filters.from);
  if (filters.to) q.set('to', filters.to);
  q.set('grouping', filters.grouping);
  if (withCompare && filters.compare) q.set('compareWith', 'PARALLEL_SIDE');
  return q.toString();
}

/** Ruta del análisis y de su CSV relativa al workspace (`/workspaces/{id}`). */
export const costPath = (base: string, filters: CostFilters): string =>
  `${base}/reports/conversion-costs?${costQuery(filters)}`;
export const costExportPath = (base: string, filters: CostFilters): string =>
  `${base}/reports/conversion-costs/export?${costQuery(filters, false)}`;

/** Total de la moneda del grupo en el monto de una exclusión ("20,000000 USDT"). */
export const excludedAmounts = (amounts: readonly Money[], format: (m: Money) => string): string =>
  amounts.map(format).join(' + ');
