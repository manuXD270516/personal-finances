import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  FlowValuation,
  Money,
  currency as makeCurrency,
  present,
  sumByCurrency,
  type Currency,
} from '@pf/shared-kernel';
import { rateKey, type BudgetView } from './budget-calculator.js';
import {
  NO_GOAL_CONTRIBUTIONS_VIEW,
  type GoalContributionItemDto,
  type GoalContributionsView,
} from './budget-view.js';
import type { BudgetsDeps } from './ports/index.js';

const decimalsOf = (amount: string): number => amount.split('.')[1]?.length ?? 0;

/**
 * Sección "Aportes a metas" del plan (add-savings-goals, decisión 20; FR-GOALS-009): una consulta por lote a GOALS para el
 * rango del periodo y UNA resolución de tasas para el total pendiente (nada por meta en bucle, NFR-PERF-004).
 *
 * El pendiente de cada meta ya viene calculado por GOALS en la moneda de la meta; aquí solo se presenta y se consolida
 * el total en la moneda del plan con la tasa vigente de HOY (son flujos futuros: mismo criterio que el comprometido),
 * con `FlowValuation` (un monto sin tasa queda fuera del total y la sección, incompleta; nunca 1:1). No crea líneas ni
 * toca gastado, umbrales ni disponible para gastar.
 */
export async function goalContributionsOf(
  deps: BudgetsDeps,
  workspaceId: string,
  view: BudgetView,
): Promise<GoalContributionsView> {
  if (!deps.goalPlans) return NO_GOAL_CONTRIBUTIONS_VIEW;
  const rows = await deps.goalPlans.getForPeriod({
    workspaceId,
    from: view.period.snapshot.periodStart,
    to: view.period.snapshot.periodEnd,
  });
  const catalog = await deps.rates.workspaceCurrencies(workspaceId);
  const known = new Map<string, Currency>(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
  const scaleOf = (code: string, amount: string): Currency =>
    known.get(code) ?? makeCurrency(code, decimalsOf(amount));
  const pendings = rows.map((r) => Money.parse(r.pending, scaleOf(r.currency, r.pending)));

  const items: GoalContributionItemDto[] = rows.map((r) => ({
    goalId: r.goalId,
    name: r.goalName,
    planned: { amount: r.planned, currency: r.currency },
    contributed: { amount: r.contributed, currency: r.currency },
    pending: { amount: r.pending, currency: r.currency },
    exceededBy: { amount: r.exceededBy, currency: r.currency },
  }));

  const today = view.today.toString();
  const flows = pendings.filter((m) => !m.isZero()).map((amount) => ({ date: today, amount }));
  const used = new Map<string, ResolvedRateDto>();
  const rates = await FlowValuation.resolveRates<ResolvedRateDto>({
    flows,
    target: view.currency,
    timeZone: view.timeZone,
    now: deps.clock.now(),
    windowDays: view.windowDays,
    resolve: async ({ requests, windowDays }) => {
      const found = await deps.rates.resolveValuationRates({ workspaceId, requests, windowDays });
      return found.map((r: ValuationRateDto | null) => (r ? { exact: r.exact, resolved: r.resolved } : null));
    },
    keyOf: rateKey,
  });
  const collector = rates.collector();
  const total = FlowValuation.consolidate(flows, view.currency, collector.rateFor);
  for (const r of collector.used()) used.set(rateKey(r), r);

  return {
    section: {
      items,
      pendingTotal: {
        native: sumByCurrency(pendings.filter((m) => !m.isZero())).map((m) => m.toJSON()),
        base: present(total.total, view.currency).toJSON(),
        complete: total.complete,
      },
    },
    ratesUsed: [...used.values()],
  };
}
