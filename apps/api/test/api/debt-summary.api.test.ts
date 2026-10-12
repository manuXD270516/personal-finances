/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
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

// Resumen de deudas por HTTP contra PostgreSQL real (openspec add-debt-summary, tarea 5.2): total adeudado por moneda y
// consolidado con un préstamo desembolsado y pagado (interés imputado), una cuenta de tarjeta y un pasivo manual,
// coherencia con los pasivos del patrimonio neto (INV-031), interés del año atribuido al préstamo, fecha libre de deudas
// y próximo vencimiento, pago de la tarjeta reflejado de inmediato, estados sin pasivos, VIEWER, `ETag` y aislamiento
// entre workspaces (TC-DEBT-SUMMARY-001, -002, -003, -004, -006, -007, -008 y -010). Las respuestas se validan contra el
// OpenAPI.
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
const ok = async (r: Promise<Reply>, status = 201) => {
  const reply = await r;
  expect(reply.status, `${reply.text} ${apiErrors()}`).toBe(status);
  return reply.body;
};
const checked = (operation: string, status: number, r: Reply) => {
  expect(r.status, r.text).toBe(status);
  expect(contract.validateResponse(operation, status, r.body), r.text).toEqual([]);
  return r.body;
};

const bob = (amount: string) => ({ amount, currency: 'BOB' });
const text = (m: { amount: string; currency: string }) => `${m.amount} ${m.currency}`;
const setToday = (date: string) => clock.set(Instant.parse(`${date}T16:00:00Z`));
let owner: User;
let viewer: User;
let other: User;
let empty: User;
let noFx: User;
let bank: string;
let visa: string;
let family: string;
let loan: Record<string, any>;
let seq = 0;

async function account(
  u: User,
  name: string,
  type: string,
  opening: string,
  currency = 'BOB',
): Promise<string> {
  const r = await ok(
    post(u, '/accounts', {
      name,
      type,
      currency,
      openingBalance: { amount: { amount: opening, currency }, date: '2026-09-01' },
    }),
  );
  return r['id'] as string;
}

const vehicular = (disbursementAccountId: string) => ({
  name: 'Préstamo auto',
  account: { create: { name: `Préstamo auto ${(seq += 1)}` } },
  disbursementAccountId,
  principal: bob('50000.00'),
  annualRate: '0.115',
  termInstallments: 24,
  disbursementDate: '2026-10-15',
  firstDueDate: '2026-11-15',
});

const summary = async (u: User) => checked('getDebtSummary', 200, await get(u, '/debts/summary'));

beforeAll(async () => {
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
  owner = await user(`kc-debts-owner-${randomUUID()}`);
  viewer = await user(`kc-debts-viewer-${randomUUID()}`);
  other = await user(`kc-debts-other-${randomUUID()}`);
  empty = await user(`kc-debts-empty-${randomUUID()}`);
  noFx = await user(`kc-debts-nofx-${randomUUID()}`);
  await join(owner, viewer, 'VIEWER');
  setToday('2026-10-15');
  bank = await account(owner, 'Banco BOB', 'BANK', '10000.00');
  family = await account(owner, 'Deuda familiar', 'MANUAL_LIABILITY', '2000.00');
  visa = await account(owner, 'Visa Oro', 'CREDIT_CARD', '1120.50');
  // Préstamo desembolsado el 2026-10-15 y su cuota 1 pagada el 2026-11-15 (interés 479.17, capital 1862.85).
  const draft = await ok(post(owner, '/loans', vehicular(bank)));
  loan = checked('disburseLoan', 200, await post(owner, `/loans/${draft['id']}/disburse`, {}));
  setToday('2026-11-16');
  const paid = await post(owner, `/loans/${loan['id']}/payments`, {
    amount: bob('2342.02'),
    businessDate: '2026-11-15',
    accountId: bank,
  });
  checked('recordLoanPayment', 201, paid);
  // Workspace sin tasa de valoración USD/BOB: un pasivo en dólares no se convierte 1:1.
  await account(noFx, 'Deuda BOB', 'MANUAL_LIABILITY', '500.00');
  await account(noFx, 'Deuda USD', 'MANUAL_LIABILITY', '100.00', 'USD');
  // Otro workspace con un préstamo de 9000.00 BOB (aislamiento).
  const otherBank = await account(other, 'Banco B', 'BANK', '100.00');
  const otherDraft = await ok(
    post(other, '/loans', {
      ...vehicular(otherBank),
      principal: bob('9000.00'),
      name: 'Préstamo B',
      disbursementDate: '2026-11-01',
      firstDueDate: '2026-12-01',
    }),
  );
  checked('disburseLoan', 200, await post(other, `/loans/${otherDraft['id']}/disburse`, {}));
}, 240_000);

afterAll(async () => {
  await runtime?.close();
});

describe('resumen de deudas (add-debt-summary)', () => {
  it('[TC-DEBT-SUMMARY-001] total por moneda y consolidado: préstamo 48137.15 + tarjeta 1120.50 + pasivo manual 2000.00 = 51257.65 BOB, agrupado por tipo', async () => {
    const s = await summary(owner);
    expect(s['status']).toBe('ACTIVE');
    expect(s['baseCurrency']).toBe('BOB');
    expect(s['totals'].byCurrency.map(text)).toEqual(['51257.65 BOB']);
    expect(s['totals'].consolidated).toMatchObject({ complete: true, unconverted: [] });
    expect(text(s['totals'].consolidated.amount)).toBe('51257.65 BOB');
    expect(s['debts'].map((d: any) => [d.kind, d.name])).toEqual([
      ['LOAN', 'Préstamo auto'],
      ['OTHER_LIABILITY', 'Deuda familiar'],
      ['OTHER_LIABILITY', 'Visa Oro'],
    ]);
  });

  it('[TC-DEBT-SUMMARY-001] el total adeudado coincide con los pasivos del patrimonio neto', async () => {
    const s = await summary(owner);
    const report = await get(owner, '/reports/summary');
    expect(report.status, report.text).toBe(200);
    expect(text(report.body['netWorth'].liabilities)).toBe(text(s['totals'].consolidated.amount));
  });

  it('[TC-DEBT-SUMMARY-004] interés del año: 479.17 BOB imputados al préstamo, otros intereses vacío y atribución consistente', async () => {
    const s = await summary(owner);
    expect(s['interestYtd'].from).toBe('2026-01-01');
    expect(s['interestYtd'].to).toBe('2026-11-16');
    expect(s['interestYtd'].byCurrency.map(text)).toEqual(['479.17 BOB']);
    expect(text(s['interestYtd'].consolidated.amount)).toBe('479.17 BOB');
    expect(s['interestYtd'].attribution.map((a: any) => [a.kind, a.name, a.byCurrency.map(text)])).toEqual([
      ['LOAN', 'Préstamo auto', ['479.17 BOB']],
      ['OTHER', null, []],
    ]);
    expect(s['interestYtd'].attributionConsistent).toBe(true);
  });

  it('[TC-DEBT-SUMMARY-006] fecha libre de deudas: la de la última cuota del préstamo, sin contar los pasivos manuales ni la tarjeta sin perfil', async () => {
    const s = await summary(owner);
    const list = await get(owner, `/loans/${loan['id']}/installments`);
    const rows = list.body['data'] as { n: number; dueDate: string }[];
    const last = rows.find((r) => r.n === 24)!;
    expect(s['debtFree'].date).toBe(last.dueDate);
    expect(s['debtFree'].excluded.map((e: any) => e.name).sort()).toEqual(['Deuda familiar', 'Visa Oro']);
    expect(s['debts'][0].estimatedPayoffDate).toBe(last.dueDate);
  });

  it('[TC-DEBT-SUMMARY-007] próximo vencimiento: la cuota 2 del préstamo con su monto; los pasivos sin cronograma no aparecen', async () => {
    const s = await summary(owner);
    expect(s['upcomingDues']).toHaveLength(1);
    expect(s['upcomingDues'][0]).toMatchObject({
      kind: 'LOAN',
      name: 'Préstamo auto',
      dueDate: '2026-12-15',
      estimated: false,
      overdueDays: 0,
      minimum: null,
    });
    expect(text(s['upcomingDues'][0].amount)).toBe('2342.02 BOB');
  });

  it('[TC-DEBT-SUMMARY-008] un VIEWER consulta el resumen y el préstamo del otro workspace no entra en el total', async () => {
    const asViewer = await summary({ ...viewer, ws: owner.ws });
    expect(text(asViewer['totals'].consolidated.amount)).toBe('51257.65 BOB');
    const theirs = await summary(other);
    expect(theirs['totals'].byCurrency.map(text)).toEqual(['9000.00 BOB']);
    expect(JSON.stringify(asViewer)).not.toContain('Préstamo B');
    // Un recurso de otro workspace bajo mi ruta no existe para mí.
    const cross = await call('GET', `/api/v1/workspaces/${other.ws}/debts/summary`, { token: owner.token });
    expect([403, 404]).toContain(cross.status);
  });

  it('[TC-DEBT-SUMMARY-002] sin tasa USD/BOB el consolidado es 500.00 BOB incompleto con 100.00 USD sin convertir (nunca 1:1)', async () => {
    const s = await summary(noFx);
    expect(s['totals'].byCurrency.map(text)).toEqual(['500.00 BOB', '100.00 USD']);
    expect(text(s['totals'].consolidated.amount)).toBe('500.00 BOB');
    expect(s['totals'].consolidated.complete).toBe(false);
    expect(s['totals'].consolidated.unconverted.map(text)).toEqual(['100.00 USD']);
  });

  it('[TC-DEBT-SUMMARY-001] el resumen incluye la marca de ETag débil y responde 304 con If-None-Match', async () => {
    const first = await get(owner, '/debts/summary');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\//);
    const again = await call('GET', `${W(owner)}/debts/summary`, {
      token: owner.token,
      headers: { 'if-none-match': etag! },
    });
    expect(again.status).toBe(304);
  });

  it('[TC-DEBT-SUMMARY-010] un workspace sin cuentas de pasivo responde NO_LIABILITIES sin montos', async () => {
    const s = await summary(empty);
    expect(s['status']).toBe('NO_LIABILITIES');
    expect(s['debts']).toEqual([]);
    expect(s['totals'].byCurrency).toEqual([]);
    expect(s['upcomingDues']).toEqual([]);
    expect(s['debtFree'].date).toBeNull();
  });

  it('[TC-DEBT-SUMMARY-003] pagar la tarjeta con una transferencia se refleja de inmediato: la tarjeta deja de listarse', async () => {
    const r = await post(owner, '/transfers', {
      transactionDate: '2026-11-16',
      fromAccountId: bank,
      toAccountId: visa,
      amount: bob('1120.50'),
    });
    expect(r.status, `${r.text} ${apiErrors()}`).toBe(201);
    const s = await summary(owner);
    expect(s['totals'].byCurrency.map(text)).toEqual(['50137.15 BOB']);
    expect(s['debts'].map((d: any) => d.name)).toEqual(['Préstamo auto', 'Deuda familiar']);
  });

  it('[TC-DEBT-SUMMARY-003] saldar el pasivo manual lo quita del total y de las deudas no estimables', async () => {
    const fam = await post(owner, '/transfers', {
      transactionDate: '2026-11-16',
      fromAccountId: bank,
      toAccountId: family,
      amount: bob('2000.00'),
    });
    expect(fam.status, fam.text).toBe(201);
    const s = await summary(owner);
    expect(s['status']).toBe('ACTIVE');
    expect(s['totals'].byCurrency.map(text)).toEqual(['48137.15 BOB']);
    expect(s['debts'].map((d: any) => d.name)).toEqual(['Préstamo auto']);
    expect(s['debtFree'].excluded).toEqual([]);
    expect(s['debtFree'].date).toBe(s['debts'][0].estimatedPayoffDate);
  });
});
