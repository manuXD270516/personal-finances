import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Cuota de operaciones costosas (openspec fix-phase-2-gaps; docs/10 §10): 10 por minuto por usuario y workspace, sobre
// la edición masiva (no su vista previa). La reproducción idempotente no la consume. Reloj fijo: la ventana no se mueve.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const COSTLY = 10;
const clock = new FixedClock(Instant.parse('2026-11-03T15:00:00Z'));

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  headers: Headers;
  body: Json;
}
type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;

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
  token: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const h: Record<string, string> = { authorization: `Bearer ${token}`, ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: h,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as Json) : {} };
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(
      baseEnv(deps, {
        RATE_LIMIT_READS_PER_MIN: '100000',
        RATE_LIMIT_WRITES_PER_MIN: '100000',
        RATE_LIMIT_COSTLY_PER_MIN: String(COSTLY),
      }),
    ),
    capturingLogger('finance-api', 'api').logger,
    {
      clock,
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');
}, 120_000);

afterAll(async () => {
  await runtime?.close();
});

describe('Cuota de operaciones costosas (platform/api-conventions)', () => {
  it('[TC-PLATFORM-API-021] 10 ediciones masivas pasan, la 11 ⇒ 429 RATE_LIMITED con Retry-After sin modificar nada; la vista previa y los replays no consumen cuota', async () => {
    const token = await tokenFor(`kc-costly-${randomUUID()}`);
    const me = await call('GET', '/api/v1/me', token);
    const ws = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
    const W = `/api/v1/workspaces/${ws}`;
    const acc = await call(
      'POST',
      `${W}/accounts`,
      token,
      {
        name: 'Bank A',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: { amount: '1000.00', currency: 'BOB' }, date: '2026-02-28' },
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    const created = await call(
      'POST',
      `${W}/transactions`,
      token,
      {
        kind: 'EXPENSE',
        transactionDate: '2026-03-10',
        accountId: acc.body['id'],
        amount: { amount: '10.00', currency: 'BOB' },
        description: 'Café',
      },
      { 'idempotency-key': randomUUID() },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const txId = created.body['id'] as string;
    let version = created.body['version'] as number;

    const bulk = (v: number, key: string, notes: string) =>
      call(
        'POST',
        `${W}/transactions/bulk-edit`,
        token,
        {
          items: [{ id: txId, version: v }],
          changes: { notes },
        },
        { 'idempotency-key': key },
      );

    // La vista previa no es costosa: 15 > 10 no la limitan.
    for (let i = 0; i < COSTLY + 5; i += 1) {
      const preview = await call('POST', `${W}/transactions/bulk-edit/preview`, token, {
        selection: { items: [{ id: txId }] },
        changes: { notes: 'previa' },
      });
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    }

    const firstKey = randomUUID();
    let firstReply: Reply | undefined;
    for (let i = 0; i < COSTLY; i += 1) {
      const key = i === 0 ? firstKey : randomUUID();
      const r = await bulk(version, key, `edición ${i}`);
      expect(r.status, `edición ${i + 1}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.headers.get('ratelimit-policy')).toBe(`"costly";q=${COSTLY};w=60`);
      if (i === 0) firstReply = r;
      version = (r.body['data'] as { version: number }[])[0]!.version;
    }

    const limited = await bulk(version, randomUUID(), 'edición 11');
    expect(limited.status).toBe(429);
    expect(limited.body['code']).toBe('RATE_LIMITED');
    expect(limited.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
    const tx = await call('GET', `${W}/transactions/${txId}`, token);
    expect(tx.body['notes']).toBe(`edición ${COSTLY - 1}`);
    expect(tx.body['version']).toBe(version);

    // Repetir la edición 1 con su misma clave reproduce la respuesta y no consume cuota (ya agotada).
    const replay = await bulk(1, firstKey, 'edición 0');
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body).toEqual(firstReply!.body);
  });
});
