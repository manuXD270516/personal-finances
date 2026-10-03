import { createHmac } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiProblem } from '../errors/problem.js';
import { JwtVerifier } from './jwt-verifier.js';

const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const NOW = new Date('2026-10-02T12:00:00Z');
const nowSec = Math.floor(NOW.getTime() / 1000);

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let rsa: Key;
let ec: Key;
let unknown: Key;
let rsaPublicJwk: JWK;
let verifier: JwtVerifier;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

async function token(
  overrides: Record<string, unknown> = {},
  opts: { key?: Key; kid?: string; alg?: string } = {},
): Promise<string> {
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'kc-owner',
    iat: nowSec - 60,
    exp: nowSec + 300,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: 'owner@pfos.test',
    ...overrides,
  })
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'rsa-1', typ: 'JWT' })
    .sign(opts.key ?? rsa);
}

async function expectUnauthenticated(t: string | undefined): Promise<void> {
  const err = await verifier.verify(t).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiProblem);
  expect((err as ApiProblem).code).toBe('UNAUTHENTICATED');
  // Sin detalle de la validación que falló.
  expect((err as ApiProblem).message).toBe('a valid access token is required');
}

beforeAll(async () => {
  const rsaPair = await generateKeyPair('RS256', { extractable: true });
  rsa = rsaPair.privateKey;
  const ecPair = await generateKeyPair('ES256', { extractable: true });
  ec = ecPair.privateKey;
  ({ privateKey: unknown } = await generateKeyPair('RS256'));
  rsaPublicJwk = { ...(await exportJWK(rsaPair.publicKey)), kid: 'rsa-1', alg: 'RS256', use: 'sig' };
  const ecJwk = { ...(await exportJWK(ecPair.publicKey)), kid: 'ec-1', alg: 'ES256', use: 'sig' };
  verifier = new JwtVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    requiredScope: 'pfos.api',
    clockSkewSeconds: 30,
    jwks: { keys: [rsaPublicJwk, ecJwk] },
    now: () => NOW,
  });
});

describe('[TC-IDENTITY-AUTH-001] los tokens de acceso inválidos se rechazan con UNAUTHENTICATED', () => {
  it('acepta un token válido RS256 y ES256 y expone iss/sub/email', async () => {
    const v = await verifier.verify(await token());
    expect(v).toMatchObject({ issuer: ISSUER, subject: 'kc-owner', email: 'owner@pfos.test' });
    const e = await verifier.verify(await token({}, { key: ec, kid: 'ec-1', alg: 'ES256' }));
    expect(e.subject).toBe('kc-owner');
  });

  it('acepta un token expirado hace 20 s (dentro del skew de 30 s)', async () => {
    await expect(verifier.verify(await token({ exp: nowSec - 20 }))).resolves.toBeDefined();
  });

  it('rechaza: sin token, expirado hace 31 s, nbf futuro, audiencia o emisor incorrectos', async () => {
    await expectUnauthenticated(undefined);
    await expectUnauthenticated(await token({ exp: nowSec - 31 }));
    await expectUnauthenticated(await token({ nbf: nowSec + 31 }));
    await expectUnauthenticated(await token({ aud: 'otra-api' }));
    await expectUnauthenticated(await token({ iss: 'https://evil.test/realms/pfos' }));
  });

  it('rechaza: clave desconocida (kid inexistente o firma con otra clave)', async () => {
    await expectUnauthenticated(await token({}, { key: unknown, kid: 'no-existe' }));
    await expectUnauthenticated(await token({}, { key: unknown, kid: 'rsa-1' }));
  });

  it('rechaza: alg none y HS256 con la clave pública como secreto', async () => {
    const payload = { iss: ISSUER, aud: AUDIENCE, sub: 'kc-owner', iat: nowSec, exp: nowSec + 300 };
    await expectUnauthenticated(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`);
    const header = b64({ alg: 'HS256', kid: 'rsa-1', typ: 'JWT' });
    const body = b64(payload);
    const sig = createHmac('sha256', JSON.stringify(rsaPublicJwk))
      .update(`${header}.${body}`)
      .digest('base64url');
    await expectUnauthenticated(`${header}.${body}.${sig}`);
  });

  it('rechaza: id token (typ ID), token sin scope pfos.api y payload manipulado', async () => {
    await expectUnauthenticated(await token({ typ: 'ID' }));
    await expectUnauthenticated(await token({ scope: 'openid profile' }));
    const [h, , s] = (await token()).split('.');
    await expectUnauthenticated(
      `${h}.${b64({ iss: ISSUER, aud: AUDIENCE, sub: 'otro', exp: nowSec + 9 })}.${s}`,
    );
  });

  it('extrae el bearer solo de una cabecera Authorization bien formada', () => {
    expect(JwtVerifier.bearer('Bearer a.b.c')).toBe('a.b.c');
    expect(JwtVerifier.bearer('Basic abc')).toBeUndefined();
    expect(JwtVerifier.bearer(undefined)).toBeUndefined();
  });
});
