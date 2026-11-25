// Comando `forecast-anomalies-backtest` (one-shot) de la imagen finance-api (openspec add-spending-anomaly-detection,
// decisión 11; D483): evalúa la detección de gastos atípicos sobre TODA la historia de un workspace (cada gasto con sus 365
// días anteriores) y la compara con las etiquetas `OUTLIER` y `NEW_COUNTERPARTY_FRAUD` del Large Seed exportadas con
// `pnpm db:seed -- --profile=large --labels-out=<ruta.jsonl>`. No persiste nada y su informe no lleva montos ni descripciones.
// Uso: `pnpm forecast:anomalies:backtest -- --workspace <id> --labels <ruta.jsonl>`; sale con código distinto de cero si la
// precisión es menor que 0.60 o el recall menor que 0.70.
import { readFileSync } from 'node:fs';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import { formatBacktestReport } from '@pf/forecasting/interface/forecasting.module';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { runWithRequestContext } from '@pf/platform/api';
import { loadConfigOrExit } from '@pf/platform/config';
import { PgOutboxWriter } from '@pf/platform/events';
import { createLogger } from '@pf/platform/logging';
import { systemClock } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { parseBacktestArgs, parseLabels } from './forecasting/anomaly-backtest-cli.js';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from './identity/identity-wiring.js';
import { eventSchemaRegistry } from './runtime/event-contracts.js';

const config = loadConfigOrExit('worker');
const logger = createLogger({
  service: 'finance-api',
  role: 'worker',
  environment: config.PFOS_ENV,
  level: config.LOG_LEVEL,
});
const databaseUrl = config.WORKER_DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write('WORKER_DATABASE_URL es obligatoria\n');
  process.exit(64);
}
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
try {
  const args = parseBacktestArgs(process.argv.slice(3));
  const labels = parseLabels(readFileSync(args.labels, 'utf8'), args.workspace);
  const audit = createAuditRuntime({
    pool,
    clock: systemClock,
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(pool),
    machines: LIFECYCLE_MACHINES,
  });
  const finance = financeRuntimes({
    pool,
    clock: systemClock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    lifecycleQuery: audit.lifecycleQuery,
    history: audit.history,
    logger,
    config,
    outbox: new PgOutboxWriter(eventSchemaRegistry()),
  });
  const report = await runWithRequestContext(
    { actor: { type: 'WORKER', process: 'forecast-anomalies-backtest' }, origin: 'recurring' },
    () => finance.forecasting.anomalies.backtest.report(args.workspace, labels),
  );
  process.stdout.write(`${formatBacktestReport(report)}\n`);
  if (!report.passes) process.exitCode = 1;
} catch (err) {
  process.stderr.write(
    `forecast-anomalies-backtest failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exitCode = 2;
} finally {
  await pool.end();
}
