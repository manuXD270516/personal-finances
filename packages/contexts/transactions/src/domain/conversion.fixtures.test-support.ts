import { currency, Money, Rate, type Currency } from '@pf/shared-kernel';
import {
  displayOrientation,
  type ConversionFeeType,
  type CurrencyKindLike,
  type ReferenceRateInfo,
} from './conversion.js';
import { toJournalEntryDraft } from './posting-translator.js';
import { Transaction, type ConversionAccount, type ConversionFeeSpec } from './transaction.js';

export const CCY = {
  BOB: currency('BOB', 2),
  USD: currency('USD', 2),
  EUR: currency('EUR', 2),
  USDT: currency('USDT', 6),
  USDC: currency('USDC', 6),
  TRX: currency('TRX', 6),
  BTC: currency('BTC', 8),
  ETH: currency('ETH', 18),
} as const;
export const KIND: Record<string, CurrencyKindLike> = {
  BOB: 'FIAT',
  USD: 'FIAT',
  EUR: 'FIAT',
  USDT: 'CRYPTO',
  USDC: 'CRYPTO',
  TRX: 'CRYPTO',
  BTC: 'CRYPTO',
  ETH: 'CRYPTO',
};
const cur = (code: string): Currency => {
  const c = (CCY as Record<string, Currency | undefined>)[code];
  if (!c) throw new Error(`unknown currency ${code}`);
  return c;
};
export const info = (code: string) => ({ currency: cur(code), kind: KIND[code] ?? 'FIAT' });
export const m = (amount: string, code: string): Money => Money.parse(amount, cur(code));
export const rate = (base: string, quote: string, value: string): Rate =>
  Rate.of(cur(base), cur(quote), value);
export const acct = (
  accountId: string,
  code: string,
  nature: 'ASSET' | 'LIABILITY' = 'ASSET',
): ConversionAccount => ({
  accountId,
  nature,
  currency: code,
});

export const WS = '0192f3c4-0000-7000-8000-000000000001';
export const WALLET_USDT = 'wallet-usdt';
export const BANK_BOB = 'bank-bob';
export const CASH_BOB = 'cash-bob';
export const CASH_USD = 'cash-usd';
export const WALLET_BTC = 'wallet-btc';
export const WALLET_TRX = 'wallet-trx';
export const FEES = 'cat-fees';

export const R2: ReferenceRateInfo = {
  fxRateId: 'R2',
  rate: rate('USDT', 'BOB', '6.95'),
  rateType: 'P2P',
  source: 'MANUAL',
  asOf: '2026-09-29T19:00:00.000Z',
};

let seq = 0;
export const nextId = (): string => `0192f3c4-0000-7000-8000-${(++seq).toString(16).padStart(12, '0')}`;

export interface FeeArg {
  readonly type: ConversionFeeType;
  readonly amount: Money;
  readonly paidFrom?: ConversionAccount | null;
}

export interface ConvertArgs {
  readonly from: ConversionAccount;
  readonly to: ConversionAccount;
  readonly source: Money;
  readonly target: Money;
  readonly fees?: readonly FeeArg[];
  readonly quoted?: Rate | null;
  readonly reference?: ReferenceRateInfo | null;
  readonly status?: 'PENDING' | 'POSTED' | 'CLEARED';
}

export const feeSpecs = (fees: readonly FeeArg[]): ConversionFeeSpec[] =>
  fees.map((f) => ({
    type: f.type,
    amount: f.amount,
    paidFrom: f.paidFrom ?? null,
    categoryId: FEES,
    splitId: nextId(),
  }));

export function conversionData(a: ConvertArgs) {
  return {
    businessDate: '2026-09-30',
    sourceAccount: a.from,
    targetAccount: a.to,
    sourceAmount: a.source,
    targetAmount: a.target,
    fees: feeSpecs(a.fees ?? []),
    quotedRate: a.quoted ?? null,
    referenceRate: a.reference ?? null,
    display: displayOrientation(info(a.from.currency), info(a.to.currency)),
    provider: { counterpartyId: null, name: 'Binance P2P' },
    executedAt: '2026-09-30T18:42:00Z',
    externalRef: null,
  };
}

export function convert(a: ConvertArgs): Transaction {
  return Transaction.recordConversion({
    id: nextId(),
    workspaceId: WS,
    ...(a.status ? { status: a.status } : {}),
    ...conversionData(a),
  });
}

/** Canónico (ARCHITECTURE §4.2): −100.000000 USDT, 685.00 BOB netos, fee PROVIDER 5.00 BOB, cotizada 6.90, ref. 6.95. */
export const canonical = (over: Partial<ConvertArgs> = {}): Transaction =>
  convert({
    from: acct(WALLET_USDT, 'USDT'),
    to: acct(BANK_BOB, 'BOB'),
    source: m('100.000000', 'USDT'),
    target: m('685.00', 'BOB'),
    fees: [{ type: 'PROVIDER', amount: m('5.00', 'BOB') }],
    quoted: rate('USDT', 'BOB', '6.90'),
    reference: R2,
    ...over,
  });

/** Postings legibles: `[clave, monto]` con `FX_TRADING:<CCY>` / `EXPENSE:<CCY>` para cuentas de sistema. */
export function postingsOf(tx: Transaction): [string, string][] {
  return toJournalEntryDraft(tx.snapshot).postings.map((p) => [
    p.target.kind === 'USER_ACCOUNT'
      ? p.target.accountId
      : `${p.target.systemKind}:${p.amount.currency.code}`,
    `${p.amount.toFixed()} ${p.amount.currency.code}`,
  ]);
}

/** Σ postings por moneda (INV-004). */
export function sumsByCurrency(tx: Transaction): Record<string, string> {
  const sums = new Map<string, Money>();
  for (const p of toJournalEntryDraft(tx.snapshot).postings) {
    const code = p.amount.currency.code;
    sums.set(code, (sums.get(code) ?? Money.zero(p.amount.currency)).add(p.amount));
  }
  return Object.fromEntries([...sums].map(([k, v]) => [k, v.toFixed()]));
}
