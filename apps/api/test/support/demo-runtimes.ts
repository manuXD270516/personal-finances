import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { PgUnitOfWork, runWithRequestContext } from '@pf/platform/api';
import { FixedClock, Instant, systemClock } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from '../../src/identity/identity-wiring.js';
import { capturingLogger } from './harness.js';

/**
 * Casos de uso de lectura de un workspace con el reloj fijado en un día (mismos runtimes que la API y el cargador de la
 * demo): las pruebas de la demo consultan "como el usuario" en la fecha de la ancla.
 */
export function demoQueryRuntimes(input: { readonly databaseUrl: string; readonly today: string }) {
  const pool = new Pool({ connectionString: input.databaseUrl, max: 3 });
  const clock = new FixedClock(Instant.parse(`${input.today}T20:00:00.000Z`));
  const audit = createAuditRuntime({
    pool,
    clock: systemClock,
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(pool),
    machines: LIFECYCLE_MACHINES,
  });
  const r = financeRuntimes({
    pool,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycleFor(audit.port),
    lifecycleQuery: audit.lifecycleQuery,
    history: audit.history,
    logger: capturingLogger('finance-api', 'api').logger,
    config: {
      APP_TIMEZONE: 'America/La_Paz',
      FX_PROVIDER_PRIMARY: 'none',
      FX_PROVIDER_FALLBACK: 'none',
      FX_PROVIDER_OFFICIAL: 'none',
    },
  });
  const uow = new PgUnitOfWork(pool);
  const inWs = <T>(userId: string, workspaceId: string, fn: () => Promise<T>): Promise<T> =>
    runWithRequestContext({ actor: { type: 'USER', userId }, origin: 'system' }, () =>
      uow.run({ userId, workspaceId }, fn),
    );
  return { r, inWs, clock, close: () => pool.end() };
}
