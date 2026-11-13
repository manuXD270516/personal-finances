import { dec, type Decimal } from '@pf/shared-kernel';
import type { StoredSeries } from './ports.js';

export type ReportSeriesType = 'TOTAL_EXPENSE' | 'TOTAL_INCOME' | 'CATEGORY';

export interface BacktestReportRow {
  readonly type: ReportSeriesType;
  /** Series del pronóstico vigente con backtesting (modelo o respaldo; no cuentan las de estimación simple). */
  readonly seriesCount: number;
  /** Series donde se publicó un modelo que superó a la mejor referencia por al menos el 5 %. */
  readonly modelPublished: number;
  readonly meanMasePublished: string | null;
  readonly meanMaseBaseline: string | null;
  /** Series cuyo MASE publicado es menor que el de la mejor referencia. */
  readonly beatBaseline: number;
  readonly meanCoverage80: string | null;
}

const typeOf = (scope: StoredSeries['scope']): ReportSeriesType =>
  scope === 'TOTAL_EXPENSE' ? 'TOTAL_EXPENSE' : scope === 'TOTAL_INCOME' ? 'TOTAL_INCOME' : 'CATEGORY';

const mean = (values: readonly Decimal[]): string | null =>
  values.length === 0
    ? null
    : values
        .reduce((a, v) => a.plus(v), dec('0'))
        .div(values.length)
        .toFixed(4);

/**
 * Evidencia del criterio de salida de Phase 8 (pregunta 24): métricas AGREGADAS por tipo de serie del pronóstico
 * vigente. Nunca incluye montos, nombres ni ids: solo conteos y errores escalados (adimensionales).
 */
export const BacktestReport = {
  aggregate(
    series: readonly Pick<
      StoredSeries,
      'scope' | 'status' | 'selectedBy' | 'mase' | 'baselineMase' | 'coverage80'
    >[],
  ): BacktestReportRow[] {
    const types: ReportSeriesType[] = ['TOTAL_EXPENSE', 'TOTAL_INCOME', 'CATEGORY'];
    return types.map((type) => {
      const rows = series.filter(
        (s) =>
          typeOf(s.scope) === type && s.status === 'PUBLISHED' && s.mase !== null && s.baselineMase !== null,
      );
      const published = rows.map((s) => dec(s.mase as string));
      const baseline = rows.map((s) => dec(s.baselineMase as string));
      return {
        type,
        seriesCount: rows.length,
        modelPublished: rows.filter((s) => s.selectedBy === 'BACKTEST').length,
        meanMasePublished: mean(published),
        meanMaseBaseline: mean(baseline),
        beatBaseline: rows.filter((s) => dec(s.mase as string).lt(s.baselineMase as string)).length,
        meanCoverage80: mean(rows.flatMap((s) => (s.coverage80 === null ? [] : [dec(s.coverage80)]))),
      };
    });
  },

  /** Texto para la terminal: una línea por tipo, sin montos ni nombres. */
  format(rows: readonly BacktestReportRow[]): string {
    return [
      'tipo\tseries\tmodelo_publicado\tmase_publicado\tmase_referencia\tmejoran_referencia\tcobertura_80',
      ...rows.map((r) =>
        [
          r.type,
          r.seriesCount,
          r.modelPublished,
          r.meanMasePublished ?? '-',
          r.meanMaseBaseline ?? '-',
          r.beatBaseline,
          r.meanCoverage80 ?? '-',
        ].join('\t'),
      ),
    ].join('\n');
  },
} as const;
