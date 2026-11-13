import { FlowValuation, LocalDate, Money, currency, type FlowRates } from '@pf/shared-kernel';
import {
  ForecastRequestBuilder,
  ForecastResultValidator,
  PeriodSeriesBuilder,
  ReadinessGate,
  FORECAST_GENERATED_EVENT_TYPE,
  type EvaluatedSeries,
  type FailureReason,
  type ForecastRequestV1,
  type ForecastResponseV1,
  type ForecastRun,
} from '../domain/index.js';
import { FORECAST_GENERATED_EVENT } from '../contracts/index.js';
import { ForecastServiceError, type ForecastingDeps, type RunRef, type StoredSeries } from './ports.js';
import { datasetSnapshotId, seededRandom } from './snapshot.js';
import { runChanges, runEntry, runSteps } from './support.js';

export type RunnerOutcome =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'RECOVERED'; readonly runId: string }
  | { readonly kind: 'COMPLETED' | 'INSUFFICIENT_DATA' | 'RETRY' | 'FAILED'; readonly runId: string };

interface Prepared {
  readonly asOfPeriod: string | null;
  readonly currency: string;
  readonly scale: number;
  readonly evaluated: readonly EvaluatedSeries[];
  readonly truncated: boolean;
}

const METRIC_REASON = {
  SERVICE_UNAVAILABLE: 'unavailable',
  SERVICE_REJECTED: 'rejected',
  TIMEOUT: 'timeout',
  INVALID_OUTPUT: 'invalid_output',
} as const;

const scaleOfText = (amount: string): number => {
  const dot = amount.indexOf('.');
  return dot < 0 ? 0 : amount.length - dot - 1;
};

const secondsSince = (startedAt: string | null, now: string): number =>
  startedAt ? Math.max(0, (Date.parse(now) - Date.parse(startedAt)) / 1000) : 0;

/**
 * `ExecuteForecastRun` (job `forecasting.runner`; openspec add-ml-forecasting-service, decisión 12). UNA corrida por
 * pasada y por pasos, sin retener ninguna conexión mientras se espera al servicio:
 *   1. UoW de reclamo (`REQUESTED → RUNNING`, `FOR UPDATE SKIP LOCKED`) y recorrido.
 *   2. Lectura: series por periodo financiero y preparación (UoW de solo lectura, ya cerrada al llamar al servicio).
 *   3. Llamada al servicio, SIN unidad de trabajo, y validación del resultado.
 *   4. UoW de publicación: series y puntos, `COMPLETED` (o `INSUFFICIENT_DATA`), reemplazo de la vigente, hecho en el
 *      outbox y recorrido; o, ante un error de transporte, reintento con espera creciente / falla.
 * Una corrida `RUNNING` colgada (caída del worker) vuelve a `REQUESTED` como un intento fallido.
 */
export class ExecuteForecastRun {
  constructor(private readonly deps: ForecastingDeps) {}

  async runOnce(): Promise<RunnerOutcome> {
    const { deps } = this;
    const now = deps.clock.now();
    const stalledBefore = now.plusMillis(-deps.settings.retry.stallMs).toString();
    const refs = await deps.maintenance.dueRuns(now.toString(), stalledBefore, 10);
    for (const ref of refs) {
      const recovered = await this.recoverStalled(ref, stalledBefore);
      if (recovered) return { kind: 'RECOVERED', runId: recovered };
    }
    for (const ref of refs) {
      const outcome = await this.process(ref);
      if (outcome) return outcome;
    }
    return { kind: 'IDLE' };
  }

  /** `RUNNING` sin progreso: vuelve a `REQUESTED` (o falla si agotó los intentos). */
  private async recoverStalled(ref: RunRef, stalledBeforeIso: string): Promise<string | null> {
    const { deps } = this;
    return deps.uow.run(ref.workspaceId, async () => {
      const [run] = (await deps.runs.claimStalled(ref.workspaceId, stalledBeforeIso)).filter(
        (r) => r.id === ref.runId,
      );
      if (!run) return null;
      await this.failAttempt(run, 'TIMEOUT');
      return run.id;
    });
  }

  private async process(ref: RunRef): Promise<RunnerOutcome | null> {
    const { deps } = this;
    const { workspaceId } = ref;
    const claimed = await deps.uow.run(workspaceId, async () => {
      const now = deps.clock.now().toString();
      const run = await deps.runs.claimNext(workspaceId, now);
      if (!run || run.id !== ref.runId) return null;
      const before = run.version;
      run.start(now);
      if (!(await deps.runs.save(run, before))) return null;
      await deps.lifecycle.record(runEntry(run, 'started', []), runSteps(run));
      await deps.operations.update(workspaceId, run.id, { status: 'RUNNING', progressPct: 10 });
      return run.snapshot;
    });
    if (!claimed) return null;
    const runId = claimed.id;

    // Lectura y preparación (transacción cerrada antes de llamar al servicio).
    const prepared = await deps.uow.run(workspaceId, () => this.prepare(workspaceId));
    const sendable = prepared.evaluated.filter((s) => s.readiness !== 'INSUFFICIENT');
    if (sendable.length === 0) {
      await deps.uow.run(workspaceId, () => this.finishNoData(workspaceId, runId, prepared));
      return { kind: 'INSUFFICIENT_DATA', runId };
    }
    const { request, refs } = ForecastRequestBuilder.build({
      requestId: deps.ids.next(),
      seed: 42,
      series: prepared.evaluated,
      currency: prepared.currency,
      scale: prepared.scale,
      random: seededRandom(runId),
    });
    let response: ForecastResponseV1;
    try {
      response = await deps.service.forecast(request);
    } catch (err) {
      const reason: FailureReason = err instanceof ForecastServiceError ? err.reason : 'SERVICE_UNAVAILABLE';
      const outcome = await deps.uow.run(workspaceId, () =>
        this.finishFailedAttempt(workspaceId, runId, reason),
      );
      return { kind: outcome === 'FAIL' ? 'FAILED' : 'RETRY', runId };
    }
    const outcome = await deps.uow.run(workspaceId, () =>
      this.finishComplete(workspaceId, runId, prepared, request, refs, response),
    );
    return { kind: outcome, runId };
  }

  private async prepare(workspaceId: string): Promise<Prepared> {
    const { deps } = this;
    const ws = await deps.settingsOf.settingsOf(workspaceId);
    const target = currency(ws.reportingCurrency, ws.reportingScale);
    const now = deps.clock.now();
    const today = LocalDate.ofInstant(now, ws.timeZone);
    const range = PeriodSeriesBuilder.queryRange(today, ws.startDay, deps.settings.historyMaxPeriods);
    if (!range)
      return {
        asOfPeriod: null,
        currency: target.code,
        scale: target.scale,
        evaluated: [],
        truncated: false,
      };
    const rows = await deps.flows.loadFlows(workspaceId, range.dateFrom, range.dateTo);
    const rates: FlowRates<unknown> = await FlowValuation.resolveRates({
      flows: rows
        .filter((r) => r.amount.currency !== target.code)
        .map((r) => ({
          date: r.businessDate,
          amount: Money.parse(r.amount.amount, r.amount.currency, scaleOfText(r.amount.amount)),
        })),
      target,
      timeZone: ws.timeZone,
      now,
      windowDays: deps.settings.rateValidityWindowDays,
      resolve: (input) => deps.rates.resolve(workspaceId, input),
      keyOf: (r) => JSON.stringify(r),
    });
    const history = PeriodSeriesBuilder.build({
      rows,
      today,
      startDay: ws.startDay,
      maxPeriods: deps.settings.historyMaxPeriods,
      target,
      rateFor: (code, date) => rates.rateFor(code, date),
    });
    const gaps = ReadinessGate.applyGaps(history.periods);
    const catalog = await deps.categories.catalog(workspaceId);
    const evaluated = ReadinessGate.evaluate({
      periods: gaps.periods,
      categories: catalog.categories,
      groups: catalog.groups,
      thresholds: deps.settings.thresholds,
      truncated: gaps.truncated,
    });
    return {
      asOfPeriod: history.lastFinished,
      currency: target.code,
      scale: target.scale,
      evaluated,
      truncated: gaps.truncated,
    };
  }

  private storedFor(
    runId: string,
    workspaceId: string,
    prepared: Prepared,
    refs: ReadonlyMap<string, string>,
    response: ForecastResponseV1 | null,
    requested: ForecastRequestV1 | null,
  ): {
    stored: StoredSeries[];
    published: number;
    invalid: number;
    insufficient: number;
    versions: string[];
  } {
    const { deps } = this;
    const byRef = new Map((response?.results ?? []).map((r) => [r.ref, r]));
    const requestedByRef = new Map((requested?.series ?? []).map((s) => [s.ref, s]));
    const stored: StoredSeries[] = [];
    const versions = new Set<string>();
    let published = 0;
    let invalid = 0;
    let insufficient = 0;
    for (const s of prepared.evaluated) {
      const key = `${s.scope}:${s.scopeRef ?? ''}`;
      const ref = refs.get(key) ?? `x${stored.length + 1}`;
      const base = {
        id: deps.ids.next(),
        runId,
        workspaceId,
        opaqueRef: ref,
        scope: s.scope,
        scopeRef: s.scopeRef,
        name: s.name,
        currency: prepared.currency,
        scale: prepared.scale,
        readiness: s.readiness,
        historyFrom: s.historyFrom,
        historyTo: s.historyTo,
        historyPeriods: s.points.length,
        groupedCategoryIds: s.groupedCategoryIds,
      };
      if (s.readiness === 'INSUFFICIENT') {
        insufficient += 1;
        stored.push({
          ...base,
          readinessReasons: s.readinessReasons,
          modelName: null,
          modelVersion: null,
          baselineMethod: null,
          baselineN: null,
          status: 'INSUFFICIENT',
          points: [],
        });
        continue;
      }
      const result = byRef.get(ref);
      const req = requestedByRef.get(ref);
      const verdict = result && req ? ForecastResultValidator.validate(req, result) : { ok: false as const };
      if (!result || !req || !verdict.ok || !result.model || !result.baseline) {
        invalid += 1;
        stored.push({
          ...base,
          readinessReasons: [
            ...s.readinessReasons,
            { code: 'INVALID_OUTPUT', missingForSimple: null, missingForModel: null },
          ],
          modelName: null,
          modelVersion: null,
          baselineMethod: null,
          baselineN: null,
          status: 'INVALID',
          points: [],
        });
        continue;
      }
      published += 1;
      versions.add(`${result.model.name}@${result.model.version}`);
      stored.push({
        ...base,
        readinessReasons: s.readinessReasons,
        modelName: result.model.name,
        modelVersion: result.model.version,
        baselineMethod: result.baseline.method,
        baselineN: result.baseline.n,
        status: 'PUBLISHED',
        points: result.points,
      });
    }
    return { stored, published, invalid, insufficient, versions: [...versions].sort() };
  }

  private async finishComplete(
    workspaceId: string,
    runId: string,
    prepared: Prepared,
    request: ForecastRequestV1,
    refs: ReadonlyMap<string, string>,
    response: ForecastResponseV1,
  ): Promise<'COMPLETED' | 'FAILED'> {
    const { deps } = this;
    const run = await deps.runs.findById(workspaceId, runId);
    if (!run || run.status !== 'RUNNING') return 'FAILED';
    const now = deps.clock.now().toString();
    const startedAt = run.snapshot.startedAt;
    const { stored, published, invalid, insufficient, versions } = this.storedFor(
      runId,
      workspaceId,
      prepared,
      refs,
      response,
      request,
    );
    const before = run.snapshot;
    const previous = published === 0 ? null : await deps.runs.latestCompleted(workspaceId, { lock: true });
    if (published === 0) {
      // Ninguna serie válida: la corrida falla sin reintento (no es un problema de transporte) y se conserva el detalle.
      run.failNow('INVALID_OUTPUT', now);
      await this.save(run, before.version);
      await deps.series.insertAll(stored);
      await deps.lifecycle.record(
        runEntry(run, 'failed', runChanges(before, run.snapshot)),
        runSteps(run, [], 'INVALID_OUTPUT'),
      );
      await deps.operations.update(workspaceId, runId, {
        status: 'FAILED',
        progressPct: 100,
        error: { code: 'INVALID_OUTPUT' },
      });
      deps.metrics.failure('invalid_output');
      deps.metrics.observeDuration('failed', secondsSince(startedAt, now));
      return 'FAILED';
    }
    run.complete({
      at: now,
      asOfPeriod: prepared.asOfPeriod ?? '',
      datasetSnapshotId: datasetSnapshotId(request),
      serviceVersion: response.serviceVersion,
      seriesPublished: published,
      seriesInsufficient: insufficient,
      seriesInvalid: invalid,
    });
    await this.save(run, before.version);
    await deps.series.insertAll(stored);
    const eventId = deps.ids.next();
    await deps.outbox.append({
      eventId,
      eventType: FORECAST_GENERATED_EVENT.type,
      eventVersion: FORECAST_GENERATED_EVENT.version,
      occurredAt: now,
      workspaceId,
      aggregateType: 'ForecastRun',
      aggregateId: runId,
      aggregateVersion: run.version,
      actor: { type: 'SYSTEM', id: 'forecasting.runner' },
      payload: {
        forecastRunId: runId,
        trigger: run.snapshot.trigger,
        asOfPeriod: prepared.asOfPeriod ?? '',
        generatedAt: now,
        reportingCurrency: prepared.currency,
        seriesPublished: published,
        seriesInsufficient: insufficient,
        modelVersions: versions,
      },
    });
    await deps.lifecycle.record(
      runEntry(run, 'completed', runChanges(before, run.snapshot)),
      runSteps(run, [{ eventId, eventType: FORECAST_GENERATED_EVENT_TYPE }]),
    );
    // La corrida completada anterior queda reemplazada: el vigente es siempre el de la completada más reciente.
    if (previous && previous.id !== runId) {
      const previousVersion = previous.version;
      previous.supersede(runId, now);
      await this.save(previous, previousVersion);
      await deps.lifecycle.record(runEntry(previous, 'superseded', []), runSteps(previous));
    }
    await deps.operations.update(workspaceId, runId, { status: 'SUCCEEDED', progressPct: 100 });
    deps.metrics.observeDuration('completed', secondsSince(startedAt, now));
    deps.metrics.insufficient(insufficient);
    return 'COMPLETED';
  }

  private async finishNoData(workspaceId: string, runId: string, prepared: Prepared): Promise<void> {
    const { deps } = this;
    const run = await deps.runs.findById(workspaceId, runId);
    if (!run || run.status !== 'RUNNING') return;
    const now = deps.clock.now().toString();
    const startedAt = run.snapshot.startedAt;
    const before = run.snapshot;
    const { stored, insufficient } = this.storedFor(runId, workspaceId, prepared, new Map(), null, null);
    run.noData({ at: now, asOfPeriod: prepared.asOfPeriod, seriesInsufficient: insufficient });
    await this.save(run, before.version);
    await deps.series.insertAll(stored);
    await deps.lifecycle.record(runEntry(run, 'no_data', runChanges(before, run.snapshot)), runSteps(run));
    await deps.operations.update(workspaceId, runId, { status: 'SUCCEEDED', progressPct: 100 });
    deps.metrics.insufficient(insufficient);
    deps.metrics.observeDuration('insufficient_data', secondsSince(startedAt, now));
  }

  private async finishFailedAttempt(
    workspaceId: string,
    runId: string,
    reason: FailureReason,
  ): Promise<'RETRY' | 'FAIL'> {
    const run = await this.deps.runs.findById(workspaceId, runId);
    if (!run || run.status !== 'RUNNING') return 'FAIL';
    return this.failAttempt(run, reason);
  }

  private async failAttempt(run: ForecastRun, reason: FailureReason): Promise<'RETRY' | 'FAIL'> {
    const { deps } = this;
    const now = deps.clock.now().toString();
    const startedAt = run.snapshot.startedAt;
    const before = run.snapshot;
    const outcome = run.failAttempt(reason, now, deps.settings.retry);
    await this.save(run, before.version);
    await deps.lifecycle.record(
      runEntry(run, outcome === 'FAIL' ? 'failed' : 'retried', runChanges(before, run.snapshot)),
      runSteps(run, [], reason),
    );
    if (outcome === 'FAIL') {
      await deps.operations.update(run.workspaceId, run.id, {
        status: 'FAILED',
        progressPct: 100,
        error: { code: reason },
      });
      deps.metrics.failure(METRIC_REASON[reason]);
      deps.metrics.observeDuration('failed', secondsSince(startedAt, now));
    } else {
      await deps.operations.update(run.workspaceId, run.id, { status: 'PENDING', progressPct: 0 });
      deps.metrics.observeDuration('retry', secondsSince(startedAt, now));
    }
    return outcome;
  }

  private async save(run: ForecastRun, expectedVersion: number): Promise<void> {
    if (!(await this.deps.runs.save(run, expectedVersion))) {
      throw new Error('forecast run was modified concurrently');
    }
  }
}
