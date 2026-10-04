import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// VIEWER lee pero no modifica datos financieros (openspec add-workspace-identity 7.2, TC-SECURITY-RBAC-001) por HTTP
// con datos reales: el guard global de autorización (x-required-role del contrato) rechaza cada mutación antes de
// escribir nada.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  body: Json;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const clock = new FixedClock(Instant.parse('2026-03-15T14:00:00Z'));

async function call(
  method: string,
  path: string,
  options: { token: string; body?: unknown; headers?: Record<string, string>; contentType?: string },
): Promise<Reply> {
  const headers: Record<string, string> = { authorization: `Bearer ${options.token}`, ...options.headers };
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
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
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  return {
    token,
    id: me.body['id'] as string,
    ws: (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId,
  };
}

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
});

afterAll(async () => {
  await runtime?.close();
});

describe('[TC-SECURITY-RBAC-001] VIEWER puede leer pero no puede modificar datos financieros', () => {
  it('GETs 200; gasto, transferencia, edición y categoría ⇒ 403 INSUFFICIENT_ROLE sin escribir nada', async () => {
    const owner = await provision(`kc-rbac1-owner-${randomUUID()}`);
    const viewer = await provision(`kc-rbac1-viewer-${randomUUID()}`);
    const w1 = owner.ws;
    const app = await connect(deps.databaseUrl);
    const counts = async (c: Client) => {
      const n = async (sql: string) => (await c.query<{ n: number }>(sql, [w1])).rows[0]!.n;
      return {
        transactions: await n('SELECT count(*)::int AS n FROM txn.transaction WHERE workspace_id = $1'),
        entries: await n('SELECT count(*)::int AS n FROM ledger.journal_entry WHERE workspace_id = $1'),
        categories: await n('SELECT count(*)::int AS n FROM classification.category WHERE workspace_id = $1'),
        audit: await n('SELECT count(*)::int AS n FROM audit.audit_log WHERE workspace_id = $1'),
      };
    };
    try {
      await inTx(
        app,
        { userId: owner.id, workspaceId: w1 },
        () =>
          app.query(
            `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'VIEWER', 'ACTIVE')`,
            [w1, viewer.id],
          ),
        true,
      );
      const W = `/api/v1/workspaces/${w1}`;
      const post = (path: string, body: unknown, token = owner.token) =>
        call('POST', `${W}${path}`, { token, body, headers: { 'idempotency-key': randomUUID() } });
      const bankA = (
        await post('/accounts', {
          name: 'Bank A',
          type: 'BANK',
          currency: 'BOB',
          openingBalance: { amount: { amount: '1000.00', currency: 'BOB' }, date: '2026-03-01' },
        })
      ).body['id'] as string;
      const bankB = (await post('/accounts', { name: 'Bank B', type: 'SAVINGS', currency: 'BOB' })).body[
        'id'
      ] as string;
      const t1 = await post('/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-03-10',
        accountId: bankA,
        amount: { amount: '30.00', currency: 'BOB' },
      });
      expect(t1.status).toBe(201);
      const groups = (await call('GET', `${W}/category-groups?limit=200`, { token: viewer.token })).body[
        'data'
      ] as { id: string; kind: string }[];

      for (const path of ['/accounts', '/transactions']) {
        expect((await call('GET', `${W}${path}`, { token: viewer.token })).status).toBe(200);
      }
      const before = await inTx(app, { userId: owner.id, workspaceId: w1 }, () => counts(app));
      const denied = [
        await post(
          '/transactions',
          {
            kind: 'EXPENSE',
            transactionDate: '2026-03-15',
            accountId: bankA,
            amount: { amount: '75.00', currency: 'BOB' },
          },
          viewer.token,
        ),
        await post(
          '/transfers',
          {
            transactionDate: '2026-03-15',
            fromAccountId: bankA,
            toAccountId: bankB,
            amount: { amount: '10.00', currency: 'BOB' },
          },
          viewer.token,
        ),
        await call('PATCH', `${W}/transactions/${String(t1.body['id'])}`, {
          token: viewer.token,
          body: { description: 'cambio' },
          contentType: 'application/merge-patch+json',
          headers: { 'if-match': `"${String(t1.body['version'])}"` },
        }),
        await post(
          '/categories',
          { groupId: groups.find((g) => g.kind === 'EXPENSE')!.id, name: 'No permitida' },
          viewer.token,
        ),
      ];
      expect(denied.map((r) => [r.status, r.body['code']])).toEqual(
        denied.map(() => [403, 'INSUFFICIENT_ROLE']),
      );
      expect(await inTx(app, { userId: owner.id, workspaceId: w1 }, () => counts(app))).toEqual(before);
    } finally {
      await app.end();
    }
  });
});
