import type { AuditLogEntryDto, AuditPagePosition } from '@pf/audit/contracts';
import { DomainError, Instant } from '@pf/shared-kernel';
import type { BudgetVsActual, BudgetVsActualQuery } from '../contracts/index.js';
import { BudgetCalculator, type BudgetView } from './budget-calculator.js';
import {
  toBudgetDto,
  toBudgetVsActual,
  toSummaryDto,
  type BudgetDto,
  type BudgetSummaryDto,
} from './budget-view.js';
import type { BudgetsDeps } from './ports/index.js';

const LABEL = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Consultas del plan (design § Contratos): `GetBudget`, `GetBudgetByPeriod`, `ListBudgets`, el historial del plan y la
 * query pública `BudgetVsActualQuery.getForPeriod`. Todas calculan el gastado desde la fuente de verdad en cada
 * lectura (INV-034; sin consistencia eventual visible, RISK-022), sin efectos, en la unidad de trabajo en curso.
 */
export class BudgetQueries implements BudgetVsActualQuery {
  private readonly calculator: BudgetCalculator;

  constructor(private readonly deps: BudgetsDeps) {
    this.calculator = new BudgetCalculator(deps);
  }

  getBudget(workspaceId: string, budgetId: string): Promise<BudgetDto> {
    return this.deps.uow.run(workspaceId, async () => {
      const budget = await this.deps.budgets.findById(workspaceId, budgetId);
      if (!budget) throw new DomainError('RESOURCE_NOT_FOUND', `budget ${budgetId} not found`);
      return toBudgetDto(await this.viewOf(workspaceId, budget.periodId, budget));
    });
  }

  /** `GET …/periods/{periodId}/budget`: 404 si el periodo no existe o no tiene plan. */
  getBudgetByPeriod(workspaceId: string, periodId: string): Promise<BudgetDto> {
    return this.deps.uow.run(workspaceId, async () => {
      const period = await this.deps.periods.findById(workspaceId, periodId);
      const budget = period ? await this.deps.budgets.findByPeriod(workspaceId, periodId) : null;
      if (!period || !budget) {
        throw new DomainError('RESOURCE_NOT_FOUND', `period ${periodId} has no budget plan`);
      }
      return toBudgetDto(await this.viewOf(workspaceId, periodId, budget));
    });
  }

  /** Planes con su resumen, del periodo más reciente al más antiguo; `periodFrom`/`periodTo` son etiquetas `YYYY-MM`. */
  listBudgets(
    workspaceId: string,
    filter: { readonly periodFrom?: string | undefined; readonly periodTo?: string | undefined } = {},
  ): Promise<BudgetSummaryDto[]> {
    for (const [pointer, value] of [
      ['/periodFrom', filter.periodFrom],
      ['/periodTo', filter.periodTo],
    ] as const) {
      if (value !== undefined && !LABEL.test(value)) {
        throw new DomainError('VALIDATION_FAILED', 'period filters must be YYYY-MM').at(pointer);
      }
    }
    return this.deps.uow.run(workspaceId, async () => {
      const periods = (await this.deps.periods.list(workspaceId)).filter(
        (p) =>
          (filter.periodFrom === undefined || p.label >= filter.periodFrom) &&
          (filter.periodTo === undefined || p.label <= filter.periodTo),
      );
      const budgets = await this.deps.budgets.listByPeriods(
        workspaceId,
        periods.map((p) => p.id),
      );
      const out: BudgetSummaryDto[] = [];
      for (const period of [...periods].reverse()) {
        const budget = budgets.find((b) => b.periodId === period.id);
        if (!budget) continue;
        const view = await this.calculator.view({
          workspaceId,
          budget,
          period,
          now: this.deps.clock.now(),
        });
        out.push(toSummaryDto(view));
      }
      return out;
    });
  }

  /** `BudgetVsActualQuery.getForPeriod` (add-month-closing): `null` si el periodo no tiene plan. */
  getForPeriod(input: {
    readonly workspaceId: string;
    readonly periodId: string;
    readonly asOf?: string;
  }): Promise<BudgetVsActual | null> {
    const { workspaceId, periodId } = input;
    const now = input.asOf === undefined ? this.deps.clock.now() : Instant.parse(input.asOf);
    return this.deps.uow.run(workspaceId, async () => {
      const period = await this.deps.periods.findById(workspaceId, periodId);
      if (!period) return null;
      const budget = await this.deps.budgets.findByPeriod(workspaceId, periodId);
      if (!budget) return null;
      return toBudgetVsActual(await this.calculator.view({ workspaceId, budget, period, now }));
    });
  }

  /** Historial del plan y de sus líneas (auditoría; VIEWER lo puede leer, como el de una transacción). */
  async history(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly budgetId: string;
    readonly after?: AuditPagePosition;
    readonly limit: number;
  }): Promise<readonly AuditLogEntryDto[]> {
    const { history } = this.deps;
    if (!history) throw new Error('BudgetsDeps.history is required for the budget history');
    return this.deps.uow.run(input.workspaceId, async () => {
      const budget = await this.deps.budgets.findById(input.workspaceId, input.budgetId);
      if (!budget) throw new DomainError('RESOURCE_NOT_FOUND', `budget ${input.budgetId} not found`);
      return history.historyOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        entities: [{ aggregateType: 'Budget', aggregateId: input.budgetId }],
        ...(input.after ? { after: input.after } : {}),
        limit: input.limit,
      });
    });
  }

  private async viewOf(
    workspaceId: string,
    periodId: string,
    budget: NonNullable<Awaited<ReturnType<BudgetsDeps['budgets']['findById']>>>,
  ): Promise<BudgetView> {
    const period = await this.deps.periods.findById(workspaceId, periodId);
    if (!period) throw new DomainError('REFERENCE_NOT_FOUND', `financial period ${periodId} not found`);
    return this.calculator.view({ workspaceId, budget, period, now: this.deps.clock.now() });
  }
}
