import { FixedClock, Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { BudgetRiskCalculation, BudgetRiskQueries } from './budget-risk.queries.js';
import { EvaluateBudgetRiskNotices } from './evaluate-budget-risk-notices.js';
import type {
  BudgetRiskDeps,
  BudgetRiskPlanLineRow,
  BudgetRiskPlanRow,
  ResolvedOccurrenceRow,
} from './ports/budget-risk.js';
import type { CashFlowOccurrenceRow } from './ports/index.js';

const WS = '01928c4e-0000-7000-8000-000000000001';
const PERIOD = '01928c4e-0000-7000-8000-0000000000a1';
const BUDGET = '01928c4e-0000-7000-8000-0000000000b1';
const GROUP = '01928c4e-0000-7000-8000-0000000000c0';
const cat = (n: number) => `01928c4e-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;
const RESTAURANTS = cat(1);
const GROCERIES = cat(2);
const SERVICES = cat(3);
const LUZ = cat(4);
const lineId = (n: number) => `01928c4e-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`;

const PERIODS = [
  { id: PERIOD, label: '2026-11', periodStart: '2026-11-01', periodEnd: '2026-11-30', status: 'ACTIVE' },
];

const line = (
  n: number,
  targetId: string,
  reference: string,
  actual: string,
  over: Partial<BudgetRiskPlanLineRow> = {},
): BudgetRiskPlanLineRow => ({
  budgetLineId: lineId(n),
  target: { kind: 'CATEGORY', id: targetId },
  nature: 'EXPENSE',
  kind: 'MAXIMUM',
  reference: { amount: reference, currency: 'BOB' },
  actual: { amount: actual, currency: 'BOB' },
  actualComplete: true,
  ...over,
});

const pendingOf = (
  id: string,
  categoryId: string,
  amount: string,
  dueDate: string,
  over: Partial<CashFlowOccurrenceRow> = {},
): CashFlowOccurrenceRow => ({
  occurrenceId: id,
  definitionId: id,
  definitionName: 'Luz',
  kind: 'EXPENSE',
  dueDate,
  status: 'SCHEDULED',
  expected: { type: 'FIXED', amount, min: null, max: null, currency: 'BOB' },
  accountId: 'acc',
  toAccountId: null,
  managedBy: 'USER',
  categoryId,
  ...over,
});

interface Scenario {
  today?: string;
  plan?: BudgetRiskPlanRow | null;
  pending?: CashFlowOccurrenceRow[];
  resolved?: ResolvedOccurrenceRow[];
  forecast?: { categoryId: string; expected: string; upper: string } | null;
  forecastEnabled?: boolean;
  enabled?: boolean;
  usdRate?: string | null;
}

function build(s: Scenario = {}) {
  const today = s.today ?? '2026-11-10';
  const clock = new FixedClock(Instant.parse(`${today}T16:00:00Z`));
  const plan: BudgetRiskPlanRow | null =
    s.plan === undefined
      ? { budgetId: BUDGET, currency: 'BOB', lines: [line(1, RESTAURANTS, '600.00', '280.00')] }
      : s.plan;
  const calls = { forecast: 0, resolved: 0, pending: 0 };
  const deps: BudgetRiskDeps = {
    uow: { run: (_ctx, fn) => fn(), join: (_ws, fn) => fn() },
    workspaces: { settingsOf: async () => ({ baseCurrency: 'BOB', timeZone: 'America/La_Paz' }) },
    periods: { listPeriods: async () => PERIODS },
    clock,
    rates: {
      workspaceCurrencies: async () => [
        { code: 'BOB', scale: 2, enabled: true },
        { code: 'USD', scale: 2, enabled: true },
      ],
      resolveValuationRates: async (input: { requests: { base: string }[] }) =>
        input.requests.map((r) =>
          s.usdRate && r.base === 'USD'
            ? ({ exact: { base: 'USD', quote: 'BOB', value: s.usdRate } } as never)
            : null,
        ),
    } as never,
    categories: {
      categoryTree: async () => ({
        groups: [{ groupId: GROUP, name: 'Hogar', kind: 'EXPENSE', archived: false }],
        categories: [
          cat0(RESTAURANTS, 'Restaurantes'),
          cat0(GROCERIES, 'Supermercado'),
          cat0(SERVICES, 'Servicios'),
          { ...cat0(LUZ, 'Luz'), parentId: SERVICES },
        ],
        tags: [],
      }),
    } as never,
    budgets: { getForPeriod: async () => plan },
    commitments: {
      listForCashFlow: async () => {
        calls.pending += 1;
        return { items: s.pending ?? [], generatedThrough: '2027-03-01' };
      },
      listResolved: async () => {
        calls.resolved += 1;
        return s.resolved ?? [];
      },
    },
    ...(s.forecastEnabled === false
      ? {}
      : {
          forecast: {
            getLatest: async () => {
              calls.forecast += 1;
              return s.forecast
                ? ({
                    status: 'AVAILABLE',
                    run: { id: 'run-1' },
                    series: [
                      {
                        scope: 'CATEGORY',
                        scopeRef: s.forecast.categoryId,
                        currency: 'BOB',
                        readiness: 'MODEL',
                        points: [
                          {
                            periodStart: '2026-11-01',
                            periodEnd: '2026-11-30',
                            prediction: { amount: s.forecast.expected, currency: 'BOB' },
                            interval80: { upper: { amount: s.forecast.upper, currency: 'BOB' } },
                          },
                        ],
                      },
                    ],
                  } as never)
                : ({ status: 'NONE', run: null, series: [] } as never);
            },
          },
        }),
    enabled: s.enabled ?? true,
    minElapsedDays: 7,
  };
  return { deps, queries: new BudgetRiskQueries(deps), calls, clock };
}

function cat0(categoryId: string, name: string) {
  return {
    categoryId,
    name,
    kind: 'EXPENSE' as const,
    groupId: GROUP,
    parentId: null as string | null,
    systemCode: null,
    archived: false,
  };
}

const risk = (b: ReturnType<typeof build>) =>
  b.queries.getBudgetRisk({ userId: 'u', workspaceId: WS, periodId: PERIOD });

describe('BudgetRiskQueries.getBudgetRisk', () => {
  it('[TC-REPORTING-INSIGHT-001] Restaurantes al ritmo del periodo: 840.00, LIKELY, base RUN_RATE y fecha 2026-11-22', async () => {
    const r = await risk(build());
    expect(r).toMatchObject({
      status: 'AVAILABLE',
      periodId: PERIOD,
      budgetId: BUDGET,
      asOf: '2026-11-10',
      currency: 'BOB',
      elapsedDays: 10,
      remainingDays: 20,
      forecastRunId: null,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({
      budgetLineId: lineId(1),
      target: { kind: 'CATEGORY', id: RESTAURANTS },
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
  });

  it('[TC-REPORTING-INSIGHT-003] una factura pendiente de la categoría entra en la proyección y adelanta la fecha', async () => {
    const r = await risk(
      build({
        plan: { budgetId: BUDGET, currency: 'BOB', lines: [line(1, SERVICES, '500.00', '100.00')] },
        // "Luz" es una subcategoría de "Servicios": la línea de Servicios la cubre.
        pending: [pendingOf('occ-luz', LUZ, '300.00', '2026-11-20')],
      }),
    );
    expect(r.lines[0]).toMatchObject({
      knownPending: { amount: '300.00', currency: 'BOB' },
      projected: { amount: '600.00', currency: 'BOB' },
      level: 'LIKELY',
      estimatedDate: '2026-11-21',
    });
  });

  it('[TC-REPORTING-INSIGHT-003] las ocurrencias de otra categoría, de ingreso o sin categoría no entran', async () => {
    const r = await risk(
      build({
        plan: { budgetId: BUDGET, currency: 'BOB', lines: [line(1, SERVICES, '500.00', '100.00')] },
        pending: [
          pendingOf('a', GROCERIES, '300.00', '2026-11-20'),
          pendingOf('b', LUZ, '300.00', '2026-11-20', { kind: 'INCOME' }),
          pendingOf('c', LUZ, '300.00', '2026-11-20', { categoryId: null }),
          pendingOf('d', LUZ, '300.00', '2026-12-05'),
        ],
      }),
    );
    expect(r.lines[0]?.knownPending.amount).toBe('0.00');
    expect(r.lines[0]?.level).toBe('UNLIKELY');
  });

  it('[TC-REPORTING-INSIGHT-004] lo pagado por una ocurrencia resuelta no se extrapola', async () => {
    const r = await risk(
      build({
        plan: { budgetId: BUDGET, currency: 'BOB', lines: [line(1, SERVICES, '600.00', '300.00')] },
        resolved: [
          {
            occurrenceId: 'occ-internet',
            kind: 'EXPENSE',
            categoryId: SERVICES,
            transactionDate: '2026-11-02',
            amount: { amount: '250.00', currency: 'BOB' },
          },
        ],
      }),
    );
    expect(r.lines[0]).toMatchObject({
      variableActual: { amount: '50.00', currency: 'BOB' },
      projected: { amount: '400.00', currency: 'BOB' },
      level: 'UNLIKELY',
    });
  });

  it('[TC-REPORTING-INSIGHT-005] con el pronóstico habilitado: 1400.00, alta 1620.00, base FORECAST y riesgo POSSIBLE', async () => {
    const r = await risk(
      build({
        plan: { budgetId: BUDGET, currency: 'BOB', lines: [line(1, GROCERIES, '1500.00', '560.00')] },
        forecast: { categoryId: GROCERIES, expected: '1400.00', upper: '1620.00' },
      }),
    );
    expect(r.forecastRunId).toBe('run-1');
    expect(r.lines[0]).toMatchObject({
      projected: { amount: '1400.00', currency: 'BOB' },
      projectedHigh: { amount: '1620.00', currency: 'BOB' },
      basis: 'FORECAST',
      level: 'POSSIBLE',
    });
  });

  it('[TC-REPORTING-INSIGHT-005] una línea de grupo no usa el pronóstico: ritmo del periodo y sin riesgo posible', async () => {
    const r = await risk(
      build({
        plan: {
          budgetId: BUDGET,
          currency: 'BOB',
          lines: [line(1, GROUP, '1500.00', '400.00', { target: { kind: 'GROUP', id: GROUP } })],
        },
        forecast: { categoryId: GROUP, expected: '1400.00', upper: '1620.00' },
      }),
    );
    expect(r.lines[0]).toMatchObject({ basis: 'RUN_RATE', projectedHigh: null, targetName: 'Hogar' });
  });

  it('[TC-REPORTING-INSIGHT-006] con los pronósticos deshabilitados se usa el ritmo: 1680.00, LIKELY y sin proyección alta', async () => {
    const b = build({
      forecastEnabled: false,
      plan: { budgetId: BUDGET, currency: 'BOB', lines: [line(1, GROCERIES, '1500.00', '560.00')] },
    });
    const r = await risk(b);
    expect(b.calls.forecast).toBe(0);
    expect(r.lines[0]).toMatchObject({
      projected: { amount: '1680.00', currency: 'BOB' },
      basis: 'RUN_RATE',
      level: 'LIKELY',
      projectedHigh: null,
    });
  });

  it('[TC-REPORTING-INSIGHT-014] con el servicio de pronósticos detenido (sin corrida vigente) cada línea usa el ritmo', async () => {
    const r = await risk(build({ forecast: null }));
    expect(r.status).toBe('AVAILABLE');
    expect(r.lines.every((l) => l.basis === 'RUN_RATE')).toBe(true);
  });

  it('[TC-REPORTING-INSIGHT-009] demasiado temprano: sin pronóstico y con 3 días no está disponible', async () => {
    const r = await risk(
      build({
        today: '2026-11-03',
        plan: { budgetId: BUDGET, currency: 'BOB', lines: [line(1, RESTAURANTS, '600.00', '90.00')] },
      }),
    );
    expect(r.lines[0]).toMatchObject({ level: 'NOT_AVAILABLE', reason: 'TOO_EARLY', projected: null });
  });

  it('[TC-REPORTING-INSIGHT-010] las líneas fijas figuran como LINE_TYPE; las de etiqueta y de ingreso no figuran', async () => {
    const r = await risk(
      build({
        plan: {
          budgetId: BUDGET,
          currency: 'BOB',
          lines: [
            line(1, RESTAURANTS, '2800.00', '2800.00', { kind: 'FIXED' }),
            line(2, GROCERIES, '100.00', '10.00', { target: { kind: 'TAG', id: 'tag-1' } }),
            line(3, GROCERIES, '9000.00', '9000.00', { nature: 'INCOME' }),
          ],
        },
      }),
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ level: 'NOT_AVAILABLE', reason: 'LINE_TYPE' });
  });

  it('[TC-REPORTING-INSIGHT-011] una línea con el gastado sobre el tope es EXCEEDED sin fecha', async () => {
    const r = await risk(
      build({
        plan: { budgetId: BUDGET, currency: 'BOB', lines: [line(1, RESTAURANTS, '600.00', '650.00')] },
      }),
    );
    expect(r.lines[0]).toMatchObject({ level: 'EXCEEDED', estimatedDate: null });
  });

  it('[TC-REPORTING-INSIGHT-003] un pago conocido en otra moneda se convierte con la tasa vigente; sin tasa se excluye y marca incompleta', async () => {
    const usd = (id: string) =>
      pendingOf(id, SERVICES, '10.00', '2026-11-20', {
        expected: { type: 'FIXED', amount: '10.00', min: null, max: null, currency: 'USD' },
      });
    const plan = { budgetId: BUDGET, currency: 'BOB', lines: [line(1, SERVICES, '500.00', '100.00')] };
    const withRate = await risk(build({ plan, pending: [usd('u1')], usdRate: '6.96' }));
    expect(withRate.lines[0]).toMatchObject({
      knownPending: { amount: '69.60', currency: 'BOB' },
      projectionComplete: true,
    });
    const without = await risk(build({ plan, pending: [usd('u1')], usdRate: null }));
    expect(without.lines[0]).toMatchObject({
      knownPending: { amount: '0.00', currency: 'BOB' },
      projectionComplete: false,
    });
  });

  it('[TC-REPORTING-INSIGHT-003] un egreso de rango suma el máximo y uno variable no suma', async () => {
    const plan = { budgetId: BUDGET, currency: 'BOB', lines: [line(1, SERVICES, '5000.00', '100.00')] };
    const r = await risk(
      build({
        plan,
        pending: [
          pendingOf('r', SERVICES, '0', '2026-11-20', {
            expected: { type: 'MIN_MAX', amount: null, min: '100.00', max: '180.00', currency: 'BOB' },
          }),
          pendingOf('v', SERVICES, '0', '2026-11-21', {
            expected: { type: 'VARIABLE', amount: null, min: null, max: null, currency: 'BOB' },
          }),
        ],
      }),
    );
    expect(r.lines[0]?.knownPending.amount).toBe('180.00');
  });

  it('[TC-REPORTING-INSIGHT-016] un periodo inexistente o de otro workspace responde RESOURCE_NOT_FOUND', async () => {
    const b = build();
    await expect(
      b.queries.getBudgetRisk({
        userId: 'u',
        workspaceId: WS,
        periodId: '01928c4e-0000-7000-8000-0000000000ff',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('[TC-REPORTING-INSIGHT-014] estados sin líneas: NO_PLAN, NOT_CURRENT_PERIOD y DISABLED', async () => {
    expect((await risk(build({ plan: null }))).status).toBe('NO_PLAN');
    expect((await risk(build({ today: '2026-12-02' }))).status).toBe('NOT_CURRENT_PERIOD');
    const disabled = build({ enabled: false });
    const r = await risk(disabled);
    expect(r).toMatchObject({ status: 'DISABLED', lines: [] });
    expect(disabled.calls.pending).toBe(0);
  });
});

describe('BudgetRiskCalculation.homeBlock', () => {
  it('[TC-REPORTING-INSIGHT-018] lista las líneas LIKELY por fecha estimada y luego por nombre, con moreCount', async () => {
    const lines = [
      line(1, RESTAURANTS, '600.00', '280.00'),
      line(2, SERVICES, '500.00', '100.00'),
      line(3, GROCERIES, '100.00', '50.00'),
    ];
    const b = build({
      plan: { budgetId: BUDGET, currency: 'BOB', lines },
      pending: [pendingOf('luz', LUZ, '300.00', '2026-11-20')],
    });
    const dto = await risk(b);
    const home = BudgetRiskCalculation.homeBlock(dto, '2026-11');
    // Servicios y Supermercado exceden el 21/11 (empate: por nombre); Restaurantes el 22/11.
    expect(home?.lines.map((l) => l.targetName)).toEqual(['Servicios', 'Supermercado', 'Restaurantes']);
    expect(home).toMatchObject({ periodId: PERIOD, periodLabel: '2026-11', moreCount: 0 });
  });

  it('[TC-REPORTING-INSIGHT-018] muestra a lo sumo 3 y cuenta el resto', async () => {
    const lines = [1, 2, 3, 4].map((n) => line(n, RESTAURANTS, '600.00', `${280 + n}.00`));
    const dto = await risk(build({ plan: { budgetId: BUDGET, currency: 'BOB', lines } }));
    const home = BudgetRiskCalculation.homeBlock(dto, '2026-11');
    expect(home?.lines).toHaveLength(3);
    expect(home?.moreCount).toBe(1);
  });

  it('[TC-REPORTING-INSIGHT-019] sin líneas en riesgo, sin plan o sin la función el bloque es null', async () => {
    const calm = await risk(
      build({
        plan: { budgetId: BUDGET, currency: 'BOB', lines: [line(1, RESTAURANTS, '1500.00', '100.00')] },
      }),
    );
    expect(BudgetRiskCalculation.homeBlock(calm, '2026-11')).toBeNull();
    expect(BudgetRiskCalculation.homeBlock(await risk(build({ plan: null })), '2026-11')).toBeNull();
    expect(BudgetRiskCalculation.homeBlock(await risk(build({ enabled: false })), '2026-11')).toBeNull();
  });
});

describe('BudgetRiskQueries.evaluateCurrent', () => {
  it('[TC-REPORTING-INSIGHT-015] evalúa el periodo que contiene hoy y no lee nada con la función deshabilitada', async () => {
    const b = build();
    const current = await b.queries.evaluateCurrent({ workspaceId: WS, timeZone: 'America/La_Paz' });
    expect(current?.periodLabel).toBe('2026-11');
    expect(current?.dto.lines[0]?.level).toBe('LIKELY');
    const off = build({ enabled: false });
    expect(await off.queries.evaluateCurrent({ workspaceId: WS, timeZone: 'America/La_Paz' })).toBeNull();
    const outside = build({ today: '2027-01-15' });
    expect(await outside.queries.evaluateCurrent({ workspaceId: WS, timeZone: 'America/La_Paz' })).toBeNull();
  });
});

describe('EvaluateBudgetRiskNotices', () => {
  function watch(s: Scenario = {}, failOn?: string) {
    const b = build(s);
    const notices = new Set<string>();
    const sent: Record<string, unknown>[] = [];
    const watcher = new EvaluateBudgetRiskNotices({
      uow: b.deps.uow,
      workspaces: {
        list: async () => [
          { workspaceId: WS, timeZone: 'America/La_Paz', baseCurrency: 'BOB' },
          { workspaceId: 'otro', timeZone: 'America/La_Paz', baseCurrency: 'BOB' },
        ],
      },
      source: b.queries,
      notices: {
        insertIfAbsent: async (i: { workspaceId: string; periodId: string; budgetLineId: string }) => {
          const key = `${i.workspaceId}|${i.periodId}|${i.budgetLineId}`;
          if (notices.has(key)) return false;
          notices.add(key);
          return true;
        },
      },
      notifier: {
        notify: async (f: { workspaceId: string }) => {
          if (failOn && f.workspaceId === failOn) throw new Error('boom');
          sent.push(f as never);
        },
      },
      clock: b.clock,
      enabled: s.enabled ?? true,
    } as never);
    return { watcher, sent, notices, b };
  }

  it('[TC-NOTIFICATIONS-BUDGETRISK-001] avisa a una línea LIKELY con proyección, referencia, fecha y base', async () => {
    const { watcher, sent } = watch();
    const summary = await watcher.run();
    expect(summary).toMatchObject({ workspaces: 2, notified: 2, failed: 0 });
    expect(sent[0]).toMatchObject({
      workspaceId: WS,
      periodId: PERIOD,
      periodLabel: '2026-11',
      budgetId: BUDGET,
      budgetLineId: lineId(1),
      target: { kind: 'CATEGORY', id: RESTAURANTS, name: 'Restaurantes' },
      projected: { amount: '840.00', currency: 'BOB' },
      reference: { amount: '600.00', currency: 'BOB' },
      estimatedDate: '2026-11-22',
      basis: 'RUN_RATE',
    });
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-002] repetir la pasada no avisa otra vez la misma línea y periodo', async () => {
    const { watcher, sent, notices } = watch();
    await watcher.run();
    const first = sent.length;
    await watcher.run();
    await watcher.run();
    expect(sent).toHaveLength(first);
    expect([...notices].filter((k) => k.startsWith(`${WS}|`))).toHaveLength(1);
  });

  it('[TC-NOTIFICATIONS-BUDGETRISK-003] una línea que ya cruzó el 100 % (EXCEEDED) o en riesgo POSSIBLE no recibe aviso', async () => {
    const exceeded = watch({
      plan: { budgetId: BUDGET, currency: 'BOB', lines: [line(1, RESTAURANTS, '600.00', '650.00')] },
    });
    await exceeded.watcher.run();
    expect(exceeded.sent).toHaveLength(0);
    const possible = watch({
      plan: { budgetId: BUDGET, currency: 'BOB', lines: [line(1, GROCERIES, '1500.00', '560.00')] },
      forecast: { categoryId: GROCERIES, expected: '1400.00', upper: '1620.00' },
    });
    await possible.watcher.run();
    expect(possible.sent).toHaveLength(0);
    expect(possible.notices.size).toBe(0);
  });

  it('[TC-REPORTING-INSIGHT-015] con la función deshabilitada el paso no corre; una falla de un workspace no afecta a los demás', async () => {
    const off = watch({ enabled: false });
    expect(await off.watcher.run()).toMatchObject({ workspaces: 0, notified: 0 });
    const failing = watch({}, 'otro');
    const summary = await failing.watcher.run();
    expect(summary).toMatchObject({ workspaces: 1, notified: 1, failed: 1 });
    expect(summary.errors).toEqual(['Error']);
  });
});
