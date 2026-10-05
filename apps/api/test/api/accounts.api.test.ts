import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx, sqlState } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

/** Recorta un NUMERIC (string decimal) a la escala de la moneda sin pasar por `number` (INV-001). */
const atScale = (value: string, scale: number): string => {
  const [integer = '0', fraction = ''] = value.split('.');
  return scale === 0 ? integer : `${integer}.${fraction.padEnd(scale, '0').slice(0, scale)}`;
};

// ACCOUNTS por HTTP contra PostgreSQL real (Testcontainers postgres:18): contrato, roles, ETag/If-Match,
// idempotencia, auditoría y outbox en la misma transacción, y la apertura con saldo inicial atómica con el ledger
// (openspec add-accounts-management, tareas 2.5, 5.4, 6.1–6.3).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const clock = new FixedClock(Instant.parse('2026-03-15T14:00:00Z'));
let cachedContract: ApiContract | undefined;
const contract = () => (cachedContract ??= ApiContract.fromFile(resolveContractPath()));

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
  return {
    status: res.status,
    headers: res.headers,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

const expectProblem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.headers.get('content-type')).toContain('application/problem+json');
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

const accountsPath = (u: User) => `/api/v1/workspaces/${u.ws}/accounts`;
const create = (u: User, body: Record<string, unknown>, key = randomUUID()) =>
  call('POST', accountsPath(u), { token: u.token, body, headers: { 'idempotency-key': key } });
const command = (u: User, id: string, verb: string, version: number, body?: unknown) =>
  call('POST', `${accountsPath(u)}/${id}/${verb}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: { 'if-match': `"${version}"` },
  });
const patch = (u: User, id: string, version: number, body: unknown) =>
  call('PATCH', `${accountsPath(u)}/${id}`, {
    token: u.token,
    body,
    contentType: 'application/merge-patch+json',
    headers: { 'if-match': `"${version}"` },
  });

/** Consulta como `pf_app` con el contexto RLS del workspace (rollback). */
async function asApp<T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
}

async function outbox(u: User, aggregateId: string) {
  const worker = await connect(deps.workerDatabaseUrl);
  try {
    const { rows } = await worker.query<{ event_type: string; aggregate_version: number; envelope: unknown }>(
      'SELECT event_type, aggregate_version, envelope FROM platform.outbox WHERE workspace_id = $1 AND aggregate_id = $2 ORDER BY sequence',
      [u.ws, aggregateId],
    );
    return rows;
  } finally {
    await worker.end();
  }
}

const audits = (u: User, aggregateId: string) =>
  asApp(
    u,
    async (c) =>
      (
        await c.query<{
          action: string;
          changes: { field: string; before: unknown; after: unknown }[];
          reason: string | null;
        }>(
          'SELECT action, changes, reason FROM audit.audit_log WHERE aggregate_id = $1 ORDER BY occurred_at, id',
          [aggregateId],
        )
      ).rows,
  );

/** Postings del ledger de una cuenta del usuario (Σ = saldo). */
const postingsOf = (u: User, accountId: string) =>
  asApp(
    u,
    async (c) =>
      (
        await c.query<{ amount: string; entry_type: string; entry_date: string; code: string }>(
          `SELECT p.amount::text AS amount, e.entry_type, e.entry_date::text AS entry_date, la.code
           FROM ledger.posting p
           JOIN ledger.journal_entry e ON e.id = p.journal_entry_id
           JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
          WHERE e.source_id = $1 ORDER BY p.line_no`,
          [accountId],
        )
      ).rows,
  );

let editor: User;
let viewer: User;
let other: User;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), capturingLogger('finance-api', 'api').logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  editor = await user(`kc-acc-editor-${randomUUID()}`);
  other = await user(`kc-acc-other-${randomUUID()}`);
  const v = await user(`kc-acc-viewer-${randomUUID()}`);
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: editor.id, workspaceId: editor.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'VIEWER', 'ACTIVE')`,
          [editor.ws, v.id],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  viewer = { ...v, ws: editor.ws };
});

afterAll(async () => {
  await runtime?.close();
});

describe('instituciones', () => {
  it('[TC-ACCOUNTS-INSTITUTION-001] crear institución: país ISO opcional, auditoría y rol EDITOR', async () => {
    const path = `/api/v1/workspaces/${editor.ws}/institutions`;
    const created = await call('POST', path, {
      token: editor.token,
      body: {
        name: 'P2P Exchange Demo',
        kind: 'EXCHANGE',
        countryCode: 'BO',
        website: 'https://p2p.demo.pfos.test',
      },
    });
    expect(created.status).toBe(201);
    expect(created.headers.get('etag')).toBe('"1"');
    expect(contract().validateResponse('createInstitution', 201, created.body)).toEqual([]);
    expect((await audits(editor, created.body['id'] as string)).map((a) => a.action)).toEqual([
      'accounts.institution.created',
    ]);
    expectProblem(
      await call('POST', path, {
        token: editor.token,
        body: { name: 'Banco X', kind: 'BANK', countryCode: 'Bolivia' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    const fintech = await call('POST', path, {
      token: editor.token,
      body: { name: 'Fintech Y', kind: 'FINTECH' },
    });
    expect(fintech.body['countryCode']).toBeNull();
    expectProblem(
      await call('POST', path, { token: viewer.token, body: { name: 'Nope', kind: 'BANK' } }),
      403,
      'INSUFFICIENT_ROLE',
    );
    expectProblem(
      await call('POST', path, { token: editor.token, body: { name: 'fintech y', kind: 'FINTECH' } }),
      409,
      'NAME_TAKEN',
    );
  });

  it('[TC-ACCOUNTS-INSTITUTION-003] [TC-ACCOUNTS-INSTITUTION-004] editar y archivar no toca las cuentas; archivada no asignable', async () => {
    const path = `/api/v1/workspaces/${editor.ws}/institutions`;
    const andino = await call('POST', path, {
      token: editor.token,
      body: { name: 'Banco Andino Demo', kind: 'BANK', website: 'https://andino.demo.pfos.test' },
    });
    const id = andino.body['id'] as string;
    const bankA = await create(editor, {
      name: 'Bank A Inst',
      type: 'BANK',
      currency: 'BOB',
      institutionId: id,
      openingBalance: { amount: { amount: '1000.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    expect(bankA.status).toBe(201);
    const upd = await call('PATCH', `${path}/${id}`, {
      token: editor.token,
      body: { website: 'https://nuevo.andino.demo.pfos.test' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': '"1"' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body['version']).toBe(2);
    const audit = (await audits(editor, id)).at(-1)!;
    expect(audit.changes).toEqual([
      {
        field: 'website',
        before: 'https://andino.demo.pfos.test',
        after: 'https://nuevo.andino.demo.pfos.test',
      },
    ]);
    const archived = await call('POST', `${path}/${id}/archive`, {
      token: editor.token,
      headers: { 'if-match': '"2"' },
    });
    expect(archived.status).toBe(200);
    const listed = await call('GET', path, { token: editor.token });
    expect((listed.body['data'] as { id: string }[]).map((i) => i.id)).not.toContain(id);
    const all = await call('GET', `${path}?includeArchived=true`, { token: editor.token });
    expect((all.body['data'] as { id: string }[]).map((i) => i.id)).toContain(id);
    const account = await call('GET', `${accountsPath(editor)}/${bankA.body['id'] as string}`, {
      token: editor.token,
    });
    expect(account.body).toMatchObject({
      institutionId: id,
      balance: { amount: '1000.00', currency: 'BOB' },
    });
    expectProblem(
      await create(editor, { name: 'Bank H', type: 'BANK', currency: 'BOB', institutionId: id }),
      409,
      'INSTITUTION_ARCHIVED',
    );
    expect((await call('DELETE', `${path}/${id}`, { token: editor.token })).status).toBeGreaterThanOrEqual(
      400,
    );
    expect(
      await asApp(editor, (c) => c.query('DELETE FROM accounts.institution WHERE id = $1', [id]))
        .then(() => 'ok')
        .catch((e: { code?: string }) => e.code),
    ).toBe('42501');
  });
});

describe('apertura con saldo inicial', () => {
  it('[TC-ACCOUNTS-OPENING-001] [TC-ACCOUNTS-LEDGERLINK-001] asientos OPENING contra EQUITY:OPENING_BALANCE:<CCY>', async () => {
    const opening = (amount: string, currency = 'BOB') => ({
      amount: { amount, currency },
      date: '2026-01-01',
    });
    const bank = await create(editor, {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: opening('10000.00'),
    });
    const visa = await create(editor, {
      name: 'Visa BOB',
      type: 'CREDIT_CARD',
      currency: 'BOB',
      openingBalance: opening('2000.00'),
    });
    const usdt = await create(editor, {
      name: 'USDT Wallet',
      type: 'CRYPTO_WALLET',
      currency: 'USDT',
      openingBalance: opening('100.000000', 'USDT'),
    });
    const empty = await create(editor, {
      name: 'Bank B Zero',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: opening('0.00'),
    });
    for (const r of [bank, visa, usdt, empty]) {
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(contract().validateResponse('createAccount', 201, r.body)).toEqual([]);
    }
    expect(bank.body).toMatchObject({
      classification: 'ASSET',
      liquidity: 'LIQUID',
      status: 'ACTIVE',
      balance: { amount: '10000.00', currency: 'BOB' },
    });
    expect(visa.body).toMatchObject({
      classification: 'LIABILITY',
      liquidity: 'ILLIQUID',
      balance: { amount: '2000.00', currency: 'BOB' },
    });
    expect(usdt.body['balance']).toEqual({ amount: '100.000000', currency: 'USDT' });
    expect(empty.body['balance']).toEqual({ amount: '0.00', currency: 'BOB' });

    const bankPostings = await postingsOf(editor, bank.body['id'] as string);
    expect(
      bankPostings.map((p) => [
        p.entry_type,
        p.entry_date,
        atScale(p.amount, 2),
        p.code.startsWith('EQUITY'),
      ]),
    ).toEqual([
      ['OPENING', '2026-01-01', '10000.00', false],
      ['OPENING', '2026-01-01', '-10000.00', true],
    ]);
    expect(bankPostings[1]!.code).toContain('OPENING_BALANCE');
    const visaPostings = await postingsOf(editor, visa.body['id'] as string);
    expect(visaPostings.map((p) => atScale(p.amount, 2))).toEqual(['-2000.00', '2000.00']);
    const usdtPostings = await postingsOf(editor, usdt.body['id'] as string);
    expect(usdtPostings.map((p) => atScale(p.amount, 6))).toEqual(['100.000000', '-100.000000']);
    expect(await postingsOf(editor, empty.body['id'] as string)).toEqual([]);

    // Un único ledger account por cuenta, con su naturaleza y moneda (sin ledger account si no hubo posting).
    const links = await asApp(
      editor,
      async (c) =>
        (
          await c.query<{ source_account_id: string; type: string; currency: string }>(
            'SELECT source_account_id, type, currency FROM ledger.ledger_account WHERE source_account_id = ANY($1::uuid[])',
            [[bank.body['id'], visa.body['id'], usdt.body['id'], empty.body['id']]],
          )
        ).rows,
    );
    expect(links).toHaveLength(3);
    expect(links.find((l) => l.source_account_id === visa.body['id'])).toMatchObject({
      type: 'LIABILITY',
      currency: 'BOB',
    });
    expect(links.find((l) => l.source_account_id === usdt.body['id'])).toMatchObject({
      type: 'ASSET',
      currency: 'USDT',
    });

    const events = await outbox(editor, bank.body['id'] as string);
    expect(events.map((e) => e.event_type)).toEqual(['accounts.AccountOpened']);
    expect(eventSchemaRegistry().validate(events[0]!.envelope as never)).toBeUndefined();
  });

  it('[TC-ACCOUNTS-OPENING-002] si el saldo inicial no puede contabilizarse, la cuenta no se crea', async () => {
    const r = await create(editor, {
      name: 'Bank E',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: { amount: '10.005', currency: 'BOB' }, date: '2026-01-01' },
    });
    expectProblem(r, 422, 'AMOUNT_SCALE_EXCEEDED');
    const left = await asApp(editor, async (c) => ({
      accounts: (await c.query(`SELECT id FROM accounts.account WHERE name = 'Bank E'`)).rowCount,
      audit: (
        await c.query(
          `SELECT 1 FROM audit.audit_log WHERE action = 'accounts.account.opened' AND changes::text LIKE '%Bank E%'`,
        )
      ).rowCount,
    }));
    expect(left).toEqual({ accounts: 0, audit: 0 });
    // Período bloqueado: el ledger rechaza el asiento ⇒ rollback de la cuenta ya insertada.
    const app = await connect(deps.databaseUrl);
    try {
      await inTx(
        app,
        { userId: editor.id, workspaceId: editor.ws },
        () =>
          app.query(`INSERT INTO ledger.period_lock (workspace_id, year_month) VALUES ($1, '2025-12')`, [
            editor.ws,
          ]),
        true,
      );
    } finally {
      await app.end();
    }
    expectProblem(
      await create(editor, {
        name: 'Bank E',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: { amount: '10.00', currency: 'BOB' }, date: '2025-12-31' },
      }),
      409,
      'PERIOD_CLOSED',
    );
    expect(
      await asApp(
        editor,
        async (c) => (await c.query(`SELECT id FROM accounts.account WHERE name = 'Bank E'`)).rowCount,
      ),
    ).toBe(0);
    const ok = await create(editor, { name: 'Bank E', type: 'BANK', currency: 'BOB' });
    expect(ok.status).toBe(201);
  });

  it('[TC-ACCOUNTS-OPENING-003] reintento con la misma Idempotency-Key: una cuenta y un asiento', async () => {
    const key = randomUUID();
    const body = {
      name: 'Bank F',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: { amount: '500.00', currency: 'BOB' }, date: '2026-01-01' },
    };
    const first = await create(editor, body, key);
    const second = await create(editor, body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body['id']).toBe(first.body['id']);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expectProblem(await create(editor, { ...body, name: 'Bank F2' }, key), 422, 'IDEMPOTENCY_KEY_REUSED');
    expect(await postingsOf(editor, first.body['id'] as string)).toHaveLength(2);
    expect(
      await asApp(
        editor,
        async (c) => (await c.query(`SELECT id FROM accounts.account WHERE name = 'Bank F'`)).rowCount,
      ),
    ).toBe(1);
  });
});

describe('comandos de cuenta', () => {
  it('[TC-ACCOUNTS-NAME-001] nombre único (sin distinguir mayúsculas) entre no archivadas, por workspace', async () => {
    expect((await create(editor, { name: 'Bank A', type: 'BANK', currency: 'BOB' })).status).toBe(201);
    expectProblem(
      await create(editor, { name: 'bank a', type: 'BANK', currency: 'BOB' }),
      409,
      'ACCOUNT_NAME_TAKEN',
    );
    const old = await create(editor, { name: 'Old Bank N', type: 'BANK', currency: 'BOB' });
    await command(editor, old.body['id'] as string, 'archive', 1);
    expect((await create(editor, { name: 'Old Bank N', type: 'BANK', currency: 'BOB' })).status).toBe(201);
    expect((await create(other, { name: 'Bank A', type: 'BANK', currency: 'BOB' })).status).toBe(201);
  });

  it('[TC-ACCOUNTS-INSTLINK-001] institución de otro workspace ⇒ REFERENCE_NOT_FOUND', async () => {
    const w2 = await call('POST', `/api/v1/workspaces/${other.ws}/institutions`, {
      token: other.token,
      body: { name: 'Banco W2', kind: 'BANK' },
    });
    expectProblem(
      await create(editor, { name: 'Bank G', type: 'BANK', currency: 'BOB', institutionId: w2.body['id'] }),
      422,
      'REFERENCE_NOT_FOUND',
    );
    const cash = await create(editor, { name: 'Cash Link', type: 'CASH', currency: 'BOB' });
    expect(cash.body['institutionId']).toBeNull();
  });

  it('[TC-ACCOUNTS-ARCHIVE-001] [TC-ACCOUNTS-ARCHIVE-003] archivar oculta, reactivar vuelve a ACTIVE; nombre ocupado lo impide', async () => {
    const b = await create(editor, { name: 'Bank B Arch', type: 'SAVINGS', currency: 'BOB' });
    const id = b.body['id'] as string;
    const archived = await command(editor, id, 'archive', 1, { reason: 'Cuenta cerrada en el banco' });
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({
      status: 'ARCHIVED',
      version: 2,
      balance: { amount: '0.00', currency: 'BOB' },
    });
    expect(archived.body['archivedAt']).toBeTruthy();
    const listed = await call('GET', accountsPath(editor), { token: editor.token });
    expect(contract().validateResponse('listAccounts', 200, listed.body)).toEqual([]);
    expect((listed.body['data'] as { id: string }[]).map((a) => a.id)).not.toContain(id);
    const all = await call('GET', `${accountsPath(editor)}?includeArchived=true&limit=200`, {
      token: editor.token,
    });
    expect((all.body['data'] as { id: string }[]).map((a) => a.id)).toContain(id);
    expectProblem(await command(editor, id, 'archive', 2), 409, 'INVALID_STATUS_TRANSITION');

    const back = await command(editor, id, 'reactivate', 2);
    expect(back.body).toMatchObject({ status: 'ACTIVE', version: 3 });
    const events = await outbox(editor, id);
    expect(events.map((e) => e.event_type)).toEqual([
      'accounts.AccountOpened',
      'accounts.AccountArchived',
      'accounts.AccountReactivated',
    ]);
    for (const e of events) expect(eventSchemaRegistry().validate(e.envelope as never)).toBeUndefined();
    expect((await audits(editor, id)).map((a) => [a.action, a.reason])).toEqual([
      ['accounts.account.opened', null],
      ['accounts.account.archived', 'Cuenta cerrada en el banco'],
      ['accounts.account.reactivated', null],
    ]);

    const card = await create(editor, { name: 'Old Card', type: 'CREDIT_CARD', currency: 'BOB' });
    await command(editor, card.body['id'] as string, 'archive', 1);
    await create(editor, { name: 'Old Card', type: 'CREDIT_CARD', currency: 'BOB' });
    expectProblem(
      await command(editor, card.body['id'] as string, 'reactivate', 2),
      409,
      'ACCOUNT_NAME_TAKEN',
    );
  });

  it('[TC-ACCOUNTS-CLOSE-001] cerrar exige saldo cero', async () => {
    const zero = await create(editor, { name: 'Bank B Close', type: 'BANK', currency: 'BOB' });
    const closed = await command(editor, zero.body['id'] as string, 'close', 1, { closedOn: '2026-03-31' });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', closedOn: '2026-03-31' });
    const closedEvent = (await outbox(editor, zero.body['id'] as string)).at(-1)!;
    expect(closedEvent.event_type).toBe('accounts.AccountClosed');
    expect(eventSchemaRegistry().validate(closedEvent.envelope as never)).toBeUndefined();
    const usdt = await create(editor, {
      name: 'USDT Dust',
      type: 'CRYPTO_WALLET',
      currency: 'USDT',
      openingBalance: { amount: { amount: '0.000001', currency: 'USDT' }, date: '2026-01-01' },
    });
    expectProblem(
      await command(editor, usdt.body['id'] as string, 'close', 1, { closedOn: '2026-03-31' }),
      409,
      'ACCOUNT_BALANCE_NOT_ZERO',
    );
  });

  it('[TC-ACCOUNTS-METADATA-001] [TC-ACCOUNTS-TYPES-002] editar metadatos con If-Match; el tipo es inmutable', async () => {
    const a = await create(editor, {
      name: 'Bank A Meta',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: { amount: '925.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    const id = a.body['id'] as string;
    expectProblem(await patch(editor, id, 1, { type: 'CASH' }), 400, 'VALIDATION_FAILED');
    const first = await patch(editor, id, 1, {
      name: 'Banco principal',
      color: '#1144AA',
      notes: 'cuenta sueldo',
    });
    expect(first.status).toBe(200);
    expect(first.headers.get('etag')).toBe('"2"');
    expect(first.body).toMatchObject({
      type: 'BANK',
      version: 2,
      balance: { amount: '925.00', currency: 'BOB' },
    });
    expect(contract().validateResponse('updateAccount', 200, first.body)).toEqual([]);
    const stale = await patch(editor, id, 1, { name: 'Otro' });
    expectProblem(stale, 412, 'PRECONDITION_FAILED');
    expect(stale.body['currentVersion']).toBe(2);
    expect(await postingsOf(editor, id)).toHaveLength(2);
    const updated = (await outbox(editor, id)).at(-1)!;
    expect(updated.event_type).toBe('accounts.AccountUpdated');
    expect(eventSchemaRegistry().validate(updated.envelope as never)).toBeUndefined();
    expect((updated.envelope as { payload: unknown }).payload).toEqual({
      accountId: id,
      changedFields: ['name', 'color', 'notes'],
      name: 'Banco principal',
    });
    expect((await audits(editor, id)).at(-1)!.changes).toContainEqual({
      field: 'name',
      before: 'Bank A Meta',
      after: 'Banco principal',
    });
  });

  it('[TC-ACCOUNTS-CURRENCY-002] cambiar la moneda solo sin movimientos', async () => {
    const c = await create(editor, {
      name: 'Bank C Cur',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: { amount: '200.00', currency: 'BOB' }, date: '2026-01-01' },
    });
    const d = await create(editor, { name: 'Bank D Cur', type: 'BANK', currency: 'BOB' });
    expectProblem(
      await patch(editor, c.body['id'] as string, 1, { currency: 'USD' }),
      409,
      'ACCOUNT_CURRENCY_IMMUTABLE',
    );
    const moved = await patch(editor, d.body['id'] as string, 1, { currency: 'USD' });
    expect(moved.body).toMatchObject({ currency: 'USD', balance: { amount: '0.00', currency: 'USD' } });
    expect((await audits(editor, d.body['id'] as string)).at(-1)!.changes).toEqual([
      { field: 'currency', before: 'BOB', after: 'USD' },
    ]);
  });

  it('[TC-ACCOUNTS-NODELETE-001] las cuentas no se eliminan (ni por API ni por SQL)', async () => {
    const old = await create(editor, { name: 'Old Bank Del', type: 'BANK', currency: 'BOB' });
    const id = old.body['id'] as string;
    expect(
      (await call('DELETE', `${accountsPath(editor)}/${id}`, { token: editor.token })).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      await asApp(editor, (c) => sqlState(() => c.query('DELETE FROM accounts.account WHERE id = $1', [id]))),
    ).toBe('42501');
    expect((await call('GET', `${accountsPath(editor)}/${id}`, { token: editor.token })).status).toBe(200);
  });

  it('[TC-ACCOUNTS-LIST-001] equivalente en BOB con fecha, fuente y versión de la tasa; sin tasa null; nunca persistido', async () => {
    const u = await user(`kc-acc-eq-${randomUUID()}`);
    const opening = (amount: string, currency: string) => ({
      openingBalance: { amount: { amount, currency }, date: '2026-03-01' },
    });
    const usd = await create(u, {
      name: 'USD Savings',
      type: 'SAVINGS',
      currency: 'USD',
      ...opening('500.00', 'USD'),
    });
    const btc = await create(u, {
      name: 'BTC Wallet',
      type: 'CRYPTO_WALLET',
      currency: 'BTC',
      ...opening('0.01250000', 'BTC'),
    });
    const card = await create(u, {
      name: 'Credit Card',
      type: 'CREDIT_CARD',
      currency: 'BOB',
      ...opening('350.00', 'BOB'),
    });
    for (const r of [usd, btc, card]) expect(r.status, JSON.stringify(r.body)).toBe(201);
    // Sin tasas: ningún equivalente inventado.
    expect(usd.body['baseCurrencyBalance']).toBeNull();
    const rate = (value: string, asOf: string) =>
      call('POST', `/api/v1/workspaces/${u.ws}/fx-rates`, {
        token: u.token,
        body: { base: 'USD', quote: 'BOB', value, rateType: 'PARALLEL', asOf },
        headers: { 'idempotency-key': randomUUID() },
      });
    const first = await rate('6.96', '2026-03-14T16:00:00Z');
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const list = await call('GET', accountsPath(u), { token: u.token });
    expect(contract().validateResponse('listAccounts', 200, list.body)).toEqual([]);
    const byName = new Map(
      (list.body['data'] as Record<string, unknown>[]).map((a) => [a['name'] as string, a]),
    );
    expect(byName.get('USD Savings')?.['balance']).toEqual({ amount: '500.00', currency: 'USD' });
    expect(byName.get('USD Savings')?.['baseCurrencyBalance']).toMatchObject({
      amount: { amount: '3480.00', currency: 'BOB' },
      rateDate: '2026-03-14',
      rateSource: 'MANUAL',
      fxRateId: first.body['id'],
      rate: { rateType: 'PARALLEL', derivation: 'DIRECT', asOf: '2026-03-14T16:00:00.000Z', stale: false },
    });
    expect(byName.get('BTC Wallet')?.['balance']).toEqual({ amount: '0.01250000', currency: 'BTC' });
    expect(byName.get('BTC Wallet')?.['baseCurrencyBalance']).toBeNull();
    expect(byName.get('Credit Card')?.['balance']).toEqual({ amount: '350.00', currency: 'BOB' });
    expect(byName.get('Credit Card')?.['baseCurrencyBalance']).toBeNull();

    // Una tasa nueva cambia el equivalente mostrado (derivado) sin alterar el ledger.
    const before = await postingsOf(u, usd.body['id'] as string);
    const second = await rate('6.97', '2026-03-15T12:00:00Z');
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const one = await call('GET', `${accountsPath(u)}/${String(usd.body['id'])}`, { token: u.token });
    expect(contract().validateResponse('getAccount', 200, one.body)).toEqual([]);
    expect(one.body['baseCurrencyBalance']).toMatchObject({
      amount: { amount: '3485.00', currency: 'BOB' },
      rateDate: '2026-03-15',
      fxRateId: second.body['id'],
    });
    expect(await postingsOf(u, usd.body['id'] as string)).toEqual(before);
  });

  it('[TC-ACCOUNTS-LIST-002] filtros, agrupación y orden manual', async () => {
    const u = await user(`kc-acc-list-${randomUUID()}`);
    const inst = await call('POST', `/api/v1/workspaces/${u.ws}/institutions`, {
      token: u.token,
      body: { name: 'Banco Lista', kind: 'BANK' },
    });
    const a = await create(u, {
      name: 'L Bank',
      type: 'BANK',
      currency: 'BOB',
      institutionId: inst.body['id'],
    });
    const b = await create(u, { name: 'L Cash', type: 'CASH', currency: 'BOB' });
    const c = await create(u, { name: 'L USD', type: 'SAVINGS', currency: 'USD' });
    const ids = (r: Reply) => (r.body['data'] as { id: string }[]).map((x) => x.id);
    expect(ids(await call('GET', `${accountsPath(u)}?currency=USD`, { token: u.token }))).toEqual([
      c.body['id'],
    ]);
    expect(ids(await call('GET', `${accountsPath(u)}?type=CASH&type=BANK`, { token: u.token }))).toEqual([
      a.body['id'],
      b.body['id'],
    ]);
    const grouped = await call('GET', `${accountsPath(u)}?groupBy=institution`, { token: u.token });
    expect(contract().validateResponse('listAccounts', 200, grouped.body)).toEqual([]);
    expect(grouped.body['groups']).toEqual([
      { key: inst.body['id'], label: 'Banco Lista', accountIds: [a.body['id']] },
      { key: null, label: null, accountIds: [b.body['id'], c.body['id']] },
    ]);
    expectProblem(
      await call('GET', `${accountsPath(u)}?type=checking`, { token: u.token }),
      400,
      'VALIDATION_FAILED',
    );
    const order = await call('PUT', `${accountsPath(u)}/order`, {
      token: u.token,
      body: { accountIds: [c.body['id']] },
    });
    expect(order.status).toBe(204);
    expect(ids(await call('GET', accountsPath(u), { token: u.token }))).toEqual([
      c.body['id'],
      a.body['id'],
      b.body['id'],
    ]);
    const page = await call('GET', `${accountsPath(u)}?limit=2`, { token: u.token });
    expect((page.body['page'] as { hasMore: boolean }).hasMore).toBe(true);
    const next = await call(
      'GET',
      `${accountsPath(u)}?limit=2&cursor=${(page.body['page'] as { nextCursor: string }).nextCursor}`,
      {
        token: u.token,
      },
    );
    expect(ids(next)).toEqual([b.body['id']]);
    expect((await call('GET', accountsPath(u), { token: viewer.token })).status).toBe(403);
  });
});
