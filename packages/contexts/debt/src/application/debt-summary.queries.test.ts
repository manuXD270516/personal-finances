import type { AccountSummaryDto } from '@pf/accounts/contracts';
import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type {
  CardPortfolioAccountDto,
  DebtSummaryDto,
  LoanPortfolioItemDto,
  MoneyDto,
} from '../contracts/index.js';
import { DebtSummaryQueries, type DebtSummaryDeps } from './debt-summary.queries.js';

const WS = 'ws-a';
const m = (amount: string, currency = 'BOB'): MoneyDto => ({ amount, currency });

interface World {
  accounts: AccountSummaryDto[];
  balances: Record<string, MoneyDto>;
  loans: LoanPortfolioItemDto[];
  cards: CardPortfolioAccountDto[];
  loanInterest: { loanId: string; amount: MoneyDto }[];
  flows: { businessDate: string; categoryId: string; amount: MoneyDto }[];
  movements: {
    accountId: string;
    businessDate: string;
    movementClass: string;
    systemCategoryCode: string | null;
    amount: MoneyDto;
  }[];
  withUsdRate: boolean;
  now: string;
  /** Datos de otros workspaces: no deben aparecer. */
  other: { accounts: AccountSummaryDto[]; balances: Record<string, MoneyDto> };
}

const acct = (
  accountId: string,
  name: string,
  type: AccountSummaryDto['type'],
  nature: AccountSummaryDto['nature'],
  currency = 'BOB',
  includeInNetWorth = true,
): AccountSummaryDto => ({
  accountId,
  name,
  type,
  nature,
  currency,
  status: 'ACTIVE',
  liquidity: 'ILLIQUID',
  includeInNetWorth,
  displayOrder: 0,
});

const loan = (over: Partial<LoanPortfolioItemDto> = {}): LoanPortfolioItemDto => ({
  loanId: 'loan-1',
  name: 'Préstamo auto',
  accountId: 'a-loan',
  currency: 'BOB',
  status: 'ACTIVE',
  method: 'FRENCH',
  rateType: 'FIXED',
  annualRate: '0.115',
  outstandingPrincipal: m('45000.00'),
  accountBalance: m('45000.00'),
  unreconciledDifference: m('0.00'),
  installmentAmount: m('1850.00'),
  nextInstallment: { n: 13, dueDate: '2026-11-05', outstanding: m('1850.00'), overdueDays: 0 },
  lastUnpaidInstallmentDueDate: '2029-06-05',
  ...over,
});

const card = (
  accountId: string,
  currency: string,
  balance: string,
  minimum: string,
  over: Partial<CardPortfolioAccountDto> = {},
): CardPortfolioAccountDto => ({
  cardId: 'card-1',
  cardName: 'Visa Oro',
  cardAccountId: `ca-${accountId}`,
  accountId,
  currency,
  balance: m(balance, currency),
  lastStatement: {
    statementId: `st-${accountId}`,
    closingDate: '2026-10-25',
    dueDate: '2026-11-15',
    remainingNoInterest: m(balance, currency),
    remainingMinimum: m(minimum, currency),
    status: 'ISSUED',
  },
  openCycle: {
    closingDate: '2026-11-25',
    dueDate: '2026-12-15',
    estimatedNoInterest: m('0.00', currency),
    hasOwnPurchases: false,
  },
  unbilledInstallments: m('0.00', currency),
  lastInstallmentDueDate: null,
  ...over,
});

function ownerWorld(): World {
  return {
    accounts: [
      acct('a-loan', 'Préstamo auto', 'LOAN', 'LIABILITY'),
      acct('a-bob', 'Visa Oro BOB', 'CREDIT_CARD', 'LIABILITY'),
      acct('a-usd', 'Visa Oro USD', 'CREDIT_CARD', 'LIABILITY', 'USD'),
      acct('a-fam', 'Deuda familiar', 'MANUAL_LIABILITY', 'LIABILITY'),
      acct('a-bank', 'Banco BOB', 'BANK', 'ASSET'),
    ],
    balances: {
      'a-loan': m('45000.00'),
      'a-bob': m('1120.50'),
      'a-usd': m('100.00', 'USD'),
      'a-fam': m('2000.00'),
      'a-bank': m('8000.00'),
    },
    loans: [loan()],
    cards: [card('a-bob', 'BOB', '1120.50', '56.02'), card('a-usd', 'USD', '100.00', '10.00')],
    loanInterest: [{ loanId: 'loan-1', amount: m('3250.40') }],
    flows: [
      { businessDate: '2026-03-05', categoryId: 'cat-int', amount: m('3250.40') },
      { businessDate: '2026-08-25', categoryId: 'cat-int', amount: m('12.00', 'USD') },
    ],
    movements: [
      {
        accountId: 'a-usd',
        businessDate: '2026-08-25',
        movementClass: 'PURCHASE',
        systemCategoryCode: 'INTEREST',
        amount: m('12.00', 'USD'),
      },
      {
        accountId: 'a-usd',
        businessDate: '2026-08-20',
        movementClass: 'PURCHASE',
        systemCategoryCode: null,
        amount: m('500.00', 'USD'),
      },
    ],
    withUsdRate: true,
    now: '2026-10-28T15:00:00.000Z',
    other: {
      accounts: [acct('b-loan', 'Préstamo B', 'LOAN', 'LIABILITY')],
      balances: { 'b-loan': m('9000.00') },
    },
  };
}

function build(world: World): { service: DebtSummaryQueries; calls: string[] } {
  const calls: string[] = [];
  const usdRate = (at: string): string => (at < '2026-10-01' ? '9.75' : '9.80');
  const resolved = (base: string, at: string): ValuationRateDto =>
    ({
      resolved: { rate: { base, quote: 'BOB', value: usdRate(at) }, asOf: at } as unknown as ResolvedRateDto,
      exact: { base, quote: 'BOB', value: usdRate(at) },
    }) satisfies ValuationRateDto;
  const deps: DebtSummaryDeps = {
    uow: { run: (_ws, fn) => fn() },
    loans: {
      listLoans: async (i) => {
        calls.push(`loans:${i.workspaceId}`);
        return i.workspaceId === WS ? world.loans : [];
      },
      interestPaid: async () => world.loanInterest,
    },
    cards: { listCards: async (i) => (i.workspaceId === WS ? world.cards : []) },
    accountCatalog: {
      listAccounts: async (i) => (i.workspaceId === WS ? world.accounts : world.other.accounts),
    },
    balances: {
      getAccountBalances: async (i) => {
        const source = i.workspaceId === WS ? world.balances : world.other.balances;
        return {
          asOf: null,
          latestEntryAt: null,
          balances: (i.accountIds ?? []).map((id) => ({
            ledgerAccountId: `l-${id}`,
            code: id,
            nature: 'LIABILITY',
            accountId: id,
            balance: source[id] ?? m('0.00'),
            presented: source[id] ?? m('0.00'),
          })),
        } as never;
      },
    },
    flows: {
      summarizeNominalFlows: async (i) =>
        world.flows
          .filter(
            (f) =>
              f.businessDate >= i.dateFrom &&
              f.businessDate <= i.dateTo &&
              (i.categoryIds ?? []).includes(f.categoryId),
          )
          .map((f) => ({ ...f, nature: 'EXPENSE' as const })),
    },
    movements: {
      summarizeAccountMovements: async (i) =>
        world.movements
          .filter((r) => i.accountIds.includes(r.accountId))
          .map((r) => ({ ...r, transactionId: null }) as never),
    },
    categories: {
      categoryTree: async () => ({
        groups: [],
        tags: [],
        categories: [
          {
            categoryId: 'cat-int',
            name: 'Intereses pagados',
            kind: 'EXPENSE',
            groupId: 'g',
            parentId: null,
            systemCode: 'INTEREST',
            archived: false,
          },
        ],
      }),
    },
    rates: {
      resolveValuationRates: async (i) =>
        i.requests.map((r) => (world.withUsdRate && r.base === 'USD' ? resolved(r.base, r.at) : null)),
    },
    workspaces: { settingsOf: async () => ({ baseCurrency: 'BOB', timeZone: 'America/La_Paz' }) },
    currencies: { scaleOf: async () => 2 },
    clock: new FixedClock(Instant.parse(world.now)),
    rateValidityWindowDays: 7,
  };
  return { service: new DebtSummaryQueries(deps), calls };
}

const run = (w: World): Promise<DebtSummaryDto> =>
  build(w).service.getDebtSummary({ workspaceId: WS, userId: 'u-1' });
const text = (ms: readonly MoneyDto[]) => ms.map((x) => `${x.amount} ${x.currency}`);

describe('GetDebtSummary (add-debt-summary)', () => {
  it('[TC-DEBT-SUMMARY-001] total 48120.50 BOB y 100.00 USD; consolidado 49100.50 BOB completo; agrupa por tipo de deuda', async () => {
    const s = await run(ownerWorld());
    expect(s.status).toBe('ACTIVE');
    expect(text(s.totals.byCurrency)).toEqual(['48120.50 BOB', '100.00 USD']);
    expect(s.totals.consolidated).toMatchObject({ amount: m('49100.50'), complete: true, unconverted: [] });
    expect(s.debts.map((d) => [d.kind, d.name, d.balances.length])).toEqual([
      ['LOAN', 'Préstamo auto', 1],
      ['CREDIT_CARD', 'Visa Oro', 2],
      ['OTHER_LIABILITY', 'Deuda familiar', 1],
    ]);
    expect(s.meta.ratesUsed).toHaveLength(2); // la de hoy (stock) y la del 2026-08-25 (flujo)
  });

  it('[TC-DEBT-SUMMARY-002] sin tasa USD/BOB: consolidado 48120.50 BOB incompleto con 100.00 USD sin convertir (nunca 1:1)', async () => {
    const w = ownerWorld();
    w.withUsdRate = false;
    const s = await run(w);
    expect(s.totals.consolidated.amount).toEqual(m('48120.50'));
    expect(s.totals.consolidated.complete).toBe(false);
    expect(text(s.totals.consolidated.unconverted)).toEqual(['100.00 USD']);
  });

  it('[TC-DEBT-SUMMARY-003] saldo a favor de 30.00 USD aparte; USD adeudado 0.00 y consolidado 48120.50 BOB', async () => {
    const w = ownerWorld();
    w.balances['a-usd'] = m('-30.00', 'USD');
    const s = await run(w);
    expect(text(s.totals.byCurrency)).toEqual(['48120.50 BOB', '0.00 USD']);
    expect(s.totals.consolidated.amount).toEqual(m('48120.50'));
    expect(s.creditBalances.map((c) => [c.name, c.amount.amount, c.amount.currency])).toEqual([
      ['Visa Oro USD', '30.00', 'USD'],
    ]);
  });

  it('[TC-DEBT-SUMMARY-003] el pago de la tarjeta se refleja de inmediato: BOB 47000.00 y Visa Oro BOB deja de listarse', async () => {
    const w = ownerWorld();
    w.balances['a-bob'] = m('0.00');
    const s = await run(w);
    expect(text(s.totals.byCurrency)).toEqual(['47000.00 BOB', '100.00 USD']);
    const visa = s.debts.find((d) => d.kind === 'CREDIT_CARD');
    expect(visa?.balances.map((b) => b.accountName)).toEqual(['Visa Oro USD']);
  });

  it('[TC-DEBT-SUMMARY-004] interés del año: 3250.40 BOB y 12.00 USD; consolidado 3367.40 BOB (12.00 × 9.75); atribución a préstamo y tarjeta', async () => {
    const s = await run(ownerWorld());
    expect(s.interestYtd.from).toBe('2026-01-01');
    expect(s.interestYtd.to).toBe('2026-10-28');
    expect(text(s.interestYtd.byCurrency)).toEqual(['3250.40 BOB', '12.00 USD']);
    expect(s.interestYtd.consolidated.amount).toEqual(m('3367.40'));
    expect(s.interestYtd.attribution.map((a) => [a.kind, a.name, text(a.byCurrency)])).toEqual([
      ['LOAN', 'Préstamo auto', ['3250.40 BOB']],
      ['CREDIT_CARD', 'Visa Oro', ['12.00 USD']],
      ['OTHER', null, []],
    ]);
    expect(s.interestYtd.attributionConsistent).toBe(true);
  });

  it('[TC-DEBT-SUMMARY-005] el interés de 2025 queda fuera y el de un sobregiro (25.00 BOB) va a otros intereses', async () => {
    const w = ownerWorld();
    w.flows.push(
      { businessDate: '2025-12-28', categoryId: 'cat-int', amount: m('300.00') },
      { businessDate: '2026-09-02', categoryId: 'cat-int', amount: m('25.00') },
    );
    const s = await run(w);
    expect(text(s.interestYtd.byCurrency)).toEqual(['3275.40 BOB', '12.00 USD']);
    expect(s.interestYtd.attribution.at(-1)).toMatchObject({ kind: 'OTHER', byCurrency: [m('25.00')] });
    expect(s.interestYtd.consolidated.amount).toEqual(m('3392.40'));
  });

  it('[TC-DEBT-SUMMARY-005] a las 23:30 del 31-12 en La Paz el año sigue siendo 2026', async () => {
    const w = ownerWorld();
    w.now = '2027-01-01T03:30:00.000Z';
    const s = await run(w);
    expect(s.asOf).toBe('2026-12-31');
    expect(s.interestYtd.from).toBe('2026-01-01');
    expect(s.interestYtd.to).toBe('2026-12-31');
  });

  it('[TC-DEBT-SUMMARY-006] fecha libre de deudas 2029-06-05 sin contar "Deuda familiar"; Visa Oro 2026-11-15', async () => {
    const s = await run(ownerWorld());
    expect(s.debtFree).toEqual({
      date: '2029-06-05',
      excluded: [{ kind: 'OTHER_LIABILITY', id: 'a-fam', name: 'Deuda familiar' }],
    });
    expect(s.debts.find((d) => d.kind === 'CREDIT_CARD')?.estimatedPayoffDate).toBe('2026-11-15');
    expect(s.debts.find((d) => d.kind === 'OTHER_LIABILITY')?.payoffEstimable).toBe(false);
  });

  it('[TC-DEBT-SUMMARY-006] tarjeta con la compra "Laptop" en 3 cuotas: Visa Oro se estima saldada el 2027-01-15', async () => {
    const w = ownerWorld();
    w.balances = { ...w.balances, 'a-bob': m('1000.00'), 'a-usd': m('0.00', 'USD') };
    w.cards = [
      card('a-bob', 'BOB', '1000.00', '0.00', {
        lastStatement: null,
        unbilledInstallments: m('1000.00'),
        lastInstallmentDueDate: '2027-01-15',
      }),
      card('a-usd', 'USD', '0.00', '0.00'),
    ];
    const s = await run(w);
    expect(s.debts.find((d) => d.kind === 'CREDIT_CARD')?.estimatedPayoffDate).toBe('2027-01-15');
  });

  it('[TC-DEBT-SUMMARY-007] próximos vencimientos: cuota 2026-11-05, Visa Oro BOB y USD con mínimo; sin la deuda familiar', async () => {
    const s = await run(ownerWorld());
    expect(
      s.upcomingDues.map((d) => [
        d.name,
        d.dueDate,
        text([d.amount])[0],
        d.minimum ? text([d.minimum])[0] : null,
      ]),
    ).toEqual([
      ['Préstamo auto', '2026-11-05', '1850.00 BOB', null],
      ['Visa Oro', '2026-11-15', '1120.50 BOB', '56.02 BOB'],
      ['Visa Oro', '2026-11-15', '100.00 USD', '10.00 USD'],
    ]);
  });

  it('[TC-DEBT-SUMMARY-007] cuota atrasada: Préstamo auto aparece primero, atrasado 2 días con 1850.00 BOB', async () => {
    const w = ownerWorld();
    w.now = '2026-11-07T15:00:00.000Z';
    w.loans = [
      loan({ nextInstallment: { n: 13, dueDate: '2026-11-05', outstanding: m('1850.00'), overdueDays: 2 } }),
    ];
    const s = await run(w);
    expect(s.upcomingDues[0]).toMatchObject({ name: 'Préstamo auto', overdueDays: 2, amount: m('1850.00') });
  });

  it('[TC-DEBT-SUMMARY-008] el resumen de A no incluye el préstamo de 9000.00 BOB del workspace B', async () => {
    const w = ownerWorld();
    const s = await run(w);
    expect(s.totals.consolidated.amount).toEqual(m('49100.50'));
    expect(JSON.stringify(s)).not.toContain('Préstamo B');
    const b = await build(w).service.getDebtSummary({ workspaceId: 'ws-b', userId: 'u-2' });
    expect(text(b.totals.byCurrency)).toEqual(['9000.00 BOB']);
    expect(b.debts.map((d) => [d.kind, d.name])).toEqual([['OTHER_LIABILITY', 'Préstamo B']]);
  });

  it('[TC-DEBT-SUMMARY-010] sin cuentas de pasivo: NO_LIABILITIES sin montos', async () => {
    const w = ownerWorld();
    w.accounts = [acct('a-bank', 'Banco BOB', 'BANK', 'ASSET')];
    const s = await run(w);
    expect(s.status).toBe('NO_LIABILITIES');
    expect(s.debts).toEqual([]);
    expect(s.totals.byCurrency).toEqual([]);
    expect(s.upcomingDues).toEqual([]);
  });

  it('[TC-DEBT-SUMMARY-010] pasivos saldados: NO_DEBT sin fecha ni próximo vencimiento', async () => {
    const w = ownerWorld();
    w.balances = {
      ...w.balances,
      'a-loan': m('0.00'),
      'a-bob': m('0.00'),
      'a-usd': m('0.00', 'USD'),
      'a-fam': m('0.00'),
    };
    const s = await run(w);
    expect(s.status).toBe('NO_DEBT');
    expect(s.debtFree.date).toBeNull();
    expect(s.upcomingDues).toEqual([]);
    expect(s.debts).toEqual([]);
  });

  it('[TC-DEBT-SUMMARY-001] degradación sin préstamos ni tarjetas implementados: las cuentas loan/credit_card son otros pasivos no estimables', async () => {
    const w = ownerWorld();
    w.loans = [];
    w.cards = [];
    w.movements = [];
    w.loanInterest = [];
    const s = await run(w);
    expect(s.totals.consolidated.amount).toEqual(m('49100.50'));
    expect(new Set(s.debts.map((d) => d.kind))).toEqual(new Set(['OTHER_LIABILITY']));
    expect(s.debtFree.date).toBeNull();
    expect(s.debtFree.excluded).toHaveLength(4);
    expect(s.upcomingDues).toEqual([]);
  });

  it('[TC-DEBT-SUMMARY-001] los pasivos excluidos del patrimonio se incluyen marcados', async () => {
    const w = ownerWorld();
    w.accounts = w.accounts.map((a) => (a.accountId === 'a-fam' ? { ...a, includeInNetWorth: false } : a));
    const s = await run(w);
    const fam = s.debts.find((d) => d.kind === 'OTHER_LIABILITY');
    expect(fam?.balances[0]?.includedInNetWorth).toBe(false);
    expect(s.totals.consolidated.amount).toEqual(m('49100.50'));
  });
});
