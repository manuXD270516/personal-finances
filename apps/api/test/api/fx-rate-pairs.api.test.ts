import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Pares de tasa automáticos por HTTP contra PostgreSQL real (Testcontainers; openspec add-crypto-rate-providers,
// tareas 5.1–5.2): lista por defecto, personalizada con If-Match, auditoría, roles, validaciones, cobertura solo manual,
// estado por par y tasa manual MARKET. Providers en `none`: ninguna solicitud a la red.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const clock = new FixedClock(Instant.parse('2026-10-13T14:05:00Z'));
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

const pairsOf = (body: Record<string, unknown>) =>
  (body['pairs'] as { base: string; quote: string }[]).map((p) => `${p.base}/${p.quote}`);

const put = (u: User, ifMatch: string, body: unknown) =>
  call('PUT', `${W(owner)}/fx-rate-pairs`, { token: u.token, body, headers: { 'if-match': ifMatch } });

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
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
  owner = await user(`kc-fxpairs-owner-${randomUUID()}`);
  const v = await user(`kc-fxpairs-viewer-${randomUUID()}`);
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      async () => {
        await app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'VIEWER', 'ACTIVE')`,
          [owner.ws, v.id],
        );
        // BTC y EUR habilitadas; ETH queda sin habilitar (TC-FX-PROVIDER-022).
        await app.query(
          `INSERT INTO fx.workspace_currency (workspace_id, currency_code)
           VALUES ($1, 'BOB'), ($1, 'USD'), ($1, 'USDT'), ($1, 'BTC'), ($1, 'EUR')
           ON CONFLICT DO NOTHING`,
          [owner.ws],
        );
      },
      true,
    );
  } finally {
    await app.end();
  }
  viewer = { ...v, ws: owner.ws };
});

afterAll(async () => {
  await runtime?.close();
});

describe('Pares de tasa automáticos por HTTP (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-025] la lista por defecto deriva de las monedas habilitadas y EUR/BOB se informa solo manual', async () => {
    const r = await call('GET', `${W(owner)}/fx-rate-pairs`, { token: viewer.token });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('getFxRatePairs', 200, r.body)).toEqual([]);
    expect(r.headers.get('etag')).toBe('"1"');
    expect(r.body['mode']).toBe('DEFAULT');
    // Sin cripto volátil en la lista de prueba salvo BTC: USD, USDT y EUR frente a BOB y BTC frente a USDT.
    expect(pairsOf(r.body)).toEqual(['EUR/BOB', 'USD/BOB', 'USDT/BOB', 'BTC/USDT']);
    const byPair = new Map(
      (r.body['pairs'] as { base: string; quote: string; coverage: string; providers: string[] }[]).map(
        (p) => [`${p.base}/${p.quote}`, p],
      ),
    );
    expect(byPair.get('EUR/BOB')).toMatchObject({ coverage: 'MANUAL_ONLY', providers: [] });
    expect(byPair.get('BTC/USDT')).toMatchObject({ coverage: 'MANUAL_ONLY', assetClass: 'VOLATILE_CRYPTO' });
    expect(byPair.get('USDT/BOB')).toMatchObject({ coverage: 'AUTOMATIC', assetClass: 'STABLE' });
  });

  it('[TC-FX-PROVIDER-021] el OWNER fija una lista personalizada con If-Match y queda auditada; un ETag viejo responde 412', async () => {
    const body = {
      mode: 'CUSTOM',
      pairs: [
        { base: 'USD', quote: 'BOB' },
        { base: 'USDT', quote: 'BOB' },
        { base: 'BTC', quote: 'USDT' },
      ],
    };
    expectProblem(
      await call('PUT', `${W(owner)}/fx-rate-pairs`, { token: owner.token, body }),
      428,
      'PRECONDITION_REQUIRED',
    );
    const saved = await put(owner, '"1"', body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(contract.validateResponse('replaceFxRatePairs', 200, saved.body)).toEqual([]);
    expect([saved.body['mode'], saved.body['version'], saved.headers.get('etag')]).toEqual([
      'CUSTOM',
      2,
      '"2"',
    ]);
    expect(pairsOf(saved.body)).toEqual(['USD/BOB', 'USDT/BOB', 'BTC/USDT']);
    expectProblem(await put(owner, '"1"', body), 412, 'PRECONDITION_FAILED');
    const app = await connect(deps.databaseUrl);
    try {
      const audit = await inTx(
        app,
        { userId: owner.id, workspaceId: owner.ws },
        async () =>
          (
            await app.query<{
              action: string;
              actor_user_id: string;
              changes: { field: string; after: string }[];
            }>(
              `SELECT action, actor_user_id::text, changes FROM audit.audit_log
                WHERE aggregate_id = $1 AND action = 'fx.rate_pairs.replaced'`,
              [owner.ws],
            )
          ).rows,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actor_user_id).toBe(owner.id);
      const after = audit[0]?.changes.find((c) => c.field === 'pairs')?.after;
      expect(JSON.parse(String(after))).toEqual(['USD/BOB', 'USDT/BOB', 'BTC/USDT']);
    } finally {
      await app.end();
    }
    // Volver a la lista por defecto.
    const back = await put(owner, '"2"', { mode: 'DEFAULT' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect([back.body['mode'], back.body['version']]).toEqual(['DEFAULT', 3]);
  });

  it('[TC-FX-PROVIDER-022] VIEWER 403; ETH sin habilitar 422 CURRENCY_NOT_ENABLED; BTC/USD 400 VALIDATION_FAILED; la lista no cambia', async () => {
    const current = await call('GET', `${W(owner)}/fx-rate-pairs`, { token: owner.token });
    const etag = current.headers.get('etag') as string;
    expectProblem(
      await put(viewer, etag, { mode: 'CUSTOM', pairs: [{ base: 'USD', quote: 'BOB' }] }),
      403,
      'INSUFFICIENT_ROLE',
    );
    expectProblem(
      await put(owner, etag, { mode: 'CUSTOM', pairs: [{ base: 'ETH', quote: 'USDT' }] }),
      422,
      'CURRENCY_NOT_ENABLED',
    );
    expectProblem(
      await put(owner, etag, { mode: 'CUSTOM', pairs: [{ base: 'BTC', quote: 'USD' }] }),
      400,
      'VALIDATION_FAILED',
    );
    const after = await call('GET', `${W(owner)}/fx-rate-pairs`, { token: owner.token });
    expect([after.headers.get('etag'), after.body['mode']]).toEqual([etag, current.body['mode']]);
  });

  it('[TC-FX-PROVIDER-037] el estado informa por cada par su cobertura y la antigüedad de su última tasa automática', async () => {
    const r = await call('GET', `${W(owner)}/fx-providers/status`, { token: viewer.token });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('getFxProviderStatus', 200, r.body)).toEqual([]);
    const pairs = r.body['pairs'] as { base: string; quote: string; coverage: string; providers: string[] }[];
    const eur = pairs.find((p) => p.base === 'EUR');
    expect(eur).toMatchObject({ quote: 'BOB', coverage: 'MANUAL_ONLY', providers: [], ageSeconds: null });
    expect(pairs.find((p) => p.base === 'USDT')).toMatchObject({
      coverage: 'AUTOMATIC',
      providers: ['PARALELO_BO', 'DOLARAPI_BO'],
    });
  });

  it('[TC-FX-RATE-006] el EDITOR registra BTC/USDT = 64990.50 tipo MARKET como tasa manual', async () => {
    const r = await call('POST', `${W(owner)}/fx-rates`, {
      token: owner.token,
      headers: { 'idempotency-key': randomUUID() },
      body: {
        base: 'BTC',
        quote: 'USDT',
        value: '64990.50',
        rateType: 'MARKET',
        asOf: '2026-10-13T14:00:00Z',
        sourceLabel: 'Precio del exchange',
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(contract.validateResponse('createFxRate', 201, r.body)).toEqual([]);
    expect(r.body).toMatchObject({ source: 'MANUAL', rateType: 'MARKET', value: '64990.5', provider: null });
    const byId = await call('GET', `${W(owner)}/fx-rates/${String(r.body['id'])}`, { token: viewer.token });
    expect(contract.validateResponse('getFxRate', 200, byId.body)).toEqual([]);
    expect(byId.body['rateType']).toBe('MARKET');
  });
});
