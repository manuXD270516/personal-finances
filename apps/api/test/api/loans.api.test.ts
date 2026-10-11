/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import { FixedClock, Instant, dec } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Préstamos por HTTP contra PostgreSQL real (openspec add-loans, tareas 5.2 y 5.3): registro, desembolso, pagos con
// desglose e imputación, anulación, compromisos de cuotas, tabla del banco y su comparación, roles, idempotencia,
// hechos de outbox y recorrido; las respuestas se validan contra el OpenAPI.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
const clock = new FixedClock(Instant.parse('2026-10-15T16:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let worker: Pool;

interface Reply {
  status: number;
  body: Record<string, any>;
  headers: Headers;
  text: string;
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
    headers['content-type'] ??= 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  const parse = (): Record<string, any> => {
    try {
      return text ? (JSON.parse(text) as Record<string, any>) : {};
    } catch {
      return {};
    }
  };
  return { status: res.status, headers: res.headers, body: parse(), text };
}

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;
const W = (u: User, ws = u.ws) => `/api/v1/workspaces/${ws}`;

async function join(owner: User, member: User, role: 'EDITOR' | 'VIEWER'): Promise<void> {
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
}

const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body !== undefined ? { body } : {}),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });
const withVersion = (u: User, method: string, path: string, body: unknown, version: number) =>
  call(method, `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: { 'if-match': `"${version}"` },
  });
const ok = async (r: Promise<Reply>, status = 201) => {
  const reply = await r;
  expect(reply.status, `${reply.text} ${apiErrors()}`).toBe(status);
  return reply.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, `${r.text} ${apiErrors()}`).toBe(status);
  expect(r.body['code'], r.text).toBe(code);
};
const checked = (operation: string, status: number, r: Reply) => {
  expect(r.status, r.text).toBe(status);
  expect(contract.validateResponse(operation, status, r.body), r.text).toEqual([]);
  return r.body;
};

const bob = (amount: string) => ({ amount, currency: 'BOB' });
let owner: User;
let editor: User;
let viewer: User;
/** El VIEWER y el EDITOR operan sobre el workspace del OWNER. */
const member = (u: User): User => ({ ...u, ws: owner.ws });
let bank: string;
let bankUsd: string;
let seq = 0;

async function account(u: User, name: string, currency: string, opening: string): Promise<string> {
  const r = await ok(
    post(u, '/accounts', {
      name,
      type: 'BANK',
      currency,
      openingBalance: { amount: { amount: opening, currency }, date: '2026-09-01' },
    }),
  );
  return r['id'] as string;
}

async function ledgerBalance(u: User, accountId: string): Promise<string> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, async () => {
      const { rows } = await app.query<{ balance: string }>(
        `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,2)::text AS balance
           FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
          WHERE la.source_account_id = $1`,
        [accountId],
      );
      return rows[0]!.balance;
    });
  } finally {
    await app.end();
  }
}

const setToday = (date: string) => clock.set(Instant.parse(`${date}T16:00:00Z`));

/** Condiciones del préstamo vehicular (50000.00 BOB, 11.50 %, 30/360, 24 cuotas). */
const vehicular = (over: Record<string, unknown> = {}) => ({
  name: 'Préstamo vehicular',
  account: { create: { name: `Préstamo vehicular ${(seq += 1)}` } },
  disbursementAccountId: bank,
  principal: bob('50000.00'),
  annualRate: '0.115',
  termInstallments: 24,
  disbursementDate: '2026-10-15',
  firstDueDate: '2026-11-15',
  ...over,
});

async function register(over: Record<string, unknown> = {}, u: User = owner) {
  const r = await post(u, '/loans', vehicular(over));
  checked('registerLoan', 201, r);
  return r.body;
}
async function activeLoan(over: Record<string, unknown> = {}, retainedFee?: string) {
  const draft = await register(over);
  const r = await post(owner, `/loans/${draft['id']}/disburse`, retainedFee ? { retainedFee } : {});
  checked('disburseLoan', 200, r);
  return r.body;
}
const detail = async (id: string, u: User = owner) => checked('getLoan', 200, await get(u, `/loans/${id}`));
const pay = (id: string, over: Record<string, unknown> = {}, u: User = owner) =>
  post(u, `/loans/${id}/payments`, {
    amount: bob('2342.02'),
    businessDate: '2026-11-15',
    accountId: bank,
    ...over,
  });
const payOk = async (id: string, over: Record<string, unknown> = {}) => {
  const r = await pay(id, over);
  return checked('recordLoanPayment', 201, r);
};
const installments = async (id: string) => {
  const r = await get(owner, `/loans/${id}/installments`);
  return checked('listLoanInstallments', 200, r)['data'] as any[];
};
const voidPayment = async (loan: Record<string, any>, paymentId: string, reason = 'monto equivocado') => {
  const current = await detail(loan['id']);
  return call('POST', `${W(owner)}/loans/${loan['id']}/payments/${paymentId}/void`, {
    token: owner.token,
    body: { reason },
    headers: { 'idempotency-key': randomUUID(), 'if-match': `"${current['version']}"` },
  });
};

async function outboxOf(ws: string, eventType: string, aggregateId?: string) {
  const { rows } = await worker.query<{
    envelope: { payload: Record<string, any>; aggregateVersion: number };
  }>(
    `SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = $2
       AND ($3::uuid IS NULL OR aggregate_id = $3::uuid) ORDER BY sequence`,
    [ws, eventType, aggregateId ?? null],
  );
  return rows.map((r) => r.envelope);
}

async function txnCount(u: User, kind: string): Promise<number> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, async () => {
      const { rows } = await app.query<{ n: string }>(
        `SELECT count(*) AS n FROM txn.transaction WHERE workspace_id = $1 AND kind = $2`,
        [u.ws, kind],
      );
      return Number(rows[0]!.n);
    });
  } finally {
    await app.end();
  }
}

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), apiLog.logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  owner = await user(`kc-loans-owner-${randomUUID()}`);
  editor = await user(`kc-loans-editor-${randomUUID()}`);
  viewer = await user(`kc-loans-viewer-${randomUUID()}`);
  await join(owner, editor, 'EDITOR');
  await join(owner, viewer, 'VIEWER');
  bank = await account(owner, 'Banco BOB', 'BOB', '1000.00');
  bankUsd = await account(owner, 'Banco USD', 'USD', '500.00');
}, 240_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

describe('registro del préstamo (borrador, cuentas y vista previa)', () => {
  it('[TC-DEBT-LOAN-001] [TC-DEBT-LOAN-004] un préstamo francés nuevo queda en borrador con su vista previa, la cuenta loan creada en el acto y sin asientos', async () => {
    setToday('2026-10-10');
    const before = await txnCount(owner, 'LOAN_DISBURSEMENT');
    const loan = await register({ lenderCounterpartyId: undefined });
    expect(loan['status']).toBe('DRAFT');
    expect(loan['preview'].installments).toHaveLength(24);
    expect(loan['preview'].installmentAmount).toBe('2342.02');
    expect(loan['preview'].installments[0].total).toBe('2342.02');
    expect(loan['preview'].installments[23].total).toBe('2341.90');
    expect(loan['preview'].totalInterest).toBe('6208.36');
    // La cuenta se creó en el mismo acto: loan/pasivo/BOB con saldo 0.00.
    const acct = await get(owner, `/accounts/${loan['accountId']}`);
    expect(acct.body['type']).toBe('LOAN');
    expect(acct.body['currency']).toBe('BOB');
    expect(await ledgerBalance(owner, loan['accountId'])).toBe('0.00');
    expect(await txnCount(owner, 'LOAN_DISBURSEMENT')).toBe(before);
    expect(loan['accountBalance']).toEqual(bob('0.00'));
  });

  it('[TC-DEBT-LOAN-002] la primera cuota anterior al desembolso se rechaza', async () => {
    const r = await post(owner, '/loans', vehicular({ firstDueDate: '2026-10-10' }));
    problem(r, 400, 'VALIDATION_FAILED');
  });

  it('[TC-DEBT-LOAN-003] [TC-DEBT-AMORT-013] un sistema distinto del francés se rechaza mientras no esté habilitado', async () => {
    problem(await post(owner, '/loans', vehicular({ method: 'GERMAN' })), 422, 'LOAN_METHOD_NOT_AVAILABLE');
  });

  it('[TC-DEBT-LOAN-044] un principal con más decimales que la moneda se rechaza', async () => {
    problem(
      await post(owner, '/loans', vehicular({ principal: bob('50000.005') })),
      422,
      'AMOUNT_SCALE_EXCEEDED',
    );
  });

  it('[TC-DEBT-LOAN-005] una cuenta que no es loan no puede respaldar un préstamo', async () => {
    problem(await post(owner, '/loans', vehicular({ account: { id: bank } })), 422, 'LOAN_ACCOUNT_INVALID');
  });

  it('[TC-DEBT-LOAN-006] el destino del desembolso en otra moneda se rechaza', async () => {
    problem(
      await post(owner, '/loans', vehicular({ disbursementAccountId: bankUsd })),
      422,
      'CURRENCY_MISMATCH',
    );
  });

  it('[TC-DEBT-LOAN-043] una cuenta loan solo respalda un préstamo no cancelado', async () => {
    const first = await register();
    problem(
      await post(owner, '/loans', vehicular({ account: { id: first['accountId'] } })),
      409,
      'LOAN_ACCOUNT_IN_USE',
    );
  });

  it('[TC-DEBT-AMORT-012] la vista previa calcula el cronograma sin persistir nada', async () => {
    const before = (await get(owner, '/loans')).body['data'].length;
    const r = await call('POST', `${W(member(viewer))}/loans/schedule-preview`, {
      token: viewer.token,
      body: {
        name: 'Prueba',
        principal: bob('1000.00'),
        annualRate: '0.12',
        termInstallments: 3,
        disbursementDate: '2026-10-15',
        firstDueDate: '2026-11-15',
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    const preview = checked('previewLoanSchedule', 200, r);
    expect(preview['installments'].map((i: any) => i.total)).toEqual(['340.02', '340.02', '340.03']);
    expect((await get(owner, '/loans')).body['data'].length).toBe(before);
  });

  it('[TC-DEBT-LOAN-031] un VIEWER no registra préstamos ni pagos', async () => {
    problem(await post(member(viewer), '/loans', vehicular()), 403, 'INSUFFICIENT_ROLE');
    const loan = await activeLoan();
    const before = await txnCount(owner, 'LOAN_PAYMENT');
    problem(await pay(loan['id'], {}, member(viewer)), 403, 'INSUFFICIENT_ROLE');
    expect(await txnCount(owner, 'LOAN_PAYMENT')).toBe(before);
  });
});

describe('préstamo en curso', () => {
  it('[TC-DEBT-LOAN-010] un préstamo en curso entra activo con saldo inicial y cronograma desde la cuota 7', async () => {
    const r = await post(owner, '/loans', {
      name: 'Préstamo personal',
      origin: 'EXISTING',
      account: { create: { name: `Préstamo personal ${(seq += 1)}` } },
      disbursementAccountId: bank,
      principal: bob('30000.00'),
      annualRate: '0.115',
      termInstallments: 18,
      firstDueDate: '2026-11-15',
      existing: { asOf: '2026-10-15', nextInstallmentNo: 7 },
    });
    const loan = checked('registerLoan', 201, r);
    expect(loan['status']).toBe('ACTIVE');
    expect(loan['disbursementTransactionId']).toBeNull();
    expect(await ledgerBalance(owner, loan['accountId'])).toBe('-30000.00');
    const list = await installments(loan['id']);
    expect(list).toHaveLength(18);
    expect([list[0].n, list[17].n]).toEqual([7, 24]);
    expect(list[0].total).toBe('1822.50');
    expect(list[17].total).toBe('1822.53');
    const principal = list.reduce((acc, i) => acc.plus(i.principal), dec('0'));
    expect(principal.eq('30000')).toBe(true);
  });

  it('[TC-DEBT-LOAN-011] el saldo de la cuenta distinto del pendiente declarado se rechaza', async () => {
    const acct = await ok(
      post(owner, '/accounts', {
        name: `Préstamo ajeno ${(seq += 1)}`,
        type: 'LOAN',
        currency: 'BOB',
        openingBalance: { amount: bob('29500.00'), date: '2026-10-15' },
      }),
    );
    const r = await post(owner, '/loans', {
      name: 'Préstamo personal',
      origin: 'EXISTING',
      account: { id: acct['id'] },
      disbursementAccountId: bank,
      principal: bob('30000.00'),
      annualRate: '0.115',
      termInstallments: 18,
      firstDueDate: '2026-11-15',
      existing: { asOf: '2026-10-15', nextInstallmentNo: 7 },
    });
    problem(r, 422, 'LOAN_BALANCE_MISMATCH');
    expect(r.body['details'] ?? r.body).toBeDefined();
  });
});

describe('desembolso', () => {
  it('[TC-DEBT-LOAN-007] el desembolso aumenta el activo destino y la deuda por el principal sin cambiar el patrimonio', async () => {
    setToday('2026-10-15');
    const bankBefore = Number(await ledgerBalance(owner, bank));
    const draft = await register();
    const loan = checked('disburseLoan', 200, await post(owner, `/loans/${draft['id']}/disburse`, {}));
    expect(loan['status']).toBe('ACTIVE');
    expect(loan['currentScheduleVersion']).toBe(1);
    expect(Number(await ledgerBalance(owner, bank)) - bankBefore).toBe(50000);
    expect(await ledgerBalance(owner, loan['accountId'])).toBe('-50000.00');
    const d = await detail(loan['id']);
    expect(d['accountBalance']).toEqual(bob('50000.00'));
    expect(d['outstandingPrincipal']).toEqual(bob('50000.00'));
    expect((await installments(loan['id'])).length).toBe(24);
    const events = await outboxOf(owner.ws, 'debt.LoanDisbursed', loan['id']);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload['principal']).toEqual(bob('50000.00'));
    expect(await outboxOf(owner.ws, 'debt.LoanScheduleGenerated', loan['id'])).toHaveLength(1);
    // Desembolsar otra vez: ya no es borrador.
    problem(await post(owner, `/loans/${loan['id']}/disburse`, {}), 409, 'LOAN_NOT_DRAFT');
  });

  it('[TC-DEBT-LOAN-008] la comisión retenida es gasto y la deuda se reconoce por el principal completo', async () => {
    const bankBefore = Number(await ledgerBalance(owner, bank));
    const loan = await activeLoan({}, '500.00');
    expect(Number(await ledgerBalance(owner, bank)) - bankBefore).toBe(49500);
    expect(await ledgerBalance(owner, loan['accountId'])).toBe('-50000.00');
    expect(loan['retainedFee']).toEqual(bob('500.00'));
  });

  it('[TC-DEBT-LOAN-009] un desembolso en un periodo cerrado se rechaza sin efectos', async () => {
    const lonely = await user(`kc-loans-closed-${randomUUID()}`);
    const acc = await account(lonely, 'Banco cerrado', 'BOB', '100.00');
    const app = await connect(deps.databaseUrl);
    try {
      await inTx(
        app,
        { userId: lonely.id, workspaceId: lonely.ws },
        () =>
          app.query(
            `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end) VALUES ($1, '2026-09', '2026-09-01', '2026-09-30')`,
            [lonely.ws],
          ),
        true,
      );
    } finally {
      await app.end();
    }
    const draft = await post(
      lonely,
      '/loans',
      vehicular({ disbursementAccountId: acc, disbursementDate: '2026-09-30', firstDueDate: '2026-10-30' }),
    );
    expect(draft.status, draft.text).toBe(201);
    problem(await post(lonely, `/loans/${draft.body['id']}/disburse`, {}), 409, 'PERIOD_CLOSED');
    expect((await detail(draft.body['id'], lonely))['status']).toBe('DRAFT');
    expect(await txnCount(lonely, 'LOAN_DISBURSEMENT')).toBe(0);
  });
});

describe('pagos, imputación y diferencias', () => {
  it('[TC-DEBT-LOAN-012] [TC-DEBT-LOAN-029] [TC-DEBT-LOAN-033] el pago de la cuota separa el principal (reduce la deuda) del interés (gasto)', async () => {
    const loan = await activeLoan();
    setToday('2026-11-15');
    const bankBefore = Number(await ledgerBalance(owner, bank));
    const result = await payOk(loan['id']);
    const payment = result['payment'];
    expect([payment['principal'], payment['interest'], payment['fees']]).toEqual([
      '1862.85',
      '479.17',
      '0.00',
    ]);
    expect(payment['installmentNos']).toEqual([1]);
    expect(bankBefore - Number(await ledgerBalance(owner, bank))).toBeCloseTo(2342.02, 2);
    const d = await detail(loan['id']);
    expect(d['outstandingPrincipal']).toEqual(bob('48137.15'));
    expect(d['accountBalance']).toEqual(bob('48137.15'));
    expect(d['unreconciledDifference']).toEqual(bob('0.00'));
    expect(d['paidTotals'].interest).toEqual(bob('479.17'));
    const list = await installments(loan['id']);
    expect(list[0].status).toBe('PAID');
    expect(list[1].status).toBe('UNPAID');
    // Hecho único con el desglose y el pendiente.
    const events = await outboxOf(owner.ws, 'debt.LoanPaymentRecorded', loan['id']);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      installmentNos: [1],
      currency: 'BOB',
      breakdown: {
        principal: '1862.85',
        interest: '479.17',
        fees: '0.00',
        insurance: '0.00',
        taxes: '0.00',
        total: '2342.02',
      },
      remainingPrincipal: '48137.15',
    });
    // Hoy 2026-12-16: la cuota 2 del 2026-12-15 figura atrasada.
    setToday('2026-12-16');
    const later = await detail(loan['id']);
    expect(later['overdueInstallments'].map((i: any) => i.n)).toEqual([2]);
    expect(later['nextInstallment'].n).toBe(2);
    setToday('2026-11-15');
  });

  it('[TC-DEBT-LOAN-014] un pago puede cubrir varias cuotas en orden', async () => {
    const loan = await activeLoan({ termInstallments: 24 });
    setToday('2026-11-15');
    const result = await payOk(loan['id'], { amount: bob('4684.04') });
    expect(result['payment']['installmentNos']).toEqual([1, 2]);
    expect(result['payment']['principal']).toBe('3743.56');
    expect(result['payment']['interest']).toBe('940.48');
    const list = await installments(loan['id']);
    expect([list[0].status, list[1].status, list[2].status]).toEqual(['PAID', 'PAID', 'UNPAID']);
  });

  it('[TC-DEBT-LOAN-013] comisión y seguro de la cuota se registran en sus categorías de sistema', async () => {
    const loan = await activeLoan({
      charges: {
        fees: { mode: 'FIXED', value: '10.00' },
        insurance: { mode: 'RATE_ON_BALANCE', value: '0.0004' },
      },
    });
    setToday('2026-11-15');
    const result = await payOk(loan['id'], { amount: bob('2372.02') });
    const p = result['payment'];
    expect([p['principal'], p['interest'], p['fees'], p['insurance'], p['taxes']]).toEqual([
      '1862.85',
      '479.17',
      '10.00',
      '20.00',
      '0.00',
    ]);
    const tx = await get(owner, `/transactions/${p['transactionId']}`);
    expect(tx.body['kind']).toBe('LOAN_PAYMENT');
    const splits = (tx.body['splits'] as any[]).map((s) => s.amount.amount).sort();
    expect(splits).toEqual(['10.00', '20.00', '479.17']);
  });

  it('[TC-DEBT-LOAN-015] un pago parcial se imputa a impuestos, seguro, comisiones, interés y principal y deja la cuota parcial; completarla la paga', async () => {
    const loan = await activeLoan({
      charges: {
        fees: { mode: 'FIXED', value: '10.00' },
        insurance: { mode: 'RATE_ON_BALANCE', value: '0.0004' },
      },
    });
    setToday('2026-11-15');
    const first = await payOk(loan['id'], { amount: bob('2000.00') });
    const p = first['payment'];
    expect([p['insurance'], p['fees'], p['interest'], p['principal']]).toEqual([
      '20.00',
      '10.00',
      '479.17',
      '1490.83',
    ]);
    let list = await installments(loan['id']);
    expect(list[0].status).toBe('PARTIALLY_PAID');
    expect(list[0].differences.principal).toBe('-372.02');
    expect(list[0].pendingTotal).toBe('372.02');
    const second = await payOk(loan['id'], { amount: bob('372.02') });
    expect(second['payment']['principal']).toBe('372.02');
    list = await installments(loan['id']);
    expect(list[0].status).toBe('PAID');
    expect(list[0].paid.principal).toBe('1862.85');
    expect(list[0].differences.principal).toBe('0.00');
  });

  it('[TC-DEBT-LOAN-016] un pago mayor que todo lo pendiente se rechaza', async () => {
    const loan = await activeLoan({
      principal: bob('1000.00'),
      annualRate: '0.12',
      termInstallments: 3,
      disbursementDate: '2026-10-15',
      firstDueDate: '2026-11-15',
    });
    setToday('2026-11-15');
    await payOk(loan['id'], { amount: bob('340.02') });
    await payOk(loan['id'], { amount: bob('340.02'), businessDate: '2026-12-15' });
    const before = await txnCount(owner, 'LOAN_PAYMENT');
    problem(
      await pay(loan['id'], { amount: bob('500.00'), businessDate: '2027-01-15' }),
      422,
      'LOAN_OVERPAYMENT',
    );
    expect(await txnCount(owner, 'LOAN_PAYMENT')).toBe(before);
  });

  it('[TC-DEBT-LOAN-017] el desglose del recibo con interés moratorio se registra y muestra la diferencia', async () => {
    const loan = await activeLoan();
    setToday('2026-11-20');
    const result = await payOk(loan['id'], {
      amount: bob('2360.00'),
      businessDate: '2026-11-20',
      installmentNo: 1,
      breakdown: { principal: '1862.85', interest: '497.15' },
    });
    expect(result['payment']['interest']).toBe('497.15');
    const list = await installments(loan['id']);
    expect(list[0].status).toBe('PAID');
    expect(list[0].differences.interest).toBe('17.98');
  });

  it('[TC-DEBT-LOAN-018] un desglose que no suma el monto pagado se rechaza', async () => {
    const loan = await activeLoan();
    setToday('2026-11-15');
    const before = await txnCount(owner, 'LOAN_PAYMENT');
    const r = await pay(loan['id'], {
      amount: bob('2400.00'),
      installmentNo: 1,
      breakdown: { principal: '1862.85', interest: '479.17', fees: '50.00' },
    });
    problem(r, 422, 'PAYMENT_BREAKDOWN_MISMATCH');
    expect(await txnCount(owner, 'LOAN_PAYMENT')).toBe(before);
  });

  it('[TC-DEBT-LOAN-032] el reintento con la misma clave de idempotencia no duplica el pago', async () => {
    const loan = await activeLoan();
    setToday('2026-11-15');
    const key = randomUUID();
    const body = { amount: bob('2342.02'), businessDate: '2026-11-15', accountId: bank };
    const a = await post(owner, `/loans/${loan['id']}/payments`, body, { 'idempotency-key': key });
    const b = await post(owner, `/loans/${loan['id']}/payments`, body, { 'idempotency-key': key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get('idempotent-replayed')).toBe('true');
    expect(b.body['payment']['id']).toBe(a.body['payment']['id']);
    expect((await get(owner, `/loans/${loan['id']}/payments`)).body['data']).toHaveLength(1);
    expect((await detail(loan['id']))['outstandingPrincipal']).toEqual(bob('48137.15'));
  });

  it('[TC-DEBT-LOAN-030] un movimiento manual en la cuenta del préstamo aparece como diferencia no registrada', async () => {
    const loan = await activeLoan();
    setToday('2026-11-15');
    await payOk(loan['id']);
    await ok(
      post(owner, '/transfers', {
        fromAccountId: bank,
        toAccountId: loan['accountId'],
        transactionDate: '2026-11-15',
        amount: bob('1000.00'),
      }),
    );
    const d = await detail(loan['id']);
    expect(d['accountBalance']).toEqual(bob('47137.15'));
    expect(d['outstandingPrincipal']).toEqual(bob('48137.15'));
    expect(d['unreconciledDifference']).toEqual(bob('1000.00'));
  });

  const occurrencesOf = async (definitionId: string) => {
    const r = await get(owner, `/recurring/${definitionId}/occurrences?limit=200`);
    expect(r.status, r.text).toBe(200);
    return r.body['data'] as any[];
  };

  it('[TC-DEBT-LOAN-024] un pago parcial deja la ocurrencia sin resolver esperando el pendiente', async () => {
    setToday('2026-10-15');
    const loan = await activeLoan({
      charges: {
        fees: { mode: 'FIXED', value: '10.00' },
        insurance: { mode: 'RATE_ON_BALANCE', value: '0.0004' },
      },
    });
    const first = (await occurrencesOf(loan['recurringDefinitionId'])).find(
      (o) => o['occurrenceDate'] === '2026-11-15',
    )!;
    expect(first['expected'].amount).toEqual(bob('2372.02'));
    setToday('2026-11-15');
    await payOk(loan['id'], { amount: bob('2000.00') });
    const occ = (await occurrencesOf(loan['recurringDefinitionId'])).find(
      (o) => o['occurrenceDate'] === '2026-11-15',
    )!;
    expect(['SCHEDULED', 'DUE', 'OVERDUE']).toContain(occ['status']);
    expect(occ['expected'].amount).toEqual(bob('372.02'));
    expect(occ['transactionId']).toBeNull();
  });

  it('[TC-DEBT-LOAN-025] [TC-DEBT-LOAN-038] un pago de dos cuotas resuelve ambas ocurrencias con la misma transacción', async () => {
    setToday('2026-10-15');
    const loan = await activeLoan();
    setToday('2026-11-15');
    const result = await payOk(loan['id'], { amount: bob('4684.04') });
    const occs = await occurrencesOf(loan['recurringDefinitionId']);
    const resolved = occs.filter((o) => o['transactionId'] === result['payment']['transactionId']);
    expect(resolved.map((o) => o['occurrenceDate']).sort()).toEqual(['2026-11-15', '2026-12-15']);
    expect(resolved.every((o) => ['MATERIALIZED', 'MATCHED'].includes(o['status']))).toBe(true);
  });
});

describe('anulación, saldado y cancelación', () => {
  it('[TC-DEBT-LOAN-020] [TC-DEBT-LOAN-026] anular el último pago revierte el asiento, devuelve la cuota a no pagada y la ocurrencia a atrasada', async () => {
    const loan = await activeLoan();
    setToday('2026-11-15');
    const paid = await payOk(loan['id']);
    setToday('2026-11-20');
    const reply = await voidPayment(loan, paid['payment']['id']);
    checked('voidLoanPayment', 200, reply);
    expect(reply.body['payment']['status']).toBe('VOIDED');
    const d = await detail(loan['id']);
    expect(d['accountBalance']).toEqual(bob('50000.00'));
    expect(d['outstandingPrincipal']).toEqual(bob('50000.00'));
    expect((await installments(loan['id']))[0].status).toBe('UNPAID');
    const tx = await get(owner, `/transactions/${paid['payment']['transactionId']}`);
    expect(tx.body['status']).toBe('VOIDED');
    // Hoy 2026-11-20: la ocurrencia vuelve a atrasada con el total de la cuota.
    const occs = await get(owner, `/recurring/${loan['recurringDefinitionId']}/occurrences?limit=200`);
    const first = (occs.body['data'] as any[]).find((o) => o.occurrenceDate === '2026-11-15');
    expect(first.status).toBe('OVERDUE');
    expect(first.expected.amount).toEqual(bob('2342.02'));
    expect(first.transactionId).toBeNull();
    expect(await outboxOf(owner.ws, 'debt.LoanPaymentVoided', loan['id'])).toHaveLength(1);
    setToday('2026-11-15');
  });

  it('[TC-DEBT-LOAN-021] solo el pago más reciente puede anularse', async () => {
    const loan = await activeLoan();
    setToday('2026-11-15');
    const one = await payOk(loan['id']);
    await payOk(loan['id'], { businessDate: '2026-12-15' });
    problem(await voidPayment(loan, one['payment']['id']), 409, 'LOAN_PAYMENT_NOT_LATEST');
    const payments = (await get(owner, `/loans/${loan['id']}/payments`)).body['data'] as any[];
    expect(payments.map((p) => p.status)).toEqual(['ACTIVE', 'ACTIVE']);
  });

  it('[TC-DEBT-LOAN-027] [TC-DEBT-LOAN-034] el préstamo queda saldado cuando el principal pendiente llega a cero y su recorrido lo registra', async () => {
    setToday('2026-10-10');
    const draft = await register({
      principal: bob('1000.00'),
      annualRate: '0.12',
      termInstallments: 3,
      disbursementDate: '2026-10-15',
      firstDueDate: '2026-11-15',
    });
    setToday('2026-10-15');
    const loan = checked('disburseLoan', 200, await post(owner, `/loans/${draft['id']}/disburse`, {}));
    setToday('2026-11-15');
    await payOk(loan['id'], { amount: bob('340.02') });
    setToday('2026-12-15');
    await payOk(loan['id'], { amount: bob('340.02'), businessDate: '2026-12-15' });
    setToday('2027-01-15');
    await payOk(loan['id'], { amount: bob('340.03'), businessDate: '2027-01-15' });
    const d = await detail(loan['id']);
    expect(d['status']).toBe('PAID_OFF');
    expect(d['accountBalance']).toEqual(bob('0.00'));
    problem(
      await pay(loan['id'], { amount: bob('10.00'), businessDate: '2027-01-15' }),
      409,
      'LOAN_NOT_ACTIVE',
    );
    expect(await outboxOf(owner.ws, 'debt.LoanPaidOff', loan['id'])).toHaveLength(1);
    const lifecycle = checked('getLoanLifecycle', 200, await get(owner, `/loans/${loan['id']}/lifecycle`));
    const transitions = (lifecycle['items'] as any[]).filter((t) => t.kind === 'TRANSITION');
    expect(transitions.map((t) => t.toState)).toEqual(['DRAFT', 'ACTIVE', 'PAID_OFF']);
    const annotations = (lifecycle['items'] as any[]).filter((t) => t.kind === 'ANNOTATION');
    expect(annotations.length).toBeGreaterThanOrEqual(3);
    // Anular el pago que lo saldó lo reactiva.
    const payments = (await get(owner, `/loans/${loan['id']}/payments`)).body['data'] as any[];
    const last = payments[payments.length - 1];
    checked('voidLoanPayment', 200, await voidPayment(loan, last.id, 'error'));
    expect((await detail(loan['id']))['status']).toBe('ACTIVE');
    setToday('2026-11-15');
  });

  it('[TC-DEBT-LOAN-028] un préstamo con pagos vigentes no se cancela', async () => {
    const loan = await activeLoan();
    setToday('2026-11-15');
    await payOk(loan['id']);
    const current = await detail(loan['id']);
    problem(
      await withVersion(
        owner,
        'POST',
        `/loans/${loan['id']}/cancel`,
        { reason: 'duplicado' },
        current['version'],
      ),
      409,
      'LOAN_HAS_PAYMENTS',
    );
    expect((await detail(loan['id']))['status']).toBe('ACTIVE');
  });

  it('[TC-DEBT-LOAN-045] cancelar un préstamo activo sin pagos anula el desembolso y termina el compromiso', async () => {
    setToday('2026-10-15');
    const loan = await activeLoan();
    const current = await detail(loan['id']);
    const r = await withVersion(
      owner,
      'POST',
      `/loans/${loan['id']}/cancel`,
      { reason: 'duplicado' },
      current['version'],
    );
    const cancelled = checked('cancelLoan', 200, r);
    expect(cancelled['status']).toBe('CANCELLED');
    expect(await ledgerBalance(owner, loan['accountId'])).toBe('0.00');
    const tx = await get(owner, `/transactions/${loan['disbursementTransactionId']}`);
    expect(tx.body['status']).toBe('VOIDED');
    const occs = await get(owner, `/recurring/${loan['recurringDefinitionId']}/occurrences?limit=200`);
    const pending = (occs.body['data'] as any[]).filter((o) =>
      ['SCHEDULED', 'DUE', 'OVERDUE'].includes(o.status),
    );
    expect(pending).toEqual([]);
  });
});

describe('condiciones bloqueadas y datos descriptivos', () => {
  it('[TC-DEBT-AMORT-013] [TC-DEBT-AMORT-014] las condiciones financieras de un préstamo activo no se editan; el nombre sí', async () => {
    setToday('2026-10-15');
    const loan = await activeLoan();
    const locked = await withVersion(
      owner,
      'PATCH',
      `/loans/${loan['id']}`,
      { annualRate: '0.10' },
      loan['version'],
    );
    problem(locked, 409, 'LOAN_TERMS_LOCKED');
    const renamed = await withVersion(
      owner,
      'PATCH',
      `/loans/${loan['id']}`,
      { name: 'Auto 2026' },
      loan['version'],
    );
    const body = checked('updateLoan', 200, renamed);
    expect(body['name']).toBe('Auto 2026');
    const list = await installments(loan['id']);
    expect(list[0].total).toBe('2342.02');
    expect((await detail(loan['id']))['currentScheduleVersion']).toBe(1);
  });
});

describe('cuotas como compromisos y transacciones administradas', () => {
  it('[TC-DEBT-LOAN-035] [TC-DEBT-LOAN-036] [TC-DEBT-LOAN-037] [TC-DEBT-LOAN-023] las ocurrencias salen del calendario explícito y no se operan desde recurrentes', async () => {
    setToday('2026-10-17');
    const loan = await activeLoan();
    const occs = await get(owner, `/recurring/${loan['recurringDefinitionId']}/occurrences?limit=200`);
    const rows = occs.body['data'] as any[];
    expect(rows.map((o) => o.occurrenceDate)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    expect(rows.every((o) => o.expected.amount.amount === '2342.02')).toBe(true);
    // Crear una definición LOAN_PAYMENT a mano.
    const manual = await post(owner, '/recurring', {
      name: 'Cuota a mano',
      kind: 'LOAN_PAYMENT',
      template: {
        accountId: bank,
        amount: { type: 'FIXED', amount: bob('1200.00') },
        schedule: { cadence: 'MONTHLY', startDate: '2026-11-01' },
      },
    });
    problem(manual, 422, 'RECURRING_KIND_NOT_AVAILABLE');
    // Aprobar la ocurrencia desde recurrentes.
    const approve = await call('POST', `${W(owner)}/recurring/occurrences/${rows[0].id}/materialize`, {
      token: owner.token,
      body: {},
      headers: { 'idempotency-key': randomUUID() },
    });
    problem(approve, 409, 'RECURRING_MANAGED_EXTERNALLY');
    // Pausar la definición del préstamo.
    const def = await get(owner, `/recurring/${loan['recurringDefinitionId']}`);
    const pause = await call('POST', `${W(owner)}/recurring/${loan['recurringDefinitionId']}/pause`, {
      token: owner.token,
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${def.body['version']}"` },
    });
    problem(pause, 409, 'RECURRING_MANAGED_EXTERNALLY');
  });

  it('[TC-DEBT-LOAN-040] [TC-DEBT-LOAN-041] [TC-DEBT-LOAN-042] el pago aparece en transacciones con su desglose, no se anula desde allí y sus notas son editables', async () => {
    setToday('2026-10-15');
    const loan = await activeLoan();
    setToday('2026-11-15');
    const paid = await payOk(loan['id']);
    const txId = paid['payment']['transactionId'] as string;
    const list = await get(owner, `/transactions?kind=LOAN_PAYMENT&limit=200`);
    expect(list.status, list.text).toBe(200);
    const row = (list.body['data'] as any[]).find((t) => t.id === txId);
    expect(row).toBeDefined();
    expect(row.loanId).toBe(loan['id']);
    expect(row.loanPaymentBreakdown.principal).toEqual(bob('1862.85'));
    expect(row.loanPaymentBreakdown.interest).toEqual(bob('479.17'));
    const tx = await get(owner, `/transactions/${txId}`);
    const voided = await call('POST', `${W(owner)}/transactions/${txId}/void`, {
      token: owner.token,
      body: { reason: 'prueba' },
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${tx.body['version']}"` },
    });
    problem(voided, 409, 'TRANSACTION_MANAGED_EXTERNALLY');
    const note = await call('PATCH', `${W(owner)}/transactions/${txId}`, {
      token: owner.token,
      body: { notes: 'pagado en ventanilla' },
      headers: { 'if-match': `"${tx.body['version']}"`, 'content-type': 'application/merge-patch+json' },
    });
    expect(note.status, note.text).toBe(200);
    expect(note.body['notes']).toBe('pagado en ventanilla');
    const created = await post(owner, '/transactions', {
      kind: 'LOAN_PAYMENT',
      transactionDate: '2026-11-15',
      accountId: bank,
      amount: bob('10.00'),
    });
    expect([400, 422]).toContain(created.status);
  });
});

describe('tabla del banco y comparación', () => {
  const syntheticTable = (loan: Record<string, any>, mutate?: (rows: string[][]) => void) =>
    installments(loan['id']).then((list) => {
      const rows = list.map((i) => [
        String(i.n),
        i.dueDate.split('-').reverse().join('/'),
        i.principal.replace('.', ','),
        i.interest.replace('.', ','),
        i.total.replace('.', ','),
      ]);
      mutate?.(rows);
      return ['Nro;Fecha;Capital;Interés;Cuota', ...rows.map((r) => r.join(';'))].join('\n');
    });
  const upload = (loan: Record<string, any>, text: string) =>
    post(owner, `/loans/${loan['id']}/reference-schedules`, {
      source: 'PASTE',
      text,
      delimiter: ';',
      mapping: {
        installmentNo: 'Nro',
        dueDate: 'Fecha',
        principal: 'Capital',
        interest: 'Interés',
        total: 'Cuota',
      },
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: ',',
    });

  it('[TC-DEBT-AMORT-015] [TC-DEBT-AMORT-017] la tabla pegada se guarda como referencia versionada sin cambiar el cronograma y coincide al centavo', async () => {
    setToday('2026-10-15');
    const loan = await activeLoan();
    const before = await installments(loan['id']);
    const reply = await upload(loan, await syntheticTable(loan));
    const body = checked('uploadLoanReferenceSchedule', 201, reply);
    expect(body['referenceVersion']).toBe(1);
    expect(body['rowCount']).toBe(24);
    expect(body['comparison']['status']).toBe('MATCH');
    expect(body['comparison']['matched']).toBe(24);
    expect(await installments(loan['id'])).toEqual(before);
    const cmp = checked(
      'getLoanScheduleComparison',
      200,
      await get(owner, `/loans/${loan['id']}/reference-schedules/${body['id']}/comparison`),
    );
    expect(cmp['matched']).toBe(24);
    const csv = await get(owner, `/loans/${loan['id']}/reference-schedules/${body['id']}/comparison/export`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.text.split('\n').length).toBeGreaterThan(24);
  });

  it('[TC-DEBT-AMORT-016] una fila cuyo total no suma sus componentes rechaza la carga', async () => {
    const loan = await activeLoan();
    const text = await syntheticTable(loan, (rows) => {
      rows[2] = ['3', rows[2]![1]!, '1898,73', '443,29', '2342,20'];
    });
    const reply = await upload(loan, text);
    problem(reply, 422, 'LOAN_REFERENCE_INVALID');
    expect(reply.text).toContain('TOTAL_MISMATCH');
    expect((await get(owner, `/loans/${loan['id']}/reference-schedules`)).body['data']).toEqual([]);
  });

  it('[TC-DEBT-AMORT-018] [TC-DEBT-AMORT-020] la comparación detecta un centavo en la última cuota y queda explicada con texto, autor y fecha', async () => {
    const loan = await activeLoan();
    const text = await syntheticTable(loan, (rows) => {
      const last = rows[23]!;
      rows[23] = [last[0]!, last[1]!, last[2]!, '22,22', '2341,89'];
    });
    const body = checked('uploadLoanReferenceSchedule', 201, await upload(loan, text));
    const cmp = body['comparison'];
    expect(cmp['status']).toBe('UNEXPLAINED');
    expect(cmp['matched']).toBe(23);
    expect(cmp['firstDifferenceNo']).toBe(24);
    const explain = await post(
      owner,
      `/loans/${loan['id']}/reference-schedules/${body['id']}/comparison/explanation`,
      {
        explanation: 'el banco trunca el interés de la última cuota',
      },
    );
    const explained = checked('explainLoanScheduleComparison', 200, explain);
    expect(explained['status']).toBe('EXPLAINED');
    expect(explained['explanation']).toBe('el banco trunca el interés de la última cuota');
    expect(explained['explainedBy']).toBe(owner.id);
    expect(explained['scheduleVersion']).toBe(1);
  });

  it('[TC-DEBT-AMORT-019] el reporte sugiere la convención que explica las diferencias sin cambiar el préstamo', async () => {
    const loan = await activeLoan({ principal: bob('50000.00') });
    const act365 = await activeLoan({ dayCount: 'ACT_365' });
    const text = await syntheticTable(act365);
    const body = checked('uploadLoanReferenceSchedule', 201, await upload(loan, text));
    expect(body['comparison']['status']).toBe('UNEXPLAINED');
    const suggestions = body['comparison']['suggestions'] as any[];
    const act = suggestions.find((s) => s.kind === 'CONVENTION' && s.dayCount === 'ACT_365');
    expect(act?.betterThanCurrent, JSON.stringify(suggestions)).toBe(true);
    expect((await detail(loan['id']))['dayCount']).toBe('D30_360');
  });
});

describe('gasto y comprometido del préstamo (reportes)', () => {
  it('[TC-DEBT-LOAN-019] [TC-DEBT-LOAN-022] el interés es gasto del mes y el principal no; la cuota suma al comprometido y a los próximos pagos sin doble conteo', async () => {
    const solo = await user(`kc-loans-solo-${randomUUID()}`);
    const bankSolo = await account(solo, 'Banco BOB', 'BOB', '1000.00');
    setToday('2026-10-15');
    const draft = await post(solo, '/loans', { ...vehicular({ disbursementAccountId: bankSolo }) });
    expect(draft.status, draft.text).toBe(201);
    checked('disburseLoan', 200, await post(solo, `/loans/${draft.body['id']}/disburse`, {}));
    setToday('2026-11-02');
    await ok(post(solo, '/periods', { through: '2026-12-31' }), 200);
    const committed = await get(solo, '/recurring/committed');
    expect(committed.status, committed.text).toBe(200);
    expect(contract.validateResponse('getCommittedAmount', 200, committed.body)).toEqual([]);
    expect(JSON.stringify(committed.body['byCurrency'])).toContain('2342.02');
    const upcoming = await get(solo, '/reports/upcoming-payments?days=30');
    expect(upcoming.status, upcoming.text).toBe(200);
    expect(upcoming.text).toContain('2342.02');
    expect(upcoming.text).toContain('Préstamo vehicular');
    // Pago de la cuota 1: el comprometido baja y el gasto de noviembre es solo el interés.
    setToday('2026-11-15');
    checked(
      'recordLoanPayment',
      201,
      await post(solo, `/loans/${draft.body['id']}/payments`, {
        amount: bob('2342.02'),
        businessDate: '2026-11-15',
        accountId: bankSolo,
      }),
    );
    const after = await get(solo, '/recurring/committed');
    expect(JSON.stringify(after.body['byCurrency'])).not.toContain('2342.02');
    const report = await get(solo, '/reports/summary?month=2026-11');
    expect(report.status, report.text).toBe(200);
    expect(report.text).toContain('479.17');
    expect(report.text).not.toContain('1862.85');
  });
});
