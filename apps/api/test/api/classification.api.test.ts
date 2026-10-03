import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ApiContract } from '@pf/platform/api';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// API de CLASSIFICATION (openspec add-classification) contra PostgreSQL real, con emisor JWT de prueba.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const CONTRACT = fileURLToPath(new URL('../../../../contracts/openapi/finance-api.v1.yaml', import.meta.url));

interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let contract: ApiContract;
const logs = capturingLogger('finance-api', 'api');

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
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.headers.get('content-type')).toContain('application/problem+json');
  expect(r.body['code']).toBe(code);
};

const patch = (token: string, path: string, body: unknown, version: number) =>
  call('PATCH', path, {
    token,
    body,
    contentType: 'application/merge-patch+json',
    headers: { 'if-match': `"${version}"` },
  });

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, personal: memberships[0]!.workspaceId };
}

type Cat = {
  id: string;
  name: string;
  systemCode: string | null;
  isSystem: boolean;
  version: number;
  groupId: string;
};
async function categories(token: string, ws: string, query = 'limit=200'): Promise<Cat[]> {
  const r = await call('GET', `/api/v1/workspaces/${ws}/categories?${query}`, { token });
  expect(r.status).toBe(200);
  expect(contract.validateResponse('listCategories', 200, r.body)).toEqual([]);
  return r.body['data'] as Cat[];
}

beforeAll(async () => {
  contract = ApiContract.fromFile(CONTRACT);
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), logs.logger, {
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await runtime?.close();
});

describe('categorías de sistema y catálogo al crear el workspace (tareas 4.2, 4.3, 6.2)', () => {
  it('[TC-CLASSIFICATION-SYSTEM-001] seedDefaultCategories=false ⇒ exactamente las 11 de sistema, en la misma transacción', async () => {
    const u = await user(`kc-cls-sys-${randomUUID()}`);
    const created = await call('POST', '/api/v1/workspaces', {
      token: u.token,
      body: { name: 'Sin catálogo', baseCurrency: 'BOB', seedDefaultCategories: false },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(created.status).toBe(201);
    const all = await categories(u.token, String(created.body['id']), 'limit=200&includeArchived=true');
    expect(all).toHaveLength(11);
    expect(all.every((c) => c.isSystem)).toBe(true);
  });

  it('[TC-CLASSIFICATION-SEED-001] por defecto se aplica el catálogo; reaplicarlo por API no duplica y exige Idempotency-Key', async () => {
    const u = await user(`kc-cls-seed-${randomUUID()}`);
    const all = await categories(u.token, u.personal);
    expect(all).toHaveLength(78);
    expect(all.filter((c) => !c.isSystem)).toHaveLength(67);
    const path = `/api/v1/workspaces/${u.personal}/categories/apply-default-catalog`;
    expectProblem(await call('POST', path, { token: u.token, body: {} }), 428, 'IDEMPOTENCY_KEY_REQUIRED');
    const again = await call('POST', path, {
      token: u.token,
      body: {},
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({
      catalogVersion: 'es-BO.v1',
      createdGroups: 0,
      createdCategories: 0,
      skipped: 80,
    });
    expect(await categories(u.token, u.personal)).toHaveLength(78);
  });
});

describe('API de categorías (tareas 6.1-6.3)', () => {
  let u: Awaited<ReturnType<typeof user>>;
  let ws: string;
  let groupId: string;

  beforeAll(async () => {
    u = await user(`kc-cls-api-${randomUUID()}`);
    ws = u.personal;
    const g = await call('POST', `/api/v1/workspaces/${ws}/category-groups`, {
      token: u.token,
      body: { name: 'Pruebas', kind: 'EXPENSE' },
    });
    expect(g.status).toBe(201);
    expect(contract.validateResponse('createCategoryGroup', 201, g.body)).toEqual([]);
    groupId = String(g.body['id']);
  });

  it('[TC-CLASSIFICATION-CATEGORY-001] 201 con icono, color, ETag y Location; duplicado ⇒ 409 NAME_TAKEN', async () => {
    const r = await call('POST', `/api/v1/workspaces/${ws}/categories`, {
      token: u.token,
      body: { groupId, name: 'Supermercado', icon: 'cart', color: '#2E7D32' },
    });
    expect(r.status).toBe(201);
    expect(contract.validateResponse('createCategory', 201, r.body)).toEqual([]);
    expect(r.body).toMatchObject({
      kind: 'EXPENSE',
      icon: 'cart',
      color: '#2E7D32',
      isSystem: false,
      archivedAt: null,
    });
    expect(r.headers.get('etag')).toBe('"1"');
    expect(r.headers.get('location')).toBe(`/api/v1/workspaces/${ws}/categories/${String(r.body['id'])}`);
    const dup = await call('POST', `/api/v1/workspaces/${ws}/categories`, {
      token: u.token,
      body: { groupId, name: 'supermercado' },
    });
    expectProblem(dup, 409, 'NAME_TAKEN');
    expect(dup.body['existingId']).toBe(r.body['id']);
  });

  it('crear una categoría con Idempotency-Key (opcional) responde 201 y el reintento reproduce la misma respuesta', async () => {
    // Regresión: el nombre localizado se leía DESPUÉS del comando con una unidad de trabajo sin workspace, que
    // dejaba la transacción de idempotencia sin contexto RLS ⇒ 500 "workspace context not set".
    const key = randomUUID();
    const send = () =>
      call('POST', `/api/v1/workspaces/${ws}/categories`, {
        token: u.token,
        body: { groupId, name: 'Farmacia idempotente' },
        headers: { 'idempotency-key': key },
      });
    const first = await send();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(contract.validateResponse('createCategory', 201, first.body)).toEqual([]);
    const replay = await send();
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body['id']).toBe(first.body['id']);
  });

  it('[TC-CLASSIFICATION-SYSTEM-002] FEES: archivar y renombrar ⇒ 409 SYSTEM_CATEGORY_IMMUTABLE; color ⇒ 200', async () => {
    const fees = (await categories(u.token, ws)).find((c) => c.systemCode === 'FEES')!;
    const path = `/api/v1/workspaces/${ws}/categories/${fees.id}`;
    expectProblem(
      await call('POST', `${path}/archive`, { token: u.token, headers: { 'if-match': '"1"' } }),
      409,
      'SYSTEM_CATEGORY_IMMUTABLE',
    );
    expectProblem(await patch(u.token, path, { name: 'Cargos' }, 1), 409, 'SYSTEM_CATEGORY_IMMUTABLE');
    const ok = await patch(u.token, path, { color: '#C62828' }, 1);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ systemCode: 'FEES', color: '#C62828', archivedAt: null, version: 2 });
  });

  it('[TC-CLASSIFICATION-SYSTEM-003] el nombre de sistema sigue el locale del usuario (es-BO / en)', async () => {
    const fees = (await categories(u.token, ws)).find((c) => c.systemCode === 'FEES')!;
    const path = `/api/v1/workspaces/${ws}/categories/${fees.id}`;
    expect((await call('GET', path, { token: u.token })).body['name']).toBe('Comisiones');
    const me = await call('GET', '/api/v1/me', { token: u.token });
    const v = Number(me.body['version']);
    expect((await patch(u.token, '/api/v1/me', { locale: 'en' }, v)).status).toBe(200);
    const en = await call('GET', path, { token: u.token });
    expect(en.body).toMatchObject({ id: fees.id, systemCode: 'FEES', name: 'Fees' });
    expect((await patch(u.token, '/api/v1/me', { locale: 'es-BO' }, v + 1)).status).toBe(200);
    expect((await call('GET', path, { token: u.token })).body['name']).toBe('Comisiones');
  });

  it('[TC-CLASSIFICATION-DELETE-001] DELETE ⇒ 405 problem+json sin efectos; se archiva con POST …/archive', async () => {
    const c = await call('POST', `/api/v1/workspaces/${ws}/categories`, {
      token: u.token,
      body: { groupId, name: 'Sin uso' },
    });
    const path = `/api/v1/workspaces/${ws}/categories/${String(c.body['id'])}`;
    const del = await call('DELETE', path, { token: u.token });
    expectProblem(del, 405, 'METHOD_NOT_ALLOWED');
    expect(del.headers.get('allow')).toBe('GET, PATCH');
    for (const res of ['tags', 'counterparties', 'category-groups']) {
      expectProblem(
        await call('DELETE', `/api/v1/workspaces/${ws}/${res}/${randomUUID()}`, { token: u.token }),
        405,
        'METHOD_NOT_ALLOWED',
      );
    }
    const after = await call('GET', path, { token: u.token });
    expect(after.body).toMatchObject({ name: 'Sin uso', archivedAt: null, version: 1 });
    const archived = await call('POST', `${path}/archive`, {
      token: u.token,
      headers: { 'if-match': '"1"' },
    });
    expect(archived.status).toBe(200);
    expect(contract.validateResponse('archiveCategory', 200, archived.body)).toEqual([]);
    expect((await categories(u.token, ws)).map((x) => x.id)).not.toContain(c.body['id']);
  });

  it('VIEWER/no miembro no escribe: otro usuario ⇒ 403 WORKSPACE_ACCESS_DENIED', async () => {
    const outsider = await user(`kc-cls-out-${randomUUID()}`);
    expectProblem(
      await call('POST', `/api/v1/workspaces/${ws}/tags`, { token: outsider.token, body: { name: 'x' } }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
    expect(contract.operations().find((o) => o.operationId === 'createTag')?.requiredRole).toBe('EDITOR');
  });

  it('tags y counterparties por HTTP: creación inline con existingId, resolve y sugerencia válidos contra el contrato', async () => {
    const tag = await call('POST', `/api/v1/workspaces/${ws}/tags`, {
      token: u.token,
      body: { name: 'Trabajo' },
    });
    expect(tag.status).toBe(201);
    expect(contract.validateResponse('createTag', 201, tag.body)).toEqual([]);
    const hiper = await call('POST', `/api/v1/workspaces/${ws}/counterparties`, {
      token: u.token,
      body: { name: 'Hipermaxi', aliases: ['hipermaxi sa'] },
    });
    expect(hiper.status).toBe(201);
    expect(hiper.body['kind']).toBe('OTHER');
    expect(contract.validateResponse('createCounterparty', 201, hiper.body)).toEqual([]);
    const inline = await call('POST', `/api/v1/workspaces/${ws}/counterparties`, {
      token: u.token,
      body: { name: 'hipermaxi' },
    });
    expectProblem(inline, 409, 'NAME_TAKEN');
    expect(inline.body['existingId']).toBe(hiper.body['id']);
    const resolved = await call(
      'GET',
      `/api/v1/workspaces/${ws}/counterparties/resolve?description=${encodeURIComponent('COMPRA HIPERMAXI SA 4471')}`,
      { token: u.token },
    );
    expect(resolved.status).toBe(200);
    expect(contract.validateResponse('resolveCounterparty', 200, resolved.body)).toEqual([]);
    expect(resolved.body).toMatchObject({ matchedOn: 'ALIAS', matchedText: 'hipermaxi sa' });
    const sug = await call(
      'GET',
      `/api/v1/workspaces/${ws}/counterparties/${String(hiper.body['id'])}/category-suggestion?kind=EXPENSE`,
      { token: u.token },
    );
    expect(sug.body).toEqual({ categoryId: null, source: 'NONE' });
  });

  it('CategoryArchived.v1 llega al outbox real en la transacción del archivado', async () => {
    const c = await call('POST', `/api/v1/workspaces/${ws}/categories`, {
      token: u.token,
      body: { groupId, name: 'Para archivar' },
    });
    const id = String(c.body['id']);
    await call('POST', `/api/v1/workspaces/${ws}/categories/${id}/archive`, {
      token: u.token,
      headers: { 'if-match': '"1"' },
    });
    const worker = await connect(deps.workerDatabaseUrl);
    try {
      const { rows } = await worker.query<{ event_type: string; aggregate_version: number }>(
        `SELECT event_type, aggregate_version FROM platform.outbox WHERE aggregate_id = $1`,
        [id],
      );
      expect(rows).toEqual([{ event_type: 'classification.CategoryArchived', aggregate_version: 2 }]);
    } finally {
      await worker.end();
    }
  });
});
