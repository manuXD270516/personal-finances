import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { applyRlsContext, purgeExpiredIdempotencyKeys, type ApiContract } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import {
  HarnessModule,
  harnessContract,
  newHarnessState,
  testPrincipalMiddleware,
  type HarnessState,
  type WorkspaceRecord,
} from '../support/conventions-harness.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

const deps = inject('deps');
const EDITOR = '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9e01';
const ACCOUNT = '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9a01';
const CATEGORY = '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9c01';

interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown> & { errors?: { pointer: string; code: string; in?: string }[] };
  text: string;
}

describe('convenciones de la API /api/v1 (platform/api-conventions)', () => {
  const logs = capturingLogger('finance-api', 'api');
  const clock = new FixedClock(Instant.parse('2026-10-01T03:30:00Z'));
  let state: HarnessState;
  let contract: ApiContract;
  let runtime: ApiRuntime;
  let baseUrl: string;
  let migrator: Client;

  beforeAll(async () => {
    migrator = new Client({ connectionString: deps.migratorUrl });
    await migrator.connect();
    await migrator.query(`
      CREATE TABLE IF NOT EXISTS platform.test_expense (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL, amount numeric(38,18) NOT NULL, currency text NOT NULL);
      CREATE TABLE IF NOT EXISTS platform.test_balance (account_id uuid PRIMARY KEY, balance numeric(38,18) NOT NULL);
    `);
    state = newHarnessState();
    contract = harnessContract();
    runtime = await createApiRuntime(apiConfig(baseEnv(deps)), logs.logger, {
      contract,
      clock,
      imports: (_resources, conventions) => [HarnessModule.register(state, conventions)],
      middleware: testPrincipalMiddleware,
    });
    baseUrl = await runtime.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await runtime?.close();
    await migrator?.query('DROP TABLE IF EXISTS platform.test_expense, platform.test_balance');
    await migrator?.end();
  });

  beforeEach(() => {
    clock.set(Instant.parse('2026-10-01T03:30:00Z'));
    state.commandDelayMs = 0;
  });

  async function call(
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string>; user?: string; raw?: string } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = { 'x-test-user': options.user ?? EDITOR, ...options.headers };
    let payload: string | undefined = options.raw;
    if (options.body !== undefined) {
      payload = JSON.stringify(options.body);
      headers['content-type'] ??= 'application/json';
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: payload }),
    });
    const text = await res.text();
    let body: Reply['body'];
    try {
      body = text ? (JSON.parse(text) as Reply['body']) : {};
    } catch {
      body = {};
    }
    return { status: res.status, headers: res.headers, body, text };
  }

  const expenseBody = (amount: string, currency = 'BOB', extra: Record<string, unknown> = {}) => ({
    kind: 'EXPENSE',
    transactionDate: '2026-09-30',
    accountId: ACCOUNT,
    amount: { amount, currency },
    ...extra,
  });

  const postExpense = (ws: string, key: string | undefined, body: unknown, user = EDITOR) =>
    call('POST', `/api/v1/workspaces/${ws}/transactions`, {
      body,
      user,
      headers: key === undefined ? {} : { 'Idempotency-Key': key },
    });

  const countExpenses = async (ws: string, amount?: string) => {
    const { rows } = await migrator.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM platform.test_expense WHERE workspace_id = $1 ${amount ? 'AND amount = $2::numeric' : ''}`,
      amount ? [ws, amount] : [ws],
    );
    return Number(rows[0]?.n);
  };

  const expectProblem = (r: Reply, status: number, code: string) => {
    expect(r.status, r.text).toBe(status);
    expect(r.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(r.body).toMatchObject({
      status,
      code,
      type: expect.stringMatching(/^https:\/\/pfos\.dev\/problems\//),
    });
    expect(typeof r.body['title']).toBe('string');
    expect(r.body['requestId']).toBe(r.headers.get('x-request-id'));
  };

  const seedWorkspace = (version: number, name = 'Personal Demo'): WorkspaceRecord => {
    const w: WorkspaceRecord = {
      id: randomUUID(),
      name,
      baseCurrency: 'BOB',
      version,
      minimumLiquidityReserve: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    state.workspaces.set(w.id, w);
    return w;
  };

  it('[TC-PLATFORM-API-001] las operaciones viven bajo /api/v1 y una versión no publicada o ruta desconocida responde 404', async () => {
    expect((await call('GET', '/api/v1/me')).status).toBe(200);
    for (const path of ['/api/v2/me', '/api/v1/no-existe']) {
      const r = await call('GET', path);
      expectProblem(r, 404, 'RESOURCE_NOT_FOUND');
    }
  });

  it('[TC-PLATFORM-API-003] una operación deprecada responde Deprecation, Sunset (≥ 2026-12-31) y Link rel="deprecation"', async () => {
    const r = await call('GET', '/api/v1/_test/deprecated');
    expect(r.status).toBe(200);
    expect(r.headers.get('deprecation')).toBe(`@${Date.parse('2026-10-02T00:00:00Z') / 1000}`);
    const sunset = Date.parse(r.headers.get('sunset') ?? '');
    expect(sunset).toBeGreaterThanOrEqual(Date.parse('2026-12-31T00:00:00Z'));
    expect(r.headers.get('link')).toMatch(/^<https:\/\/.+>; rel="deprecation"$/);
    expect((await call('GET', '/api/v1/me')).headers.get('deprecation')).toBeNull();
  });

  it('[TC-PLATFORM-API-004] un split de 75.001 BOB ⇒ 422 problem+json con AMOUNT_SCALE_EXCEEDED y pointer /splits/0/amount', async () => {
    const ws = randomUUID();
    const r = await postExpense(
      ws,
      `K-0004-${randomUUID()}`,
      expenseBody('75.00', 'BOB', {
        splits: [{ amount: { amount: '75.001', currency: 'BOB' }, categoryId: CATEGORY }],
      }),
    );
    expectProblem(r, 422, 'AMOUNT_SCALE_EXCEEDED');
    expect(r.body.errors?.[0]).toMatchObject({ pointer: '/splits/0/amount', code: 'AMOUNT_SCALE_EXCEEDED' });
    expect(contract.validateResponse('createTransaction', 422, r.body, 'application/problem+json')).toEqual(
      [],
    );
    expect(await countExpenses(ws)).toBe(0);
  });

  it('[TC-PLATFORM-API-004] una excepción no controlada ⇒ 500 INTERNAL_ERROR sin internos y con requestId en los logs', async () => {
    const r = await call('GET', '/api/v1/_test/boom');
    expectProblem(r, 500, 'INTERNAL_ERROR');
    expect(r.text).not.toMatch(/SELECT|iam\.workspace|relation|\.ts:|at /);
    const requestId = String(r.body['requestId']);
    const line = logs.records().find((l) => l['msg'] === 'unhandled error' && l['request_id'] === requestId);
    expect(line, 'línea de log con el mismo requestId').toBeDefined();
    expect(JSON.stringify(line)).toContain('iam.workspace');
  });

  it('[TC-PLATFORM-API-004] JSON malformado ⇒ 400 VALIDATION_FAILED en problem+json', async () => {
    const r = await call('POST', '/api/v1/workspaces', {
      raw: '{"name": ',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': `K-0004-${randomUUID()}` },
    });
    expectProblem(r, 400, 'VALIDATION_FAILED');
  });

  it('[TC-PLATFORM-API-006] campos desconocidos, ausentes o de tipo incorrecto ⇒ 400 VALIDATION_FAILED sin crear nada', async () => {
    const before = state.createdWorkspaces;
    const cases: [unknown, string][] = [
      [{ name: 'Hogar', baseCurrency: 'BOB', ownerId: '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9d8e' }, '/ownerId'],
      [{ baseCurrency: 'BOB' }, '/name'],
      [{ name: 123, baseCurrency: 'BOB' }, '/name'],
    ];
    for (const [body, pointer] of cases) {
      const r = await call('POST', '/api/v1/workspaces', {
        body,
        headers: { 'Idempotency-Key': `K-0006-${randomUUID()}` },
      });
      expectProblem(r, 400, 'VALIDATION_FAILED');
      expect(r.body.errors?.map((e) => e.pointer)).toContain(pointer);
    }
    expect(state.createdWorkspaces).toBe(before);
  });

  it('[TC-PLATFORM-API-007] sin Idempotency-Key ⇒ 428; con clave "abc" ⇒ 400; ningún efecto', async () => {
    const ws = randomUUID();
    expectProblem(await postExpense(ws, undefined, expenseBody('75.00')), 428, 'IDEMPOTENCY_KEY_REQUIRED');
    const bad = await postExpense(ws, 'abc', expenseBody('75.00'));
    expectProblem(bad, 400, 'VALIDATION_FAILED');
    expect(bad.body.errors?.[0]).toMatchObject({ pointer: '/Idempotency-Key', in: 'header' });
    expect(await countExpenses(ws)).toBe(0);
  });

  it('[TC-TRANSACTIONS-IDEMPOTENCY-001] repetir el POST con la misma clave reproduce 201, Location y ETag sin duplicar ni descontar dos veces', async () => {
    const ws = randomUUID();
    const key = '0191f0c2-7a1e-7c4e-9a51-3f2d7c1b9e01';
    const account = randomUUID();
    const first = await postExpense(ws, key, expenseBody('75.00', 'BOB', { accountId: account }));
    const second = await postExpense(ws, key, expenseBody('75.00', 'BOB', { accountId: account }));
    expect(first.status, first.text).toBe(201);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(second.body['id']).toBe(first.body['id']);
    expect(second.headers.get('location')).toBe(first.headers.get('location'));
    expect(second.headers.get('etag')).toBe('"1"');
    expect(second.body).toEqual(first.body);
    expect(await countExpenses(ws)).toBe(1);
    const { rows } = await migrator.query<{ balance: string }>(
      'SELECT balance::numeric(38,2)::text AS balance FROM platform.test_balance WHERE account_id = $1',
      [account],
    );
    expect(rows[0]?.balance).toBe('925.00');
  });

  it('[TC-PLATFORM-API-008] la misma clave con otro monto ⇒ 422 IDEMPOTENCY_KEY_REUSED y solo existe el gasto de 75.00', async () => {
    const ws = randomUUID();
    expect((await postExpense(ws, 'K-0001-0001-0001', expenseBody('75.00'))).status).toBe(201);
    expectProblem(
      await postExpense(ws, 'K-0001-0001-0001', expenseBody('80.00')),
      422,
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(await countExpenses(ws)).toBe(1);
    expect(await countExpenses(ws, '75.00')).toBe(1);
  });

  it('[TC-PLATFORM-API-009] dos peticiones simultáneas con la misma clave producen exactamente un efecto', async () => {
    const ws = randomUUID();
    state.commandDelayMs = 500;
    const [a, b] = await Promise.all([
      postExpense(ws, 'K-0009-0009-0009', expenseBody('75.00')),
      postExpense(ws, 'K-0009-0009-0009', expenseBody('75.00')),
    ]);
    const statuses = [a.status, b.status].sort();
    const other = a.headers.get('idempotent-replayed') === null && a.status === 201 ? b : a;
    expect(statuses).toContain(201);
    if (other.status === 409) {
      expectProblem(other, 409, 'IDEMPOTENCY_REQUEST_IN_PROGRESS');
      expect(other.headers.get('retry-after')).toBe('1');
    } else {
      expect(other.status).toBe(201);
      expect(other.headers.get('idempotent-replayed')).toBe('true');
    }
    expect(await countExpenses(ws, '75.00')).toBe(1);
  });

  it('[TC-PLATFORM-API-010] un 503 no consume la clave: el reintento responde 201 sin replay y hay un solo gasto', async () => {
    const ws = randomUUID();
    state.failNextWithDbDown = true;
    const down = await postExpense(ws, 'K-0002-0002-0002', expenseBody('75.00'));
    expectProblem(down, 503, 'SERVICE_UNAVAILABLE');
    expect(down.headers.get('retry-after')).toMatch(/^\d+$/);
    const retry = await postExpense(ws, 'K-0002-0002-0002', expenseBody('75.00'));
    expect(retry.status).toBe(201);
    expect(retry.headers.get('idempotent-replayed')).toBeNull();
    expect(await countExpenses(ws)).toBe(1);
  });

  it('[TC-PLATFORM-API-010] un rechazo de dominio 422 se reproduce con Idempotent-Replayed: true', async () => {
    const ws = randomUUID();
    const first = await postExpense(ws, 'K-0003-0003-0003', expenseBody('685.005'));
    expectProblem(first, 422, 'AMOUNT_SCALE_EXCEEDED');
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    const second = await postExpense(ws, 'K-0003-0003-0003', expenseBody('685.005'));
    expect(second.status).toBe(422);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(second.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(second.body['code']).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(await countExpenses(ws)).toBe(0);
  });

  it('[TC-PLATFORM-API-011] una clave vencida (25 h, retención 24 h) se purga y el reenvío crea un segundo gasto', async () => {
    const ws = randomUUID();
    clock.set(Instant.parse('2026-10-01T10:00:00Z'));
    expect((await postExpense(ws, 'K-0011-0011-0011', expenseBody('75.00'))).status).toBe(201);
    clock.set(Instant.parse('2026-10-02T11:00:00Z'));
    expect(await purgeExpiredIdempotencyKeys(runtime.resources.pool)).toBeGreaterThanOrEqual(1);
    const client = await runtime.resources.pool.connect();
    try {
      await client.query('BEGIN');
      await applyRlsContext(client, { workspaceId: ws, userId: EDITOR });
      const { rows } = await client.query(
        `SELECT 1 FROM platform.idempotency_key WHERE key = 'K-0011-0011-0011'`,
      );
      expect(rows).toHaveLength(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const again = await postExpense(ws, 'K-0011-0011-0011', expenseBody('75.00'));
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotent-replayed')).toBeNull();
    expect(await countExpenses(ws, '75.00')).toBe(2);
  });

  it('[TC-PLATFORM-API-012] GET de un agregado devuelve ETag fuerte; If-None-Match vigente ⇒ 304 sin cuerpo', async () => {
    const w = seedWorkspace(3);
    const first = await call('GET', `/api/v1/workspaces/${w.id}`);
    expect(first.status).toBe(200);
    expect(first.headers.get('etag')).toBe('"3"');
    expect(contract.validateResponse('getWorkspace', 200, first.body)).toEqual([]);
    const cached = await call('GET', `/api/v1/workspaces/${w.id}`, { headers: { 'If-None-Match': '"3"' } });
    expect(cached.status).toBe(304);
    expect(cached.text).toBe('');
    expect(cached.headers.get('etag')).toBe('"3"');
    const stale = await call('GET', `/api/v1/workspaces/${w.id}`, { headers: { 'If-None-Match': '"2"' } });
    expect(stale.status).toBe(200);
    expect(stale.headers.get('etag')).toBe('"3"');
    expect(stale.body['name']).toBe('Personal Demo');
  });

  it('[TC-PLATFORM-API-013] una modificación sin If-Match ⇒ 428 PRECONDITION_REQUIRED y nada cambia', async () => {
    const w = seedWorkspace(3);
    const r = await call('PATCH', `/api/v1/workspaces/${w.id}`, {
      body: { name: 'Otro nombre' },
      headers: { 'content-type': 'application/merge-patch+json' },
    });
    expectProblem(r, 428, 'PRECONDITION_REQUIRED');
    const after = await call('GET', `/api/v1/workspaces/${w.id}`);
    expect(after.body).toMatchObject({ name: 'Personal Demo', version: 3 });
  });

  it('[TC-PLATFORM-API-014] editar sobre una versión obsoleta ⇒ 412 con currentVersion; carrera ⇒ 409 CONCURRENCY_CONFLICT', async () => {
    const w = seedWorkspace(4);
    const patch = (name: string, ifMatch: string) =>
      call('PATCH', `/api/v1/workspaces/${w.id}`, {
        body: { name },
        headers: { 'content-type': 'application/merge-patch+json', 'If-Match': ifMatch },
      });
    const first = await patch('80.00', '"4"');
    expect(first.status, first.text).toBe(200);
    expect(first.headers.get('etag')).toBe('"5"');
    expect(contract.validateResponse('updateWorkspace', 200, first.body)).toEqual([]);
    const stale = await patch('90.00', '"4"');
    expectProblem(stale, 412, 'PRECONDITION_FAILED');
    expect(stale.body['currentVersion']).toBe(5);
    expect((await call('GET', `/api/v1/workspaces/${w.id}`)).body['name']).toBe('80.00');
    state.raceOnNextUpdate = true;
    const race = await patch('70.00', '"5"');
    expectProblem(race, 409, 'CONCURRENCY_CONFLICT');
    expect((await call('GET', `/api/v1/workspaces/${w.id}`)).body['name']).toBe('80.00');
    expectProblem(await patch('x', 'W/"6"'), 400, 'VALIDATION_FAILED');
  });

  it('[TC-PLATFORM-API-015] 120 elementos se recorren con limit=50 en páginas de 50, 50 y 20; limit=500 ⇒ 400', async () => {
    const ids = Array.from({ length: 120 }, () => seedWorkspace(1).id);
    state.userWorkspaces.set('*', ids);
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const r = await call('GET', `/api/v1/workspaces?limit=50${q}`);
      expect(r.status, r.text).toBe(200);
      expect(contract.validateResponse('listWorkspaces', 200, r.body)).toEqual([]);
      const data = r.body['data'] as { id: string }[];
      const page = r.body['page'] as { limit: number; hasMore: boolean; nextCursor: string | null };
      seen.push(...data.map((d) => d.id));
      sizes.push(data.length);
      cursor = page.nextCursor;
      if (!page.hasMore) expect(page.nextCursor).toBeNull();
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expectProblem(await call('GET', '/api/v1/workspaces?limit=500'), 400, 'VALIDATION_FAILED');
    expectProblem(await call('GET', '/api/v1/workspaces?unknownFilter=1'), 400, 'VALIDATION_FAILED');
  });

  it('[TC-PLATFORM-API-016] cursor alterado, de otros filtros o de otro workspace ⇒ 400 INVALID_CURSOR sin datos', async () => {
    const w1 = randomUUID();
    const w2 = randomUUID();
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: randomUUID(),
      currency: i % 2 === 0 ? 'BOB' : 'USD',
      transactionDate: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`,
    }));
    state.listItems.set(w1, items);
    state.listItems.set(w2, items);
    const ok = await call('GET', `/api/v1/workspaces/${w1}/transactions?limit=10&currency=BOB`);
    expect(ok.status, ok.text).toBe(200);
    const cursor = String((ok.body['page'] as { nextCursor: string }).nextCursor);
    const next = await call(
      'GET',
      `/api/v1/workspaces/${w1}/transactions?limit=10&currency=BOB&cursor=${cursor}`,
    );
    expect(next.status).toBe(200);
    const flipped = `${cursor.slice(0, 5)}${cursor[5] === 'A' ? 'B' : 'A'}${cursor.slice(6)}`;
    for (const path of [
      `/api/v1/workspaces/${w1}/transactions?limit=10&currency=BOB&cursor=${flipped}`,
      `/api/v1/workspaces/${w1}/transactions?limit=10&currency=USD&cursor=${cursor}`,
      `/api/v1/workspaces/${w2}/transactions?limit=10&currency=BOB&cursor=${cursor}`,
    ]) {
      const r = await call('GET', path);
      expectProblem(r, 400, 'INVALID_CURSOR');
      expect(r.body['data']).toBeUndefined();
    }
  });

  it('[TC-PLATFORM-API-017] la reserva "1500" BOB se devuelve como "1500.00"; un amount numérico ⇒ 400 sin persistir', async () => {
    const w = seedWorkspace(1);
    const ok = await call('PATCH', `/api/v1/workspaces/${w.id}`, {
      body: { minimumLiquidityReserve: { amount: '1500', currency: 'BOB' } },
      headers: { 'content-type': 'application/merge-patch+json', 'If-Match': '"1"' },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body['minimumLiquidityReserve']).toEqual({ amount: '1500.00', currency: 'BOB' });
    expect(ok.text).toContain('"amount":"1500.00"');
    expect(contract.validateResponse('updateWorkspace', 200, ok.body)).toEqual([]);
    const numeric = await call('PATCH', `/api/v1/workspaces/${w.id}`, {
      body: { minimumLiquidityReserve: { amount: 75.5, currency: 'BOB' } },
      headers: { 'content-type': 'application/merge-patch+json', 'If-Match': '"2"' },
    });
    expectProblem(numeric, 400, 'VALIDATION_FAILED');
    expect(numeric.body.errors?.[0]?.pointer).toBe('/minimumLiquidityReserve/amount');
    expect((await call('GET', `/api/v1/workspaces/${w.id}`)).body).toMatchObject({
      version: 2,
      minimumLiquidityReserve: { amount: '1500.00', currency: 'BOB' },
    });
    const ws = randomUUID();
    expectProblem(
      await postExpense(ws, `K-0017-${randomUUID()}`, expenseBody(75.5 as unknown as string)),
      400,
      'VALIDATION_FAILED',
    );
    expect(await countExpenses(ws)).toBe(0);
  });

  it('[TC-PLATFORM-API-018] 100.0000001 USDT y 685.005 BOB ⇒ 422 AMOUNT_SCALE_EXCEEDED sin persistir montos redondeados', async () => {
    const ws = randomUUID();
    for (const [amount, currency] of [
      ['100.0000001', 'USDT'],
      ['685.005', 'BOB'],
    ] as const) {
      const r = await postExpense(ws, `K-0018-${randomUUID()}`, expenseBody(amount, currency));
      expectProblem(r, 422, 'AMOUNT_SCALE_EXCEEDED');
      expect(r.body.errors?.[0]?.pointer).toBe('/amount/amount');
    }
    expect(await countExpenses(ws)).toBe(0);
    const usdt = await postExpense(ws, `K-0018-${randomUUID()}`, expenseBody('100.000000', 'USDT'));
    expect(usdt.status).toBe(201);
    expect(usdt.body['amount']).toEqual({ amount: '100.000000', currency: 'USDT' });
  });

  it('[TC-PLATFORM-API-019] fecha de negocio "2026-09-30" a las 23:30 de La Paz ⇒ createdAt 2026-10-01T03:30:00.000Z; fecha-hora ⇒ 400', async () => {
    const ws = randomUUID();
    const r = await postExpense(ws, `K-0019-${randomUUID()}`, expenseBody('75.00'));
    expect(r.status, r.text).toBe(201);
    expect(r.body['transactionDate']).toBe('2026-09-30');
    expect(r.body['createdAt']).toBe('2026-10-01T03:30:00.000Z');
    const withTime = await postExpense(ws, `K-0019-${randomUUID()}`, {
      ...expenseBody('75.00'),
      transactionDate: '2026-09-30T23:30:00-04:00',
    });
    expectProblem(withTime, 400, 'VALIDATION_FAILED');
    expect(withTime.body.errors?.[0]?.pointer).toBe('/transactionDate');
  });

  it('[TC-PLATFORM-API-020] 121 escrituras en menos de un minuto: 120 pasan con RateLimit y la 121 ⇒ 429 sin efecto', async () => {
    const ws = randomUUID();
    const user = randomUUID();
    clock.set(Instant.parse('2026-10-02T12:00:00Z'));
    for (let i = 0; i < 120; i += 1) {
      const r = await postExpense(
        ws,
        `K-0020-${String(i).padStart(4, '0')}-${user}`,
        expenseBody('1.00'),
        user,
      );
      expect(r.status, `escritura ${i + 1}: ${r.text}`).toBe(201);
      expect(r.headers.get('ratelimit-policy')).toBe('"writes";q=120;w=60');
      expect(r.headers.get('ratelimit')).toMatch(/^"writes";r=\d+;t=\d+$/);
    }
    const limited = await postExpense(ws, `K-0020-0121-${user}`, expenseBody('1.00'), user);
    expectProblem(limited, 429, 'RATE_LIMITED');
    expect(limited.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
    expect(await countExpenses(ws)).toBe(120);
    // Las lecturas tienen su propia cuota.
    expect((await call('GET', '/api/v1/me', { user })).headers.get('ratelimit-policy')).toBe(
      '"reads";q=600;w=60',
    );
  });

  it('las rutas fuera del contrato (probes) no se ven afectadas y un POST idempotente sin usuario ⇒ 401', async () => {
    expect((await fetch(`${baseUrl}/health/live`)).status).toBe(200);
    const res = await fetch(`${baseUrl}/api/v1/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': `K-0000-${randomUUID()}` },
      body: JSON.stringify({ name: 'Hogar', baseCurrency: 'BOB' }),
    });
    expect(res.status).toBe(401);
  });
});
