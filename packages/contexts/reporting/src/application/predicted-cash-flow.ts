import type { LatestForecastDto } from '@pf/forecasting/contracts';
import { dec, type LocalDate } from '@pf/shared-kernel';
import type {
  CashFlowHomeBlockDto,
  PredictedCashFlowDto,
  PredictedUnavailableReasonDto,
  ReportSummaryDto,
} from '../contracts/index.js';
import {
  PredictedSpendingBand,
  type BandPeriodInput,
  type CashFlowCurrencyBlock,
  type CashFlowRiskAssessment,
} from '../domain/index.js';
import type { PredictedForecastPort } from './ports/index.js';

const LIQUID_SCOPE = 'LIQUID_VARIABLE_OUTFLOW';

/** Horizonte de lectura del pronóstico: cubre el periodo en curso y los 3 siguientes (90 días). */
const FORECAST_HORIZON = 6;

/** Banda omitida con su motivo; el resto del calendario no cambia (reporting/cash-flow-calendar). */
export const unavailablePredicted = (reason: PredictedUnavailableReasonDto): PredictedCashFlowDto => ({
  status: 'NOT_AVAILABLE',
  reason,
  forecastRunId: null,
  generatedAt: null,
  stale: false,
  intervalLevel: '0.8',
  series: [],
  lowest: null,
  shortfallLikelihood: 'NOT_AVAILABLE',
  firstShortfallDate: null,
});

export interface PredictedBands {
  readonly byCurrency: ReadonlyMap<string, PredictedCashFlowDto>;
  /** El pronóstico leído (para el gasto esperado del Home); `null` si no se pudo o no se quiso leer. */
  readonly latest: LatestForecastDto | null;
}

const LIKELIHOOD_ORDER = { LIKELY: 2, POSSIBLE: 1, UNLIKELY: 0 } as const;

/**
 * Banda del gasto variable predicho (openspec add-predicted-cash-flow-band, design decisión 5): lee el pronóstico vigente
 * en la MISMA transacción de la petición (una consulta por la corrida vigente; sin caché ni llamada al servicio), elige
 * los puntos por etiqueta de periodo y delega el reparto y las series en el DS puro `PredictedSpendingBand`. No cambia
 * el riesgo, los episodios ni las alertas: solo añade campos.
 */
export class PredictedCashFlow {
  constructor(private readonly forecast: PredictedForecastPort | undefined) {}

  /** Lee el pronóstico vigente con las series pedidas (más la del gasto líquido); `null` sin puerto. */
  async read(
    workspaceId: string,
    scopes: readonly ('TOTAL_EXPENSE' | 'LIQUID_VARIABLE_OUTFLOW')[],
  ): Promise<LatestForecastDto | null> {
    if (!this.forecast) return null;
    return this.forecast.getLatest({ workspaceId, scopes, horizon: FORECAST_HORIZON });
  }

  /** Bandas por moneda del calendario (una por bloque de moneda). */
  async bands(input: {
    readonly workspaceId: string;
    readonly today: LocalDate;
    readonly blocks: readonly CashFlowCurrencyBlock[];
    readonly assessments: ReadonlyMap<string, CashFlowRiskAssessment>;
    /** Lectura ya hecha (el Home la comparte con el gasto esperado); por omisión se lee aquí. */
    readonly latest?: LatestForecastDto | null;
  }): Promise<PredictedBands> {
    const byCurrency = new Map<string, PredictedCashFlowDto>();
    const all = (reason: PredictedUnavailableReasonDto, latest: LatestForecastDto | null): PredictedBands => {
      for (const b of input.blocks) byCurrency.set(b.currency.code, unavailablePredicted(reason));
      return { byCurrency, latest };
    };
    if (!this.forecast) return all('DISABLED', null);
    if (input.blocks.length === 0) return { byCurrency, latest: input.latest ?? null };
    const latest =
      input.latest !== undefined ? input.latest : await this.read(input.workspaceId, [LIQUID_SCOPE]);
    if (!latest || latest.status === 'DISABLED') return all('DISABLED', latest);
    if (latest.status === 'NONE' || !latest.run) return all('NO_FORECAST', latest);

    const today = input.today.toString();
    const liquid = latest.series.filter((s) => s.scope === LIQUID_SCOPE);
    interface Ready {
      readonly block: CashFlowCurrencyBlock;
      readonly periods: BandPeriodInput[];
      readonly currentStart: string;
    }
    const ready: Ready[] = [];
    for (const block of input.blocks) {
      const series = liquid.find((s) => s.currency === block.currency.code);
      if (!series) {
        byCurrency.set(block.currency.code, unavailablePredicted('NO_SERIES'));
        continue;
      }
      if (series.readiness === 'INSUFFICIENT' || series.points.length === 0) {
        byCurrency.set(block.currency.code, unavailablePredicted('INSUFFICIENT_DATA'));
        continue;
      }
      const current = series.points.find((p) => p.periodStart <= today && today <= p.periodEnd);
      if (!current) {
        byCurrency.set(block.currency.code, unavailablePredicted('NO_CURRENT_PERIOD'));
        continue;
      }
      ready.push({
        block,
        currentStart: current.periodStart,
        periods: series.points.map((p) => ({
          start: p.periodStart,
          end: p.periodEnd,
          expected: dec(p.prediction.amount),
          high: dec(p.interval80.upper.amount),
          low: dec(p.interval80.lower.amount),
        })),
      });
    }
    if (ready.length === 0) return { byCurrency, latest };

    // Lo ya gastado en el periodo en curso (misma regla que la historia), por moneda y sin conversión.
    const from = ready.reduce(
      (min, r) => (r.currentStart < min ? r.currentStart : min),
      ready[0]?.currentStart as string,
    );
    const spentRows = await this.forecast.spentBetween({ workspaceId: input.workspaceId, from, to: today });
    for (const r of ready) {
      const code = r.block.currency.code;
      const spent = dec(spentRows.find((s) => s.currency === code)?.amount ?? '0');
      const assessment = input.assessments.get(code) as CashFlowRiskAssessment;
      const band = PredictedSpendingBand.compute({
        currency: r.block.currency,
        threshold: assessment.threshold,
        main: r.block.series,
        periods: r.periods,
        spent,
      });
      byCurrency.set(code, {
        status: 'AVAILABLE',
        reason: null,
        forecastRunId: latest.run?.id ?? null,
        generatedAt: latest.generatedAt,
        stale: latest.stale,
        intervalLevel: '0.8',
        series: band.series.map((p) => ({
          date: p.date,
          expected: p.expected.toJSON(),
          high: p.high.toJSON(),
          low: p.low.toJSON(),
        })),
        lowest: {
          expected: { amount: band.lowest.expected.amount.toJSON(), date: band.lowest.expected.date },
          high: { amount: band.lowest.high.amount.toJSON(), date: band.lowest.high.date },
        },
        shortfallLikelihood: band.shortfallLikelihood,
        firstShortfallDate: band.firstShortfallDate,
      });
    }
    return { byCurrency, latest };
  }
}

/**
 * Probabilidad de déficit del Home (Q8): la moneda con la probabilidad más alta (`LIKELY` > `POSSIBLE` > `UNLIKELY`;
 * empate por código), con su fecha. `null` sin banda en ninguna moneda.
 */
export function predictedShortfallOf(
  byCurrency: ReadonlyMap<string, PredictedCashFlowDto>,
): CashFlowHomeBlockDto['predictedShortfall'] {
  let best: { currency: string; p: PredictedCashFlowDto } | null = null;
  for (const [currency, p] of [...byCurrency].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (p.shortfallLikelihood === 'NOT_AVAILABLE') continue;
    if (
      best === null ||
      LIKELIHOOD_ORDER[p.shortfallLikelihood] >
        LIKELIHOOD_ORDER[best.p.shortfallLikelihood as keyof typeof LIKELIHOOD_ORDER]
    ) {
      best = { currency, p };
    }
  }
  if (!best || best.p.shortfallLikelihood === 'NOT_AVAILABLE') return null;
  return { currency: best.currency, likelihood: best.p.shortfallLikelihood, date: best.p.firstShortfallDate };
}

/**
 * Gasto esperado del periodo del Home (Q3): el punto de `TOTAL_EXPENSE` cuyo rango coincide con el periodo del resumen
 * (valor esperado = conocidos + variable, con el intervalo del 80 %). `null` si no hay pronóstico de ese periodo.
 */
export function expectedSpendingOf(
  latest: LatestForecastDto | null,
  period: { readonly from: string; readonly to: string },
): NonNullable<ReportSummaryDto['forecast']> | null {
  if (!latest || latest.status !== 'AVAILABLE' || !latest.generatedAt) return null;
  const total = latest.series.find((s) => s.scope === 'TOTAL_EXPENSE' && s.points.length > 0);
  const point = total?.points.find((p) => p.periodStart === period.from && p.periodEnd === period.to);
  if (!point) return null;
  return {
    expectedSpending: {
      period: point.period,
      prediction: point.prediction,
      interval80: point.interval80,
      generatedAt: latest.generatedAt,
      stale: latest.stale,
    },
  };
}
