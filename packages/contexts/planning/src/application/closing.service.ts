import type { AccountSummaryDto } from '@pf/accounts/contracts';
import type { AuditChangeInput, LifecycleEventRefDto } from '@pf/audit/contracts';
import {
  MONTH_CLOSED,
  PERIOD_REOPENED,
  type BudgetVsActual,
  type FinancialPeriodDto,
  type MonthClosedV1,
  type PeriodReopenedV1,
} from '../contracts/index.js';
import type { CategoryTreeDto } from '@pf/classification/contracts';
import type { ReconciliationCoverageDto } from '@pf/transactions/contracts';
import { DomainError, LocalDate, dec } from '@pf/shared-kernel';
import {
  CloseChecklistEvaluator,
  CloseSnapshotBuilder,
  ClosingPolicy,
  FINANCIAL_PERIOD_LIFECYCLE,
  POLICY_ITEM_KINDS,
  canonicalJson,
  type AcknowledgedWarnings,
  type ChecklistItem,
  type CloseChecklist,
  type FinancialPeriod,
  type MoneyValue,
  type SnapshotAccountInput,
  type SnapshotBudget,
  type SnapshotBuildInput,
  type SnapshotWithoutStatementRow,
} from '../domain/index.js';
import { toPeriodDto } from './period-view.js';
import { toChecklistDto, type CloseChecklistDto, type ClosingPolicyDto } from './closing-view.js';
import type { ClosingDeps } from './ports/index.js';

const AGGREGATE = 'FinancialPeriod';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `financial period ${id} not found`);
const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

/** Cuenta exigida para el cierre con su saldo a `periodEnd` (design.md decisión 2). */
interface RequiredAccount {
  readonly account: AccountSummaryDto;
  readonly ledgerAccountId: string | null;
  readonly balance: MoneyValue;
  readonly presented: MoneyValue;
}

interface Evaluation {
  readonly checklist: CloseChecklist;
  readonly required: readonly RequiredAccount[];
  readonly coverage: ReadonlyMap<string, ReconciliationCoverageDto>;
  readonly withoutStatement: readonly SnapshotWithoutStatementRow[];
}

/**
 * Casos de uso de cierre (openspec add-month-closing decisiones 1–5, 10, 12 y 13): checklist, política,
 * `CloseMonth` y `ReopenPeriod`. Cada comando corre en UNA unidad de trabajo (estado, bloqueo del ledger, snapshot,
 * auditoría + recorrido y outbox o nada, INV-015/INV-029). Los roles (EDITOR cierra, OWNER reabre y cambia la
 * política) los aplica el guard global de IDENTITY sobre `x-required-role`.
 */
export class ClosingService {
  constructor(private readonly deps: ClosingDeps) {}

  // ───────────────────────────────────────────────────────────────────────── política

  getPolicy(workspaceId: string): Promise<ClosingPolicyDto> {
    return this.deps.uow.run(workspaceId, async () => toPolicyDto(await this.policyOf(workspaceId)));
  }

  /** `PUT …/closing-policy` (OWNER, `If-Match`): auditado con la severidad anterior y la nueva de cada ítem. */
  updatePolicy(input: {
    readonly workspaceId: string;
    readonly severities: Readonly<Record<string, unknown>>;
    readonly expectedVersion: number;
  }): Promise<ClosingPolicyDto> {
    const { workspaceId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const policy = await this.policyOf(workspaceId);
      if (policy.version !== input.expectedVersion) throw preconditionFailed(policy.version);
      const actor = this.deps.actor.userId();
      const now = this.deps.clock.now().toString();
      const changes = policy.update(input.severities, actor === '' ? null : actor, now);
      if (!(await this.deps.policies.save(policy))) {
        throw preconditionFailed((await this.deps.policies.find(workspaceId))?.version);
      }
      await this.deps.audit.append({
        workspaceId,
        action: 'planning.closing_policy.updated',
        aggregateType: 'ClosingPolicy',
        aggregateId: workspaceId,
        aggregateVersion: policy.version,
        changes: changes.map((c) => ({ field: c.kind, before: c.before, after: c.after })),
      });
      return toPolicyDto(policy);
    });
  }

  // ───────────────────────────────────────────────────────────────────────── checklist

  /** `GET …/close-checklist`: consulta sin efectos (ni estado ni auditoría). */
  getChecklist(workspaceId: string, periodId: string): Promise<CloseChecklistDto> {
    return this.deps.uow.run(workspaceId, async () => {
      const period = await this.deps.periods.findById(workspaceId, periodId);
      if (!period) throw notFound(periodId);
      const evaluation = await this.evaluate(period);
      return toChecklistDto(period.snapshot, evaluation.checklist, this.deps.clock.now().toString());
    });
  }

  // ───────────────────────────────────────────────────────────────────────── cierre

  /**
   * `CloseMonth` (decisión 5), una sola unidad de trabajo `READ COMMITTED`:
   *  1. periodo `FOR UPDATE` + `If-Match`; 2. guardas (estado → orden → terminado); 3. bloqueo del rango en el ledger con
   *  el candado consultivo EXCLUSIVO del workspace; 4. checklist DESPUÉS del candado; 5. snapshot; 6. persistencia,
   *  auditoría, recorrido y evento. Cualquier excepción revierte todo (incluido el bloqueo).
   */
  closePeriod(input: {
    readonly workspaceId: string;
    readonly periodId: string;
    readonly expectedVersion: number;
    readonly acknowledgeWarnings: boolean;
    readonly note?: string | null;
  }): Promise<FinancialPeriodDto> {
    const { workspaceId, periodId } = input;
    const note = input.note?.trim() ?? '';
    if (note.length > 500)
      throw new DomainError('VALIDATION_FAILED', 'note exceeds 500 characters').at('/note');
    return this.deps.uow.run(workspaceId, async () => {
      const period = await this.deps.periods.findById(workspaceId, periodId, { lock: 'update' });
      if (!period) throw notFound(periodId);
      if (period.version !== input.expectedVersion) throw preconditionFailed(period.version);
      const { timeZone } = await this.deps.calendar.calendarOf(workspaceId);
      const nowInstant = this.deps.clock.now();
      const at = nowInstant.toString();
      const today = LocalDate.ofInstant(nowInstant, timeZone);
      const all = await this.deps.periods.list(workspaceId);
      const index = all.findIndex((p) => p.id === periodId);
      const previous = index > 0 ? (all[index - 1] ?? null) : null;
      const before = period.snapshot;
      // Guardas de dominio (estado → orden → terminado) y transición CLOSE.
      const closeNo = period.close(at, { previousStatus: previous?.status ?? null, today });

      // Bloqueo del ledger: candado exclusivo + rango; el primer periodo protege también todo lo anterior (decisión 6).
      await this.deps.lock.lockPeriod({
        workspaceId,
        yearMonth: before.label,
        periodId,
        periodStart: before.periodStart,
        periodEnd: before.periodEnd,
        openStart: previous === null,
      });

      const evaluation = await this.evaluate(period);
      const { checklist } = evaluation;
      if (!checklist.canClose) {
        throw new DomainError('MONTH_CLOSING_BLOCKED', 'the period has blocking checklist items', {
          details: { blockingItems: checklist.blockingItems },
        });
      }
      if (checklist.requiresAcknowledgement && !input.acknowledgeWarnings) {
        throw new DomainError(
          'MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED',
          'the checklist has warnings that must be acknowledged',
          { details: { warningItems: checklist.warningItems } },
        );
      }
      const actorId = this.deps.actor.userId() === '' ? null : this.deps.actor.userId();
      const acknowledged: AcknowledgedWarnings | null =
        checklist.warningItems.length > 0
          ? { items: checklist.warningItems.map((i) => i.kind), by: actorId, at }
          : null;

      const content = await this.buildContent(period, evaluation, acknowledged);
      const snapshots = await this.deps.snapshots.list(workspaceId, periodId);
      const previousSnapshotId = snapshots.at(-1)?.id ?? null;
      const snapshotId = this.deps.ids.next();
      await this.deps.snapshots.insert({
        id: snapshotId,
        workspaceId,
        periodId,
        closeNo,
        closedAt: at,
        closedBy: actorId,
        previousSnapshotId,
        content,
      });
      if (!(await this.deps.periods.update(period))) {
        throw preconditionFailed((await this.deps.periods.findById(workspaceId, periodId))?.version);
      }

      const event = await this.publishClosed(period, {
        snapshotId,
        previousSnapshotId,
        closeNo,
        at,
        actorId,
        content,
      });
      const changes: AuditChangeInput[] = [
        { field: 'status', before: before.status, after: 'CLOSED' },
        { field: 'closeNo', before: null, after: closeNo },
        { field: 'snapshotId', before: null, after: snapshotId },
      ];
      if (acknowledged) {
        changes.push({
          field: 'acknowledgedWarnings',
          before: null,
          after: JSON.stringify(
            checklist.warningItems.map((i) => ({ kind: i.kind, count: i.count, amounts: i.amounts })),
          ),
        });
      }
      if (note !== '') changes.push({ field: 'note', before: null, after: note });
      await this.record(period, 'planning.period.closed', changes, [event], { snapshotId, closeNo });
      return toPeriodDto(period, today);
    });
  }

  // ───────────────────────────────────────────────────────────────────────── reapertura

  /** `ReopenPeriod` (decisión 10): OWNER, motivo, orden inverso; no toca ningún snapshot. */
  reopenPeriod(input: {
    readonly workspaceId: string;
    readonly periodId: string;
    readonly expectedVersion: number;
    readonly reason: string;
  }): Promise<FinancialPeriodDto> {
    const { workspaceId, periodId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const period = await this.deps.periods.findById(workspaceId, periodId, { lock: 'update' });
      if (!period) throw notFound(periodId);
      if (period.version !== input.expectedVersion) throw preconditionFailed(period.version);
      const at = this.deps.clock.now().toString();
      const all = await this.deps.periods.list(workspaceId);
      const index = all.findIndex((p) => p.id === periodId);
      const next = index >= 0 ? (all[index + 1] ?? null) : null;
      const before = period.snapshot;
      const reason = input.reason.trim();
      const reopenNo = period.reopen(at, { nextStatus: next?.status ?? null, reason: input.reason });
      const current = (await this.deps.snapshots.list(workspaceId, periodId)).at(-1);
      if (!current) throw new DomainError('INTERNAL_ERROR', `closed period ${before.label} has no snapshot`);

      await this.deps.lock.unlockPeriod({ workspaceId, yearMonth: before.label, reason });
      const actor = this.deps.actor.userId();
      const reopenedBy = actor === '' ? null : actor;
      await this.deps.reopenings.insert({
        id: this.deps.ids.next(),
        workspaceId,
        periodId,
        reopenNo,
        reason,
        reopenedBy,
        reopenedAt: at,
        closedSnapshotId: current.id,
      });
      if (!(await this.deps.periods.update(period))) {
        throw preconditionFailed((await this.deps.periods.findById(workspaceId, periodId))?.version);
      }
      const payload: PeriodReopenedV1 = {
        workspaceId,
        periodId,
        label: before.label,
        periodStart: before.periodStart,
        periodEnd: before.periodEnd,
        reopenNo,
        reason,
        reopenedBy,
        reopenedAt: at,
        closedSnapshotId: current.id,
      };
      const event = await this.publish(period, PERIOD_REOPENED, payload);
      await this.record(
        period,
        'planning.period.reopened',
        [
          { field: 'status', before: 'CLOSED', after: 'REOPENED' },
          { field: 'reopenNo', before: null, after: reopenNo },
        ],
        [event],
        { snapshotId: current.id, reopenNo },
        reason,
      );
      const { timeZone } = await this.deps.calendar.calendarOf(workspaceId);
      return toPeriodDto(period, LocalDate.ofInstant(this.deps.clock.now(), timeZone));
    });
  }

  // ───────────────────────────────────────────────────────────────────────── evaluación

  private async policyOf(workspaceId: string): Promise<ClosingPolicy> {
    return (await this.deps.policies.find(workspaceId)) ?? ClosingPolicy.defaults(workspaceId);
  }

  /**
   * Reúne los datos por queries (TRANSACTIONS, ACCOUNTS, LEDGER) y delega el veredicto en el evaluador de dominio.
   * Cuenta exigida: no archivada con saldo ≠ 0 a `periodEnd` o con movimientos en el rango (decisión 2).
   */
  private async evaluate(period: FinancialPeriod): Promise<Evaluation> {
    const { workspaceId } = period;
    const s = period.snapshot;
    const range = { workspaceId, dateFrom: s.periodStart, dateTo: s.periodEnd };
    const policy = await this.policyOf(workspaceId);
    const [pending, duplicates, uncategorized] = await Promise.all([
      this.deps.closing.countPendingInRange(range),
      this.deps.closing.countOpenDuplicatesInRange(range),
      this.deps.closing.countUncategorizedInRange(range),
    ]);
    const accounts = await this.deps.accounts.listAccounts({ workspaceId });
    const balances = await this.deps.balances.getAccountBalances({
      workspaceId,
      accountIds: accounts.map((a) => a.accountId),
      asOf: s.periodEnd,
    });
    const active = new Set(await this.deps.closing.listAccountIdsWithActivityInRange(range));
    const balanceOf = new Map(
      balances.balances.filter((b) => b.accountId !== null).map((b) => [b.accountId as string, b]),
    );
    const required: RequiredAccount[] = [];
    for (const account of accounts) {
      const line = balanceOf.get(account.accountId);
      const balance: MoneyValue = line?.balance ?? { amount: '0', currency: account.currency };
      if (dec(balance.amount).isZero() && !active.has(account.accountId)) continue;
      required.push({
        account,
        ledgerAccountId: line?.ledgerAccountId ?? null,
        balance,
        presented: line?.presented ?? balance,
      });
    }
    const coverage = new Map<string, ReconciliationCoverageDto>();
    if (required.length > 0) {
      const rows = await this.deps.reconciliation.getCoverage({
        workspaceId,
        accountIds: required.map((r) => r.account.accountId),
        from: s.periodStart,
        through: s.periodEnd,
      });
      for (const row of rows) coverage.set(row.accountId, row);
    }
    const reconciled = (r: RequiredAccount) => coverage.get(r.account.accountId)?.reconciledThrough === true;
    const unreconciled = required
      .filter((r) => !reconciled(r))
      .map((r) => ({ accountId: r.account.accountId, name: r.account.name, balance: r.balance }));
    const noStatementAccounts = required.filter(
      (r) => reconciled(r) && coverage.get(r.account.accountId)?.reconciliationBasis === 'WITHOUT_STATEMENT',
    );
    const rows =
      noStatementAccounts.length > 0
        ? await this.deps.closing.listReconciledWithoutStatementInRange({
            ...range,
            accountIds: noStatementAccounts.map((r) => r.account.accountId),
          })
        : [];
    const withoutStatement: SnapshotWithoutStatementRow[] = rows.map((r) => ({
      transactionId: r.transactionId,
      accountId: r.accountId,
      businessDate: r.businessDate,
      amount: r.amount,
    }));
    const checklist = CloseChecklistEvaluator.evaluate({
      severities: policy.severities,
      pending,
      duplicates,
      uncategorized,
      unreconciled,
      withoutStatement: noStatementAccounts.map((r) => ({
        accountId: r.account.accountId,
        name: r.account.name,
        transactions: withoutStatement
          .filter((w) => w.accountId === r.account.accountId)
          .map((w) => ({ transactionId: w.transactionId, businessDate: w.businessDate, amount: w.amount })),
      })),
    });
    return { checklist, required, coverage, withoutStatement };
  }

  private async buildContent(
    period: FinancialPeriod,
    evaluation: Evaluation,
    acknowledged: AcknowledgedWarnings | null,
  ) {
    const { workspaceId } = period;
    const s = period.snapshot;
    const { baseCurrency } = await this.deps.settings.settingsOf(workspaceId);
    const flows = await this.deps.flows.getFlows({
      workspaceId,
      dateFrom: s.periodStart,
      dateTo: s.periodEnd,
      reportingCurrency: baseCurrency,
    });
    const nw = await this.deps.netWorth.getNetWorth({
      workspaceId,
      asOf: s.periodEnd,
      reportingCurrency: baseCurrency,
    });
    const budget = this.deps.budgets
      ? await this.deps.budgets.getForPeriod({ workspaceId, periodId: s.id })
      : null;
    const accounts: SnapshotAccountInput[] = evaluation.required.map((r) => {
      const cov = evaluation.coverage.get(r.account.accountId);
      const last = cov?.lastCompleted ?? null;
      return {
        accountId: r.account.accountId,
        accountName: r.account.name,
        ledgerAccountId: r.ledgerAccountId,
        currency: r.account.currency,
        balance: r.balance,
        presented: r.presented,
        reconciliation: last
          ? {
              reconciliationId: last.reconciliationId,
              statementDate: last.statementDate,
              statementBalance: last.statementBalance,
            }
          : null,
        reconciliationBasis: cov?.reconciledThrough ? cov.reconciliationBasis : null,
      };
    });
    const input: SnapshotBuildInput = {
      period: {
        periodId: s.id,
        label: s.label,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        startDay: s.startDay,
      },
      baseCurrency,
      accounts,
      withoutStatement: evaluation.withoutStatement,
      flows: {
        byCurrency: flows.byCurrency.map((f) => ({
          currency: f.currency,
          income: f.income,
          expense: f.expense,
        })),
        consolidated: {
          currency: flows.consolidated.currency,
          income: flows.consolidated.income,
          expense: flows.consolidated.expense,
          savings: flows.consolidated.net,
          savingsRate: flows.consolidated.savingsRate,
          complete: flows.consolidated.complete,
          unconverted: flows.consolidated.unconverted,
        },
      },
      netWorth: {
        amount: nw.netWorth.netWorth,
        assets: nw.netWorth.assets,
        liabilities: nw.netWorth.liabilities,
        complete: nw.netWorth.complete,
        unconverted: nw.netWorth.unvalued,
        rates: dedupe([...flows.ratesUsed, ...nw.ratesUsed]) as unknown as readonly Record<string, unknown>[],
      },
      budgetVsActual: budget ? await this.budgetOf(workspaceId, budget) : null,
      checklist: evaluation.checklist.items as readonly ChecklistItem[],
      acknowledgedWarnings: acknowledged,
    };
    return CloseSnapshotBuilder.build(input);
  }

  private async budgetOf(workspaceId: string, budget: BudgetVsActual): Promise<SnapshotBudget> {
    let tree: CategoryTreeDto | null = null;
    if (this.deps.catalog) {
      const actor = this.deps.actor.userId();
      tree = await this.deps.catalog.categoryTree({ userId: actor, workspaceId });
    }
    const nameOf = (kind: 'CATEGORY' | 'GROUP' | 'TAG', id: string): string => {
      if (!tree) return id;
      if (kind === 'CATEGORY') return tree.categories.find((c) => c.categoryId === id)?.name ?? id;
      if (kind === 'GROUP') return tree.groups.find((g) => g.groupId === id)?.name ?? id;
      return tree.tags.find((t) => t.tagId === id)?.name ?? id;
    };
    return {
      budgetId: budget.budgetId,
      currency: budget.currency,
      lines: budget.lines.map((l) => ({
        target: l.target,
        targetName: nameOf(l.target.kind, l.target.id),
        nature: l.nature,
        reference: l.reference,
        actual: l.actual,
        status: l.status,
      })),
      totals: {
        planned: budget.totals.planned,
        actual: budget.totals.actual,
        complete: budget.totals.complete,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────── eventos y recorrido

  private async publishClosed(
    period: FinancialPeriod,
    r: {
      readonly snapshotId: string;
      readonly previousSnapshotId: string | null;
      readonly closeNo: number;
      readonly at: string;
      readonly actorId: string | null;
      readonly content: ReturnType<typeof CloseSnapshotBuilder.build>;
    },
  ): Promise<LifecycleEventRefDto> {
    const s = period.snapshot;
    const c = r.content;
    const payload: MonthClosedV1 = {
      workspaceId: s.workspaceId,
      periodId: s.id,
      label: s.label,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      closeNo: r.closeNo,
      snapshotId: r.snapshotId,
      previousSnapshotId: r.previousSnapshotId,
      closedAt: r.at,
      closedBy: r.actorId,
      baseCurrency: c.baseCurrency,
      totalsByCurrency: c.flows.byCurrency.map((f) => ({
        currency: f.currency,
        income: f.income,
        expense: f.expense,
      })),
      consolidated: {
        income: c.flows.consolidated.income,
        expense: c.flows.consolidated.expense,
        savings: c.flows.consolidated.savings,
        savingsRate: c.flows.consolidated.savingsRate,
      },
      balances: c.balances.map((b) => ({ accountId: b.accountId, balance: b.balance })),
      netWorth: { amount: c.netWorth.amount, complete: c.netWorth.complete },
    };
    return this.publish(period, MONTH_CLOSED, payload);
  }

  private async publish(
    period: FinancialPeriod,
    event: { readonly eventType: string; readonly eventVersion: number },
    payload: object,
  ): Promise<LifecycleEventRefDto> {
    const eventId = this.deps.ids.next();
    await this.deps.outbox.append({
      eventId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      occurredAt: this.deps.clock.now().toString(),
      workspaceId: period.workspaceId,
      aggregateType: AGGREGATE,
      aggregateId: period.id,
      aggregateVersion: period.version,
      payload,
    });
    return { eventId, eventType: `${event.eventType}.v${event.eventVersion}` };
  }

  /** Auditoría + transición del recorrido (`CLOSE`/`REOPEN`) en la misma unidad de trabajo (INV-029). */
  private record(
    period: FinancialPeriod,
    action: string,
    changes: readonly AuditChangeInput[],
    events: readonly LifecycleEventRefDto[],
    detailRefs: Readonly<Record<string, string | number>>,
    reason?: string,
  ): Promise<void> {
    const s = period.snapshot;
    const t = period.lastTransition;
    const entry = {
      workspaceId: s.workspaceId,
      action,
      aggregateType: AGGREGATE,
      aggregateId: s.id,
      aggregateVersion: s.version,
      changes,
      ...(reason === undefined ? {} : { reason }),
    };
    if (!t) return this.deps.audit.append(entry);
    return this.deps.lifecycle.record(entry, [
      {
        kind: 'TRANSITION',
        transition: t.transition,
        fromState: t.from,
        toState: t.to,
        machineVersion: FINANCIAL_PERIOD_LIFECYCLE.version,
        detailRefs,
        events,
      },
    ]);
  }
}

function toPolicyDto(policy: ClosingPolicy): ClosingPolicyDto {
  const s = policy.snapshot;
  return {
    severities: Object.fromEntries(POLICY_ITEM_KINDS.map((k) => [k, s.severities[k]])),
    version: s.version,
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  };
}

function dedupe<T>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = canonicalJson(i);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
