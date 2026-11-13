import type { Pool } from 'pg';
import { BacktestReport, type BacktestReportRow } from '../application/backtest-report.js';
import type { StoredSeries, WorkspaceDirectory } from '../application/ports.js';
import {
  PgForecastingUnitOfWork,
  PgRunRepository,
  PgSeriesRepository,
} from '../infrastructure/pg-forecasting.js';

/**
 * Comando de evidencia del owner (`pnpm forecast:backtest:report`, pregunta 24): lee, workspace por workspace y con su
 * contexto RLS, las series del pronóstico vigente y devuelve SOLO métricas agregadas por tipo de serie. Lecturas en
 * serie por workspace; no escribe nada.
 */
export async function collectBacktestReport(
  pool: Pool,
  workspaces: WorkspaceDirectory,
): Promise<{ readonly workspaces: number; readonly rows: BacktestReportRow[] }> {
  const uow = new PgForecastingUnitOfWork(pool);
  const runs = new PgRunRepository();
  const series = new PgSeriesRepository();
  const all: StoredSeries[] = [];
  const list = await workspaces.list();
  for (const { workspaceId } of list) {
    const rows = await uow.run(workspaceId, async () => {
      const run = await runs.latestCompleted(workspaceId);
      return run ? series.listByRun(workspaceId, run.id) : [];
    });
    all.push(...rows);
  }
  return { workspaces: list.length, rows: BacktestReport.aggregate(all) };
}

export { BacktestReport } from '../application/backtest-report.js';
