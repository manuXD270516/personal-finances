import type { CategoryTreeDto } from '@pf/classification/contracts';
import type {
  AccountBalanceDto,
  AccountSetFlowRowDto,
  AccountSetMovementDto,
  FlowCounterpartClassDto,
} from '@pf/ledger/contracts';
import { currency as makeCurrency, dec, Money, type Decimal } from '@pf/shared-kernel';
import type { NominalFlowRowDto, NominalPortionDto } from '@pf/transactions/contracts';
import type { BudgetVsActualRow, FinancialReportsDeps } from '../ports/financial-reports.js';
import { ConversionCostQueries } from '../conversion-cost.queries.js';
import type { ExtendedReportDeps, SavedViewRecord, SavedViewRepository } from '../ports/extended-reports.js';
import { InMemoryReporting } from './in-memory.js';

export interface LedgerLeg {
  /** Id de una cuenta del usuario o `SYSTEM:<INCOME|EXPENSE|FX_TRADING|OPENING_BALANCE|ADJUSTMENTS>`. */
  readonly account: string;
  readonly currency: string;
  readonly amount: string;
}

export interface LedgerEntry {
  readonly id: string;
  readonly date: string;
  readonly transactionId: string | null;
  readonly legs: readonly LedgerLeg[];
}

export interface PortionFact extends NominalPortionDto {
  readonly tagIds: readonly string[];
  /** Tipo de la transacción y rol de la porción (por omisión `EXPENSE`/`NOMINAL`). */
  readonly origin?: { readonly transactionKind: string; readonly portionRole: 'NOMINAL' | 'FEE' };
}

/** Datos que sirven los puertos de los reportes ampliados (cada contexto dueño los calcula en producción). */
export interface ExtendedFakes {
  goals: Awaited<ReturnType<ExtendedReportDeps['goals']['monthly']>>;
  loans: Awaited<ReturnType<ExtendedReportDeps['portfolio']['listLoans']>>;
  cards: Awaited<ReturnType<ExtendedReportDeps['portfolio']['listCards']>>;
  debtPayments: Awaited<ReturnType<ExtendedReportDeps['debtHistory']['monthly']>>;
  recurringCosts: Awaited<ReturnType<ExtendedReportDeps['recurring']['listCosts']>>;
  subscriptionEvents: Awaited<ReturnType<ExtendedReportDeps['subscriptions']['listEvents']>>;
}

/**
 * Doble en memoria de los contratos de los reportes financieros (add-financial-reports): un MINI LEDGER de asientos con
 * patas (de donde salen los saldos y el flujo por contrapartida con el MISMO algoritmo que el SQL de LEDGER) y una lista
 * de porciones nominales (de donde salen los flujos y el drill-down con el mismo predicado). Sirve a los tests de
 * aplicación y de reconciliación.
 */
export class InMemoryFinancialReports extends InMemoryReporting {
  readonly entries: LedgerEntry[] = [];
  readonly portions: PortionFact[] = [];
  tree: CategoryTreeDto = { groups: [], categories: [], tags: [] };
  readonly budgetByPeriod = new Map<string, BudgetVsActualRow>();
  readonly reconciledDates = new Map<string, string[]>();
  firstEntryDate: string | null = null;
  readonly fakes: ExtendedFakes = {
    goals: [],
    loans: [],
    cards: [],
    debtPayments: [],
    recurringCosts: [],
    subscriptionEvents: [],
  };
  readonly savedViewRows: SavedViewRecord[] = [];
  /** Cuántas veces se pidió cada puerto de los reportes ampliados (secuencialidad, una resolución por petición). */
  readonly extendedCalls: string[] = [];
  auditLog: { reportId: string; filters: string; rowCount: number }[] = [];
  readonly budgetCalls: string[] = [];
  readonly durations: { name: string; value: number; report: string | undefined }[] = [];

  entry(id: string, date: string, legs: readonly LedgerLeg[], transactionId: string | null = id): void {
    this.entries.push({ id, date, transactionId, legs });
  }

  private scale(code: string): number {
    return this.currencies.find((c) => c.code === code)?.scale ?? 2;
  }

  private money(amount: Decimal, code: string): { amount: string; currency: string } {
    return Money.roundToScale(amount, makeCurrency(code, this.scale(code))).toJSON();
  }

  private classOf(account: string): FlowCounterpartClassDto {
    if (account.startsWith('SYSTEM:')) return account.slice(7) as FlowCounterpartClassDto;
    return this.accounts.find((a) => a.accountId === account)?.nature === 'LIABILITY'
      ? 'OUTSIDE_LIABILITY'
      : 'OUTSIDE_ASSET';
  }

  /** Saldo contable (Σ patas) de cada cuenta del usuario y moneda hasta `asOf` inclusive. */
  balancesAt(asOf: string, accountIds: readonly string[] | undefined): AccountBalanceDto[] {
    const sums = new Map<string, Decimal>();
    for (const e of this.entries) {
      if (e.date > asOf) continue;
      for (const l of e.legs) {
        if (l.account.startsWith('SYSTEM:')) continue;
        if (accountIds && !accountIds.includes(l.account)) continue;
        const key = `${l.account}|${l.currency}`;
        sums.set(key, (sums.get(key) ?? dec('0')).plus(l.amount));
      }
    }
    return [...sums.entries()].map(([key, v]) => {
      const [account, code] = key.split('|') as [string, string];
      const m = this.money(v, code);
      const nature = this.accounts.find((a) => a.accountId === account)?.nature ?? 'ASSET';
      return {
        ledgerAccountId: `la-${account}`,
        code: `USER:${account}`,
        nature,
        accountId: account,
        balance: m,
        // Saldo presentado: un pasivo se presenta positivo (lo que se debe), con el signo opuesto al contable.
        presented: nature === 'LIABILITY' ? this.money(v.times(-1), code) : m,
      };
    });
  }

  /** Mismo algoritmo que `PgAccountSetFlowQuery`: −Σ de las patas de fuera del conjunto por (asiento, moneda, clase). */
  private movements(accountIds: readonly string[], from: string, to: string) {
    const out: (AccountSetMovementDto & { amountD: Decimal })[] = [];
    for (const e of this.entries) {
      if (e.date < from || e.date > to) continue;
      const currencies = new Set(e.legs.filter((l) => accountIds.includes(l.account)).map((l) => l.currency));
      for (const c of currencies) {
        const inSet = e.legs.filter((l) => l.currency === c && accountIds.includes(l.account));
        const byClass = new Map<FlowCounterpartClassDto, Decimal>();
        for (const l of e.legs.filter((x) => x.currency === c && !accountIds.includes(x.account))) {
          const cls = this.classOf(l.account);
          byClass.set(cls, (byClass.get(cls) ?? dec('0')).minus(l.amount));
        }
        for (const [counterpart, amountD] of byClass) {
          if (amountD.isZero()) continue;
          out.push({
            journalEntryId: e.id,
            transactionId: e.transactionId,
            businessDate: e.date,
            accountIds: [...new Set(inSet.map((l) => l.account))],
            currency: c,
            counterpart,
            amount: this.money(amountD, c).amount,
            amountD,
          });
        }
      }
    }
    return out;
  }

  private matches(
    p: PortionFact,
    f: {
      categoryIds?: readonly string[] | undefined;
      accountIds?: readonly string[] | undefined;
      counterpartyIds?: readonly string[] | undefined;
      tagIds?: readonly string[] | undefined;
      tagMatch?: 'ANY' | 'ALL' | undefined;
      currencies?: readonly string[] | undefined;
      nature?: 'INCOME' | 'EXPENSE' | undefined;
    },
  ): boolean {
    return (
      (f.categoryIds === undefined || f.categoryIds.includes(p.categoryId)) &&
      (f.accountIds === undefined || f.accountIds.includes(p.accountId)) &&
      (f.counterpartyIds === undefined ||
        (p.counterpartyId !== null && f.counterpartyIds.includes(p.counterpartyId))) &&
      (f.tagIds === undefined ||
        (f.tagMatch === 'ALL'
          ? f.tagIds.every((t) => p.tagIds.includes(t))
          : p.tagIds.some((t) => f.tagIds?.includes(t)))) &&
      (f.currencies === undefined || f.currencies.includes(p.amount.currency)) &&
      (f.nature === undefined || p.nature === f.nature)
    );
  }

  /** Balance de comprobación (`BalanceQuery.getTrialBalance`): saldos contables de todas las cuentas hasta `asOf`. */
  async getTrialBalance(input: { readonly workspaceId: string; readonly asOf?: string }) {
    const sums = new Map<string, { account: string; code: string; currency: string; v: Decimal }>();
    for (const e of this.entries) {
      if (input.asOf !== undefined && e.date > input.asOf) continue;
      for (const l of e.legs) {
        const code = l.account.startsWith('SYSTEM:')
          ? `${l.account.slice(7)}:${l.currency}`
          : `ASSET:${l.account}`;
        const key = `${code}|${l.currency}`;
        const prev = sums.get(key);
        sums.set(key, {
          account: l.account,
          code,
          currency: l.currency,
          v: (prev?.v ?? dec('0')).plus(l.amount),
        });
      }
    }
    const byCurrency = new Map<
      string,
      { code: string; accountId: string | null; balance: { amount: string; currency: string } }[]
    >();
    for (const x of sums.values()) {
      const lines = byCurrency.get(x.currency) ?? [];
      lines.push({
        code: x.code,
        accountId: x.account.startsWith('SYSTEM:') ? null : x.account,
        balance: this.money(x.v, x.currency),
      });
      byCurrency.set(x.currency, lines);
    }
    return { currencies: [...byCurrency.entries()].map(([currency, lines]) => ({ currency, lines })) };
  }

  /** Repositorio en memoria de vistas guardadas con las mismas reglas de visibilidad que la RLS (workspace y usuario). */
  savedViewRepository(): SavedViewRepository {
    const own = (r: SavedViewRecord, i: { workspaceId: string; userId: string }) =>
      r.workspaceId === i.workspaceId && r.userId === i.userId;
    return {
      list: async (i) =>
        this.savedViewRows
          .filter((r) => own(r, i) && (i.reportId === undefined || r.reportId === i.reportId))
          .sort((a, b) => a.name.localeCompare(b.name, 'es')),
      find: async (i) => this.savedViewRows.find((r) => own(r, i) && r.id === i.id) ?? null,
      lockAndCount: async (i) => this.savedViewRows.filter((r) => own(r, i)).length,
      nameTaken: async (i) =>
        this.savedViewRows.some(
          (r) =>
            own(r, i) &&
            r.reportId === i.reportId &&
            r.id !== i.exceptId &&
            r.name.toLowerCase() === i.name.toLowerCase(),
        ),
      insert: async (r) => void this.savedViewRows.push(r),
      update: async (i) => {
        const idx = this.savedViewRows.findIndex(
          (r) => own(r, i) && r.id === i.id && r.version === i.expectedVersion,
        );
        if (idx < 0) return false;
        const prev = this.savedViewRows[idx]!;
        this.savedViewRows[idx] = {
          ...prev,
          name: i.name,
          params: i.params,
          version: prev.version + 1,
          updatedAt: i.updatedAt,
        };
        return true;
      },
      delete: async (i) => {
        const idx = this.savedViewRows.findIndex((r) => own(r, i) && r.id === i.id);
        if (idx < 0) return false;
        this.savedViewRows.splice(idx, 1);
        return true;
      },
    };
  }

  extendedDeps(): ExtendedReportDeps {
    const record = <T>(name: string, value: T): T => {
      this.extendedCalls.push(name);
      return value;
    };
    return {
      goals: {
        monthly: async ({ goalIds }) =>
          record(
            'goals',
            this.fakes.goals.filter((g) => goalIds === undefined || goalIds.includes(g.goalId)),
          ),
      },
      debtHistory: { monthly: async () => record('debtHistory', this.fakes.debtPayments) },
      portfolio: {
        listLoans: async () => record('loans', this.fakes.loans),
        listCards: async () => record('cards', this.fakes.cards),
      },
      recurring: { listCosts: async () => record('recurring', this.fakes.recurringCosts) },
      subscriptions: {
        listEvents: async ({ to }) =>
          record(
            'subscriptions',
            this.fakes.subscriptionEvents.filter((e) => e.date <= to),
          ),
      },
      conversions: {
        listForCostAnalysis: async ({ from, to, includeVoided }) =>
          this.conversionRows.filter(
            (r) => r.businessDate >= from && r.businessDate <= to && (includeVoided === true || !r.voided),
          ),
      },
      conversionCosts: new ConversionCostQueries(this.conversionCostDeps()),
      savedViews: this.savedViewRepository(),
    };
  }

  financialDeps(): FinancialReportsDeps {
    const base = this.deps();
    return {
      uow: base.uow,
      workspaces: base.workspaces,
      accounts: {
        listAccounts: async ({ includeArchived }) =>
          this.accounts.filter((a) => includeArchived === true || a.status !== ('ARCHIVED' as string)),
      },
      categories: { categoryTree: async () => this.tree },
      rates: base.rates,
      versions: base.versions,
      clock: base.clock,
      flows: {
        summarizeNominalFlows: async (input) => {
          const groups = new Map<string, NominalFlowRowDto>();
          const groupBy = input.groupBy ?? [];
          for (const p of this.portions) {
            if (p.businessDate < input.dateFrom || p.businessDate > input.dateTo) continue;
            if (!this.matches(p, input)) continue;
            const tags = input.withTags ? [...p.tagIds].sort() : null;
            const origin = p.origin ?? {
              transactionKind: p.nature === 'INCOME' ? 'INCOME' : 'EXPENSE',
              portionRole: 'NOMINAL' as const,
            };
            const key = [
              p.businessDate,
              p.nature,
              p.categoryId,
              p.amount.currency,
              tags?.join(',') ?? '',
              groupBy.includes('ACCOUNT') ? p.accountId : '',
              groupBy.includes('ORIGIN') ? `${origin.transactionKind}:${origin.portionRole}` : '',
            ].join('|');
            const prev = groups.get(key);
            groups.set(key, {
              businessDate: p.businessDate,
              nature: p.nature,
              categoryId: p.categoryId,
              amount: this.money(dec(prev?.amount.amount ?? '0').plus(p.amount.amount), p.amount.currency),
              ...(tags ? { tagIds: tags } : {}),
              ...(groupBy.includes('ACCOUNT') ? { accountId: p.accountId } : {}),
              ...(groupBy.includes('ORIGIN') ? { origin } : {}),
            });
          }
          return [...groups.values()];
        },
      },
      portions: {
        listPortions: async (input) => {
          const cell = this.portions
            .filter(
              (p) =>
                p.businessDate >= input.dateFrom && p.businessDate <= input.dateTo && this.matches(p, input),
            )
            .sort(
              (a, b) => b.businessDate.localeCompare(a.businessDate) || b.splitId.localeCompare(a.splitId),
            );
          const start = input.cursor ? Number(input.cursor) : 0;
          const rows = cell.slice(start, start + input.limit);
          const totals = new Map<string, Decimal>();
          for (const p of cell) {
            totals.set(p.amount.currency, (totals.get(p.amount.currency) ?? dec('0')).plus(p.amount.amount));
          }
          return {
            rows: rows.map(({ tagIds: _t, ...r }) => r),
            nextCursor: start + input.limit < cell.length ? String(start + input.limit) : null,
            count: cell.length,
            totals: [...totals.entries()].map(([code, v]) => this.money(v, code)),
          };
        },
      },
      accountFlows: {
        summarize: async ({ accountIds, dateFrom, dateTo }) => {
          const rows = new Map<
            string,
            { date: string; currency: string; counterpart: FlowCounterpartClassDto; v: Decimal }
          >();
          for (const m of this.movements(accountIds, dateFrom, dateTo)) {
            const key = `${m.businessDate}|${m.currency}|${m.counterpart}`;
            const prev = rows.get(key);
            rows.set(key, {
              date: m.businessDate,
              currency: m.currency,
              counterpart: m.counterpart,
              v: (prev?.v ?? dec('0')).plus(m.amountD),
            });
          }
          return [...rows.values()]
            .filter((r) => !r.v.isZero())
            .map((r): AccountSetFlowRowDto => ({
              businessDate: r.date,
              currency: r.currency,
              counterpart: r.counterpart,
              amount: this.money(r.v, r.currency).amount,
            }));
        },
        listMovements: async (input) => {
          const all = this.movements(input.accountIds, input.dateFrom, input.dateTo)
            .filter(
              (m) =>
                (input.counterparts === undefined || input.counterparts.includes(m.counterpart)) &&
                (input.currency === undefined || m.currency === input.currency),
            )
            .sort(
              (a, b) =>
                b.businessDate.localeCompare(a.businessDate) ||
                b.journalEntryId.localeCompare(a.journalEntryId),
            );
          const start = input.cursor ? Number(input.cursor) : 0;
          const totals = new Map<string, Decimal>();
          for (const m of all) totals.set(m.currency, (totals.get(m.currency) ?? dec('0')).plus(m.amountD));
          return {
            rows: all.slice(start, start + input.limit).map(({ amountD: _a, ...r }) => r),
            nextCursor: start + input.limit < all.length ? String(start + input.limit) : null,
            count: all.length,
            totals: [...totals.entries()].map(([code, v]) => this.money(v, code)),
          };
        },
      },
      balanceHistory: {
        getAccountBalancesAtDates: async ({ accountIds, dates }) => ({
          latestEntryAt: this.latestEntryAt,
          byDate: dates.map((asOf) => ({ asOf, balances: this.balancesAt(asOf, accountIds) })),
        }),
      },
      periods: { listPeriods: async () => [...this.periods] },
      ...(this.fiscalMonthStartDay === null
        ? {}
        : {
            calendar: {
              calendarOf: async () => ({
                timeZone: this.settings.timeZone,
                fiscalMonthStartDay: this.fiscalMonthStartDay as number,
              }),
            },
          }),
      activity: {
        getActivityRange: async () =>
          this.firstEntryDate
            ? { minEntryDate: this.firstEntryDate, maxEntryDate: this.firstEntryDate }
            : null,
      },
      budgets: {
        getForPeriod: async ({ periodId }) => {
          this.budgetCalls.push(periodId);
          return this.budgetByPeriod.get(periodId) ?? null;
        },
      },
      marks: {
        closedStatementDates: async ({ accountId, from, to }) =>
          (this.reconciledDates.get(accountId) ?? []).filter((d) => d >= from && d <= to),
      },
      audit: {
        exported: async (input) => {
          this.auditLog.push({ reportId: input.reportId, filters: input.filters, rowCount: input.rowCount });
        },
      },
      metrics: {
        observe: (name, value, attributes) =>
          void this.durations.push({ name, value, report: attributes?.report }),
      },
      extended: this.extendedDeps(),
      ...(this.rateValidityWindowDays === undefined
        ? {}
        : { rateValidityWindowDays: this.rateValidityWindowDays }),
    };
  }
}
