import { loadConfig } from '@pf/platform/config';
import { describe, expect, inject, it } from 'vitest';
import {
  buildLargePlan,
  LARGE_MAIN_WORKSPACE_ID,
  largeSatelliteId,
  summarizeLargeWorkspace,
} from '../../src/seed/large/large-plan.js';
import { runSeed, SeedRejectedError } from '../../src/seed/run-seed.js';
import { connect } from '../support/db.js';
import { rowsByTable, unbalancedEntries } from '../support/demo-db.js';
import { capturingLogger } from '../support/harness.js';

// Perfil `large` de `pnpm db:seed` (docs/29 §2.3) a escala reducida: mismo generador y mismos casos de uso que la
// carga completa del job nightly `perf` (scale = 1: ~97 000 transacciones en el principal + 20 satélites).
const deps = inject('deps');
const ISSUER = 'http://localhost:28081/realms/pfos';
// PR: 5 % del volumen diario, 3 meses y 3 satélites; el nightly carga el dataset completo.
const OPTIONS = { scale: 0.05, months: 3, satellites: 3 } as const;
const config = (extra: Record<string, string> = {}) =>
  loadConfig('seed', { PFOS_ENV: 'ci', DATABASE_URL: deps.databaseUrl, OIDC_ISSUER_URL: ISSUER, ...extra });
const transactions = async (migrator: Awaited<ReturnType<typeof connect>>, workspaceId: string) =>
  (await rowsByTable(migrator, workspaceId))['txn.transaction'] ?? 0;

describe('seed --profile=large (docs/29 §2.3)', () => {
  it('carga el principal y los satélites por los casos de uso, con los saldos del plan y asientos balanceados; idempotente', async () => {
    const logger = capturingLogger('finance-api', 'seed').logger;
    const migrator = await connect(deps.migratorUrl);
    try {
      const started = process.hrtime.bigint();
      // El loader verifica además los saldos de cada cuenta contra el resumen del plan y el balance de comprobación.
      await runSeed(config(), logger, 'large', { ...OPTIONS, concurrency: 4 });
      const elapsed = Number((process.hrtime.bigint() - started) / 1_000_000n);
      const plan = buildLargePlan(OPTIONS);
      expect(plan.workspaces).toHaveLength(1 + OPTIONS.satellites);
      const expected = summarizeLargeWorkspace(plan.workspaces[0]!);
      expect(expected.counts.accounts).toBe(25);
      const main = await transactions(migrator, LARGE_MAIN_WORKSPACE_ID);
      expect(main).toBe(expected.counts.transactions);
      expect(await transactions(migrator, largeSatelliteId(3))).toBeGreaterThan(0);
      for (const ws of plan.workspaces) expect(await unbalancedEntries(migrator, ws.workspaceId)).toEqual([]);
      console.info(
        `large seed ${JSON.stringify(OPTIONS)}: ${main} transacciones (principal) en ${elapsed} ms`,
      );

      // Idempotente: una segunda ejecución no duplica datos.
      await runSeed(config(), logger, 'large', OPTIONS);
      expect(await transactions(migrator, LARGE_MAIN_WORKSPACE_ID)).toBe(main);
      // Nunca fuera de local/ci.
      await expect(runSeed(config({ PFOS_ENV: 'production' }), logger, 'large')).rejects.toBeInstanceOf(
        SeedRejectedError,
      );
    } finally {
      await migrator.end();
    }
  }, 600_000);
});
