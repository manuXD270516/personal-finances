import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createFxMarketRateJobs, parseFxProviderSettings } from '@pf/fx/interface/fx.module';
import { identityWorkspaceRecipients } from '@pf/identity/interface/identity.module';
import {
  createNotificationsWorkerRuntime,
  type EmailSender,
} from '@pf/notifications/interface/notifications.module';
import { ApiContract } from '@pf/platform/api';
import { PgOutboxWriter } from '@pf/platform/events';
import { otelCounters, otelHistograms } from '@pf/platform/otel';
import type { JobQueue } from '@pf/platform/queue';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Alertas de tasas de punta a punta por HTTP contra PostgreSQL real (openspec add-rate-feed-alerts; TC-NOTIFICATIONS-FX-001,
// -003, -004, -006 y -008 en su parte de API): el job REAL de providers (episodios, muestras retenidas) entrega por el
// puerto de NOTIFY en su misma transacción y el centro de notificaciones lo muestra a OWNER y EDITOR, no al VIEWER; la
// muestra retenida se confirma desde el enlace de su notificación. Providers simulados por un servidor HTTP local.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const FIXTURES = fileURLToPath(
  new URL('../../../../packages/contexts/fx/test/fixtures/providers/', import.meta.url),
);
const fixture = (name: string) => readFileSync(`${FIXTURES}${name}`, 'utf8');
const paralelo = (median: string, timestamp: string, buy = '12.12', sell = '11.92') =>
  `{"timestamp":"${timestamp}","buy":${buy},"sell":${sell},"median":${median},"spreadPct":-1.4706,"sourceCount":4,"methodologyVersion":"ec2-backend"}`;

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
type Json = Record<string, unknown>;
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let providerServer: Server;
let providerUrl: string;
let worker: Pool;
let notifications: ReturnType<typeof createNotificationsWorkerRuntime>;
const routes = new Map<string, string>();
const clock = new FixedClock(Instant.parse('2026-10-02T09:00:00Z'));
const contract = ApiContract.fromFile(resolveContractPath());
const apiLog = capturingLogger('finance-api', 'api');
const workerLog = capturingLogger('finance-worker', 'worker', 'warn');

interface Reply {
  status: number;
  body: Json;
}

async function tokenFor(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub,
    iat: now - 5,
    exp: now + 600,
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
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
}

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
let editor: User;
let viewer: User;

async function addMember(member: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
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

/** Un ciclo del job REAL de providers (con el puerto de NOTIFY cableado), con el reloj en `at`. */
async function poll(at: string) {
  clock.set(Instant.parse(at));
  const writer = new PgOutboxWriter(eventSchemaRegistry());
  const jobs = createFxMarketRateJobs({
    pool: worker,
    clock,
    outbox: { append: async (e) => void (await writer.append(e)) },
    workspaces: {
      list: async () => [{ workspaceId: owner.ws, timeZone: 'America/La_Paz', baseCurrency: 'BOB' }],
    },
    settings: parseFxProviderSettings({}),
    notifications: notifications.intake,
    endpoints: {
      baseUrls: { PARALELO_BO: providerUrl, DOLARAPI_BO: providerUrl },
      allowedHosts: ['127.0.0.1'],
    },
  });
  const results = await jobs.ingestion.poll();
  return { results, feed: jobs.ingestion.lastFeedCheck };
}

const inbox = async (u: User) => {
  const r = await call('GET', `${W(u)}/notifications?limit=100`, { token: u.token });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(contract.validateResponse('listNotifications', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return (r.body['data'] as Json[]).filter((n) => String(n['type']).startsWith('FX_RATE_'));
};
const byType = (rows: Json[], type: string) => rows.filter((n) => n['type'] === type);
const pairsOf = (rows: Json[]) =>
  rows
    .map((n) => `${String((n['params'] as Json)['base'])}/${String((n['params'] as Json)['quote'])}`)
    .sort();

beforeAll(async () => {
  providerServer = createServer((req, res) => {
    const body = routes.get(req.url ?? '');
    if (body === undefined) res.writeHead(503).end('{"error":"down"}');
    else res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
  });
  await new Promise<void>((r) => providerServer.listen(0, '127.0.0.1', r));
  providerUrl = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}`;
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(
      baseEnv(deps, {
        FX_PROVIDER_PRIMARY: 'paralelo_bo',
        FX_PROVIDER_FALLBACK: 'dolarapi_bo',
        FX_PROVIDER_OFFICIAL: 'dolarapi_bo',
      }),
    ),
    apiLog.logger,
    {
      clock,
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');
  const sender: EmailSender = {
    driver: 'none',
    send: () => Promise.reject(new Error('el canal email no se usa en las pruebas de la API')),
  };
  const queue = { enqueueInTransaction: () => Promise.resolve() } as unknown as JobQueue;
  notifications = createNotificationsWorkerRuntime({
    pool: worker,
    clock,
    queue,
    logger: workerLog.logger,
    recipients: identityWorkspaceRecipients(worker),
    catalog: { categoryTree: () => Promise.resolve({ groups: [], categories: [], tags: [] }) },
    sender,
    counters: otelCounters('@pf/notifications'),
    histograms: otelHistograms('@pf/notifications'),
    appPublicUrl: 'http://localhost:23000',
    emailFrom: 'PFOS <notificaciones@pfos.local>',
    maxAttempts: 5,
    retentionMonths: 12,
  });
  owner = await user(`kc-fxa-owner-${randomUUID()}`);
  editor = await addMember(await user(`kc-fxa-editor-${randomUUID()}`), 'EDITOR');
  viewer = await addMember(await user(`kc-fxa-viewer-${randomUUID()}`), 'VIEWER');
  // El EDITOR lee en portugués (el texto se compone al leer, en el idioma de su perfil).
  const migrator = await connect(deps.migratorUrl);
  try {
    await migrator.query('UPDATE iam."user" SET locale = $2 WHERE id = $1', [editor.id, 'pt-BR']);
  } finally {
    await migrator.end();
  }
  routes.set('/api/v1/rate', fixture('paralelo-bo/rate.ok.json'));
  routes.set('/v1/dolares', fixture('dolarapi-bo/dolares.ok.json'));
}, 180_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
  await new Promise<void>((r) => providerServer?.close(() => r()));
});

describe('Alertas de tasas por HTTP (notifications/alerts, fx/market-rate-providers)', () => {
  it('[TC-NOTIFICATIONS-FX-008] sin caída no hay alertas; con los providers caídos más de 6 h el OWNER y el EDITOR reciben la obsolescencia y el VIEWER no', async () => {
    await poll('2026-10-02T09:00:00Z');
    expect(await inbox(owner)).toHaveLength(0);
    // paralelo.bo cae (menos de 5 fallas seguidas: `fx.provider_run` es de la instalación y las demás pruebas de la
    // corrida comparten la base, así que no se deja ningún provider en espera por fallas). bo.dolarapi.com sigue
    // publicando su tasa vieja de las 08:50Z: la última tasa automática de cada par es la de las 08:53Z.
    routes.delete('/api/v1/rate');
    const early = await poll('2026-10-02T14:45:00Z');
    expect(early.feed.opened).toBe(0);
    expect(await inbox(owner)).toHaveLength(0);
    const late = await poll('2026-10-02T15:00:00Z');
    expect(late.feed).toMatchObject({ opened: 2, failed: 0 });

    const ownerRows = byType(await inbox(owner), 'FX_RATE_FEED_STALE');
    expect(pairsOf(ownerRows)).toEqual(['USD/BOB', 'USDT/BOB']);
    for (const n of ownerRows) {
      expect(n).toMatchObject({ severity: 'WARNING', status: 'UNREAD', link: { kind: 'FX_FEED_STATUS' } });
    }
    const usdt = ownerRows.find((n) => (n['params'] as Json)['base'] === 'USDT')!;
    expect(usdt['title']).toBe('USDT/BOB lleva más de 6 horas sin tasa automática');
    expect(String(usdt['body'])).toContain('02/10/2026 04:53');
    // El EDITOR la lee en portugués y con la hora de La Paz.
    const editorRows = byType(await inbox(editor), 'FX_RATE_FEED_STALE');
    expect(editorRows).toHaveLength(2);
    expect(String(editorRows.find((n) => (n['params'] as Json)['base'] === 'USDT')!['title'])).toBe(
      'USDT/BOB está há mais de 6 horas sem taxa automática',
    );
    expect(await inbox(viewer)).toHaveLength(0);

    // Verificaciones repetidas: ni un aviso más.
    await poll('2026-10-02T15:15:00Z');
    expect(byType(await inbox(owner), 'FX_RATE_FEED_STALE')).toHaveLength(2);

    // El estado por par informa el episodio abierto.
    const status = await call('GET', `${W(owner)}/fx-providers/status`, { token: owner.token });
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    expect(contract.validateResponse('getFxProviderStatus', 200, status.body)).toEqual([]);
    const pairs = status.body['pairs'] as Json[];
    expect(pairs.find((p) => p['base'] === 'USDT')).toMatchObject({
      openEpisode: { openedAt: '2026-10-02T15:00:00.000Z' },
    });
  });

  it('[TC-NOTIFICATIONS-FX-003] al volver una tasa fresca llega un solo aviso de recuperación por par y el episodio se cierra', async () => {
    routes.set('/api/v1/rate', paralelo('12.05', '2026-10-02T15:58:00.000Z'));
    const recovered = await poll('2026-10-02T16:00:00Z');
    expect(recovered.feed.closed).toBeGreaterThanOrEqual(1);
    const rows = byType(await inbox(owner), 'FX_RATE_FEED_RECOVERED');
    expect(pairsOf(rows)).toEqual(['USD/BOB', 'USDT/BOB']);
    expect(rows.every((n) => n['severity'] === 'INFO')).toBe(true);
    expect(String(rows.find((n) => (n['params'] as Json)['base'] === 'USDT')!['title'])).toBe(
      'USDT/BOB volvió a tener tasa automática',
    );
    await poll('2026-10-02T16:15:00Z');
    expect(byType(await inbox(owner), 'FX_RATE_FEED_RECOVERED')).toHaveLength(2);
    expect(await inbox(viewer)).toHaveLength(0);
    const status = await call('GET', `${W(owner)}/fx-providers/status`, { token: owner.token });
    expect((status.body['pairs'] as Json[]).find((p) => p['base'] === 'USDT')).toMatchObject({
      openEpisode: null,
    });
  });

  it('[TC-NOTIFICATIONS-FX-004] una muestra anómala retenida avisa una sola vez y se confirma desde el enlace de su notificación', async () => {
    // 12.05 → 13.50 (+12.03 %): supera el 5 % de fiat y estables.
    routes.set('/api/v1/rate', paralelo('13.50', '2026-10-02T16:30:00.000Z', '13.6', '13.4'));
    await poll('2026-10-02T16:35:00Z');
    await poll('2026-10-02T16:50:00Z');
    const rows = byType(await inbox(editor), 'FX_RATE_ANOMALY_RETAINED');
    // Una notificación por muestra retenida (D234): la mediana y la compra y venta de cada par, sin repetirse al repetir el ciclo.
    expect(rows).toHaveLength(6);
    expect(pairsOf(rows)).toEqual(['USD/BOB', 'USD/BOB', 'USD/BOB', 'USDT/BOB', 'USDT/BOB', 'USDT/BOB']);
    const usdt = rows.find(
      (n) => (n['params'] as Json)['base'] === 'USDT' && (n['params'] as Json)['rateType'] === 'PARALLEL',
    )!;
    expect(usdt).toMatchObject({ severity: 'WARNING', status: 'UNREAD', link: { kind: 'FX_RATE' } });
    expect(usdt['params']).toMatchObject({
      provider: 'PARALELO_BO',
      value: '13.5',
      baselineValue: '12.05',
      variationPct: '12.0332',
    });
    expect(String(usdt['title'])).toContain('+12,03 %');
    expect(byType(await inbox(owner), 'FX_RATE_ANOMALY_RETAINED')).toHaveLength(6);
    expect(await inbox(viewer)).toHaveLength(0);

    // Antes de confirmar, la valoración sigue con 12.05.
    const before = await call('GET', `${W(viewer)}/fx-rates/latest?base=USDT&quote=BOB&rateType=PARALLEL`, {
      token: viewer.token,
    });
    expect((before.body['rate'] as { value: string }).value).toBe('12.05');

    // El enlace trae la tasa: el EDITOR la confirma con un motivo y la valoración la usa.
    const rateId = String((usdt['link'] as Json)['fxRateId']);
    const confirmed = await call('POST', `${W(editor)}/fx-rates/${rateId}/anomaly-review`, {
      token: editor.token,
      body: { decision: 'CONFIRM', reason: 'movimiento real del mercado' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const after = await call('GET', `${W(viewer)}/fx-rates/latest?base=USDT&quote=BOB&rateType=PARALLEL`, {
      token: viewer.token,
    });
    expect((after.body['rate'] as { value: string }).value).toBe('13.5');
    // La notificación no se duplica tras confirmar.
    await poll('2026-10-02T17:05:00Z');
    expect(byType(await inbox(editor), 'FX_RATE_ANOMALY_RETAINED')).toHaveLength(6);
    expect(workerLog.records().filter((r) => String(r['msg']).includes('failed'))).toEqual([]);
  });
});
