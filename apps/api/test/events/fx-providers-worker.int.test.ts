import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { identityActiveWorkspaces } from '@pf/identity/interface/identity.module';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { PgOutboxWriter } from '@pf/platform/events';
import { uuidv7 } from '@pf/platform/logging';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { createWorkerRuntime, type WorkerRuntime } from '../../src/worker/create-worker-runtime.js';
import { baseEnv, capturingLogger, discardStaleEventBacklog, workerConfig } from '../support/harness.js';

// Worker completo con pg-boss real (add-market-rate-providers, tarea 4.4): el consumidor FX de
// identity.WorkspaceCreated.v1 siembra preferencias PARALLEL y encola la carga histórica en su transacción; el job
// importa los 787 días completos por par desde un servidor HTTP local con el histórico grabado (sin red).
const deps = inject('deps');
const logs = capturingLogger('finance-worker', 'worker', 'warn');
const FIXTURES = fileURLToPath(
  new URL('../../../../packages/contexts/fx/test/fixtures/providers/', import.meta.url),
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let appPool: Pool;
let workerPool: Pool;
let migratorPool: Pool;
let server: Server;
let runtime: WorkerRuntime | undefined;
const requests: string[] = [];

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 150_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('until: timeout');
    await sleep(200);
  }
}

async function asWorker<R>(workspaceId: string, text: string, values: unknown[] = []): Promise<R[]> {
  const client = await workerPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
      [workspaceId],
    );
    const { rows } = await client.query(text, values);
    await client.query('COMMIT');
    return rows as R[];
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  // Las suites de API no tienen relay: sus WorkspaceCreated sin publicar se publicarían ahora y cada uno encolaría una
  // carga histórica antes de la de este test (FIFO); agotan el límite local de 60 solicitudes/min del provider y la de
  // este workspace termina FAILED/PROVIDER_RATE_LIMITED sin escribir nada.
  await discardStaleEventBacklog(deps, ['identity.WorkspaceCreated']);
  appPool = new Pool({ connectionString: deps.databaseUrl, max: 2 });
  workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
  migratorPool = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  const historical = readFileSync(`${FIXTURES}paralelo-bo/historical.sample.json`, 'utf8');
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url === '/api/v1/historical.json') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(historical);
    } else res.writeHead(503).end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
});

afterAll(async () => {
  await runtime?.close();
  await new Promise<void>((r) => server.close(() => r()));
  await appPool?.end();
  await workerPool?.end();
  await migratorPool?.end();
});

describe('fx/market-rate-providers: worker con pg-boss real', () => {
  it('[TC-FX-PROVIDER-006] WorkspaceCreated ⇒ preferencias PARALLEL + carga histórica de 787 días por par, una sola vez', async () => {
    const { rows } = await migratorPool.query<{ id: string }>(
      `SELECT iam.provision_user('https://idp.test/fx-worker', $1, $2, 'fx-worker') AS id`,
      [`sub-${randomUUID()}`, `fx-worker-${randomUUID()}@demo.pfos.test`],
    );
    const owner = rows[0]!.id;
    const ws = randomUUID();
    const writer = new PgOutboxWriter(eventSchemaRegistry());
    const eventId = uuidv7();
    await new PgUnitOfWork(appPool).run({ userId: owner, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'FX', 'BOB', 'America/La_Paz', 'es-BO')`,
        [ws],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [ws, owner],
      );
      await writer.append({
        eventId,
        eventType: 'identity.WorkspaceCreated',
        eventVersion: 1,
        occurredAt: '2026-10-02T12:00:00.000Z',
        workspaceId: ws,
        aggregateType: 'Workspace',
        aggregateId: ws,
        aggregateVersion: 1,
        actor: { type: 'USER', id: owner },
        payload: {
          workspaceId: ws,
          name: 'FX',
          baseCurrency: 'BOB',
          timeZone: 'America/La_Paz',
          locale: 'es-BO',
          fiscalMonthStartDay: 1,
          ownerUserId: owner,
          origin: 'USER_CREATED',
        },
      });
    });
    expect((await identityActiveWorkspaces(workerPool).list()).map((w) => w.workspaceId)).toContain(ws);

    const port = (server.address() as AddressInfo).port;
    runtime = await createWorkerRuntime(
      workerConfig(
        baseEnv(deps, {
          FX_PROVIDER_PRIMARY: 'paralelo_bo',
          FX_PROVIDER_FALLBACK: 'none',
          FX_PROVIDER_OFFICIAL: 'none',
        }),
      ),
      logs.logger,
      {
        clock: new FixedClock(Instant.parse('2026-10-02T12:00:00Z')),
        ledgerMaintenanceOnStart: false,
        fxGapFillOnStart: false,
        fxEndpoints: {
          baseUrls: { PARALELO_BO: `http://127.0.0.1:${port}`, DOLARAPI_BO: `http://127.0.0.1:${port}` },
          allowedHosts: ['127.0.0.1'],
        },
      },
    );
    const count = () =>
      asWorker<{ n: string }>(
        ws,
        `SELECT count(*)::text AS n FROM fx.exchange_rate WHERE workspace_id = $1 AND provider = 'PARALELO_BO'`,
        [ws],
      ).then((r) => Number(r[0]?.n));
    await until(async () => ((await count()) >= 1574 ? true : undefined));
    await sleep(1_000);
    expect(await count()).toBe(1574);
    const prefs = await asWorker<{ p: string }>(
      ws,
      `SELECT base_currency || '/' || quote_currency || '=' || rate_type AS p FROM fx.rate_preference WHERE workspace_id = $1 ORDER BY 1`,
      [ws],
    );
    expect(prefs.map((r) => r.p)).toEqual(['USD/BOB=PARALLEL', 'USDT/BOB=PARALLEL']);
    const sep10 = await asWorker<{ rate: string }>(
      ws,
      `SELECT trim_scale(rate)::text AS rate FROM fx.exchange_rate
        WHERE workspace_id = $1 AND base_currency = 'USD' AND as_of = '2026-09-11T03:59:59Z'`,
      [ws],
    );
    expect(sep10).toEqual([{ rate: '11.96' }]);

    // El PostgreSQL de la suite es compartido: el relay entrega también los WorkspaceCreated pendientes de otras
    // suites (una carga por workspace), así que se verifica el efecto en ESTE workspace, no el número de solicitudes.
    expect(requests.length).toBeGreaterThan(0);
    // Re-entrega del mismo evento: el inbox lo descarta (sin segundo job ni filas nuevas).
    const [envelope] = await workerPool
      .query<{ envelope: unknown }>(`SELECT envelope FROM platform.outbox WHERE id = $1`, [eventId])
      .then((r) => r.rows.map((x) => (typeof x.envelope === 'string' ? JSON.parse(x.envelope) : x.envelope)));
    const def = runtime.subscriptions
      .definitions()
      .find((d) => d.consumer === 'fx.market-rate-provisioning')!;
    expect(await runtime.consumers.deliver(def, envelope)).toBe('duplicate');
    await sleep(1_000);
    expect(await count()).toBe(1574);
  }, 180_000);
});
