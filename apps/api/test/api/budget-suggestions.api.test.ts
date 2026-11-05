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

// Sugerencias de presupuesto desde el historial por HTTP contra PostgreSQL real (openspec add-historical-budgets,
// tareas 5.2 y 7.1): vista previa sin efectos, explicación, confirmación atómica con monto editado, token obsoleto con
// un gasto concurrente, roles, periodo cerrado y auditoría con identificador de operación común. El historial son
// gastos reales de mayo a octubre de 2026 (hoy = 2026-11-25).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
const clock = new FixedClock(Instant.parse('2026-11-25T15:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;

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
let owner: User;
let editor: User;
let viewer: User;
let late: User;
const W = (u: User) => `/api/v1/workspaces/${u === late ? late.ws : owner.ws}`;

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

const post = (u: User, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });
const ok = async (r: Promise<Reply>, status = 201) => {
  const reply = await r;
  expect(reply.status, `${JSON.stringify(reply.body)} ${apiErrors()}`).toBe(status);
  return reply.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code']).toBe(code);
};

async function setPeriodStatus(ws: string, label: string, status: 'CLOSED' | 'ACTIVE') {
  const admin = await connect(deps.superuserUrl);
  try {
    await admin.query(
      `UPDATE planning.financial_period
          SET status = $3, close_count = CASE WHEN $3 = 'ACTIVE' THEN 0 ELSE 1 END,
              latest_close_no = CASE WHEN $3 = 'ACTIVE' THEN NULL ELSE 1 END
        WHERE workspace_id = $1 AND label = $2`,
      [ws, label, status],
    );
  } finally {
    await admin.end();
  }
}

const ids: Record<string, string> = {};
const lateIds: Record<string, string> = {};

interface SuggestionLine {
  target: { kind: string; id: string };
  kind: string;
  existingLineId: string | null;
  currentAmount: Money | null;
  suggestedAmount: Money | null;
  difference: Money | null;
  status: string;
  explanation: {
    usedCount: number;
    mean: string | null;
    median: string | null;
    suggested: Money | null;
    periods: { label: string; status: string; actual: Money | null }[];
  } | null;
}
interface Preview extends Record<string, unknown> {
  token: string;
  window: { label: string; periodId: string | null }[];
  lines: SuggestionLine[];
}
const suggestionOf = (p: Preview, categoryId: string) => p.lines.find((l) => l.target.id === categoryId)!;
const cat = (categoryId: string) => ({ kind: 'CATEGORY', id: categoryId });

async function previewOf(u: User, request: Record<string, unknown>): Promise<Preview> {
  const r = await post(u, '/budget-suggestions/preview', request);
  expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(200);
  expect(contract.validateResponse('previewBudgetSuggestions', 200, r.body), JSON.stringify(r.body)).toEqual(
    [],
  );
  return r.body as Preview;
}

async function spend(
  u: User,
  accountId: string,
  categoryId: string,
  amount: string,
  date: string,
  currency = 'BOB',
) {
  return ok(
    post(u, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: date,
      accountId,
      amount: { amount, currency },
      splits: [{ amount: { amount, currency }, categoryId }],
    }),
  );
}

async function category(u: User, groupId: string, name: string) {
  const r = await ok(post(u, '/categories', { groupId, name }));
  return r['id'] as string;
}

async function account(u: User, name: string, currency: string, opening: string, date: string) {
  const r = await ok(
    post(u, '/accounts', {
      name,
      type: 'BANK',
      currency,
      openingBalance: { amount: { amount: opening, currency }, date },
    }),
  );
  return r['id'] as string;
}

/** Real de "Supermercado" de 2026-05 a 2026-10 (TC-PLANNING-HISTBUDGET-008). */
const VIAJE = ['1420.00', '1515.50', '1380.00', '3950.00', '1610.00', '1474.50'];
const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

beforeAll(async () => {
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
  owner = await user(`kc-hb-owner-${randomUUID()}`);
  editor = await user(`kc-hb-editor-${randomUUID()}`);
  viewer = await user(`kc-hb-viewer-${randomUUID()}`);
  late = await user(`kc-hb-late-${randomUUID()}`);
  await join(editor, 'EDITOR');
  await join(viewer, 'VIEWER');

  const mkGroup = async (u: User, name: string, kind: string) =>
    (await ok(post(u, '/category-groups', { name, kind })))['id'] as string;
  const alim = await mkGroup(owner, 'Alimentación (hb)', 'EXPENSE');
  const ing = await mkGroup(owner, 'Ingresos (hb)', 'INCOME');
  ids['super'] = await category(owner, alim, 'Supermercado (hb)');
  ids['rest'] = await category(owner, alim, 'Restaurantes (hb)');
  ids['mascotas'] = await category(owner, alim, 'Mascotas (hb)');
  ids['salario'] = await category(owner, ing, 'Salario (hb)');
  ids['banco'] = await account(owner, 'Banco BOB (hb)', 'BOB', '100000.00', '2026-01-01');
  for (const [i, month] of MONTHS.entries()) {
    await spend(owner, ids['banco']!, ids['super']!, VIAJE[i]!, `${month}-15`);
    await spend(owner, ids['banco']!, ids['rest']!, '630.00', `${month}-16`);
  }
  await ok(post(owner, '/periods', { through: '2026-12-31' }), 200);
  const periods = await get(owner, '/periods?limit=100');
  for (const p of periods.body['data'] as { id: string; label: string }[]) ids[`p${p.label}`] = p.id;

  // Plan de 2026-11 desde "Mes estándar" (Supermercado 1500.00, Restaurantes 600.00, Salario 7800.00).
  const line = (categoryId: string, planned: string, kind: string) => ({
    target: cat(categoryId),
    kind,
    planned: bob(planned),
  });
  const tpl = await ok(
    post(editor, '/templates', {
      name: 'Mes estándar (hb)',
      lines: [
        line(ids['super']!, '1500.00', 'MAXIMUM'),
        line(ids['rest']!, '600.00', 'MAXIMUM'),
        line(ids['salario']!, '7800.00', 'FIXED'),
      ],
    }),
  );
  ids['tpl'] = tpl['id'] as string;

  // Otro workspace con la primera actividad a mitad de agosto y gasto en dólares sin tasa (TC-005 y TC-006).
  const lgroup = await mkGroup(late, 'Gastos (late)', 'EXPENSE');
  lateIds['rest'] = await category(late, lgroup, 'Restaurantes (late)');
  lateIds['viajes'] = await category(late, lgroup, 'Viajes (late)');
  lateIds['banco'] = await account(late, 'Banco BOB (late)', 'BOB', '50000.00', '2026-08-20');
  lateIds['usd'] = await account(late, 'Banco USD (late)', 'USD', '1000.00', '2026-08-20');
  await spend(late, lateIds['banco']!, lateIds['rest']!, '210.00', '2026-08-25');
  await spend(late, lateIds['banco']!, lateIds['rest']!, '610.00', '2026-09-15');
  await spend(late, lateIds['banco']!, lateIds['rest']!, '650.00', '2026-10-15');
  await spend(late, lateIds['banco']!, lateIds['viajes']!, '300.00', '2026-09-03');
  await spend(late, lateIds['usd']!, lateIds['viajes']!, '40.00', '2026-10-03', 'USD');
  await spend(late, lateIds['banco']!, lateIds['viajes']!, '500.00', '2026-10-20');
  await ok(post(late, '/periods', { through: '2026-12-31' }), 200);
  const latePeriods = await get(late, '/periods?limit=100');
  for (const p of latePeriods.body['data'] as { id: string; label: string }[]) lateIds[`p${p.label}`] = p.id;
}, 300_000);

afterAll(async () => {
  await runtime?.close();
});

describe('Sugerencias de presupuesto desde el historial (HTTP)', () => {
  it('[TC-PLANNING-HISTBUDGET-018] un periodo sin plan propone líneas MAXIMUM solo para las categorías con gasto', async () => {
    const p = await previewOf(viewer, { periodId: ids['p2026-12'], periods: 6 });
    expect(p['budgetId']).toBeNull();
    const targets = p.lines.map((l) => l.target.id);
    expect(targets).toContain(ids['super']);
    expect(targets).toContain(ids['rest']);
    expect(targets).not.toContain(ids['mascotas']);
    expect(p.lines.every((l) => l.existingLineId === null && l.kind === 'MAXIMUM')).toBe(true);
  });

  it('[TC-PLANNING-HISTBUDGET-016] la explicación lista los 6 periodos con el atípico, el promedio, la mediana y la diferencia', async () => {
    const plan = await ok(
      post(editor, '/budgets', {
        periodId: ids['p2026-11'],
        source: { kind: 'TEMPLATE', templateId: ids['tpl'] },
      }),
    );
    ids['plan'] = plan['id'] as string;
    const p = await previewOf(viewer, { periodId: ids['p2026-11'], periods: 6 });
    const sup = suggestionOf(p, ids['super']!);
    expect(sup).toMatchObject({
      status: 'OK',
      currentAmount: bob('1500.00'),
      suggestedAmount: bob('1480.00'),
      difference: bob('-20.00'),
    });
    expect(sup.explanation).toMatchObject({ usedCount: 5, mean: '1480.00', median: '1474.50' });
    expect(sup.explanation?.periods.map((x) => [x.label, x.status])).toEqual(
      MONTHS.map((l) => [l, l === '2026-08' ? 'OUTLIER' : 'USED']),
    );
    expect(suggestionOf(p, ids['rest']!).suggestedAmount).toEqual(bob('630.00'));
    // sin ingresos registrados, cada periodo cuenta como 0.00 (no como dato faltante)
    expect(suggestionOf(p, ids['salario']!)).toMatchObject({ status: 'OK', suggestedAmount: bob('0.00') });
  });

  it('[TC-PLANNING-HISTBUDGET-019] la vista previa no cambia el plan ni deja registros de auditoría', async () => {
    const before = await get(viewer, `/budgets/${ids['plan']}`);
    const historyBefore = await get(viewer, `/budgets/${ids['plan']}/history`);
    await previewOf(viewer, { periodId: ids['p2026-11'], periods: 6 });
    const after = await get(viewer, `/budgets/${ids['plan']}`);
    const historyAfter = await get(viewer, `/budgets/${ids['plan']}/history`);
    expect(after.body['version']).toBe(before.body['version']);
    expect((historyAfter.body['data'] as unknown[]).length).toBe(
      (historyBefore.body['data'] as unknown[]).length,
    );
  });

  it('[TC-PLANNING-HISTBUDGET-026] un VIEWER ve la vista previa pero no confirma (403 INSUFFICIENT_ROLE)', async () => {
    const p = await previewOf(viewer, { periodId: ids['p2026-11'], periods: 6 });
    const denied = await post(viewer, '/budget-suggestions/confirm', {
      token: p.token,
      request: { periodId: ids['p2026-11'], periods: 6 },
      lines: [{ target: cat(ids['super']!), amount: bob('1480.00'), suggestedAmount: bob('1480.00') }],
    });
    problem(denied, 403, 'INSUFFICIENT_ROLE');
  });

  it('[TC-PLANNING-HISTBUDGET-005] [TC-PLANNING-HISTBUDGET-026] el periodo con la primera actividad es INCOMPLETE y los flujos de otro workspace no entran', async () => {
    const lateBudget = await ok(post(late, '/budgets', { periodId: lateIds['p2026-11'] }));
    await ok(
      post(late, `/budgets/${String(lateBudget['id'])}/lines`, {
        target: cat(lateIds['rest']!),
        kind: 'MAXIMUM',
        planned: bob('600.00'),
      }),
    );
    const p = await previewOf(late, { periodId: lateIds['p2026-11'], periods: 3 });
    const rest = suggestionOf(p, lateIds['rest']!);
    expect(rest.explanation?.periods.map((x) => [x.label, x.status])).toEqual([
      ['2026-08', 'INCOMPLETE'],
      ['2026-09', 'USED'],
      ['2026-10', 'USED'],
    ]);
    expect(rest.suggestedAmount).toEqual(bob('630.00'));
    // el gasto del owner (mismas fechas) no aparece: solo se ven categorías propias
    expect(p.lines.every((l) => l.target.id !== ids['super'])).toBe(true);
  });

  it('[TC-PLANNING-HISTBUDGET-006] el gasto en dólares sin tasa deja NO_RATE solo esa línea y ese periodo', async () => {
    const lateBudget = await get(late, `/periods/${lateIds['p2026-11']}/budget`);
    await ok(
      post(late, `/budgets/${String(lateBudget.body['id'])}/lines`, {
        target: cat(lateIds['viajes']!),
        kind: 'MAXIMUM',
        planned: bob('400.00'),
      }),
    );
    const p = await previewOf(late, { periodId: lateIds['p2026-11'], periods: 3 });
    const viajes = suggestionOf(p, lateIds['viajes']!);
    expect(viajes.explanation?.periods.map((x) => [x.label, x.status])).toEqual([
      ['2026-08', 'INCOMPLETE'],
      ['2026-09', 'USED'],
      ['2026-10', 'NO_RATE'],
    ]);
    // 2 periodos válidos requeridos: solo 1 (2026-09) => sin sugerencia; las demás líneas no cambian
    expect(viajes.status).toBe('INSUFFICIENT_HISTORY');
    const rest = suggestionOf(p, lateIds['rest']!);
    expect(rest.explanation?.periods.every((x) => x.status !== 'NO_RATE')).toBe(true);
  });

  it('[TC-PLANNING-HISTBUDGET-022] un gasto nuevo entre la vista previa y la confirmación da 409 BUDGET_SUGGESTION_STALE', async () => {
    const request = { periodId: ids['p2026-11'], periods: 6 };
    const p = await previewOf(editor, request);
    const planBefore = await get(viewer, `/budgets/${ids['plan']}`);
    await spend(owner, ids['banco']!, ids['super']!, '200.00', '2026-09-12');
    const stale = await post(editor, '/budget-suggestions/confirm', {
      token: p.token,
      request,
      lines: [{ target: cat(ids['super']!), amount: bob('1480.00'), suggestedAmount: bob('1480.00') }],
    });
    problem(stale, 409, 'BUDGET_SUGGESTION_STALE');
    expect(
      contract.validateResponse('confirmBudgetSuggestions', 409, stale.body, 'application/problem+json'),
    ).toEqual([]);
    const planAfter = await get(viewer, `/budgets/${ids['plan']}`);
    expect(planAfter.body['version']).toBe(planBefore.body['version']);
  });

  it('[TC-PLANNING-HISTBUDGET-021] un monto negativo rechaza toda la confirmación con 422 BUDGET_INVALID_AMOUNTS', async () => {
    const request = { periodId: ids['p2026-11'], periods: 6 };
    const p = await previewOf(editor, request);
    const sup = suggestionOf(p, ids['super']!);
    const rest = suggestionOf(p, ids['rest']!);
    const planBefore = await get(viewer, `/budgets/${ids['plan']}`);
    const bad = await post(editor, '/budget-suggestions/confirm', {
      token: p.token,
      request,
      lines: [
        { target: cat(ids['super']!), amount: sup.suggestedAmount, suggestedAmount: sup.suggestedAmount },
        { target: cat(ids['rest']!), amount: bob('-10.00'), suggestedAmount: rest.suggestedAmount },
      ],
    });
    problem(bad, 422, 'BUDGET_INVALID_AMOUNTS');
    const planAfter = await get(viewer, `/budgets/${ids['plan']}`);
    expect(planAfter.body['version']).toBe(planBefore.body['version']);
  });

  it('[TC-PLANNING-HISTBUDGET-020] [TC-PLANNING-HISTBUDGET-028] confirmar dos líneas con un monto editado: base, template intacto y auditoría con operationId común', async () => {
    const request = { periodId: ids['p2026-11'], periods: 6 };
    const p = await previewOf(editor, request);
    const sup = suggestionOf(p, ids['super']!);
    const rest = suggestionOf(p, ids['rest']!);
    // el gasto de 200.00 del caso anterior ya cuenta en 2026-09: la sugerencia vigente es la de la vista previa
    const confirmed = await post(editor, '/budget-suggestions/confirm', {
      token: p.token,
      request,
      lines: [
        { target: cat(ids['super']!), amount: sup.suggestedAmount, suggestedAmount: sup.suggestedAmount },
        { target: cat(ids['rest']!), amount: bob('650.00'), suggestedAmount: rest.suggestedAmount },
      ],
    });
    expect(confirmed.status, `${JSON.stringify(confirmed.body)} ${apiErrors()}`).toBe(200);
    expect(contract.validateResponse('confirmBudgetSuggestions', 200, confirmed.body)).toEqual([]);
    const lines = confirmed.body['lines'] as {
      target: { id: string };
      planned: Money | null;
      overridden: boolean;
      historyBasis: { suggested: Money; applied: Money; modifiedAfterSuggestion: boolean } | null;
    }[];
    const lSup = lines.find((l) => l.target.id === ids['super'])!;
    const lRest = lines.find((l) => l.target.id === ids['rest'])!;
    const lSal = lines.find((l) => l.target.id === ids['salario'])!;
    expect(lSup.planned).toEqual(sup.suggestedAmount);
    expect(lSup.overridden).toBe(true);
    expect(lSup.historyBasis).toMatchObject({
      suggested: sup.suggestedAmount,
      modifiedAfterSuggestion: false,
    });
    expect(lRest.planned).toEqual(bob('650.00'));
    expect(lRest.historyBasis).toMatchObject({ suggested: bob('630.00'), applied: bob('650.00') });
    expect(lSal.planned).toEqual(bob('7800.00'));
    expect(lSal.historyBasis).toBeNull();
    const template = await get(viewer, `/templates/${ids['tpl']}`);
    expect(template.body['currentVersionNo']).toBe(1);

    const history = await get(viewer, `/budgets/${ids['plan']}/history`);
    expect(contract.validateResponse('getBudgetHistory', 200, history.body)).toEqual([]);
    const entries = (
      history.body['data'] as {
        action: string;
        changes: { field: string; before: unknown; after: unknown }[];
      }[]
    ).filter((e) => e.action === 'planning.budget.line_updated');
    const withBasis = entries.filter((e) => e.changes.some((c) => c.field === 'historyBasis'));
    expect(withBasis).toHaveLength(2);
    const operations = withBasis.map((e) => e.changes.find((c) => c.field === 'operationId')?.after);
    expect(operations[0]).toBeTruthy();
    expect(new Set(operations).size).toBe(1);
    expect(withBasis.some((e) => JSON.stringify(e.changes).includes('600.00'))).toBe(true);
  });

  it('[TC-PLANNING-HISTBUDGET-027] confirmar en un periodo cerrado se rechaza con 409 PERIOD_CLOSED', async () => {
    const request = { periodId: ids['p2026-11'], periods: 6 };
    const p = await previewOf(editor, request);
    const sup = suggestionOf(p, ids['super']!);
    await setPeriodStatus(owner.ws, '2026-11', 'CLOSED');
    try {
      const closed = await post(editor, '/budget-suggestions/confirm', {
        token: p.token,
        request,
        lines: [{ target: cat(ids['super']!), amount: bob('1.00'), suggestedAmount: sup.suggestedAmount }],
      });
      problem(closed, 409, 'PERIOD_CLOSED');
    } finally {
      await setPeriodStatus(owner.ws, '2026-11', 'ACTIVE');
    }
  });

  it('[TC-PLANNING-HISTBUDGET-024] el aislamiento: los parámetros inválidos responden 422 y un periodo ajeno 422 REFERENCE_NOT_FOUND', async () => {
    problem(
      await post(viewer, '/budget-suggestions/preview', {
        periodId: ids['p2026-11'],
        periods: 6,
        roundingIncrement: 7,
      }),
      400,
      'VALIDATION_FAILED',
    );
    problem(
      await post(viewer, '/budget-suggestions/preview', { periodId: lateIds['p2026-11'] }),
      422,
      'REFERENCE_NOT_FOUND',
    );
  });
});
