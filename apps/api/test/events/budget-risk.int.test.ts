import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { CASH_FLOW_WATCH_JOB } from '@pf/reporting/contracts';
import { Instant, type FixedClock } from '@pf/shared-kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asAdmin,
  contract,
  money,
  startHarness,
  until,
  w1Api,
  type Harness,
  type Json,
  type User,
} from '../support/portability.js';

// Riesgo de exceder un presupuesto de punta a punta contra PostgreSQL real, pg-boss real y el worker (openspec
// add-budget-overrun-risk, tareas 4.2 y 5.1; TC-REPORTING-INSIGHT-001, -005, -014, -016 y TC-NOTIFICATIONS-BUDGETRISK-001..003):
// plan con una línea máximo y gastos reales por la API → `getBudgetRisk` y bloque del Home → paso de avisos de
// `reporting.cash-flow-watch` (aviso una sola vez por línea y periodo, solo a quien activó el tipo) → aislamiento.
let h: Harness;
let owner: User;
let editor: User;
let other: User;
let ws: string;
let periodId: string;
let budgetId: string;
let lineId: string;
let category: string;

const api = () => w1Api(h, { ws });
const ok = (r: { status: number; body: Json }, status = 200) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
};

async function runWatch(): Promise<void> {
  const id = await h.worker!.queue.send(CASH_FLOW_WATCH_JOB, { trigger: 'manual' });
  await until(async () => {
    const state = await asAdmin(h, async (c) => {
      const { rows } = await c.query<{ state: string }>(
        `SELECT state FROM pgboss.job WHERE name = $1 AND id = $2`,
        [CASH_FLOW_WATCH_JOB, id],
      );
      return rows[0]?.state;
    });
    if (state === 'failed' || state === 'cancelled') throw new Error(`el job terminó ${state}`);
    return state === 'completed' ? true : undefined;
  }, 90_000);
}

const notices = () =>
  asAdmin(
    h,
    async (c) =>
      (
        await c.query<{ budget_line_id: string; level: string; estimated_date: string | null }>(
          `SELECT budget_line_id::text AS budget_line_id, level, estimated_date::text AS estimated_date
             FROM reporting.budget_overrun_notice WHERE workspace_id = $1`,
          [ws],
        )
      ).rows,
  );
const riskNotifications = () =>
  asAdmin(
    h,
    async (c) =>
      (
        await c.query<{ user_id: string }>(
          `SELECT user_id::text AS user_id FROM notifications.notification
            WHERE workspace_id = $1 AND notification_type = 'BUDGET_OVERRUN_RISK'`,
          [ws],
        )
      ).rows,
  );

beforeAll(async () => {
  h = await startHarness({
    workerEnv: { REPORTING_CASH_FLOW_WATCH_CRON: 'off', NOTIFICATIONS_DIGEST_CRON: 'off' },
    worker: { commitmentsOnStart: false, importsOnStart: false },
  });
  // 2026-11-10 (12:00 en La Paz): 10 días transcurridos y 20 restantes del periodo 2026-11.
  (h.clock as FixedClock).set(Instant.parse('2026-11-10T16:00:00Z'));
  owner = await h.user(`kc-bor-owner-${randomUUID()}`);
  ws = owner.ws;
  const e = await h.user(`kc-bor-editor-${randomUUID()}`);
  await asAdmin(h, async (c) => {
    await c.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'EDITOR', 'ACTIVE')`,
      [ws, e.id],
    );
  });
  editor = { ...e, ws };
  other = await h.user(`kc-bor-other-${randomUUID()}`);
  const a = api();
  const bank = ok(
    await a.post(owner, '/accounts', {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('5000.00'), date: '2026-10-01' },
    }),
    201,
  )['id'] as string;
  const group = ok(await a.post(owner, '/category-groups', { name: 'Comida', kind: 'EXPENSE' }), 201);
  category = ok(await a.post(owner, '/categories', { groupId: group['id'], name: 'Restaurantes' }), 201)[
    'id'
  ] as string;
  ok(await a.post(owner, '/periods', { through: '2026-12-31' }));
  const periods = ok(await a.get(owner, '/periods?limit=100'))['data'] as { id: string; label: string }[];
  periodId = periods.find((p) => p.label === '2026-11')!.id;
  const plan = ok(await a.post(owner, '/budgets', { periodId, source: { kind: 'EMPTY' } }), 201);
  budgetId = plan['id'] as string;
  const line = ok(
    await a.post(owner, `/budgets/${budgetId}/lines`, {
      target: { kind: 'CATEGORY', id: category },
      kind: 'MAXIMUM',
      planned: money('600.00'),
    }),
    201,
  );
  lineId = line['id'] as string;
  ok(
    await a.post(owner, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-11-05',
      accountId: bank,
      amount: money('280.00'),
      splits: [{ amount: money('280.00'), categoryId: category }],
    }),
    201,
  );
}, 600_000);

afterAll(async () => {
  await h?.close();
});

describe('Riesgo de exceder un presupuesto (API)', () => {
  it('[TC-REPORTING-INSIGHT-001] [TC-REPORTING-INSIGHT-014] Restaurantes proyecta 840.00, riesgo LIKELY y fecha 2026-11-22 con el ritmo del periodo', async () => {
    const r = await api().get(owner, `/periods/${periodId}/budget-risk`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('getBudgetRisk', 200, r.body), JSON.stringify(r.body)).toEqual([]);
    expect(r.body).toMatchObject({
      status: 'AVAILABLE',
      periodId,
      budgetId,
      asOf: '2026-11-10',
      currency: 'BOB',
      elapsedDays: 10,
      remainingDays: 20,
      forecastRunId: null,
    });
    const lines = r.body['lines'] as Json[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      budgetLineId: lineId,
      targetName: 'Restaurantes',
      reference: { amount: '600.00', currency: 'BOB' },
      actual: { amount: '280.00', currency: 'BOB' },
      projected: { amount: '840.00', currency: 'BOB' },
      projectedHigh: null,
      level: 'LIKELY',
      basis: 'RUN_RATE',
      estimatedDate: '2026-11-22',
      projectionComplete: true,
    });
  }, 120_000);

  it('[TC-REPORTING-INSIGHT-018] el resumen del Home trae la línea en riesgo sin cambiar el plan', async () => {
    const summary = ok(await api().get(owner, '/reports/summary'));
    expect(contract.validateResponse('getReportSummary', 200, summary), JSON.stringify(summary)).toEqual([]);
    expect(summary['budgetRisk']).toMatchObject({
      periodId,
      periodLabel: '2026-11',
      moreCount: 0,
      lines: [{ budgetLineId: lineId, level: 'LIKELY' }],
    });
    const budget = ok(await api().get(owner, `/budgets/${budgetId}`));
    const planned = JSON.stringify(
      ((budget['lines'] as Json[])[0]?.['progress'] as Json)?.['reference'] ?? null,
    );
    expect(planned).toContain('600.00');
  }, 120_000);

  it('[TC-REPORTING-INSIGHT-016] el periodo de otro workspace responde 404 RESOURCE_NOT_FOUND y el viewer o editor puede leerlo', async () => {
    const foreign = await api().get(other, `/periods/${periodId}/budget-risk`);
    expect(foreign.status).toBe(403);
    const missing = await api().get(owner, `/periods/${randomUUID()}/budget-risk`);
    expect(missing.status).toBe(404);
    expect(missing.body['code']).toBe('RESOURCE_NOT_FOUND');
    expect((await api().get(editor, `/periods/${periodId}/budget-risk`)).status).toBe(200);
    // Un workspace propio de otro usuario no ve el periodo ajeno: 404.
    const rls = await h.call('GET', `/api/v1/workspaces/${other.ws}/periods/${periodId}/budget-risk`, {
      token: other.token,
    });
    expect(rls.status).toBe(404);
    expect(rls.body['code']).toBe('RESOURCE_NOT_FOUND');
  }, 120_000);

  it('[TC-REPORTING-INSIGHT-016] la tabla de avisos tiene RLS forzada y está registrada en el catálogo del workspace', async () => {
    const row = await asAdmin(h, async (c) => {
      const t = await c.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'reporting.budget_overrun_notice'::regclass`,
      );
      const r = await c.query(
        `SELECT 1 FROM platform.workspace_scoped_table WHERE schema_name = 'reporting' AND table_name = 'budget_overrun_notice'`,
      );
      return { rls: t.rows[0], registered: r.rowCount };
    });
    expect(row.rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(row.registered).toBe(1);
  }, 60_000);
});

describe('reporting.cash-flow-watch: aviso de riesgo de presupuesto', () => {
  it('[TC-NOTIFICATIONS-BUDGETRISK-001] [TC-NOTIFICATIONS-BUDGETRISK-002] solo quien activó el tipo recibe un aviso por línea y periodo, aunque la pasada corra varias veces', async () => {
    // Apagado por omisión: sin activar el tipo nadie recibe nada, pero el aviso queda registrado una sola vez.
    await runWatch();
    expect(await riskNotifications()).toEqual([]);
    expect(await notices()).toEqual([
      { budget_line_id: lineId, level: 'LIKELY', estimated_date: '2026-11-22' },
    ]);
  }, 180_000);

  it('[TC-NOTIFICATIONS-BUDGETRISK-001] activado el tipo, una línea nueva en riesgo avisa al OWNER y no al EDITOR', async () => {
    const a = api();
    const prefs = ok(await a.get(owner, '/notification-preferences'));
    ok(
      await a.put(
        owner,
        '/notification-preferences',
        {
          types: [{ type: 'BUDGET_OVERRUN_RISK', inApp: true, email: false }],
          quietHours: null,
          includeDetailsInEmail: false,
        },
        prefs['version'] as number,
      ),
    );
    // Otra línea (Servicios) pasa a «probable» después de activar el tipo.
    const group = ok(await a.post(owner, '/category-groups', { name: 'Hogar', kind: 'EXPENSE' }), 201);
    const services = ok(await a.post(owner, '/categories', { groupId: group['id'], name: 'Servicios' }), 201)[
      'id'
    ] as string;
    const second = ok(
      await a.post(owner, `/budgets/${budgetId}/lines`, {
        target: { kind: 'CATEGORY', id: services },
        kind: 'MAXIMUM',
        planned: money('300.00'),
      }),
      201,
    )['id'] as string;
    const accounts = ok(await a.get(owner, '/accounts'))['data'] as { id: string }[];
    ok(
      await a.post(owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-11-06',
        accountId: accounts[0]!.id,
        amount: money('150.00'),
        splits: [{ amount: money('150.00'), categoryId: services }],
      }),
      201,
    );
    await runWatch();
    await runWatch();
    const sent = await riskNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.user_id).toBe(owner.id);
    expect((await notices()).map((n) => n.budget_line_id).sort()).toEqual([lineId, second].sort());
  }, 240_000);

  it('[TC-NOTIFICATIONS-BUDGETRISK-003] una línea ya excedida no genera aviso de riesgo', async () => {
    const a = api();
    const accounts = ok(await a.get(owner, '/accounts'))['data'] as { id: string }[];
    ok(
      await a.post(owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-11-07',
        accountId: accounts[0]!.id,
        amount: money('400.00'),
        splits: [{ amount: money('400.00'), categoryId: category }],
      }),
      201,
    );
    const before = (await riskNotifications()).length;
    await runWatch();
    const risk = ok(await a.get(owner, `/periods/${periodId}/budget-risk`));
    expect((risk['lines'] as Json[]).find((l) => l['budgetLineId'] === lineId)?.['level']).toBe('EXCEEDED');
    expect((await riskNotifications()).length).toBe(before);
  }, 240_000);
});
