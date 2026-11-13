/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  runForecastRunner,
  runForecastSchedule,
  type ForecastingRuntime,
} from '@pf/forecasting/interface/forecasting.module';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { ApiContract } from '@pf/platform/api';
import { PgOutboxWriter } from '@pf/platform/events';
import { FixedClock, Instant, dec } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger, workerConfig } from '../support/harness.js';

// Pronósticos por HTTP contra PostgreSQL real y un servicio `finance-ml` simulado (openspec add-ml-forecasting-service,
// tareas 3, 5 y 6): solicitud manual (202 + operación), una activa por workspace, roles, ejecución del worker (reclamo,
// lectura, llamada sin conexión, publicación con hecho y recorrido), consulta vigente por horizonte, aislamiento entre
// workspaces, servicio caído con reintentos y deshabilitado. Las respuestas se validan contra el OpenAPI.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
const clock = new FixedClock(Instant.parse('2026-11-05T16:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const workerLog = capturingLogger('finance-worker', 'worker');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let disabledRuntime: ApiRuntime;
let baseUrl: string;
let disabledUrl: string;
let worker: Pool;
let forecasting: ForecastingRuntime;
let fake: Server;
let fakeUp = true;
let fakeCalls = 0;

interface Reply {
  status: number;
  body: Record<string, any>;
  headers: Headers;
  text: string;
}

async function tokenFor(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub,
    iat: now - 5,
    exp: now + 300,
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
  base: string,
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] ??= 'application/json';
  }
  const res = await fetch(`${base}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  let parsed: Record<string, any> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, any>) : {};
  } catch {
    /* cuerpo no JSON */
  }
  return { status: res.status, headers: res.headers, body: parsed, text };
}

async function user(sub: string, base = baseUrl) {
  const token = await tokenFor(sub);
  const me = await call(base, 'GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId, base };
}
type User = Awaited<ReturnType<typeof user>>;
const W = (u: User) => `/api/v1/workspaces/${u.ws}`;

async function join(owner: User, member: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
          [owner.ws, member.id, role],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  return { ...member, ws: owner.ws };
}

const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(u.base, 'POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body !== undefined ? { body } : {}),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const get = (u: User, path: string) => call(u.base, 'GET', `${W(u)}${path}`, { token: u.token });
const ok = async (r: Promise<Reply>, status = 201) => {
  const reply = await r;
  expect(reply.status, `${reply.text} ${apiErrors()}`).toBe(status);
  return reply.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, `${r.text} ${apiErrors()}`).toBe(status);
  expect(r.body['code'], r.text).toBe(code);
};
const checked = (operation: string, status: number, r: Reply) => {
  expect(r.status, `${r.text} ${apiErrors()}`).toBe(status);
  expect(contract.validateResponse(operation, status, r.body), r.text).toEqual([]);
  return r.body;
};

const bob = (amount: string) => ({ amount, currency: 'BOB' });
const MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

/** Workspace con 8 periodos terminados de gasto en una categoría (datos ficticios). */
async function scenario(label: string) {
  const owner = await user(`kc-fc-${label}-${randomUUID()}`);
  const editor = await join(owner, await user(`kc-fc-${label}-ed-${randomUUID()}`), 'EDITOR');
  const viewer = await join(owner, await user(`kc-fc-${label}-vw-${randomUUID()}`), 'VIEWER');
  const account = (
    await ok(
      post(owner, '/accounts', {
        name: 'Banco BOB',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: bob('20000.00'), date: '2026-01-01' },
      }),
    )
  )['id'] as string;
  const group = (await ok(post(owner, '/category-groups', { name: 'Vida diaria', kind: 'EXPENSE' })))[
    'id'
  ] as string;
  const category = (await ok(post(owner, '/categories', { groupId: group, name: 'Restaurantes' })))[
    'id'
  ] as string;
  await ok(post(owner, '/periods', { through: '2027-03-31' }), 200);
  for (const [i, m] of MONTHS.entries()) {
    const amount = (900 + i * 25).toFixed(2);
    await ok(
      post(owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: `${m}-10`,
        accountId: account,
        amount: bob(amount),
        splits: [{ amount: bob(amount), categoryId: category }],
      }),
    );
  }
  return { owner, editor, viewer, category, group };
}

/** Servicio `finance-ml` simulado: responde un pronóstico válido por cada serie pedida (o 503 si está caído). */
function startFakeService(token: string): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        fakeCalls += 1;
        if (!fakeUp) {
          res.writeHead(503, { 'content-type': 'application/json' }).end('{"code":"BUSY","detail":"down"}');
          return;
        }
        if (req.headers['authorization'] !== `Bearer ${token}`) {
          res.writeHead(401).end('{}');
          return;
        }
        const body = JSON.parse(raw) as {
          requestId: string;
          series: {
            ref: string;
            scale: number;
            horizon: number;
            points: { period: string; value: string }[];
          }[];
        };
        const shift = (p: string, n: number) => {
          const [y, m] = p.split('-').map(Number) as [number, number];
          const i = y * 12 + (m - 1) + n;
          return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
        };
        const response = {
          schemaVersion: '1',
          requestId: body.requestId,
          serviceVersion: '0.1.0',
          durationMs: 3,
          results: body.series.map((s) => {
            const last = Math.round(Number(s.points.at(-1)!.value));
            const f = (n: number) => n.toFixed(s.scale);
            return {
              ref: s.ref,
              status: 'OK',
              error: null,
              model: { name: 'mean_last_n', version: '1', selectedBy: 'fixed' },
              baseline: { method: 'MEAN_LAST_N', n: 6 },
              points: Array.from({ length: s.horizon }, (_, i) => ({
                period: shift(s.points.at(-1)!.period, i + 1),
                monthsAhead: i + 1,
                prediction: f(last),
                lower80: f(last * 0.9),
                upper80: f(last * 1.1),
                lower95: f(last * 0.8),
                upper95: f(last * 1.2),
                baselineValue: f(last),
              })),
            };
          }),
        };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
      });
    });
  });
}

const runWorker = () => runForecastRunner(forecasting, workerLog.logger);

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  const identity = {
    jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
  };
  const serviceToken = randomBytes(32).toString('hex');
  const started = await startFakeService(serviceToken);
  fake = started.server;
  const tokenFile = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'pf-ml-')), 'ml-service-token');
  writeFileSync(tokenFile, serviceToken);

  runtime = await createApiRuntime(apiConfig(baseEnv(deps, { FORECASTING_ENABLED: 'true' })), apiLog.logger, {
    clock,
    identity,
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  disabledRuntime = await createApiRuntime(apiConfig(baseEnv(deps)), apiLog.logger, { clock, identity });
  disabledUrl = await disabledRuntime.listen(0, '127.0.0.1');

  // Composición del worker (pf_worker): la misma que create-worker-runtime, con el servicio simulado.
  const audit = createAuditRuntime({
    pool: worker,
    clock,
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(worker),
    machines: LIFECYCLE_MACHINES,
  });
  const finance = financeRuntimes({
    pool: worker,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    lifecycleQuery: audit.lifecycleQuery,
    history: audit.history,
    logger: workerLog.logger,
    config: workerConfig(
      baseEnv(deps, {
        FORECASTING_ENABLED: 'true',
        FORECASTING_SERVICE_URL: started.url,
        FORECASTING_SERVICE_TOKEN_FILE: tokenFile,
      }),
    ),
    outbox: new PgOutboxWriter(eventSchemaRegistry()),
  });
  forecasting = finance.forecasting;
}, 240_000);

afterAll(async () => {
  await runtime?.close();
  await disabledRuntime?.close();
  await worker?.end();
  await new Promise((r) => fake?.close(r));
});

/** Termina las corridas activas del workspace (el worker las procesa hasta que no quede ninguna pendiente). */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    const out = await runWorker();
    if (out.kind === 'IDLE') return;
  }
}

describe('solicitud manual, ejecución del worker y consulta vigente', () => {
  let s: Awaited<ReturnType<typeof scenario>>;
  let runId: string;
  beforeAll(async () => {
    s = await scenario('flow');
  }, 180_000);

  it('[TC-FORECAST-SERVICE-032] sin corridas completadas la consulta informa que no hay pronóstico', async () => {
    const latest = checked('getLatestForecast', 200, await get(s.viewer, '/forecasts/latest'));
    expect(latest).toMatchObject({ status: 'NONE', stale: false, run: null, series: [] });
  });

  it('[TC-FORECAST-SERVICE-007] un VIEWER no puede solicitar corridas (INSUFFICIENT_ROLE)', async () => {
    problem(await post(s.viewer, '/forecasts'), 403, 'INSUFFICIENT_ROLE');
  });

  it('[TC-FORECAST-SERVICE-005] un EDITOR solicita una corrida y recibe la operación pendiente auditada', async () => {
    const reply = await post(s.editor, '/forecasts');
    const op = checked('requestForecastRun', 202, reply);
    runId = op['id'] as string;
    expect(op).toMatchObject({
      kind: 'FORECAST',
      status: 'PENDING',
      resource: { type: 'forecast-run', id: runId },
    });
    expect(reply.headers.get('location')).toBe(`${W(s.editor)}/forecasts/${runId}`);
    const client = await worker.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
        [s.owner.ws],
      );
      const audits = await client.query<{ actor_user_id: string }>(
        `SELECT actor_user_id FROM audit.audit_log WHERE action = 'forecasting.forecast_run.requested' AND aggregate_id = $1`,
        [runId],
      );
      await client.query('COMMIT');
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]?.actor_user_id).toBe(s.editor.id);
    } finally {
      client.release();
    }
  });

  it('[TC-FORECAST-SERVICE-006] una segunda solicitud con una corrida activa se rechaza con FORECAST_RUN_IN_PROGRESS', async () => {
    problem(await post(s.owner, '/forecasts'), 409, 'FORECAST_RUN_IN_PROGRESS');
  });

  it('[TC-FORECAST-SERVICE-036] [TC-FORECAST-SERVICE-040] el worker completa la corrida: hecho sin montos y recorrido', async () => {
    await drain();
    const run = checked('getForecastRun', 200, await get(s.viewer, `/forecasts/${runId}`));
    expect(run).toMatchObject({
      status: 'COMPLETED',
      asOfPeriod: '2026-10',
      trigger: 'MANUAL',
      reportingCurrency: 'BOB',
    });
    expect(run['datasetSnapshotId']).toMatch(/^sha256:[0-9a-f]{64}$/);
    const { rows } = await worker.query<{ envelope: { payload: Record<string, unknown> } }>(
      `SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = 'forecast.ForecastGenerated'`,
      [s.owner.ws],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.envelope.payload).toMatchObject({
      forecastRunId: runId,
      asOfPeriod: '2026-10',
      trigger: 'MANUAL',
    });
    expect(JSON.stringify(rows[0]?.envelope.payload)).not.toMatch(/"\d+\.\d{2}"/);
    const lifecycle = checked(
      'getForecastRunLifecycle',
      200,
      await get(s.viewer, `/forecasts/${runId}/lifecycle`),
    );
    expect(lifecycle['path']).toEqual(['REQUESTED', 'RUNNING', 'COMPLETED']);
    const steps = (lifecycle['items'] as { transition: string }[]).map((t) => t.transition);
    expect(steps).toEqual(['REQUEST', 'START', 'COMPLETE']);
  });

  it('[TC-FORECAST-SERVICE-031] un VIEWER consulta el pronóstico vigente con horizonte 3 y la preparación de cada serie', async () => {
    const latest = checked('getLatestForecast', 200, await get(s.viewer, '/forecasts/latest?horizon=3'));
    expect(latest['status']).toBe('AVAILABLE');
    const total = (latest['series'] as any[]).find((x) => x.scope === 'TOTAL_EXPENSE');
    expect(total.readiness).toBe('MODEL');
    expect(total.points).toHaveLength(3);
    expect(total.points[0]).toMatchObject({ period: '2026-11', monthsAhead: 1, periodStart: '2026-11-01' });
    expect(total.points[0].prediction.currency).toBe('BOB');
    const filtered = checked(
      'getLatestForecast',
      200,
      await get(s.viewer, `/forecasts/latest?scope=OTHER_CATEGORIES&scopeRef=${s.group}&horizon=1`),
    );
    // Una transacción por periodo (< 3 en más del 25 % de los periodos): la categoría se agrupa en «Otras categorías».
    const [other] = filtered['series'] as any[];
    expect(other).toMatchObject({
      scope: 'OTHER_CATEGORIES',
      scopeRef: s.group,
      groupedCategoryIds: [s.category],
    });
    expect(other.points).toHaveLength(1);
  });

  it('[TC-FORECAST-SERVICE-027] un horizonte distinto de 1, 3, 6 o 12 se rechaza con INVALID_FILTER', async () => {
    problem(await get(s.viewer, '/forecasts/latest?horizon=4'), 400, 'INVALID_FILTER');
  });

  it('[TC-FORECAST-SERVICE-033] una corrida de otro workspace no existe y el listado no la revela', async () => {
    const stranger = await user(`kc-fc-stranger-${randomUUID()}`);
    const r = await call(stranger.base, 'GET', `${W(stranger)}/forecasts/${runId}`, {
      token: stranger.token,
    });
    problem(r, 404, 'RESOURCE_NOT_FOUND');
    const page = checked('listForecastRuns', 200, await get(stranger, '/forecasts'));
    expect(page['items']).toEqual([]);
    const own = checked('listForecastRuns', 200, await get(s.viewer, '/forecasts?status=COMPLETED'));
    expect((own['items'] as any[]).map((x) => x.id)).toEqual([runId]);
  });

  it('[TC-FORECAST-SERVICE-029] con el servicio caído la corrida se reintenta y se sigue mostrando la vigente', async () => {
    fakeUp = false;
    const op = checked('requestForecastRun', 202, await post(s.owner, '/forecasts'));
    const failedRun = op['id'] as string;
    const calls = fakeCalls;
    const outcome = await runWorker();
    expect(outcome.kind).toBe('RETRY');
    expect(fakeCalls).toBe(calls + 1);
    const run = checked('getForecastRun', 200, await get(s.viewer, `/forecasts/${failedRun}`));
    expect(run).toMatchObject({ status: 'REQUESTED', attempts: 1, failureReason: 'SERVICE_UNAVAILABLE' });
    const latest = checked('getLatestForecast', 200, await get(s.viewer, '/forecasts/latest'));
    expect(latest['status']).toBe('AVAILABLE');
    expect(latest['run']).toMatchObject({ id: runId });
    // La espera de 5 minutos no se cumplió: el ejecutor queda ocioso.
    expect((await runWorker()).kind).toBe('IDLE');
    // El servicio vuelve y, cumplida la espera, la corrida se completa y reemplaza a la vigente.
    fakeUp = true;
    clock.advance(6 * 60_000);
    expect((await runWorker()).kind).toBe('COMPLETED');
    const replaced = checked('getForecastRun', 200, await get(s.viewer, `/forecasts/${runId}`));
    expect(replaced['status']).toBe('SUPERSEDED');
  });

  it('[TC-FORECAST-SERVICE-008] el trabajo diario crea una corrida programada cuando termina un periodo nuevo', async () => {
    const before = checked('listForecastRuns', 200, await get(s.owner, '/forecasts'))['items'] as any[];
    clock.set(Instant.parse('2026-12-01T09:15:00Z')); // terminó 2026-11
    const summary = await runForecastSchedule(forecasting, workerLog.logger, 'manual');
    expect(summary.created).toBeGreaterThanOrEqual(1);
    const after = checked('listForecastRuns', 200, await get(s.owner, '/forecasts'))['items'] as any[];
    expect(after.length).toBe(before.length + 1);
    expect(after.find((r) => r.status === 'REQUESTED')).toMatchObject({
      trigger: 'SCHEDULED',
      requestedBy: null,
    });
    await drain();
  });
});

describe('costos conocidos y descomposición del pronóstico (add-expense-forecasts)', () => {
  let s: Awaited<ReturnType<typeof scenario>>;
  let account: string;
  const recurring = async (
    name: string,
    kind: string,
    amount: string,
    cadence: string,
    startDate: string,
    categoryId?: string,
  ) =>
    ok(
      post(s.owner, '/recurring', {
        name,
        kind,
        template: {
          accountId: account,
          amount: { type: 'FIXED', amount: bob(amount) },
          ...(categoryId ? { categoryId } : {}),
          schedule: { cadence, startDate },
          materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
        },
      }),
    );
  beforeAll(async () => {
    clock.set(Instant.parse('2026-11-05T16:00:00Z'));
    s = await scenario('known');
    const accounts = checked('listAccounts', 200, await get(s.owner, '/accounts'));
    account = ((accounts['data'] ?? accounts['items']) as any[])[0].id as string;
    const rent = await recurring('Alquiler', 'EXPENSE', '2500.00', 'MONTHLY', '2026-11-10', s.category);
    // Una ocurrencia resuelta (aprobada): la historia variable la resta y el worker la lee sin contexto de usuario.
    const first = (
      (await ok(get(s.owner, `/recurring/${rent['id'] as string}/occurrences?limit=5`), 200))['data'] as any[]
    )[0];
    await ok(post(s.owner, `/recurring/occurrences/${first.id}/materialize`, {}), 201);
    await recurring('Seguro anual', 'EXPENSE', '900.00', 'ANNUAL', '2026-03-15', s.category);
    await recurring('Sueldo', 'INCOME', '8000.00', 'MONTHLY', '2026-11-05');
    // Un préstamo activo: el worker lee su cronograma (interés, cargos, seguro) sin contexto de usuario.
    const loan = await ok(
      post(s.owner, '/loans', {
        name: 'Préstamo vehicular',
        account: { create: { name: 'Préstamo vehicular fc' } },
        disbursementAccountId: account,
        principal: bob('50000.00'),
        annualRate: '0.115',
        termInstallments: 24,
        disbursementDate: '2026-10-15',
        firstDueDate: '2026-11-15',
      }),
    );
    await ok(post(s.owner, `/loans/${loan['id'] as string}/disburse`, {}), 200);
    await ok(post(s.editor, '/forecasts'), 202);
    await drain();
  }, 240_000);

  it('[TC-FORECAST-EXPENSE-001] el punto de 2026-12 separa los conocidos (Alquiler 2500.00) de la parte variable predicha', async () => {
    const latest = checked('getLatestForecast', 200, await get(s.viewer, '/forecasts/latest?horizon=12'));
    expect(latest['status']).toBe('AVAILABLE');
    const total = (latest['series'] as any[]).find((x) => x.scope === 'TOTAL_EXPENSE');
    const dic = total.points.find((p: any) => p.period === '2026-12');
    // 2500.00 del alquiler más el interés de la cuota del préstamo (nunca su capital).
    expect(dec(dic.components.knownFuture.amount).gt('2500.00')).toBe(true);
    expect(dec(dic.components.knownFuture.amount).lt('3100.00')).toBe(true);
    const sum = dec(dic.components.knownFuture.amount).plus(dic.components.predictedVariable.amount);
    expect(dic.prediction.amount).toBe(sum.toFixed(2));
    expect(dic.drivers.map((d: any) => d.type)).toContain('KNOWN_RECURRING');
    expect(total.model).toMatchObject({ name: 'mean_last_n' });
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(total.confidence);
  });

  it('[TC-FORECAST-EXPENSE-007] la cuota del préstamo aporta solo su interés como conocido (sin el capital) y no tiene categoría', async () => {
    const r = checked(
      'listForecastKnownItems',
      200,
      await get(s.viewer, '/forecasts/latest/known-items?scope=TOTAL_EXPENSE&period=2026-12'),
    );
    const loanItem = (r['items'] as any[]).find((i) => i.kind === 'LOAN_INTEREST');
    expect(loanItem).toMatchObject({ amountType: 'SCHEDULE', sourceRef: { context: 'DEBT' } });
    expect(loanItem.label).toMatch(/^Préstamo vehicular — cuota \d+$/);
    // Interés del mes: el capital de 50000.00 al 11.50 % anual (30/360) ronda los 479 BOB, nunca la cuota entera.
    expect(dec(loanItem.amount.amount).gt('300')).toBe(true);
    expect(dec(loanItem.amount.amount).lt('600')).toBe(true);
  });

  it('[TC-FORECAST-EXPENSE-004] el seguro anual fuera del horizonte de generación aparece como conocido de 2027-03', async () => {
    const r = checked(
      'listForecastKnownItems',
      200,
      await get(s.viewer, '/forecasts/latest/known-items?scope=TOTAL_EXPENSE&period=2027-03'),
    );
    const items = r['items'] as any[];
    expect(items.map((i) => i.label)).toContain('Seguro anual');
    expect(items.find((i) => i.label === 'Seguro anual')).toMatchObject({
      date: '2027-03-15',
      kind: 'EXPENSE',
      amountType: 'FIXED',
      amount: bob('900.00'),
      originalAmount: null,
      sourceRef: { context: 'COMMITMENTS' },
    });
  });

  it('[TC-FORECAST-EXPENSE-001] los conocidos de una categoría y de un periodo sin ellos; los ingresos no son gasto', async () => {
    const cat = checked(
      'listForecastKnownItems',
      200,
      await get(
        s.viewer,
        `/forecasts/latest/known-items?scope=OTHER_CATEGORIES&scopeRef=${s.group}&period=2026-12`,
      ),
    );
    expect((cat['items'] as any[]).map((i) => i.label)).toEqual(['Alquiler']);
    const expense = checked(
      'listForecastKnownItems',
      200,
      await get(s.viewer, '/forecasts/latest/known-items?scope=TOTAL_EXPENSE&period=2026-12'),
    );
    expect((expense['items'] as any[]).map((i) => i.label)).not.toContain('Sueldo');
    const income = checked(
      'listForecastKnownItems',
      200,
      await get(s.viewer, '/forecasts/latest/known-items?scope=TOTAL_INCOME&period=2026-12'),
    );
    expect((income['items'] as any[]).map((i) => i.label)).toEqual(['Sueldo']);
    const none = checked(
      'listForecastKnownItems',
      200,
      await get(s.viewer, '/forecasts/latest/known-items?scope=TOTAL_EXPENSE&period=2030-01'),
    );
    expect(none['items']).toEqual([]);
  });

  it('[TC-FORECAST-EXPENSE-016] un alcance desconocido o un periodo mal formado se rechazan con INVALID_FILTER y un periodo ausente con VALIDATION_FAILED', async () => {
    problem(
      await get(s.viewer, '/forecasts/latest/known-items?scope=NOPE&period=2026-12'),
      400,
      'INVALID_FILTER',
    );
    problem(
      await get(s.viewer, '/forecasts/latest/known-items?scope=TOTAL_EXPENSE&period=diciembre'),
      400,
      'INVALID_FILTER',
    );
    problem(
      await get(s.viewer, '/forecasts/latest/known-items?scope=TOTAL_EXPENSE'),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('banda del gasto variable predicho en el calendario y en el Home (add-predicted-cash-flow-band)', () => {
  let s: Awaited<ReturnType<typeof scenario>>;
  beforeAll(async () => {
    clock.set(Instant.parse('2026-11-05T16:00:00Z'));
    s = await scenario('band');
  }, 180_000);

  it('[TC-REPORTING-PREDICTED-006] sin ninguna corrida el calendario informa que no hay pronóstico y lo demás no cambia', async () => {
    const calendar = checked('getCashFlowCalendar', 200, await get(s.viewer, '/reports/cash-flow-calendar'));
    const bobBlock = (calendar['currencies'] as any[]).find((c) => c.currency === 'BOB');
    expect(bobBlock.predicted).toMatchObject({
      status: 'NOT_AVAILABLE',
      reason: 'NO_FORECAST',
      series: [],
      lowest: null,
      shortfallLikelihood: 'NOT_AVAILABLE',
    });
    const summary = checked('getReportSummary', 200, await get(s.viewer, '/reports/summary'));
    expect(summary['forecast']).toBeNull();
    expect((summary['cashFlow'] as any).predictedShortfall).toBeNull();
  });

  it('[TC-FORECAST-CASHFLOW-001] [TC-REPORTING-PREDICTED-001] con la corrida completada el calendario trae la banda de BOB sin tocar la serie principal', async () => {
    const before = checked('getCashFlowCalendar', 200, await get(s.viewer, '/reports/cash-flow-calendar'));
    checked('requestForecastRun', 202, await post(s.editor, '/forecasts'));
    await drain();
    const latest = checked(
      'getLatestForecast',
      200,
      await get(s.viewer, '/forecasts/latest?scope=LIQUID_VARIABLE_OUTFLOW&horizon=6'),
    );
    const liquid = (latest['series'] as any[]).filter((x) => x.scope === 'LIQUID_VARIABLE_OUTFLOW');
    expect(liquid.map((x) => x.currency)).toEqual(['BOB']);
    expect(liquid[0].points.map((p: any) => p.period)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    // El pronóstico vigente sin el filtro no trae la serie del gasto líquido.
    const plain = checked('getLatestForecast', 200, await get(s.viewer, '/forecasts/latest'));
    expect((plain['series'] as any[]).some((x) => x.scope === 'LIQUID_VARIABLE_OUTFLOW')).toBe(false);

    const calendar = checked(
      'getCashFlowCalendar',
      200,
      await get(s.viewer, '/reports/cash-flow-calendar?horizon=30'),
    );
    const bobBlock = (calendar['currencies'] as any[]).find((c) => c.currency === 'BOB');
    const main = (before['currencies'] as any[]).find((c) => c.currency === 'BOB');
    expect(bobBlock.predicted).toMatchObject({
      status: 'AVAILABLE',
      reason: null,
      intervalLevel: '0.8',
      stale: false,
    });
    expect(bobBlock.predicted.series).toHaveLength(31);
    // Con un gasto esperado positivo, el saldo con gasto esperado queda bajo la serie principal y el del gasto alto, bajo el esperado.
    const last = bobBlock.predicted.series.at(-1);
    expect(dec(last.expected.amount).lte(dec(bobBlock.series.at(-1).balance.amount))).toBe(true);
    expect(dec(last.high.amount).lte(dec(last.expected.amount))).toBe(true);
    expect(dec(last.expected.amount).lte(dec(last.low.amount))).toBe(true);
    // La serie principal, el riesgo y la alerta no cambian por la banda.
    expect(bobBlock.series).toEqual(main.series);
    expect(bobBlock.risk).toBe(main.risk);
    expect(bobBlock.firstShortfallDate).toBe(main.firstShortfallDate);

    const summary = checked('getReportSummary', 200, await get(s.viewer, '/reports/summary'));
    expect((summary['forecast'] as any).expectedSpending).toMatchObject({
      period: '2026-11',
      stale: false,
    });
    expect((summary['cashFlow'] as any).predictedShortfall).toMatchObject({ currency: 'BOB' });
  });
});

describe('función deshabilitada en la instalación', () => {
  it('[TC-FORECAST-SERVICE-002] la consulta informa que no está habilitada y la solicitud se rechaza', async () => {
    const owner = await user(`kc-fc-off-${randomUUID()}`, disabledUrl);
    const latest = checked('getLatestForecast', 200, await get(owner, '/forecasts/latest'));
    expect(latest).toMatchObject({ status: 'DISABLED', series: [], run: null });
    problem(await post(owner, '/forecasts'), 409, 'FORECASTING_DISABLED');
  });

  it('[TC-REPORTING-PREDICTED-006] con la función deshabilitada el calendario no tiene bandas y el Home no cambia', async () => {
    const owner = await user(`kc-fc-off2-${randomUUID()}`, disabledUrl);
    const calendar = checked('getCashFlowCalendar', 200, await get(owner, '/reports/cash-flow-calendar'));
    for (const c of calendar['currencies'] as any[]) {
      expect(c.predicted).toMatchObject({ status: 'NOT_AVAILABLE', reason: 'DISABLED', series: [] });
    }
    const summary = checked('getReportSummary', 200, await get(owner, '/reports/summary'));
    expect(summary['forecast']).toBeNull();
  });
});
