import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { ApiContract } from '@pf/platform/api';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// AUDIT por HTTP (`GET /api/v1/workspaces/{id}/audit-log`, `POST /api/v1/me/session-events`) y la auditoría de las
// mutaciones de IDENTITY, contra PostgreSQL real con emisor JWT de prueba y reloj fijo (openspec add-audit-trail).
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
const clock = new FixedClock(Instant.parse('2026-03-15T12:00:00Z'));
let failAudit = false;

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
  expect(r.status).toBe(status);
  expect(r.headers.get('content-type')).toContain('application/problem+json');
  expect(r.body['code']).toBe(code);
};

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, personal: memberships[0]!.workspaceId };
}

const patchWorkspace = (u: { token: string }, ws: string, body: unknown, version: number, headers = {}) =>
  call('PATCH', `/api/v1/workspaces/${ws}`, {
    token: u.token,
    body,
    contentType: 'application/merge-patch+json',
    headers: { 'if-match': `"${version}"`, ...headers },
  });

/** Filas crudas de `audit.audit_log` de un workspace (como pf_app con contexto RLS). */
async function rawAudit(userId: string, workspaceId: string): Promise<Record<string, unknown>[]> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(
      app,
      { userId, workspaceId },
      async () =>
        (
          await app.query(
            'SELECT a.*, to_jsonb(a)::text AS dump FROM audit.audit_log a ORDER BY occurred_at, id',
          )
        ).rows,
    );
  } finally {
    await app.end();
  }
}

let cachedContract: ApiContract | undefined;
const contract = () => (cachedContract ??= ApiContract.fromFile(resolveContractPath()));
/** Respuesta 200 de `listAuditLog` válida contra el contrato (`AuditLogPage`). */
const expectAuditPage = (r: Reply) => {
  expect(r.status).toBe(200);
  expect(contract().validateResponse('listAuditLog', 200, r.body)).toEqual([]);
};

type Entry = {
  action: string;
  occurredAt: string;
  changes: { field: string; before: unknown; after: unknown }[];
};
const entries = (r: Reply) => r.body['data'] as Entry[];

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), capturingLogger('finance-api', 'api').logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      // Inyección de fallos para TC-AUDIT-ATOMIC-001: el adapter real, o un fallo a demanda.
      audit: (port) => ({
        append: async (entry) => {
          if (failAudit) throw new Error('audit store unavailable (fault injected)');
          await port.append(entry);
        },
      }),
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await runtime?.close();
});

describe('autorización de lectura del log (docs/31 D2, D28)', () => {
  let owner: Awaited<ReturnType<typeof user>>;
  let editor: Awaited<ReturnType<typeof user>>;
  let viewer: Awaited<ReturnType<typeof user>>;

  beforeAll(async () => {
    owner = await user(`kc-audit-owner-${randomUUID()}`);
    editor = await user(`kc-audit-editor-${randomUUID()}`);
    viewer = await user(`kc-audit-viewer-${randomUUID()}`);
    const app = await connect(deps.databaseUrl);
    try {
      await inTx(
        app,
        { userId: owner.id, workspaceId: owner.personal },
        async () => {
          for (const [u, role] of [
            [editor, 'EDITOR'],
            [viewer, 'VIEWER'],
          ] as const) {
            await app.query(
              `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
              [owner.personal, u.id, role],
            );
          }
        },
        true,
      );
    } finally {
      await app.end();
    }
  });

  it('[TC-AUDIT-ACCESS-001] OWNER y EDITOR leen el historial de la entidad; VIEWER recibe 403 INSUFFICIENT_ROLE sin registros', async () => {
    const path = `/api/v1/workspaces/${owner.personal}/audit-log?aggregateType=Workspace&aggregateId=${owner.personal}`;
    for (const u of [owner, editor]) {
      const r = await call('GET', path, { token: u.token });
      expect(r.status).toBe(200);
      expect(entries(r).map((e) => e.action)).toEqual([
        'identity.workspace.created',
        'identity.workspace.member_added',
      ]);
    }
    const denied = await call('GET', path, { token: viewer.token });
    expectProblem(denied, 403, 'INSUFFICIENT_ROLE');
    expect(denied.body).not.toHaveProperty('data');
    const op = contract()
      .operations()
      .find((o) => o.operationId === 'listAuditLog');
    expect(op?.requiredRole).toBe('EDITOR');
  });
});

describe('historial y búsqueda por HTTP', () => {
  let u: Awaited<ReturnType<typeof user>>;

  beforeAll(async () => {
    clock.set(Instant.parse('2026-03-15T14:00:00Z'));
    u = await user(`kc-audit-history-${randomUUID()}`);
    let v = 1;
    for (const name of ['Bank C', 'Bank C Sueldo', 'Bank C Archivada']) {
      clock.advance(60_000);
      const r = await patchWorkspace(u, u.personal, { name }, v);
      expect(r.status).toBe(200);
      v = Number(r.body['version']);
    }
  });

  it('[TC-AUDIT-HISTORY-001] cronológico ascendente con diff; limit=2 + cursor devuelve el resto; entidad sin registros → []', async () => {
    const base = `/api/v1/workspaces/${u.personal}/audit-log?aggregateType=Workspace&aggregateId=${u.personal}`;
    const all = await call('GET', base, { token: u.token });
    expectAuditPage(all);
    expect(entries(all).map((e) => e.action)).toEqual([
      'identity.workspace.created',
      'identity.workspace.member_added',
      'identity.workspace.settings_changed',
      'identity.workspace.settings_changed',
      'identity.workspace.settings_changed',
    ]);
    const renamed = entries(all)[3]!;
    expect(renamed.changes).toEqual([{ field: 'name', before: 'Bank C', after: 'Bank C Sueldo' }]);
    expect(renamed).toMatchObject({
      actor: { type: 'USER', userId: u.id, process: null },
      aggregateType: 'Workspace',
      aggregateVersion: 3,
      origin: 'api',
    });
    expect(renamed).not.toHaveProperty('clientIpHash');
    expect(renamed).not.toHaveProperty('idempotencyKey');

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: Reply = await call(
        'GET',
        `${base}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        {
          token: u.token,
        },
      );
      expect(r.status).toBe(200);
      seen.push(...entries(r).map((e) => e.occurredAt));
      cursor = (r.body['page'] as { nextCursor: string | null }).nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(entries(all).map((e) => e.occurredAt));

    const none = await call(
      'GET',
      `/api/v1/workspaces/${u.personal}/audit-log?aggregateType=Account&aggregateId=${randomUUID()}`,
      { token: u.token },
    );
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ data: [], page: { limit: 50, hasMore: false, nextCursor: null } });
    // Un cursor de otro filtro no vale.
    const first = await call('GET', `${base}&limit=1`, { token: u.token });
    const next = (first.body['page'] as { nextCursor: string }).nextCursor;
    expectProblem(
      await call('GET', `/api/v1/workspaces/${u.personal}/audit-log?cursor=${encodeURIComponent(next)}`, {
        token: u.token,
      }),
      400,
      'INVALID_CURSOR',
    );
  });

  it('[TC-AUDIT-RANGE-001] rango en la zona del workspace (La Paz), más reciente primero; rango invertido → INVALID_FILTER', async () => {
    const r = await call('GET', `/api/v1/workspaces/${u.personal}/audit-log?from=2026-03-15&to=2026-03-15`, {
      token: u.token,
    });
    expectAuditPage(r);
    const at = entries(r).map((e) => e.occurredAt);
    expect(at.length).toBeGreaterThan(0);
    expect([...at].sort().reverse()).toEqual(at);
    const empty = await call(
      'GET',
      `/api/v1/workspaces/${u.personal}/audit-log?from=2026-03-16&to=2026-03-16`,
      {
        token: u.token,
      },
    );
    expect(entries(empty)).toEqual([]);
    expectProblem(
      await call('GET', `/api/v1/workspaces/${u.personal}/audit-log?from=2026-03-16&to=2026-03-15`, {
        token: u.token,
      }),
      400,
      'INVALID_FILTER',
    );
    expectProblem(
      await call('GET', `/api/v1/workspaces/${u.personal}/audit-log?aggregateId=${u.personal}`, {
        token: u.token,
      }),
      400,
      'INVALID_FILTER',
    );
  });

  it('[TC-AUDIT-RANGE-001] 23:30 de La Paz del 15 (03:30Z del 16) cae en el día 15; los días 14 y 16 no', async () => {
    clock.set(Instant.parse('2026-03-13T12:00:00Z')); // la creación del workspace queda fuera del rango
    const w = await user(`kc-audit-range-${randomUUID()}`);
    let v = 1;
    for (const [at, name] of [
      ['2026-03-14T15:00:00Z', 'd14'],
      ['2026-03-16T03:30:00Z', 'd15'],
      ['2026-03-16T15:00:00Z', 'd16'],
    ] as const) {
      clock.set(Instant.parse(at));
      v = Number((await patchWorkspace(w, w.personal, { name }, v)).body['version']);
    }
    const r = await call(
      'GET',
      `/api/v1/workspaces/${w.personal}/audit-log?from=2026-03-15&to=2026-03-15&aggregateType=Workspace`,
      { token: w.token },
    );
    expect(entries(r).map((e) => [e.occurredAt, e.changes[0]?.after])).toEqual([
      ['2026-03-16T03:30:00.000Z', 'd15'],
    ]);
  });

  it('[TC-AUDIT-ISOLATION-001] desde otro workspace, la entidad ajena y una inexistente devuelven la misma lista vacía', async () => {
    const outsider = await user(`kc-audit-outsider-${randomUUID()}`);
    const foreign = await call(
      'GET',
      `/api/v1/workspaces/${outsider.personal}/audit-log?aggregateType=Workspace&aggregateId=${u.personal}`,
      { token: outsider.token },
    );
    const missing = await call(
      'GET',
      `/api/v1/workspaces/${outsider.personal}/audit-log?aggregateType=Workspace&aggregateId=${randomUUID()}`,
      { token: outsider.token },
    );
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual(missing.body);
    expect(entries(foreign)).toEqual([]);
    expectProblem(
      await call('GET', `/api/v1/workspaces/${u.personal}/audit-log`, { token: outsider.token }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
  });
});

describe('auditoría de las mutaciones de IDENTITY por HTTP', () => {
  it('[TC-AUDIT-CONTENT-001] origen ui (BFF), correlación = X-Request-Id, instante del reloj, user agent y HMAC de IP', async () => {
    clock.set(Instant.parse('2026-03-15T14:00:00Z'));
    const u = await user(`kc-audit-content-${randomUUID()}`);
    const requestId = '0190a000-0000-7000-8000-0000000000c1';
    const r = await patchWorkspace(u, u.personal, { timezone: 'UTC' }, 1, {
      'x-pfos-origin': 'ui',
      'x-request-id': requestId,
      'x-forwarded-for': '203.0.113.7',
      'user-agent': 'Mozilla/5.0 (PFOS api test)',
    });
    expect(r.status).toBe(200);
    const rows = await rawAudit(u.id, u.personal);
    const row = rows.find((x) => x['action'] === 'identity.workspace.settings_changed');
    expect(row).toMatchObject({
      actor_type: 'USER',
      actor_user_id: u.id,
      workspace_id: u.personal,
      aggregate_type: 'Workspace',
      aggregate_id: u.personal,
      aggregate_version: 2,
      origin: 'ui',
      correlation_id: requestId,
      request_id: requestId,
      user_agent: 'Mozilla/5.0 (PFOS api test)',
      changes: [{ field: 'timeZone', before: 'America/La_Paz', after: 'UTC' }],
    });
    expect((row?.['occurred_at'] as Date).toISOString()).toBe('2026-03-15T14:00:00.000Z');
    expect((row?.['client_ip_hash'] as Buffer).length).toBe(32);
    expect(String(row?.['dump'])).not.toContain('203.0.113.7');
  });

  it('[TC-AUDIT-ATOMIC-001] si la auditoría falla, el PATCH responde 500 INTERNAL_ERROR y nada persiste (ni evento)', async () => {
    const u = await user(`kc-audit-atomic-${randomUUID()}`);
    failAudit = true;
    try {
      expectProblem(await patchWorkspace(u, u.personal, { timezone: 'UTC' }, 1), 500, 'INTERNAL_ERROR');
    } finally {
      failAudit = false;
    }
    const ws = await call('GET', `/api/v1/workspaces/${u.personal}`, { token: u.token });
    expect(ws.body).toMatchObject({ timezone: 'America/La_Paz', version: 1 });
    const worker = await connect(deps.workerDatabaseUrl);
    try {
      const { rows } = await worker.query('SELECT event_type FROM platform.outbox WHERE workspace_id = $1', [
        u.personal,
      ]);
      expect(rows.map((x) => x['event_type'])).toEqual(['identity.WorkspaceCreated']);
    } finally {
      await worker.end();
    }
    expect((await rawAudit(u.id, u.personal)).map((x) => x['action'])).not.toContain(
      'identity.workspace.settings_changed',
    );
    // Sin fallo, el mismo comando confirma cambio + evento + auditoría.
    expect((await patchWorkspace(u, u.personal, { timezone: 'UTC' }, 1)).status).toBe(200);
    expect((await rawAudit(u.id, u.personal)).map((x) => x['action'])).toContain(
      'identity.workspace.settings_changed',
    );
  });

  it('crear un workspace por API audita su creación y la membresía OWNER; PATCH /me audita el perfil', async () => {
    const u = await user(`kc-audit-create-${randomUUID()}`);
    const created = await call('POST', '/api/v1/workspaces', {
      token: u.token,
      body: { name: 'Hogar', baseCurrency: 'BOB' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(created.status).toBe(201);
    const id = String(created.body['id']);
    const rows = await rawAudit(u.id, id);
    // Ambas filas comparten occurred_at (reloj fijo): el orden entre ellas no está definido.
    expect(rows.map((x) => x['action']).sort()).toEqual([
      'identity.workspace.created',
      'identity.workspace.member_added',
    ]);
    expect(rows.find((x) => x['action'] === 'identity.workspace.created')?.['idempotency_key']).toEqual(
      expect.any(String),
    );

    const me = await call('PATCH', '/api/v1/me', {
      token: u.token,
      body: { locale: 'en-US' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': '"1"' },
    });
    expect(me.status).toBe(200);
    const home = await rawAudit(u.id, u.personal);
    expect(home.find((x) => x['action'] === 'identity.user.preferences_changed')).toMatchObject({
      aggregate_type: 'User',
      aggregate_id: u.id,
      changes: [{ field: 'locale', before: 'es-BO', after: 'en-US' }],
    });
  });
});

describe('[TC-AUDIT-SESSION-001] inicio y cierre de sesión auditados sin tokens ni cookies', () => {
  it('POST /me/session-events STARTED/ENDED registra user, instante, HMAC de IP y user agent; nunca el token ni la cookie', async () => {
    const u = await user(`kc-audit-session-${randomUUID()}`);
    clock.set(Instant.parse('2026-03-15T12:00:00Z'));
    const headers = {
      'x-forwarded-for': '198.51.100.23',
      'user-agent': 'Mozilla/5.0 (PFOS session)',
      cookie: '__Host-pfos_sid=CANARY-TOKEN-123',
    };
    const started = await call('POST', '/api/v1/me/session-events', {
      token: u.token,
      body: { event: 'STARTED', workspaceId: u.personal },
      headers,
    });
    expect(started.status).toBe(204);
    clock.advance(30 * 60_000);
    expect(
      (
        await call('POST', '/api/v1/me/session-events', {
          token: u.token,
          body: { event: 'ENDED', workspaceId: null },
          headers,
        })
      ).status,
    ).toBe(204);
    expectProblem(
      await call('POST', '/api/v1/me/session-events', { token: u.token, body: { event: 'HACKED' } }),
      400,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await call('POST', '/api/v1/me/session-events', { body: { event: 'STARTED' } }),
      401,
      'UNAUTHENTICATED',
    );

    const rows = (await rawAudit(u.id, u.personal)).filter((x) =>
      String(x['action']).startsWith('identity.session.'),
    );
    expect(rows.map((x) => [x['action'], (x['occurred_at'] as Date).toISOString()])).toEqual([
      ['identity.session.started', '2026-03-15T12:00:00.000Z'],
      ['identity.session.ended', '2026-03-15T12:30:00.000Z'],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        actor_user_id: u.id,
        aggregate_type: 'User',
        user_agent: 'Mozilla/5.0 (PFOS session)',
      });
      expect((row['client_ip_hash'] as Buffer).length).toBe(32);
      const dump = String(row['dump']);
      for (const secret of [u.token, 'CANARY-TOKEN-123', 'pfos_sid', '198.51.100.23'])
        expect(dump).not.toContain(secret);
    }
  });
});
