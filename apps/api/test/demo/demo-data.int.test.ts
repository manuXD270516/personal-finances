import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  createDemoDataRuntime,
  identityWorkspaceTimeZones,
  type DemoLoadJob,
} from '@pf/identity/interface/identity.module';
import { FixedClock, Instant, systemClock } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import golden from '../../src/demo/dataset/golden-summary.json' with { type: 'json' };
import { DEMO_MANIFEST } from '../../src/demo/dataset/demo-plan.js';
import { DemoDataLoader } from '../../src/demo/demo-data-loader.js';
import { AUDIT_POLICIES, outboxPort } from '../../src/identity/identity-wiring.js';
import { seedWorkspaceProvisioning } from '../../src/identity/workspace-provisioning.js';
import { createWorkerRuntime, type WorkerRuntime } from '../../src/worker/create-worker-runtime.js';
import { connect, inTx } from '../support/db.js';
import { rowsByTable, unbalancedEntries } from '../support/demo-db.js';
import {
  apiConfig,
  baseEnv,
  capturingLogger,
  discardStaleEventBacklog,
  workerConfig,
} from '../support/harness.js';

// Datos de demostración de extremo a extremo (openspec add-demo-data, tareas 3.x/5.1/7.1): API real (JWT de prueba),
// worker real (jobs `demo.load`/`demo.purge` sobre pg-boss) y PostgreSQL real con RLS.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let jwks: { keys: Record<string, unknown>[] };
let api: ApiRuntime;
let baseUrl: string;
let worker: WorkerRuntime;
let migrator: Client;
let app: Client;
let apiLogs: ReturnType<typeof capturingLogger>;

async function tokenFor(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub,
    iat: now - 5,
    exp: now + 900,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `${sub}@pfos.test`,
    email_verified: true,
    name: sub,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(signingKey);
}

async function call(
  url: string,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<Reply> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (method === 'POST') headers['idempotency-key'] = randomUUID();
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${url}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call(baseUrl, 'GET', '/api/v1/me', token);
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, personal: memberships[0]!.workspaceId };
}

async function waitStatus(token: string, workspaceId: string, wanted: string, timeoutMs = 240_000) {
  const started = Date.now();
  for (;;) {
    const r = await call(baseUrl, 'GET', `/api/v1/workspaces/${workspaceId}/demo-data`, token);
    if (r.status === 200 && r.body['status'] === wanted) return r.body;
    if (Date.now() - started > timeoutMs)
      throw new Error(`timeout esperando ${wanted}: ${JSON.stringify(r)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Asientos, transacciones y auditoría de un workspace (conteos por tabla registrada). */
const countsOf = (workspaceId: string) => rowsByTable(migrator, workspaceId);

async function auditActions(workspaceId: string): Promise<{ action: string; actor: string; demo: string }[]> {
  await migrator.query('BEGIN');
  try {
    await migrator.query(`SELECT set_config('pf.demo_purge_workspace', $1, true)`, [workspaceId]);
    const { rows } = await migrator.query<{ action: string; actor: string; demo: string }>(
      `SELECT action, coalesce(actor_process, actor_type) AS actor, aggregate_id::text AS demo
         FROM audit.audit_log WHERE workspace_id = $1 AND action LIKE 'identity.demo.%'
        ORDER BY occurred_at, id`,
      [workspaceId],
    );
    return rows;
  } finally {
    await migrator.query('ROLLBACK');
  }
}

/**
 * Conteos del workspace una vez que terminó el trabajo asíncrono de su alta (el worker del archivo reacciona a
 * `identity.WorkspaceCreated`: periodos, preferencias, auditoría). Medir "antes" sin esperar compite con ese trabajo y
 * lo cuenta como cambio causado por la carga demo.
 */
async function settledCountsOf(workspaceId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let previous = JSON.stringify(await countsOf(workspaceId));
  for (;;) {
    await new Promise((r) => setTimeout(r, 1_500));
    const current = await countsOf(workspaceId);
    const serialized = JSON.stringify(current);
    if (serialized === previous && Number(current['planning.financial_period']) > 0) return current;
    if (Date.now() > deadline) throw new Error('settledCountsOf: el alta del workspace no se estabilizó');
    previous = serialized;
  }
}

/** Carga en proceso con un ancla fija (como `pnpm db:seed -- --profile=demo`, rol de la app). */
async function loadInProcess(input: {
  readonly ownerId: string;
  readonly originId: string;
  readonly anchor: string;
  readonly failAt?: string;
}): Promise<{ job: DemoLoadJob; outcome: string }> {
  const pool = new Pool({ connectionString: deps.databaseUrl, max: 2 });
  try {
    const audit = createAuditRuntime({
      pool,
      clock: systemClock,
      policies: AUDIT_POLICIES,
      timeZones: identityWorkspaceTimeZones(pool),
    });
    let job: DemoLoadJob | undefined;
    const demo = createDemoDataRuntime({
      pool,
      clock: new FixedClock(Instant.parse(`${input.anchor}T16:00:00.000Z`)),
      outbox: outboxPort(),
      audit: audit.port,
      defaults: {
        baseCurrency: 'BOB',
        timeZone: 'America/La_Paz',
        locale: 'es-BO',
        personalWorkspaceName: 'P',
      },
      onWorkspaceCreated: seedWorkspaceProvisioning(pool, systemClock),
      demo: {
        settings: {
          enabled: true,
          datasetVersion: '1',
          workspaceName: DEMO_MANIFEST.workspaceName,
          modules: DEMO_MANIFEST.modules,
        },
        jobs: {
          enqueueLoad: async (j) => {
            job = j;
          },
          enqueuePurge: async () => undefined,
        },
      },
    });
    await demo.requestDemoData(input.ownerId, input.originId);
    const loader = new DemoDataLoader({
      pool,
      logger: capturingLogger('finance-api', 'seed').logger,
      demo,
      config: {
        APP_TIMEZONE: 'America/La_Paz',
        FX_PROVIDER_PRIMARY: 'none',
        FX_PROVIDER_FALLBACK: 'none',
        FX_PROVIDER_OFFICIAL: 'none',
      },
      ...(input.failAt ? { failAt: input.failAt } : {}),
    });
    const outcome = await loader.load(job!);
    return { job: job!, outcome };
  } finally {
    await pool.end();
  }
}

/** Saldos presentados de las cuentas de un workspace (vía la API, como el usuario). */
async function balancesOf(token: string, workspaceId: string): Promise<Record<string, string>> {
  const r = await call(baseUrl, 'GET', `/api/v1/workspaces/${workspaceId}/accounts?limit=50`, token);
  expect(r.status).toBe(200);
  const data = r.body['data'] as { name: string; balance: { amount: string }; notes: string | null }[];
  return Object.fromEntries(data.map((a) => [a.name, a.balance.amount]));
}

const GOLDEN_BY_NAME: Record<string, string> = {
  'Banco Andino Demo — Cuenta corriente': golden.balances.bank_bob,
  'Banco Andino Demo — Ahorro USD': golden.balances.bank_usd,
  Efectivo: golden.balances.cash,
  'P2P Exchange Demo — Billetera USDT': golden.balances.usdt,
  'Cold Wallet BTC': golden.balances.btc,
  'Tarjeta Andina Demo': golden.balances.card,
  'Préstamo vehicular': golden.balances.loan,
};

beforeAll(async () => {
  await discardStaleEventBacklog(deps);
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' }] };
  apiLogs = capturingLogger('finance-api', 'api');
  api = await createApiRuntime(apiConfig(baseEnv(deps)), apiLogs.logger, {
    identity: { jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks } },
  });
  baseUrl = await api.listen(0, '127.0.0.1');
  worker = await createWorkerRuntime(
    workerConfig(baseEnv(deps)),
    capturingLogger('finance-worker', 'worker').logger,
    {
      ledgerMaintenanceOnStart: false,
      fxGapFillOnStart: false,
    },
  );
  migrator = await connect(deps.migratorUrl);
  app = await connect(deps.databaseUrl);
}, 180_000);

afterAll(async () => {
  await worker?.close();
  await api?.close();
  await app?.end();
  await migrator?.end();
});

describe('datos de demostración de extremo a extremo (identity/demo-data)', () => {
  it('[TC-IDENTITY-DEMO-003] migrar, arrancar API + worker y el primer login no crean ningún workspace ni dato demo', async () => {
    const u = await user(`kc-demo-first-${randomUUID()}`);
    const list = await call(baseUrl, 'GET', '/api/v1/workspaces', u.token);
    expect((list.body['data'] as { isDemo: boolean }[]).map((w) => w.isDemo)).toEqual([false]);
    const runs = await inTx(
      app,
      { userId: u.id },
      async () => (await app.query('SELECT count(*)::int AS n FROM platform.demo_workspace_run')).rows[0],
    );
    expect(runs).toEqual({ n: 0 });
    expect(await call(baseUrl, 'GET', `/api/v1/workspaces/${u.personal}/demo-data`, u.token)).toMatchObject({
      status: 404,
      body: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('[TC-IDENTITY-DEMO-001] [TC-IDENTITY-DEMO-014] [TC-IDENTITY-DEMO-010] [TC-IDENTITY-DEMO-011] [TC-IDENTITY-DEMO-013] carga por la app, el real no cambia, limpieza inmediata y purga completa', async () => {
    const owner = await user(`kc-demo-owner-${randomUUID()}`);
    const w1 = owner.personal;
    const before = await settledCountsOf(w1);

    const requested = await call(baseUrl, 'POST', `/api/v1/workspaces/${w1}/demo-data`, owner.token);
    expect(requested.status).toBe(202);
    expect(requested.body).toMatchObject({ originWorkspaceId: w1, status: 'LOADING', datasetVersion: '1' });
    const demoId = requested.body['demoWorkspaceId'] as string;

    const ready = await waitStatus(owner.token, demoId, 'READY');
    expect(ready['loadedAt']).toEqual(expect.any(String));
    // Único miembro: el solicitante (OWNER); el demo se lista marcado y el real no.
    const ws = await call(baseUrl, 'GET', `/api/v1/workspaces/${demoId}`, owner.token);
    expect(ws.body).toMatchObject({
      isDemo: true,
      demoStatus: 'READY',
      role: 'OWNER',
      name: DEMO_MANIFEST.workspaceName,
    });
    const listed = (await call(baseUrl, 'GET', '/api/v1/workspaces', owner.token)).body['data'] as {
      id: string;
      isDemo: boolean;
    }[];
    expect(Object.fromEntries(listed.map((w) => [w.id, w.isDemo]))).toEqual({ [w1]: false, [demoId]: true });
    const demoCounts = await countsOf(demoId);
    expect(demoCounts['iam.workspace_membership']).toBe(1);
    for (const t of ['txn.transaction', 'ledger.posting', 'fx.exchange_rate', 'txn.conversion_detail']) {
      expect(demoCounts[t], t).toBeGreaterThan(0);
    }
    // Saldos iguales al golden summary (las fechas se desplazan a hoy; los saldos no).
    expect(await balancesOf(owner.token, demoId)).toEqual(GOLDEN_BY_NAME);
    expect(await unbalancedEntries(migrator, demoId)).toEqual([]);

    // TC-014: W1 no cambia salvo la auditoría de la acción de carga.
    const afterLoad = await countsOf(w1);
    expect({
      ...afterLoad,
      'audit.audit_log': 0,
      'platform.idempotency_key': 0,
      'platform.outbox': 0,
    }).toEqual({
      ...before,
      'audit.audit_log': 0,
      'platform.idempotency_key': 0,
      'platform.outbox': 0,
    });
    expect((await auditActions(w1)).map((a) => a.action)).toEqual([
      'identity.demo.load_requested',
      'identity.demo.loaded',
    ]);

    // TC-010: limpiar archiva al instante.
    const account = (
      (await call(baseUrl, 'GET', `/api/v1/workspaces/${demoId}/accounts`, owner.token)).body['data'] as {
        id: string;
      }[]
    )[0]!.id;
    const cleaned = await call(
      baseUrl,
      'POST',
      `/api/v1/workspaces/${demoId}/demo-data/cleanup`,
      owner.token,
    );
    expect(cleaned.status).toBe(202);
    expect(['CLEANING', 'PURGED']).toContain(cleaned.body['status']);
    const after = (await call(baseUrl, 'GET', '/api/v1/workspaces', owner.token)).body['data'] as {
      id: string;
    }[];
    expect(after.map((w) => w.id)).toEqual([w1]);
    expect(
      (await call(baseUrl, 'GET', `/api/v1/workspaces/${demoId}/accounts/${account}`, owner.token)).status,
    ).toBe(404);

    // TC-011: la purga del worker deja 0 filas en toda tabla registrada.
    const purged = await waitStatus(owner.token, w1, 'PURGED');
    expect(purged['purgedAt']).toEqual(expect.any(String));
    const left = await countsOf(demoId);
    expect(Object.entries(left).filter(([, n]) => n > 0)).toEqual([]);
    // TC-013: la evidencia vive en el origen y sobrevive a la purga.
    expect(await auditActions(w1)).toEqual([
      { action: 'identity.demo.load_requested', actor: 'USER', demo: demoId },
      { action: 'identity.demo.loaded', actor: 'system:demo', demo: demoId },
      { action: 'identity.demo.cleanup_requested', actor: 'USER', demo: demoId },
      { action: 'identity.demo.purged', actor: 'system:demo', demo: demoId },
    ]);
    const finalW1 = await countsOf(w1);
    expect(finalW1['ledger.posting']).toBe(before['ledger.posting']);
    expect(finalW1['txn.transaction']).toBe(before['txn.transaction']);
    expect(await unbalancedEntries(migrator, w1)).toEqual([]);
  }, 300_000);

  it('[TC-IDENTITY-DEMO-007] dos cargas con la ancla 2026-09-30 dan los mismos saldos (golden) y asientos balanceados', async () => {
    const a = await user(`kc-demo-a-${randomUUID()}`);
    const b = await user(`kc-demo-b-${randomUUID()}`);
    const loadA = await loadInProcess({ ownerId: a.id, originId: a.personal, anchor: '2026-09-30' });
    const loadB = await loadInProcess({ ownerId: b.id, originId: b.personal, anchor: '2026-09-30' });
    expect([loadA.outcome, loadB.outcome]).toEqual(['READY', 'READY']);
    expect(loadA.job.anchorDate).toBe('2026-09-30');
    const balancesA = await balancesOf(a.token, loadA.job.demoWorkspaceId);
    expect(balancesA).toEqual(GOLDEN_BY_NAME);
    expect(await balancesOf(b.token, loadB.job.demoWorkspaceId)).toEqual(balancesA);
    for (const id of [loadA.job.demoWorkspaceId, loadB.job.demoWorkspaceId]) {
      expect(await unbalancedEntries(migrator, id)).toEqual([]);
    }
    const institutions = await call(
      baseUrl,
      'GET',
      `/api/v1/workspaces/${loadA.job.demoWorkspaceId}/institutions`,
      a.token,
    );
    expect((institutions.body['data'] as { name: string }[]).map((i) => i.name)).toContain(
      'Banco Andino Demo',
    );
    const accounts = (
      await call(baseUrl, 'GET', `/api/v1/workspaces/${loadA.job.demoWorkspaceId}/accounts?limit=50`, a.token)
    ).body['data'] as { notes: string | null }[];
    expect(accounts.every((x) => x.notes?.startsWith('DEMO-'))).toBe(true);
  }, 300_000);

  it('[TC-IDENTITY-DEMO-008] una falla a mitad de la carga deja FAILED (nunca READY) y la limpieza funciona igual', async () => {
    const u = await user(`kc-demo-fail-${randomUUID()}`);
    const { job, outcome } = await loadInProcess({
      ownerId: u.id,
      originId: u.personal,
      anchor: '2026-09-30',
      failAt: 'transactions/2025-06',
    });
    expect(outcome).toBe('FAILED');
    const status = await call(baseUrl, 'GET', `/api/v1/workspaces/${u.personal}/demo-data`, u.token);
    expect(status.body).toMatchObject({ status: 'FAILED', errorCode: 'DEMO_LOAD_FAILED', loadedAt: null });
    const ws = await call(baseUrl, 'GET', `/api/v1/workspaces/${job.demoWorkspaceId}`, u.token);
    expect(ws.body['demoStatus']).toBe('FAILED');
    const cleaned = await call(
      baseUrl,
      'POST',
      `/api/v1/workspaces/${job.demoWorkspaceId}/demo-data/cleanup`,
      u.token,
    );
    expect(cleaned.status).toBe(202);
    await waitStatus(u.token, u.personal, 'PURGED');
    expect(Object.values(await countsOf(job.demoWorkspaceId)).every((n) => n === 0)).toBe(true);
  }, 300_000);
});
