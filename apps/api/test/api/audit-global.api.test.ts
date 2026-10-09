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

// Vista global del log de auditoría (openspec add-global-audit-view): filtros combinables, agrupación por operación,
// exportación CSV solo OWNER, auditoría de fallos de autorización y vista de eventos de seguridad, por HTTP contra
// PostgreSQL real (RLS, índices, cursores firmados) con emisor JWT de prueba y reloj controlado.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

interface Reply {
  status: number;
  headers: Headers;
  text: string;
  body: Record<string, unknown>;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const clock = new FixedClock(Instant.parse('2026-03-15T12:00:00Z'));
let breakDenials = false;

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
    headers['content-type'] = 'application/json';
    headers['idempotency-key'] = randomUUID();
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  // Sin descartar el BOM UTF-8 (`res.text()` lo quita): el CSV debe empezar con él.
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // CSV u otro cuerpo no JSON.
  }
  return { status: res.status, headers: res.headers, text, body };
}

const expectProblem = (r: Reply, status: number, code: string) => {
  expect(r.status).toBe(status);
  expect(r.headers.get('content-type')).toContain('application/problem+json');
  expect(r.body['code']).toBe(code);
};

type Member = { token: string; id: string; personal: string };
async function user(sub: string): Promise<Member> {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, personal: memberships[0]!.workspaceId };
}

/** Un workspace con OWNER, EDITOR, VIEWER y un usuario ajeno. */
async function team() {
  const owner = await user(`kc-gaudit-owner-${randomUUID()}`);
  const editor = await user(`kc-gaudit-editor-${randomUUID()}`);
  const viewer = await user(`kc-gaudit-viewer-${randomUUID()}`);
  const outsider = await user(`kc-gaudit-outsider-${randomUUID()}`);
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
  return { owner, editor, viewer, outsider, ws: owner.personal };
}

interface SeedRow {
  at: string;
  actor: string;
  action: string;
  aggregateType: string;
  aggregateId: string;
  correlationId?: string;
  origin?: string;
  changes?: unknown[];
}

/** Siembra registros de auditoría (como pf_app con el contexto RLS del workspace; el INSERT sí está permitido). */
async function seed(owner: Member, ws: string, rows: readonly SeedRow[]): Promise<void> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: ws },
      async () => {
        for (const r of rows) {
          await app.query(
            `INSERT INTO audit.audit_log (id, occurred_at, workspace_id, actor_type, actor_user_id, action,
               aggregate_type, aggregate_id, changes, origin, correlation_id)
             VALUES ($1, $2, $3, 'USER', $4, $5, $6, $7, $8::jsonb, $9, $10)`,
            [
              randomUUID(),
              r.at,
              ws,
              r.actor,
              r.action,
              r.aggregateType,
              r.aggregateId,
              JSON.stringify(r.changes ?? []),
              r.origin ?? 'ui',
              r.correlationId ?? randomUUID(),
            ],
          );
        }
      },
      true,
    );
  } finally {
    await app.end();
  }
}

/** Filas crudas de `audit.audit_log` de un workspace (como pf_app con contexto RLS). */
async function rawAudit(owner: Member, ws: string): Promise<Record<string, unknown>[]> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(
      app,
      { userId: owner.id, workspaceId: ws },
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

type Entry = {
  id: string;
  action: string;
  aggregateId: string;
  correlationId: string;
  occurredAt: string;
  actor: { userId: string | null };
  changes: { field: string; before: unknown; after: unknown }[];
};
type Page = { data: Entry[]; page: { nextCursor?: string | null; hasMore?: boolean } };
const page = (r: Reply) => r.body as unknown as Page;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(baseEnv(deps, { RATE_LIMIT_READS_PER_MIN: '100000', RATE_LIMIT_WRITES_PER_MIN: '100000' })),
    capturingLogger('finance-api', 'api').logger,
    {
      clock,
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
        // Un registrador de fallos de autorización roto: el rechazo debe seguir siendo un 403.
        denials: (port) => ({
          record: async (input) => {
            if (breakDenials) throw new Error('denial recorder down (fault injected)');
            await port.record(input);
          },
        }),
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await runtime?.close();
});

const U1 = randomUUID();
const U2 = randomUUID();
const tx = () => randomUUID();

describe('[TC-AUDIT-GLOBAL-001] la consulta global combina filtros por actor, entidad y rango', () => {
  it('actor U1, transacciones y marzo: solo sus 3 registros, del más reciente al más antiguo, con cursor estable', async () => {
    const t = await team();
    const [a, b, c, d, e] = [tx(), tx(), tx(), tx(), tx()];
    const txRow = (at: string, actor: string, id: string): SeedRow => ({
      at,
      actor,
      action: 'transactions.transaction.updated',
      aggregateType: 'Transaction',
      aggregateId: id,
      changes: [{ field: 'description', before: 'x', after: 'y' }],
    });
    await seed(t.owner, t.ws, [
      txRow('2026-03-03T15:00:00Z', U1, a),
      txRow('2026-03-04T15:00:00Z', U2, b),
      txRow('2026-03-05T15:00:00Z', U1, c),
      {
        at: '2026-03-06T15:00:00Z',
        actor: U1,
        action: 'accounts.account.archived',
        aggregateType: 'Account',
        aggregateId: randomUUID(),
      },
      txRow('2026-03-07T15:00:00Z', U2, d),
      txRow('2026-03-08T15:00:00Z', U1, e),
      txRow('2026-04-08T15:00:00Z', U1, tx()), // fuera de marzo
    ]);
    const q = `actorUserId=${U1}&aggregateType=Transaction&from=2026-03-01&to=2026-03-31`;
    const path = `/api/v1/workspaces/${t.ws}/audit-log?${q}`;
    const all = await call('GET', path, { token: t.owner.token });
    expect(all.status).toBe(200);
    expect(contract().validateResponse('listAuditLog', 200, all.body)).toEqual([]);
    expect(page(all).data.map((x) => x.aggregateId)).toEqual([e, c, a]);

    // Cursor estable: de 2 en 2 se obtiene la misma secuencia, sin repetir ni omitir.
    const first = await call('GET', `${path}&limit=2`, { token: t.owner.token });
    expect(page(first).data.map((x) => x.aggregateId)).toEqual([e, c]);
    const cursor = page(first).page.nextCursor!;
    expect(cursor).toBeTruthy();
    const second = await call('GET', `${path}&limit=2&cursor=${encodeURIComponent(cursor)}`, {
      token: t.owner.token,
    });
    expect(page(second).data.map((x) => x.aggregateId)).toEqual([a]);
    // Un cursor de otra consulta (otros filtros) se rechaza.
    const reused = await call(
      'GET',
      `/api/v1/workspaces/${t.ws}/audit-log?actorUserId=${U2}&limit=2&cursor=${encodeURIComponent(cursor)}`,
      { token: t.owner.token },
    );
    expectProblem(reused, 400, 'INVALID_CURSOR');
  });

  it('EDITOR también consulta; combinar acción, origen y rango; filtros inválidos son 400; rango > 366 días sin entidad es 400', async () => {
    const t = await team();
    await seed(t.owner, t.ws, [
      {
        at: '2026-03-03T15:00:00Z',
        actor: U1,
        action: 'transactions.transaction.voided',
        aggregateType: 'Transaction',
        aggregateId: tx(),
        origin: 'api',
      },
      {
        at: '2026-03-04T15:00:00Z',
        actor: U1,
        action: 'transactions.transaction.created',
        aggregateType: 'Transaction',
        aggregateId: tx(),
      },
    ]);
    const base = `/api/v1/workspaces/${t.ws}/audit-log`;
    const byAction = await call(
      'GET',
      `${base}?action=${encodeURIComponent('transactions.transaction.voided,accounts.account.opened')}&origin=api`,
      { token: t.editor.token },
    );
    expect(byAction.status).toBe(200);
    expect(page(byAction).data.map((x) => x.action)).toEqual(['transactions.transaction.voided']);
    expect(page(await call('GET', `${base}?origin=import`, { token: t.owner.token })).data).toEqual([]);
    expectProblem(
      await call('GET', `${base}?actorUserId=nope`, { token: t.owner.token }),
      400,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await call('GET', `${base}?category=OTHER`, { token: t.owner.token }),
      400,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await call('GET', `${base}?from=2025-01-01&to=2026-03-31`, { token: t.owner.token }),
      400,
      'VALIDATION_FAILED',
    );
    const corr = randomUUID();
    expect(
      (
        await call('GET', `${base}?from=2024-01-01&to=2026-03-31&correlationId=${corr}`, {
          token: t.owner.token,
        })
      ).status,
    ).toBe(200);
  });

  it('aislamiento: otro workspace no devuelve registros de este (RLS); un ajeno no accede', async () => {
    const t = await team();
    const other = await team();
    await seed(t.owner, t.ws, [
      {
        at: '2026-03-03T15:00:00Z',
        actor: U1,
        action: 'transactions.transaction.created',
        aggregateType: 'Transaction',
        aggregateId: tx(),
      },
    ]);
    const own = await call('GET', `/api/v1/workspaces/${other.ws}/audit-log?actorUserId=${U1}`, {
      token: other.owner.token,
    });
    expect(page(own).data).toEqual([]);
    const cross = await call('GET', `/api/v1/workspaces/${t.ws}/audit-log`, { token: other.owner.token });
    expectProblem(cross, 403, 'WORKSPACE_ACCESS_DENIED');
  });
});

describe('[TC-AUDIT-GLOBAL-002] un VIEWER no accede al log de auditoría global', () => {
  it('403 INSUFFICIENT_ROLE sin registros', async () => {
    const t = await team();
    const r = await call('GET', `/api/v1/workspaces/${t.ws}/audit-log?category=SECURITY`, {
      token: t.viewer.token,
    });
    expectProblem(r, 403, 'INSUFFICIENT_ROLE');
    expect(r.body).not.toHaveProperty('data');
  });
});

describe('[TC-AUDIT-GLOBAL-003] el OWNER exporta el log a CSV con zona horaria y celdas neutralizadas', () => {
  it('CSV con el instante en La Paz, la descripción neutralizada y la exportación auditada; EDITOR 403', async () => {
    const t = await team();
    const target = tx();
    await seed(t.owner, t.ws, [
      {
        at: '2026-03-16T03:30:00Z',
        actor: U1,
        action: 'transactions.transaction.updated',
        aggregateType: 'Transaction',
        aggregateId: target,
        changes: [{ field: 'description', before: '=SUM(A1)', after: 'Compra' }],
      },
      {
        at: '2026-03-20T15:00:00Z',
        actor: U1,
        action: 'transactions.transaction.created',
        aggregateType: 'Transaction',
        aggregateId: tx(),
      },
    ]);
    const path = `/api/v1/workspaces/${t.ws}/audit-log/export?format=csv&actorUserId=${U1}&from=2026-03-01&to=2026-03-31`;
    const r = await call('GET', path, { token: t.owner.token });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
    expect(r.headers.get('content-disposition')).toBe(
      `attachment; filename="audit-${t.ws}-2026-03-01-2026-03-31.csv"`,
    );
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.text.startsWith('﻿')).toBe(true);
    const lines = r.text.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3); // encabezado + una fila por registro del rango
    expect(r.text).toContain('2026-03-15T23:30:00-04:00');
    expect(r.text).toContain("description: '=SUM(A1) → Compra");

    // La exportación queda auditada con el actor y los filtros.
    const exported = (await rawAudit(t.owner, t.ws)).filter((x) => x['action'] === 'audit.log.exported');
    expect(exported).toHaveLength(1);
    expect(exported[0]?.['actor_user_id']).toBe(t.owner.id);
    const changes = exported[0]?.['changes'] as { field: string; after: unknown }[];
    expect(changes).toEqual(
      expect.arrayContaining([
        { field: 'rowCount', before: null, after: 2 },
        { field: 'actorUserId', before: null, after: U1 },
        { field: 'from', before: null, after: '2026-03-01' },
        { field: 'to', before: null, after: '2026-03-31' },
      ]),
    );

    expectProblem(await call('GET', path, { token: t.editor.token }), 403, 'INSUFFICIENT_ROLE');
    expectProblem(await call('GET', path, { token: t.viewer.token }), 403, 'INSUFFICIENT_ROLE');
    expectProblem(
      await call('GET', `/api/v1/workspaces/${t.ws}/audit-log/export?format=pdf`, { token: t.owner.token }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('50001 registros: 400 VALIDATION_FAILED y la exportación fallida no se audita; 50000 sí se exportan', async () => {
    const t = await team();
    const app = await connect(deps.databaseUrl);
    try {
      await inTx(
        app,
        { userId: t.owner.id, workspaceId: t.ws },
        async () => {
          await app.query(
            `INSERT INTO audit.audit_log (id, occurred_at, workspace_id, actor_type, actor_user_id, action,
               aggregate_type, aggregate_id, origin, correlation_id)
             SELECT gen_random_uuid(), timestamptz '2026-05-01T12:00:00Z' + (g * interval '2 seconds'), $1, 'USER', $2,
                    'planning.budget.created', 'Budget', gen_random_uuid(), 'ui', gen_random_uuid()
               FROM generate_series(1, 50001) g`,
            [t.ws, U1],
          );
        },
        true,
      );
    } finally {
      await app.end();
    }
    const path = `/api/v1/workspaces/${t.ws}/audit-log/export?format=csv`;
    expectProblem(await call('GET', path, { token: t.owner.token }), 400, 'VALIDATION_FAILED');
    expect((await rawAudit(t.owner, t.ws)).some((x) => x['action'] === 'audit.log.exported')).toBe(false);
    // Acotando a un día (2026-05-02 en La Paz: ~21 000 de los 50 001 registros) sí se exporta.
    const ok = await call(
      'GET',
      `/api/v1/workspaces/${t.ws}/audit-log/export?format=csv&action=planning.budget.created&from=2026-05-02&to=2026-05-02`,
      { token: t.owner.token },
    );
    expect(ok.status).toBe(200);
    const lines = ok.text.slice(1).trimEnd().split('\r\n');
    expect(lines.length).toBeGreaterThan(20_000);
    expect(lines.length).toBeLessThan(50_000);
  }, 120_000);
});

describe('[TC-AUDIT-GLOBAL-004] un rechazo por rol insuficiente queda auditado como evento de seguridad', () => {
  it('VIEWER intenta registrar un gasto: 403, evento de seguridad sin monto ni descripción', async () => {
    const t = await team();
    const attempt = await call('POST', `/api/v1/workspaces/${t.ws}/transactions`, {
      token: t.viewer.token,
      body: { kind: 'EXPENSE', amount: { amount: '45.90', currency: 'BOB' }, description: 'Compra' },
    });
    expectProblem(attempt, 403, 'INSUFFICIENT_ROLE');

    const security = await call('GET', `/api/v1/workspaces/${t.ws}/audit-log?category=SECURITY`, {
      token: t.owner.token,
    });
    const denied = page(security).data.filter((e) => e.action === 'security.authorization.denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]?.actor.userId).toBe(t.viewer.id);
    expect(denied[0]?.changes).toEqual([
      { field: 'operationId', before: null, after: 'createTransaction' },
      { field: 'code', before: null, after: 'INSUFFICIENT_ROLE' },
    ]);
    const raw = (await rawAudit(t.owner, t.ws)).filter(
      (x) => x['action'] === 'security.authorization.denied',
    );
    expect(raw).toHaveLength(1);
    const dump = String(raw[0]?.['dump']);
    expect(dump).not.toContain('45.90');
    expect(dump).not.toContain('Compra');
    expect(raw[0]?.['aggregate_type']).toBe('Workspace');
    expect(raw[0]?.['aggregate_id']).toBe(t.ws);
  });

  it('un no miembro de un workspace existente se audita en el workspace objetivo (D106); uno inexistente no', async () => {
    const t = await team();
    const r = await call('GET', `/api/v1/workspaces/${t.ws}/accounts`, { token: t.outsider.token });
    expectProblem(r, 403, 'WORKSPACE_ACCESS_DENIED');
    const ghost = randomUUID();
    expectProblem(
      await call('GET', `/api/v1/workspaces/${ghost}/accounts`, { token: t.outsider.token }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
    const rows = (await rawAudit(t.owner, t.ws)).filter(
      (x) => x['action'] === 'security.authorization.denied',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['actor_user_id']).toBe(t.outsider.id);
    expect(rows[0]?.['changes']).toEqual([
      { field: 'operationId', before: null, after: 'listAccounts' },
      { field: 'code', before: null, after: 'WORKSPACE_ACCESS_DENIED' },
    ]);
    // Nada en el workspace inventado (no hay dónde auditar): el contexto RLS del inexistente no ve filas.
    expect(await rawAudit(t.owner, ghost)).toEqual([]);
  });

  it('si la auditoría del rechazo falla, la respuesta sigue siendo 403', async () => {
    const t = await team();
    breakDenials = true;
    try {
      const r = await call('POST', `/api/v1/workspaces/${t.ws}/transactions`, {
        token: t.viewer.token,
        body: { kind: 'EXPENSE', amount: { amount: '45.90', currency: 'BOB' } },
      });
      expectProblem(r, 403, 'INSUFFICIENT_ROLE');
    } finally {
      breakDenials = false;
    }
    expect(
      (await rawAudit(t.owner, t.ws)).filter((x) => x['action'] === 'security.authorization.denied'),
    ).toHaveLength(0);
  });
});

describe('[TC-AUDIT-GLOBAL-005] los rechazos repetidos se auditan una vez por minuto', () => {
  it('5 intentos en 30 segundos dejan un evento; tras 61 segundos, un segundo', async () => {
    const t = await team();
    const attempt = () =>
      call('POST', `/api/v1/workspaces/${t.ws}/transactions`, {
        token: t.viewer.token,
        body: { kind: 'EXPENSE', amount: { amount: '45.90', currency: 'BOB' } },
      });
    for (let i = 0; i < 5; i += 1) {
      expectProblem(await attempt(), 403, 'INSUFFICIENT_ROLE');
      clock.advance(6_000);
    }
    const count = async () =>
      (await rawAudit(t.owner, t.ws)).filter((x) => x['action'] === 'security.authorization.denied').length;
    expect(await count()).toBe(1);
    clock.advance(61_000);
    expectProblem(await attempt(), 403, 'INSUFFICIENT_ROLE');
    expect(await count()).toBe(2);
  });
});

describe('[TC-AUDIT-GLOBAL-006] la vista de seguridad muestra solo eventos de seguridad', () => {
  it('sesiones, fallo de autorización, ajuste de configuración y export; ninguna transacción', async () => {
    const t = await team();
    for (const event of ['STARTED', 'STARTED']) {
      const s = await call('POST', '/api/v1/me/session-events', {
        token: t.owner.token,
        body: { event, workspaceId: t.ws },
      });
      expect(s.status).toBe(204);
    }
    await call('POST', `/api/v1/workspaces/${t.ws}/transactions`, {
      token: t.viewer.token,
      body: { kind: 'EXPENSE', amount: { amount: '1.00', currency: 'BOB' } },
    });
    await seed(
      t.owner,
      t.ws,
      Array.from({ length: 10 }, (_, i) => ({
        at: `2026-03-${String(10 + i).padStart(2, '0')}T15:00:00Z`,
        actor: U1,
        action: 'transactions.transaction.created',
        aggregateType: 'Transaction',
        aggregateId: tx(),
      })),
    );
    const exp = await call('GET', `/api/v1/workspaces/${t.ws}/audit-log/export?format=csv`, {
      token: t.owner.token,
    });
    expect(exp.status).toBe(200);

    const sec = await call('GET', `/api/v1/workspaces/${t.ws}/audit-log?category=SECURITY&limit=100`, {
      token: t.owner.token,
    });
    expect(contract().validateResponse('listAuditLog', 200, sec.body)).toEqual([]);
    const actions = page(sec).data.map((e) => e.action);
    expect(actions.filter((a) => a === 'identity.session.started')).toHaveLength(2);
    expect(actions).toContain('security.authorization.denied');
    expect(actions).toContain('audit.log.exported');
    expect(actions.some((a) => a.startsWith('transactions.'))).toBe(false);

    const data = await call('GET', `/api/v1/workspaces/${t.ws}/audit-log?category=DATA&limit=100`, {
      token: t.owner.token,
    });
    const dataActions = page(data).data.map((e) => e.action);
    expect(dataActions.filter((a) => a === 'transactions.transaction.created')).toHaveLength(10);
    expect(dataActions).not.toContain('security.authorization.denied');
    expect(dataActions).not.toContain('identity.session.started');
    expect(dataActions).not.toContain('audit.log.exported');
  });
});

describe('[TC-AUDIT-GLOBAL-007] filtrar por correlación devuelve todos los registros de una edición masiva', () => {
  it('los 3 registros por transacción y el agregado de B1, y ninguno de B2', async () => {
    const t = await team();
    const [b1, b2] = [randomUUID(), randomUUID()];
    const row = (at: string, correlationId: string, aggregateType = 'Transaction', id = tx()): SeedRow => ({
      at,
      actor: t.owner.id,
      action: 'transactions.transaction.bulk_edited',
      aggregateType,
      aggregateId: id,
      correlationId,
    });
    await seed(t.owner, t.ws, [
      row('2026-03-03T15:00:00Z', b1),
      row('2026-03-03T15:00:01Z', b1),
      row('2026-03-03T15:00:02Z', b1),
      row('2026-03-03T15:00:03Z', b1, 'BulkOperation', b1),
      row('2026-03-03T15:00:04Z', b2),
      row('2026-03-03T15:00:05Z', b2),
    ]);
    const r = await call('GET', `/api/v1/workspaces/${t.ws}/audit-log?correlationId=${b1}`, {
      token: t.owner.token,
    });
    expect(r.status).toBe(200);
    expect(page(r).data).toHaveLength(4);
    expect(page(r).data.every((e) => e.correlationId === b1)).toBe(true);
  });
});

describe('contrato', () => {
  it('exportAuditLog exige OWNER y listAuditLog EDITOR', () => {
    const op = (id: string) =>
      contract()
        .operations()
        .find((o) => o.operationId === id);
    expect(op('exportAuditLog')?.requiredRole).toBe('OWNER');
    expect(op('listAuditLog')?.requiredRole).toBe('EDITOR');
  });
});
