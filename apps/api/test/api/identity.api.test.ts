import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// API de IDENTITY (`/api/v1/me`, `/api/v1/workspaces*`) contra PostgreSQL real, con un emisor JWT de prueba y
// JWKS local (sin Keycloak). Cada usuario se provisiona en su primer request autenticado.
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

async function tokenFor(sub: string, claims: Record<string, unknown> = {}): Promise<string> {
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
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(signingKey);
}

async function call(
  method: string,
  path: string,
  options: {
    token?: string | null;
    body?: unknown;
    headers?: Record<string, string>;
    contentType?: string;
  } = {},
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
  expect(r.status).toBe(status);
  expect(r.headers.get('content-type')).toContain('application/problem+json');
  expect(r.body['code']).toBe(code);
};

/** Usuario de prueba: se provisiona (usuario + workspace personal) con su primer GET /me. */
async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string; role: string }[];
  return { token, id: me.body['id'] as string, personal: memberships[0]!.workspaceId };
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), capturingLogger('finance-api', 'api').logger, {
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await runtime?.close();
});

describe('[TC-IDENTITY-AUTH-001] las solicitudes sin un token de acceso válido se rechazan con 401', () => {
  it('sin token, expirado fuera del skew, audiencia incorrecta o sin scope: 401 UNAUTHENTICATED sin detalle', async () => {
    const now = Math.floor(Date.now() / 1000);
    const invalid = [
      null,
      await tokenFor('kc-auth', { exp: now - 31 }),
      await tokenFor('kc-auth', { aud: 'otra-api' }),
      await tokenFor('kc-auth', { scope: 'openid' }),
      await tokenFor('kc-auth', { typ: 'ID' }),
    ];
    for (const token of invalid) {
      const r = await call('GET', '/api/v1/workspaces', { token });
      expectProblem(r, 401, 'UNAUTHENTICATED');
      expect(r.body['detail']).toBe('a valid access token is required');
      expect(r.body).not.toHaveProperty('data');
    }
  });

  it('token expirado dentro del skew y token válido: 200; /health/live sin token no responde 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(
      (await call('GET', '/api/v1/workspaces', { token: await tokenFor('kc-auth', { exp: now - 20 }) }))
        .status,
    ).toBe(200);
    expect((await call('GET', '/api/v1/workspaces', { token: await tokenFor('kc-auth') })).status).toBe(200);
    expect((await call('GET', '/health/live')).status).not.toBe(401);
  });
});

describe('[TC-IDENTITY-AUTH-006] GET /me devuelve perfil, locale, zona horaria y membresías activas', () => {
  it('200 con el perfil, la membresía OWNER del workspace personal y ETag', async () => {
    const u = await user(`kc-me-${randomUUID()}`);
    const r = await call('GET', '/api/v1/me', { token: u.token });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: u.id, locale: 'es-BO', timezone: 'America/La_Paz' });
    expect(r.body['memberships']).toEqual([
      { workspaceId: u.personal, workspaceName: expect.any(String), role: 'OWNER' },
    ]);
    expect(r.headers.get('etag')).toBe(`"${String(r.body['version'])}"`);
  });
});

describe('[TC-IDENTITY-AUTH-008] el usuario actualiza locale y zona horaria; una zona inválida se rechaza', () => {
  it('PATCH /me con If-Match: 200 y ETag nuevo; zona inválida 422 INVALID_TIMEZONE; versión vieja 412', async () => {
    const u = await user(`kc-prefs-${randomUUID()}`);
    const v = Number((await call('GET', '/api/v1/me', { token: u.token })).body['version']);
    const ok = await call('PATCH', '/api/v1/me', {
      token: u.token,
      body: { locale: 'en-US', timezone: 'America/Sao_Paulo' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': `"${v}"` },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ locale: 'en-US', timezone: 'America/Sao_Paulo', version: v + 1 });
    expect(ok.headers.get('etag')).toBe(`"${v + 1}"`);
    const bad = await call('PATCH', '/api/v1/me', {
      token: u.token,
      body: { timezone: 'Bolivia/LaPaz' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': `"${v + 1}"` },
    });
    expectProblem(bad, 422, 'INVALID_TIMEZONE');
    const stale = await call('PATCH', '/api/v1/me', {
      token: u.token,
      body: { locale: 'es-BO' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': `"${v}"` },
    });
    expectProblem(stale, 412, 'PRECONDITION_FAILED');
    const after = await call('GET', '/api/v1/me', { token: u.token });
    expect(after.body).toMatchObject({ timezone: 'America/Sao_Paulo', version: v + 1 });
  });
});

describe('[TC-IDENTITY-WORKSPACE-007] un usuario crea un workspace adicional y queda como su OWNER', () => {
  it('201 con Location y ETag; la repetición con la misma Idempotency-Key se reproduce; aparece una sola vez', async () => {
    const u = await user(`kc-create-${randomUUID()}`);
    const key = randomUUID();
    const send = () =>
      call('POST', '/api/v1/workspaces', {
        token: u.token,
        body: { name: 'Hogar', baseCurrency: 'BOB' },
        headers: { 'idempotency-key': key },
      });
    const first = await send();
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      name: 'Hogar',
      timezone: 'America/La_Paz',
      locale: 'es-BO',
      role: 'OWNER',
    });
    expect(first.headers.get('location')).toBe(`/api/v1/workspaces/${String(first.body['id'])}`);
    expect(first.headers.get('etag')).toBe('"1"');
    const again = await send();
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(again.body['id']).toBe(first.body['id']);
    const list = await call('GET', '/api/v1/workspaces', { token: u.token });
    const names = (list.body['data'] as { name: string }[]).map((w) => w.name);
    expect(names.filter((n) => n === 'Hogar')).toHaveLength(1);
  });
});

describe('[TC-IDENTITY-WORKSPACE-005] la reserva mínima de liquidez respeta la escala de su moneda', () => {
  it('1500.00 BOB se acepta (string); 1500.005 BOB → 422 AMOUNT_SCALE_EXCEEDED sin cambios; null la elimina', async () => {
    const u = await user(`kc-reserve-${randomUUID()}`);
    const path = `/api/v1/workspaces/${u.personal}`;
    const patch = (body: unknown, version: number) =>
      call('PATCH', path, {
        token: u.token,
        body,
        contentType: 'application/merge-patch+json',
        headers: { 'if-match': `"${version}"` },
      });
    let version = Number((await call('GET', path, { token: u.token })).body['version']);
    const ok = await patch({ minimumLiquidityReserve: { amount: '1500.00', currency: 'BOB' } }, version);
    expect(ok.status).toBe(200);
    expect(ok.body['minimumLiquidityReserve']).toEqual({ amount: '1500.00', currency: 'BOB' });
    version = Number(ok.body['version']);
    expectProblem(
      await patch({ minimumLiquidityReserve: { amount: '1500.005', currency: 'BOB' } }, version),
      422,
      'AMOUNT_SCALE_EXCEEDED',
    );
    expect((await call('GET', path, { token: u.token })).body['minimumLiquidityReserve']).toEqual({
      amount: '1500.00',
      currency: 'BOB',
    });
    const cleared = await patch({ minimumLiquidityReserve: null }, version);
    expect(cleared.status).toBe(200);
    expect(cleared.body['minimumLiquidityReserve']).toBeNull();
  });
});

describe('autorización por workspace (docs/31 D2)', () => {
  let owner: Awaited<ReturnType<typeof user>>;
  let editor: Awaited<ReturnType<typeof user>>;
  let outsider: Awaited<ReturnType<typeof user>>;

  beforeAll(async () => {
    owner = await user(`kc-owner-${randomUUID()}`);
    editor = await user(`kc-editor-${randomUUID()}`);
    outsider = await user(`kc-outsider-${randomUUID()}`);
    const app = await connect(deps.databaseUrl);
    try {
      await inTx(
        app,
        { userId: owner.id, workspaceId: owner.personal },
        () =>
          app.query(
            `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'EDITOR', 'ACTIVE')`,
            [owner.personal, editor.id],
          ),
        true,
      );
    } finally {
      await app.end();
    }
  });

  it('[TC-IDENTITY-MEMBERSHIP-001] un no miembro recibe 403 WORKSPACE_ACCESS_DENIED sin datos ni mutaciones', async () => {
    const path = `/api/v1/workspaces/${owner.personal}`;
    const before = await call('GET', path, { token: owner.token });
    const read = await call('GET', path, { token: outsider.token });
    expectProblem(read, 403, 'WORKSPACE_ACCESS_DENIED');
    expect(read.body).not.toHaveProperty('name');
    const write = await call('PATCH', path, {
      token: outsider.token,
      body: { name: 'Hackeado' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': `"${String(before.body['version'])}"` },
    });
    expectProblem(write, 403, 'WORKSPACE_ACCESS_DENIED');
    const after = await call('GET', path, { token: owner.token });
    expect(after.body).toMatchObject({ name: before.body['name'], version: before.body['version'] });
    const list = await call('GET', '/api/v1/workspaces', { token: outsider.token });
    expect((list.body['data'] as { id: string }[]).map((w) => w.id)).toEqual([outsider.personal]);
  });

  it('[TC-SECURITY-RBAC-003] EDITOR lee el workspace pero no puede modificar su configuración (403 INSUFFICIENT_ROLE)', async () => {
    const path = `/api/v1/workspaces/${owner.personal}`;
    const read = await call('GET', path, { token: editor.token });
    expect(read.status).toBe(200);
    expect(read.body['role']).toBe('EDITOR');
    const denied = await call('PATCH', path, {
      token: editor.token,
      body: { name: 'Otro nombre' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': `"${String(read.body['version'])}"` },
    });
    expectProblem(denied, 403, 'INSUFFICIENT_ROLE');
    expect((await call('GET', path, { token: owner.token })).body['name']).toBe(read.body['name']);
  });

  it('[TC-IDENTITY-WORKSPACE-006] el listado muestra solo las membresías activas del usuario', async () => {
    const list = await call('GET', '/api/v1/workspaces', { token: editor.token });
    expect(list.status).toBe(200);
    const data = list.body['data'] as { id: string; role: string }[];
    expect(data.map((w) => [w.id, w.role]).sort()).toEqual(
      [
        [editor.personal, 'OWNER'],
        [owner.personal, 'EDITOR'],
      ].sort(),
    );
    expect(list.body['page']).toMatchObject({ hasMore: false, nextCursor: null });
  });
});

describe('[TC-IDENTITY-AUTH-008] el nombre visible y las preferencias se actualizan y la provisión no los pisa', () => {
  it('PATCH /me con displayName y preferences (merge-patch) persiste tras nuevos requests; nombre vacío 400', async () => {
    const u = await user(`kc-name-${randomUUID()}`);
    const v = Number((await call('GET', '/api/v1/me', { token: u.token })).body['version']);
    const ok = await call('PATCH', '/api/v1/me', {
      token: u.token,
      body: { displayName: 'Ana Demo', preferences: { theme: 'dark', density: 'compact' } },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': `"${v}"` },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ displayName: 'Ana Demo', version: v + 1 });
    const merged = await call('PATCH', '/api/v1/me', {
      token: u.token,
      body: { preferences: { density: null } },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': `"${v + 1}"` },
    });
    expect(merged.status).toBe(200);
    // Cada request vuelve a ejecutar la provisión con el nombre del IdP: no debe pisar el elegido por el usuario.
    const again = await call('GET', '/api/v1/me', { token: u.token });
    expect(again.body).toMatchObject({ displayName: 'Ana Demo', version: v + 2 });
    const app = await connect(deps.databaseUrl);
    try {
      const prefs = await inTx(app, { userId: u.id, workspaceId: null }, () =>
        app.query<{ preferences: Record<string, unknown> }>(
          'SELECT preferences FROM iam."user" WHERE id = $1',
          [u.id],
        ),
      );
      expect(prefs.rows[0]?.preferences).toEqual({ theme: 'dark' });
    } finally {
      await app.end();
    }
    const empty = await call('PATCH', '/api/v1/me', {
      token: u.token,
      body: { displayName: '   ' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': `"${v + 2}"` },
    });
    expectProblem(empty, 400, 'VALIDATION_FAILED');
  });

  it('si el nombre cambia en el IdP, la provisión lo actualiza', async () => {
    const sub = `kc-rename-${randomUUID()}`;
    await user(sub);
    const renamed = await call('GET', '/api/v1/me', {
      token: await tokenFor(sub, { name: 'Nombre Nuevo IdP' }),
    });
    expect(renamed.body['displayName']).toBe('Nombre Nuevo IdP');
  });
});

describe('[TC-IDENTITY-WORKSPACE-006] el listado de workspaces se pagina por cursor', () => {
  it('limit=1 recorre todas las membresías sin repetir; un cursor manipulado o de otro usuario da 400 INVALID_CURSOR', async () => {
    const u = await user(`kc-page-${randomUUID()}`);
    for (const name of ['Hogar', 'Negocio']) {
      const r = await call('POST', '/api/v1/workspaces', {
        token: u.token,
        body: { name, baseCurrency: 'BOB' },
        headers: { 'idempotency-key': randomUUID() },
      });
      expect(r.status).toBe(201);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = cursor ? `?limit=1&cursor=${encodeURIComponent(cursor)}` : '?limit=1';
      const r = await call('GET', `/api/v1/workspaces${q}`, { token: u.token });
      expect(r.status).toBe(200);
      const data = r.body['data'] as { id: string }[];
      const page = r.body['page'] as { limit: number; hasMore: boolean; nextCursor: string | null };
      expect(data).toHaveLength(1);
      expect(page.limit).toBe(1);
      seen.push(data[0]!.id);
      cursor = page.nextCursor;
      expect(page.hasMore).toBe(cursor !== null);
      pages += 1;
    } while (cursor && pages < 10);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    expect([...seen].sort()).toEqual(seen);

    const first = await call('GET', '/api/v1/workspaces?limit=1', { token: u.token });
    const next = (first.body['page'] as { nextCursor: string }).nextCursor;
    const other = await user(`kc-page-other-${randomUUID()}`);
    expectProblem(
      await call('GET', `/api/v1/workspaces?cursor=${encodeURIComponent(next)}`, { token: other.token }),
      400,
      'INVALID_CURSOR',
    );
    expectProblem(
      await call('GET', `/api/v1/workspaces?cursor=${encodeURIComponent(`${next}x`)}`, { token: u.token }),
      400,
      'INVALID_CURSOR',
    );
  });
});
