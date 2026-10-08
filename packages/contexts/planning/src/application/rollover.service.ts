import type { AuditPort } from '@pf/audit/contracts';
import { dec } from '@pf/shared-kernel';
import { ROLLOVER_KINDS, type Budget, type BudgetLine } from '../domain/index.js';
import { BudgetCalculator } from './budget-calculator.js';
import { BudgetThresholdService } from './budget-thresholds.service.js';
import type { BudgetsDeps } from './ports/index.js';

const AGGREGATE = 'Budget';

/**
 * Consumidor `planning.rollover-finalizer` (design decisión 10; FR-PLANNING-020): al cerrar el periodo N-1
 * (`planning.MonthClosed.v1`) congela el remanente recibido por las líneas del plan de N (`rollover_in_amount` +
 * `rollover_status = FINAL`) si N no está cerrado; al reabrirlo (`planning.PeriodReopened.v1`) lo vuelve a
 * `PROVISIONAL`. Idempotente: recalcular con los mismos datos produce el mismo resultado (la entrega duplicada la
 * absorbe además el inbox). Tras congelar reevalúa los umbrales de N (su planificado efectivo pudo cambiar).
 */
export class RolloverService {
  private readonly calculator: BudgetCalculator;
  private readonly thresholds: BudgetThresholdService;

  constructor(
    private readonly deps: BudgetsDeps,
    private readonly audit: AuditPort = deps.audit,
  ) {
    this.calculator = new BudgetCalculator(deps);
    this.thresholds = new BudgetThresholdService(deps, this.calculator);
  }

  /** Periodo siguiente a `periodId` con su plan (bloqueado) si existe y no está cerrado. */
  private async nextBudget(workspaceId: string, periodId: string) {
    const { deps } = this;
    const all = await deps.periods.list(workspaceId);
    const index = all.findIndex((p) => p.id === periodId);
    const next = index >= 0 ? all[index + 1] : undefined;
    if (!next || next.status === 'CLOSED') return null;
    const probe = await deps.budgets.findByPeriod(workspaceId, next.id);
    if (!probe) return null;
    const budget = await deps.budgets.findById(workspaceId, probe.id, { lock: 'update' });
    return budget ? { budget, period: next } : null;
  }

  async onPeriodClosed(input: { readonly workspaceId: string; readonly periodId: string }): Promise<number> {
    const { deps } = this;
    const { workspaceId } = input;
    return deps.uow.run(workspaceId, async () => {
      const target = await this.nextBudget(workspaceId, input.periodId);
      if (!target) return 0;
      const { budget, period } = target;
      const view = await this.calculator.view({ workspaceId, budget, period, now: deps.clock.now() });
      let changed = 0;
      const updates: { before: BudgetLine; after: BudgetLine }[] = [];
      for (const lv of view.lines) {
        const s = lv.line.snapshot;
        if (lv.line.nature !== 'EXPENSE' || !ROLLOVER_KINDS.includes(lv.line.kind)) continue;
        const amount = lv.rolloverStatus === 'FINAL' && lv.rolloverIn ? lv.rolloverIn.toFixed() : null;
        const status = lv.rolloverStatus === 'FINAL' ? 'FINAL' : 'NONE';
        const same =
          amount === null || s.rolloverInAmount === null
            ? amount === s.rolloverInAmount
            : dec(amount).eq(dec(s.rolloverInAmount));
        if (status === s.rolloverStatus && same) continue;
        updates.push({ before: lv.line, after: lv.line.withRollover(amount, status) });
      }
      for (const u of updates) {
        budget.replaceLine(u.after);
        changed += 1;
      }
      if (changed > 0) {
        budget.touch();
        await this.save(budget, updates, view.currency.code);
        const fresh = await this.calculator.view({ workspaceId, budget, period, now: deps.clock.now() });
        await this.thresholds.evaluateView(fresh);
      }
      return changed;
    });
  }

  async onPeriodReopened(input: {
    readonly workspaceId: string;
    readonly periodId: string;
  }): Promise<number> {
    const { deps } = this;
    const { workspaceId } = input;
    return deps.uow.run(workspaceId, async () => {
      const target = await this.nextBudget(workspaceId, input.periodId);
      if (!target) return 0;
      const { budget } = target;
      const updates: { before: BudgetLine; after: BudgetLine }[] = [];
      for (const line of budget.lines) {
        const s = line.snapshot;
        if (s.rolloverStatus !== 'FINAL') continue;
        updates.push({ before: line, after: line.withRollover(s.rolloverInAmount, 'PROVISIONAL') });
      }
      if (updates.length === 0) return 0;
      for (const u of updates) budget.replaceLine(u.after);
      budget.touch();
      await this.save(budget, updates, budget.snapshot.currency);
      return updates.length;
    });
  }

  private async save(
    budget: Budget,
    updates: readonly { before: BudgetLine; after: BudgetLine }[],
    currency: string,
  ): Promise<void> {
    const { deps } = this;
    if (!(await deps.budgets.save(budget))) {
      throw new Error(`budget ${budget.id} changed concurrently while updating its rollover`);
    }
    budget.markPersisted();
    for (const u of updates) {
      if (!(await deps.budgets.updateLine(u.after))) {
        throw new Error(`budget line ${u.after.id} changed concurrently while updating its rollover`);
      }
      const b = u.before.snapshot;
      const a = u.after.snapshot;
      await this.audit.append({
        workspaceId: budget.workspaceId,
        action: 'planning.budget.rollover_updated',
        aggregateType: AGGREGATE,
        aggregateId: budget.id,
        aggregateVersion: budget.version,
        changes: [
          { field: 'line', before: b.id, after: a.id },
          {
            field: 'target',
            before: `${b.target.kind}:${b.target.id}`,
            after: `${a.target.kind}:${a.target.id}`,
          },
          {
            field: 'rolloverIn',
            before: b.rolloverInAmount === null ? null : { amount: b.rolloverInAmount, currency },
            after: a.rolloverInAmount === null ? null : { amount: a.rolloverInAmount, currency },
          },
          { field: 'rolloverStatus', before: b.rolloverStatus, after: a.rolloverStatus },
        ],
      });
    }
  }
}
