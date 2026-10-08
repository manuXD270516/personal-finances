import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import { createCategoryCatalogQuery } from '@pf/classification/interface/classification.module';
import { createFxValuation } from '@pf/fx/interface/fx.module';
import {
  identityWorkspaceCalendarDirectory,
  identityWorkspaceSettingsDirectory,
  identityWorkspaceTimeZones,
} from '@pf/identity/interface/identity.module';
import { ledgerActivityRange } from '@pf/ledger/interface/ledger.module';
import { createPlanningRuntime, type PlanningRuntime } from '@pf/planning/interface/planning.module';
import { ApiContract, runWithRequestContext } from '@pf/platform/api';
import { PgOutboxWriter, type EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { createNominalFlowQuery } from '@pf/transactions/interface/transactions.module';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { AUDIT_POLICIES, outboxPort } from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Templates de presupuesto por HTTP y por el worker contra PostgreSQL real (openspec add-budget-templates, tareas 4.1,
// 5.1 y 7.2): creación y versionado, plan desde template con trazabilidad, roles y auditoría, propagación con vista
// previa y token, archivado (405 en DELETE), y la creación automática de periodos con predeterminado ejecutada dos
// veces (TC-PLANNING-TEMPLATE-011) con el rol del worker.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
// 2026-11-25 (11:00 en La Paz): 2026-11 activo, 2026-12 / 2027-01 / 2027-02 en borrador.
const clock = new FixedClock(Instant.parse('2026-11-25T15:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let worker: Pool;
let planning: PlanningRuntime;

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}
type Money = { amount: string; currency: string };
const bob = (amount: string): Money => ({ amount, currency: 'BOB' });

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
    headers['content-type'] ??= 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;
const W = () => `/api/v1/workspaces/${owner.ws}`;

async function join(member: User, role: 'EDITOR' | 'VIEWER'): Promise<void> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
          [owner.ws, member.id, role],
        ),
      true,
    );
  } finally {
    await app.end();
  }
}

const post = (u: User, path: string, body: unknown) =>
  call('POST', `${W()}${path}`, {
    token: u.token,
    body,
    headers: { 'idempotency-key': randomUUID() },
  });
/** POST sin cuerpo (archive, unarchive, set-default). */
const act = (u: User, path: string) => call('POST', `${W()}${path}`, { token: u.token });
const get = (u: User, path: string) => call('GET', `${W()}${path}`, { token: u.token });
const patch = (u: User, path: string, body: unknown, version: number) =>
  call('PATCH', `${W()}${path}`, {
    token: u.token,
    body,
    headers: { 'content-type': 'application/merge-patch+json', 'if-match': `"${version}"` },
  });
const ok = async (r: Promise<Reply>, status = 201) => {
  const reply = await r;
  expect(reply.status, `${JSON.stringify(reply.body)} ${apiErrors()}`).toBe(status);
  return reply.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code']).toBe(code);
};
const valid = (operationId: string, status: number, r: Reply | Record<string, unknown>) => {
  const body = 'status' in r && 'headers' in r ? (r as Reply).body : r;
  expect(contract.validateResponse(operationId, status, body), JSON.stringify(body)).toEqual([]);
};

let owner: User;
let editor: User;
let viewer: User;
const ids: Record<string, string> = {};

interface Line {
  id: string;
  version: number;
  overridden: boolean;
  source: string;
  planned: Money | null;
  target: { kind: string; id: string };
}
interface Plan extends Record<string, unknown> {
  id: string;
  version: number;
  lines: Line[];
  templateVersion: { templateId: string; versionNo: number; name: string } | null;
  omittedLines?: { target: { id: string }; reason: string }[];
}
const lineOf = (b: Plan, categoryId: string) => b.lines.find((l) => l.target.id === categoryId)!;
const planOf = async (periodLabel: string): Promise<Plan> =>
  (await ok(get(viewer, `/periods/${ids[`p${periodLabel}`]}/budget`), 200)) as Plan;
const line = (categoryId: string, planned: string, kind = 'MAXIMUM') => ({
  target: { kind: 'CATEGORY', id: categoryId },
  kind,
  planned: bob(planned),
});

async function category(groupId: string, name: string) {
  const r = await ok(post(owner, '/categories', { groupId, name }));
  return r['id'] as string;
}

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), apiLog.logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  owner = await user(`kc-tpl-owner-${randomUUID()}`);
  editor = await user(`kc-tpl-editor-${randomUUID()}`);
  viewer = await user(`kc-tpl-viewer-${randomUUID()}`);
  await join(editor, 'EDITOR');
  await join(viewer, 'VIEWER');

  // Composición del worker (pf_worker): la del job `planning.ensure-periods`, con el participante de templates.
  const audit = createAuditRuntime({
    pool: worker,
    clock,
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(worker),
  });
  planning = createPlanningRuntime({
    pool: worker,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    outbox: outboxPort(new PgOutboxWriter(eventSchemaRegistry())),
    calendar: identityWorkspaceCalendarDirectory(worker),
    activity: ledgerActivityRange(),
    budgets: {
      flows: createNominalFlowQuery(worker),
      catalog: createCategoryCatalogQuery({ pool: worker, clock }),
      rates: createFxValuation({ pool: worker, clock, windowDays: 7 }),
      rateValidityWindowDays: 7,
      settings: identityWorkspaceSettingsDirectory(worker),
    },
  });

  const alim = (await ok(post(owner, '/category-groups', { name: 'Alimentación (tpl)', kind: 'EXPENSE' })))[
    'id'
  ] as string;
  const viv = (await ok(post(owner, '/category-groups', { name: 'Vivienda (tpl)', kind: 'EXPENSE' })))[
    'id'
  ] as string;
  const ing = (await ok(post(owner, '/category-groups', { name: 'Ingresos (tpl)', kind: 'INCOME' })))[
    'id'
  ] as string;
  ids['super'] = await category(alim, 'Supermercado (tpl)');
  ids['rest'] = await category(alim, 'Restaurantes (tpl)');
  ids['alq'] = await category(viv, 'Alquiler (tpl)');
  ids['gym'] = await category(viv, 'Gimnasio (tpl)');
  ids['salario'] = await category(ing, 'Salario (tpl)');
  // el saldo inicial del 2026-09-01 hace cubrir los periodos desde "2026-09"
  await ok(
    post(owner, '/accounts', {
      name: 'Banco BOB (tpl)',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: bob('1000.00'), date: '2026-09-01' },
    }),
  );
  await ok(post(owner, '/periods', { through: '2026-12-31' }), 200);
  const periods = await get(owner, '/periods?limit=100');
  for (const p of periods.body['data'] as { id: string; label: string }[]) ids[`p${p.label}`] = p.id;
}, 240_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

describe('Templates versionados (HTTP)', () => {
  it('[TC-PLANNING-TEMPLATE-001] crea "Mes estándar" con su versión 1 (201, Location) y un nombre repetido responde 409 NAME_TAKEN', async () => {
    // sin template predeterminado, los periodos creados no tienen plan
    problem(await get(viewer, `/periods/${ids['p2026-12']}/budget`), 404, 'RESOURCE_NOT_FOUND');
    const created = await post(editor, '/templates', {
      name: 'Mes estándar',
      lines: [
        line(ids['alq']!, '2800.00', 'FIXED'),
        line(ids['super']!, '1500.00'),
        line(ids['salario']!, '8000.00', 'FIXED'),
      ],
    });
    expect(created.status, `${JSON.stringify(created.body)} ${apiErrors()}`).toBe(201);
    valid('createTemplate', 201, created);
    expect(created.body).toMatchObject({
      status: 'ACTIVE',
      currentVersionNo: 1,
      lineCount: 3,
      isDefault: false,
    });
    expect(created.headers.get('location')).toBe(`${W()}/templates/${String(created.body['id'])}`);
    ids['estandar'] = created.body['id'] as string;
    const dup = await post(editor, '/templates', { name: 'mes estándar', lines: [] });
    problem(dup, 409, 'NAME_TAKEN');
    expect(contract.validateResponse('createTemplate', 409, dup.body, 'application/problem+json')).toEqual(
      [],
    );
    const listed = await get(viewer, '/templates');
    expect(listed.status).toBe(200);
    valid('listTemplates', 200, listed);
    expect((listed.body['data'] as unknown[]).length).toBe(1);
  });

  it('[TC-PLANNING-TEMPLATE-003] publicar la versión 2 funciona; una modificación sobre la versión 1 responde 409 CONCURRENCY_CONFLICT', async () => {
    const lines = [
      line(ids['alq']!, '2800.00', 'FIXED'),
      line(ids['super']!, '1600.00'),
      line(ids['salario']!, '8000.00', 'FIXED'),
    ];
    const v2 = await post(editor, `/templates/${ids['estandar']}/versions`, {
      baseVersionNo: 1,
      lines,
      changeNote: 'Inflación',
    });
    expect(v2.status, `${JSON.stringify(v2.body)} ${apiErrors()}`).toBe(201);
    valid('publishTemplateVersion', 201, v2);
    expect(v2.body).toMatchObject({ currentVersionNo: 2 });
    const stale = await post(editor, `/templates/${ids['estandar']}/versions`, { baseVersionNo: 1, lines });
    problem(stale, 409, 'CONCURRENCY_CONFLICT');
    const detail = await get(viewer, `/templates/${ids['estandar']}`);
    valid('getTemplate', 200, detail);
    expect((detail.body['versions'] as unknown[]).length).toBe(2);
    const v1 = await get(viewer, `/templates/${ids['estandar']}/versions/1`);
    valid('getTemplateVersion', 200, v1);
    const supermercado = (
      v1.body['lines'] as { target: { id: string }; max: Money | null; planned: Money | null }[]
    ).find((l) => l.target.id === ids['super']);
    expect(supermercado?.planned).toEqual(bob('1500.00'));
    problem(await get(viewer, `/templates/${ids['estandar']}/versions/3`), 404, 'RESOURCE_NOT_FOUND');
  });

  it('[TC-PLANNING-TEMPLATE-004] el plan de 2026-11 desde el template sin versión toma la 2 y conserva ese origen al publicar la 3', async () => {
    const created = await post(editor, '/budgets', {
      periodId: ids['p2026-11'],
      source: { kind: 'TEMPLATE', templateId: ids['estandar'] },
    });
    expect(created.status, `${JSON.stringify(created.body)} ${apiErrors()}`).toBe(201);
    valid('createBudget', 201, created);
    const plan = created.body as Plan;
    expect(plan).toMatchObject({
      origin: 'TEMPLATE',
      templateVersion: { versionNo: 2, name: 'Mes estándar' },
    });
    expect(lineOf(plan, ids['super']!).planned).toEqual(bob('1600.00'));
    expect(plan.omittedLines).toEqual([]);
    ids['novBudget'] = plan.id;
    // publicar la versión 3 no cambia el origen del plan
    await ok(
      post(editor, `/templates/${ids['estandar']}/versions`, {
        baseVersionNo: 2,
        lines: [line(ids['alq']!, '2900.00', 'FIXED')],
        changeNote: 'Sin supermercado',
      }),
    );
    const again = await planOf('2026-11');
    valid('getBudgetByPeriod', 200, again);
    expect(again.templateVersion).toMatchObject({ versionNo: 2 });
    expect(lineOf(again, ids['super']!).planned).toEqual(bob('1600.00'));
  });

  it('[TC-PLANNING-TEMPLATE-006] aplicar a un periodo que ya tiene plan responde 409 BUDGET_ALREADY_EXISTS sin cambiarlo', async () => {
    const reply = await post(editor, `/templates/${ids['estandar']}/apply`, { periodId: ids['p2026-11'] });
    problem(reply, 409, 'BUDGET_ALREADY_EXISTS');
    expect((await planOf('2026-11')).id).toBe(ids['novBudget']);
  });

  it('[TC-PLANNING-TEMPLATE-019] el VIEWER lee y no versiona; el EDITOR aplica el template y el historial lo registra con origen y omitidas', async () => {
    const viewerRead = await get(viewer, `/templates/${ids['estandar']}`);
    expect(viewerRead.status).toBe(200);
    problem(
      await post(viewer, `/templates/${ids['estandar']}/versions`, { baseVersionNo: 3, lines: [] }),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(await post(viewer, '/templates', { name: 'Otro', lines: [] }), 403, 'INSUFFICIENT_ROLE');
    // "Gimnasio" archivada: la línea se omite al aplicar la versión 3 y se informa
    const t = await ok(
      post(editor, '/templates', {
        name: 'Con gimnasio',
        lines: [line(ids['alq']!, '2800.00', 'FIXED'), line(ids['gym']!, '250.00')],
      }),
    );
    await ok(
      call('POST', `${W()}/categories/${ids['gym']}/archive`, {
        token: owner.token,
        headers: { 'if-match': '"1"' },
      }),
      200,
    );
    const applied = await post(editor, `/templates/${String(t['id'])}/apply`, { periodId: ids['p2026-12'] });
    expect(applied.status, `${JSON.stringify(applied.body)} ${apiErrors()}`).toBe(201);
    valid('applyTemplate', 201, applied);
    const plan = applied.body as Plan;
    expect(plan.lines.map((l) => l.target.id)).toEqual([ids['alq']]);
    expect(plan.omittedLines).toEqual([
      { target: { kind: 'CATEGORY', id: ids['gym'] }, reason: 'TARGET_ARCHIVED' },
    ]);
    ids['conGimnasio'] = t['id'] as string;
    const history = await call('GET', `${W()}/budgets/${plan.id}/history`, { token: viewer.token });
    expect(history.status).toBe(200);
    const entries = history.body['data'] as {
      action: string;
      actor: { userId: string | null };
      changes: { field: string; after: unknown }[];
    }[];
    const created = entries.find((e) => e.action === 'planning.budget.created')!;
    expect(created.actor.userId).toBe(editor.id);
    const fields = Object.fromEntries(created.changes.map((c) => [c.field, c.after]));
    expect(fields).toMatchObject({ origin: 'TEMPLATE', templateId: t['id'], templateVersionNo: 1 });
    expect(JSON.parse(String(fields['omittedLines']))).toEqual([
      { target: `CATEGORY:${ids['gym']}`, reason: 'TARGET_ARCHIVED' },
    ]);
  });
});

describe('Propagación a meses futuros (HTTP)', () => {
  it('[TC-PLANNING-TEMPLATE-016] la edición entre la vista previa y la confirmación responde 409 BUDGET_PROPAGATION_STALE sin cambios; [TC-PLANNING-TEMPLATE-015] la vista previa nueva se confirma', async () => {
    const t = await ok(
      post(owner, '/templates', {
        name: 'Propagable',
        lines: [line(ids['alq']!, '2800.00', 'FIXED'), line(ids['rest']!, '600.00')],
      }),
    );
    const templateId = t['id'] as string;
    for (const label of ['2027-01', '2027-02']) {
      await ok(
        post(editor, '/budgets', { periodId: ids[`p${label}`], source: { kind: 'TEMPLATE', templateId } }),
      );
    }
    // 2027-01 tiene Restaurantes modificado a mano en 700.00
    const jan = await planOf('2027-01');
    const janRest = lineOf(jan, ids['rest']!);
    const edited = await patch(
      editor,
      `/budgets/${jan.id}/lines/${janRest.id}`,
      { planned: bob('700.00') },
      janRest.version,
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({ overridden: true });

    const source = {
      kind: 'TEMPLATE',
      templateId,
      baseVersionNo: 1,
      lines: [line(ids['alq']!, '2800.00', 'FIXED'), line(ids['rest']!, '650.00')],
    };
    const preview = await post(editor, '/budget-propagations/preview', { source });
    expect(preview.status, `${JSON.stringify(preview.body)} ${apiErrors()}`).toBe(200);
    valid('previewBudgetPropagation', 200, preview);
    expect((preview.body['periods'] as { periodLabel: string }[]).map((p) => p.periodLabel)).toEqual([
      '2027-01',
      '2027-02',
    ]);
    expect(preview.body['changes']).toEqual([
      expect.objectContaining({ periodLabel: '2027-02', action: 'UPDATE' }),
    ]);
    expect(preview.body['conflicts']).toEqual([
      expect.objectContaining({ periodLabel: '2027-01', reason: 'OVERRIDDEN' }),
    ]);
    // alguien edita el plan de 2027-02 entre la vista previa y la confirmación
    const feb = await planOf('2027-02');
    const febAlq = lineOf(feb, ids['alq']!);
    await ok(
      patch(editor, `/budgets/${feb.id}/lines/${febAlq.id}`, { planned: bob('2850.00') }, febAlq.version),
      200,
    );
    const stale = await post(editor, '/budget-propagations/confirm', {
      source,
      token: preview.body['token'],
    });
    problem(stale, 409, 'BUDGET_PROPAGATION_STALE');
    expect(
      ((await get(viewer, `/templates/${templateId}`)).body as Record<string, unknown>)['currentVersionNo'],
    ).toBe(1);
    expect(lineOf(await planOf('2027-02'), ids['rest']!).planned).toEqual(bob('600.00'));

    // vista previa nueva y confirmación
    const fresh = await post(editor, '/budget-propagations/preview', { source });
    const confirmed = await post(editor, '/budget-propagations/confirm', {
      source,
      token: fresh.body['token'],
      changeNote: 'Restaurantes sube',
    });
    expect(confirmed.status, `${JSON.stringify(confirmed.body)} ${apiErrors()}`).toBe(200);
    valid('confirmBudgetPropagation', 200, confirmed);
    expect((confirmed.body['template'] as { currentVersionNo: number }).currentVersionNo).toBe(2);
    expect(lineOf(await planOf('2027-02'), ids['rest']!).planned).toEqual(bob('650.00'));
    expect(lineOf(await planOf('2027-01'), ids['rest']!).planned).toEqual(bob('700.00'));
    expect((await planOf('2027-02')).templateVersion).toMatchObject({ versionNo: 2 });
    // los planes de periodos no borrador no se tocan (2026-11 activo sigue en su versión)
    expect((await planOf('2026-11')).templateVersion).toMatchObject({ versionNo: 2, name: 'Mes estándar' });
  });

  it('propagar desde un plan sin template responde 422 BUDGET_NO_TEMPLATE_ORIGIN (docs/33 D84)', async () => {
    const empty = await ok(post(editor, '/budgets', { periodId: ids['p2026-10'] }));
    const added = await ok(
      post(editor, `/budgets/${String(empty['id'])}/lines`, line(ids['alq']!, '2800.00', 'FIXED')),
    );
    const reply = await post(editor, '/budget-propagations/preview', {
      source: { kind: 'BUDGET', budgetId: empty['id'], lineIds: [added['id']] },
    });
    problem(reply, 422, 'BUDGET_NO_TEMPLATE_ORIGIN');
  });
});

describe('Clonar, predeterminado y archivar (HTTP)', () => {
  it('[TC-PLANNING-TEMPLATE-014] clonar crea un template independiente; marcar otro predeterminado deja uno solo', async () => {
    const clone = await post(editor, `/templates/${ids['estandar']}/clone`, {
      name: 'Mes de vacaciones',
      versionNo: 2,
    });
    expect(clone.status, `${JSON.stringify(clone.body)} ${apiErrors()}`).toBe(201);
    valid('cloneTemplate', 201, clone);
    ids['vacaciones'] = clone.body['id'] as string;
    expect(clone.body).toMatchObject({ currentVersionNo: 1, lineCount: 3 });
    await ok(act(editor, `/templates/${ids['estandar']}/set-default`), 200);
    const second = await act(editor, `/templates/${ids['vacaciones']}/set-default`);
    expect(second.status).toBe(200);
    valid('setDefaultTemplate', 200, second);
    const list = (await get(viewer, '/templates')).body['data'] as { id: string; isDefault: boolean }[];
    expect(list.filter((t) => t.isDefault).map((t) => t.id)).toEqual([ids['vacaciones']]);
  });

  it('[TC-PLANNING-TEMPLATE-018] archivado: aplicar responde 409 BUDGET_TEMPLATE_ARCHIVED, DELETE 405 y los planes previos conservan su origen', async () => {
    const applied = await ok(
      post(editor, `/templates/${ids['vacaciones']}/apply`, { periodId: ids['p2026-09'] }),
    );
    expect((applied as Plan).templateVersion).toMatchObject({ name: 'Mes de vacaciones', versionNo: 1 });
    const archived = await act(editor, `/templates/${ids['vacaciones']}/archive`);
    expect(archived.status).toBe(200);
    valid('archiveTemplate', 200, archived);
    expect(archived.body).toMatchObject({ status: 'ARCHIVED', isDefault: false });
    const reply = await post(editor, '/budgets', {
      periodId: ids['p2026-12'],
      source: { kind: 'TEMPLATE', templateId: ids['vacaciones'] },
    });
    problem(reply, 409, 'BUDGET_TEMPLATE_ARCHIVED');
    const del = await call('DELETE', `${W()}/templates/${ids['vacaciones']}`, { token: editor.token });
    problem(del, 405, 'METHOD_NOT_ALLOWED');
    expect((await planOf('2026-09')).templateVersion).toMatchObject({
      name: 'Mes de vacaciones',
      versionNo: 1,
    });
    problem(
      await act(editor, `/templates/${ids['vacaciones']}/set-default`),
      409,
      'BUDGET_TEMPLATE_ARCHIVED',
    );
    const back = await act(editor, `/templates/${ids['vacaciones']}/unarchive`);
    expect(back.status).toBe(200);
  });
});

describe('Creación automática de periodos con predeterminado (worker, PG real)', () => {
  const outboxOf = async (eventType: string) => {
    const { rows } = await worker.query<{ envelope: EventEnvelope }>(
      'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = $2 ORDER BY sequence',
      [owner.ws, eventType],
    );
    return rows.map((r) => r.envelope);
  };
  const ensure = () =>
    runWithRequestContext(
      { actor: { type: 'WORKER', process: 'planning.ensure-periods:test' }, origin: 'system' },
      () => planning.service.ensurePeriods({ workspaceId: owner.ws }),
    );

  it('[TC-PLANNING-TEMPLATE-010] el predeterminado se aplica al periodo nuevo y [TC-PLANNING-TEMPLATE-011] ejecutarlo dos veces deja un solo plan', async () => {
    await ok(act(editor, `/templates/${ids['estandar']}/set-default`), 200);
    const before = (await outboxOf('planning.BudgetCreated')).length;
    // el 2026-12-01 el job crea "2027-03" (anticipación de 3 periodos)
    clock.set(Instant.parse('2026-12-01T15:00:00Z'));
    const first = await ensure();
    expect(first.created.map((p) => p.label)).toEqual(['2027-03']);
    const second = await ensure();
    expect(second.created).toEqual([]);
    const periods = await get(owner, '/periods?limit=100');
    ids['p2027-03'] = (periods.body['data'] as { id: string; label: string }[]).find(
      (p) => p.label === '2027-03',
    )!.id;
    const plan = await planOf('2027-03');
    expect(plan).toMatchObject({
      origin: 'TEMPLATE',
      templateVersion: { name: 'Mes estándar', versionNo: 3 },
    });
    expect(plan.lines.map((l) => l.target.id)).toEqual([ids['alq']]);
    const events = (await outboxOf('planning.BudgetCreated')).slice(before);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      origin: 'TEMPLATE',
      periodLabel: '2027-03',
      templateVersionNo: 3,
    });
    const list = await get(viewer, '/budgets?periodFrom=2027-03&periodTo=2027-03');
    expect((list.body['data'] as unknown[]).length).toBe(1);
  });
});
