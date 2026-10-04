/**
 * Tipos del contrato `finance-api.v1.yaml` que usan las pantallas de cuentas, transacciones, transferencias,
 * conversiones, tasas y clasificación. Montos y tasas: `DecimalString` (INV-001), nunca `number`.
 */
import type { AuditLogEntry } from '../AuditHistory';
import type { AccountType, Money, RateAttribution, ResolvedRate } from '../dashboard/types';

export type { AccountType, Money } from '../dashboard/types';
export type { AuditLogEntry } from '../AuditHistory';

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'BANK',
  'CASH',
  'DIGITAL_WALLET',
  'SAVINGS',
  'CREDIT_CARD',
  'LOAN',
  'CRYPTO_WALLET',
  'INVESTMENT',
  'VIRTUAL',
  'MANUAL_ASSET',
  'MANUAL_LIABILITY',
];

export type AccountLiquidity = 'LIQUID' | 'SEMI_LIQUID' | 'ILLIQUID';
export type AccountStatus = 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
export const LIQUIDITIES: readonly AccountLiquidity[] = ['LIQUID', 'SEMI_LIQUID', 'ILLIQUID'];

export interface Page<T> {
  readonly data: readonly T[];
  readonly page: { readonly limit: number; readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly classification: 'ASSET' | 'LIABILITY';
  readonly status: AccountStatus;
  readonly liquidity: AccountLiquidity;
  readonly currency: string;
  readonly institutionId?: string | null;
  readonly openedOn?: string | null;
  readonly closedOn?: string | null;
  readonly balance: Money;
  readonly baseCurrencyBalance?: {
    readonly amount: Money;
    readonly rateDate: string;
    readonly rateSource: string;
    readonly fxRateId: string;
    /** Tasa resuelta completa (tipo, `stale`, atribución del provider). */
    readonly rate?: ResolvedRate;
  } | null;
  readonly clearedBalance?: Money;
  readonly pendingAmount?: Money;
  readonly includeInNetWorth: boolean;
  readonly includeInBudget?: boolean;
  readonly displayOrder?: number;
  readonly accountNumberLast4?: string | null;
  readonly color?: string | null;
  readonly icon?: string | null;
  readonly tagIds?: readonly string[];
  readonly cryptoNetwork?: string | null;
  readonly notes?: string | null;
  readonly archivedAt?: string | null;
  readonly version: number;
  readonly createdAt: string;
}

export interface AccountPage extends Page<Account> {
  readonly groups?: readonly { key: string | null; label: string | null; accountIds: readonly string[] }[];
}

export type InstitutionKind = 'BANK' | 'FINTECH' | 'EXCHANGE' | 'BROKER' | 'WALLET_PROVIDER' | 'OTHER';
export const INSTITUTION_KINDS: readonly InstitutionKind[] = [
  'BANK',
  'FINTECH',
  'EXCHANGE',
  'BROKER',
  'WALLET_PROVIDER',
  'OTHER',
];

export interface Institution {
  readonly id: string;
  readonly name: string;
  readonly kind: InstitutionKind;
  readonly countryCode?: string | null;
  readonly website?: string | null;
  readonly icon?: string | null;
  readonly color?: string | null;
  readonly notes?: string | null;
  readonly archivedAt?: string | null;
  readonly version: number;
}

export type TransactionKind =
  | 'INCOME'
  | 'EXPENSE'
  | 'TRANSFER'
  | 'REFUND'
  | 'ADJUSTMENT'
  | 'OPENING_BALANCE'
  | 'CONVERSION'
  | 'LOAN_DISBURSEMENT'
  | 'LOAN_PAYMENT';
export type TransactionStatus = 'PENDING' | 'POSTED' | 'CLEARED' | 'RECONCILED' | 'VOIDED';
export const TRANSACTION_STATUSES: readonly TransactionStatus[] = [
  'PENDING',
  'POSTED',
  'CLEARED',
  'RECONCILED',
  'VOIDED',
];
export type PaymentMethod =
  'CASH' | 'QR' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'BANK_TRANSFER' | 'DIGITAL_WALLET' | 'OTHER';
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'QR',
  'CASH',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'BANK_TRANSFER',
  'DIGITAL_WALLET',
  'OTHER',
];

export interface TransactionLeg {
  readonly accountId: string;
  readonly amount: Money;
  readonly role: 'MAIN' | 'SOURCE' | 'TARGET' | 'FEE';
}

export interface TransactionSplit {
  readonly id: string;
  readonly amount: Money;
  readonly categoryId: string;
  readonly counterpartyId?: string | null;
  readonly tagIds?: readonly string[];
  readonly memo?: string | null;
}

export interface Rate {
  readonly base: string;
  readonly quote: string;
  readonly value: string;
}

export interface ConversionFee {
  readonly type: ConversionFeeType;
  readonly amount: Money;
  readonly paidFromAccountId?: string | null;
}

export type ConversionFeeType = 'PROVIDER' | 'NETWORK' | 'BANK' | 'TAX' | 'OTHER';
export const CONVERSION_FEE_TYPES: readonly ConversionFeeType[] = [
  'PROVIDER',
  'NETWORK',
  'BANK',
  'TAX',
  'OTHER',
];

export interface ReferenceRate {
  readonly rate: Rate;
  readonly fxRateId: string;
  readonly source: string;
  readonly rateType?: FxRateType;
  readonly asOf?: string;
}

export interface ConversionPricing {
  readonly sourceAmount: Money;
  readonly convertedSourceAmount: Money;
  readonly grossTargetAmount: Money;
  readonly targetAmount: Money;
  readonly effectiveRate: Rate;
  readonly quotedRate?: Rate | null;
  readonly referenceRate?: ReferenceRate | null;
  readonly spread?: { readonly percentage: string; readonly amount: Money } | null;
  readonly quotedRateDeviation?: Money | null;
  /** Solo en respuestas que lo calculan (`getConversion`, vista previa); el detalle inline puede omitirlo. */
  readonly totalCost?: {
    readonly amount: Money;
    readonly complete: boolean;
    readonly missingValuations?: readonly Money[];
  };
}

export interface ConversionDetail extends ConversionPricing {
  readonly revision: number;
  readonly sourceAccountId: string;
  readonly targetAccountId: string;
  readonly fees: readonly ConversionFee[];
  readonly provider?: { readonly counterpartyId?: string; readonly name?: string } | null;
  readonly executedAt: string;
  readonly externalRef?: string | null;
}

export interface Transaction {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly status: TransactionStatus;
  readonly transactionDate: string;
  readonly postingDate?: string | null;
  readonly amount: Money;
  readonly refundOfTransactionId?: string | null;
  readonly adjustmentReason?: string | null;
  readonly adjustmentDirection?: 'INCREASE' | 'DECREASE' | null;
  readonly activeJournalEntryId?: string | null;
  readonly description?: string | null;
  readonly paymentMethod?: PaymentMethod | null;
  readonly notes?: string | null;
  readonly counterpartyId?: string | null;
  readonly legs: readonly TransactionLeg[];
  readonly splits: readonly TransactionSplit[];
  readonly conversion?: ConversionDetail | null;
  readonly source: string;
  readonly revision: number;
  readonly voidedAt?: string | null;
  readonly voidReason?: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly warnings?: readonly { code: string; transactionIds: readonly string[]; detail: string }[];
}

export interface Category {
  readonly id: string;
  readonly groupId: string;
  readonly parentId?: string | null;
  readonly name: string;
  readonly kind: 'EXPENSE' | 'INCOME';
  readonly systemCode?: string | null;
  readonly isSystem: boolean;
  readonly color?: string | null;
  readonly icon?: string | null;
  readonly sortOrder: number;
  readonly archivedAt?: string | null;
  readonly version: number;
}

export interface CategoryGroup {
  readonly id: string;
  readonly name: string;
  readonly kind: 'EXPENSE' | 'INCOME';
  readonly sortOrder: number;
  readonly archivedAt?: string | null;
  readonly version: number;
}

export interface Tag {
  readonly id: string;
  readonly name: string;
  readonly color?: string | null;
  readonly archivedAt?: string | null;
  readonly version: number;
}

export interface Counterparty {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly defaultCategoryId?: string | null;
  readonly aliases?: readonly string[];
  readonly archivedAt?: string | null;
  readonly version: number;
}

export interface CurrencyInfo {
  readonly code: string;
  readonly kind: 'FIAT' | 'CRYPTO' | 'COMMODITY' | 'CUSTOM';
  readonly name: string;
  readonly scale: number;
  readonly symbol?: string | null;
  readonly enabled: boolean;
}

export type FxRateType = 'OFFICIAL' | 'PARALLEL' | 'P2P' | 'BANK' | 'CUSTOM';
export const FX_RATE_TYPES: readonly FxRateType[] = ['OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM'];

export interface FxRate {
  readonly id: string;
  readonly base: string;
  readonly quote: string;
  readonly value: string;
  readonly rateType: FxRateType;
  readonly source: 'MANUAL' | 'PROVIDER' | 'USER_CONVERSION';
  readonly sourceLabel?: string | null;
  readonly asOf: string;
  readonly effectiveDate: string;
  readonly supersedesRateId?: string | null;
  readonly supersededByRateId?: string | null;
  readonly supersedeReason?: string | null;
  readonly createdAt: string;
  readonly provider?: string | null;
  readonly attribution?: RateAttribution | null;
}

export interface FxRatePreference {
  readonly base: string;
  readonly quote: string;
  readonly rateType: FxRateType;
}

export interface ConversionRevision {
  readonly revision: number;
  readonly journalEntryId: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly detail: ConversionDetail;
}

/** Nombres para mostrar referencias por id (cuentas, categorías, contrapartes, tags). */
export interface NameIndex {
  readonly accounts: ReadonlyMap<string, Account>;
  readonly categories: ReadonlyMap<string, Category>;
  readonly counterparties: ReadonlyMap<string, Counterparty>;
  readonly tags: ReadonlyMap<string, Tag>;
}

export type HistoryEntry = AuditLogEntry;
