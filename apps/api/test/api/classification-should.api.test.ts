import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Requirements Should de CLASSIFICATION por HTTP contra PostgreSQL real (openspec add-classification 1.3): desarchivar
// categoría/tag/counterparty, orden persistente, grupo no vacío y sugerencia de categoría por counterparty.
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
const clock = new FixedClock(Instant.parse('2026-03-20T14:00:00Z'));

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

const expectProblem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code']).toBe(code);
};

interface User {
  token: string;
  ws: string;
}

async function user(): Promise<User> {
  const sub = `kc-clss-${randomUUID()}`;
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
  return { token, ws: (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId };
}

const W = (u: User) => `/api/v1/workspaces/${u.ws}`;
async function create(u: User, path: string, body: unknown): Promise<Json> {
  const r = await call('POST', `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(r.status, `${path}: ${JSON.stringify(r.body)}`).toBe(201);
  return r.body;
}
/** `archive`/`unarchive` con If-Match de la versión vigente. */
const command = (u: User, path: string, resource: Json, verb: 'archive' | 'unarchive') =>
  call('POST', `${W(u)}${path}/${String(resource['id'])}/${verb}`, {
    token: u.token,
    headers: { 'if-match': `"${String(resource['version'])}"` },
  });
const read = async (u: User, path: string) => (await call('GET', `${W(u)}${path}`, { token: u.token })).body;

interface Category {
  id: string;
  name: string;
  parentId: string | null;
  groupId: string;
  version: number;
}
const categories = async (u: User): Promise<Category[]> =>
  (await read(u, '/categories?kind=EXPENSE&limit=200&includeArchived=true'))['data'] as Category[];
const categoryNamed = async (u: User, name: string) => (await categories(u)).find((c) => c.name === name)!;

const money = (amount: string) => ({ amount, currency: 'BOB' });
const expense = (u: User, accountId: string, amount: string, extra: Json) =>
  call('POST', `${W(u)}/transactions`, {
    token: u.token,
    body: { kind: 'EXPENSE', transactionDate: '2026-03-15', accountId, amount: money(amount), ...extra },
    headers: { 'idempotency-key': randomUUID() },
  });

let u: User;
let banco: string;

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
  u = await user();
  banco = (
    await create(u, '/accounts', {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('5000.00'), date: '2026-03-01' },
    })
  )['id'] as string;
});

afterAll(async () => {
  await runtime?.close();
});

describe('desarchivar (requirements Should)', () => {
  it('[TC-CLASSIFICATION-UNARCHIVE-001] categoría desarchivada asignable; padre archivado ⇒ CATEGORY_ARCHIVED; nombre ocupado ⇒ NAME_TAKEN', async () => {
    const group = await create(u, '/category-groups', { name: 'Deportes y bienestar', kind: 'EXPENSE' });
    const gym = await create(u, '/categories', { groupId: group['id'], name: 'Old Gym' });
    const archived = await command(u, '/categories', gym, 'archive');
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expectProblem(
      await expense(u, banco, '150.00', { splits: [{ amount: money('150.00'), categoryId: gym['id'] }] }),
      409,
      'CATEGORY_ARCHIVED',
    );
    const restored = await command(u, '/categories', archived.body, 'unarchive');
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body['archivedAt']).toBeNull();
    const ok = await expense(u, banco, '150.00', {
      splits: [{ amount: money('150.00'), categoryId: gym['id'] }],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((ok.body['splits'] as { categoryId: string }[])[0]!.categoryId).toBe(gym['id']);

    // Subcategoría con el padre archivado (archivado en cascada).
    const parent = await create(u, '/categories', { groupId: group['id'], name: 'Deportes Demo' });
    const yoga = await create(u, '/categories', {
      groupId: group['id'],
      parentId: parent['id'],
      name: 'Yoga',
    });
    expect((await command(u, '/categories', parent, 'archive')).status).toBe(200);
    const yogaNow = (await categories(u)).find((c) => c.id === yoga['id'])!;
    expectProblem(
      await command(u, '/categories', yogaNow as unknown as Json, 'unarchive'),
      409,
      'CATEGORY_ARCHIVED',
    );

    // Nombre ocupado por una hermana activa.
    const gymNow = (await categories(u)).find((c) => c.id === gym['id'])!;
    const again = await command(u, '/categories', gymNow as unknown as Json, 'archive');
    await create(u, '/categories', { groupId: group['id'], name: 'Old Gym' });
    expectProblem(await command(u, '/categories', again.body, 'unarchive'), 409, 'NAME_TAKEN');
  });

  it('[TC-CLASSIFICATION-UNARCHIVE-002] tag desarchivado asignable; nombre ocupado ⇒ NAME_TAKEN', async () => {
    const category = await categoryNamed(u, 'Viajes');
    const tag = await create(u, '/tags', { name: 'Viaje Santa Cruz 2026' });
    const archived = await command(u, '/tags', tag, 'archive');
    expect(archived.status).toBe(200);
    const split = (tagIds: unknown[]) => ({
      splits: [{ amount: money('95.00'), categoryId: category.id, tagIds }],
    });
    expectProblem(await expense(u, banco, '95.00', split([tag['id']])), 409, 'TAG_ARCHIVED');
    const restored = await command(u, '/tags', archived.body, 'unarchive');
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const ok = await expense(u, banco, '95.00', split([tag['id']]));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((ok.body['splits'] as { tagIds: string[] }[])[0]!.tagIds).toEqual([tag['id']]);

    const again = await command(u, '/tags', restored.body, 'archive');
    await create(u, '/tags', { name: 'viaje santa cruz 2026' });
    expectProblem(await command(u, '/tags', again.body, 'unarchive'), 409, 'NAME_TAKEN');
  });

  it('[TC-CLASSIFICATION-UNARCHIVE-003] counterparty desarchivada asignable; nombre ocupado ⇒ NAME_TAKEN', async () => {
    const entel = await create(u, '/counterparties', { name: 'Entel', kind: 'SERVICE_PROVIDER' });
    const archived = await command(u, '/counterparties', entel, 'archive');
    expect(archived.status).toBe(200);
    expectProblem(
      await expense(u, banco, '120.00', { counterpartyId: entel['id'] }),
      409,
      'COUNTERPARTY_ARCHIVED',
    );
    const restored = await command(u, '/counterparties', archived.body, 'unarchive');
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    const ok = await expense(u, banco, '120.00', { counterpartyId: entel['id'] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body['counterpartyId']).toBe(entel['id']);

    const again = await command(u, '/counterparties', restored.body, 'archive');
    await create(u, '/counterparties', { name: 'ENTEL' });
    expectProblem(await command(u, '/counterparties', again.body, 'unarchive'), 409, 'NAME_TAKEN');
  });
});

describe('orden, grupos y sugerencias (requirements Should)', () => {
  it('[TC-CLASSIFICATION-ORDER-001] reordenar subcategorías persiste el orden; un conjunto incompleto se rechaza', async () => {
    // "Servicios básicos" del catálogo es-BO trae Luz, Agua, Gas domiciliario, Internet, Telefonía móvil y TV cable.
    const servicios = await categoryNamed(u, 'Servicios básicos');
    const siblings = async () =>
      ((await read(u, '/categories?kind=EXPENSE&limit=200'))['data'] as Category[]).filter(
        (c) => c.parentId === servicios.id,
      );
    const initial = await siblings();
    expect(initial.slice(0, 2).map((c) => c.name)).toEqual(['Luz', 'Agua']);
    const id = (name: string) => initial.find((c) => c.name === name)!.id;
    const head = ['Internet', 'Luz', 'Agua'];
    const rest = initial.map((c) => c.name).filter((n) => !head.includes(n));
    const reorder = (orderedIds: string[]) =>
      call('POST', `${W(u)}/categories/reorder`, {
        token: u.token,
        body: { groupId: servicios.groupId, parentId: servicios.id, orderedIds },
      });
    const r = await reorder([...head, ...rest].map(id));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const order = async () => (await siblings()).map((c) => c.name);
    expect(await order()).toEqual([...head, ...rest]);
    // Conjunto que no es exactamente el de las hermanas activas: rechazado, el orden no cambia.
    const bad = await reorder(head.map(id));
    expect([400, 422]).toContain(bad.status);
    expect(bad.body['code']).toBe('VALIDATION_FAILED');
    expect(await order()).toEqual([...head, ...rest]);
  });

  it('[TC-CLASSIFICATION-GROUP-002] archivar "Vivienda" con "Alquiler" activa ⇒ CATEGORY_GROUP_NOT_EMPTY; un grupo vacío sí se archiva', async () => {
    const groups = (await read(u, '/category-groups?limit=200'))['data'] as Json[];
    const vivienda = groups.find((g) => g['name'] === 'Vivienda')!;
    expectProblem(await command(u, '/category-groups', vivienda, 'archive'), 409, 'CATEGORY_GROUP_NOT_EMPTY');
    const still = await read(u, `/category-groups/${String(vivienda['id'])}`);
    expect(still['archivedAt']).toBeNull();

    const empty = await create(u, '/category-groups', { name: 'Grupo Vacío Demo', kind: 'EXPENSE' });
    const only = await create(u, '/categories', { groupId: empty['id'], name: 'Temporal' });
    expect((await command(u, '/categories', only, 'archive')).status).toBe(200);
    const archived = await command(u, '/category-groups', empty, 'archive');
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
  });

  it('[TC-CLASSIFICATION-SUGGESTION-001] sugiere la última categoría activa usada con la counterparty, sin asignarla', async () => {
    const farmacia = await categoryNamed(u, 'Farmacia');
    const farmacorp = await create(u, '/counterparties', { name: 'Farmacorp' });
    const suggestion = (id: unknown) =>
      read(u, `/counterparties/${String(id)}/category-suggestion?kind=EXPENSE`);
    expect(await suggestion(farmacorp['id'])).toEqual({ categoryId: null, source: 'NONE' });
    const tx = await expense(u, banco, '64.00', {
      counterpartyId: farmacorp['id'],
      splits: [{ amount: money('64.00'), categoryId: farmacia.id }],
    });
    expect(tx.status, JSON.stringify(tx.body)).toBe(201);
    expect(await suggestion(farmacorp['id'])).toEqual({ categoryId: farmacia.id, source: 'LAST_USED' });
    // Sugerir no asigna: un gasto nuevo con Farmacorp sin splits queda sin categoría elegida por el usuario.
    const plain = await expense(u, banco, '10.00', { counterpartyId: farmacorp['id'] });
    expect(plain.status).toBe(201);
    expect((plain.body['splits'] as { categoryId: string }[])[0]!.categoryId).not.toBe(farmacia.id);
  });
});
