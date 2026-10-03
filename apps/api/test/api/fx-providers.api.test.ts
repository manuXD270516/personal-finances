import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createFxMarketRateJobs, parseFxProviderSettings } from '@pf/fx/interface/fx.module';
import { ApiContract } from '@pf/platform/api';
import { PgOutboxWriter } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Providers de tasas por HTTP contra PostgreSQL real (Testcontainers): atribución, nivel de fallback, estado de los
// providers, revisión de anomalías (roles, idempotencia, auditoría) y aislamiento entre workspaces (openspec
// add-market-rate-providers, tareas 5.1–5.2). Las tasas las registra la ingesta REAL del worker contra un servidor
// HTTP local con las respuestas grabadas (sin red); la API nunca llama a un provider.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const FIXTURES = fileURLToPath(
  new URL('../../../../packages/contexts/fx/test/fixtures/providers/', import.meta.url),
);
const fixture = (name: string) => readFileSync(`${FIXTURES}${name}`, 'utf8');

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let providerServer: Server;
let providerUrl: string;
let worker: Pool;
const routes = new Map<string, string>();
const clock = new FixedClock(Instant.parse('2026-10-02T09:00:00Z'));
const contract = ApiContract.fromFile(resolveContractPath());
const apiLog = capturingLogger('finance-api', 'api');

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
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
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

const expectProblem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code']).toBe(code);
};

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;
const W = (u: User) => `/api/v1/workspaces/${u.ws}`;

let owner: User;
let viewer: User;
let other: User;

/** Un ciclo de la ingesta del worker (pf_worker) para los workspaces dados, con el reloj en `at`. */
async function poll(at: string, workspaces: readonly User[]) {
  clock.set(Instant.parse(at));
  const writer = new PgOutboxWriter(eventSchemaRegistry());
  const jobs = createFxMarketRateJobs({
    pool: worker,
    clock,
    outbox: { append: async (e) => void (await writer.append(e)) },
    workspaces: {
      list: async () => workspaces.map((u) => ({ workspaceId: u.ws, timeZone: 'America/La_Paz' })),
    },
    settings: parseFxProviderSettings({}),
    endpoints: {
      baseUrls: { PARALELO_BO: providerUrl, DOLARAPI_BO: providerUrl },
      allowedHosts: ['127.0.0.1'],
    },
  });
  return jobs.ingestion.poll();
}

beforeAll(async () => {
  providerServer = createServer((req, res) => {
    const body = routes.get(req.url ?? '');
    if (body === undefined) res.writeHead(503).end('{"error":"down"}');
    else res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
  });
  await new Promise<void>((r) => providerServer.listen(0, '127.0.0.1', r));
  providerUrl = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}`;
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  // La API lee la configuración real de roles (paralelo.bo principal, bo.dolarapi.com respaldo) para valorar; nunca
  // consulta a un provider.
  const env = baseEnv(deps, {
    FX_PROVIDER_PRIMARY: 'paralelo_bo',
    FX_PROVIDER_FALLBACK: 'dolarapi_bo',
    FX_PROVIDER_OFFICIAL: 'dolarapi_bo',
  });
  runtime = await createApiRuntime(apiConfig(env), apiLog.logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  owner = await user(`kc-fxp-owner-${randomUUID()}`);
  other = await user(`kc-fxp-other-${randomUUID()}`);
  const v = await user(`kc-fxp-viewer-${randomUUID()}`);
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'VIEWER', 'ACTIVE')`,
          [owner.ws, v.id],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  viewer = { ...v, ws: owner.ws };
  // 09:00Z: paralelo.bo 12.02 (08:53:07.532Z) y bo.dolarapi.com (oficial 12, binance 12.055).
  routes.set('/api/v1/rate', fixture('paralelo-bo/rate.ok.json'));
  routes.set('/v1/dolares', fixture('dolarapi-bo/dolares.ok.json'));
  await poll('2026-10-02T09:00:00Z', [owner, other]);
});

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
  await new Promise<void>((r) => providerServer?.close(() => r()));
});

const PARALELO_ATTRIBUTION = {
  provider: 'PARALELO_BO',
  text: 'Fuente: paralelo.bo',
  url: 'https://paralelo.bo',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};

describe('FX providers por HTTP (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-012] la tasa resuelta y la tasa por id incluyen la atribución de paralelo.bo; la manual no', async () => {
    clock.set(Instant.parse('2026-10-02T09:06:00Z'));
    const latest = await call('GET', `${W(viewer)}/fx-rates/latest?base=USDT&quote=BOB`, {
      token: viewer.token,
    });
    expect(latest.status, JSON.stringify(latest.body)).toBe(200);
    expect(contract.validateResponse('getLatestFxRate', 200, latest.body)).toEqual([]);
    expect(latest.body).toMatchObject({
      rate: { base: 'USDT', quote: 'BOB', value: '12.02' },
      source: 'PROVIDER',
      provider: 'PARALELO_BO',
      selection: 'PRIMARY',
      stale: false,
      ageSeconds: 772,
      attribution: PARALELO_ATTRIBUTION,
    });
    const byId = await call('GET', `${W(viewer)}/fx-rates/${String(latest.body['fxRateId'])}`, {
      token: viewer.token,
    });
    expect(contract.validateResponse('getFxRate', 200, byId.body)).toEqual([]);
    expect(byId.body).toMatchObject({
      provider: 'PARALELO_BO',
      fetchedAt: '2026-10-02T09:00:00.000Z',
      attribution: PARALELO_ATTRIBUTION,
      anomaly: null,
    });
    expect(byId.body).not.toHaveProperty('rawPayload');
    expect(byId.body).not.toHaveProperty('createdBy');
    const manual = await call('POST', `${W(owner)}/fx-rates`, {
      token: owner.token,
      headers: { 'idempotency-key': randomUUID() },
      body: {
        base: 'USD',
        quote: 'BOB',
        value: '11.98',
        rateType: 'P2P',
        asOf: '2026-10-02T09:01:00Z',
        sourceLabel: 'Casa de cambio centro',
      },
    });
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    expect([manual.body['sourceLabel'], manual.body['attribution'], manual.body['provider']]).toEqual([
      'Casa de cambio centro',
      null,
      null,
    ]);
    const official = await call('GET', `${W(viewer)}/fx-rates/latest?base=USD&quote=BOB&rateType=OFFICIAL`, {
      token: viewer.token,
    });
    expect(official.body).toMatchObject({
      rate: { value: '12' },
      selection: 'PRIMARY',
      attribution: {
        provider: 'DOLARAPI_BO',
        text: 'Fuente: bo.dolarapi.com',
        url: 'https://bo.dolarapi.com',
      },
    });
  });

  it('[TC-FX-PROVIDER-015] VIEWER consulta el estado: paralelo.bo principal con su feed, respaldo y carga histórica', async () => {
    clock.set(Instant.parse('2026-10-02T09:45:30Z'));
    const r = await call('GET', `${W(viewer)}/fx-providers/status`, { token: viewer.token });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('getFxProviderStatus', 200, r.body)).toEqual([]);
    const [p, d] = r.body['data'] as Record<string, unknown>[];
    expect(p).toMatchObject({
      provider: 'PARALELO_BO',
      enabled: true,
      health: 'HEALTHY',
      consecutiveFailures: 0,
      pollIntervalSeconds: 900,
      nextAttemptAt: '2026-10-02T10:00:00.000Z',
      attribution: PARALELO_ATTRIBUTION,
    });
    // `fx.provider_run` es de instalación: otras suites del mismo PostgreSQL pueden haber corrido cargas históricas.
    expect(['PENDING', 'COMPLETED']).toContain((p?.['backfill'] as { status: string }).status);
    const feed = (p?.['feeds'] as Record<string, unknown>[])[0];
    expect(feed).toMatchObject({
      base: 'USD',
      quote: 'BOB',
      rateType: 'PARALLEL',
      role: 'PRIMARY',
      ageSeconds: 3142,
      stale: false,
    });
    expect((feed?.['lastRate'] as Record<string, unknown>)['value']).toBe('12.02');
    expect(d).toMatchObject({
      provider: 'DOLARAPI_BO',
      enabled: true,
      backfill: { status: 'NOT_APPLICABLE' },
    });
  });

  it('[TC-FX-PROVIDER-005] listFxRates filtra por origen y provider', async () => {
    const r = await call('GET', `${W(viewer)}/fx-rates?source=PROVIDER&provider=PARALELO_BO`, {
      token: viewer.token,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('listFxRates', 200, r.body)).toEqual([]);
    const data = r.body['data'] as { provider: string; source: string; base: string; rateType: string }[];
    // Mediana + compra + venta por par (TC-FX-PROVIDER-016).
    expect(data.map((x) => `${x.base} ${x.rateType}`).sort()).toEqual([
      'USD PARALLEL',
      'USD PARALLEL_BUY',
      'USD PARALLEL_SELL',
      'USDT PARALLEL',
      'USDT PARALLEL_BUY',
      'USDT PARALLEL_SELL',
    ]);
    expect(data.every((x) => x.provider === 'PARALELO_BO' && x.source === 'PROVIDER')).toBe(true);
  });

  it('[TC-FX-PROVIDER-010] anomalía 13.50: retenida, VIEWER no revisa (403), EDITOR/OWNER confirma con motivo auditado; segunda revisión 409', async () => {
    routes.set('/api/v1/rate', fixture('paralelo-bo/rate.anomaly-13.50.json'));
    await poll('2026-10-02T09:45:00Z', [owner, other]);
    clock.set(Instant.parse('2026-10-02T09:50:00Z'));
    const list = await call('GET', `${W(viewer)}/fx-rates?source=PROVIDER&provider=PARALELO_BO&base=USD`, {
      token: viewer.token,
    });
    const jump = (list.body['data'] as Record<string, unknown>[]).find((x) => x['value'] === '13.5')!;
    expect(jump['anomaly']).toMatchObject({ variationPct: '12.3128', thresholdPct: '5', status: 'PENDING' });
    const before = await call('GET', `${W(viewer)}/fx-rates/latest?base=USD&quote=BOB&rateType=PARALLEL`, {
      token: viewer.token,
    });
    expect((before.body['rate'] as { value: string }).value).toBe('12.02');

    const path = `${W(owner)}/fx-rates/${String(jump['id'])}/anomaly-review`;
    const body = { decision: 'CONFIRM', reason: 'devaluación anunciada' };
    expectProblem(
      await call('POST', path, { token: viewer.token, body, headers: { 'idempotency-key': randomUUID() } }),
      403,
      'INSUFFICIENT_ROLE',
    );
    expectProblem(await call('POST', path, { token: owner.token, body }), 428, 'IDEMPOTENCY_KEY_REQUIRED');
    const key = randomUUID();
    const ok = await call('POST', path, { token: owner.token, body, headers: { 'idempotency-key': key } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(contract.validateResponse('reviewFxRateAnomaly', 200, ok.body)).toEqual([]);
    expect(ok.body['anomaly']).toMatchObject({
      status: 'CONFIRMED',
      reviewedBy: owner.id,
      reviewedAt: '2026-10-02T09:50:00.000Z',
      reason: 'devaluación anunciada',
    });
    const replay = await call('POST', path, {
      token: owner.token,
      body,
      headers: { 'idempotency-key': key },
    });
    expect([replay.status, replay.headers.get('idempotent-replayed')]).toEqual([200, 'true']);
    const after = await call('GET', `${W(viewer)}/fx-rates/latest?base=USD&quote=BOB&rateType=PARALLEL`, {
      token: viewer.token,
    });
    expect((after.body['rate'] as { value: string }).value).toBe('13.5');
    expectProblem(
      await call('POST', path, {
        token: owner.token,
        body: { decision: 'REJECT', reason: 'otra vez' },
        headers: { 'idempotency-key': randomUUID() },
      }),
      409,
      'FX_RATE_ANOMALY_ALREADY_REVIEWED',
    );
    const normal = (list.body['data'] as Record<string, unknown>[]).find((x) => x['value'] === '12.02')!;
    expectProblem(
      await call('POST', `${W(owner)}/fx-rates/${String(normal['id'])}/anomaly-review`, {
        token: owner.token,
        body,
        headers: { 'idempotency-key': randomUUID() },
      }),
      422,
      'FX_RATE_NOT_ANOMALOUS',
    );
    const app = await connect(deps.databaseUrl);
    try {
      const audit = await inTx(
        app,
        { userId: owner.id, workspaceId: owner.ws },
        async () =>
          (
            await app.query<{ action: string; reason: string; actor_user_id: string }>(
              `SELECT action, reason, actor_user_id::text FROM audit.audit_log WHERE aggregate_id = $1`,
              [jump['id']],
            )
          ).rows,
      );
      expect(audit).toEqual([
        {
          action: 'fx.exchange_rate.anomaly_reviewed',
          reason: 'devaluación anunciada',
          actor_user_id: owner.id,
        },
      ]);
    } finally {
      await app.end();
    }
  });

  it('aislamiento: la copia del otro workspace sigue pendiente y no puede revisarse desde este (404)', async () => {
    const list = await call('GET', `${W(other)}/fx-rates?source=PROVIDER&provider=PARALELO_BO&base=USD`, {
      token: other.token,
    });
    const otherJump = (list.body['data'] as Record<string, unknown>[]).find((x) => x['value'] === '13.5')!;
    expect((otherJump['anomaly'] as { status: string }).status).toBe('PENDING');
    expectProblem(
      await call('POST', `${W(owner)}/fx-rates/${String(otherJump['id'])}/anomaly-review`, {
        token: owner.token,
        body: { decision: 'CONFIRM', reason: 'no es mía' },
        headers: { 'idempotency-key': randomUUID() },
      }),
      404,
      'RESOURCE_NOT_FOUND',
    );
  });
  it('[TC-FX-PROVIDER-007] con el principal caído y obsoleto (65 min) la API valora con el respaldo y lo informa', async () => {
    // paralelo.bo (última aceptada: 13.50 de las 09:40Z) falla a las 10:40Z; bo.dolarapi.com publica a las 10:30Z.
    routes.delete('/api/v1/rate');
    routes.set(
      '/v1/dolares',
      fixture('dolarapi-bo/dolares.ok.json').replace('2026-10-02T08:50:00.000Z', '2026-10-02T10:30:00.000Z'),
    );
    await poll('2026-10-02T10:40:00Z', [owner]);
    clock.set(Instant.parse('2026-10-02T10:45:00Z'));
    const latest = await call('GET', `${W(viewer)}/fx-rates/latest?base=USD&quote=BOB&rateType=PARALLEL`, {
      token: viewer.token,
    });
    expect(latest.body).toMatchObject({
      rate: { value: '12.055' },
      provider: 'DOLARAPI_BO',
      selection: 'FALLBACK',
      stale: false,
      ageSeconds: 900,
    });
    const status = await call('GET', `${W(viewer)}/fx-providers/status`, { token: viewer.token });
    const paralelo = (status.body['data'] as Record<string, unknown>[])[0];
    expect(paralelo).toMatchObject({
      health: 'DOWN',
      consecutiveFailures: 1,
      lastError: { code: 'PROVIDER_UNAVAILABLE', httpStatus: 503 },
    });
  });
});
