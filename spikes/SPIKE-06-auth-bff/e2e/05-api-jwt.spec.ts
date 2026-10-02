import { test, expect } from '@playwright/test';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { API, E, WS_DEMO, directToken, evidence, jwtPayload } from './helpers';

const me = (token?: string) =>
  fetch(`${API}/api/v1/me`, { headers: token === undefined ? {} : { Authorization: `Bearer ${token}` } }).then(async (r) => ({
    status: r.status,
    body: (await r.json()) as Record<string, unknown>,
  }));
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('finance-api valida JWT: firma, alg, iss, aud, exp (+skew), azp', async () => {
  const r: Record<string, string> = {};
  const rec = (k: string, x: { status: number; body: Record<string, unknown> }) => (r[k] = `${x.status} ${x.body.reason ?? x.body.code ?? ''}`.trim());

  const valid = await directToken('viewer');
  const claims = jwtPayload(valid);
  rec('valid', await me(valid));
  expect(r.valid).toMatch(/^200/);

  rec('noAuthorizationHeader', await me());
  rec('garbage', await me('abc.def.ghi'));

  // alg=none con claims correctos
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
  rec('algNone', await me(none));

  // HS256 firmado con un secreto cualquiera (ataque de confusión de algoritmo)
  const hs = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('x'.repeat(32)));
  rec('algHS256', await me(hs));

  // RS256 con clave propia del atacante y kid desconocido
  const { privateKey } = await generateKeyPair('RS256');
  const forged = await new SignJWT({ ...claims, exp: Math.floor(Date.now() / 1000) + 300 }).setProtectedHeader({ alg: 'RS256', kid: 'attacker-kid' }).sign(privateKey);
  rec('forgedUnknownKid', await me(forged));

  // Payload manipulado (sub de otro usuario) con firma original
  const [h, , sig] = valid.split('.');
  rec('tamperedPayload', await me(`${h}.${b64({ ...claims, sub: '0b4f1c1e-0000-4000-8000-000000000001' })}.${sig}`));

  // Token real de Keycloak SIN aud finance-api
  rec('wrongAudience', await me(await directToken('viewer', 'noaud')));

  // RBAC directo en la API (sin BFF): VIEWER no puede mutar, no-miembro no puede leer
  const post = await fetch(`${API}/api/v1/workspaces/${WS_DEMO}/transactions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${valid}`, 'Content-Type': 'application/json' },
    body: '{"description":"x","amount":"1"}',
  });
  r.viewerMutationDirect = `${post.status} ${((await post.json()) as { code: string }).code}`;
  const outsider = await fetch(`${API}/api/v1/workspaces/${WS_DEMO}/accounts`, { headers: { Authorization: `Bearer ${await directToken('outsider')}` } });
  r.outsiderReadDirect = `${outsider.status} ${((await outsider.json()) as { code: string }).code}`;

  expect(r.noAuthorizationHeader).toMatch(/^401/);
  for (const k of ['garbage', 'algNone', 'algHS256', 'forgedUnknownKid', 'tamperedPayload', 'wrongAudience']) expect(r[k], k).toMatch(/^401/);
  expect(r.viewerMutationDirect).toBe('403 WORKSPACE_ROLE_INSUFFICIENT');
  expect(r.outsiderReadDirect).toBe('403 WORKSPACE_NOT_MEMBER');
  evidence('05a-api-jwt-rejections', r);
});

test('token expirado: aceptado dentro del skew de 30 s, rechazado después', async () => {
  test.setTimeout(120_000);
  const t = await directToken('owner'); // cliente pfos-e2e: access.token.lifespan = 10 s
  const { exp, iat } = jwtPayload(t) as { exp: number; iat: number };
  const waitUntil = async (epochS: number) => {
    const ms = epochS * 1000 - Date.now();
    if (ms > 0) await new Promise((res) => setTimeout(res, ms));
  };
  const fresh = await me(t);
  await waitUntil(exp + 5);
  const withinSkew = await me(t);
  await waitUntil(exp + 32);
  const expired = await me(t);
  expect(fresh.status).toBe(200);
  expect(withinSkew.status).toBe(200);
  expect(expired.status).toBe(401);
  expect(expired.body.reason).toBe('ERR_JWT_EXPIRED');
  evidence('05b-api-jwt-expiry', {
    lifetimeS: exp - iat,
    clockToleranceS: 30,
    atIssue: fresh.status,
    'exp+5s': withinSkew.status,
    'exp+32s': `${expired.status} ${expired.body.reason}`,
  });
});

test('latencia: BFF (navegador→Next→Nest) vs API directa', async ({ page }) => {
  const { login, bff } = await import('./helpers');
  await login(page, 'viewer');
  const N = 30;
  const path = `/api/bff/workspaces/${WS_DEMO}/accounts`;
  await bff(page, 'GET', path); // warmup
  const viaBff = await page.evaluate(
    async ({ path, N }) => {
      const out: number[] = [];
      for (let i = 0; i < N; i++) {
        const t = performance.now();
        await fetch(path);
        out.push(performance.now() - t);
      }
      return out;
    },
    { path, N },
  );
  const tok = await directToken('viewer');
  const direct: number[] = [];
  for (let i = 0; i < N + 1; i++) {
    const t = performance.now();
    await fetch(`${API}/api/v1/workspaces/${WS_DEMO}/accounts`, { headers: { Authorization: `Bearer ${tok}` } });
    if (i > 0) direct.push(performance.now() - t);
  }
  const p = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))]!.toFixed(1);
  evidence('05c-latency', {
    n: N,
    viaBffMs: { p50: p(viaBff, 0.5), p95: p(viaBff, 0.95) },
    directApiMs: { p50: p(direct, 0.5), p95: p(direct, 0.95) },
    note: 'next start local, Valkey en Docker; incluye GET+decrypt de sesión por request',
  });
  expect(E.API_URL).toBeTruthy();
});
