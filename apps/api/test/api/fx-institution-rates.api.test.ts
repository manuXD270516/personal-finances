import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createFxMarketRateJobs,
  parseFxProviderSettings,
  ProviderSample,
  registerProviderDescriptor,
  type InstitutionRateProvider,
  type ProviderDescriptor,
} from '@pf/fx/interface/fx.module';
import { ApiContract } from '@pf/platform/api';
import { PgOutboxWriter } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Tasas por institución por HTTP contra PostgreSQL real (openspec add-exchange-house-rate-providers, tareas 4.8 y 5.2):
// ingesta REAL del worker con un DOBLE en memoria del provider (no existe ningún adapter real), tasas BANK_BUY/BANK_SELL
// con su código de institución, valoración que solo las usa con preferencia, referencia de una conversión (la columna
// `reference_rate_type` de la BD las admite y el evento valida) y estado por institución sin llamar al provider.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const DEMO_DIR = fileURLToPath(new URL('../../reference/institutions/demo', import.meta.url));
const ID = `INSTRATE_API_${randomUUID().slice(0, 8).toUpperCase()}` as const;

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let worker: Pool;
let fake: FakeInstitution;
let unregister: () => void;
const clock = new FixedClock(Instant.parse('2026-10-08T16:10:00Z'));

/** DOBLE en memoria del provider por institución (NO es un adapter real): publica lo que el test programa. */
class FakeInstitution implements InstitutionRateProvider {
  calls = 0;
  asOf = '2026-10-08T16:00:00.000Z';
  quotes: Record<string, { compra?: string; venta?: string }> = {};
  readonly descriptorValue: ProviderDescriptor = {
    id: ID,
    kind: 'INSTITUTION',
    terms: { status: 'VERIFIED', verifiedOn: '2026-10-15', adr: 'ADR-TEST' },
    dailyCloses: false,
    feeds: [
      { base: 'USD', quote: 'BOB', rateType: 'BANK_BUY' },
      { base: 'USD', quote: 'BOB', rateType: 'BANK_SELL' },
    ],
    quoteSideFeeds: [],
    attribution: {
      provider: ID,
      text: 'Fuente simulada de tasas por institución (prueba)',
      url: 'https://example.invalid/instituciones',
      license: null,
      licenseUrl: null,
    },
    limitPerMinute: 600,
    history: false,
  };
  register() {
    return registerProviderDescriptor(this.descriptorValue);
  }
  descriptor() {
    return this.descriptorValue;
  }
  async fetchLatest(): Promise<ProviderSample[]> {
    this.calls++;
    const out: ProviderSample[] = [];
    for (const [code, q] of Object.entries(this.quotes)) {
      // `compra` de la entidad = lo que el owner recibe al vender USD (BANK_SELL); `venta` = lo que paga (BANK_BUY).
      for (const [value, rateType] of [
        [q.compra, 'BANK_SELL'],
        [q.venta, 'BANK_BUY'],
      ] as const) {
        if (value === undefined) continue;
        out.push(
          ProviderSample.of({
            provider: ID,
            base: 'USD',
            quote: 'BOB',
            rateType,
            value,
            asOf: this.asOf,
            fetchedAt: clock.now().toString(),
            rawPayload: `{"entidad":"${code}","valor":"${value}"}`,
            sourceLabel: `${ID} (${rateType} de ${code})`,
            institutionCode: code,
          }),
        );
      }
    }
    return out;
  }
}
const contract = ApiContract.fromFile(resolveContractPath());

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

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;
const W = (u: User) => `/api/v1/workspaces/${u.ws}`;

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
    settings: parseSettings(),
    institutionProviders: { [ID]: fake },
  });
  const results = await jobs.ingestion.poll();
  expect(jobs.ingestion.lastWorkspaceFailures).toEqual([]);
  return results;
}

const parseSettings = () =>
  parseFxProviderSettings({
    FX_PROVIDER_PRIMARY: 'none',
    FX_PROVIDER_FALLBACK: 'none',
    FX_PROVIDER_OFFICIAL: 'none',
    FX_PROVIDER_INSTITUTION_RATES: ID.toLowerCase(),
  });

let owner: User;
let viewer: User;
let other: User;

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
  fake = new FakeInstitution();
  unregister = fake.register();
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(
      baseEnv(deps, {
        FX_PROVIDER_INSTITUTION_RATES: ID.toLowerCase(),
        ACCOUNTS_INSTITUTION_CATALOG_DIR: DEMO_DIR,
      }),
    ),
    capturingLogger('finance-api', 'api').logger,
    {
      clock,
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');
  owner = await user(`kc-fxi-owner-${randomUUID()}`);
  other = await user(`kc-fxi-other-${randomUUID()}`);
  const v = await user(`kc-fxi-viewer-${randomUUID()}`);
  const { connect, inTx } = await import('../support/db.js');
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
});

afterAll(async () => {
  unregister?.();
  // Tabla de instalación compartida con otras suites: se deja como estaba.
  await worker?.query('DELETE FROM fx.provider_run WHERE provider = $1', [ID]);
  await runtime?.close();
  await worker?.end();
});

interface Rate {
  id: string;
  rateType: string;
  value: string;
  provider: string | null;
  institutionCode?: string | null;
  asOf: string;
}
const ratesOf = async (u: User, query: string) => {
  const r = await call('GET', `${W(u)}/fx-rates?${query}`, { token: u.token });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(contract.validateResponse('listFxRates', 200, r.body)).toEqual([]);
  return r.body['data'] as Rate[];
};

describe('tasas por institución por HTTP', () => {
  it('[TC-FX-INSTRATE-003] [TC-FX-INSTRATE-004] la ingesta registra la compra de cada entidad como BANK_SELL con su código y el historial se filtra por institución', async () => {
    fake.asOf = '2026-10-08T16:00:00.000Z';
    fake.quotes = { BAD: { compra: '11.8537', venta: '11.95' }, BBD: { compra: '12.03' } };
    const results = await poll('2026-10-08T16:10:00Z', [owner, other]);
    expect(results.map((r) => [r.provider, r.outcome, r.newSamples])).toEqual([[ID, 'OK', 6]]);
    const bad = await ratesOf(viewer, 'institutionCode=BAD');
    expect(bad.map((r) => [r.rateType, r.value, r.institutionCode, r.provider]).sort()).toEqual([
      ['BANK_BUY', '11.95', 'BAD', ID],
      ['BANK_SELL', '11.8537', 'BAD', ID],
    ]);
    const sells = await ratesOf(viewer, 'rateType=BANK_SELL&limit=50');
    expect(sells.map((r) => [r.institutionCode, r.value]).sort()).toEqual([
      ['BAD', '11.8537'],
      ['BBD', '12.03'],
    ]);
    // Ninguna tasa BANK (punto medio) ni de otros tipos para esas entidades.
    expect(await ratesOf(viewer, 'rateType=BANK')).toEqual([]);
    // Segundo ciclo con la misma publicación: idempotente.
    const again = await poll('2026-10-08T17:10:00Z', [owner, other]);
    expect(again.map((r) => [r.outcome, r.newSamples])).toEqual([['NO_NEW_SAMPLE', 0]]);
    expect((await ratesOf(viewer, 'institutionCode=BAD')).length).toBe(2);
    // El otro workspace tiene su propia copia (aislamiento por workspace).
    expect((await ratesOf(other, 'rateType=BANK_SELL')).length).toBe(2);
  });

  it('[TC-FX-INSTRATE-005] sin preferencia valora PARALLEL; con BANK_SELL como preferencia del par valora con la tasa de la institución (100.00 USD = 1185.00 BOB)', async () => {
    const u = await user(`kc-fxi-val-${randomUUID()}`);
    clock.set(Instant.parse('2026-10-08T17:20:00Z'));
    const manual = (rateType: string, value: string) =>
      call('POST', `${W(u)}/fx-rates`, {
        token: u.token,
        body: { base: 'USD', quote: 'BOB', value, rateType, asOf: '2026-10-08T17:00:00Z' },
        headers: { 'idempotency-key': randomUUID() },
      });
    expect((await manual('PARALLEL', '12.02')).status).toBe(201);
    // BANK_SELL manual del usuario: tipo de entrada válido, sin código de institución.
    const bank = await manual('BANK_SELL', '11.85');
    expect(bank.status, JSON.stringify(bank.body)).toBe(201);
    expect(bank.body['rateType']).toBe('BANK_SELL');
    expect(bank.body['institutionCode']).toBeUndefined();
    const latest = async () =>
      (await call('GET', `${W(u)}/fx-rates/latest?base=USD&quote=BOB`, { token: u.token })).body;
    const def = await latest();
    expect(def).toMatchObject({ rateType: 'PARALLEL', rate: { value: '12.02' } });
    const prefs = await call('PUT', `${W(u)}/fx-rate-preferences`, {
      token: u.token,
      body: { data: [{ base: 'USD', quote: 'BOB', rateType: 'BANK_SELL' }] },
      headers: { 'if-match': '"1"' },
    });
    expect(prefs.status, JSON.stringify(prefs.body)).toBe(200);
    expect(await latest()).toMatchObject({ rateType: 'BANK_SELL', rate: { value: '11.85' } });
    // Sin BANK_BUY registrada no se sustituye por otra tasa manual: FX_RATE_NOT_FOUND.
    const missing = await call('GET', `${W(u)}/fx-rates/latest?base=USD&quote=BOB&rateType=BANK_BUY`, {
      token: u.token,
    });
    expect(missing.status, JSON.stringify(missing.body)).toBe(422);
    expect(missing.body['code']).toBe('FX_RATE_NOT_FOUND');
  });

  it('[TC-FX-INSTRATE-006] la tasa BANK_SELL de la institución es la referencia elegible de una conversión: id y versión, y el análisis compara 11.80 contra 11.85', async () => {
    const u = await user(`kc-fxi-conv-${randomUUID()}`);
    // Un workspace nuevo recibe su copia de la publicación vigente (el ciclo respeta el intervalo propio de 60 min).
    await poll('2026-10-08T19:30:00Z', [u]);
    const bad = (await ratesOf(u, 'institutionCode=BAD&rateType=BANK_SELL'))[0]!;
    const open = async (name: string, type: string, currency: string, amount: string) => {
      const r = await call('POST', `${W(u)}/accounts`, {
        token: u.token,
        body: {
          name,
          type,
          currency,
          openingBalance: { amount: { amount, currency }, date: '2026-10-01' },
        },
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body['id'] as string;
    };
    const usd = await open('Efectivo USD', 'CASH', 'USD', '500.00');
    const bob = await open('Bank A', 'BANK', 'BOB', '0.00');
    const conv = await call('POST', `${W(u)}/conversions`, {
      token: u.token,
      body: {
        transactionDate: '2026-10-08',
        sourceAccountId: usd,
        targetAccountId: bob,
        sourceAmount: { amount: '100.00', currency: 'USD' },
        targetAmount: { amount: '1180.00', currency: 'BOB' },
        quotedRate: { base: 'USD', quote: 'BOB', value: '11.80' },
        referenceFxRateId: bad.id,
        executedAt: '2026-10-08T17:30:00Z',
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(conv.status, JSON.stringify(conv.body)).toBe(201);
    expect(contract.validateResponse('createConversion', 201, conv.body)).toEqual([]);
    expect(conv.body['conversion']).toMatchObject({
      effectiveRate: { base: 'USD', quote: 'BOB', value: '11.800000000000000000' },
      referenceRate: { fxRateId: bad.id, rateType: 'BANK_SELL', rate: { value: '11.8537' } },
    });
    // 100.00 USD a 11.8537 = 1185.37 BOB de referencia frente a los 1180.00 recibidos: el spread es de 5.37 BOB.
    expect((conv.body['conversion'] as { spread: { amount: { amount: string } } }).spread.amount.amount).toBe(
      '5.37',
    );
    // El análisis de costo compara la tasa cotizada contra esa referencia (sin cambios de contrato).
    const cost = await call('GET', `${W(u)}/reports/conversion-costs?from=2026-10-01&to=2026-10-31`, {
      token: u.token,
    });
    expect(cost.status, JSON.stringify(cost.body)).toBe(200);
    expect(contract.validateResponse('getConversionCostAnalysis', 200, cost.body)).toEqual([]);
    expect(JSON.stringify(cost.body)).toContain('5.37');
  });

  it('[TC-FX-INSTRATE-007] el estado informa BAD con BANK_SELL, su antigüedad y stale = true pasadas 72 h, sin llamar al provider; el provider por institución aparece sin feeds por par', async () => {
    const callsBefore = fake.calls;
    clock.set(Instant.parse('2026-10-12T00:00:00Z')); // vigencia 2026-10-08T16:00 + 80 h
    const r = await call('GET', `${W(viewer)}/fx-providers/status`, { token: viewer.token });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('getFxProviderStatus', 200, r.body)).toEqual([]);
    const institutions = r.body['institutions'] as {
      code: string;
      rateTypes: string[];
      ageSeconds: number | null;
      stale: boolean;
    }[];
    expect(institutions.find((i) => i.code === 'BAD')).toMatchObject({
      rateTypes: ['BANK_BUY', 'BANK_SELL'],
      ageSeconds: 80 * 3600,
      stale: true,
    });
    expect(fake.calls).toBe(callsBefore);
    const provider = (r.body['data'] as { provider: string; enabled: boolean; feeds: unknown[] }[]).find(
      (p) => p.provider === ID,
    );
    expect([provider?.enabled, provider?.feeds]).toEqual([true, []]);
    // Dentro del umbral no está obsoleta.
    clock.set(Instant.parse('2026-10-10T16:00:00Z'));
    const fresh = await call('GET', `${W(viewer)}/fx-providers/status`, { token: viewer.token });
    expect(
      (fresh.body['institutions'] as { code: string; stale: boolean }[]).find((i) => i.code === 'BAD')?.stale,
    ).toBe(false);
  });

  it('[TC-FX-INSTRATE-008] una institución adoptada informa su estado de soporte en tasas y la razón, sin tasas automáticas', async () => {
    const u = await user(`kc-fxi-adopt-${randomUUID()}`);
    const adopted = await call('POST', `${W(u)}/institutions/adopt`, {
      token: u.token,
      body: { country: 'BO', codes: ['CID', 'BAL'] },
    });
    expect(adopted.status, JSON.stringify(adopted.body)).toBe(200);
    clock.set(Instant.parse('2026-10-08T18:00:00Z'));
    const r = await call('GET', `${W(u)}/fx-providers/status`, { token: u.token });
    expect(contract.validateResponse('getFxProviderStatus', 200, r.body)).toEqual([]);
    const institutions = r.body['institutions'] as Record<string, unknown>[];
    expect(institutions.find((i) => i['code'] === 'CID')).toEqual({
      code: 'CID',
      rateTypes: [],
      lastRateAsOf: null,
      ageSeconds: null,
      stale: false,
      supportStatus: 'NOT_ELIGIBLE',
      reason: 'NO_PUBLICATION',
    });
    expect(institutions.find((i) => i['code'] === 'BAL')).toMatchObject({
      supportStatus: 'NOT_APPLICABLE',
      reason: null,
    });
    // Un workspace sin adopciones ni tasas propias no ve las instituciones de otro.
    expect(institutions.map((i) => i['code']).sort()).toEqual(['BAL', 'CID']);
  });
});
