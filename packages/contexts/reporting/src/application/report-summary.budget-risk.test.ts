import { beforeEach, describe, expect, it } from 'vitest';
import type { BudgetRiskDto } from '../contracts/budget-risk.js';
import { ReportSummaryQueries } from './report-summary.queries.js';
import { InMemoryReporting } from './testing/in-memory.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';

let mem: InMemoryReporting;

const riskLine = (n: number, name: string, level: string, estimatedDate: string | null) => ({
  budgetLineId: `0190a000-0000-7000-8000-00000000010${n}`,
  target: { kind: 'CATEGORY' as const, id: `cat-${n}` },
  targetName: name,
  reference: { amount: '600.00', currency: 'BOB' },
  actual: { amount: '280.00', currency: 'BOB' },
  variableActual: { amount: '280.00', currency: 'BOB' },
  knownPending: { amount: '0.00', currency: 'BOB' },
  projected: { amount: '840.00', currency: 'BOB' },
  projectedHigh: null,
  projectionComplete: true,
  level: level as 'LIKELY',
  reason: null,
  estimatedDate,
  basis: 'RUN_RATE' as const,
});

const dto = (lines: ReturnType<typeof riskLine>[]): BudgetRiskDto => ({
  status: 'AVAILABLE',
  periodId: '0190a000-0000-7000-8000-0000000000b1',
  budgetId: '0190a000-0000-7000-8000-0000000000b2',
  asOf: '2026-10-01',
  currency: 'BOB',
  elapsedDays: 1,
  remainingDays: 29,
  forecastRunId: null,
  lines,
});

async function summary(risk?: { dto: BudgetRiskDto; periodLabel: string } | null) {
  const deps = mem.deps();
  const queries = new ReportSummaryQueries(
    risk === undefined ? deps : { ...deps, budgetRisk: { evaluateCurrent: async () => risk } },
  );
  return (await queries.getReportSummary({ userId: USER, workspaceId: WS })).summary;
}

beforeEach(() => {
  mem = new InMemoryReporting();
  mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '685.00');
});

describe('GetReportSummary: líneas en riesgo de excederse (Q5, reporting/dashboard)', () => {
  it('[TC-REPORTING-INSIGHT-018] trae primero la línea de fecha más cercana y moreCount 0, sin tocar el disponible', async () => {
    const without = await summary();
    const withRisk = await summary({
      periodLabel: '2026-10',
      dto: dto([
        riskLine(1, 'Restaurantes', 'LIKELY', '2026-11-22'),
        riskLine(2, 'Servicios', 'LIKELY', '2026-11-21'),
        riskLine(3, 'Supermercado', 'UNLIKELY', null),
      ]),
    });
    expect(withRisk.budgetRisk?.lines.map((l) => l.targetName)).toEqual(['Servicios', 'Restaurantes']);
    expect(withRisk.budgetRisk).toMatchObject({ periodLabel: '2026-10', moreCount: 0 });
    // El disponible para gastar y todo lo demás son los mismos que sin la función.
    const { budgetRisk: _a, ...restWith } = withRisk;
    const { budgetRisk: _b, ...restWithout } = without;
    expect(restWith).toEqual(restWithout);
    expect(without.budgetRisk).toBeNull();
  });

  it('[TC-REPORTING-INSIGHT-019] sin líneas LIKELY el bloque es null y el resto no cambia', async () => {
    const calm = await summary({
      periodLabel: '2026-10',
      dto: dto([riskLine(1, 'Restaurantes', 'UNLIKELY', null), riskLine(2, 'Servicios', 'POSSIBLE', null)]),
    });
    expect(calm.budgetRisk).toBeNull();
    expect(await summary(null).then((s) => s.budgetRisk)).toBeNull();
  });
});
