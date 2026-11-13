// Comando `forecast-report` (one-shot) de la imagen finance-api: evidencia del criterio de salida de Phase 8
// (openspec add-expense-forecasts, pregunta 24). Imprime SOLO métricas agregadas por tipo de serie del pronóstico
// vigente (MASE del publicado y de la mejor referencia, cobertura y cantidad de series): ni montos ni nombres.
// Uso en la instancia del owner: `docker compose exec worker node dist/entrypoint.js forecast-report`.
import { BacktestReport, collectBacktestReport } from '@pf/forecasting/interface/forecasting.module';
import { identityActiveWorkspaces } from '@pf/identity/interface/identity.module';
import { loadConfigOrExit } from '@pf/platform/config';
import { Pool } from 'pg';

const config = loadConfigOrExit('worker');
const databaseUrl = config.WORKER_DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write('WORKER_DATABASE_URL es obligatoria\n');
  process.exit(64);
}
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
try {
  const { workspaces, rows } = await collectBacktestReport(pool, identityActiveWorkspaces(pool));
  process.stdout.write(`workspaces\t${workspaces}\n${BacktestReport.format(rows)}\n`);
} catch (err) {
  process.stderr.write(`forecast-report failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
