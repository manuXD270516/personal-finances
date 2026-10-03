import type { Pool } from 'pg';
import type { ProviderRun, ProviderRunKind, ProviderRunRepository } from '../application/ports/index.js';
import type { FxProviderErrorCode, FxRateProvider } from '../domain/index.js';

interface RunRow {
  id: string;
  provider: FxRateProvider;
  kind: ProviderRunKind;
  started_at: string;
  finished_at: string;
  outcome: ProviderRun['outcome'];
  error_code: FxProviderErrorCode | null;
  http_status: number | null;
  latency_ms: number;
  new_samples: number;
  retry_after_until: string | null;
  history_points: number | null;
  history_from: string | null;
  history_to: string | null;
}

const ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Bitácora de intentos `fx.provider_run` (tabla de INSTALACIÓN sin `workspace_id` ni datos de usuario; design.md
 * decisión 4). Va por el pool, fuera de la transacción por workspace: el intento queda registrado aunque la copia a
 * un workspace falle. El worker (`pf_worker`) inserta y purga; la API (`pf_app`) solo lee.
 */
export class PgProviderRunRepository implements ProviderRunRepository {
  constructor(private readonly pool: Pool) {}

  async record(run: ProviderRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO fx.provider_run (id, provider, kind, started_at, finished_at, outcome, error_code, http_status,
                                    latency_ms, new_samples, retry_after_until, history_points, history_from, history_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        run.id,
        run.provider,
        run.kind,
        run.startedAt,
        run.finishedAt,
        run.outcome,
        run.errorCode,
        run.httpStatus,
        run.latencyMs,
        run.newSamples,
        run.retryAfterUntil,
        run.historyPoints,
        run.historyFrom,
        run.historyTo,
      ],
    );
  }

  async recent(
    provider: FxRateProvider,
    limit: number,
    kinds?: readonly ProviderRunKind[],
  ): Promise<ProviderRun[]> {
    const { rows } = await this.pool.query<RunRow>(
      `SELECT id::text, provider, kind, ${ISO('started_at')} AS started_at, ${ISO('finished_at')} AS finished_at,
              outcome, error_code, http_status, latency_ms, new_samples,
              ${ISO('retry_after_until')} AS retry_after_until, history_points,
              history_from::text AS history_from, history_to::text AS history_to
         FROM fx.provider_run
        WHERE provider = $1 AND ($2::text[] IS NULL OR kind = ANY ($2::text[]))
        ORDER BY started_at DESC, id DESC
        LIMIT $3`,
      [provider, kinds ? [...kinds] : null, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      kind: r.kind,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      outcome: r.outcome,
      errorCode: r.error_code,
      httpStatus: r.http_status === null ? null : Number(r.http_status),
      latencyMs: Number(r.latency_ms),
      newSamples: Number(r.new_samples),
      retryAfterUntil: r.retry_after_until,
      historyPoints: r.history_points === null ? null : Number(r.history_points),
      historyFrom: r.history_from,
      historyTo: r.history_to,
    }));
  }

  async purgeBefore(before: string): Promise<number> {
    const { rowCount } = await this.pool.query('DELETE FROM fx.provider_run WHERE started_at < $1', [before]);
    return rowCount ?? 0;
  }
}
