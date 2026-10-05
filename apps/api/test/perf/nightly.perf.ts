import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createLedgerMaintenance, createLedgerRuntime } from '@pf/ledger/interface/ledger.module';
import { runWithRequestContext } from '@pf/platform/api';
import { loadConfig } from '@pf/platform/config';
import { systemClock } from '@pf/shared-kernel';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { daysInMonth, monthAt, ymd } from '../../src/demo/dataset/calendar.js';
import { buildLargePlan, LARGE_MAIN_WORKSPACE_ID, LARGE_MANIFEST } from '../../src/seed/large/large-plan.js';
import { MINIMAL_USERS, runSeed } from '../../src/seed/run-seed.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';
import {
  buildReport,
  latencyResult,
  PERF_THRESHOLDS,
  rlsResult,
  writeReport,
  type BenchResult,
} from './perf-report.js';

/**
 * Benchmarks nightly (docs/16 §5.15, docs/23 §5.5): PostgreSQL 18 real (Testcontainers, mismas imágenes que CI) con el
 * Large Seed (docs/29 §2.3) cargado por los casos de uso, la API en proceso (mismo `createApiRuntime` que producción)
 * y JWT firmados localmente. Mide NFR-PERF-001/003/004/005 y el overhead de RLS (add-ledger-core 5.5), escribe
 * `perf-results.json` + `perf-summary.md` y falla si algún p95 supera su umbral (docs/02).
 *
 * Variables: PF_PERF_SCALE (0..1, por defecto 1), PF_PERF_MONTHS / PF_PERF_SATELLITES (solo corridas rápidas),
 * PF_PERF_ITERATIONS (por defecto 200), PF_PERF_OUT (por defecto `reports/perf/` en la raíz del repo).
 */
const deps = inject('deps');
const env = process.env;
const SCALE = Number(env['PF_PERF_SCALE'] ?? '1');
const MONTHS = env['PF_PERF_MONTHS'] ? Number(env['PF_PERF_MONTHS']) : undefined;
const SATELLITES = env['PF_PERF_SATELLITES'] ? Number(env['PF_PERF_SATELLITES']) : undefined;
const ITERATIONS = Number(env['PF_PERF_ITERATIONS'] ?? '200');
const WARMUP = 10;
const OUT = env['PF_PERF_OUT'] ?? fileURLToPath(new URL('../../../../reports/perf/', import.meta.url));
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const WS = LARGE_MAIN_WORKSPACE_ID;
const W = `/api/v1/workspaces/${WS}`;

const results: BenchResult[] = [];
const dataset: Record<string, string | number> = {};
const timings: Record<string, number> = {};
let runtime: ApiRuntime | undefined;
let baseUrl = '';
let token = '';
let ownerId = '';
let app: Pool;
let worker: Pool;
let superuser: Client;
let appClient: Client;
const ids = { accounts: new Map<string, string>(), categories: new Map<string, string>() };

const ms = (started: number) => Math.round(performance.now() - started);

async function timed(n: number, fn: (i: number) => Promise<void>): Promise<number[]> {
  for (let i = 0; i < Math.min(WARMUP, n); i += 1) await fn(i);
  const samples: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = performance.now();
    await fn(i);
    samples.push(performance.now() - t);
  }
  return samples;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['idempotency-key'] = randomUUID();
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as unknown) : null };
}

async function ok(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const r = await call(method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as Record<string, unknown>;
}

const dataOf = (body: unknown): Record<string, unknown>[] =>
  (Array.isArray(body) ? body : ((body as { data?: unknown[] }).data ?? [])) as Record<string, unknown>[];

/** `EXPLAIN (ANALYZE, FORMAT JSON)` → Execution Time (ms) y nodos del plan. */
async function explain(
  client: Client,
  sql: string,
  values: readonly unknown[] = [],
): Promise<{ ms: number; nodes: string[] }> {
  const { rows } = await client.query<{ 'QUERY PLAN': [{ 'Execution Time': number; Plan: PlanNode }] }>(
    `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
    [...values],
  );
  const [root] = rows[0]!['QUERY PLAN'];
  const nodes: string[] = [];
  const walk = (n: PlanNode) => {
    nodes.push(n['Index Name'] ? `${n['Node Type']} (${n['Index Name']})` : n['Node Type']);
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(root.Plan);
  return { ms: root['Execution Time'], nodes };
}
interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

interface CapturedSql {
  readonly text: string;
  readonly values: readonly unknown[];
}

/**
 * Sentencias (texto + parámetros) que la aplicación emite por `pool` mientras corre `fn`, sin las de control de
 * transacción ni de contexto RLS: permite medir con EXPLAIN ANALYZE exactamente la consulta REAL (docs/31 D43).
 */
async function captureSql(pool: Pool, fn: () => Promise<unknown>): Promise<CapturedSql[]> {
  const captured: CapturedSql[] = [];
  const patched: { query: unknown }[] = [];
  const onAcquire = (client: { query: (...args: unknown[]) => unknown }) => {
    const original = client.query.bind(client);
    client.query = (...args: unknown[]) => {
      const [q, v] = args as [string | { text?: string; values?: unknown[] }, unknown[] | undefined];
      const text = typeof q === 'string' ? q : q?.text;
      const values = (typeof q === 'string' ? v : (q?.values ?? v)) ?? [];
      if (text && !/^\s*(BEGIN|COMMIT|ROLLBACK|SELECT set_config)/i.test(text))
        captured.push({ text, values });
      return original(...args);
    };
    patched.push(client);
  };
  pool.on('acquire', onAcquire);
  try {
    await fn();
  } finally {
    pool.off('acquire', onAcquire);
    for (const client of patched) delete client.query; // vuelve al método del prototipo
  }
  return captured;
}

/** Ejecuta `fn` como `pf_app` con el contexto RLS del owner sobre el workspace principal (siempre ROLLBACK). */
async function asApp<T>(fn: () => Promise<T>): Promise<T> {
  await appClient.query('BEGIN');
  try {
    await appClient.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
      [ownerId, WS],
    );
    return await fn();
  } finally {
    await appClient.query('ROLLBACK');
  }
}

beforeAll(async () => {
  const logger = capturingLogger('finance-api', 'seed', 'warn').logger;
  // 1) Large Seed por los casos de uso (pf_app, RLS activa).
  let t = performance.now();
  await runSeed(
    loadConfig('seed', {
      PFOS_ENV: 'ci',
      LOG_LEVEL: 'warn',
      DATABASE_URL: deps.databaseUrl,
      OIDC_ISSUER_URL: ISSUER,
    }),
    logger,
    'large',
    {
      scale: SCALE,
      concurrency: 4,
      ...(MONTHS !== undefined ? { months: MONTHS } : {}),
      ...(SATELLITES !== undefined ? { satellites: SATELLITES } : {}),
    },
  );
  timings['seed_large_ms'] = ms(t);
  superuser = new Client({ connectionString: deps.superuserUrl });
  await superuser.connect();
  // Mapa de visibilidad y estadísticas tras la carga masiva (en producción los mantiene autovacuum): sin VACUUM los
  // index-only scans hacen heap fetches que un sistema en régimen no tiene.
  t = performance.now();
  await superuser.query('VACUUM (ANALYZE)');
  timings['vacuum_analyze_ms'] = ms(t);
  const counts = await superuser.query<{ ws: string; txs: string; postings: string }>(
    `SELECT w.id::text AS ws,
            (SELECT count(*) FROM txn.transaction t WHERE t.workspace_id = w.id)::text AS txs,
            (SELECT count(*) FROM ledger.posting p WHERE p.workspace_id = w.id)::text AS postings
       FROM iam.workspace w`,
  );
  const main = counts.rows.find((r) => r.ws === WS);
  dataset['profile'] =
    `large v${LARGE_MANIFEST.datasetVersion} (scale ${SCALE}${MONTHS ? `, ${MONTHS} meses` : ''})`;
  dataset['transacciones (workspace principal)'] = Number(main?.txs ?? 0);
  dataset['postings (workspace principal)'] = Number(main?.postings ?? 0);
  dataset['workspaces'] = counts.rowCount ?? 0;
  dataset['transacciones (todos los workspaces)'] = counts.rows.reduce((n, r) => n + Number(r.txs), 0);
  dataset['postings (todos los workspaces)'] = counts.rows.reduce((n, r) => n + Number(r.postings), 0);
  dataset['carga del seed (ms)'] = timings['seed_large_ms']!;

  // 2) API en proceso con JWT locales y límites de tasa altos (el benchmark no mide el rate limiter).
  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'perf-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(
      baseEnv(deps, {
        LOG_LEVEL: 'warn',
        RATE_LIMIT_READS_PER_MIN: '1000000',
        RATE_LIMIT_WRITES_PER_MIN: '1000000',
      }),
    ),
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
  const me = await ok('GET', '/api/v1/me');
  ownerId = me['id'] as string;
  for (const a of dataOf(await ok('GET', `${W}/accounts`))) {
    const account = (a['account'] ?? a) as { id: string; name: string };
    ids.accounts.set(account.name, account.id);
  }
  for (const c of dataOf(await ok('GET', `${W}/categories`)))
    ids.categories.set(c['name'] as string, c['id'] as string);
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
  appClient = new Client({ connectionString: deps.databaseUrl });
  await appClient.connect();
}, 4 * 3600_000);

afterAll(async () => {
  const report = buildReport({
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      cpus: cpus().length,
      memoryGiB: Math.round(totalmem() / 2 ** 30),
      postgres: 'postgres:18.6 (Testcontainers)',
      iterations: ITERATIONS,
      ...Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, v])),
    },
    dataset,
    results,
  });
  const written = writeReport(report, OUT);
  console.info(
    `perf: ${written.md}\n${report.breaches.length === 0 ? 'sin brechas' : report.breaches.join('\n')}`,
  );
  await runtime?.close();
  await Promise.all([app?.end(), worker?.end(), superuser?.end(), appClient?.end()]);
});

describe('benchmarks nightly con el Large Seed (docs/02 §PERF)', () => {
  it('dataset: el workspace principal tiene ≥ 50 000 transacciones a escala 1 (precondición de los NFR)', () => {
    if (SCALE === 1 && MONTHS === undefined) {
      expect(dataset['transacciones (workspace principal)']).toBeGreaterThanOrEqual(50_000);
    }
    expect(Number(dataset['transacciones (workspace principal)'])).toBeGreaterThan(0);
  });

  it('NFR-PERF-005: saldo por cuenta y de todas las cuentas (sin snapshots y con el snapshot del job diario)', async () => {
    const ledger = createLedgerRuntime({
      pool: app,
      clock: systemClock,
      audit: { append: () => Promise.reject(new Error('solo lectura')) },
      outbox: { append: () => Promise.reject(new Error('solo lectura')) },
    });
    const asOwner = <T>(fn: () => Promise<T>) =>
      runWithRequestContext({ actor: { type: 'USER', userId: ownerId }, origin: 'api' }, fn);
    const lines = (await asOwner(() => ledger.accountBalances.getAccountBalances({ workspaceId: WS })))
      .balances;
    const ledgerIds = lines.map((l) => l.ledgerAccountId);
    expect(ledgerIds.length).toBeGreaterThan(0);
    const plan = buildLargePlan({ scale: SCALE, satellites: 0, ...(MONTHS ? { months: MONTHS } : {}) });
    const monthEnds = plan.workspaces[0]!.months.map((m) => {
      const [y, mo] = m.month.split('-').map(Number) as [number, number];
      return ymd(y, mo, daysInMonth(y, mo));
    });
    const asOfs = [undefined, ...monthEnds];
    const perAccount = (n: number) =>
      timed(n, async (i) => {
        const asOf = asOfs[i % asOfs.length];
        await asOwner(() =>
          ledger.balances.getBalance({
            workspaceId: WS,
            ledgerAccountId: ledgerIds[i % ledgerIds.length]!,
            ...(asOf ? { asOf } : {}),
          }),
        );
      });
    const allAccounts = (n: number) =>
      timed(n, () =>
        asOwner(() => ledger.accountBalances.getAccountBalances({ workspaceId: WS })).then(() => undefined),
      );

    results.push(
      latencyResult({
        id: 'ledger-balance-account-no-snapshot',
        nfr: 'NFR-PERF-005',
        title: 'Saldo por cuenta as-of, sin snapshots (Σ con índice INCLUDE)',
        samples: await perAccount(ITERATIONS),
        limitMs: PERF_THRESHOLDS['NFR-PERF-005'].limitMs,
        gate: false,
      }),
    );
    // `RebuildBalanceSnapshots` como el job diario del worker: reemplaza los snapshots del workspace por los del día
    // anterior a hoy (aquí, el último día cargado del dataset).
    const maintenance = createLedgerMaintenance({
      pool: worker,
      clock: systemClock,
      logger: capturingLogger('finance-api', 'worker', 'warn').logger,
      metrics: { increment: () => undefined },
    });
    const t = performance.now();
    const { snapshots, asOfDate } = await maintenance.rebuildBalanceSnapshots({
      asOfDate: monthEnds.at(-1)!,
      workspaceId: WS,
    });
    timings['snapshots_rebuild_ms'] = ms(t);
    dataset['snapshots de saldo'] = `${snapshots} (as-of ${asOfDate})`;
    await superuser.query('VACUUM (ANALYZE) ledger.balance_snapshot');

    results.push(
      latencyResult({
        id: 'ledger-balance-account',
        nfr: 'NFR-PERF-005',
        title: 'Saldo por cuenta as-of (con snapshots)',
        samples: await perAccount(ITERATIONS),
        limitMs: PERF_THRESHOLDS['NFR-PERF-005'].limitMs,
      }),
      latencyResult({
        id: 'ledger-balance-all-accounts',
        nfr: 'NFR-PERF-005',
        title: `Saldos de todas las cuentas del workspace (${ledgerIds.length})`,
        samples: await allAccounts(Math.max(50, ITERATIONS / 2)),
        limitMs: PERF_THRESHOLDS['NFR-PERF-005'].allAccountsLimitMs,
      }),
    );
  });

  it('NFR-PERF-001: listado de transacciones paginado (limit 50) con filtros por fecha, cuenta y categoría', async () => {
    const card = ids.accounts.get('Tarjeta Andina Demo')!;
    const bank = ids.accounts.get('Banco Andino Demo — Cuenta corriente')!;
    const category = ids.categories.get('Supermercado y minimarket')!;
    expect([card, bank, category].every(Boolean)).toBe(true);
    const first = await ok('GET', `${W}/transactions?limit=50`);
    expect(dataOf(first).length).toBe(50);
    const cursors: string[] = [];
    let cursor = (first['page'] as { nextCursor: string | null }).nextCursor;
    for (let p = 0; p < 20 && cursor; p += 1) {
      cursors.push(cursor);
      const page = await ok('GET', `${W}/transactions?limit=50&cursor=${encodeURIComponent(cursor)}`);
      cursor = (page['page'] as { nextCursor: string | null }).nextCursor;
    }
    const scenarios: Record<string, (i: number) => string> = {
      'sin filtros': () => '?limit=50',
      'rango de fechas (1 mes)': (i) => {
        const { y, m } = monthAt(
          LARGE_MANIFEST.startYear,
          LARGE_MANIFEST.startMonth,
          (i * 7) % (MONTHS ?? 60),
        );
        return `?limit=50&dateFrom=${ymd(y, m, 1)}&dateTo=${ymd(y, m, daysInMonth(y, m))}`;
      },
      cuenta: (i) => `?limit=50&accountId=${i % 2 === 0 ? card : bank}`,
      categoría: () => `?limit=50&categoryId=${category}`,
      'cuenta + categoría + año': () =>
        `?limit=50&accountId=${card}&categoryId=${category}&dateFrom=2025-01-01&dateTo=2025-12-31`,
      'páginas siguientes (cursor)': (i) =>
        cursors.length > 0
          ? `?limit=50&cursor=${encodeURIComponent(cursors[i % cursors.length]!)}`
          : '?limit=50',
    };
    const all: number[] = [];
    for (const [name, query] of Object.entries(scenarios)) {
      const samples = await timed(Math.max(30, Math.round(ITERATIONS / 4)), async (i) => {
        const r = await call('GET', `${W}/transactions${query(i)}`);
        if (r.status !== 200) throw new Error(`${name}: ${r.status} ${JSON.stringify(r.body)}`);
      });
      all.push(...samples);
      results.push(
        latencyResult({
          id: `transactions-list-${name}`,
          nfr: 'NFR-PERF-001',
          title: `Listado: ${name}`,
          samples,
          limitMs: PERF_THRESHOLDS['NFR-PERF-001'].limitMs,
          gate: false,
        }),
      );
    }
    results.push(
      latencyResult({
        id: 'transactions-list',
        nfr: 'NFR-PERF-001',
        title: 'Listado de transacciones (todos los escenarios)',
        samples: all,
        limitMs: PERF_THRESHOLDS['NFR-PERF-001'].limitMs,
        notes: `umbral local/CI ${PERF_THRESHOLDS['NFR-PERF-001'].limitMs} ms; objetivo cloud ${PERF_THRESHOLDS['NFR-PERF-001'].cloudLimitMs} ms (informativo)`,
      }),
    );
  });

  it('NFR-PERF-004: GET /reports/summary (dashboard) sin caché condicional', async () => {
    const samples = await timed(ITERATIONS, async (i) => {
      const r = await call('GET', `${W}/reports/summary${i % 2 === 0 ? '' : '?month=2026-09'}`);
      if (r.status !== 200) throw new Error(`summary: ${r.status} ${JSON.stringify(r.body)}`);
    });
    results.push(
      latencyResult({
        id: 'reports-summary',
        nfr: 'NFR-PERF-004',
        title: 'GET /reports/summary (mes actual y 2026-09)',
        samples,
        limitMs: PERF_THRESHOLDS['NFR-PERF-004'].limitMs,
      }),
    );
  });

  it('RLS: overhead < 10 % en la consulta real de saldos (PgBalanceQuery) y las de índice; agregado sintético informativo (docs/31 D43)', async () => {
    const card = ids.accounts.get('Tarjeta Andina Demo')!;
    const { rows } = await superuser.query<{ id: string }>(
      `SELECT id::text FROM ledger.ledger_account WHERE workspace_id = $1 AND source_account_id = $2`,
      [WS, card],
    );
    const ledgerAccount = rows[0]!.id;
    const lit = (v: string) => superuser.escapeLiteral(v);
    /** EXPLAIN ANALYZE con RLS (pf_app + contexto) vs sin RLS (superusuario), intercalados; Σ de las sentencias. */
    const measure = async (statements: readonly CapturedSql[]) => {
      const run = async (client: Client) => {
        let total = 0;
        let nodes: string[] = [];
        for (const st of statements) {
          const r = await explain(client, st.text, st.values);
          total += r.ms;
          if (r.nodes.length > nodes.length) nodes = r.nodes; // el plan de la sentencia principal
        }
        return { ms: total, nodes };
      };
      const withRls: number[] = [];
      const withoutRls: number[] = [];
      let nodes: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        await asApp(() => run(appClient));
        await run(superuser);
      }
      for (let i = 0; i < 40; i += 1) {
        const a = await asApp(() => run(appClient));
        withRls.push(a.ms);
        nodes = a.nodes;
        withoutRls.push((await run(superuser)).ms);
      }
      return { withRls, withoutRls, plan: nodes.join(' → ') };
    };

    // 1) Gate (D43): las sentencias que emite la aplicación (`PgBalanceQuery`, con snapshots del job diario).
    const capturePool = new Pool({ connectionString: deps.databaseUrl, max: 1 });
    try {
      const ledger = createLedgerRuntime({
        pool: capturePool,
        clock: systemClock,
        audit: { append: () => Promise.reject(new Error('solo lectura')) },
        outbox: { append: () => Promise.reject(new Error('solo lectura')) },
      });
      const asOwner = <T>(fn: () => Promise<T>) =>
        runWithRequestContext({ actor: { type: 'USER', userId: ownerId }, origin: 'api' }, fn);
      const real: Record<string, CapturedSql[]> = {
        'consulta real de saldos en lote (PgBalanceQuery.getAccountBalances)': await captureSql(
          capturePool,
          () => asOwner(() => ledger.accountBalances.getAccountBalances({ workspaceId: WS })),
        ),
        'consulta real de saldo por cuenta (PgBalanceQuery.getBalance)': await captureSql(capturePool, () =>
          asOwner(() => ledger.balances.getBalance({ workspaceId: WS, ledgerAccountId: ledgerAccount })),
        ),
      };
      for (const [name, statements] of Object.entries(real)) {
        expect(statements.length, name).toBeGreaterThan(0);
        const m = await measure(statements);
        results.push(
          rlsResult({
            id: `rls-${name}`,
            title: `Overhead RLS: ${name} (${statements.length} sentencias)`,
            ...m,
          }),
        );
      }
    } finally {
      await capturePool.end();
    }

    // 2) Consultas de índice (gate) y agregado sintético de todo el workspace (informativo, D43).
    const queries: Record<string, { sql: string; gate: boolean }> = {
      'saldo por cuenta (índice INCLUDE)': {
        sql: `SELECT COALESCE(SUM(p.amount), 0) FROM ledger.posting p
         WHERE p.workspace_id = ${lit(WS)} AND p.ledger_account_id = ${lit(ledgerAccount)}
           AND p.entry_date <= DATE '2026-09-30'`,
        gate: true,
      },
      'agregado sintético de todo el workspace (informativo)': {
        sql: `SELECT p.ledger_account_id, SUM(p.amount) FROM ledger.posting p
         WHERE p.workspace_id = ${lit(WS)} GROUP BY p.ledger_account_id`,
        gate: false,
      },
      'página de transacciones (1 mes)': {
        sql: `SELECT t.id FROM txn.transaction t
         WHERE t.workspace_id = ${lit(WS)} AND t.transaction_date BETWEEN DATE '2025-06-01' AND DATE '2025-06-30'
         ORDER BY t.transaction_date DESC, t.id DESC LIMIT 50`,
        gate: true,
      },
    };
    for (const [name, q] of Object.entries(queries)) {
      const m = await measure([{ text: q.sql, values: [] }]);
      results.push(rlsResult({ id: `rls-${name}`, title: `Overhead RLS: ${name}`, gate: q.gate, ...m }));
    }
  });

  it('NFR-PERF-003: comandos de escritura (gasto, transferencia y conversión con posting + audit + outbox)', async () => {
    const card = ids.accounts.get('Tarjeta Andina Demo')!;
    const bank = ids.accounts.get('Banco Andino Demo — Cuenta corriente')!;
    const savings = ids.accounts.get('Banco Andino Demo — Caja de ahorro')!;
    const usdt = ids.accounts.get('P2P Exchange Demo — Billetera USDT')!;
    const category = ids.categories.get('Supermercado y minimarket')!;
    const n = Math.max(50, Math.round(ITERATIONS / 2));
    const commands: [string, string, (i: number) => unknown][] = [
      [
        'POST /transactions (gasto)',
        '/transactions',
        (i) => ({
          kind: 'EXPENSE',
          transactionDate: '2026-09-30',
          accountId: card,
          amount: { amount: `${10 + (i % 90)}.50`, currency: 'BOB' },
          description: 'Compra benchmark',
          paymentMethod: 'CREDIT_CARD',
          splits: [{ amount: { amount: `${10 + (i % 90)}.50`, currency: 'BOB' }, categoryId: category }],
        }),
      ],
      [
        'POST /transfers',
        '/transfers',
        (i) => ({
          transactionDate: '2026-09-30',
          fromAccountId: bank,
          toAccountId: savings,
          amount: { amount: `${1 + (i % 50)}.00`, currency: 'BOB' },
        }),
      ],
      [
        'POST /conversions',
        '/conversions',
        () => ({
          transactionDate: '2026-09-30',
          sourceAccountId: bank,
          targetAccountId: usdt,
          sourceAmount: { amount: '70.00', currency: 'BOB' },
          targetAmount: { amount: '10.000000', currency: 'USDT' },
          quotedRate: { base: 'USDT', quote: 'BOB', value: '7.00' },
          fees: [],
          provider: { name: 'P2P Exchange Demo' },
          executedAt: '2026-09-30T16:00:00.000Z',
        }),
      ],
    ];
    for (const [title, path, body] of commands) {
      const samples = await timed(n, async (i) => {
        const r = await call('POST', `${W}${path}`, body(i));
        if (r.status !== 201) throw new Error(`${title}: ${r.status} ${JSON.stringify(r.body)}`);
      });
      results.push(
        latencyResult({
          id: `write-${path.slice(1)}`,
          nfr: 'NFR-PERF-003',
          title,
          samples,
          limitMs: PERF_THRESHOLDS['NFR-PERF-003'].limitMs,
        }),
      );
    }
  });

  it('ningún p95 supera su umbral (docs/02 §PERF) ni el overhead de RLS (add-ledger-core 5.5)', () => {
    const breaches = results
      .filter((r) => r.gate && !r.passed)
      .map((r) => `${r.id}: ${r.value} > ${r.limit}`);
    expect(breaches).toEqual([]);
  });
});
