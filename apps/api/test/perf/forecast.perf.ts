import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import { runForecastRunner, type ForecastingRuntime } from '@pf/forecasting/interface/forecasting.module';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { loadConfig } from '@pf/platform/config';
import { PgOutboxWriter } from '@pf/platform/events';
import { systemClock } from '@pf/shared-kernel';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Client, Pool } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { LARGE_MAIN_WORKSPACE_ID } from '../../src/seed/large/large-plan.js';
import { MINIMAL_USERS, runSeed } from '../../src/seed/run-seed.js';
import { apiConfig, baseEnv, capturingLogger, workerConfig } from '../support/harness.js';
import { recordSuiteLoad } from './background-load.js';
import { perfApiEnv } from './perf-env.js';

/**
 * NFR-PERF-012 (TC-FORECAST-SERVICE-028, Should; add-ml-forecasting-service 8.7): una corrida de pronóstico completa
 * (todas las series y horizonte de 12 periodos) sobre el workspace principal del Large Seed, con el servicio
 * `finance-ml` REAL, termina en ≤ 300 s. La mide de punta a punta: desde la solicitud (`POST /forecasts`) hasta la
 * corrida `COMPLETED` tras lo que hace el worker (lectura de los flujos, llamada al servicio y publicación).
 *
 * El servicio se levanta con Testcontainers desde la imagen `finance-ml` (`FORECAST_PERF_ML_IMAGE`, por omisión
 * `pfos/finance-ml:local`; el job `perf` del nightly la construye antes de `pnpm perf:bench`). Con
 * `FORECAST_PERF_SERVICE_URL` y `FORECAST_PERF_SERVICE_TOKEN_FILE` usa en cambio un servicio ya levantado (p. ej. el
 * perfil `ml` local). Corre en el job nightly `perf`; no bloquea los PR. Bloqueante desde el inicio (umbral holgado).
 */
const deps = inject('deps');
recordSuiteLoad(import.meta.url, deps.superuserUrl);
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
/** NFR-PERF-012 (docs/02): corrida completa por workspace ≤ 5 min. */
const BUDGET_MS = 300_000;
const ML_IMAGE = process.env['FORECAST_PERF_ML_IMAGE'] ?? 'pfos/finance-ml:local';
const WS = LARGE_MAIN_WORKSPACE_ID;
const W = `/api/v1/workspaces/${WS}`;
const apiLog = capturingLogger('finance-api', 'api', 'warn');
const workerLog = capturingLogger('finance-worker', 'worker', 'warn');

let runtime: ApiRuntime;
let worker: Pool;
let forecasting: ForecastingRuntime;
let service: StartedTestContainer | undefined;
let baseUrl = '';
let token = '';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

/** Servicio de pronósticos real: el que indica el entorno o un contenedor de la imagen `finance-ml`. */
async function startService(): Promise<{ url: string; tokenFile: string }> {
  const external = process.env['FORECAST_PERF_SERVICE_URL'];
  const externalToken = process.env['FORECAST_PERF_SERVICE_TOKEN_FILE'];
  if (external && externalToken) return { url: external, tokenFile: externalToken };
  const secret = randomBytes(32).toString('hex');
  const tokenFile = pathJoin(mkdtempSync(pathJoin(tmpdir(), 'pf-ml-perf-')), 'ml-service-token');
  writeFileSync(tokenFile, secret);
  service = await new GenericContainer(ML_IMAGE)
    .withEnvironment({ ML_SERVICE_TOKEN_FILE: '/tmp/ml-service-token', ML_LOG_LEVEL: 'WARNING' })
    .withCopyContentToContainer([{ content: secret, target: '/tmp/ml-service-token', mode: 0o444 }])
    .withExposedPorts(8090)
    .withWaitStrategy(Wait.forHttp('/health/ready', 8090).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();
  return { url: `http://${service.getHost()}:${service.getMappedPort(8090)}`, tokenFile };
}

beforeAll(async () => {
  const admin = new Client({ connectionString: deps.superuserUrl });
  await admin.connect();
  try {
    const present = await admin.query('SELECT 1 FROM iam.workspace WHERE id = $1', [WS]);
    if (present.rowCount === 0) {
      await runSeed(
        loadConfig('seed', {
          PFOS_ENV: 'ci',
          LOG_LEVEL: 'warn',
          DATABASE_URL: deps.databaseUrl,
          OIDC_ISSUER_URL: ISSUER,
        }),
        capturingLogger('finance-api', 'seed', 'warn').logger,
        'large',
        { scale: Number(process.env['PF_PERF_SCALE'] ?? '0.1'), concurrency: 4 },
      );
    }
  } finally {
    await admin.end();
  }
  const started = await startService();

  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'perf-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(perfApiEnv(deps, { LOG_LEVEL: 'warn', FORECASTING_ENABLED: 'true' })),
    apiLog.logger,
    {
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');
  const now = Math.floor(Date.now() / 1000);
  token = await new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: MINIMAL_USERS[0].subject,
    iat: now - 5,
    exp: now + 4 * 3600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: 'owner@demo.pfos.test',
    email_verified: true,
    name: 'Owner Demo',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'perf-1', typ: 'JWT' })
    .sign(pair.privateKey);

  const workerOverrides = {
    FORECASTING_ENABLED: 'true',
    FORECASTING_SERVICE_URL: started.url,
    FORECASTING_SERVICE_TOKEN_FILE: started.tokenFile,
  };
  // Composición del worker (pf_worker): la misma que create-worker-runtime, con el servicio real.
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
  const audit = createAuditRuntime({
    pool: worker,
    clock: systemClock,
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(worker),
    machines: LIFECYCLE_MACHINES,
  });
  const finance = financeRuntimes({
    pool: worker,
    clock: systemClock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    lifecycleQuery: audit.lifecycleQuery,
    history: audit.history,
    logger: workerLog.logger,
    config: workerConfig(baseEnv(deps, workerOverrides)),
    outbox: new PgOutboxWriter(eventSchemaRegistry()),
  });
  forecasting = finance.forecasting;
}, 900_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
  await service?.stop();
});

describe('NFR-PERF-012: corrida de pronóstico del workspace principal del Large Seed', () => {
  it('[TC-FORECAST-SERVICE-028] la corrida completa con el servicio real termina en 300 s o menos', async () => {
    const started = performance.now();
    const requested = await api('POST', `${W}/forecasts`);
    expect(requested.status, JSON.stringify(requested.body)).toBe(202);
    const operation = requested.body as { id?: string; resource?: { id?: string } };
    const runId = String(operation.resource?.id ?? operation.id);

    let status = '';
    for (let i = 0; i < 60 && !['COMPLETED', 'INSUFFICIENT_DATA', 'FAILED'].includes(status); i += 1) {
      await runForecastRunner(forecasting, workerLog.logger);
      const run = await api('GET', `${W}/forecasts/${runId}`);
      expect(run.status, JSON.stringify(run.body)).toBe(200);
      status = String(run.body['status']);
      if (performance.now() - started > BUDGET_MS) break;
    }
    const elapsed = performance.now() - started;
    const latest = await api('GET', `${W}/forecasts/latest?horizon=12`);
    const series = (latest.body['series'] as unknown[] | undefined)?.length ?? 0;
    console.info(
      `forecast run: ${status}, ${Math.round(elapsed / 1000)} s, ${series} series (budget ${BUDGET_MS / 1000} s)`,
    );
    expect(status).toBe('COMPLETED');
    expect(series).toBeGreaterThan(0);
    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
  }, 600_000);
});
