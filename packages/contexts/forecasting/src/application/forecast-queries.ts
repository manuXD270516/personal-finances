import type { LifecycleDto } from '@pf/audit/contracts';
import { DomainError, PeriodCalendar, type PeriodLabel } from '@pf/shared-kernel';
import {
  FORECAST_DISCLAIMER_KEY,
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
import { FORECAST_RUN_LIFECYCLE, FORECAST_RUN_STATUSES, type ForecastRun } from '../domain/index.js';
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
      const series: ForecastSeriesDto[] = wanted.map((s) => ({
        ...seriesSummary(s),
        currency: s.currency,
        model: s.modelName ? { name: s.modelName, version: s.modelVersion ?? '' } : null,
        points: s.points.filter((p) => p.monthsAhead <= horizon).map((p) => this.pointOf(p, s, ws.startDay)),
      }));
      return {
        status: 'AVAILABLE',
        stale: ageMs > deps.settings.staleDays * DAY_MS || newerFailed,
        lastAttempt: attempt && attempt.id !== run.id ? this.attemptOf(attempt) : null,
        run: summaryOf(run),
        reportingCurrency: run.snapshot.reportingCurrency,
        generatedAt,
        series,
        disclaimerKey: FORECAST_DISCLAIMER_KEY,
      };
    });
  }

  private attemptOf(run: ForecastRun): NonNullable<LatestForecastDto['lastAttempt']> {
    const s = run.snapshot;
    return { status: s.status, at: s.completedAt ?? s.requestedAt, failureReason: s.failureReason };
  }

  private pointOf(p: StoredSeries['points'][number], s: StoredSeries, startDay: number): ForecastPointDto {
    const money = (amount: string) => ({ amount, currency: s.currency });
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
