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

// Vista técnica de balance de comprobación por HTTP (openspec add-ledger-core 6.3, docs/31 D44): `getLedgerTrialBalance`
// con `x-required-role: VIEWER` del contrato, saldo de cada cuenta contable por moneda y total cero por moneda a la
// escala de la moneda, contra PostgreSQL real (Testcontainers) con RLS; un usuario ajeno al workspace no ve nada.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
// 2026-04-01T02:00Z = 2026-03-31 22:00 en La Paz: "hoy" del workspace es 2026-03-31.
const clock = new FixedClock(Instant.parse('2026-04-01T02:00:00Z'));
const contract = ApiContract.fromFile(resolveContractPath());
const apiLog = capturingLogger('finance-api', 'api');

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  body: Json;
}
interface Line {
  ledgerAccountId: string;
  code: string;
  nature: string;
  accountId: string | null;
  balance: { amount: string; currency: string };
}
interface CurrencyGroup {
  currency: string;
  lines: Line[];
  total: { amount: string; currency: string };
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;

async function call(method: string, path: string, token: string, body?: unknown): Promise<Reply> {
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
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
}

async function provision(sub: string) {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub,
    iat: now - 5,
    exp: now + 600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `${sub}@pfos.test`,
    email_verified: true,
    name: sub,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(signingKey);
  const me = await call('GET', '/api/v1/me', token);
  expect(me.status).toBe(200);
  return {
    token,
    id: me.body['id'] as string,
    ws: (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId,
  };
}
type User = Awaited<ReturnType<typeof provision>>;

const trial = (u: User, ws: string, query = '') =>
  call('GET', `/api/v1/workspaces/${ws}/ledger/trial-balance${query}`, u.token);

/** Líneas `[código legible, saldo]` de una moneda (las cuentas del usuario se muestran por su nombre). */
function linesOf(body: Json, currency: string, names: Map<string, string>): [string, string][] {
  const group = (body['currencies'] as CurrencyGroup[]).find((c) => c.currency === currency);
  return (group?.lines ?? [])
    .map((l): [string, string] => [
      l.accountId ? (names.get(l.accountId) ?? l.code) : l.code,
      `${l.balance.amount} ${l.balance.currency}`,
    ])
    .sort(([a], [b]) => a.localeCompare(b));
}

const totals = (body: Json) =>
  (body['currencies'] as CurrencyGroup[]).map((c) => [c.currency, `${c.total.amount} ${c.total.currency}`]);

let owner: User;
let viewer: User;
let outsider: User;
const names = new Map<string, string>();

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

  owner = await provision(`kc-trial-owner-${randomUUID()}`);
  viewer = await provision(`kc-trial-viewer-${randomUUID()}`);
  outsider = await provision(`kc-trial-outsider-${randomUUID()}`);
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'VIEWER', 'ACTIVE')`,
          [owner.ws, viewer.id],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  const W = `/api/v1/workspaces/${owner.ws}`;
  const created = async (path: string, body: unknown) => {
    const r = await call('POST', `${W}${path}`, owner.token, body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body['id'] as string;
  };
  const bankA = await created('/accounts', { name: 'Bank A', type: 'BANK', currency: 'BOB' });
  const wallet = await created('/accounts', {
    name: 'Wallet USDT',
    type: 'CRYPTO_WALLET',
    currency: 'USDT',
    openingBalance: { amount: { amount: '100.000000', currency: 'USDT' }, date: '2026-03-01' },
  });
  names.set(bankA, 'Bank A').set(wallet, 'Wallet USDT');
  // Conversión canónica: 100.000000 USDT → 685.00 BOB a cotizada 6.90 con fee de 5.00 BOB.
  await created('/conversions', {
    transactionDate: '2026-03-15',
    sourceAccountId: wallet,
    targetAccountId: bankA,
    sourceAmount: { amount: '100.000000', currency: 'USDT' },
    targetAmount: { amount: '685.00', currency: 'BOB' },
    quotedRate: { base: 'USDT', quote: 'BOB', value: '6.90' },
    fees: [{ type: 'PROVIDER', amount: { amount: '5.00', currency: 'BOB' } }],
    provider: { name: 'Binance P2P' },
    executedAt: '2026-03-15T18:00:00Z',
  });
});

afterAll(async () => {
  await runtime?.close();
});

describe('[TC-LEDGER-TRIAL-001] balance de comprobación por moneda (getLedgerTrialBalance, VIEWER)', () => {
  it('OWNER: saldo por cuenta contable y total cero por moneda a la escala de la moneda (contrato)', async () => {
    const r = await trial(owner, owner.ws, '?asOf=2026-03-31');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('getLedgerTrialBalance', 200, r.body)).toEqual([]);
    expect(r.body['asOf']).toBe('2026-03-31');
    expect(linesOf(r.body, 'BOB', names)).toEqual([
      ['Bank A', '685.00 BOB'],
      ['EQUITY:FX_TRADING:BOB', '-690.00 BOB'],
      ['EXPENSE:BOB', '5.00 BOB'],
    ]);
    expect(linesOf(r.body, 'USDT', names)).toEqual([
      ['EQUITY:FX_TRADING:USDT', '100.000000 USDT'],
      ['EQUITY:OPENING_BALANCE:USDT', '-100.000000 USDT'],
      ['Wallet USDT', '0.000000 USDT'],
    ]);
    expect(totals(r.body)).toEqual([
      ['BOB', '0.00 BOB'],
      ['USDT', '0.000000 USDT'],
    ]);
    // Naturaleza de cada línea y cuenta del usuario solo en las ASSET/LIABILITY.
    const bob = (r.body['currencies'] as CurrencyGroup[]).find((c) => c.currency === 'BOB')!;
    expect(bob.lines.map((l) => [l.code.split(':')[0], l.nature, l.accountId !== null]).sort()).toEqual([
      ['ASSET', 'ASSET', true],
      ['EQUITY', 'EQUITY', false],
      ['EXPENSE', 'EXPENSE', false],
    ]);
  });

  it('sin asOf el corte es hoy en la zona horaria del workspace; antes de los asientos no hay saldos', async () => {
    const today = await trial(owner, owner.ws);
    expect(today.status).toBe(200);
    expect(today.body['asOf']).toBe('2026-03-31');
    expect(totals(today.body)).toEqual([
      ['BOB', '0.00 BOB'],
      ['USDT', '0.000000 USDT'],
    ]);
    const before = await trial(owner, owner.ws, '?asOf=2026-02-28');
    expect(before.status).toBe(200);
    for (const group of before.body['currencies'] as CurrencyGroup[]) {
      expect(group.lines.every((l) => /^0(\.0+)?$/.test(l.balance.amount))).toBe(true);
    }
  });

  it('VIEWER obtiene el mismo balance (x-required-role VIEWER del contrato, docs/31 D44)', async () => {
    const asOwner = await trial(owner, owner.ws, '?asOf=2026-03-31');
    const asViewer = await trial(viewer, owner.ws, '?asOf=2026-03-31');
    expect(asViewer.status).toBe(200);
    expect(asViewer.body).toEqual(asOwner.body);
  });

  it('aislamiento: un usuario que no es miembro recibe 403 WORKSPACE_ACCESS_DENIED sin ninguna línea del ledger', async () => {
    const r = await trial(outsider, owner.ws, '?asOf=2026-03-31');
    expect([r.status, r.body['code']]).toEqual([403, 'WORKSPACE_ACCESS_DENIED']);
    // Igual que cualquier otra lectura del workspace.
    const accounts = await call('GET', `/api/v1/workspaces/${owner.ws}/accounts`, outsider.token);
    expect([r.status, r.body['code']]).toEqual([accounts.status, accounts.body['code']]);
    expect(JSON.stringify(r.body)).not.toContain('685.00');
    // Su propio workspace: vacío (RLS), nunca los asientos de W1.
    const own = await trial(outsider, outsider.ws, '?asOf=2026-03-31');
    expect(own.status).toBe(200);
    expect(own.body['currencies']).toEqual([]);
  });

  it('asOf inválido ⇒ 400 VALIDATION_FAILED', async () => {
    const r = await trial(owner, owner.ws, '?asOf=2026-13-01');
    expect([r.status, r.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  });
});
