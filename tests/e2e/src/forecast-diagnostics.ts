import { Client } from 'pg';
import { env } from './helpers.js';

/**
 * Diagnóstico de las corridas de pronóstico para cuando una espera agota el tiempo (docs/38 §4, flake del e2e
 * `predicted-cash-flow-band`: la corrida quedaba `REQUESTED` y el runner no la tomaba). Lee con el superusuario del
 * stack E2E (el de pruebas, sin RLS) las corridas del workspace y de los demás workspaces todavía pendientes, y el estado
 * de la cola `forecasting.runner` de pg-boss, para que el mensaje de la falla diga POR QUÉ no avanzó. No lanza nunca.
 */
export async function forecastDiagnostics(workspaceId: string): Promise<string> {
  const e = env();
  const client = new Client({
    host: e['PF_BIND_ADDR'] ?? '127.0.0.1',
    port: Number(e['PF_POSTGRES_PORT']),
    user: 'postgres',
    password: e['PF_DEV_PG_SUPERUSER_PASSWORD'],
    database: e['POSTGRES_DB'] ?? 'pfos',
  });
  try {
    await client.connect();
    const mine = await client.query(
      `SELECT id, status, trigger, attempts, failure_reason, requested_at, next_attempt_at, started_at, completed_at
         FROM forecasting.forecast_run WHERE workspace_id = $1 ORDER BY requested_at`,
      [workspaceId],
    );
    const pending = await client.query(
      `SELECT workspace_id, id, status, trigger, attempts, requested_at, next_attempt_at, started_at
         FROM forecasting.forecast_run WHERE status IN ('REQUESTED', 'RUNNING') ORDER BY requested_at LIMIT 20`,
    );
    const queue = await client.query(
      `SELECT state, count(*)::int AS n, min(created_on) AS oldest, max(created_on) AS newest
         FROM pgboss.job WHERE name = 'forecasting.runner' GROUP BY state`,
    );
    const now = await client.query('SELECT now() AS now');
    return JSON.stringify(
      {
        dbNow: now.rows[0]?.now,
        workspaceRuns: mine.rows,
        pendingRunsAnyWorkspace: pending.rows,
        runnerQueueByState: queue.rows,
      },
      null,
      2,
    );
  } catch (err) {
    return `diagnóstico no disponible: ${String(err)}`;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Ejecuta `wait`; si falla, relanza el error con el diagnóstico de las corridas anexado. */
export async function withForecastDiagnostics(workspaceId: string, wait: () => Promise<void>): Promise<void> {
  try {
    await wait();
  } catch (err) {
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${base}\n--- diagnóstico de corridas de pronóstico ---\n${await forecastDiagnostics(workspaceId)}`,
      {
        cause: err,
      },
    );
  }
}
