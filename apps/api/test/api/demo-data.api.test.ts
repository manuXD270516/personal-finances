import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ApiContract } from '@pf/platform/api';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { rowsByTable } from '../support/demo-db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// API de datos de demostración (`W/demo-data`, `W/demo-data/cleanup`, `Workspace.isDemo`; add-demo-data 5.1) sin
// worker: los jobs quedan encolados. Las respuestas se validan contra el contrato (provider-side contract testing).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const CONTRACT = ApiContract.fromFile(
  fileURLToPath(new URL('../../../../contracts/openapi/finance-api.v1.yaml', import.meta.url)),
);

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let enabled: ApiRuntime;
let disabled: ApiRuntime;
let urlOn: string;
let urlOff: string;
let migrator: Client;
let app: Client;

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

async function call(base: string, method: string, path: string, token: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (method === 'POST') headers['idempotency-key'] = randomUUID();
  const res = await fetch(`${base}${path}`, { method, headers });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

const conforms = (operationId: string, r: { status: number; body: unknown }) =>
  expect(
    CONTRACT.validateResponse(
      operationId,
      r.status,
      r.body,
      r.status >= 400 ? 'application/problem+json' : 'application/json',
    ),
    operationId,
  ).toEqual([]);

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call(urlOn, 'GET', '/api/v1/me', token);
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, personal: memberships[0]!.workspaceId };
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  const identity = {
    jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
  };
  enabled = await createApiRuntime(apiConfig(baseEnv(deps)), capturingLogger('finance-api', 'api').logger, {
    identity,
  });
  urlOn = await enabled.listen(0, '127.0.0.1');
  disabled = await createApiRuntime(
    apiConfig(baseEnv(deps, { DEMO_DATA_ENABLED: 'false' })),
    capturingLogger('finance-api', 'api').logger,
    { identity },
  );
  urlOff = await disabled.listen(0, '127.0.0.1');
  migrator = await connect(deps.migratorUrl);
  app = await connect(deps.databaseUrl);
});

afterAll(async () => {
  await disabled?.close();
  await enabled?.close();
  await app?.end();
  await migrator?.end();
});

describe('API de datos de demostración (identity/demo-data)', () => {
  it('[TC-IDENTITY-DEMO-004] /me, la lista y el detalle exponen isDemo; la carga devuelve 202 conforme al contrato', async () => {
    const owner = await user(`kc-demo-api-${randomUUID()}`);
    const r = await call(urlOn, 'POST', `/api/v1/workspaces/${owner.personal}/demo-data`, owner.token);
    expect(r.status).toBe(202);
    conforms('requestDemoData', r);
    const demoId = r.body['demoWorkspaceId'] as string;
    const me = await call(urlOn, 'GET', '/api/v1/me', owner.token);
    conforms('getMe', me);
    expect(me.body['features']).toEqual({ demoData: true });
    expect(
      Object.fromEntries(
        (me.body['memberships'] as { workspaceId: string; isDemo: boolean }[]).map((m) => [
          m.workspaceId,
          m.isDemo,
        ]),
      ),
    ).toEqual({ [owner.personal]: false, [demoId]: true });
    const detail = await call(urlOn, 'GET', `/api/v1/workspaces/${demoId}`, owner.token);
    conforms('getWorkspace', detail);
    expect(detail.body).toMatchObject({ isDemo: true, demoStatus: 'LOADING' });
    const real = await call(urlOn, 'GET', `/api/v1/workspaces/${owner.personal}`, owner.token);
    expect(real.body).toMatchObject({ isDemo: false, demoStatus: null });
    const status = await call(urlOn, 'GET', `/api/v1/workspaces/${owner.personal}/demo-data`, owner.token);
    conforms('getDemoDataStatus', status);
    expect(status.body).toMatchObject({ demoWorkspaceId: demoId, status: 'LOADING' });
    // Un demo que aún carga no se limpia (409 INVALID_STATUS_TRANSITION).
    const early = await call(urlOn, 'POST', `/api/v1/workspaces/${demoId}/demo-data/cleanup`, owner.token);
    expect(early).toMatchObject({ status: 409, body: { code: 'INVALID_STATUS_TRANSITION' } });
  });

  it('[TC-IDENTITY-DEMO-002] un EDITOR del origen recibe 403 INSUFFICIENT_ROLE y no se crea ningún workspace ni job', async () => {
    const owner = await user(`kc-demo-owner-${randomUUID()}`);
    const editor = await user(`kc-demo-editor-${randomUUID()}`);
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.personal },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'EDITOR')`,
          [owner.personal, editor.id],
        ),
      true,
    );
    const r = await call(urlOn, 'POST', `/api/v1/workspaces/${owner.personal}/demo-data`, editor.token);
    expect(r).toMatchObject({ status: 403, body: { code: 'INSUFFICIENT_ROLE' } });
    const me = await call(urlOn, 'GET', '/api/v1/me', editor.token);
    expect((me.body['memberships'] as unknown[]).length).toBe(2);
    const jobs = await migrator.query(
      `SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'demo.load' AND data->'payload'->>'requestedBy' = $1`,
      [editor.id],
    );
    expect(jobs.rows[0]).toEqual({ n: 0 });
  });

  it('[TC-IDENTITY-DEMO-009] con un demo vigente una segunda carga responde 409 DEMO_WORKSPACE_ALREADY_EXISTS', async () => {
    const owner = await user(`kc-demo-twice-${randomUUID()}`);
    expect(
      (await call(urlOn, 'POST', `/api/v1/workspaces/${owner.personal}/demo-data`, owner.token)).status,
    ).toBe(202);
    const again = await call(urlOn, 'POST', `/api/v1/workspaces/${owner.personal}/demo-data`, owner.token);
    expect(again).toMatchObject({ status: 409, body: { code: 'DEMO_WORKSPACE_ALREADY_EXISTS' } });
    const me = await call(urlOn, 'GET', '/api/v1/me', owner.token);
    expect((me.body['memberships'] as unknown[]).length).toBe(2);
  });

  it('[TC-IDENTITY-DEMO-012] con DEMO_DATA_ENABLED=false la carga responde 403 DEMO_DATA_DISABLED y /me lo informa', async () => {
    const owner = await user(`kc-demo-off-${randomUUID()}`);
    const r = await call(urlOff, 'POST', `/api/v1/workspaces/${owner.personal}/demo-data`, owner.token);
    expect(r).toMatchObject({ status: 403, body: { code: 'DEMO_DATA_DISABLED' } });
    conforms('requestDemoData', r);
    expect((await call(urlOff, 'GET', '/api/v1/me', owner.token)).body['features']).toEqual({
      demoData: false,
    });
    // La limpieza de un demo existente sigue disponible (el demo se creó con la carga habilitada).
    const created = await call(urlOn, 'POST', `/api/v1/workspaces/${owner.personal}/demo-data`, owner.token);
    const demoId = created.body['demoWorkspaceId'] as string;
    await inTx(
      app,
      { userId: owner.id, workspaceId: demoId },
      () => app.query(`UPDATE iam.workspace SET demo_status = 'READY' WHERE id = $1`, [demoId]),
      true,
    );
    const cleaned = await call(urlOff, 'POST', `/api/v1/workspaces/${demoId}/demo-data/cleanup`, owner.token);
    expect(cleaned).toMatchObject({ status: 202, body: { status: 'CLEANING' } });
    conforms('cleanupDemoData', cleaned);
  });

  it('[TC-IDENTITY-DEMO-006] limpiar un workspace real responde 409 WORKSPACE_NOT_DEMO sin borrar nada', async () => {
    const owner = await user(`kc-demo-real-${randomUUID()}`);
    const before = await rowsByTable(migrator, owner.personal);
    const r = await call(
      urlOn,
      'POST',
      `/api/v1/workspaces/${owner.personal}/demo-data/cleanup`,
      owner.token,
    );
    expect(r).toMatchObject({ status: 409, body: { code: 'WORKSPACE_NOT_DEMO' } });
    conforms('cleanupDemoData', r);
    const after = await rowsByTable(migrator, owner.personal);
    expect({ ...after, 'platform.idempotency_key': 0 }).toEqual({ ...before, 'platform.idempotency_key': 0 });
    expect(
      (await call(urlOn, 'GET', `/api/v1/workspaces/${owner.personal}`, owner.token)).body['status'],
    ).toBe('ACTIVE');
  });

  it('[TC-IDENTITY-DEMO-010] tras limpiar, el demo responde 404 en toda ruta salvo su estado; repetir la limpieza es 202 sin efectos', async () => {
    const owner = await user(`kc-demo-clean-${randomUUID()}`);
    const created = await call(urlOn, 'POST', `/api/v1/workspaces/${owner.personal}/demo-data`, owner.token);
    const demoId = created.body['demoWorkspaceId'] as string;
    await inTx(
      app,
      { userId: owner.id, workspaceId: demoId },
      () => app.query(`UPDATE iam.workspace SET demo_status = 'READY' WHERE id = $1`, [demoId]),
      true,
    );
    const first = await call(urlOn, 'POST', `/api/v1/workspaces/${demoId}/demo-data/cleanup`, owner.token);
    expect(first).toMatchObject({ status: 202, body: { status: 'CLEANING' } });
    for (const path of ['', '/accounts', '/transactions', '/reports/summary']) {
      const r = await call(urlOn, 'GET', `/api/v1/workspaces/${demoId}${path}`, owner.token);
      expect(r, path).toMatchObject({ status: 404, body: { code: 'RESOURCE_NOT_FOUND' } });
    }
    const list = await call(urlOn, 'GET', '/api/v1/workspaces', owner.token);
    expect((list.body['data'] as { id: string }[]).map((w) => w.id)).toEqual([owner.personal]);
    const again = await call(urlOn, 'POST', `/api/v1/workspaces/${demoId}/demo-data/cleanup`, owner.token);
    expect(again).toMatchObject({ status: 202, body: { status: 'CLEANING' } });
    const purgeJobs = await migrator.query(
      `SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'demo.purge' AND id = $1`,
      [demoId],
    );
    expect(purgeJobs.rows[0]).toEqual({ n: 1 });
    // Un ajeno sigue recibiendo 403 (no se filtra la existencia del demo).
    const stranger = await user(`kc-demo-stranger-${randomUUID()}`);
    expect((await call(urlOn, 'GET', `/api/v1/workspaces/${demoId}`, stranger.token)).status).toBe(403);
  });
});
