import { Money } from '@pf/shared-kernel';
import type {
  CreditBalance,
  DebtBalance,
  DebtGrouping,
  DebtItem,
  DebtKind,
  DebtLink,
  LiabilityAccount,
} from './debt-summary-types.js';

const KIND_RANK: Record<DebtKind, number> = { LOAN: 0, CREDIT_CARD: 1, OTHER_LIABILITY: 2 };
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `DebtSummaryCalculator` (design decisión 1 y 2): agrupa las cuentas de pasivo en préstamos, tarjetas (una tarjeta
 * bimoneda es UNA deuda con un saldo por moneda) y otros pasivos; totaliza lo adeudado por moneda sin mezclar monedas y
 * separa el saldo a favor, que NO resta del total. Las cuentas con saldo cero no se listan.
 */
export const DebtSummaryCalculator = {
  group(input: {
    readonly accounts: readonly LiabilityAccount[];
    readonly loans: readonly DebtLink[];
    readonly cards: readonly DebtLink[];
  }): DebtGrouping {
    if (input.accounts.length === 0) {
      return { status: 'NO_LIABILITIES', debts: [], creditBalances: [], totalsByCurrency: [] };
    }
    const loanByAccount = new Map(input.loans.map((l) => [l.accountId, l] as const));
    const cardByAccount = new Map(input.cards.map((c) => [c.accountId, c] as const));
    const groups = new Map<string, { kind: DebtKind; id: string; name: string; balances: DebtBalance[] }>();
    const credits: CreditBalance[] = [];
    const totals = new Map<string, Money>();

    for (const account of input.accounts) {
      if (account.balance.isZero()) continue;
      const code = account.currency.code;
      const previous = totals.get(code) ?? Money.zero(account.currency);
      if (account.balance.isNegative()) {
        credits.push({ accountId: account.accountId, name: account.name, amount: account.balance.negate() });
        totals.set(code, previous);
        continue;
      }
      totals.set(code, previous.add(account.balance));
      const loan = loanByAccount.get(account.accountId);
      const card = loan ? undefined : cardByAccount.get(account.accountId);
      const [kind, id, name]: [DebtKind, string, string] = loan
        ? ['LOAN', loan.id, loan.name]
        : card
          ? ['CREDIT_CARD', card.id, card.name]
          : ['OTHER_LIABILITY', account.accountId, account.name];
      const key = `${kind}|${id}`;
      const group = groups.get(key) ?? { kind, id, name, balances: [] };
      group.balances.push({
        accountId: account.accountId,
        name: account.name,
        outstanding: account.balance,
        includedInNetWorth: account.includedInNetWorth,
      });
      groups.set(key, group);
    }

    const debts: DebtItem[] = [...groups.values()]
      .map((g) => ({
        ...g,
        balances: [...g.balances].sort(
          (a, b) =>
            byText(a.outstanding.currency.code, b.outstanding.currency.code) ||
            byText(a.accountId, b.accountId),
        ),
      }))
      .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || byText(a.name, b.name) || byText(a.id, b.id));
    credits.sort((a, b) => byText(a.name, b.name) || byText(a.accountId, b.accountId));

    if (debts.length === 0) {
      return { status: 'NO_DEBT', debts: [], creditBalances: credits, totalsByCurrency: [] };
    }
    return {
      status: 'ACTIVE',
      debts,
      creditBalances: credits,
      totalsByCurrency: [...totals.values()].sort((a, b) => byText(a.currency.code, b.currency.code)),
    };
  },
};
