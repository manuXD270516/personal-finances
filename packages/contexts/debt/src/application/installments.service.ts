import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, Money, currency as makeCurrency } from '@pf/shared-kernel';
import { CardInstallmentPlan, type CardInstallmentPlanState, type CreditCard } from '../domain/index.js';
import { CardEngine } from './card-engine.js';
import type { CardDeps } from './card-ports.js';
import { installmentPlanView, type InstallmentPlanView } from './card-views.js';

const PLAN_AGGREGATE = 'CardInstallmentPlan';
const POSTED = new Set(['POSTED', 'CLEARED', 'RECONCILED']);

const invalid = (message: string, pointer = '/purchaseTransactionId') =>
  new DomainError('INSTALLMENT_PLAN_INVALID', message).at(pointer);

function planChanges(
  plan: CardInstallmentPlanState,
  before: CardInstallmentPlanState | null,
): AuditChangeInput[] {
  const cur = plan.currency;
  const diff = (field: string, b: unknown, a: unknown) =>
    before === null || JSON.stringify(b) !== JSON.stringify(a)
      ? [{ field, before: before === null ? null : b, after: a }]
      : [];
  return [
    ...diff('cardAccountId', before?.cardAccountId, plan.cardAccountId),
    ...diff('purchaseTransactionId', before?.purchaseTransactionId, plan.purchaseTransactionId),
    ...diff('principal', before && { amount: before.principal, currency: cur }, {
      amount: plan.principal,
      currency: cur,
    }),
    ...diff('installmentCount', before?.installmentCount, plan.installmentCount),
    ...diff('annualRate', before?.annualRate, plan.annualRate),
    ...diff('startCycle', before?.startCycle, plan.startCycle),
    ...diff('status', before?.status, plan.status),
    ...diff('cancelReason', before?.cancelReason, plan.cancelReason),
  ];
}

/**
 * Planes de cuotas de compras con tarjeta (openspec add-credit-cards, decisión 13; Could). No crean asientos: la
 * compra ya adeuda su monto completo; el plan reparte el capital que se factura en cada ciclo.
 */
export class InstallmentsService {
  readonly engine: CardEngine;

  constructor(private readonly deps: CardDeps) {
    this.engine = new CardEngine(deps);
  }

  private async loadCard(workspaceId: string, cardId: string): Promise<CreditCard> {
    const card = await this.deps.cards.findById(workspaceId, cardId, { lock: 'update' });
    if (!card) throw new DomainError('RESOURCE_NOT_FOUND', `credit card ${cardId} not found`);
    card.assertActive();
    return card;
  }

  async create(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly cardId: string;
    readonly purchaseTransactionId: unknown;
    readonly installmentCount: unknown;
    readonly annualRate?: unknown;
    readonly startCycle?: unknown;
  }): Promise<InstallmentPlanView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const clock = await this.engine.clockOf(cmd.workspaceId);
      const card = await this.loadCard(cmd.workspaceId, cmd.cardId);
      if (typeof cmd.purchaseTransactionId !== 'string') throw invalid('purchaseTransactionId is required');
      if (typeof cmd.installmentCount !== 'number')
        throw invalid('installmentCount is required', '/installmentCount');
      const txn = await deps.links.getForLink({
        workspaceId: cmd.workspaceId,
        transactionId: cmd.purchaseTransactionId,
      });
      if (!txn) throw invalid('the purchase does not exist');
      const account = card.snapshot.accounts.find((a) => a.accountId === txn.accountId);
      if (!account) throw invalid('the purchase does not belong to an account of the card');
      if (txn.kind !== 'EXPENSE') throw invalid('only an expense can be paid in installments');
      if (!POSTED.has(txn.status)) throw invalid('the purchase must be posted');
      if (await deps.plans.findByPurchase(cmd.workspaceId, txn.transactionId)) {
        throw invalid('the purchase already has an installment plan');
      }
      const cur = makeCurrency(account.currency, account.scale);
      const rate = cmd.annualRate === undefined || cmd.annualRate === null ? '0' : cmd.annualRate;
      if (typeof rate !== 'string') throw invalid('annualRate must be a decimal string', '/annualRate');
      const plan = CardInstallmentPlan.create({
        id: deps.ids.next(),
        workspaceId: cmd.workspaceId,
        cardAccountId: account.id,
        purchaseTransactionId: txn.transactionId,
        purchaseDate: txn.businessDate,
        principal: Money.parse(txn.amount.amount, cur),
        count: cmd.installmentCount,
        annualRatePercent: rate,
        startCycle: cmd.startCycle as 'PURCHASE' | 'NEXT' | undefined,
        calendar: card.calendar,
        at: clock.at,
        by: cmd.userId,
      });
      await deps.plans.insert(plan, cmd.userId);
      await deps.audit.append({
        workspaceId: cmd.workspaceId,
        action: 'debt.card_installment_plan.created',
        aggregateType: PLAN_AGGREGATE,
        aggregateId: plan.id,
        aggregateVersion: plan.version,
        changes: planChanges(plan.snapshot, null),
      });
      await this.resync(card, clock, cmd.userId);
      return installmentPlanView(plan.snapshot);
    });
  }

  async cancel(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly cardId: string;
    readonly planId: string;
    readonly expectedVersion: number;
  }): Promise<InstallmentPlanView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const clock = await this.engine.clockOf(cmd.workspaceId);
      const card = await this.loadCard(cmd.workspaceId, cmd.cardId);
      const plan = await deps.plans.findById(cmd.workspaceId, cmd.planId, { lock: 'update' });
      if (!plan || !card.snapshot.accounts.some((a) => a.id === plan.snapshot.cardAccountId)) {
        throw new DomainError('RESOURCE_NOT_FOUND', `installment plan ${cmd.planId} not found`);
      }
      if (plan.version !== cmd.expectedVersion) {
        throw new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
          details: { currentVersion: plan.version },
        });
      }
      await this.cancelPlan(plan, 'USER', clock.at, cmd.workspaceId);
      await this.resync(card, clock, cmd.userId);
      return installmentPlanView(plan.snapshot);
    });
  }

  /** Cancela un plan y lo audita (la tarjeta ya está bloqueada por el llamador). */
  async cancelPlan(
    plan: CardInstallmentPlan,
    reason: 'USER' | 'PURCHASE_VOIDED' | 'PURCHASE_REVISED',
    at: string,
    workspaceId: string,
  ): Promise<void> {
    const before = plan.snapshot;
    plan.cancel(reason, at);
    if (!(await this.deps.plans.save(plan))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the installment plan was modified concurrently');
    }
    await this.deps.audit.append({
      workspaceId,
      action: 'debt.card_installment_plan.cancelled',
      aggregateType: PLAN_AGGREGATE,
      aggregateId: plan.id,
      aggregateVersion: plan.version,
      changes: planChanges(plan.snapshot, before),
      reason,
    });
  }

  /** Recalcula las expectativas del plan de pago tras cambiar las cuotas (utilización no cambia). */
  private async resync(card: CreditCard, clock: Awaited<ReturnType<CardEngine['clockOf']>>, userId: string) {
    const views = await this.engine.loadViews(card, clock);
    for (const v of views) await this.engine.syncPlan(card, v, clock, userId);
  }
}
