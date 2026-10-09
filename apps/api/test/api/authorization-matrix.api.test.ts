import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ApiContract, type ContractOperation } from '@pf/platform/api';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Matriz de autorización parametrizada (openspec add-workspace-identity 7.4, TC-SECURITY-RBAC-002): OWNER, EDITOR,
// VIEWER, no miembro y anónimo × cada operación del contrato YA IMPLEMENTADA (una operación del contrato sin ruta
// todavía responde 404 sin autenticación y queda fuera; entra sola en la matriz cuando su change la implementa).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const CONTRACT = fileURLToPath(new URL('../../../../contracts/openapi/finance-api.v1.yaml', import.meta.url));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const contract = ApiContract.fromFile(CONTRACT);
const logs = capturingLogger('finance-api', 'api');

type Actor = 'OWNER' | 'EDITOR' | 'VIEWER' | 'NON_MEMBER' | 'ANONYMOUS';
const ROLE_RANK: Record<string, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };
const tokens: Partial<Record<Actor, string>> = {};
let workspaceId: string;

async function tokenFor(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub,
    iat: now - 5,
    exp: now + 300,
    // Autenticación reciente: la descarga del export la exige además del rol (add-workspace-export).
    auth_time: now - 5,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `${sub}@pfos.test`,
    email_verified: true,
    name: sub,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(signingKey);
}

/** Llama a la operación con ids aleatorios y cuerpo vacío: solo interesa la decisión de autorización. */
async function invoke(op: ContractOperation, token?: string): Promise<{ status: number; code: unknown }> {
  const path = op.path.replace(/\{([^}]+)\}/g, (_m, name: string) =>
    name === 'workspaceId' ? workspaceId : randomUUID(),
  );
  const headers: Record<string, string> = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  const method = op.method.toUpperCase();
  let body: string | undefined;
  if (method !== 'GET' && method !== 'DELETE') {
    body = '{}';
    headers['content-type'] = method === 'PATCH' ? 'application/merge-patch+json' : 'application/json';
    headers['idempotency-key'] = randomUUID();
  }
  if (method === 'PATCH' || method === 'DELETE') headers['if-match'] = '"999999"';
  const res = await fetch(`${baseUrl}/api/v1${path}`, { method, headers, ...(body ? { body } : {}) });
  const text = await res.text();
  let code: unknown;
  try {
    code = text ? (JSON.parse(text) as Record<string, unknown>)['code'] : undefined;
  } catch {
    // Respuesta sin JSON (p. ej. 404 de una ruta inexistente): sin código de problema.
  }
  return { status: res.status, code };
}

async function provision(sub: string): Promise<{ token: string; id: string; personal: string }> {
  const token = await tokenFor(sub);
  const me = await fetch(`${baseUrl}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  expect(me.status).toBe(200);
  const body = (await me.json()) as { id: string; memberships: { workspaceId: string }[] };
  return { token, id: body.id, personal: body.memberships[0]!.workspaceId };
}

const workspaceScoped = contract.operations().filter((op) => op.path.startsWith('/workspaces/{workspaceId}'));
let implemented: ContractOperation[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(
      // La matriz recorre todas las operaciones con el mismo usuario: el rate limit (120 escrituras/min) no es lo que se prueba aquí.
      baseEnv(deps, { RATE_LIMIT_READS_PER_MIN: '100000', RATE_LIMIT_WRITES_PER_MIN: '100000' }),
    ),
    logs.logger,
    {
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');

  const owner = await provision(`kc-matrix-owner-${randomUUID()}`);
  const editor = await provision(`kc-matrix-editor-${randomUUID()}`);
  const viewer = await provision(`kc-matrix-viewer-${randomUUID()}`);
  const outsider = await provision(`kc-matrix-outsider-${randomUUID()}`);
  workspaceId = owner.personal;
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId },
      async () => {
        for (const [user, role] of [
          [editor.id, 'EDITOR'],
          [viewer.id, 'VIEWER'],
        ] as const)
          await app.query(
            `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
            [workspaceId, user, role],
          );
      },
      true,
    );
  } finally {
    await app.end();
  }
  Object.assign(tokens, {
    OWNER: owner.token,
    EDITOR: editor.token,
    VIEWER: viewer.token,
    NON_MEMBER: outsider.token,
  });
  // Implementada = tiene ruta: sin credenciales responde 401 (una ruta inexistente responde 404).
  for (const op of workspaceScoped) if ((await invoke(op)).status !== 404) implemented.push(op);
  implemented = implemented.sort((a, b) => a.operationId.localeCompare(b.operationId));
});

afterAll(async () => {
  await runtime?.close();
});

describe('[TC-SECURITY-RBAC-002] matriz de autorización (rol × operación del contrato implementada)', () => {
  it('toda operación de workspace declara x-required-role y la matriz no está vacía', () => {
    expect(workspaceScoped.filter((op) => !op.requiredRole).map((op) => op.operationId)).toEqual([]);
    expect(implemented.length).toBeGreaterThan(20);
    // updateWorkspace solo OWNER (expected_result del TC).
    expect(implemented.find((op) => op.operationId === 'updateWorkspace')?.requiredRole).toBe('OWNER');
  });

  const actors: Actor[] = ['ANONYMOUS', 'NON_MEMBER', 'VIEWER', 'EDITOR', 'OWNER'];
  it.each(actors)('%s × todas las operaciones implementadas', async (actor) => {
    const mismatches: string[] = [];
    for (const op of implemented) {
      const { status, code } = await invoke(op, actor === 'ANONYMOUS' ? undefined : tokens[actor]);
      let ok: boolean;
      let expected: string;
      if (actor === 'ANONYMOUS') {
        expected = '401';
        ok = status === 401;
      } else if (actor === 'NON_MEMBER') {
        expected = '403 WORKSPACE_ACCESS_DENIED';
        ok = status === 403 && code === 'WORKSPACE_ACCESS_DENIED';
      } else if (ROLE_RANK[actor]! >= ROLE_RANK[op.requiredRole ?? 'VIEWER']!) {
        // Permitido: la decisión de autorización deja pasar (ids aleatorios ⇒ 2xx/404/400/412/422 según el caso).
        expected = 'no 401/403';
        ok = status !== 401 && status !== 403;
      } else {
        expected = '403 INSUFFICIENT_ROLE';
        ok = status === 403 && code === 'INSUFFICIENT_ROLE';
      }
      if (!ok)
        mismatches.push(
          `${op.operationId} (${op.requiredRole}): esperado ${expected}, obtuvo ${status} ${String(code)}`,
        );
    }
    expect(mismatches).toEqual([]);
  });
});
