import { dec, type Decimal } from '@pf/shared-kernel';
import type { PeriodAggregate } from './period-series-builder.js';

export const SERIES_SCOPES = [
  'TOTAL_EXPENSE',
  'CATEGORY_GROUP',
  'CATEGORY',
  'OTHER_CATEGORIES',
  'TOTAL_INCOME',
  /** Gasto variable pagado desde cuentas líquidas de una moneda, en esa moneda (add-predicted-cash-flow-band). */
  'LIQUID_VARIABLE_OUTFLOW',
] as const;
export type SeriesScope = (typeof SERIES_SCOPES)[number];
export type Readiness = 'MODEL' | 'SIMPLE' | 'INSUFFICIENT';
export type ReadinessReasonCode =
  'TOO_FEW_PERIODS' | 'LOW_CATEGORIZATION' | 'GAP_TRUNCATED' | 'INVALID_OUTPUT';

export interface ReadinessReason {
  readonly code: ReadinessReasonCode;
  readonly missingForSimple: number | null;
  readonly missingForModel: number | null;
}

export interface ReadinessThresholds {
  readonly minPeriodsModel: number;
  readonly minPeriodsSimple: number;
}

export const DEFAULT_THRESHOLDS: ReadinessThresholds = { minPeriodsModel: 6, minPeriodsSimple: 3 };

export interface CategoryInfo {
  readonly categoryId: string;
  readonly groupId: string;
  readonly name: string;
  /** Categoría del gasto sin clasificar (`UNCATEGORIZED`). */
  readonly uncategorized: boolean;
}

export interface GroupInfo {
  readonly groupId: string;
  readonly name: string;
}

export interface SeriesPoint {
  readonly period: string;
  readonly value: Decimal;
  readonly txCount: number;
}

export interface EvaluatedSeries {
  readonly scope: SeriesScope;
  readonly scopeRef: string | null;
  readonly name: string;
  readonly kind: 'EXPENSE' | 'INCOME';
  readonly readiness: Readiness;
  readonly readinessReasons: readonly ReadinessReason[];
  /** Historia desde el primer periodo con datos de la serie; vacía si no hay. */
  readonly points: readonly SeriesPoint[];
  readonly historyFrom: string | null;
  readonly historyTo: string | null;
  readonly groupedCategoryIds: readonly string[];
  /** Cantidad de periodos a pronosticar (12 o 6 según la historia; solo con `readiness` distinto de INSUFFICIENT). */
  readonly horizon: number;
  /** Moneda y escala propias de la serie (`LIQUID_VARIABLE_OUTFLOW`); ausentes, las de reporte de la corrida. */
  readonly currency?: string;
  readonly scale?: number;
}

export interface GapResult {
  readonly periods: readonly PeriodAggregate[];
  /** `true` si más de un hueco consecutivo recortó el inicio de la historia. */
  readonly truncated: boolean;
}

export interface EvaluateInput {
  readonly periods: readonly PeriodAggregate[];
  /** Historia completa (con lo recurrente) para juzgar la calidad de la clasificación; por omisión, `periods`. */
  readonly qualityPeriods?: readonly PeriodAggregate[];
  readonly categories: readonly CategoryInfo[];
  readonly groups: readonly GroupInfo[];
  readonly thresholds: ReadinessThresholds;
  readonly truncated: boolean;
}

const SPARSE_TX_PER_PERIOD = 3;
const SPARSE_PERIOD_SHARE = 0.25;
const SPARSE_TOTAL_TX = 30;
const UNCATEGORIZED_SPEND_SHARE = 0.1;
const UNCATEGORIZED_PERIODS_SHARE = 0.2;
const HORIZON_TOTAL = 12;
const HORIZON_CATEGORY = 6;
const LONG_HISTORY = 24;
/** Horizonte del gasto variable líquido: el periodo en curso y 3 más (90 días). */
export const HORIZON_LIQUID = 4;

const trimFromFirstData = (points: readonly SeriesPoint[]): SeriesPoint[] => {
  const first = points.findIndex((p) => p.txCount > 0 || !p.value.isZero());
  return first < 0 ? [] : points.slice(first);
};

/**
 * `ReadinessGate` (openspec add-ml-forecasting-service, decisión 8; FR-FORECAST-005). Puro: arma las series
 * candidatas (gasto total, ingreso total, grupo, categoría y «Otras categorías») y decide por serie si admite modelos
 * (`MODEL`, ≥ 6 periodos), solo una estimación simple (`SIMPLE`, 3 a 5) o ningún pronóstico (`INSUFFICIENT`, < 3), con los
 * periodos que faltan hacia cada umbral.
 */
export const ReadinessGate = {
  /**
   * Huecos: un periodo sin ninguna transacción del workspace es un hueco; con más de uno consecutivo, toda la historia
   * empieza en el periodo siguiente al último de esos huecos. Un hueco aislado cuenta como cero.
   */
  applyGaps(periods: readonly PeriodAggregate[]): GapResult {
    let cut = 0;
    let run = 0;
    periods.forEach((p, i) => {
      run = p.active ? 0 : run + 1;
      if (run >= 2) cut = i + 1;
    });
    // El hueco final consecutivo también corta: la historia empieza después del último periodo vacío del tramo.
    const trimmed = periods.slice(cut);
    return { periods: trimmed, truncated: cut > 0 };
  },

  evaluate(input: EvaluateInput): EvaluatedSeries[] {
    const { periods, thresholds } = input;
    const labels = periods.map((p) => p.label);
    const categoryById = new Map(input.categories.map((c) => [c.categoryId, c]));

    const reasonsFor = (n: number): ReadinessReason[] => {
      const reasons: ReadinessReason[] = [];
      if (n < thresholds.minPeriodsModel) {
        reasons.push({
          code: 'TOO_FEW_PERIODS',
          missingForSimple: Math.max(thresholds.minPeriodsSimple - n, 0),
          missingForModel: thresholds.minPeriodsModel - n,
        });
      }
      if (input.truncated)
        reasons.push({ code: 'GAP_TRUNCATED', missingForSimple: null, missingForModel: null });
      return reasons;
    };
    const build = (s: {
      scope: SeriesScope;
      scopeRef: string | null;
      name: string;
      kind: 'EXPENSE' | 'INCOME';
      values: readonly SeriesPoint[];
      grouped?: readonly string[];
      forceInsufficient?: ReadinessReasonCode;
    }): EvaluatedSeries => {
      const points = trimFromFirstData(s.values);
      const n = points.length;
      const base = reasonsFor(n);
      let readiness: Readiness =
        n >= thresholds.minPeriodsModel
          ? 'MODEL'
          : n >= thresholds.minPeriodsSimple
            ? 'SIMPLE'
            : 'INSUFFICIENT';
      const reasons = [...base];
      if (s.forceInsufficient) {
        readiness = 'INSUFFICIENT';
        reasons.push({ code: s.forceInsufficient, missingForSimple: null, missingForModel: null });
      }
      return {
        scope: s.scope,
        scopeRef: s.scopeRef,
        name: s.name,
        kind: s.kind,
        readiness,
        readinessReasons: reasons,
        points,
        historyFrom: points[0]?.period ?? null,
        historyTo: points.at(-1)?.period ?? null,
        groupedCategoryIds: s.grouped ?? [],
        horizon:
          s.scope === 'TOTAL_EXPENSE' || s.scope === 'TOTAL_INCOME'
            ? HORIZON_TOTAL
            : n >= LONG_HISTORY
              ? HORIZON_TOTAL
              : HORIZON_CATEGORY,
      };
    };

    // Calidad de la clasificación: gasto sin categoría > 10 % en más del 20 % de los periodos.
    const quality = input.qualityPeriods ?? periods;
    const badPeriods = quality.filter((p) => {
      if (p.expenseTotal.lte(0)) return false;
      let uncategorized = dec('0');
      for (const [categoryId, fig] of p.expenseByCategory) {
        if (categoryById.get(categoryId)?.uncategorized) uncategorized = uncategorized.plus(fig.value);
      }
      return uncategorized.div(p.expenseTotal).gt(UNCATEGORIZED_SPEND_SHARE);
    }).length;
    const lowCategorization = quality.length > 0 && badPeriods / quality.length > UNCATEGORIZED_PERIODS_SHARE;
    const forceCategory = lowCategorization ? ('LOW_CATEGORIZATION' as const) : undefined;

    const series: EvaluatedSeries[] = [];
    series.push(
      build({
        scope: 'TOTAL_EXPENSE',
        scopeRef: null,
        name: 'TOTAL_EXPENSE',
        kind: 'EXPENSE',
        values: periods.map((p) => ({ period: p.label, value: p.expenseTotal, txCount: p.expenseTx })),
      }),
      build({
        scope: 'TOTAL_INCOME',
        scopeRef: null,
        name: 'TOTAL_INCOME',
        kind: 'INCOME',
        values: periods.map((p) => ({ period: p.label, value: p.incomeTotal, txCount: p.incomeTx })),
      }),
    );

    const categoryValues = (categoryId: string): SeriesPoint[] =>
      periods.map((p) => {
        const f = p.expenseByCategory.get(categoryId);
        return { period: p.label, value: f?.value ?? dec('0'), txCount: f?.txCount ?? 0 };
      });

    // Categorías con pocos movimientos van a «Otras categorías» de su grupo.
    const sparseByGroup = new Map<string, string[]>();
    const own: CategoryInfo[] = [];
    for (const c of input.categories) {
      const vals = trimFromFirstData(categoryValues(c.categoryId));
      if (vals.length === 0) continue;
      const lowDensity = vals.filter((v) => v.txCount < SPARSE_TX_PER_PERIOD).length;
      const total = vals.reduce((sum, v) => sum + v.txCount, 0);
      if (lowDensity / vals.length > SPARSE_PERIOD_SHARE && total < SPARSE_TOTAL_TX) {
        sparseByGroup.set(c.groupId, [...(sparseByGroup.get(c.groupId) ?? []), c.categoryId]);
      } else {
        own.push(c);
      }
    }
    for (const c of own) {
      series.push(
        build({
          scope: 'CATEGORY',
          scopeRef: c.categoryId,
          name: c.name,
          kind: 'EXPENSE',
          values: categoryValues(c.categoryId),
          ...(forceCategory ? { forceInsufficient: forceCategory } : {}),
        }),
      );
    }
    for (const [groupId, ids] of sparseByGroup) {
      const group = input.groups.find((g) => g.groupId === groupId);
      const values = periods.map((p) => {
        let v = dec('0');
        let tx = 0;
        for (const id of ids) {
          const f = p.expenseByCategory.get(id);
          if (f) {
            v = v.plus(f.value);
            tx += f.txCount;
          }
        }
        return { period: p.label, value: v, txCount: tx };
      });
      series.push(
        build({
          scope: 'OTHER_CATEGORIES',
          scopeRef: groupId,
          name: group?.name ?? groupId,
          kind: 'EXPENSE',
          values,
          grouped: [...ids].sort(),
          ...(forceCategory ? { forceInsufficient: forceCategory } : {}),
        }),
      );
    }
    for (const g of input.groups) {
      const ids = input.categories.filter((c) => c.groupId === g.groupId).map((c) => c.categoryId);
      if (ids.length === 0) continue;
      const values = periods.map((p) => {
        let v = dec('0');
        let tx = 0;
        for (const id of ids) {
          const f = p.expenseByCategory.get(id);
          if (f) {
            v = v.plus(f.value);
            tx += f.txCount;
          }
        }
        return { period: p.label, value: v, txCount: tx };
      });
      if (!values.some((v) => v.txCount > 0)) continue;
      series.push(
        build({
          scope: 'CATEGORY_GROUP',
          scopeRef: g.groupId,
          name: g.name,
          kind: 'EXPENSE',
          values,
          ...(forceCategory ? { forceInsufficient: forceCategory } : {}),
        }),
      );
    }
    void labels;
    return series;
  },

  /**
   * Serie del gasto variable líquido de UNA moneda (add-predicted-cash-flow-band): mismos umbrales de historia que las
   * demás series, sin la regla de calidad de la clasificación; horizonte de 4 periodos.
   */
  evaluateLiquid(input: {
    readonly currency: string;
    readonly scale: number;
    readonly values: readonly SeriesPoint[];
    readonly thresholds: ReadinessThresholds;
  }): EvaluatedSeries {
    const { thresholds } = input;
    const points = trimFromFirstData(input.values);
    const n = points.length;
    const readiness: Readiness =
      n >= thresholds.minPeriodsModel
        ? 'MODEL'
        : n >= thresholds.minPeriodsSimple
          ? 'SIMPLE'
          : 'INSUFFICIENT';
    const reasons: ReadinessReason[] =
      n < thresholds.minPeriodsModel
        ? [
            {
              code: 'TOO_FEW_PERIODS',
              missingForSimple: Math.max(thresholds.minPeriodsSimple - n, 0),
              missingForModel: thresholds.minPeriodsModel - n,
            },
          ]
        : [];
    return {
      scope: 'LIQUID_VARIABLE_OUTFLOW',
      scopeRef: null,
      name: input.currency,
      kind: 'EXPENSE',
      readiness,
      readinessReasons: reasons,
      points,
      historyFrom: points[0]?.period ?? null,
      historyTo: points.at(-1)?.period ?? null,
      groupedCategoryIds: [],
      horizon: HORIZON_LIQUID,
      currency: input.currency,
      scale: input.scale,
    };
  },
} as const;
