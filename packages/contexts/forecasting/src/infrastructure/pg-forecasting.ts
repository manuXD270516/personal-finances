import { PgUnitOfWork, currentRequestContext, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { dec } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import { ForecastRun, type ForecastRunState, type ForecastRunStatus } from '../domain/index.js';
import type {
  IdGenerator,
  ListRunsFilter,
  MaintenancePort,
  OperationPort,
  RunRef,
  RunRepository,
  RunMetadata,
  SeriesRepository,
  StoredKnownItem,
  StoredPoint,
  StoredSeries,
  UnitOfWork,
} from '../application/ports.js';

const db = () => unitOfWorkKysely<Record<string, never>>();
const isoText = (col: string): string =>
  `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const ISO = (col: string) => sql.raw(isoText(col));

/** Unidad de trabajo de FORECAST: transacción PG con el contexto RLS del workspace; reutiliza la del llamador. */
export class PgForecastingUnitOfWork implements UnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const actor = currentRequestContext()?.actor;
    return this.uow.run({ userId: actor && actor.type === 'USER' ? actor.userId : null, workspaceId }, fn);
  }

  /** Transacción SIN workspace (barridos como `pf_maintenance`). */
  runSystem<T>(fn: () => Promise<T>): Promise<T> {
    return this.uow.run({ userId: null, workspaceId: null }, fn);
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };

// ───────────────────────────────────────────────────────────── corridas

interface RunRow {
  id: string;
  workspace_id: string;
  trigger: ForecastRunState['trigger'];
  status: ForecastRunStatus;
  requested_by: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  as_of_period: string | null;
  reporting_currency: string;
  attempts: number;
  next_attempt_at: string;
  failure_reason: ForecastRunState['failureReason'];
  dataset_snapshot_id: string | null;
  service_version: string | null;
  superseded_by: string | null;
  series_published: number;
  series_insufficient: number;
  series_invalid: number;
  version: number;
}

const RUN_COLUMNS = sql.raw(`id, workspace_id, trigger, status, requested_by,
  ${isoText('requested_at')} AS requested_at, ${isoText('started_at')} AS started_at,
  ${isoText('completed_at')} AS completed_at, as_of_period, reporting_currency, attempts,
  ${isoText('next_attempt_at')} AS next_attempt_at, failure_reason, dataset_snapshot_id, service_version,
  superseded_by, series_published, series_insufficient, series_invalid, version`);

const toRun = (r: RunRow): ForecastRun =>
  ForecastRun.restore({
    id: r.id,
    workspaceId: r.workspace_id,
    trigger: r.trigger,
    status: r.status,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    asOfPeriod: r.as_of_period,
    reportingCurrency: r.reporting_currency,
    attempts: Number(r.attempts),
    nextAttemptAt: r.next_attempt_at,
    failureReason: r.failure_reason,
    datasetSnapshotId: r.dataset_snapshot_id,
    serviceVersion: r.service_version,
    supersededBy: r.superseded_by,
    seriesPublished: Number(r.series_published),
    seriesInsufficient: Number(r.series_insufficient),
    seriesInvalid: Number(r.series_invalid),
    version: Number(r.version),
  });

export class PgRunRepository implements RunRepository {
  async insertIfNoActive(run: ForecastRun): Promise<boolean> {
    const s = run.snapshot;
    // El índice único parcial (una activa por workspace) resuelve la carrera sin abortar la transacción.
    const { rows } = await sql<{ id: string }>`
      INSERT INTO forecasting.forecast_run (id, workspace_id, trigger, status, requested_by, requested_at,
        reporting_currency, attempts, next_attempt_at, version)
      VALUES (${s.id}, ${s.workspaceId}, ${s.trigger}, ${s.status}, ${s.requestedBy}, ${s.requestedAt}::timestamptz,
        ${s.reportingCurrency}, ${s.attempts}, ${s.nextAttemptAt}::timestamptz, ${s.version})
      ON CONFLICT (workspace_id) WHERE status IN ('REQUESTED', 'RUNNING') DO NOTHING
      RETURNING id`.execute(db());
    return rows.length === 1;
  }

  async findById(workspaceId: string, id: string): Promise<ForecastRun | null> {
    const { rows } = await sql<RunRow>`
      SELECT ${RUN_COLUMNS} FROM forecasting.forecast_run WHERE workspace_id = ${workspaceId} AND id = ${id}`.execute(
      db(),
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async claimNext(workspaceId: string, nowIso: string): Promise<ForecastRun | null> {
    const { rows } = await sql<RunRow>`
      SELECT ${RUN_COLUMNS} FROM forecasting.forecast_run
       WHERE workspace_id = ${workspaceId} AND status = 'REQUESTED' AND next_attempt_at <= ${nowIso}::timestamptz
       ORDER BY requested_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`.execute(db());
    return rows[0] ? toRun(rows[0]) : null;
  }

  async claimStalled(workspaceId: string, beforeIso: string): Promise<readonly ForecastRun[]> {
    const { rows } = await sql<RunRow>`
      SELECT ${RUN_COLUMNS} FROM forecasting.forecast_run
       WHERE workspace_id = ${workspaceId} AND status = 'RUNNING' AND started_at <= ${beforeIso}::timestamptz
       ORDER BY started_at, id FOR UPDATE SKIP LOCKED`.execute(db());
    return rows.map(toRun);
  }

  async save(run: ForecastRun, expectedVersion: number): Promise<boolean> {
    const s = run.snapshot;
    const { rows } = await sql<{ id: string }>`
      UPDATE forecasting.forecast_run SET
        status = ${s.status}, started_at = ${s.startedAt}::timestamptz, completed_at = ${s.completedAt}::timestamptz,
        as_of_period = ${s.asOfPeriod}, attempts = ${s.attempts}, next_attempt_at = ${s.nextAttemptAt}::timestamptz,
        failure_reason = ${s.failureReason}, dataset_snapshot_id = ${s.datasetSnapshotId},
        service_version = ${s.serviceVersion}, superseded_by = ${s.supersededBy},
        series_published = ${s.seriesPublished}, series_insufficient = ${s.seriesInsufficient},
        series_invalid = ${s.seriesInvalid}, version = ${s.version}
       WHERE workspace_id = ${s.workspaceId} AND id = ${s.id} AND version = ${expectedVersion}
       RETURNING id`.execute(db());
    return rows.length === 1;
  }

  async latestCompleted(workspaceId: string, options: { lock?: boolean } = {}): Promise<ForecastRun | null> {
    const lock = options.lock ? sql.raw('FOR UPDATE') : sql.raw('');
    const { rows } = await sql<RunRow>`
      SELECT ${RUN_COLUMNS} FROM forecasting.forecast_run
       WHERE workspace_id = ${workspaceId} AND status = 'COMPLETED'
       ORDER BY completed_at DESC, id DESC LIMIT 1 ${lock}`.execute(db());
    return rows[0] ? toRun(rows[0]) : null;
  }

  async latestAttempt(workspaceId: string): Promise<ForecastRun | null> {
    const { rows } = await sql<RunRow>`
      SELECT ${RUN_COLUMNS} FROM forecasting.forecast_run WHERE workspace_id = ${workspaceId}
       ORDER BY requested_at DESC, id DESC LIMIT 1`.execute(db());
    return rows[0] ? toRun(rows[0]) : null;
  }

  async hasActive(workspaceId: string): Promise<boolean> {
    const { rows } = await sql<{ one: number }>`
      SELECT 1 AS one FROM forecasting.forecast_run
       WHERE workspace_id = ${workspaceId} AND status IN ('REQUESTED', 'RUNNING') LIMIT 1`.execute(db());
    return rows.length > 0;
  }

  async list(workspaceId: string, filter: ListRunsFilter): Promise<readonly ForecastRun[]> {
    const statuses = filter.statuses?.length
      ? sql`AND status = ANY(${sql.raw(`ARRAY[${filter.statuses.map((s) => `'${s}'`).join(',')}]::text[]`)})`
      : sql``;
    const cursor = filter.cursor
      ? sql`AND (requested_at, id) < (${filter.cursor.requestedAt}::timestamptz, ${filter.cursor.id}::uuid)`
      : sql``;
    const { rows } = await sql<RunRow>`
      SELECT ${RUN_COLUMNS} FROM forecasting.forecast_run
       WHERE workspace_id = ${workspaceId} ${statuses} ${cursor}
       ORDER BY requested_at DESC, id DESC LIMIT ${filter.limit}`.execute(db());
    return rows.map(toRun);
  }

  async lastScheduledAt(workspaceId: string): Promise<string | null> {
    const { rows } = await sql<{ at: string }>`
      SELECT ${ISO('requested_at')} AS at FROM forecasting.forecast_run
       WHERE workspace_id = ${workspaceId} AND trigger = 'SCHEDULED'
       ORDER BY requested_at DESC LIMIT 1`.execute(db());
    return rows[0]?.at ?? null;
  }
}

// ───────────────────────────────────────────────────────────── series y puntos

interface SeriesRow {
  id: string;
  run_id: string;
  workspace_id: string;
  opaque_ref: string;
  scope: StoredSeries['scope'];
  scope_ref: string | null;
  name: string;
  currency: string;
  scale: number;
  readiness: StoredSeries['readiness'];
  readiness_reasons: StoredSeries['readinessReasons'];
  history_from: string | null;
  history_to: string | null;
  history_periods: number;
  grouped_category_ids: string[];
  model_name: string | null;
  model_version: string | null;
  baseline_method: string | null;
  baseline_n: number | null;
  status: StoredSeries['status'];
  selected_by: StoredSeries['selectedBy'];
  mase: string | null;
  baseline_mase: string | null;
  coverage_80: string | null;
  confidence: StoredSeries['confidence'];
}

interface PointRow {
  series_id: string;
  period: string;
  months_ahead: number;
  prediction: string;
  lower_80: string;
  upper_80: string;
  lower_95: string;
  upper_95: string;
  baseline_value: string;
  known_future: string | null;
  predicted_variable: string | null;
  variable_lower_80: string | null;
  variable_upper_80: string | null;
  known_without_amount: number;
  drivers: StoredPoint['drivers'];
}

interface KnownItemRow {
  period: string;
  item_date: string;
  label: string;
  kind: StoredKnownItem['kind'];
  amount_type: StoredKnownItem['amountType'];
  amount: string | null;
  currency: string;
  original_amount: string | null;
  original_currency: string | null;
  managed_by: string | null;
  source_context: StoredKnownItem['source']['context'];
  source_id: string;
  category_id: string | null;
}

const scaleOfDecimal = (text: string): number => {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
};

/** Monto de BD (`numeric`) a la escala de su moneda. */
const fixed = (value: string, scale: number): string => dec(value).toFixed(scale);

export class PgSeriesRepository implements SeriesRepository {
  async insertAll(series: readonly StoredSeries[]): Promise<void> {
    // Una sentencia por serie y sus puntos, en orden: nunca consultas en paralelo sobre el mismo cliente.
    for (const s of series) {
      await sql`
        INSERT INTO forecasting.forecast_series (id, workspace_id, run_id, opaque_ref, scope, scope_ref, name, currency,
          scale, readiness, readiness_reasons, history_from, history_to, history_periods, grouped_category_ids,
          model_name, model_version, baseline_method, baseline_n, status, selected_by, mase, baseline_mase, coverage_80,
          confidence)
        VALUES (${s.id}, ${s.workspaceId}, ${s.runId}, ${s.opaqueRef}, ${s.scope}, ${s.scopeRef}, ${s.name}, ${s.currency},
          ${s.scale}, ${s.readiness}, ${JSON.stringify(s.readinessReasons)}::jsonb, ${s.historyFrom}, ${s.historyTo},
          ${s.historyPeriods}, ${sql.raw(`ARRAY[${s.groupedCategoryIds.map((c) => `'${c.replace(/'/g, '')}'`).join(',')}]::uuid[]`)},
          ${s.modelName}, ${s.modelVersion}, ${s.baselineMethod}, ${s.baselineN}, ${s.status}, ${s.selectedBy},
          ${s.mase}::numeric, ${s.baselineMase}::numeric, ${s.coverage80}::numeric, ${s.confidence})`.execute(
        db(),
      );
      if (s.points.length > 0) {
        const values = s.points.map(
          (p) =>
            sql`(${s.id}, ${s.workspaceId}, ${p.period}, ${p.monthsAhead}, ${p.prediction}::numeric, ${p.lower80}::numeric,
              ${p.upper80}::numeric, ${p.lower95}::numeric, ${p.upper95}::numeric, ${p.baselineValue}::numeric,
              ${p.knownFuture}::numeric, ${p.predictedVariable}::numeric, ${p.variableLower80}::numeric,
              ${p.variableUpper80}::numeric, ${p.knownBlankCount}, ${JSON.stringify(p.drivers ?? [])}::jsonb)`,
        );
        await sql`
          INSERT INTO forecasting.forecast_point (series_id, workspace_id, period, months_ahead, prediction, lower_80,
            upper_80, lower_95, upper_95, baseline_value, known_future, predicted_variable, variable_lower_80,
            variable_upper_80, known_without_amount, drivers)
          VALUES ${sql.join(values)}`.execute(db());
      }
      const backtest = s.backtest ?? [];
      if (backtest.length > 0) {
        const values = backtest.map(
          (b) =>
            sql`(${s.id}, ${s.workspaceId}, ${b.modelName}, ${b.origins}, ${b.mase}::numeric, ${b.coverage80}::numeric,
              ${b.bias}::numeric, ${b.selected})`,
        );
        await sql`
          INSERT INTO forecasting.backtest_result (series_id, workspace_id, model_name, origins, mase, coverage_80, bias,
            selected)
          VALUES ${sql.join(values)}`.execute(db());
      }
      const known = s.knownItems ?? [];
      if (known.length > 0) {
        const values = known.map(
          (k) =>
            sql`(${s.id}, ${s.workspaceId}, ${k.period}, ${k.date}::date, ${k.label}, ${k.kind}, ${k.amountType},
              ${k.amount}::numeric, ${k.currency}, ${k.originalAmount?.amount ?? null}::numeric,
              ${k.originalAmount?.currency ?? null}, ${k.managedBy}, ${k.source.context}, ${k.source.id}::uuid,
              ${k.categoryId}::uuid)`,
        );
        await sql`
          INSERT INTO forecasting.forecast_known_item (series_id, workspace_id, period, item_date, label, kind,
            amount_type, amount, currency, original_amount, original_currency, managed_by, source_context, source_id,
            category_id)
          VALUES ${sql.join(values)}`.execute(db());
      }
    }
  }

  async listKnownItems(
    workspaceId: string,
    runId: string,
    series: { readonly scope: StoredSeries['scope']; readonly scopeRef: string | null },
    period: string,
  ): Promise<readonly StoredKnownItem[]> {
    const { rows } = await sql<KnownItemRow>`
      SELECT k.period, k.item_date::text AS item_date, k.label, k.kind, k.amount_type, k.amount::text AS amount,
             k.currency, k.original_amount::text AS original_amount, k.original_currency, k.managed_by,
             k.source_context, k.source_id, k.category_id
        FROM forecasting.forecast_known_item k JOIN forecasting.forecast_series s ON s.id = k.series_id
       WHERE s.workspace_id = ${workspaceId} AND s.run_id = ${runId} AND s.scope = ${series.scope}
         AND s.scope_ref IS NOT DISTINCT FROM ${series.scopeRef}::uuid AND k.period = ${period}
       ORDER BY k.item_date, k.label, k.source_id`.execute(db());
    return rows.map((r) => ({
      period: r.period as StoredKnownItem['period'],
      date: r.item_date,
      label: r.label,
      kind: r.kind,
      amountType: r.amount_type,
      amount: r.amount === null ? null : dec(r.amount).toFixed(scaleOfDecimal(r.amount)),
      originalAmount:
        r.original_amount === null || r.original_currency === null
          ? null
          : { amount: r.original_amount, currency: r.original_currency },
      managedBy: r.managed_by,
      source: { context: r.source_context, id: r.source_id },
      categoryId: r.category_id,
      withoutAmount: r.amount === null && r.original_amount === null,
      currency: r.currency,
    }));
  }

  async saveRunMetadata(workspaceId: string, runId: string, metadata: RunMetadata): Promise<void> {
    await sql`
      UPDATE forecasting.forecast_run
         SET seed = ${metadata.seed}, model_set = ${metadata.modelSet},
             known_conversion = ${metadata.conversion === null ? null : JSON.stringify(metadata.conversion)}::jsonb
       WHERE workspace_id = ${workspaceId} AND id = ${runId}`.execute(db());
  }

  async runMetadata(workspaceId: string, runId: string): Promise<RunMetadata | null> {
    const { rows } = await sql<{
      seed: string | null;
      model_set: string | null;
      known_conversion: RunMetadata['conversion'];
    }>`
      SELECT seed::text AS seed, model_set, known_conversion
        FROM forecasting.forecast_run WHERE workspace_id = ${workspaceId} AND id = ${runId}`.execute(db());
    const r = rows[0];
    if (!r || r.seed === null || r.model_set === null) return null;
    return { seed: Number(r.seed), modelSet: r.model_set, conversion: r.known_conversion };
  }

  async listByRun(workspaceId: string, runId: string): Promise<readonly StoredSeries[]> {
    const { rows } = await sql<SeriesRow>`
      SELECT id, run_id, workspace_id, opaque_ref, scope, scope_ref, name, currency, scale, readiness, readiness_reasons,
             history_from, history_to, history_periods, grouped_category_ids, model_name, model_version, baseline_method,
             baseline_n, status, selected_by, mase::text AS mase, baseline_mase::text AS baseline_mase,
             coverage_80::text AS coverage_80, confidence
        FROM forecasting.forecast_series WHERE workspace_id = ${workspaceId} AND run_id = ${runId}
       ORDER BY CASE scope WHEN 'TOTAL_EXPENSE' THEN 0 WHEN 'TOTAL_INCOME' THEN 1 WHEN 'CATEGORY_GROUP' THEN 2
                           WHEN 'CATEGORY' THEN 3 ELSE 4 END, name, id`.execute(db());
    const points = await sql<PointRow>`
      SELECT p.series_id, p.period, p.months_ahead, p.prediction::text AS prediction, p.lower_80::text AS lower_80,
             p.upper_80::text AS upper_80, p.lower_95::text AS lower_95, p.upper_95::text AS upper_95,
             p.baseline_value::text AS baseline_value, p.known_future::text AS known_future,
             p.predicted_variable::text AS predicted_variable, p.variable_lower_80::text AS variable_lower_80,
             p.variable_upper_80::text AS variable_upper_80, p.known_without_amount, p.drivers
        FROM forecasting.forecast_point p JOIN forecasting.forecast_series s ON s.id = p.series_id
       WHERE s.workspace_id = ${workspaceId} AND s.run_id = ${runId}
       ORDER BY p.series_id, p.months_ahead`.execute(db());
    const bySeries = new Map<string, StoredPoint[]>();
    const scaleOf = new Map(rows.map((r) => [r.id, Number(r.scale)]));
    for (const p of points.rows) {
      const scale = scaleOf.get(p.series_id) ?? 2;
      const list = bySeries.get(p.series_id) ?? [];
      list.push({
        period: p.period,
        monthsAhead: Number(p.months_ahead),
        prediction: fixed(p.prediction, scale),
        lower80: fixed(p.lower_80, scale),
        upper80: fixed(p.upper_80, scale),
        lower95: fixed(p.lower_95, scale),
        upper95: fixed(p.upper_95, scale),
        baselineValue: fixed(p.baseline_value, scale),
        knownFuture: p.known_future === null ? null : fixed(p.known_future, scale),
        predictedVariable: p.predicted_variable === null ? null : fixed(p.predicted_variable, scale),
        variableLower80: p.variable_lower_80 === null ? null : fixed(p.variable_lower_80, scale),
        variableUpper80: p.variable_upper_80 === null ? null : fixed(p.variable_upper_80, scale),
        knownBlankCount: Number(p.known_without_amount),
        drivers: p.known_future === null ? null : p.drivers,
      });
      bySeries.set(p.series_id, list);
    }
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      workspaceId: r.workspace_id,
      opaqueRef: r.opaque_ref,
      scope: r.scope,
      scopeRef: r.scope_ref,
      name: r.name,
      currency: r.currency,
      scale: Number(r.scale),
      readiness: r.readiness,
      readinessReasons: r.readiness_reasons,
      historyFrom: r.history_from,
      historyTo: r.history_to,
      historyPeriods: Number(r.history_periods),
      groupedCategoryIds: r.grouped_category_ids,
      modelName: r.model_name,
      modelVersion: r.model_version,
      baselineMethod: r.baseline_method,
      baselineN: r.baseline_n === null ? null : Number(r.baseline_n),
      status: r.status,
      points: bySeries.get(r.id) ?? [],
      selectedBy: r.selected_by,
      mase: r.mase === null ? null : dec(r.mase).toFixed(4),
      baselineMase: r.baseline_mase === null ? null : dec(r.baseline_mase).toFixed(4),
      coverage80: r.coverage_80 === null ? null : dec(r.coverage_80).toFixed(4),
      confidence: r.confidence,
    }));
  }
}

// ───────────────────────────────────────────────────────────── operación asíncrona

/**
 * `platform.operation` (kind `FORECAST`) sobre la conexión de la unidad de trabajo en curso: la misma tabla que consulta
 * `GET W/operations/{id}` (docs/10 §8). Solo estado y motivo; el id es el de la corrida.
 */
export class PgForecastOperations implements OperationPort {
  async create(input: { id: string; workspaceId: string; requestedBy: string }): Promise<void> {
    await sql`INSERT INTO platform.operation (id, workspace_id, kind, resource_type, resource_id, requested_by)
      VALUES (${input.id}, ${input.workspaceId}, 'FORECAST', 'forecast-run', ${input.id}, ${input.requestedBy})`.execute(
      db(),
    );
  }

  async update(
    workspaceId: string,
    id: string,
    patch: {
      status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
      progressPct?: number;
      error?: Readonly<Record<string, unknown>> | null;
    },
  ): Promise<void> {
    // Las corridas programadas no tienen operación: la actualización no encuentra fila y es inocua.
    await sql`UPDATE platform.operation
       SET status = ${patch.status}, progress_pct = ${patch.progressPct ?? 0},
           error = ${patch.error ? JSON.stringify(patch.error) : null}::jsonb, updated_at = now()
     WHERE workspace_id = ${workspaceId} AND id = ${id}`.execute(db());
  }
}

// ───────────────────────────────────────────────────────────── mantenimiento (sin workspace)

/**
 * Barridos entre workspaces como `pf_maintenance` (ADR-0023), asumido solo en esa transacción con `SET LOCAL ROLE`: lee
 * columnas operativas de `forecast_run` (política `retention_scan`). Cada mutación corre luego con el contexto de su
 * workspace.
 */
export class PgMaintenance implements MaintenancePort {
  constructor(private readonly uow: PgForecastingUnitOfWork) {}

  private scan<T>(run: () => Promise<T>): Promise<T> {
    return this.uow.runSystem(async () => {
      await sql`SET LOCAL ROLE pf_maintenance`.execute(db());
      return run();
    });
  }

  dueRuns(nowIso: string, stalledBeforeIso: string, limit: number): Promise<readonly RunRef[]> {
    return this.scan(async () => {
      const { rows } = await sql<{ workspace_id: string; id: string }>`
        SELECT workspace_id, id FROM forecasting.forecast_run
         WHERE (status = 'REQUESTED' AND next_attempt_at <= ${nowIso}::timestamptz)
            OR (status = 'RUNNING' AND started_at <= ${stalledBeforeIso}::timestamptz)
         ORDER BY coalesce(started_at, requested_at), id LIMIT ${limit}`.execute(db());
      return rows.map((r) => ({ workspaceId: r.workspace_id, runId: r.id }));
    });
  }

  purgeCandidates(input: { supersededBeforeIso: string; failedBeforeIso: string }) {
    return this.scan(async () => {
      const { rows } = await sql<{
        workspace_id: string;
        id: string;
        status: ForecastRunStatus;
        completed_at: string | null;
        requested_at: string;
      }>`
        SELECT workspace_id, id, status, ${ISO('completed_at')} AS completed_at, ${ISO('requested_at')} AS requested_at
          FROM forecasting.forecast_run
         WHERE (status = 'SUPERSEDED' AND coalesce(completed_at, requested_at) < ${input.supersededBeforeIso}::timestamptz)
            OR (status IN ('FAILED', 'INSUFFICIENT_DATA')
                AND coalesce(completed_at, requested_at) < ${input.failedBeforeIso}::timestamptz)`.execute(
        db(),
      );
      return rows.map((r) => ({
        workspaceId: r.workspace_id,
        runId: r.id,
        status: r.status,
        completedAt: r.completed_at,
        requestedAt: r.requested_at,
      }));
    });
  }

  async deleteRuns(workspaceId: string, runIds: readonly string[]): Promise<number> {
    if (runIds.length === 0) return 0;
    const ids = sql.join(runIds.map((id) => sql`${id}::uuid`));
    const { rows } = await sql<{ id: string }>`
      DELETE FROM forecasting.forecast_run WHERE workspace_id = ${workspaceId} AND id IN (${ids}) RETURNING id`.execute(
      db(),
    );
    return rows.length;
  }
}
