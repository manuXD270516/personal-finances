import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract, type ContractOperation } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import fc from 'fast-check';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Aislamiento entre workspaces por HTTP contra PostgreSQL real (openspec add-workspace-identity 7.2,
// TC-SECURITY-ISOLATION-001): un recurso de W2 pedido bajo la ruta de W1 es indistinguible de uno inexistente.
// Recorre TODAS las operaciones implementadas del contrato con un id de recurso en la ruta (no solo una muestra
// aleatoria) y las operaciones de colección que reciben ids en el cuerpo. El actor principal es OWNER de W1 y W2
// (la membresía en W1 pasa, así que solo el aislamiento por workspace impide el acceso); también un EDITOR solo de W1.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

interface Reply {
  status: number;
  headers: Headers;
  text: string;
  body: Record<string, unknown>;
  /** Ruta y cuerpo enviados (un id que el propio cliente envió puede volver en `instance`/`detail`). */
  sent: string;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const clock = new FixedClock(Instant.parse('2026-03-15T14:00:00Z'));
const contract = ApiContract.fromFile(resolveContractPath());

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
  options: { token?: string; body?: unknown; headers?: Record<string, string>; contentType?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Respuesta sin JSON.
  }
  return { status: res.status, headers: res.headers, text, body, sent: `${path} ${payload ?? ''}` };
}

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;

/** POST con Idempotency-Key bajo `/workspaces/{ws}`; exige 201. */
async function create(u: User, ws: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await call('POST', `/api/v1/workspaces/${ws}${path}`, {
    token: u.token,
    body,
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(r.status, `${path}: ${r.text}`).toBe(201);
  return r.body;
}

let owner: User;
let editor: User;
let w1: string;
let w2: string;
/** Recursos de W2 por nombre de parámetro de ruta (y su versión, para un `If-Match` que de otro modo sería válido). */
const w2Ids: Record<string, { id: string; version: number }> = {};
let w2Conversion: { id: string; version: number };
let w2Bank: string;
let w2Wallet: string;
let w2Cash: string;
let w1Bank: string;
let w1Category: string;
/** Marcadores de W2 que nunca deben aparecer en una respuesta bajo la ruta de W1. */
const w2Markers: string[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(baseEnv(deps, { RATE_LIMIT_READS_PER_MIN: '100000', RATE_LIMIT_WRITES_PER_MIN: '100000' })),
    capturingLogger('finance-api', 'api').logger,
    {
      clock,
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');

  owner = await user(`kc-iso-owner-${randomUUID()}`);
  editor = await user(`kc-iso-editor-${randomUUID()}`);
  w1 = owner.ws;
  const created = await call('POST', '/api/v1/workspaces', {
    token: owner.token,
    body: { name: 'W2 Other Demo', baseCurrency: 'BOB', seedDefaultCategories: false },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(created.status, created.text).toBe(201);
  w2 = created.body['id'] as string;
  // editor: EDITOR solo de W1 (Minimal Seed).
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: w1 },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'EDITOR', 'ACTIVE')`,
          [w1, editor.id],
        ),
      true,
    );
  } finally {
    await app.end();
  }

  const opening = (amount: string, currency: string) => ({
    amount: { amount, currency },
    date: '2026-03-01',
  });
  // W1: una cuenta propia para los cuerpos que mezclan referencias de W1 y de W2.
  w1Bank = (await create(owner, w1, '/accounts', { name: 'W1 Bank', type: 'BANK', currency: 'BOB' }))[
    'id'
  ] as string;

  const w1Group = await create(owner, w1, '/category-groups', { name: 'Grupo W1', kind: 'EXPENSE' });
  w1Category = (await create(owner, w1, '/categories', { groupId: w1Group['id'], name: 'Categoría W1' }))[
    'id'
  ] as string;

  // W2: un recurso de cada tipo direccionable por id.
  const inst = await create(owner, w2, '/institutions', { name: 'Banco W2 Secreto', kind: 'BANK' });
  const bank = await create(owner, w2, '/accounts', {
    name: 'W2 Bank',
    type: 'BANK',
    currency: 'BOB',
    institutionId: inst['id'],
    openingBalance: opening('5000.00', 'BOB'),
  });
  w2Bank = bank['id'] as string;
  const cash = await create(owner, w2, '/accounts', {
    name: 'W2 Cash',
    type: 'CASH',
    currency: 'BOB',
    openingBalance: opening('300.00', 'BOB'),
  });
  w2Cash = cash['id'] as string;
  w2Wallet = (
    await create(owner, w2, '/accounts', {
      name: 'W2 Wallet USDT',
      type: 'CRYPTO_WALLET',
      currency: 'USDT',
      openingBalance: opening('200.000000', 'USDT'),
    })
  )['id'] as string;
  const group = await create(owner, w2, '/category-groups', { name: 'Grupo W2', kind: 'EXPENSE' });
  const category = await create(owner, w2, '/categories', { groupId: group['id'], name: 'Categoría W2' });
  const tag = await create(owner, w2, '/tags', { name: 'tag-w2-secreto' });
  const counterparty = await create(owner, w2, '/counterparties', { name: 'Proveedor W2 Secreto' });
  const rate = await create(owner, w2, '/fx-rates', {
    base: 'USDT',
    quote: 'BOB',
    value: '6.95',
    rateType: 'P2P',
    asOf: '2026-03-10T19:00:00Z',
  });
  const expense = await create(owner, w2, '/transactions', {
    kind: 'EXPENSE',
    status: 'POSTED',
    transactionDate: '2026-03-10',
    accountId: cash['id'],
    amount: { amount: '75.00', currency: 'BOB' },
    description: 'Gasto W2 Secreto',
    counterpartyId: counterparty['id'],
    splits: [
      { amount: { amount: '75.00', currency: 'BOB' }, categoryId: category['id'], tagIds: [tag['id']] },
    ],
  });
  const conversion = await create(owner, w2, '/conversions', {
    transactionDate: '2026-03-10',
    sourceAccountId: w2Wallet,
    targetAccountId: cash['id'],
    sourceAmount: { amount: '10.000000', currency: 'USDT' },
    targetAmount: { amount: '69.50', currency: 'BOB' },
    executedAt: '2026-03-10T18:00:00Z',
  });
  const v = (r: Record<string, unknown>) => ({ id: r['id'] as string, version: r['version'] as number });
  Object.assign(w2Ids, {
    accountId: v(bank),
    institutionId: v(inst),
    categoryGroupId: v(group),
    categoryId: v(category),
    tagId: v(tag),
    counterpartyId: v(counterparty),
    fxRateId: v(rate),
    transactionId: v(expense),
  });
  w2Conversion = v(conversion);
  w2Markers.push(
    w2,
    ...Object.values(w2Ids).map((r) => r.id),
    w2Conversion.id,
    w2Wallet,
    cash['id'] as string,
    'W2 Bank',
    'Banco W2 Secreto',
    'Proveedor W2 Secreto',
    'Gasto W2 Secreto',
    'tag-w2-secreto',
    '5000.00',
  );
});

afterAll(async () => {
  await runtime?.close();
});

/** Cuerpos mínimos válidos por operación: la petición llega hasta la búsqueda del recurso. */
function bodyFor(op: ContractOperation): unknown {
  const conversion = {
    transactionDate: '2026-03-11',
    sourceAccountId: w2Wallet,
    targetAccountId: w2Cash,
    sourceAmount: { amount: '10.000000', currency: 'USDT' },
    targetAmount: { amount: '70.00', currency: 'BOB' },
    executedAt: '2026-03-11T18:00:00Z',
  };
  const bodies: Record<string, unknown> = {
    updateAccount: { name: 'Hackeada' },
    closeAccount: { closedOn: '2026-03-15' },
    updateInstitution: { name: 'Hackeada' },
    updateTransaction: { description: 'Hackeada' },
    voidTransaction: { reason: 'intento cruzado' },
    unreconcileTransaction: { reason: 'intento cruzado' },
    amendConversion: conversion,
    updateCategoryGroup: { name: 'Hackeado' },
    updateCategory: { name: 'Hackeada' },
    updateTag: { name: 'hackeado' },
    updateCounterparty: { name: 'Hackeado' },
    supersedeFxRate: { value: '7.10', reason: 'intento cruzado' },
    reviewFxRateAnomaly: { decision: 'CONFIRM', reason: 'intento cruzado' },
  };
  return bodies[op.operationId];
}

const QUERY: Record<string, string> = { getCounterpartyCategorySuggestion: '?kind=EXPENSE' };

/** Ruta de la operación bajo W1 con el id dado en cada parámetro de recurso (`null` ⇒ el id de W2). */
function pathFor(op: ContractOperation, ws: string, forced?: string): string {
  return (
    op.path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
      if (name === 'workspaceId') return ws;
      if (forced) return forced;
      if (name === 'transactionId' && op.path.startsWith('/workspaces/{workspaceId}/conversions/'))
        return w2Conversion.id;
      return w2Ids[name]!.id;
    }) + (QUERY[op.operationId] ?? '')
  );
}

function versionFor(op: ContractOperation): number {
  const param =
    /\{(accountId|institutionId|transactionId|categoryGroupId|categoryId|tagId|counterpartyId|fxRateId)\}/.exec(
      op.path,
    )![1]!;
  if (param === 'transactionId' && op.path.includes('/conversions/')) return w2Conversion.version;
  return w2Ids[param]!.version;
}

async function invoke(op: ContractOperation, u: User, path: string): Promise<Reply> {
  const method = op.method.toUpperCase();
  const body = bodyFor(op);
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    headers['idempotency-key'] = randomUUID();
    headers['if-match'] = `"${versionFor(op)}"`;
  }
  return call(method, `/api/v1${path}`, {
    token: u.token,
    ...(body !== undefined ? { body } : {}),
    headers,
    ...(method === 'PATCH' ? { contentType: 'application/merge-patch+json' } : {}),
  });
}

/** Datos de W2 en la respuesta que el cliente no envió (nombres, saldo, id de W2 u otros ids de sus recursos). */
const leaks = (r: Reply): string[] => w2Markers.filter((m) => r.text.includes(m) && !r.sent.includes(m));

/** Operaciones con un id de recurso de workspace en la ruta (todas menos `{aggregateType}` y `{operationId}`). */
const RESOURCE_PARAMS =
  /\{(accountId|institutionId|transactionId|categoryGroupId|categoryId|tagId|counterpartyId|fxRateId)\}/;
const byId = contract
  .operations()
  .filter((op) => op.path.startsWith('/workspaces/{workspaceId}/') && RESOURCE_PARAMS.test(op.path))
  .sort((a, b) => a.operationId.localeCompare(b.operationId));

/** Estado observable de los recursos de W2 (para verificar que ningún intento cruzado los modificó). */
async function w2Snapshot(): Promise<string> {
  const read = async (path: string) => {
    const r = await call('GET', `/api/v1/workspaces/${w2}${path}`, { token: owner.token });
    expect(r.status, `${path}: ${r.text}`).toBe(200);
    return r.body;
  };
  const parts = [
    await read(`/accounts/${w2Ids['accountId']!.id}`),
    await read(`/institutions/${w2Ids['institutionId']!.id}`),
    await read(`/category-groups/${w2Ids['categoryGroupId']!.id}`),
    await read(`/categories/${w2Ids['categoryId']!.id}`),
    await read(`/tags/${w2Ids['tagId']!.id}`),
    await read(`/counterparties/${w2Ids['counterpartyId']!.id}`),
    await read(`/fx-rates/${w2Ids['fxRateId']!.id}`),
    await read(`/transactions/${w2Ids['transactionId']!.id}`),
    await read(`/conversions/${w2Conversion.id}`),
    await read('/accounts?limit=200'),
    await read('/transactions?limit=200'),
  ];
  return JSON.stringify(parts);
}

describe('[TC-SECURITY-ISOLATION-001] un recurso de otro workspace es indistinguible de uno inexistente', () => {
  it('ruta: OWNER de W1 y W2 pide W2 Bank bajo W1 ⇒ 404 RESOURCE_NOT_FOUND sin nombre ni saldo', async () => {
    const r = await call('GET', `/api/v1/workspaces/${w1}/accounts/${w2Bank}`, { token: owner.token });
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('application/problem+json');
    expect(r.body['code']).toBe('RESOURCE_NOT_FOUND');
    expect(leaks(r)).toEqual([]);
    // Bajo su propio workspace sí existe (el id es real).
    const own = await call('GET', `/api/v1/workspaces/${w2}/accounts/${w2Bank}`, { token: owner.token });
    expect(own.body).toMatchObject({ name: 'W2 Bank', balance: { amount: '5000.00', currency: 'BOB' } });
  });

  it('cuerpo: EDITOR de W1 registra un gasto contra W2 Bank ⇒ 422 REFERENCE_NOT_FOUND y no se registra nada', async () => {
    const before = await w2Snapshot();
    const r = await call('POST', `/api/v1/workspaces/${w1}/transactions`, {
      token: editor.token,
      body: {
        kind: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-03-12',
        accountId: w2Bank,
        amount: { amount: '75.00', currency: 'BOB' },
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(r.status, r.text).toBe(422);
    expect(r.body['code']).toBe('REFERENCE_NOT_FOUND');
    expect(leaks(r)).toEqual([]);
    const listed = await call('GET', `/api/v1/workspaces/${w1}/transactions?limit=200`, {
      token: owner.token,
    });
    expect(listed.body['data']).toEqual([]);
    expect(await w2Snapshot()).toBe(before);
  });

  it('toda operación implementada con id de recurso en la ruta: misma respuesta que un id inexistente, sin datos de W2', async () => {
    expect(byId.length).toBeGreaterThan(30);
    const before = await w2Snapshot();
    const mismatches: string[] = [];
    let exercised = 0;
    for (const actor of [owner, editor]) {
      for (const op of byId) {
        const missing = await invoke(op, actor, pathFor(op, w1, randomUUID()));
        // Operación del contrato todavía sin ruta (404 sin código de problema): queda fuera hasta que se implemente.
        if (missing.status === 404 && missing.body['code'] === undefined) continue;
        if (actor === owner) exercised += 1;
        const foreign = await invoke(op, actor, pathFor(op, w1));
        const who = actor === owner ? 'owner' : 'editor';
        const leaked = leaks(foreign);
        if (leaked.length > 0) mismatches.push(`${who} ${op.operationId}: filtra ${leaked.join(', ')}`);
        if (foreign.status >= 200 && foreign.status < 300)
          mismatches.push(`${who} ${op.operationId}: ${foreign.status} sobre un recurso de W2`);
        if (foreign.status !== missing.status || foreign.body['code'] !== missing.body['code'])
          mismatches.push(
            `${who} ${op.operationId}: W2 ⇒ ${foreign.status} ${String(foreign.body['code'])}, inexistente ⇒ ${missing.status} ${String(missing.body['code'])}`,
          );
        if (op.method.toUpperCase() === 'GET' && foreign.body['code'] !== 'RESOURCE_NOT_FOUND')
          mismatches.push(
            `${who} ${op.operationId}: lectura ⇒ ${foreign.status} ${String(foreign.body['code'])}`,
          );
      }
    }
    expect(mismatches).toEqual([]);
    expect(exercised).toBeGreaterThan(30);
    expect(await w2Snapshot()).toBe(before);
  });

  it('propiedad: operación aleatoria × actor × id ajeno de W2 (de cualquier tipo) ⇒ nunca 2xx ni datos de W2', async () => {
    // Operaciones con ruta implementada (un id inexistente responde con código de problema).
    const implemented: ContractOperation[] = [];
    for (const op of byId) {
      const probe = await invoke(op, owner, pathFor(op, w1, randomUUID()));
      if (!(probe.status === 404 && probe.body['code'] === undefined)) implemented.push(op);
    }
    expect(implemented.length).toBeGreaterThan(30);
    const foreignIds = [...Object.values(w2Ids).map((r) => r.id), w2Conversion.id, w2Wallet, w2Cash, w2];
    const before = await w2Snapshot();
    // 60 corridas por PR (semilla fija); `NIGHTLY=1` → 600 con semilla aleatoria (fast-check la imprime al fallar).
    const nightly = Boolean(process.env['NIGHTLY']);
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...implemented),
        fc.constantFrom(owner, editor),
        fc.constantFrom(...foreignIds),
        async (op, actor, foreignId) => {
          const r = await invoke(op, actor, pathFor(op, w1, foreignId));
          const ctx = `${op.operationId} ${actor === owner ? 'owner' : 'editor'} ${foreignId}`;
          expect(r.status >= 200 && r.status < 300, `${ctx}: ${r.status}`).toBe(false);
          expect(leaks(r), ctx).toEqual([]);
        },
      ),
      { numRuns: nightly ? 600 : 60, ...(nightly ? {} : { seed: 20261005 }) },
    );
    expect(await w2Snapshot()).toBe(before);
  }, 300_000);

  it('toda operación de colección que recibe ids en el cuerpo rechaza los de W2 igual que uno inexistente', async () => {
    const before = await w2Snapshot();
    const W1 = `/api/v1/workspaces/${w1}`;
    type Case = [name: string, method: string, path: string, body: (id: string) => unknown];
    const money = (amount: string) => ({ amount, currency: 'BOB' });
    const cases: Case[] = [
      [
        'createTransaction.accountId',
        'POST',
        '/transactions',
        (id) => ({ kind: 'EXPENSE', transactionDate: '2026-03-12', accountId: id, amount: money('75.00') }),
      ],
      [
        'createTransaction.categoryId',
        'POST',
        '/transactions',
        (id) => ({
          kind: 'EXPENSE',
          transactionDate: '2026-03-12',
          accountId: w1Bank,
          amount: money('75.00'),
          splits: [{ amount: money('75.00'), categoryId: id }],
        }),
      ],
      [
        'createTransaction.counterpartyId',
        'POST',
        '/transactions',
        (id) => ({
          kind: 'EXPENSE',
          transactionDate: '2026-03-12',
          accountId: w1Bank,
          amount: money('75.00'),
          counterpartyId: id,
        }),
      ],
      [
        'createTransaction.tagIds',
        'POST',
        '/transactions',
        (id) => ({
          kind: 'EXPENSE',
          transactionDate: '2026-03-12',
          accountId: w1Bank,
          amount: money('75.00'),
          splits: [{ amount: money('75.00'), categoryId: w1Category, tagIds: [id] }],
        }),
      ],
      [
        'createTransfer.toAccountId',
        'POST',
        '/transfers',
        (id) => ({
          transactionDate: '2026-03-12',
          fromAccountId: w1Bank,
          toAccountId: id,
          amount: money('10.00'),
        }),
      ],
      [
        'createConversion.sourceAccountId',
        'POST',
        '/conversions',
        (id) => ({
          transactionDate: '2026-03-12',
          sourceAccountId: id,
          targetAccountId: w1Bank,
          sourceAmount: { amount: '10.000000', currency: 'USDT' },
          targetAmount: money('69.50'),
          executedAt: '2026-03-12T18:00:00Z',
        }),
      ],
      [
        'createAccount.institutionId',
        'POST',
        '/accounts',
        (id) => ({ name: `Bank ${randomUUID()}`, type: 'BANK', currency: 'BOB', institutionId: id }),
      ],
      [
        'createCategory.groupId',
        'POST',
        '/categories',
        (id) => ({ groupId: id, name: `Cat ${randomUUID()}` }),
      ],
      ['reorderAccounts.accountIds', 'PUT', '/accounts/order', (id) => ({ accountIds: [w1Bank, id] })],
      [
        'markTransactionsCleared.items',
        'POST',
        '/transactions/mark-cleared',
        (id) => ({ items: [{ transactionId: id, version: 1 }], cleared: true }),
      ],
      [
        'checkTransactionDuplicates.accountId',
        'POST',
        '/transactions/duplicate-check',
        (id) => ({ accountId: id, amount: money('75.00'), transactionDate: '2026-03-10' }),
      ],
    ];
    const w2Of: Record<string, string> = {
      'createTransaction.accountId': w2Bank,
      'createTransaction.categoryId': w2Ids['categoryId']!.id,
      'createTransaction.counterpartyId': w2Ids['counterpartyId']!.id,
      'createTransaction.tagIds': w2Ids['tagId']!.id,
      'createTransfer.toAccountId': w2Bank,
      'createConversion.sourceAccountId': w2Wallet,
      'createAccount.institutionId': w2Ids['institutionId']!.id,
      'createCategory.groupId': w2Ids['categoryGroupId']!.id,
      'reorderAccounts.accountIds': w2Bank,
      'markTransactionsCleared.items': w2Ids['transactionId']!.id,
      'checkTransactionDuplicates.accountId': w2Bank,
    };
    const mismatches: string[] = [];
    for (const [name, method, path, body] of cases) {
      const send = (id: string) =>
        call(method, `${W1}${path}`, {
          token: editor.token,
          body: body(id),
          headers: { 'idempotency-key': randomUUID() },
        });
      const missing = await send(randomUUID());
      const foreign = await send(w2Of[name]!);
      const leaked = leaks(foreign);
      if (leaked.length > 0) mismatches.push(`${name}: filtra ${leaked.join(', ')}`);
      if (foreign.status !== missing.status || foreign.body['code'] !== missing.body['code'])
        mismatches.push(
          `${name}: W2 ⇒ ${foreign.status} ${String(foreign.body['code'])}, inexistente ⇒ ${missing.status} ${String(missing.body['code'])}`,
        );
      if (foreign.status >= 200 && foreign.status < 300 && name !== 'checkTransactionDuplicates.accountId')
        mismatches.push(`${name}: ${foreign.status} con una referencia de W2`);
    }
    expect(mismatches).toEqual([]);
    // Nada se registró en W1 con referencias de W2, y W2 sigue igual.
    const txs = await call('GET', `${W1}/transactions?limit=200`, { token: owner.token });
    expect(txs.body['data']).toEqual([]);
    expect(await w2Snapshot()).toBe(before);
  });
});
