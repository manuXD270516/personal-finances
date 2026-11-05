import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { loadConfig } from '@pf/platform/config';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { LARGE_MAIN_WORKSPACE_ID } from '../../src/seed/large/large-plan.js';
import { MINIMAL_USERS, runSeed } from '../../src/seed/run-seed.js';
import { apiConfig, capturingLogger } from '../support/harness.js';
import { recordSuiteLoad } from './background-load.js';
import { perfApiEnv } from './perf-env.js';
import { PERF_THRESHOLDS } from './perf-report.js';

/**
 * add-historical-budgets 7.3 (TC-PLANNING-HISTBUDGET-029, NFR-PERF-006): `previewBudgetSuggestions` con N = 12 y un plan de
 * 60 líneas sobre el Large Seed responde con p95 ≤ 800 ms. Corre después de `nightly.perf.ts` (que carga el seed; si se
 * corre sola, lo carga a escala reducida). El plan se arma con hojas del árbol de categorías del workspace principal y,
 * si faltan, categorías nuevas hasta 60 líneas sin solapamientos. Corre en el job nightly `perf` (`pnpm perf:bench`); no
 * bloquea los PR.
 */
const deps = inject('deps');
recordSuiteLoad(import.meta.url, deps.superuserUrl);
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const BUDGET_MS = PERF_THRESHOLDS['NFR-PERF-006'].limitMs;
const SAMPLES = 30;
const LINES = 60;
const WS = LARGE_MAIN_WORKSPACE_ID;
const W = `/api/v1/workspaces/${WS}`;

let runtime: ApiRuntime;
let baseUrl = '';
let token = '';
let targetPeriod = '';

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
const ok = async (method: string, path: string, body?: unknown) => {
  const r = await api(method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

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
  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'perf-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(perfApiEnv(deps, { LOG_LEVEL: 'warn' })),
    capturingLogger('finance-api', 'api', 'warn').logger,
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

  // Periodo del benchmark: el activo o el primero en borrador; si ya tiene plan (el seed los crea) se le agregan líneas.
  // El seed no crea los periodos (los crea el worker): se piden hasta dentro de dos meses, con cobertura retroactiva.
  const through = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  await ok('POST', `${W}/periods`, { through });
  const periods = (await ok('GET', `${W}/periods?limit=100`))['data'] as {
    id: string;
    status: string;
    periodStart: string;
  }[];
  const candidates = periods
    .filter((p) => p.status === 'ACTIVE' || p.status === 'DRAFT')
    .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
  expect(
    candidates.length,
    `periodos: ${JSON.stringify(periods.slice(-4))} total ${periods.length}`,
  ).toBeGreaterThan(0);
  let planId = '';
  let reuseLeaves = false;
  for (const p of candidates) {
    const existing = await api('GET', `${W}/periods/${p.id}/budget`);
    if (existing.status === 404) {
      targetPeriod = p.id;
      planId = String((await ok('POST', `${W}/budgets`, { periodId: p.id }))['id']);
      reuseLeaves = true;
      break;
    }
  }
  if (!planId) {
    targetPeriod = candidates[0]!.id;
    planId = String((await ok('GET', `${W}/periods/${targetPeriod}/budget`))['id']);
  }

  // 60 líneas sobre objetivos que no se solapan: hojas del árbol de gasto (plan nuevo) y categorías nuevas hasta 60.
  const categories = (await ok('GET', `${W}/categories?kind=EXPENSE&limit=200`))['data'] as {
    id: string;
    parentId: string | null;
    archived?: boolean;
  }[];
  const parents = new Set(categories.map((c) => c.parentId).filter((id): id is string => id !== null));
  const targets = reuseLeaves
    ? categories.filter((c) => !parents.has(c.id) && !c.archived).map((c) => c.id)
    : [];
  if (targets.length < LINES) {
    const group = await ok('POST', `${W}/category-groups`, {
      name: `Perf sugerencias ${randomUUID()}`,
      kind: 'EXPENSE',
    });
    for (let i = targets.length; i < LINES; i += 1) {
      const c = await ok('POST', `${W}/categories`, { groupId: group['id'], name: `Perf ${i}` });
      targets.push(c['id'] as string);
    }
  }
  for (const id of targets.slice(0, LINES)) {
    await ok('POST', `${W}/budgets/${planId}/lines`, {
      target: { kind: 'CATEGORY', id },
      kind: 'MAXIMUM',
      planned: { amount: '100.00', currency: 'BOB' },
    });
  }
}, 4 * 3600_000);

afterAll(async () => {
  await runtime?.close();
});

const p95 = (times: number[]): number => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
};

describe('NFR-PERF-006: sugerencias de presupuesto desde el historial', () => {
  it('[TC-PLANNING-HISTBUDGET-029] previewBudgetSuggestions con N = 12 y 60 líneas sobre el Large Seed: p95 ≤ 800 ms', async () => {
    const read = async () => {
      const started = performance.now();
      const r = await api('POST', `${W}/budget-suggestions/preview`, { periodId: targetPeriod, periods: 12 });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((r.body['lines'] as unknown[]).length).toBeGreaterThanOrEqual(LINES);
      return performance.now() - started;
    };
    await read(); // calentamiento
    const times: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) times.push(await read());
    console.info(
      `budget-suggestions (N=12, ${LINES} líneas): p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`,
    );
    expect(p95(times)).toBeLessThanOrEqual(BUDGET_MS);
  });
});
