// Comando `category-suggestions-backtest` (one-shot) de la imagen finance-api (openspec add-category-suggestions, D477):
//   node dist/entrypoint.js category-suggestions-backtest --workspace <id> --months <n ≥ 3> [--as-of YYYY-MM]
// Backtesting temporal SIN EFECTOS de las sugerencias de categoría por historial: para cada uno de los últimos meses
// calcula las sugerencias con el historial hasta el fin del mes anterior y las compara con lo que el usuario eligió.
// Imprime SOLO cifras agregadas (precisión y cobertura por mes, nivel y base): ni descripciones ni montos.
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { createLogger } from '@pf/platform/logging';
import { loadConfigOrExit } from '@pf/platform/config';
import { PgUnitOfWork } from '@pf/platform/api';
import { systemClock } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from './identity/identity-wiring.js';

function option(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const argv = process.argv.slice(3);
const workspaceId = option(argv, 'workspace');
const months = Number(option(argv, 'months') ?? '3');
const asOf = option(argv, 'as-of');
const minPrecision = option(argv, 'min-precision');
if (!workspaceId || !Number.isInteger(months)) {
  process.stderr.write(
    'uso: category-suggestions-backtest --workspace <id> --months <n ≥ 3> [--as-of YYYY-MM] [--min-precision 0.8500]\n',
  );
  process.exit(64);
}

const config = loadConfigOrExit('worker');
const databaseUrl = config.WORKER_DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write('WORKER_DATABASE_URL es obligatoria\n');
  process.exit(64);
}
const logger = createLogger({
  service: 'finance-api',
  role: 'worker',
  environment: config.PFOS_ENV,
  level: config.LOG_LEVEL,
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
try {
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
    lifecycle: audit.lifecycleFor(audit.port),
    lifecycleQuery: audit.lifecycleQuery,
    history: audit.history,
    logger,
    config,
  });
  const report = await new PgUnitOfWork(pool).run({ userId: null, workspaceId }, () =>
    finance.rules.categorySuggestions.backtest(workspaceId, { months, ...(asOf ? { asOf } : {}) }),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (minPrecision !== undefined && Number(report.total.precision ?? 0) < Number(minPrecision)) {
    process.stderr.write(`precisión ${report.total.precision} menor que ${minPrecision}\n`);
    process.exitCode = 1;
  }
} catch (err) {
  process.stderr.write(
    `category-suggestions-backtest failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exitCode = err instanceof Error && 'code' in err && err.code === 'VALIDATION_FAILED' ? 64 : 1;
} finally {
  await pool.end();
}
