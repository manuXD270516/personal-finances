import type { AccountCatalogQuery } from '@pf/accounts/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { FxValuationPort, ResolvedRateDto } from '@pf/fx/contracts';
import type { AccountBalancesQuery } from '@pf/ledger/contracts';
import {
  FlowValuation,
  LocalDate,
  Money,
  currency,
  present,
  sumByCurrency,
  type Clock,
  type Consolidated,
  type Currency,
  type DatedAmount,
} from '@pf/shared-kernel';
import type { AccountMovementsQuery, NominalFlowQuery } from '@pf/transactions/contracts';
import type {
  CardPortfolioAccountDto,
  CardPortfolioQuery,
  DebtSummaryConsolidatedDto,
  DebtSummaryDto,
  DebtSummaryQuery,
  LoanPortfolioItemDto,
  LoanPortfolioQuery,
  MoneyDto,
} from '../contracts/index.js';
import {
  DebtFreeDateEstimator,
  DebtSummaryCalculator,
  InterestAttribution,
  UpcomingDebtDues,
  interestYearStart,
  type DueDebtInput,
  type InterestSource,
  type LiabilityAccount,
  type PayoffDebtInput,
} from '../domain/index.js';
import type { CurrencyCatalogPort, UnitOfWork } from './ports/index.js';

/** Moneda base y zona horaria del workspace (IDENTITY; adapter en la composición). */
export interface WorkspaceSettingsPort {
  settingsOf(workspaceId: string): Promise<{ readonly baseCurrency: string; readonly timeZone: string }>;
}

export interface DebtSummaryDeps {
  readonly uow: UnitOfWork;
  readonly loans: Pick<LoanPortfolioQuery, 'listLoans' | 'interestPaid'>;
  readonly cards: CardPortfolioQuery;
  readonly accountCatalog: Pick<AccountCatalogQuery, 'listAccounts'>;
  readonly balances: AccountBalancesQuery;
  readonly flows: NominalFlowQuery;
  readonly movements: AccountMovementsQuery;
  readonly categories: Pick<CategoryCatalogQuery, 'categoryTree'>;
  readonly rates: Pick<FxValuationPort, 'resolveValuationRates'>;
  readonly workspaces: WorkspaceSettingsPort;
  readonly currencies: CurrencyCatalogPort;
  readonly clock: Clock;
  /** Ventana de vigencia de las tasas de valoración (`REPORTING_RATE_VALIDITY_WINDOW`, días). */
  readonly rateValidityWindowDays: number;
}

const decimalsOf = (amount: string): number => amount.split('.')[1]?.length ?? 0;
const rateKey = (r: ResolvedRateDto): string => JSON.stringify(r);

/**
 * `GetDebtSummary` (openspec add-debt-summary, FR-DEBT-018): resumen de deudas sin estado propio. Compone lo que
 * exponen los préstamos, las tarjetas, el catálogo de cuentas, el ledger y las transacciones; una sola resolución de
 * tasas (total a la tasa de hoy, interés a la de cada fecha) y lecturas en lote, secuenciales dentro de la unidad de
 * trabajo (nunca en paralelo sobre el mismo cliente).
 */
export class DebtSummaryQueries implements DebtSummaryQuery {
  constructor(private readonly deps: DebtSummaryDeps) {}

  async getDebtSummary(input: {
    readonly workspaceId: string;
    readonly userId: string;
  }): Promise<DebtSummaryDto> {
    const { deps } = this;
    const { workspaceId } = input;
    return deps.uow.run(workspaceId, async () => {
      const settings = await deps.workspaces.settingsOf(workspaceId);
      const now = deps.clock.now();
      const today = LocalDate.ofInstant(now, settings.timeZone);
      const scales = new Map<string, number>();
      const scaleOf = async (code: string, sample = '0'): Promise<number> => {
        const known = scales.get(code);
        if (known !== undefined) return known;
        const scale = (await deps.currencies.scaleOf(code)) ?? decimalsOf(sample);
        scales.set(code, scale);
        return scale;
      };
      const moneyOf = async (dto: MoneyDto): Promise<Money> =>
        Money.parse(dto.amount, currency(dto.currency, await scaleOf(dto.currency, dto.amount)));
      const base: Currency = currency(settings.baseCurrency, await scaleOf(settings.baseCurrency));
      const empty = (status: DebtSummaryDto['status']): DebtSummaryDto => {
        const zero = Money.zero(base).toJSON();
        const none: DebtSummaryConsolidatedDto = { amount: zero, complete: true, unconverted: [] };
        return {
          status,
          asOf: today.toString(),
          baseCurrency: base.code,
          debts: [],
          totals: { byCurrency: [], consolidated: none },
          creditBalances: [],
          interestYtd: {
            from: interestYearStart(today).toString(),
            to: today.toString(),
            byCurrency: [],
            consolidated: none,
            attribution: [],
            attributionConsistent: true,
          },
          debtFree: { date: null, excluded: [] },
          upcomingDues: [],
          meta: { ratesUsed: [], rateWindowDays: deps.rateValidityWindowDays },
        };
      };

      // ---- universo: cuentas de pasivo no archivadas con su saldo presentado a hoy
      const catalog = await deps.accountCatalog.listAccounts({ workspaceId, includeArchived: false });
      const liabilities = catalog.filter((a) => a.nature === 'LIABILITY');
      if (liabilities.length === 0) return empty('NO_LIABILITIES');
      const balanceResult = await deps.balances.getAccountBalances({
        workspaceId,
        accountIds: liabilities.map((a) => a.accountId),
      });
      const presented = new Map(
        balanceResult.balances
          .filter((b) => b.accountId !== null)
          .map((b) => [b.accountId as string, b.presented] as const),
      );
      const accounts: LiabilityAccount[] = [];
      for (const a of liabilities) {
        const cur = currency(a.currency, await scaleOf(a.currency));
        const dto = presented.get(a.accountId);
        accounts.push({
          accountId: a.accountId,
          name: a.name,
          currency: cur,
          balance: dto ? await moneyOf(dto) : Money.zero(cur),
          includedInNetWorth: a.includeInNetWorth,
        });
      }

      // ---- perfiles de Debt
      const loans = await deps.loans.listLoans({ workspaceId, statuses: ['ACTIVE', 'PAID_OFF'] });
      const cardAccounts = await deps.cards.listCards({ workspaceId });
      const grouping = DebtSummaryCalculator.group({
        accounts,
        loans: loans.map((l) => ({ id: l.loanId, name: l.name, accountId: l.accountId })),
        cards: cardAccounts.map((c) => ({ id: c.cardId, name: c.cardName, accountId: c.accountId })),
      });

      // ---- fecha libre de deudas y próximos vencimientos (solo de las deudas con saldo)
      const loanById = new Map<string, LoanPortfolioItemDto>(loans.map((l) => [l.loanId, l] as const));
      const cardAccountById = new Map<string, CardPortfolioAccountDto>(
        cardAccounts.map((c) => [c.accountId, c] as const),
      );
      const payoffInputs: PayoffDebtInput[] = [];
      const dueInputs: DueDebtInput[] = [];
      for (const debt of grouping.debts) {
        if (debt.kind === 'LOAN') {
          const loan = loanById.get(debt.id) as LoanPortfolioItemDto;
          payoffInputs.push({
            kind: 'LOAN',
            id: debt.id,
            name: debt.name,
            lastUnpaidDueDate: loan.lastUnpaidInstallmentDueDate,
          });
          dueInputs.push({
            kind: 'LOAN',
            id: debt.id,
            name: debt.name,
            accountId: loan.accountId,
            next: loan.nextInstallment
              ? {
                  dueDate: loan.nextInstallment.dueDate,
                  outstanding: await moneyOf(loan.nextInstallment.outstanding),
                  overdueDays: loan.nextInstallment.overdueDays,
                }
              : null,
          });
        } else if (debt.kind === 'CREDIT_CARD') {
          const payoffAccounts = [];
          const dueAccounts = [];
          for (const b of debt.balances) {
            const card = cardAccountById.get(b.accountId) as CardPortfolioAccountDto;
            const statement = card.lastStatement;
            const remaining = statement ? await moneyOf(statement.remainingNoInterest) : null;
            payoffAccounts.push({
              accountId: b.accountId,
              balance: b.outstanding,
              lastStatement:
                statement && remaining
                  ? { dueDate: statement.dueDate, remainingNoInterest: remaining }
                  : null,
              openCycleDueDate: card.openCycle.dueDate,
              unbilledInstallments: await moneyOf(card.unbilledInstallments),
              lastInstallmentDueDate: card.lastInstallmentDueDate,
            });
            dueAccounts.push({
              accountId: b.accountId,
              balance: b.outstanding,
              lastStatement:
                statement && remaining
                  ? {
                      dueDate: statement.dueDate,
                      remainingNoInterest: remaining,
                      remainingMinimum: await moneyOf(statement.remainingMinimum),
                    }
                  : null,
              openCycle: {
                dueDate: card.openCycle.dueDate,
                estimatedNoInterest: await moneyOf(card.openCycle.estimatedNoInterest),
              },
            });
          }
          payoffInputs.push({ kind: 'CREDIT_CARD', id: debt.id, name: debt.name, accounts: payoffAccounts });
          dueInputs.push({ kind: 'CREDIT_CARD', id: debt.id, name: debt.name, accounts: dueAccounts });
        } else {
          payoffInputs.push({ kind: 'OTHER_LIABILITY', id: debt.id, name: debt.name });
        }
      }
      const payoff = DebtFreeDateEstimator.estimate(payoffInputs);
      const dues = UpcomingDebtDues.list(dueInputs, today);

      // ---- interés pagado del año (1 de enero a hoy, zona del workspace)
      const from = interestYearStart(today).toString();
      const to = today.toString();
      const tree = await deps.categories.categoryTree({ userId: input.userId, workspaceId });
      const interestIds = tree.categories.filter((c) => c.systemCode === 'INTEREST').map((c) => c.categoryId);
      const interestRows = interestIds.length
        ? await deps.flows.summarizeNominalFlows({
            workspaceId,
            dateFrom: from,
            dateTo: to,
            categoryIds: interestIds,
          })
        : [];
      const interestFlows: DatedAmount[] = [];
      for (const r of interestRows) {
        interestFlows.push({ date: r.businessDate, amount: await moneyOf(r.amount) });
      }
      const interestTotal = sumByCurrency(interestFlows.map((f) => f.amount)).filter((m) => !m.isZero());
      const loanRows = await deps.loans.interestPaid({ workspaceId, from, to });
      const loanSources: InterestSource[] = [];
      for (const r of loanRows) {
        loanSources.push({
          id: r.loanId,
          name: loanById.get(r.loanId)?.name ?? r.loanId,
          amount: await moneyOf(r.amount),
        });
      }
      const cardSources: InterestSource[] = [];
      if (cardAccounts.length > 0) {
        const movementRows = await deps.movements.summarizeAccountMovements({
          workspaceId,
          accountIds: cardAccounts.map((c) => c.accountId),
          dateFrom: from,
          dateTo: to,
          groupBy: 'DAY',
        });
        for (const r of movementRows) {
          if (r.movementClass !== 'PURCHASE' || r.systemCategoryCode !== 'INTEREST') continue;
          const card = cardAccountById.get(r.accountId);
          if (!card) continue;
          cardSources.push({ id: card.cardId, name: card.cardName, amount: await moneyOf(r.amount) });
        }
      }
      const attribution = InterestAttribution.attribute({
        total: interestTotal,
        loans: loanSources,
        cards: cardSources,
      });

      // ---- una sola resolución de tasas: total a la tasa de hoy (stock) e interés a la de cada fecha (INV-012)
      const owedFlows: DatedAmount[] = grouping.totalsByCurrency
        .filter((m) => m.isPositive())
        .map((m) => ({ date: today.toString(), amount: m }));
      const rates = await FlowValuation.resolveRates<ResolvedRateDto>({
        flows: [...owedFlows, ...interestFlows],
        target: base,
        timeZone: settings.timeZone,
        now,
        windowDays: deps.rateValidityWindowDays,
        resolve: (r) => deps.rates.resolveValuationRates({ workspaceId, ...r }),
        keyOf: rateKey,
      });
      const collector = rates.collector();
      const consolidate = (rows: readonly DatedAmount[]): DebtSummaryConsolidatedDto => {
        const c: Consolidated = FlowValuation.consolidate(rows, base, collector.rateFor);
        return {
          amount: present(c.total, base).toJSON(),
          complete: c.complete,
          unconverted: c.unconverted.map((m) => m.toJSON()),
        };
      };
      const owed = consolidate(owedFlows);
      const interest = consolidate(interestFlows);
      const estimateOf = new Map(payoff.perDebt.map((p) => [`${p.kind}|${p.id}`, p] as const));

      return {
        status: grouping.status,
        asOf: today.toString(),
        baseCurrency: base.code,
        debts: grouping.debts.map((d) => {
          const est = estimateOf.get(`${d.kind}|${d.id}`);
          return {
            kind: d.kind,
            id: d.id,
            name: d.name,
            balances: d.balances.map((b) => ({
              accountId: b.accountId,
              accountName: b.name,
              outstanding: b.outstanding.toJSON(),
              includedInNetWorth: b.includedInNetWorth,
            })),
            estimatedPayoffDate: est?.estimatedPayoffDate ?? null,
            payoffEstimable: est?.payoffEstimable ?? false,
          };
        }),
        totals: { byCurrency: grouping.totalsByCurrency.map((m) => m.toJSON()), consolidated: owed },
        creditBalances: grouping.creditBalances.map((c) => ({
          accountId: c.accountId,
          name: c.name,
          amount: c.amount.toJSON(),
        })),
        interestYtd: {
          from,
          to,
          byCurrency: interestTotal.map((m) => m.toJSON()),
          consolidated: interest,
          attribution: attribution.entries.map((e) => ({
            kind: e.kind,
            id: e.id,
            name: e.name,
            byCurrency: e.byCurrency.map((m) => m.toJSON()),
          })),
          attributionConsistent: attribution.consistent,
        },
        debtFree: { date: payoff.date, excluded: payoff.excluded },
        upcomingDues: dues.map((d) => ({
          kind: d.kind,
          id: d.id,
          name: d.name,
          accountId: d.accountId,
          dueDate: d.dueDate,
          amount: d.amount.toJSON(),
          minimum: d.minimum ? d.minimum.toJSON() : null,
          estimated: d.estimated,
          overdueDays: d.overdueDays,
        })),
        meta: { ratesUsed: collector.used(), rateWindowDays: deps.rateValidityWindowDays },
      };
    });
  }
}
