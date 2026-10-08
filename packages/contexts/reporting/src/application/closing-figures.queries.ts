import type { ResolvedRateDto } from '@pf/fx/contracts';
import type { NetWorthAtDto, NetWorthQuery, PeriodFlowsDto, PeriodFlowsQuery } from '../contracts/index.js';
import type { ReportingDeps } from './ports/index.js';
import { rateKey, ReportSummaryQueries } from './report-summary.queries.js';

/**
 * Cifras de cierre de mes (openspec add-month-closing, design.md decisión 5): reutilizan EXACTAMENTE el cálculo de
 * `GET /reports/summary` (`ReportSummaryQueries`, D15/D53) con una fecha de corte, para que el snapshot de PLANNING
 * coincida cifra a cifra con el Home. Se ejecutan en la unidad de trabajo del llamador (`uow.join`); los consolidados
 * se cuantizan UNA sola vez con HALF_EVEN al presentar (INV-020).
 */
abstract class ClosingFigures {
  protected readonly summary: ReportSummaryQueries;

  constructor(protected readonly deps: ReportingDeps) {
    this.summary = new ReportSummaryQueries(deps);
  }
}

export class PeriodFlowsQueries extends ClosingFigures implements PeriodFlowsQuery {
  getFlows(input: {
    readonly workspaceId: string;
    readonly dateFrom: string;
    readonly dateTo: string;
    readonly reportingCurrency?: string;
  }): Promise<PeriodFlowsDto> {
    return this.deps.uow.join(input.workspaceId, async () => {
      const { summary: s, rateSets } = await this.summary.computeInCurrentUnit({
        userId: null,
        workspaceId: input.workspaceId,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        compare: 'NONE',
        topCategories: 0,
        ...(input.reportingCurrency === undefined ? {} : { reportingCurrency: input.reportingCurrency }),
      });
      const zero = (m: { amount: string }) => /^-?0+(\.0+)?$/.test(m.amount);
      return {
        period: s.period,
        reportingCurrency: s.meta.reportingCurrency,
        // Solo monedas con flujos en el periodo (las de saldos no aplican a los flujos).
        byCurrency: s.byCurrency
          .filter((c) => !zero(c.income) || !zero(c.expense))
          .map((c) => ({
            currency: c.currency,
            income: c.income,
            expense: c.expense,
            net: c.net,
            savingsRate: c.savingsRate,
          })),
        consolidated: {
          currency: s.consolidated.currency,
          income: s.consolidated.income,
          expense: s.consolidated.expense,
          net: s.consolidated.net,
          savingsRate: s.consolidated.savingsRate,
          complete: rateSets.flowsComplete,
          unconverted: rateSets.flowsUnconverted,
        },
        ratesUsed: rateSets.flows,
      };
    });
  }
}

export class NetWorthAtQueries extends ClosingFigures implements NetWorthQuery {
  getNetWorth(input: {
    readonly workspaceId: string;
    readonly asOf: string;
    readonly reportingCurrency?: string;
  }): Promise<NetWorthAtDto> {
    return this.deps.uow.join(input.workspaceId, async () => {
      const { summary: s, rateSets } = await this.summary.computeInCurrentUnit({
        userId: null,
        workspaceId: input.workspaceId,
        asOf: input.asOf,
        // Los flujos no se usan: un solo día mantiene mínima la lectura.
        dateFrom: input.asOf,
        dateTo: input.asOf,
        compare: 'NONE',
        topCategories: 0,
        ...(input.reportingCurrency === undefined ? {} : { reportingCurrency: input.reportingCurrency }),
      });
      const rates = new Map<string, ResolvedRateDto>();
      for (const r of [...rateSets.stocks, ...s.accounts.flatMap((a) => (a.rate ? [a.rate] : []))]) {
        rates.set(rateKey(r), r);
      }
      return {
        asOf: input.asOf,
        reportingCurrency: s.meta.reportingCurrency,
        netWorth: s.netWorth,
        accounts: s.accounts,
        ratesUsed: [...rates.values()],
      };
    });
  }
}
