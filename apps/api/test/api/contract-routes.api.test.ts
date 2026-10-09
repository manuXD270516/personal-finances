import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract, type ContractOperation } from '@pf/platform/api';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Contrato ↔ rutas Nest (openspec add-transaction-recording 5.1): toda ruta montada bajo /api/v1 corresponde a una
// operación del OpenAPI (o es un DELETE que responde 405 por diseño), toda operación de TRANSACTIONS tiene ruta, las
// operaciones del contrato aún sin ruta son una lista explícita (una nueva brecha rompe el test) y `x-required-role`
// se aplica en cada operación de TRANSACTIONS (VIEWER ⇒ 403 INSUFFICIENT_ROLE en las de EDITOR; nunca 401/403 en las
// de VIEWER).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());

/** Operaciones del contrato cuyo change aún no las implementa (fuera de Phase 1 o de su alcance). */
const PENDING_OPERATIONS: string[] = [];

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const logs = capturingLogger('finance-api', 'api');

interface MountedRoute {
  readonly method: string;
  readonly path: string;
}

interface ExpressLayer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
}

/** Rutas registradas en Express por Nest (Express 5: `app.router.stack`; 4: `app._router.stack`). */
function mountedRoutes(): MountedRoute[] {
  const instance = runtime.app.getHttpAdapter().getInstance() as {
    router?: { stack: ExpressLayer[] };
    _router?: { stack: ExpressLayer[] };
  };
  const stack = (instance.router ?? instance._router)?.stack ?? [];
  const routes: MountedRoute[] = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const path of paths)
      for (const [method, on] of Object.entries(layer.route.methods))
        if (on && method !== '_all') routes.push({ method: method.toUpperCase(), path });
  }
  return routes;
}

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

async function provision(sub: string) {
  const token = await tokenFor(sub);
  const me = await fetch(`${baseUrl}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  expect(me.status).toBe(200);
  const body = (await me.json()) as { id: string; memberships: { workspaceId: string }[] };
  return { token, id: body.id, ws: body.memberships[0]!.workspaceId };
}

let viewerToken: string;
let workspaceId: string;

/** Invoca la operación con ids aleatorios y cuerpo vacío: interesa solo la decisión de autorización. */
async function invoke(op: ContractOperation, token: string) {
  const path = op.path.replace(/\{([^}]+)\}/g, (_m, name: string) =>
    name === 'workspaceId' ? workspaceId : randomUUID(),
  );
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (op.method !== 'GET' && op.method !== 'DELETE') {
    body = '{}';
    headers['content-type'] = op.method === 'PATCH' ? 'application/merge-patch+json' : 'application/json';
    headers['idempotency-key'] = randomUUID();
  }
  if (op.requiresIfMatch) headers['if-match'] = '"999999"';
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method: op.method,
    headers,
    ...(body ? { body } : {}),
  });
  const text = await res.text();
  let code: unknown;
  try {
    code = text ? (JSON.parse(text) as Record<string, unknown>)['code'] : undefined;
  } catch {
    // Sin cuerpo JSON.
  }
  return { status: res.status, code };
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(baseEnv(deps, { RATE_LIMIT_READS_PER_MIN: '100000', RATE_LIMIT_WRITES_PER_MIN: '100000' })),
    logs.logger,
    {
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');
  const owner = await provision(`kc-routes-owner-${randomUUID()}`);
  const viewer = await provision(`kc-routes-viewer-${randomUUID()}`);
  workspaceId = owner.ws;
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'VIEWER', 'ACTIVE')`,
          [workspaceId, viewer.id],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  viewerToken = viewer.token;
});

afterAll(async () => {
  await runtime?.close();
});

describe('Contrato OpenAPI ↔ rutas Nest', () => {
  it('[TC-PLATFORM-API-001] toda ruta montada bajo /api/v1 es una operación del contrato (o un DELETE 405 por diseño)', async () => {
    const versioned = mountedRoutes().filter((r) => r.path.startsWith(`${contract.basePath}/`));
    expect(versioned.length).toBeGreaterThan(80);
    const extra = versioned.filter((r) => !contract.find(r.method, r.path));
    // Los DELETE fuera del contrato existen solo para responder 405 METHOD_NOT_ALLOWED con Allow (docs/10 §3).
    expect(extra.filter((r) => r.method !== 'DELETE')).toEqual([]);
    for (const r of extra) {
      const path = r.path.replace(/:([A-Za-z]+)/g, (_m, name: string) =>
        name === 'workspaceId' ? workspaceId : randomUUID(),
      );
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect([res.status, res.headers.get('allow') !== null], `${r.method} ${r.path}`).toEqual([405, true]);
    }
  });

  it('[TC-PLATFORM-API-001] toda operación del contrato tiene ruta salvo la lista explícita de pendientes', () => {
    const mounted = new Set(mountedRoutes().map((r) => `${r.method} ${r.path}`));
    const missing = contract
      .operations()
      .filter((op) => !mounted.has(`${op.method} ${op.routePath}`))
      .map((op) => op.operationId)
      .sort();
    expect(missing).toEqual([...PENDING_OPERATIONS].sort());
    const transactions = contract.operations().filter((op) => op.tags.includes('Transactions'));
    expect(transactions.map((op) => op.operationId)).toEqual(
      expect.arrayContaining([
        'createTransaction',
        'getTransaction',
        'listTransactions',
        'updateTransaction',
        'voidTransaction',
        'postTransaction',
        'markTransactionsCleared',
        'unreconcileTransaction',
        'checkTransactionDuplicates',
        'getTransactionHistory',
        'createTransfer',
      ]),
    );
    expect(transactions.filter((op) => !mounted.has(`${op.method} ${op.routePath}`))).toEqual([]);
  });

  it('[TC-SECURITY-RBAC-002] x-required-role se aplica en cada operación de TRANSACTIONS (VIEWER)', async () => {
    const transactions = contract.operations().filter((op) => op.tags.includes('Transactions'));
    expect(transactions.every((op) => op.requiredRole === 'VIEWER' || op.requiredRole === 'EDITOR')).toBe(
      true,
    );
    const mismatches: string[] = [];
    for (const op of transactions) {
      const { status, code } = await invoke(op, viewerToken);
      const denied = status === 403 && code === 'INSUFFICIENT_ROLE';
      if (op.requiredRole === 'EDITOR' ? !denied : status === 401 || status === 403)
        mismatches.push(`${op.operationId} (${String(op.requiredRole)}): ${status} ${String(code)}`);
    }
    expect(mismatches).toEqual([]);
  });
});
