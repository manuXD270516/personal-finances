import { loadConfig } from '@pf/platform/config';
import { describe, expect, inject, it } from 'vitest';
import golden from '../../src/demo/dataset/golden-summary.json' with { type: 'json' };
import { MINIMAL_USERS, MINIMAL_WORKSPACES, runSeed, SeedRejectedError } from '../../src/seed/run-seed.js';
import { connect, inTx } from '../support/db.js';
import { rowsByTable, unbalancedEntries } from '../support/demo-db.js';
import { capturingLogger } from '../support/harness.js';

// Perfil `demo` de `pnpm db:seed` (add-demo-data 7.3; docs/29 §4): reutiliza RequestDemoData + DemoDataLoader en
// proceso, crea el workspace DEMO dedicado del owner (origen W1) y nunca escribe datos financieros en W1/W2.
const deps = inject('deps');
const ISSUER = 'http://localhost:28081/realms/pfos';
const config = (extra: Record<string, string> = {}) =>
  loadConfig('seed', { PFOS_ENV: 'ci', DATABASE_URL: deps.databaseUrl, OIDC_ISSUER_URL: ISSUER, ...extra });

describe('seed --profile=demo (add-demo-data)', () => {
  it('[TC-IDENTITY-DEMO-007] crea un workspace demo READY con los saldos del golden summary, sin tocar W1/W2; idempotente', async () => {
    const logger = capturingLogger('finance-api', 'seed').logger;
    const migrator = await connect(deps.migratorUrl);
    const app = await connect(deps.databaseUrl);
    try {
      await runSeed(config(), logger, 'minimal');
      const [w1, w2] = MINIMAL_WORKSPACES.map((w) => w.id) as [string, string];
      const before = [await rowsByTable(migrator, w1), await rowsByTable(migrator, w2)];
      await runSeed(config(), logger, 'demo');
      await runSeed(config(), logger, 'demo'); // idempotente: el owner ya tiene un demo vigente
      const owner = (
        await app.query<{ id: string }>('SELECT iam.provision_user($1, $2, $3, $4) AS id', [
          ISSUER,
          MINIMAL_USERS[0].subject,
          'owner@demo.pfos.test',
          MINIMAL_USERS[0].name,
        ])
      ).rows[0]!.id;
      const demos = await inTx(
        app,
        { userId: owner },
        async () =>
          (
            await app.query<{ id: string; demo_status: string }>(
              `SELECT id::text, demo_status FROM iam.workspace WHERE is_demo AND demo_requested_by = $1`,
              [owner],
            )
          ).rows,
      );
      expect(demos).toHaveLength(1);
      expect(demos[0]?.demo_status).toBe('READY');
      const demoId = demos[0]!.id;
      const balances = await inTx(
        app,
        { userId: owner, workspaceId: demoId },
        async () =>
          (
            await app.query<{ name: string; balance: string }>(
              `SELECT a.name, round(sum(p.amount), 2)::text AS balance FROM accounts.account a
               JOIN ledger.ledger_account l ON l.source_account_id = a.id
               JOIN ledger.posting p ON p.ledger_account_id = l.id
              WHERE a.workspace_id = $1 GROUP BY a.name ORDER BY a.name`,
              [demoId],
            )
          ).rows,
      );
      // Saldo contable (pasivo negativo); la escala exacta se compara por valor.
      const byName = Object.fromEntries(balances.map((b) => [b.name, b.balance]));
      expect(byName['Banco Andino Demo — Cuenta corriente']).toBe(golden.balances.bank_bob);
      expect(byName['Tarjeta Andina Demo']).toBe(`-${golden.balances.card}`);
      expect(byName['Préstamo vehicular']).toBe(`-${golden.balances.loan}`);
      expect(await unbalancedEntries(migrator, demoId)).toEqual([]);
      expect([await rowsByTable(migrator, w1), await rowsByTable(migrator, w2)].map(strip)).toEqual(
        before.map(strip),
      );
      // Deshabilitada por entorno ⇒ rechazada.
      await expect(runSeed(config({ DEMO_DATA_ENABLED: 'false' }), logger, 'demo')).rejects.toBeInstanceOf(
        SeedRejectedError,
      );
    } finally {
      await app.end();
      await migrator.end();
    }
  }, 300_000);
});

/** W1 recibe auditoría de la acción (load_requested/loaded) y el outbox: se comparan los datos financieros. */
function strip(rows: Record<string, number>): Record<string, number> {
  return { ...rows, 'audit.audit_log': 0, 'platform.outbox': 0, 'platform.idempotency_key': 0 };
}
