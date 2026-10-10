import 'reflect-metadata';
import { loadConfig } from '@pf/platform/config';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  buildLargePlan,
  LARGE_MAIN_WORKSPACE_ID,
  summarizeLargeWorkspace,
} from '../../src/seed/large/large-plan.js';
import { runSeed } from '../../src/seed/run-seed.js';
import { connect } from '../support/db.js';
import { rowsByTable } from '../support/demo-db.js';
import { capturingLogger } from '../support/harness.js';
import {
  downloadExport,
  exportAndWait,
  importAndWait,
  startHarness,
  type Harness,
  type Json,
} from '../support/portability.js';

// Ida y vuelta con el dataset `large` de docs/29 §2.3 (openspec add-workspace-export, tarea 7.2; NFR-REL-014): el mismo
// generador y los mismos casos de uso que `pnpm db:seed --profile=large`, a escala reducida (la carga completa es la del
// job nightly `perf`). Export → import → saldos de TODAS las cuentas, filas por tabla y balance de comprobación idénticos.
const deps = inject('deps');
/** Mismo emisor y mismas opciones que `seed-large.int.test.ts` (la base de la suite es compartida y la carga, idempotente). */
const ISSUER = 'http://localhost:28081/realms/pfos';
const OPTIONS = { scale: 0.05, months: 3, satellites: 3 } as const;
/** Subject del owner de la Minimal Seed (docs/29 §2.1): dueño del workspace principal `large`. */
const OWNER_SUBJECT = '0199a000-0000-7000-8000-00000000c001';

let h: Harness;

beforeAll(async () => {
  const logger = capturingLogger('finance-api', 'seed').logger;
  await runSeed(
    loadConfig('seed', { PFOS_ENV: 'ci', DATABASE_URL: deps.databaseUrl, OIDC_ISSUER_URL: ISSUER }),
    logger,
    'large',
    { ...OPTIONS, concurrency: 4 },
  );
  h = await startHarness({ realClock: true, worker: true, issuer: ISSUER });
}, 900_000);

afterAll(async () => {
  await h?.close();
});

describe('Ida y vuelta del dataset large (NFR-REL-014)', () => {
  it('[TC-IDENTITY-RESTORE-002] export → import reproduce saldos por cuenta, filas por tabla y balance de comprobación', async () => {
    const owner = await h.user(OWNER_SUBJECT);
    const ws = LARGE_MAIN_WORKSPACE_ID;
    const expected = summarizeLargeWorkspace(buildLargePlan(OPTIONS).workspaces[0]!);

    // Filas por tabla ANTES de exportar (los periodos financieros se materializan perezosamente al leer: no se comparan después).
    const migrator = await connect(deps.migratorUrl);
    const before = await rowsByTable(migrator, ws).finally(() => undefined);

    const exported = await exportAndWait(h, owner, ws);
    expect(exported['status']).toBe('READY');
    const zip = await downloadExport(h, owner, ws, exported['id'] as string);
    expect(zip.status).toBe(200);

    const imported = await importAndWait(h, owner, zip.raw);
    expect(imported['status'], JSON.stringify(imported)).toBe('SUCCEEDED');
    const restored = imported['workspaceId'] as string;
    expect(restored).not.toBe(ws);

    const balances = async (id: string) => {
      const r = await h.call('GET', `/api/v1/workspaces/${id}/accounts?limit=100`, { token: owner.token });
      expect(r.status).toBe(200);
      return Object.fromEntries(
        (r.body['data'] as { name: string; balance: Json }[]).map((a) => [a.name, JSON.stringify(a.balance)]),
      );
    };
    const original = await balances(ws);
    expect(Object.keys(original)).toHaveLength(expected.counts.accounts);
    expect(await balances(restored)).toEqual(original);

    try {
      const a = before;
      const b = await rowsByTable(migrator, restored);
      // `ledger.balance_snapshot` es derivado (se reconstruye en segundo plano): no viaja en el export.
      // `planning.financial_period` lo provisiona Planning en segundo plano (D62/D64) en cuanto existe el workspace
      // restaurado, así que su conteo depende de cuándo corre el worker y no de la ida y vuelta.
      const business = (k: string) =>
        k !== 'ledger.balance_snapshot' &&
        k !== 'planning.financial_period' &&
        /^(ledger|txn|acct|accounts|classification|planning|fx|reconciliation)\./u.test(k);
      const keys = Object.keys(a).filter(business);
      expect(keys.length).toBeGreaterThan(5);
      expect(Object.fromEntries(keys.map((k) => [k, b[k] ?? 0]))).toEqual(
        Object.fromEntries(keys.map((k) => [k, a[k]])),
      );
      expect(a['txn.transaction']).toBe(expected.counts.transactions);
    } finally {
      await migrator.end();
    }
    const trial = await h.call('GET', `/api/v1/workspaces/${restored}/ledger/trial-balance`, {
      token: owner.token,
    });
    expect(trial.status, JSON.stringify(trial.body)).toBe(200);
    for (const row of (trial.body['byCurrency'] ?? trial.body['currencies'] ?? []) as {
      total?: { amount: string };
    }[]) {
      expect(Number(row.total?.amount ?? 0)).toBe(0);
    }
  }, 900_000);
});
