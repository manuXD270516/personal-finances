import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { IMPORT_ROW_NAMESPACE } from '@pf/transactions/contracts';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { demoQueryRuntimes } from '../support/demo-runtimes.js';
import { apiConfig, capturingLogger } from '../support/harness.js';
import { recordSuiteLoad } from './background-load.js';
import { perfApiEnv } from './perf-env.js';

/**
 * add-rule-engine 7.3 (NFR-PERF-007 y NFR-PERF-003; TC-RULES-ENGINE-050 y -051), contra PostgreSQL real:
 *  - evaluar 5 000 filas contra 200 reglas activas de 5 condiciones (una con `matches_regex`) en ≤ 3 s; el peor caso
 *    (500 reglas de 20 condiciones) se mide e informa, sin umbral;
 *  - aplicar las reglas al registrar una transacción manual con 200 reglas activas suma ≤ 20 ms al p95 del registro.
 * Las reglas se siembran por SQL (generate_series) para no tardar minutos por HTTP. Corre en el job nightly `perf`
 * (`pnpm perf:bench`); no bloquea los PR.
 */
const deps = inject('deps');
recordSuiteLoad(import.meta.url, deps.superuserUrl);
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const clock = new FixedClock(Instant.parse('2026-10-20T14:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const EVAL_BUDGET_MS = 3000;
const CREATE_BUDGET_MS = 20;
const SAMPLES = 60;

let runtime: ApiRuntime;
let admin: Pool;
let queries: ReturnType<typeof demoQueryRuntimes>;
let baseUrl = '';
let token = '';
let workspaceId = '';
let userId = '';
let accountId = '';
let categoryId = '';

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
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Siembra `count` reglas activas de `conditions` condiciones (la primera con regex) con los disparadores dados. */
async function seedRules(
  count: number,
  conditions: number,
  triggers: string[],
  regexEvery = 200,
): Promise<void> {
  const conds = (n: number) =>
    JSON.stringify(
      Array.from({ length: conditions }, (_, i) =>
        i === 0 && n % regexEvery === 0
          ? { field: 'DESCRIPTION', operator: 'matches_regex', value: `comercio ${n} (suc|sucursal) \\d+` }
          : i % 2 === 0
            ? { field: 'DESCRIPTION', operator: 'contains', value: `comercio ${n}` }
            : { field: 'AMOUNT', operator: 'gte', value: String(1000 + n), currency: 'BOB' },
      ),
    );
  const client = await admin.connect();
  try {
    await client
      .query('DELETE FROM rules.rule_version WHERE workspace_id = $1', [workspaceId])
      .catch(() => undefined);
    await client.query(
      `INSERT INTO rules.rule (id, workspace_id, name, priority, triggers, match_mode, conditions, actions,
                               created_by, created_at, updated_at)
       SELECT gen_random_uuid(), $1, 'Regla ' || n, n, $4::text[], 'ALL', ($2::text[])[n]::jsonb, $3::jsonb, $5,
              now() + (n || ' milliseconds')::interval, now()
         FROM generate_series(1, $6::int) n`,
      [
        workspaceId,
        Array.from({ length: count }, (_, i) => conds(i + 1)),
        JSON.stringify([{ type: 'SET_CATEGORY', categoryId }]),
        triggers,
        userId,
        count,
      ],
    );
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  admin = new Pool({ connectionString: deps.superuserUrl, max: 2 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(perfApiEnv(deps)), apiLog.logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  const now = Math.floor(Date.now() / 1000);
  token = await new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: `kc-rules-perf-${randomUUID()}`,
    iat: now - 5,
    exp: now + 3600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `perf-rules-${randomUUID()}@pfos.test`,
    email_verified: true,
    name: 'perf',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(pair.privateKey);
  const me = await api('GET', '/api/v1/me');
  workspaceId = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
  userId = me.body['id'] as string;
  const W = `/api/v1/workspaces/${workspaceId}`;
  const account = await api('POST', `${W}/accounts`, {
    name: 'Banco perf',
    type: 'BANK',
    currency: 'BOB',
    openingBalance: { amount: { amount: '100000.00', currency: 'BOB' }, date: '2026-09-01' },
  });
  expect(account.status, JSON.stringify(account.body)).toBe(201);
  accountId = account.body['id'] as string;
  const cats = await api('GET', `${W}/categories?kind=EXPENSE&limit=5`);
  categoryId = (cats.body['data'] as { id: string }[])[0]!.id;
  queries = demoQueryRuntimes({ databaseUrl: deps.databaseUrl, today: '2026-10-20' });
}, 600_000);

afterAll(async () => {
  await Promise.all([runtime?.close(), queries?.close(), admin?.end()]);
});

const p95 = (times: number[]): number => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
};

const subjects = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    ref: `r${i}`,
    kind: 'EXPENSE' as const,
    accountId,
    date: '2026-10-05',
    amount: { amount: String(10 + (i % 997)) + '.00', currency: 'BOB' },
    description: `COMERCIO ${i % 400} SUC ${i % 13} REF ${i}`,
    counterpartyId: null,
    counterpartyOrigin: null,
    categoryId: null,
    tagIds: [],
    externalSource: IMPORT_ROW_NAMESPACE,
    customFields: [],
    splitCount: 1,
  }));

describe('add-rule-engine 7.3: evaluación', () => {
  it('[TC-RULES-ENGINE-050] 5 000 filas contra 200 reglas de 5 condiciones (una con regex): ≤ 3 s', async () => {
    await seedRules(200, 5, ['IMPORT', 'RETROACTIVE']);
    const rows = subjects(5000);
    const evaluate = async () => {
      const started = performance.now();
      const out = await queries.inWs(userId, workspaceId, () =>
        queries.r.rules.evaluation.evaluate({
          workspaceId,
          trigger: 'IMPORT',
          mode: 'FILL_EMPTY',
          subjects: rows,
        }),
      );
      expect(out).toHaveLength(5000);
      return performance.now() - started;
    };
    await evaluate(); // calienta el caché de árboles compilados
    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) times.push(await evaluate());
    const median = [...times].sort((a, b) => a - b)[2]!;
    console.info(
      `rules evaluate 5000 × 200: mediana ${Math.round(median)} ms (${times.map(Math.round).join(', ')})`,
    );
    expect(median).toBeLessThanOrEqual(EVAL_BUDGET_MS);
  }, 600_000);

  it('peor caso informativo: 5 000 filas contra 500 reglas de 20 condiciones (sin umbral)', async () => {
    await admin.query('DELETE FROM rules.rule WHERE workspace_id = $1', [workspaceId]);
    await seedRules(500, 20, ['IMPORT', 'RETROACTIVE']);
    const rows = subjects(5000);
    const started = performance.now();
    await queries.inWs(userId, workspaceId, () =>
      queries.r.rules.evaluation.evaluate({
        workspaceId,
        trigger: 'IMPORT',
        mode: 'FILL_EMPTY',
        subjects: rows,
      }),
    );
    console.info(`rules evaluate peor caso 5000 × 500 × 20: ${Math.round(performance.now() - started)} ms`);
  }, 600_000);
});

describe('add-rule-engine 7.3: registro manual', () => {
  it('[TC-RULES-ENGINE-051] con 200 reglas activas el registro suma ≤ 20 ms al p95', async () => {
    const W = `/api/v1/workspaces/${workspaceId}`;
    const record = async (applyRules: boolean) => {
      const started = performance.now();
      const r = await api('POST', `${W}/transactions`, {
        kind: 'EXPENSE',
        transactionDate: '2026-10-05',
        accountId,
        amount: { amount: '25.00', currency: 'BOB' },
        description: 'COMERCIO 7 SUC 3',
        applyRules,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return performance.now() - started;
    };
    await admin.query('DELETE FROM rules.rule WHERE workspace_id = $1', [workspaceId]);
    await seedRules(200, 5, ['MANUAL_CREATE']);
    await record(true);
    await record(false);
    // Intercalado: la carga del host afecta por igual a ambos brazos.
    const without: number[] = [];
    const withRules: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      without.push(await record(false));
      withRules.push(await record(true));
    }
    const delta = p95(withRules) - p95(without);
    console.info(
      `manual create: p95 sin reglas ${Math.round(p95(without))} ms, con 200 reglas ${Math.round(p95(withRules))} ms (Δ ${Math.round(delta)} ms)`,
    );
    expect(delta).toBeLessThanOrEqual(CREATE_BUDGET_MS);
  }, 600_000);
});
