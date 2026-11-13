import type { LifecycleDto } from '@pf/audit/contracts';
import { DomainError, PeriodCalendar, type PeriodLabel } from '@pf/shared-kernel';
import {
  FORECAST_DISCLAIMER_KEY,
  type ForecastDriverDto,
  type ForecastKnownItemsDto,
  type ForecastPointDto,
  type ForecastRunDto,
  type ForecastRunStatusDto,
  type ForecastRunSummaryDto,
  type ForecastScopeDto,
  type ForecastSeriesDto,
  type ForecastSeriesSummaryDto,
  type LatestForecastDto,
  type LatestForecastQuery,
} from '../contracts/index.js';
import {
  FORECAST_RUN_LIFECYCLE,
  FORECAST_RUN_STATUSES,
  ForecastComposer,
  SERIES_SCOPES,
  type ForecastRun,
} from '../domain/index.js';
import type { ForecastingDeps, StoredSeries } from './ports.js';

export const HORIZONS = [1, 3, 6, 12] as const;
export type Horizon = (typeof HORIZONS)[number];
const DAY_MS = 86_400_000;

const summaryOf = (run: ForecastRun): ForecastRunSummaryDto => {
  const s = run.snapshot;
  return {
    id: s.id,
    trigger: s.trigger,
    status: s.status,
    requestedAt: s.requestedAt,
    requestedBy: s.requestedBy,
    completedAt: s.completedAt,
    asOfPeriod: s.asOfPeriod,
    attempts: s.attempts,
    failureReason: s.failureReason,
    seriesCount: {
      published: s.seriesPublished,
      insufficient: s.seriesInsufficient,
      invalid: s.seriesInvalid,
    },
  };
};

const seriesSummary = (s: StoredSeries): ForecastSeriesSummaryDto => ({
  scope: s.scope,
  scopeRef: s.scopeRef,
  name: s.name,
  readiness: s.readiness,
  readinessReasons: s.readinessReasons,
  historyFrom: s.historyFrom,
  historyTo: s.historyTo,
  historyPeriods: s.historyPeriods,
  groupedCategoryIds: s.groupedCategoryIds,
});

/** Consultas de FORECAST: pronóstico vigente, corridas y recorrido. Lectura en la transacción de la petición. */
export class ForecastQueries implements LatestForecastQuery {
  constructor(private readonly deps: ForecastingDeps) {}

  async getLatest(input: {
    readonly workspaceId: string;
    readonly scopes?: readonly ForecastScopeDto[];
    readonly scopeRef?: string;
    readonly horizon?: number;
  }): Promise<LatestForecastDto> {
    const { deps } = this;
    const horizon = input.horizon ?? 12;
    if (!(HORIZONS as readonly number[]).includes(horizon)) {
      throw new DomainError('INVALID_FILTER', 'horizon must be 1, 3, 6 or 12').at('/horizon');
    }
    return deps.uow.run(input.workspaceId, async () => {
      const ws = await deps.settingsOf.settingsOf(input.workspaceId);
      const empty = (status: 'NONE' | 'DISABLED'): LatestForecastDto => ({
        status,
        stale: false,
        lastAttempt: null,
        run: null,
        reportingCurrency: ws.reportingCurrency,
        generatedAt: null,
        series: [],
        disclaimerKey: FORECAST_DISCLAIMER_KEY,
        meta: { conversion: null },
      });
      if (!deps.settings.enabled) return empty('DISABLED');
      const run = await deps.runs.latestCompleted(input.workspaceId);
      if (!run) {
        const attempt = await deps.runs.latestAttempt(input.workspaceId);
        return {
          ...empty('NONE'),
          lastAttempt: attempt ? this.attemptOf(attempt) : null,
          stale: attempt?.status === 'FAILED',
        };
      }
      const attempt = await deps.runs.latestAttempt(input.workspaceId);
      const generatedAt = run.snapshot.completedAt as string;
      const ageMs = deps.clock.now().epochMillis - Date.parse(generatedAt);
      const newerFailed = attempt !== null && attempt.id !== run.id && attempt.status === 'FAILED';
      const rows = await deps.series.listByRun(input.workspaceId, run.id);
      const wanted = rows.filter(
        (s) =>
          s.status !== 'INVALID' &&
          (!input.scopes || input.scopes.length === 0 || input.scopes.includes(s.scope)) &&
          (input.scopeRef === undefined || s.scopeRef === input.scopeRef),
      );
      const gaps = this.coherenceGaps(rows);
      const series: ForecastSeriesDto[] = wanted.map((s) => ({
        ...seriesSummary(s),
        currency: s.currency,
        model: s.modelName
          ? {
              name: s.modelName,
              version: s.modelVersion ?? '',
              selectedBy: s.selectedBy,
              mase: s.mase,
              baselineMase: s.baselineMase,
            }
          : null,
        confidence: s.confidence,
        points: s.points
          .filter((p) => p.monthsAhead <= horizon)
          .map((p) =>
            this.pointOf(p, s, ws.startDay, s.scope === 'TOTAL_EXPENSE' ? gaps.get(p.period) : undefined),
          ),
      }));
      const metadata = await deps.series.runMetadata(input.workspaceId, run.id);
      return {
        status: 'AVAILABLE',
        stale: ageMs > deps.settings.staleDays * DAY_MS || newerFailed,
        lastAttempt: attempt && attempt.id !== run.id ? this.attemptOf(attempt) : null,
        run: summaryOf(run),
        reportingCurrency: run.snapshot.reportingCurrency,
        generatedAt,
        series,
        disclaimerKey: FORECAST_DISCLAIMER_KEY,
        meta: { conversion: metadata?.conversion ?? null },
      };
    });
  }

  /**
   * Diferencia entre las categorías y el total por periodo (decisión 14): total − Σ de las series que particionan el
   * gasto (categorías y «Otras categorías»); solo los periodos que superan el umbral.
   */
  private coherenceGaps(rows: readonly StoredSeries[]): Map<string, string> {
    const total = rows.find((s) => s.scope === 'TOTAL_EXPENSE' && s.status === 'PUBLISHED');
    const out = new Map<string, string>();
    if (!total) return out;
    const leaves = rows.filter(
      (s) => (s.scope === 'CATEGORY' || s.scope === 'OTHER_CATEGORIES') && s.status === 'PUBLISHED',
    );
    if (leaves.length === 0) return out;
    for (const p of total.points) {
      const parts = leaves.flatMap((l) =>
        l.points.filter((x) => x.period === p.period).map((x) => x.prediction),
      );
      if (parts.length === 0) continue;
      const g = ForecastComposer.coherenceGap({
        total: p.prediction,
        categories: parts,
        scale: total.scale,
        ratio: this.deps.settings.coherenceGapRatio,
      });
      if (g.exceeds) out.set(p.period, g.gap);
    }
    return out;
  }

  /** `GET W/forecasts/latest/known-items`: los conocidos de un periodo de una serie del pronóstico vigente. */
  async listKnownItems(input: {
    readonly workspaceId: string;
    readonly scope: string;
    readonly scopeRef?: string;
    readonly period: string;
  }): Promise<ForecastKnownItemsDto> {
    const { deps } = this;
    if (!(SERIES_SCOPES as readonly string[]).includes(input.scope)) {
      throw new DomainError('INVALID_FILTER', 'unknown scope').at('/scope');
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
      throw new DomainError('INVALID_FILTER', 'period must be YYYY-MM').at('/period');
    }
    return deps.uow.run(input.workspaceId, async () => {
      const run = deps.settings.enabled ? await deps.runs.latestCompleted(input.workspaceId) : null;
      if (!run) return { items: [] };
      const rows = await deps.series.listKnownItems(
        input.workspaceId,
        run.id,
        { scope: input.scope as StoredSeries['scope'], scopeRef: input.scopeRef ?? null },
        input.period,
      );
      return {
        items: rows.map((k) => ({
          date: k.date,
          label: k.label,
          kind: k.kind,
          amountType: k.amountType,
          amount: k.amount === null ? null : { amount: k.amount, currency: k.currency },
          originalAmount: k.originalAmount,
          managedBy: k.managedBy,
          sourceRef: k.source,
        })),
      };
    });
  }

  private attemptOf(run: ForecastRun): NonNullable<LatestForecastDto['lastAttempt']> {
    const s = run.snapshot;
    return { status: s.status, at: s.completedAt ?? s.requestedAt, failureReason: s.failureReason };
  }

  private pointOf(
    p: StoredSeries['points'][number],
    s: StoredSeries,
    startDay: number,
    gap?: string,
  ): ForecastPointDto {
    const money = (amount: string) => ({ amount, currency: s.currency });
    const driverMoney = (v: string | null) => (v === null ? null : money(v));
    const drivers: ForecastDriverDto[] | null = p.drivers
      ? p.drivers.map((d) => ({
          type: d.type,
          value: driverMoney(d.value),
          effect: driverMoney(d.effect),
          periods: d.periods,
          refCount: d.refCount,
        }))
      : null;
    const components =
      p.knownFuture !== null &&
      p.predictedVariable !== null &&
      p.variableLower80 !== null &&
      p.variableUpper80 !== null
        ? {
            knownFuture: money(p.knownFuture),
            predictedVariable: money(p.predictedVariable),
            predictedVariableInterval80: { lower: money(p.variableLower80), upper: money(p.variableUpper80) },
            knownWithoutAmountCount: p.knownBlankCount,
          }
        : null;
    const range = PeriodCalendar.rangeFor(p.period as PeriodLabel, startDay);
    return {
      period: p.period,
      periodStart: range.start.toString(),
      periodEnd: range.end.toString(),
      monthsAhead: p.monthsAhead,
      prediction: money(p.prediction),
      interval80: { lower: money(p.lower80), upper: money(p.upper80) },
      interval95: { lower: money(p.lower95), upper: money(p.upper95) },
      baseline: { method: s.baselineMethod ?? 'MEAN_LAST_N', n: s.baselineN, value: money(p.baselineValue) },
      components,
      drivers,
      coherenceGap: gap === undefined ? null : money(gap),
    };
  }

  async listRuns(input: {
    readonly workspaceId: string;
    readonly statuses?: readonly string[];
    readonly cursor?: { readonly requestedAt: string; readonly id: string };
    readonly limit: number;
  }): Promise<{ items: ForecastRunSummaryDto[]; nextCursor: { requestedAt: string; id: string } | null }> {
    const { deps } = this;
    const statuses = (input.statuses ?? []).map((s) => {
      if (!(FORECAST_RUN_STATUSES as readonly string[]).includes(s)) {
        throw new DomainError('INVALID_FILTER', 'unknown status').at('/status');
      }
      return s as ForecastRunStatusDto;
    });
    return deps.uow.run(input.workspaceId, async () => {
      const rows = await deps.runs.list(input.workspaceId, {
        ...(statuses.length ? { statuses } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: input.limit + 1,
      });
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      return {
        items: page.map(summaryOf),
        nextCursor:
          rows.length > input.limit && last ? { requestedAt: last.snapshot.requestedAt, id: last.id } : null,
      };
    });
  }

  async getRun(input: { readonly workspaceId: string; readonly runId: string }): Promise<ForecastRunDto> {
    const { deps } = this;
    return deps.uow.run(input.workspaceId, async () => {
      const run = await deps.runs.findById(input.workspaceId, input.runId);
      if (!run) throw new DomainError('RESOURCE_NOT_FOUND', 'forecast run not found');
      const rows = await deps.series.listByRun(input.workspaceId, run.id);
      return {
        ...summaryOf(run),
        datasetSnapshotId: run.snapshot.datasetSnapshotId,
        serviceVersion: run.snapshot.serviceVersion,
        reportingCurrency: run.snapshot.reportingCurrency,
        series: rows.map(seriesSummary),
      };
    });
  }

  /** Recorrido de la corrida (`GET …/forecasts/{runId}/lifecycle`). */
  async lifecycle(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly runId: string;
  }): Promise<LifecycleDto> {
    const { deps } = this;
    if (!deps.lifecycleQuery) throw new DomainError('INTERNAL_ERROR', 'lifecycle query is not composed');
    const query = deps.lifecycleQuery;
    return deps.uow.run(input.workspaceId, async () => {
      const run = await deps.runs.findById(input.workspaceId, input.runId);
      if (!run) throw new DomainError('RESOURCE_NOT_FOUND', 'forecast run not found');
      return query.lifecycleOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateType: FORECAST_RUN_LIFECYCLE.aggregateType as 'ForecastRun',
        aggregateId: run.id,
        currentState: run.status,
      });
    });
  }
}
