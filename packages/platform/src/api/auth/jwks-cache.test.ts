import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiProblem } from '../errors/problem.js';
import { JwtVerifier, type JwtVerifierOptions } from './jwt-verifier.js';

const ISSUER = 'https://idp.test/realms/pfos';
const JWKS_URL = new URL('https://idp.test/realms/pfos/protocol/openid-connect/certs');
const T0 = Date.parse('2026-10-04T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let k1: Key;
let k2: Key;
let jwk1: JWK;
let jwk2: JWK;

beforeAll(async () => {
  const a = await generateKeyPair('RS256', { extractable: true });
  const b = await generateKeyPair('RS256', { extractable: true });
  k1 = a.privateKey;
  k2 = b.privateKey;
  jwk1 = { ...(await exportJWK(a.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  jwk2 = { ...(await exportJWK(b.publicKey)), kid: 'k2', alg: 'RS256', use: 'sig' };
});

/** IdP falso: JWKS servido, caída simulada y conteo de peticiones. */
class FakeIdp {
  keys: JWK[] = [];
  down = false;
  calls = 0;
  readonly fetchJwks = (): Promise<unknown> => {
    this.calls += 1;
    if (this.down) return Promise.reject(new Error('connect ECONNREFUSED'));
    return Promise.resolve({ keys: this.keys });
  };
}

function setup(extra: Partial<JwtVerifierOptions> = {}) {
  const idp = new FakeIdp();
  idp.keys = [jwk1];
  let now = T0;
  const events: { kind: string; info: unknown }[] = [];
  const verifier = new JwtVerifier({
    issuer: ISSUER,
    audience: 'finance-api',
    requiredScope: 'pfos.api',
    jwks: JWKS_URL,
    fetchJwks: idp.fetchJwks,
    now: () => new Date(now),
    jwksObserver: {
      refreshFailed: (info) => events.push({ kind: 'refreshFailed', info }),
      fallbackUsed: (info) => events.push({ kind: 'fallbackUsed', info }),
    },
    ...extra,
  });
  return {
    idp,
    verifier,
    events,
    advance: (ms: number) => {
      now += ms;
    },
    token: (kid: string, key: Key, claims: Record<string, unknown> = {}) => {
      const sec = Math.floor(now / 1000);
      return new SignJWT({
        iss: ISSUER,
        aud: 'finance-api',
        sub: 'kc-owner',
        iat: sec - 10,
        exp: sec + 300,
        typ: 'Bearer',
        scope: 'openid pfos.api',
        ...claims,
      })
        .setProtectedHeader({ alg: 'RS256', kid })
        .sign(key);
    },
  };
}

async function rejected(p: Promise<unknown>): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiProblem);
  expect((err as ApiProblem).code).toBe('UNAUTHENTICATED');
}

describe('[TC-IDENTITY-AUTH-001] JWKS remoto: caché 10 min, refetch limitado y fallback 24 h', () => {
  it('cachea el JWKS 10 min: varias verificaciones, una sola petición; pasado el plazo lo renueva', async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) await s.verifier.verify(await s.token('k1', k1));
    expect(s.idp.calls).toBe(1);
    s.advance(10 * MIN + 1);
    await s.verifier.verify(await s.token('k1', k1));
    expect(s.idp.calls).toBe(2);
  });

  it('kid desconocido (rotación) ⇒ un refetch; un kid inexistente no martilla al IdP (cooldown 30 s)', async () => {
    const s = setup();
    await s.verifier.verify(await s.token('k1', k1));
    s.idp.keys = [jwk1, jwk2];
    s.advance(31_000);
    await expect(s.verifier.verify(await s.token('k2', k2))).resolves.toBeDefined();
    expect(s.idp.calls).toBe(2);
    for (let i = 0; i < 5; i++) await rejected(s.verifier.verify(await s.token('nope', k2)));
    expect(s.idp.calls).toBe(2);
    s.advance(31_000);
    await rejected(s.verifier.verify(await s.token('nope', k2)));
    expect(s.idp.calls).toBe(3);
  });

  it('IdP caído: sigue aceptando con el último JWKS conocido hasta 24 h, con log y métrica', async () => {
    const s = setup();
    await s.verifier.verify(await s.token('k1', k1));
    s.idp.down = true;
    s.advance(10 * MIN + 1);
    await expect(s.verifier.verify(await s.token('k1', k1))).resolves.toBeDefined();
    expect(s.events.map((e) => e.kind)).toEqual(['refreshFailed', 'fallbackUsed']);
    expect(s.events[0]!.info).toMatchObject({ error: 'connect ECONNREFUSED', fallbackAgeMs: 10 * MIN + 1 });
    // Sin reintentos dentro del cooldown aunque el JWKS siga vencido.
    await s.verifier.verify(await s.token('k1', k1));
    expect(s.idp.calls).toBe(2);
    s.advance(23 * HOUR);
    await expect(s.verifier.verify(await s.token('k1', k1))).resolves.toBeDefined();
    // Un token firmado con otra clave sigue rechazándose durante el fallback.
    await rejected(s.verifier.verify(await s.token('k2', k2)));
  });

  it('pasadas 24 h sin respuesta del IdP los tokens se rechazan; al volver el IdP se recupera', async () => {
    const s = setup();
    await s.verifier.verify(await s.token('k1', k1));
    s.idp.down = true;
    s.advance(24 * HOUR + 1);
    await rejected(s.verifier.verify(await s.token('k1', k1)));
    expect(s.events.at(-1)).toEqual({
      kind: 'refreshFailed',
      info: { error: 'connect ECONNREFUSED', fallbackAgeMs: null },
    });
    s.idp.down = false;
    s.advance(31_000);
    await expect(s.verifier.verify(await s.token('k1', k1))).resolves.toBeDefined();
  });

  it('sin JWKS previo y con el IdP caído ⇒ 401; respuesta que no es un JWKS cuenta como caída', async () => {
    const s = setup();
    s.idp.down = true;
    await rejected(s.verifier.verify(await s.token('k1', k1)));
    const bad = setup({ fetchJwks: () => Promise.resolve({ nokeys: true }) });
    await rejected(bad.verifier.verify(await bad.token('k1', k1)));
    expect(bad.events.map((e) => e.kind)).toEqual(['refreshFailed']);
  });

  it('peticiones concurrentes con el JWKS vencido comparten una sola obtención (single-flight)', async () => {
    const s = setup();
    const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => s.token('k1', k1)));
    await Promise.all(tokens.map((t) => s.verifier.verify(t)));
    expect(s.idp.calls).toBe(1);
  });
});

describe('[TC-IDENTITY-AUTH-001] perfil por IdP (OIDC_PROFILE)', () => {
  it('keycloak: azp debe estar en la lista de clientes autorizados', async () => {
    const s = setup({ jwks: { keys: [] } });
    const v = new JwtVerifier({
      issuer: ISSUER,
      audience: 'finance-api',
      requiredScope: 'pfos.api',
      authorizedParties: ['pfos-web'],
      jwks: { keys: [jwk1] },
      now: () => new Date(T0),
    });
    await expect(v.verify(await s.token('k1', k1, { azp: 'pfos-web' }))).resolves.toBeDefined();
    await rejected(v.verify(await s.token('k1', k1, { azp: 'otro-cliente' })));
    await rejected(v.verify(await s.token('k1', k1)));
  });

  it('cognito: sin aud; exige token_use=access, client_id autorizado y el scope del resource server', async () => {
    const s = setup({ jwks: { keys: [] } });
    const v = new JwtVerifier({
      issuer: ISSUER,
      audience: 'finance-api',
      profile: 'cognito',
      requiredScope: 'pfos.api',
      authorizedParties: ['cognito-client'],
      jwks: { keys: [jwk1] },
      now: () => new Date(T0),
    });
    const cognito = { aud: undefined, typ: undefined, token_use: 'access', client_id: 'cognito-client' };
    const ok = await v.verify(await s.token('k1', k1, { ...cognito, username: 'owner' }));
    expect(ok).toMatchObject({ subject: 'kc-owner', displayName: 'owner' });
    await rejected(v.verify(await s.token('k1', k1, { ...cognito, token_use: 'id' })));
    await rejected(v.verify(await s.token('k1', k1, { ...cognito, client_id: 'otro' })));
    await rejected(v.verify(await s.token('k1', k1, { ...cognito, scope: 'openid' })));
    // Sin lista de clientes, el perfil cognito rechaza todo (no hay `aud` que acote el token).
    const open = new JwtVerifier({
      issuer: ISSUER,
      audience: 'finance-api',
      profile: 'cognito',
      jwks: { keys: [jwk1] },
      now: () => new Date(T0),
    });
    await rejected(open.verify(await s.token('k1', k1, cognito)));
  });
});
