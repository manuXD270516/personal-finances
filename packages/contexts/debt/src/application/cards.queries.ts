import { DomainError, LocalDate, Money } from '@pf/shared-kernel';
import type { CardPortfolioAccountDto, CardPortfolioQuery } from '../contracts/index.js';
import { CardInstallmentPlan, diffFigures, expectationForOpen, type CreditCard } from '../domain/index.js';
import { CardEngine, type AccountView, type CardClock, type CycleView } from './card-engine.js';
import type { CardDeps } from './card-ports.js';
import {
  cardView,
  figuresView,
  installmentPlanView,
  statementView,
  type CardStatementView,
  type CreditCardView,
  type InstallmentPlanView,
} from './card-views.js';

const notFound = (what: string, id: string) =>
  new DomainError('RESOURCE_NOT_FOUND', `${what} ${id} not found`);

export interface FutureChargeView {
  readonly dueDate: string;
  readonly closingDate: string;
  readonly accountId: string;
  readonly currency: string;
  readonly installments: readonly {
    readonly planId: string;
    readonly purchaseTransactionId: string;
    readonly n: number;
    readonly of: number;
    readonly principal: { amount: string; currency: string };
    readonly interest: { amount: string; currency: string };
    readonly total: { amount: string; currency: string };
  }[];
  readonly total: { amount: string; currency: string };
}

/**
 * Consultas de tarjetas (openspec add-credit-cards § Contratos). Todo se calcula en lectura desde el ledger; los
 * estados emitidos aportan las cifras congeladas. Implementa `CardPortfolioQuery` (insumo de `add-debt-summary`).
 */
export class CardsQueries implements CardPortfolioQuery {
  readonly engine: CardEngine;

  constructor(private readonly deps: CardDeps) {
    this.engine = new CardEngine(deps);
  }

  private async card(workspaceId: string, id: string): Promise<CreditCard> {
    const card = await this.deps.cards.findById(workspaceId, id);
    if (!card) throw notFound('credit card', id);
    return card;
  }

  private async detail(
    card: CreditCard,
    clock: CardClock,
    cycles: number,
  ): Promise<CreditCardView & { ratesUsed?: unknown }> {
    const views = await this.engine.loadViews(card, clock, cycles);
    const scopes = await this.engine.utilizationScopes(card, views, clock);
    const ratesUsed = scopes.flatMap((s) => s.ratesUsed);
    return { ...cardView(card.snapshot, views, scopes), ...(ratesUsed.length > 0 ? { ratesUsed } : {}) };
  }

  list(
    workspaceId: string,
    filter: { status?: string; accountId?: string } = {},
  ): Promise<readonly CreditCardView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const clock = await this.engine.clockOf(workspaceId);
      const cards = await this.deps.cards.list(workspaceId, filter);
      const out: CreditCardView[] = [];
      for (const card of cards) out.push(await this.detail(card, clock, 1));
      return out;
    });
  }

  get(workspaceId: string, id: string): Promise<CreditCardView & { ratesUsed?: unknown }> {
    return this.deps.uow.run(workspaceId, async () => {
      const clock = await this.engine.clockOf(workspaceId);
      return this.detail(await this.card(workspaceId, id), clock, 2);
    });
  }

  private statementsOf(view: AccountView): CardStatementView[] {
    return [...view.cycles].reverse().map((cv: CycleView) => {
      const diff = cv.issued ? figuresView(diffFigures(cv.issued, cv.current)) : null;
      return statementView(view, cv, diff);
    });
  }

  listStatements(
    workspaceId: string,
    cardId: string,
    filter: { accountId?: string; from?: string; to?: string } = {},
  ): Promise<readonly CardStatementView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const clock = await this.engine.clockOf(workspaceId);
      const card = await this.card(workspaceId, cardId);
      const views = await this.engine.loadViews(card, clock);
      let rows = views
        .filter(
          (v) =>
            !filter.accountId ||
            v.account.accountId === filter.accountId ||
            v.account.id === filter.accountId,
        )
        .flatMap((v) => this.statementsOf(v));
      if (filter.from) rows = rows.filter((r) => r.closingDate >= (filter.from as string));
      if (filter.to) rows = rows.filter((r) => r.closingDate <= (filter.to as string));
      return rows.sort((a, b) =>
        a.closingDate === b.closingDate
          ? a.currency < b.currency
            ? -1
            : 1
          : a.closingDate < b.closingDate
            ? 1
            : -1,
      );
    });
  }

  getStatement(workspaceId: string, cardId: string, statementId: string): Promise<CardStatementView> {
    return this.deps.uow.run(workspaceId, async () => {
      const clock = await this.engine.clockOf(workspaceId);
      const card = await this.card(workspaceId, cardId);
      const record = await this.deps.statements.find(workspaceId, statementId);
      const account = record ? card.snapshot.accounts.find((a) => a.id === record.cardAccountId) : undefined;
      if (!record || !account) throw notFound('card statement', statementId);
      const view = await this.engine.loadAccountView(card, account, clock, {
        cycles: this.deps.settings.historyCycles,
      });
      const found = this.statementsOf(view).find((s) => s.id === statementId);
      if (!found) {
        // Estado anterior a la ventana calculada: se muestra con las cifras emitidas.
        throw notFound('card statement', statementId);
      }
      return found;
    });
  }

  /** Versión actual del estado de cuenta (If-Match de `PATCH …/statements/{id}`). */
  statementVersion(workspaceId: string, statementId: string): Promise<number> {
    return this.deps.uow.run(workspaceId, async () => {
      const record = await this.deps.statements.find(workspaceId, statementId);
      if (!record) throw notFound('card statement', statementId);
      return record.version;
    });
  }

  listInstallmentPlans(workspaceId: string, cardId: string): Promise<readonly InstallmentPlanView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const card = await this.card(workspaceId, cardId);
      const plans = await this.deps.plans.listForCardAccounts(
        workspaceId,
        card.snapshot.accounts.map((a) => a.id),
      );
      return plans.map((p) => installmentPlanView(p.snapshot));
    });
  }

  getInstallmentPlan(workspaceId: string, cardId: string, planId: string): Promise<InstallmentPlanView> {
    return this.deps.uow.run(workspaceId, async () => {
      const card = await this.card(workspaceId, cardId);
      const plan = await this.deps.plans.findById(workspaceId, planId);
      if (!plan || !card.snapshot.accounts.some((a) => a.id === plan.snapshot.cardAccountId)) {
        throw notFound('installment plan', planId);
      }
      return installmentPlanView(plan.snapshot);
    });
  }

  getFutureCharges(
    workspaceId: string,
    cardId: string,
    months: number,
  ): Promise<readonly FutureChargeView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const clock = await this.engine.clockOf(workspaceId);
      const card = await this.card(workspaceId, cardId);
      const horizon = clock.today.plusDays(Math.max(1, Math.min(24, months)) * 31);
      const out: FutureChargeView[] = [];
      for (const account of card.snapshot.accounts) {
        const plans = await this.deps.plans.listForCardAccounts(workspaceId, [account.id]);
        for (const group of CardInstallmentPlan.futureCharges(plans, clock.today)) {
          if (LocalDate.parse(group.dueDate).compare(horizon) > 0) continue;
          const cur = { code: account.currency, scale: account.scale };
          const total = group.installments.reduce(
            (acc, i) => acc.add(Money.parse(i.total, cur)),
            Money.zero(cur),
          );
          out.push({
            dueDate: group.dueDate,
            closingDate: group.closingDate,
            accountId: account.accountId,
            currency: account.currency,
            installments: group.installments.map((i) => ({
              planId: i.planId,
              purchaseTransactionId: i.purchaseTransactionId,
              n: i.n,
              of: i.of,
              principal: { amount: i.principal, currency: account.currency },
              interest: { amount: i.interest, currency: account.currency },
              total: { amount: i.total, currency: account.currency },
            })),
            total: total.toJSON(),
          });
        }
      }
      return out.sort((a, b) =>
        a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.currency < b.currency ? -1 : 1,
      );
    });
  }

  // ───────────────────────────────────────────── contrato público

  listCards(input: { readonly workspaceId: string }): Promise<readonly CardPortfolioAccountDto[]> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const clock = await this.engine.clockOf(input.workspaceId);
      const cards = await this.deps.cards.list(input.workspaceId, { status: 'ACTIVE' });
      const out: CardPortfolioAccountDto[] = [];
      for (const card of cards) {
        const views = await this.engine.loadViews(card, clock, 2);
        for (const v of views) {
          const open = v.cycles.at(-1) as CycleView;
          const closed = v.cycles.filter((c) => !c.open && c.record);
          const last = closed.at(-1);
          const estimate = expectationForOpen({
            policy: 'NO_INTEREST',
            minimumRule: v.account.minimumRule,
            presentedBalance: v.balance,
            dueIssuedRemaining: v.cycles
              .filter((c) => !c.open && c.standing && c.cycle.dueDate.compare(clock.today) >= 0)
              .reduce((acc, c) => acc.add(c.standing!.remainingNoInterest), Money.zero(v.currency)),
            unbilledAfter: CardInstallmentPlan.unbilledCapital(v.plans, open.cycle.closing, v.currency),
          });
          const lastDue = v.plans
            .filter((p) => p.status === 'ACTIVE')
            .flatMap((p) => p.snapshot.installments.map((i) => i.dueDate))
            .sort()
            .at(-1);
          out.push({
            cardId: card.id,
            cardName: card.snapshot.name,
            cardAccountId: v.account.id,
            accountId: v.account.accountId,
            currency: v.currency.code,
            balance: v.balance.toJSON(),
            lastStatement:
              last && last.record && last.standing
                ? {
                    statementId: last.record.id,
                    closingDate: last.record.closingDate,
                    dueDate: last.record.dueDate,
                    remainingNoInterest: last.standing.remainingNoInterest.toJSON(),
                    remainingMinimum: last.standing.remainingMinimum.toJSON(),
                    status: last.status,
                  }
                : null,
            openCycle: {
              closingDate: open.cycle.closing.toString(),
              dueDate: open.cycle.dueDate.toString(),
              estimatedNoInterest:
                'amount' in estimate ? estimate.amount.toJSON() : Money.zero(v.currency).toJSON(),
              hasOwnPurchases: open.current.purchases.isPositive(),
            },
            unbilledInstallments: CardInstallmentPlan.unbilledCapital(
              v.plans,
              open.cycle.closing,
              v.currency,
            ).toJSON(),
            lastInstallmentDueDate: lastDue ?? null,
          });
        }
      }
      return out;
    });
  }
}
