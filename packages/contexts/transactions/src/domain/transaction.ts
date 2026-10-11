import { DomainError, Money, type Rate } from '@pf/shared-kernel';
import {
  assertInstant,
  freezeDetail,
  priceConversion,
  type ConversionDetail,
  type ConversionFeeType,
  type PairOrientation,
  type ReferenceRateInfo,
} from './conversion.js';
import { assertTransition, hasActiveEntry, type TransactionStatus } from './transaction-status.js';
import {
  LOAN_EXPENSE_COMPONENTS,
  type LoanExpenseComponent,
  type LoanPaymentBreakdown,
} from './loan-payment-breakdown.js';
import {
  TRANSACTION_LIFECYCLE,
  type TransactionTransition,
  type TransactionTransitionRecord,
} from './transaction-lifecycle.js';

/** Kinds de este change (transfers/conversions/opening los agregan otros changes sobre el mismo agregado). */
export const TRANSACTION_KINDS = [
  'INCOME',
  'EXPENSE',
  'REFUND',
  'ADJUSTMENT',
  'TRANSFER',
  'CONVERSION',
  'LOAN_DISBURSEMENT',
  'LOAN_PAYMENT',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/**
 * Kinds ADMINISTRADOS por otro contexto (add-loans, design decisión 10): solo DEBT los crea (`source = DEBT`) y los
 * anula; desde la API de transacciones únicamente se editan sus datos descriptivos.
 */
export const MANAGED_TRANSACTION_KINDS = ['LOAN_DISBURSEMENT', 'LOAN_PAYMENT'] as const;
/** `externalRef.namespace` del desembolso (= `LOAN_DISBURSEMENT_NAMESPACE` del contrato; el dominio no importa contratos). */
const LOAN_DISBURSEMENT_REF_NAMESPACE = 'debt.loan';
export const isManagedKind = (kind: TransactionKind): boolean =>
  (MANAGED_TRANSACTION_KINDS as readonly string[]).includes(kind);
export type AdjustmentDirection = 'INCREASE' | 'DECREASE';
export type AccountNature = 'ASSET' | 'LIABILITY';
export const PAYMENT_METHODS = [
  'CASH',
  'QR',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'BANK_TRANSFER',
  'DIGITAL_WALLET',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const TRANSACTION_SOURCES = ['MANUAL', 'IMPORT', 'RECURRING', 'DEBT', 'GOAL', 'SYSTEM'] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

/**
 * Modo de conciliación de una transacción `RECONCILED` (openspec add-reconciliation, docs/33 D74/D77): `STATEMENT` =
 * cotejada contra un extracto al finalizar una sesión; `WITHOUT_STATEMENT` = marcado directo explícito (efectivo,
 * billeteras sin extracto). No nulo si y solo si el estado es `RECONCILED`.
 */
export const RECONCILIATION_MODES = ['STATEMENT', 'WITHOUT_STATEMENT'] as const;
export type ReconciliationMode = (typeof RECONCILIATION_MODES)[number];

/** Marcas de sistema derivadas y de solo lectura (docs/33 D111): hoy solo la conciliación sin extracto. */
export const SYSTEM_FLAGS = ['RECONCILED_WITHOUT_STATEMENT'] as const;
export type SystemFlag = (typeof SYSTEM_FLAGS)[number];

/** `systemFlags` derivado del modo de conciliación (no se almacena: no puede divergir del estado). */
export const systemFlagsOf = (s: { readonly reconciliationMode: ReconciliationMode | null }): SystemFlag[] =>
  s.reconciliationMode === 'WITHOUT_STATEMENT' ? ['RECONCILED_WITHOUT_STATEMENT'] : [];

export interface ExternalRef {
  readonly namespace: string;
  readonly id: string;
}

/**
 * Valor de custom field de un split (openspec add-custom-fields, FR-TRANSACTIONS-026): ya validado y normalizado por
 * CLASSIFICATION (`ValidateCustomFieldValues`). `valueType` es la clase de almacenamiento (`SELECT` es `TEXT`; `NUMBER`
 * y `DECIMAL` son `NUMBER` con el string decimal canónico: nunca punto flotante). `key` es de solo lectura (derivada de
 * la definición al hidratar). El ledger nunca los ve (INV-033).
 */
export interface CustomFieldValue {
  readonly fieldId: string;
  readonly key: string;
  readonly valueType: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN';
  readonly value: string | boolean;
}

/** Porción nominal de la transacción (FR-TRANSACTIONS-026): magnitud positiva; la dirección la da `kind`. */
export interface Split {
  readonly id: string;
  readonly amount: Money;
  readonly categoryId: string;
  readonly counterpartyId: string | null;
  readonly tagIds: readonly string[];
  readonly memo: string | null;
  /** Ordenados por clave. Solo las porciones de ingresos, gastos y reembolsos los llevan (D97). */
  readonly customFields: readonly CustomFieldValue[];
}

export interface SplitInput {
  readonly id: string;
  readonly amount: Money;
  readonly categoryId: string;
  readonly counterpartyId?: string | null;
  readonly tagIds?: readonly string[];
  readonly memo?: string | null;
  /**
   * Valores finales del split ya resueltos por la aplicación (existentes ⊕ cambios validados). `undefined` en una
   * edición ⇒ se conservan los del split actual en la misma posición (copia al regenerar, design decisión 2).
   */
  readonly customFields?: readonly CustomFieldValue[];
}

const byKey = (a: CustomFieldValue, b: CustomFieldValue) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const sortedValues = (values: readonly CustomFieldValue[] | undefined): readonly CustomFieldValue[] =>
  [...(values ?? [])].sort(byKey);

/** Cambio de un custom field entre dos listas de splits: valor por posición (`null` si el split no lo tiene). */
export interface CustomFieldChange {
  readonly fieldId: string;
  readonly key: string;
  readonly before: readonly (string | boolean | null)[];
  readonly after: readonly (string | boolean | null)[];
}

/** Diferencias de custom fields por split (posición a posición) entre dos listas de splits. */
export function diffCustomFields(before: readonly Split[], after: readonly Split[]): CustomFieldChange[] {
  const fields = new Map<string, string>();
  for (const s of [...before, ...after]) for (const v of s.customFields) fields.set(v.fieldId, v.key);
  const valueOf = (s: Split | undefined, fieldId: string): string | boolean | null =>
    s?.customFields.find((v) => v.fieldId === fieldId)?.value ?? null;
  const out: CustomFieldChange[] = [];
  for (const [fieldId, key] of [...fields].sort((a, b) => (a[1] < b[1] ? -1 : 1))) {
    const length = Math.max(before.length, after.length);
    const b = Array.from({ length }, (_, i) => valueOf(before[i], fieldId));
    const a = Array.from({ length }, (_, i) => valueOf(after[i], fieldId));
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ fieldId, key, before: b, after: a });
  }
  return out;
}

/** Movimiento sobre una cuenta del usuario con signo contable (débito +, crédito −; docs/09 §3). */
export interface Leg {
  readonly accountId: string;
  readonly nature: AccountNature;
  readonly amount: Money;
  readonly role: LegRole;
}

/**
 * `MAIN` (una cuenta); `SOURCE`/`TARGET` en transferencias y conversiones (docs/09 §6.4, §6.12); `FEE` = fee de una
 * conversión pagado desde una tercera cuenta (add-manual-conversions, docs/09 §6.15).
 */
export type LegRole = 'MAIN' | 'SOURCE' | 'TARGET' | 'FEE';

export interface TransactionState {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: TransactionKind;
  readonly status: TransactionStatus;
  readonly businessDate: string;
  readonly postingDate: string | null;
  readonly accountId: string;
  readonly amount: Money;
  readonly direction: AdjustmentDirection | null;
  readonly description: string | null;
  readonly notes: string | null;
  readonly counterpartyId: string | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly source: TransactionSource;
  readonly externalRef: ExternalRef | null;
  readonly refundOfTransactionId: string | null;
  readonly adjustmentReason: string | null;
  readonly confirmedRefundExcess: boolean;
  /** Modo de conciliación; no nulo si y solo si `status = RECONCILED` (CHECK de BD, D74). */
  readonly reconciliationMode: ReconciliationMode | null;
  /** Sesión de reconciliación que creó la transacción (solo el ajuste de la sesión); `null` en el resto. */
  readonly reconciliationId: string | null;
  /** Importación que creó la transacción (`source = IMPORT`, add-basic-csv-import); `null` en el resto. */
  readonly importJobId: string | null;
  readonly legs: readonly Leg[];
  readonly splits: readonly Split[];
  readonly revision: number;
  readonly version: number;
  readonly activeEntryId: string | null;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  /** Solo `CONVERSION`: detalle de precio inmutable de la revisión vigente (docs/09 §7). */
  readonly conversion?: ConversionDetail | null;
  /** Solo `LOAN_PAYMENT`: desglose del pago (docs/04 §3.6, INV-016). */
  readonly loanPaymentBreakdown?: LoanPaymentBreakdown | null;
}

/**
 * Préstamo que administra la transacción (`LOAN_PAYMENT`: el del desglose; `LOAN_DISBURSEMENT`: el `externalRef`
 * `debt.loan/<loanId>`); `null` si no es de préstamo.
 */
export function loanIdOf(
  s: Pick<TransactionState, 'kind' | 'externalRef' | 'loanPaymentBreakdown'>,
): string | null {
  if (s.kind === 'LOAN_PAYMENT') return s.loanPaymentBreakdown?.loanId ?? null;
  if (s.kind === 'LOAN_DISBURSEMENT' && s.externalRef?.namespace === LOAN_DISBURSEMENT_REF_NAMESPACE) {
    return s.externalRef.id;
  }
  return null;
}

/** `TRANSACTION_MANAGED_EXTERNALLY` (409) con el préstamo que administra la transacción. */
export const managedExternally = (
  s: Pick<TransactionState, 'id' | 'kind' | 'externalRef' | 'loanPaymentBreakdown'>,
) =>
  new DomainError(
    'TRANSACTION_MANAGED_EXTERNALLY',
    `transaction ${s.id} (${s.kind}) is managed by DEBT; operate it from the loan`,
    { details: { managedBy: 'DEBT', loanId: loanIdOf(s) } },
  );

export interface RecordTransactionInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: TransactionKind;
  readonly status?: 'PENDING' | 'POSTED' | 'CLEARED';
  readonly businessDate: string;
  readonly postingDate?: string | null;
  readonly accountId: string;
  readonly accountNature: AccountNature;
  /** Moneda de la cuenta (INV-006): el monto debe venir en ella. */
  readonly accountCurrency: string;
  readonly amount: Money;
  readonly direction?: AdjustmentDirection | null;
  readonly description?: string | null;
  readonly notes?: string | null;
  readonly counterpartyId?: string | null;
  readonly paymentMethod?: PaymentMethod | null;
  readonly source?: TransactionSource;
  readonly externalRef?: ExternalRef | null;
  readonly refundOfTransactionId?: string | null;
  readonly reason?: string | null;
  readonly confirmedRefundExcess?: boolean;
  /** Solo el ajuste que crea una sesión de reconciliación (add-reconciliation decisión 4). */
  readonly reconciliationId?: string | null;
  /** Solo las transacciones importadas (add-basic-csv-import). */
  readonly importJobId?: string | null;
  /** `undefined` ⇒ un split por el total con `defaultCategoryId` (*Uncategorized*); `[]` ⇒ VALIDATION_FAILED. */
  readonly splits?: readonly SplitInput[];
  readonly defaultCategoryId?: string | null;
  readonly defaultSplitId?: string;
}

/** Cambios de `AmendTransaction` (merge-patch: ausente = sin cambio). */
export interface TransactionChanges {
  readonly businessDate?: string;
  readonly postingDate?: string | null;
  readonly account?: {
    readonly accountId: string;
    readonly nature: AccountNature;
    readonly currency: string;
  };
  /** Solo `TRANSFER`: nueva cuenta destino (la de `account` es el origen). */
  readonly toAccount?: TransferAccount;
  readonly amount?: Money;
  readonly description?: string | null;
  readonly notes?: string | null;
  readonly counterpartyId?: string | null;
  readonly paymentMethod?: PaymentMethod | null;
  /** Reemplazo completo de la lista; los ids los asigna la aplicación (se reutilizan si solo cambia clasificación). */
  readonly splits?: readonly SplitInput[];
}

export type ChangedField =
  | 'description'
  | 'notes'
  | 'counterpartyId'
  | 'postingDate'
  | 'paymentMethod'
  | 'status'
  | 'amount'
  | 'businessDate'
  | 'accountId'
  | 'toAccountId'
  | 'splits'
  | 'customFields'
  | 'reconciliationMode';

/** Cambio de clasificación de un split (payload de `TransactionCategorized.v1`). */
export interface SplitClassificationChange {
  readonly splitId: string;
  readonly amount: Money;
  readonly previousCategoryId: string | null;
  readonly newCategoryId: string | null;
  readonly addedTagIds: readonly string[];
  readonly removedTagIds: readonly string[];
}

export interface AmendResult {
  readonly changedFields: readonly ChangedField[];
  /** Cambios de valores de custom fields (INV-033: sin efecto en el ledger); vacío si no cambió ninguno. */
  readonly customFieldChanges: readonly CustomFieldChange[];
  /** `true` ⇒ la aplicación debe revertir el asiento activo y postear la revisión nueva (docs/09 §11). */
  readonly ledgerImpact: boolean;
  readonly classificationChanges: readonly SplitClassificationChange[];
  readonly previousStatus: TransactionStatus;
  readonly previousEntryId: string | null;
}

const MAX_SPLITS = 50;
const validation = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

function assertText(value: string | null | undefined, max: number, pointer: string): void {
  if (value !== null && value !== undefined && value.length > max)
    throw validation(`must be at most ${max} characters`, pointer);
}

/** Signo contable del leg principal (docs/09 §6.1–§6.6). */
export function legAmount(
  kind: TransactionKind,
  nature: AccountNature,
  amount: Money,
  direction: AdjustmentDirection | null,
): Money {
  switch (kind) {
    case 'INCOME':
    case 'REFUND':
      return amount;
    case 'EXPENSE':
    case 'TRANSFER':
    case 'CONVERSION':
    case 'LOAN_DISBURSEMENT':
    case 'LOAN_PAYMENT':
      // TRANSFER/CONVERSION/préstamo: leg de origen (los legs completos los arman `transferLegs`/`conversionLegs`/
      // `loanDisbursementLegs`/`loanPaymentLegs`).
      return amount.negate();
    case 'ADJUSTMENT': {
      // INCREASE = aumenta el saldo PRESENTADO: débito en ASSET, crédito en LIABILITY.
      const increaseIsDebit = nature === 'ASSET';
      return (direction === 'INCREASE') === increaseIsDebit ? amount : amount.negate();
    }
  }
}

/** ¿El kind lleva splits nominales? (ADJUSTMENT no, en Phase 1: va contra EQUITY:ADJUSTMENTS). */
export const hasNominalSplits = (kind: TransactionKind): boolean => kind !== 'ADJUSTMENT';

function buildSplits(
  kind: TransactionKind,
  amount: Money,
  input: readonly SplitInput[] | undefined,
  defaults: { readonly categoryId: string | null | undefined; readonly splitId: string | undefined },
): Split[] {
  if (!hasNominalSplits(kind)) {
    if (input !== undefined) throw validation('ADJUSTMENT does not accept splits in Phase 1', '/splits');
    return [];
  }
  if (input === undefined) {
    if (!defaults.categoryId || !defaults.splitId) {
      throw new DomainError('REFERENCE_NOT_FOUND', 'system category Uncategorized is not provisioned');
    }
    return [
      {
        id: defaults.splitId,
        amount,
        categoryId: defaults.categoryId,
        counterpartyId: null,
        tagIds: [],
        memo: null,
        customFields: [],
      },
    ];
  }
  if (input.length === 0) throw validation('splits must have at least one item', '/splits');
  if (input.length > MAX_SPLITS) throw validation(`at most ${MAX_SPLITS} splits`, '/splits');
  const splits = input.map((s, i): Split => {
    if (s.amount.currency.code !== amount.currency.code) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `split ${i} is in ${s.amount.currency.code}, not ${amount.currency.code}`,
      ).at(`/splits/${i}/amount/currency`);
    }
    if (!s.amount.isPositive()) {
      throw new DomainError('AMOUNT_NOT_POSITIVE', 'split amount must be > 0').at(
        `/splits/${i}/amount/amount`,
      );
    }
    assertText(s.memo, 500, `/splits/${i}/memo`);
    return {
      id: s.id,
      amount: s.amount,
      categoryId: s.categoryId,
      counterpartyId: s.counterpartyId ?? null,
      tagIds: [...new Set(s.tagIds ?? [])],
      memo: s.memo ?? null,
      customFields: sortedValues(s.customFields),
    };
  });
  assertSplitsSum(amount, splits);
  return splits;
}

/** INV-021: Σ splits = monto de la transacción, exacto (sin tolerancia ni redondeo). */
export function assertSplitsSum(amount: Money, splits: readonly { readonly amount: Money }[]): void {
  const total = Money.sum(
    splits.map((s) => s.amount),
    amount.currency,
  );
  if (!total.equals(amount)) {
    throw new DomainError(
      'SPLITS_DO_NOT_SUM',
      `splits sum ${total.toFixed()} but the transaction amount is ${amount.toFixed()}`,
    ).at('/splits');
  }
}

/** Cuenta de una transferencia, con la moneda y naturaleza que informa Accounts. */
export interface TransferAccount {
  readonly accountId: string;
  readonly nature: AccountNature;
  readonly currency: string;
}

export interface TransferFeeInput {
  readonly amount: Money;
  readonly categoryId: string;
  readonly splitId: string;
}

export interface RecordTransferInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly status?: 'PENDING' | 'POSTED' | 'CLEARED';
  readonly businessDate: string;
  readonly postingDate?: string | null;
  readonly from: TransferAccount;
  readonly to: TransferAccount;
  readonly amount: Money;
  readonly fee?: TransferFeeInput | null;
  readonly description?: string | null;
  readonly notes?: string | null;
  readonly paymentMethod?: PaymentMethod | null;
  readonly source?: TransactionSource;
  readonly externalRef?: ExternalRef | null;
}

/**
 * Invariantes de una transferencia (add-transfers design.md decisión 3): cuentas distintas (`TRANSFER_SAME_ACCOUNT`),
 * misma moneda en ambas cuentas y en el monto (`TRANSFER_CURRENCY_MISMATCH`, orientado a conversión; INV-002).
 */
export function assertTransferAccounts(from: TransferAccount, to: TransferAccount, amount: Money): void {
  if (from.accountId === to.accountId) {
    throw new DomainError('TRANSFER_SAME_ACCOUNT', 'source and destination are the same account').at(
      '/toAccountId',
    );
  }
  if (from.currency !== to.currency) {
    throw new DomainError(
      'TRANSFER_CURRENCY_MISMATCH',
      `the accounts are in ${from.currency} and ${to.currency}; register a conversion instead`,
    ).at('/toAccountId');
  }
  if (amount.currency.code !== from.currency) {
    throw new DomainError(
      'TRANSFER_CURRENCY_MISMATCH',
      `the accounts are in ${from.currency}, not ${amount.currency.code}; register a conversion instead`,
    ).at('/amount/currency');
  }
}

/** Legs de una transferencia: `SOURCE` = −(monto + comisión), `TARGET` = +monto (docs/09 §6.4, §6.8). */
export function transferLegs(
  from: TransferAccount,
  to: TransferAccount,
  amount: Money,
  fee: Money | null,
): Leg[] {
  const out = fee ? amount.add(fee) : amount;
  return [
    { accountId: from.accountId, nature: from.nature, amount: out.negate(), role: 'SOURCE' },
    { accountId: to.accountId, nature: to.nature, amount, role: 'TARGET' },
  ];
}

/** Comisión de la transferencia = Σ splits (solo el split de comisión; INV-021 no aplica a la parte transferida). */
export function transferFee(s: Pick<TransactionState, 'splits' | 'amount'>): Money | null {
  if (s.splits.length === 0) return null;
  return Money.sum(
    s.splits.map((x) => x.amount),
    s.amount.currency,
  );
}

// ───────────────────────────────────────────── préstamos (add-loans, docs/09 §6.9)

export interface RecordLoanDisbursementInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly businessDate: string;
  /** Cuenta del préstamo (pasivo): pata `SOURCE` por `−principal` (aumenta la deuda). */
  readonly loanAccount: TransferAccount;
  /** Cuenta que recibe el neto: pata `TARGET` por `principal − comisión`. */
  readonly destinationAccount: TransferAccount;
  readonly principal: Money;
  /** Comisión retenida por el prestamista (split de gasto); `null` si no hay. */
  readonly retainedFee?: {
    readonly amount: Money;
    readonly categoryId: string;
    readonly splitId: string;
  } | null;
  readonly counterpartyId?: string | null;
  readonly description?: string | null;
  readonly externalRef: ExternalRef;
}

export interface RecordLoanPaymentInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly businessDate: string;
  /** Cuenta desde la que se paga: pata `SOURCE` por `−monto`. */
  readonly paymentAccount: TransferAccount;
  /** Cuenta del préstamo: pata `TARGET` por `+principal` (omitida si el principal es 0). */
  readonly loanAccount: TransferAccount;
  readonly amount: Money;
  readonly breakdown: LoanPaymentBreakdown;
  /** Categoría de sistema de cada componente de gasto y generador de ids de split. */
  readonly categoryIds: Readonly<Record<LoanExpenseComponent, string>>;
  readonly newSplitId: () => string;
  readonly counterpartyId?: string | null;
  readonly paymentMethod?: PaymentMethod | null;
  readonly description?: string | null;
  readonly externalRef: ExternalRef;
}

function assertLoanAccounts(accounts: readonly [TransferAccount, TransferAccount], amount: Money): void {
  const [a, b] = accounts;
  if (a.accountId === b.accountId) {
    throw validation('the two accounts of a loan transaction must differ', '/accounts');
  }
  for (const acc of accounts) {
    if (acc.currency !== amount.currency.code) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `account ${acc.accountId} is in ${acc.currency}, the amount is in ${amount.currency.code}`,
      ).at('/accounts');
    }
  }
}

const expenseSplit = (id: string, amount: Money, categoryId: string): Split => ({
  id,
  amount,
  categoryId,
  counterpartyId: null,
  tagIds: [],
  memo: null,
  customFields: [],
});

/** Legs del desembolso: `SOURCE` = −principal (pasivo), `TARGET` = +(principal − comisión retenida). */
export function loanDisbursementLegs(
  loan: TransferAccount,
  destination: TransferAccount,
  principal: Money,
  fee: Money | null,
): Leg[] {
  return [
    { accountId: loan.accountId, nature: loan.nature, amount: principal.negate(), role: 'SOURCE' },
    {
      accountId: destination.accountId,
      nature: destination.nature,
      amount: fee ? principal.subtract(fee) : principal,
      role: 'TARGET',
    },
  ];
}

/** Legs del pago: `SOURCE` = −monto, `TARGET` = +principal (omitido si el principal es 0: CHECK `posting_nonzero`). */
export function loanPaymentLegs(
  from: TransferAccount,
  loan: TransferAccount,
  amount: Money,
  principal: Money,
): Leg[] {
  const legs: Leg[] = [
    { accountId: from.accountId, nature: from.nature, amount: amount.negate(), role: 'SOURCE' },
  ];
  if (principal.isPositive()) {
    legs.push({ accountId: loan.accountId, nature: loan.nature, amount: principal, role: 'TARGET' });
  }
  return legs;
}

type MoneyLike = { readonly amount: string; readonly currency: string } | Money;
const moneyKey = (m: MoneyLike): string =>
  m instanceof Money ? `${m.toFixed()} ${m.currency.code}` : `${m.amount} ${m.currency}`;

/**
 * Edición financiera de una transacción administrada (monto, cuentas, fecha, moneda o splits distintos de los
 * actuales) ⇒ `TRANSACTION_MANAGED_EXTERNALLY`. Descripción, notas, tags, memo, contraparte y medio de pago siguen
 * editables sin tocar el ledger. Se aplica en el servicio (antes de validar cuentas) y en `amend` (defensa).
 */
export function assertManagedEditAllowed(
  s: Pick<
    TransactionState,
    | 'id'
    | 'kind'
    | 'externalRef'
    | 'loanPaymentBreakdown'
    | 'businessDate'
    | 'accountId'
    | 'amount'
    | 'splits'
  >,
  changes: {
    readonly businessDate?: string;
    readonly accountId?: string;
    readonly toAccount?: unknown;
    readonly amount?: MoneyLike;
    readonly splits?: readonly { readonly amount: MoneyLike; readonly categoryId: string }[];
  },
): void {
  if (!isManagedKind(s.kind)) return;
  const same =
    (changes.businessDate === undefined || changes.businessDate === s.businessDate) &&
    (changes.accountId === undefined || changes.accountId === s.accountId) &&
    changes.toAccount === undefined &&
    (changes.amount === undefined || moneyKey(changes.amount) === moneyKey(s.amount)) &&
    (changes.splits === undefined ||
      (changes.splits.length === s.splits.length &&
        changes.splits.every((x, i) => {
          const cur = s.splits[i] as Split;
          return moneyKey(x.amount) === moneyKey(cur.amount) && x.categoryId === cur.categoryId;
        })));
  if (!same) throw managedExternally(s);
}

/** Cuenta de una conversión con la moneda y naturaleza que informa Accounts. */
export type ConversionAccount = TransferAccount;

export interface ConversionFeeSpec {
  readonly type: ConversionFeeType;
  readonly amount: Money;
  /** Tercera cuenta que paga el fee (su moneda debe ser la del fee); `null` = descontado del origen o destino. */
  readonly paidFrom: ConversionAccount | null;
  /** Categoría del split de gasto (por defecto la de sistema *Fees*). */
  readonly categoryId: string;
  readonly splitId: string;
}

/** Datos financieros de una conversión (registro y `amendConversion`, que los reemplaza completos). */
export interface ConversionData {
  readonly businessDate: string;
  readonly postingDate?: string | null;
  readonly sourceAccount: ConversionAccount;
  readonly targetAccount: ConversionAccount;
  /** Bruto entregado, en la moneda de la cuenta origen. */
  readonly sourceAmount: Money;
  /** Neto recibido, en la moneda de la cuenta destino. */
  readonly targetAmount: Money;
  readonly fees: readonly ConversionFeeSpec[];
  readonly quotedRate: Rate | null;
  readonly referenceRate: ReferenceRateInfo | null;
  readonly display: PairOrientation;
  readonly provider: { readonly counterpartyId: string | null; readonly name: string | null };
  readonly executedAt: string;
  readonly externalRef: string | null;
  readonly description?: string | null;
  readonly notes?: string | null;
}

export interface RecordConversionInput extends ConversionData {
  readonly id: string;
  readonly workspaceId: string;
  readonly status?: 'PENDING' | 'POSTED' | 'CLEARED';
  readonly origin?: TransactionSource;
}

/**
 * Valida una conversión y arma legs, splits de fees y el `ConversionDetail` de la revisión (transactions/conversions;
 * docs/09 §6.12–§6.15, §7.2): cuentas de monedas distintas (`CONVERSION_SAME_CURRENCY`), montos en la moneda de su
 * cuenta (`CURRENCY_MISMATCH`), escala (ya validada al construir `Money`), fees por moneda y cuenta pagadora
 * (`CONVERSION_AMOUNTS_INCONSISTENT`) e INV-010 (convertido + fees en origen = bruto; neto + fees en destino = bruto
 * destino), todo ANTES de tocar el ledger.
 */
export function buildConversion(
  data: ConversionData,
  revision: number,
): Pick<TransactionState, 'accountId' | 'amount' | 'legs' | 'splits' | 'conversion'> {
  const { sourceAccount: from, targetAccount: to } = data;
  if (from.currency === to.currency) {
    throw new DomainError(
      'CONVERSION_SAME_CURRENCY',
      `both accounts are in ${from.currency}; record a transfer instead`,
    ).at('/targetAccountId');
  }
  if (data.sourceAmount.currency.code !== from.currency) {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `the source account is in ${from.currency}, not ${data.sourceAmount.currency.code}`,
    ).at('/sourceAmount/currency');
  }
  if (data.targetAmount.currency.code !== to.currency) {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `the target account is in ${to.currency}, not ${data.targetAmount.currency.code}`,
    ).at('/targetAmount/currency');
  }
  for (const [i, f] of data.fees.entries()) {
    if (f.paidFrom && f.paidFrom.currency !== f.amount.currency.code) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `the fee is in ${f.amount.currency.code} but account ${f.paidFrom.accountId} is in ${f.paidFrom.currency}`,
      ).at(`/fees/${i}/paidFromAccountId`);
    }
  }
  assertText(data.description, 500, '/description');
  assertText(data.notes, 4000, '/notes');
  assertText(data.provider.name, 100, '/provider/name');
  assertText(data.externalRef, 200, '/externalRef');
  const executedAt = assertInstant(data.executedAt, '/executedAt');
  const pricing = priceConversion({
    sourceAmount: data.sourceAmount,
    targetAmount: data.targetAmount,
    fees: data.fees.map((f) => ({
      type: f.type,
      amount: f.amount,
      paidFromAccountId: f.paidFrom?.accountId ?? null,
    })),
    quotedRate: data.quotedRate,
    referenceRate: data.referenceRate?.rate ?? null,
    display: data.display,
  });
  const legs: Leg[] = [
    { accountId: from.accountId, nature: from.nature, amount: data.sourceAmount.negate(), role: 'SOURCE' },
    { accountId: to.accountId, nature: to.nature, amount: data.targetAmount, role: 'TARGET' },
    ...data.fees.flatMap((f): Leg[] =>
      f.paidFrom
        ? [
            {
              accountId: f.paidFrom.accountId,
              nature: f.paidFrom.nature,
              amount: f.amount.negate(),
              role: 'FEE',
            },
          ]
        : [],
    ),
  ];
  const splits: Split[] = data.fees.map((f) => ({
    id: f.splitId,
    amount: f.amount,
    categoryId: f.categoryId,
    counterpartyId: null,
    tagIds: [],
    memo: null,
    customFields: [],
  }));
  const conversion = freezeDetail({
    revision,
    sourceAccountId: from.accountId,
    targetAccountId: to.accountId,
    sourceAmount: data.sourceAmount,
    convertedSourceAmount: pricing.convertedSource,
    grossTargetAmount: pricing.grossTarget,
    targetAmount: data.targetAmount,
    quotedRate: data.quotedRate,
    effectiveRate: pricing.effectiveRate,
    referenceRate: data.referenceRate,
    spread: pricing.spread,
    quotedRateDeviation: pricing.quotedRateDeviation,
    fees: data.fees.map((f, i) => ({
      feeNo: i + 1,
      type: f.type,
      amount: f.amount,
      paidFromAccountId: f.paidFrom?.accountId ?? null,
      splitId: f.splitId,
    })),
    provider: { counterpartyId: data.provider.counterpartyId, name: data.provider.name },
    executedAt,
    externalRef: data.externalRef,
  });
  return { accountId: from.accountId, amount: data.sourceAmount, legs, splits, conversion };
}

/**
 * Agregado `Transaction` (design.md decisiones 2–5, 8–11): ingresos, gastos, reembolsos y ajustes con splits, máquina
 * de estados, edición financiera (reversa + revisión nueva) vs. descriptiva (in situ, INV-033) y anulación.
 * Las interacciones con el ledger las orquesta la aplicación a partir de lo que devuelven estos métodos.
 */
export class Transaction {
  private state: TransactionState;
  /** Versión leída de la BD (optimistic locking); `null` si es nueva. */
  readonly persistedVersion: number | null;
  /** Splits reemplazados en esta unidad de trabajo (quedan con `superseded_in_revision`). */
  private replacedSplits = false;
  /**
   * Paso del flujo producido en esta unidad de trabajo (add-lifecycle-timeline decisión 2), validado contra
   * `TRANSACTION_LIFECYCLE`; `null` si el comando no cambió el estado (edición descriptiva ⇒ anotación).
   */
  private transitionRecord: TransactionTransitionRecord | null = null;

  private constructor(state: TransactionState, persistedVersion: number | null) {
    this.state = state;
    this.persistedVersion = persistedVersion;
    // Un agregado nuevo nace con la transición RECORD (∅ → PENDING | POSTED | CLEARED).
    if (persistedVersion === null) this.mark('RECORD', null, state.status, null, state.revision);
  }

  static rehydrate(state: TransactionState): Transaction {
    return new Transaction(state, state.version);
  }

  static record(input: RecordTransactionInput): Transaction {
    const { amount, kind } = input;
    if (amount.currency.code !== input.accountCurrency) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `the account is in ${input.accountCurrency}, not ${amount.currency.code}`,
      ).at('/amount/currency');
    }
    if (!amount.isPositive()) {
      throw new DomainError('AMOUNT_NOT_POSITIVE', 'amount must be > 0').at('/amount/amount');
    }
    assertText(input.description, 500, '/description');
    assertText(input.notes, 4000, '/notes');
    let direction: AdjustmentDirection | null = null;
    let reason: string | null = null;
    if (kind === 'ADJUSTMENT') {
      if (input.direction !== 'INCREASE' && input.direction !== 'DECREASE') {
        throw validation('direction is required for ADJUSTMENT', '/direction');
      }
      direction = input.direction;
      reason = (input.reason ?? '').trim();
      if (reason.length === 0) throw validation('reason is required for ADJUSTMENT', '/reason');
      assertText(reason, 500, '/reason');
    } else if (input.direction !== null && input.direction !== undefined) {
      throw validation('direction only applies to ADJUSTMENT', '/direction');
    }
    if (
      input.refundOfTransactionId !== null &&
      input.refundOfTransactionId !== undefined &&
      kind !== 'REFUND'
    ) {
      throw validation('refundOfTransactionId only applies to REFUND', '/refundOfTransactionId');
    }
    const splits = buildSplits(kind, amount, input.splits, {
      categoryId: input.defaultCategoryId,
      splitId: input.defaultSplitId,
    });
    const status = input.status ?? 'POSTED';
    return new Transaction(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        kind,
        status,
        businessDate: input.businessDate,
        postingDate: input.postingDate ?? null,
        accountId: input.accountId,
        amount,
        direction,
        description: input.description ?? null,
        notes: input.notes ?? null,
        counterpartyId: input.counterpartyId ?? null,
        paymentMethod: input.paymentMethod ?? null,
        source: input.source ?? 'MANUAL',
        externalRef: input.externalRef ?? null,
        refundOfTransactionId: input.refundOfTransactionId ?? null,
        adjustmentReason: reason,
        confirmedRefundExcess: input.confirmedRefundExcess ?? false,
        reconciliationMode: null,
        reconciliationId: input.reconciliationId ?? null,
        importJobId: input.importJobId ?? null,
        legs: [
          {
            accountId: input.accountId,
            nature: input.accountNature,
            amount: legAmount(kind, input.accountNature, amount, direction),
            role: 'MAIN',
          },
        ],
        splits,
        revision: 1,
        version: 1,
        activeEntryId: null,
        voidedAt: null,
        voidReason: null,
        createdAt: null,
        updatedAt: null,
      },
      null,
    );
  }

  /**
   * Transferencia entre cuentas propias de la misma moneda (add-transfers design.md decisiones 1–4): un único hecho
   * con legs `SOURCE`/`TARGET`; la comisión opcional es el único split (categoría de gasto, p. ej. *Fees*). El pago de
   * tarjeta es el caso ASSET → LIABILITY (INV-030). ΔPatrimonio = −comisión (INV-009).
   */
  static recordTransfer(input: RecordTransferInput): Transaction {
    const { amount, from, to } = input;
    if (!amount.isPositive()) {
      throw new DomainError('AMOUNT_NOT_POSITIVE', 'amount must be > 0').at('/amount/amount');
    }
    assertTransferAccounts(from, to, amount);
    assertText(input.description, 500, '/description');
    assertText(input.notes, 4000, '/notes');
    const fee = input.fee ?? null;
    const splits: Split[] = [];
    if (fee) {
      if (fee.amount.currency.code !== amount.currency.code) {
        throw new DomainError(
          'TRANSFER_CURRENCY_MISMATCH',
          `the fee is in ${fee.amount.currency.code}, not ${amount.currency.code}`,
        ).at('/fee/amount/currency');
      }
      if (!fee.amount.isPositive()) {
        throw new DomainError('AMOUNT_NOT_POSITIVE', 'fee must be > 0').at('/fee/amount/amount');
      }
      splits.push({
        id: fee.splitId,
        amount: fee.amount,
        categoryId: fee.categoryId,
        counterpartyId: null,
        tagIds: [],
        memo: null,
        customFields: [],
      });
    }
    return new Transaction(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        kind: 'TRANSFER',
        status: input.status ?? 'POSTED',
        businessDate: input.businessDate,
        postingDate: input.postingDate ?? null,
        accountId: from.accountId,
        amount,
        direction: null,
        description: input.description ?? null,
        notes: input.notes ?? null,
        counterpartyId: null,
        paymentMethod: input.paymentMethod ?? null,
        source: input.source ?? 'MANUAL',
        externalRef: input.externalRef ?? null,
        refundOfTransactionId: null,
        adjustmentReason: null,
        confirmedRefundExcess: false,
        reconciliationMode: null,
        reconciliationId: null,
        importJobId: null,
        legs: transferLegs(from, to, amount, fee?.amount ?? null),
        splits,
        revision: 1,
        version: 1,
        activeEntryId: null,
        voidedAt: null,
        voidReason: null,
        createdAt: null,
        updatedAt: null,
      },
      null,
    );
  }

  /**
   * Desembolso de un préstamo (add-loans, docs/09 §6.9): UNA transacción `LOAN_DISBURSEMENT` `source = DEBT` con legs
   * `SOURCE` (cuenta del préstamo, −principal) y `TARGET` (destino, +neto) y, si hay comisión retenida, un split de
   * gasto por la comisión. Σ splits = comisión; el principal no es gasto (INV-009). Administrada por DEBT.
   */
  static recordLoanDisbursement(input: RecordLoanDisbursementInput): Transaction {
    const { principal, loanAccount, destinationAccount } = input;
    if (!principal.isPositive()) {
      throw new DomainError('AMOUNT_NOT_POSITIVE', 'principal must be > 0').at('/principal/amount');
    }
    assertLoanAccounts([loanAccount, destinationAccount], principal);
    assertText(input.description, 500, '/description');
    const fee = input.retainedFee ?? null;
    const splits: Split[] = [];
    if (fee && !fee.amount.isZero()) {
      if (fee.amount.currency.code !== principal.currency.code) {
        throw new DomainError(
          'CURRENCY_MISMATCH',
          `the fee is in ${fee.amount.currency.code}, not ${principal.currency.code}`,
        ).at('/retainedFee/currency');
      }
      if (fee.amount.isNegative() || !fee.amount.subtract(principal).isNegative()) {
        throw validation('the retained fee must be >= 0 and less than the principal', '/retainedFee');
      }
      splits.push(expenseSplit(fee.splitId, fee.amount, fee.categoryId));
    }
    return new Transaction(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        kind: 'LOAN_DISBURSEMENT',
        status: 'POSTED',
        businessDate: input.businessDate,
        postingDate: null,
        accountId: loanAccount.accountId,
        amount: principal,
        direction: null,
        description: input.description ?? null,
        notes: null,
        counterpartyId: input.counterpartyId ?? null,
        paymentMethod: null,
        source: 'DEBT',
        externalRef: input.externalRef,
        refundOfTransactionId: null,
        adjustmentReason: null,
        confirmedRefundExcess: false,
        reconciliationMode: null,
        reconciliationId: null,
        importJobId: null,
        legs: loanDisbursementLegs(loanAccount, destinationAccount, principal, splits[0]?.amount ?? null),
        splits,
        revision: 1,
        version: 1,
        activeEntryId: null,
        voidedAt: null,
        voidReason: null,
        createdAt: null,
        updatedAt: null,
      },
      null,
    );
  }

  /**
   * Pago de un préstamo (add-loans, docs/09 §6.9, INV-016): UNA transacción `LOAN_PAYMENT` `source = DEBT` con legs
   * `SOURCE` (−monto) y `TARGET` (+principal, omitido si es 0) y un split de gasto por cada componente no nulo del
   * desglose (interés, comisiones, seguro, impuestos). Σ splits = monto − principal (INV-021 ampliado).
   */
  static recordLoanPayment(input: RecordLoanPaymentInput): Transaction {
    const { amount, breakdown, paymentAccount, loanAccount } = input;
    if (!amount.isPositive()) {
      throw new DomainError('AMOUNT_NOT_POSITIVE', 'amount must be > 0').at('/amount/amount');
    }
    assertLoanAccounts([paymentAccount, loanAccount], amount);
    assertText(input.description, 500, '/description');
    breakdown.assertMatches(amount);
    const splits: Split[] = LOAN_EXPENSE_COMPONENTS.flatMap(({ key }) => {
      const component = breakdown[key];
      return component.isPositive()
        ? [expenseSplit(input.newSplitId(), component, input.categoryIds[key])]
        : [];
    });
    return new Transaction(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        kind: 'LOAN_PAYMENT',
        status: 'POSTED',
        businessDate: input.businessDate,
        postingDate: null,
        accountId: paymentAccount.accountId,
        amount,
        direction: null,
        description: input.description ?? null,
        notes: null,
        counterpartyId: input.counterpartyId ?? null,
        paymentMethod: input.paymentMethod ?? null,
        source: 'DEBT',
        externalRef: input.externalRef,
        refundOfTransactionId: null,
        adjustmentReason: null,
        confirmedRefundExcess: false,
        reconciliationMode: null,
        reconciliationId: null,
        importJobId: null,
        legs: loanPaymentLegs(paymentAccount, loanAccount, amount, breakdown.principal),
        splits,
        revision: 1,
        version: 1,
        activeEntryId: null,
        voidedAt: null,
        voidReason: null,
        createdAt: null,
        updatedAt: null,
        loanPaymentBreakdown: breakdown,
      },
      null,
    );
  }

  /**
   * Conversión entre monedas (transactions/conversions; ARCHITECTURE §4.2): UNA transacción `CONVERSION` con legs
   * `SOURCE` (−bruto), `TARGET` (+neto) y `FEE` (fees desde una tercera cuenta), un split de gasto por fee y el
   * `ConversionDetail` inmutable de la revisión 1. El asiento lo arma el traductor (patas `EQUITY:FX_TRADING:<CCY>`).
   */
  static recordConversion(input: RecordConversionInput): Transaction {
    const built = buildConversion(input, 1);
    return new Transaction(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        kind: 'CONVERSION',
        status: input.status ?? 'POSTED',
        businessDate: input.businessDate,
        postingDate: input.postingDate ?? null,
        ...built,
        direction: null,
        description: input.description ?? null,
        notes: input.notes ?? null,
        counterpartyId: input.provider.counterpartyId,
        paymentMethod: null,
        source: input.origin ?? 'MANUAL',
        externalRef: null,
        refundOfTransactionId: null,
        adjustmentReason: null,
        confirmedRefundExcess: false,
        reconciliationMode: null,
        reconciliationId: null,
        importJobId: null,
        revision: 1,
        version: 1,
        activeEntryId: null,
        voidedAt: null,
        voidReason: null,
        createdAt: null,
        updatedAt: null,
      },
      null,
    );
  }

  /**
   * `AmendConversion` (FR-TRANSACTIONS-024, docs/31 D11): reemplazo completo de los datos financieros ⇒ revisión + 1
   * con un `ConversionDetail` NUEVO (el anterior se conserva) y, si hay asiento activo, `ledgerImpact` (la aplicación
   * revierte el asiento y postea el nuevo en la misma transacción BD). VOIDED ⇒ `INVALID_STATUS_TRANSITION`;
   * RECONCILED ⇒ `TRANSACTION_RECONCILED`; un CLEARED vuelve a POSTED.
   */
  amendConversion(data: ConversionData): AmendResult {
    const s = this.state;
    if (s.kind !== 'CONVERSION') {
      throw new DomainError('RESOURCE_NOT_FOUND', `transaction ${s.id} is not a conversion`);
    }
    if (s.status === 'VOIDED') {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'a voided conversion cannot be amended');
    }
    if (s.status === 'RECONCILED') {
      throw new DomainError(
        'TRANSACTION_RECONCILED',
        'a reconciled conversion must be un-reconciled before it is amended',
      );
    }
    const revision = s.revision + 1;
    const built = buildConversion(data, revision);
    const ledgerImpact = hasActiveEntry(s.status);
    const previousEntryId = s.activeEntryId;
    const previousStatus = s.status;
    this.state = {
      ...s,
      ...built,
      businessDate: data.businessDate,
      postingDate: data.postingDate === undefined ? s.postingDate : data.postingDate,
      description: data.description === undefined ? s.description : data.description,
      notes: data.notes === undefined ? s.notes : data.notes,
      counterpartyId: data.provider.counterpartyId,
      revision,
      status: s.status === 'CLEARED' ? 'POSTED' : s.status,
      activeEntryId: null,
      version: s.version + 1,
    };
    this.replacedSplits = true;
    if (ledgerImpact) this.mark('REVISE', previousStatus, this.state.status, s.revision, revision);
    const changed: ChangedField[] = ['amount', 'businessDate', 'accountId', 'splits'];
    if (this.state.status !== previousStatus) changed.push('status');
    return {
      changedFields: changed,
      customFieldChanges: [],
      ledgerImpact,
      classificationChanges: [],
      previousStatus,
      previousEntryId,
    };
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get status(): TransactionStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  get revision(): number {
    return this.state.revision;
  }
  get snapshot(): TransactionState {
    return this.state;
  }
  get splitsReplaced(): boolean {
    return this.replacedSplits;
  }
  /** Transición registrada por el último comando (o `null` si no cambió el estado). */
  get lastTransition(): TransactionTransitionRecord | null {
    return this.transitionRecord;
  }
  /** ¿Necesita asiento (estado no PENDING ni VOIDED)? INV-023. */
  get needsEntry(): boolean {
    return hasActiveEntry(this.state.status);
  }

  /** Vincula el asiento recién posteado (la aplicación lo obtiene de `LedgerPostingPort`). */
  attachEntry(journalEntryId: string): void {
    if (!this.needsEntry) {
      throw new DomainError('INVALID_STATUS_TRANSITION', `a ${this.state.status} transaction has no entry`);
    }
    this.state = { ...this.state, activeEntryId: journalEntryId };
  }

  /** `PENDING → POSTED` (TC-TRANSACTIONS-PENDING-001); la aplicación postea el asiento y lo vincula. */
  post(): void {
    assertTransition(this.state.status, 'POSTED');
    if (this.state.status !== 'PENDING') return;
    this.mark('POST', 'PENDING', 'POSTED', null, null);
    this.bump({ status: 'POSTED' });
  }

  /**
   * `POSTED ↔ CLEARED` sin tocar el ledger (transactions/reconciliation). `CLEARED → RECONCILED` ya no pasa por aquí:
   * lo hacen `reconcile` (sesión) o `reconcileWithoutStatement` (marcado directo explícito, docs/33 D74).
   */
  changeStatus(to: 'POSTED' | 'CLEARED'): TransactionStatus {
    const from = this.state.status;
    if (from === to) return from;
    if (from === 'PENDING') {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'use postTransaction to post a PENDING transaction');
    }
    assertTransition(from, to);
    const code: TransactionTransition = to === 'CLEARED' ? 'CLEAR' : 'UNCLEAR';
    this.mark(code, from, to, null, null);
    this.bump({ status: to });
    return from;
  }

  /**
   * `RECONCILE` (`CLEARED → RECONCILED`, modo `STATEMENT`): solo al finalizar la sesión de reconciliación
   * `reconciliationId` de la cuenta (add-reconciliation decisión 4). Sin efectos en el ledger (INV-033).
   */
  reconcile(reconciliationId: string): void {
    if (reconciliationId.trim().length === 0) {
      throw validation('reconciliationId is required', '/reconciliationId');
    }
    this.assertCanReconcile();
    this.mark('RECONCILE', 'CLEARED', 'RECONCILED', null, null);
    this.bump({ status: 'RECONCILED', reconciliationMode: 'STATEMENT' });
  }

  /**
   * `RECONCILE_WITHOUT_STATEMENT` (`CLEARED → RECONCILED`, modo `WITHOUT_STATEMENT`): marcado directo fuera de una
   * sesión. Exige el modo explícito (docs/33 D74): sin él `VALIDATION_FAILED`; `STATEMENT` solo se alcanza por una
   * sesión. Solo desde `CLEARED` (`INVALID_STATUS_TRANSITION`).
   */
  reconcileWithoutStatement(mode: string | null | undefined): void {
    if (mode !== 'WITHOUT_STATEMENT') {
      throw validation(
        'reconciling a transaction directly requires reconciliationMode WITHOUT_STATEMENT',
        '/reconciliationMode',
      );
    }
    this.assertCanReconcile();
    this.mark('RECONCILE_WITHOUT_STATEMENT', 'CLEARED', 'RECONCILED', null, null);
    this.bump({ status: 'RECONCILED', reconciliationMode: 'WITHOUT_STATEMENT' });
  }

  /**
   * Cotejo posterior (docs/33 D111, decisión 14): una sesión que cubre la transacción la pasa de `WITHOUT_STATEMENT`
   * a `STATEMENT` sin cambiar el estado ni el ledger. Es una anotación del recorrido, no una transición. Devuelve
   * `false` (sin cambios) si no estaba conciliada sin extracto.
   */
  verifyAgainstStatement(reconciliationId: string): boolean {
    if (reconciliationId.trim().length === 0) {
      throw validation('reconciliationId is required', '/reconciliationId');
    }
    if (this.state.status !== 'RECONCILED' || this.state.reconciliationMode !== 'WITHOUT_STATEMENT') {
      return false;
    }
    this.transitionRecord = null;
    this.bump({ reconciliationMode: 'STATEMENT' });
    return true;
  }

  private assertCanReconcile(): void {
    if (this.state.status !== 'CLEARED') {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        `only CLEARED transactions can be reconciled, this one is ${this.state.status}`,
      );
    }
    assertTransition('CLEARED', 'RECONCILED');
  }

  /** `RECONCILED → CLEARED` con motivo obligatorio (TC-TRANSACTIONS-RECONCILED-003); limpia el modo (D74). */
  unreconcile(reason: string): void {
    if (reason.trim().length === 0) throw validation('reason is required', '/reason');
    assertText(reason, 500, '/reason');
    if (this.state.status !== 'RECONCILED') {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'only RECONCILED transactions can be un-reconciled');
    }
    assertTransition('RECONCILED', 'CLEARED', { unreconcile: true });
    this.mark('UNRECONCILE', 'RECONCILED', 'CLEARED', null, null);
    this.bump({ status: 'CLEARED', reconciliationMode: null });
  }

  /**
   * Anulación (FR-TRANSACTIONS-010): PENDING sin asiento; POSTED/CLEARED requieren reversa del asiento activo
   * (devuelto en `entryToReverse`). RECONCILED ⇒ `TRANSACTION_RECONCILED`; VOIDED ⇒ `INVALID_STATUS_TRANSITION`.
   */
  void(
    reason: string,
    voidedAt: string,
  ): { previousStatus: TransactionStatus; entryToReverse: string | null } {
    if (reason.trim().length === 0) throw validation('reason is required', '/reason');
    assertText(reason, 500, '/reason');
    const previousStatus = this.state.status;
    assertTransition(previousStatus, 'VOIDED');
    this.mark('VOID', previousStatus, 'VOIDED', null, null);
    const entryToReverse = this.state.activeEntryId;
    this.bump({ status: 'VOIDED', activeEntryId: null, voidedAt, voidReason: reason.trim() });
    return { previousStatus, entryToReverse };
  }

  /**
   * Edición (design.md decisión 5). Financiera (monto, fecha, cuenta, montos/estructura de splits) ⇒ revisión + 1 y
   * `ledgerImpact` (reversa + nuevo asiento); un CLEARED vuelve a POSTED; RECONCILED ⇒ `TRANSACTION_RECONCILED`.
   * Descriptiva o de clasificación ⇒ in situ, sin ledger (INV-033).
   */
  amend(changes: TransactionChanges): AmendResult {
    const s = this.state;
    const previousStatus = s.status;
    const previousEntryId = s.activeEntryId;
    if (s.status === 'VOIDED') {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'a voided transaction cannot be edited');
    }
    assertText(changes.description, 500, '/description');
    assertText(changes.notes, 4000, '/notes');
    // Administradas (préstamos): solo cambios descriptivos; lo financiero se opera desde DEBT (decisión 10).
    assertManagedEditAllowed(s, {
      ...(changes.businessDate !== undefined ? { businessDate: changes.businessDate } : {}),
      ...(changes.account ? { accountId: changes.account.accountId } : {}),
      ...(changes.toAccount !== undefined ? { toAccount: changes.toAccount } : {}),
      ...(changes.amount !== undefined ? { amount: changes.amount } : {}),
      ...(changes.splits !== undefined ? { splits: changes.splits } : {}),
    });
    const changed: ChangedField[] = [];
    let next: TransactionState = { ...s };
    for (const field of ['description', 'notes', 'counterpartyId', 'postingDate', 'paymentMethod'] as const) {
      const value = changes[field];
      if (value !== undefined && value !== s[field]) {
        next = { ...next, [field]: value };
        changed.push(field);
      }
    }
    let financial = false;
    if (changes.businessDate !== undefined && changes.businessDate !== s.businessDate) {
      next = { ...next, businessDate: changes.businessDate };
      changed.push('businessDate');
      financial = true;
    }
    const isTransfer = s.kind === 'TRANSFER';
    let nature = s.legs[0]?.nature ?? 'ASSET';
    if (changes.account && changes.account.accountId !== s.accountId) {
      nature = changes.account.nature;
      next = { ...next, accountId: changes.account.accountId };
      changed.push('accountId');
      financial = true;
    }
    const currentTarget = s.legs.find((l) => l.role === 'TARGET');
    let target: TransferAccount | null = currentTarget
      ? { accountId: currentTarget.accountId, nature: currentTarget.nature, currency: s.amount.currency.code }
      : null;
    if (changes.toAccount !== undefined) {
      if (!isTransfer || !target) throw validation('toAccountId only applies to TRANSFER', '/toAccountId');
      if (changes.toAccount.accountId !== target.accountId) {
        changed.push('toAccountId');
        financial = true;
      }
      target = changes.toAccount;
    }
    const accountCurrency = changes.account?.currency ?? s.amount.currency.code;
    let amount = s.amount;
    if (changes.amount !== undefined && !changes.amount.equals(s.amount)) {
      if (!changes.amount.isPositive()) {
        throw new DomainError('AMOUNT_NOT_POSITIVE', 'amount must be > 0').at('/amount/amount');
      }
      amount = changes.amount;
      changed.push('amount');
      financial = true;
    }
    if (s.kind === 'CONVERSION' && financial) {
      // Montos, cuentas y fecha de una conversión cambian solo con `amendConversion` (reversa + detalle nuevo, D11).
      throw validation('use amendConversion (PUT /conversions/{id}) to change a conversion', '');
    }
    if (isTransfer && target) {
      assertTransferAccounts(
        { accountId: next.accountId, nature, currency: accountCurrency },
        target,
        amount,
      );
    }
    if (amount.currency.code !== accountCurrency) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `the account is in ${accountCurrency}, not ${amount.currency.code}`,
      ).at(changes.amount ? '/amount/currency' : '/accountId');
    }
    next = { ...next, amount };
    let classificationChanges: SplitClassificationChange[] = [];
    let splitsReplaced = false;
    if (changes.splits !== undefined) {
      if (!hasNominalSplits(s.kind)) throw validation('ADJUSTMENT does not accept splits', '/splits');
      const sameShape =
        changes.splits.length === s.splits.length &&
        changes.splits.every((n, i) => s.splits[i] !== undefined && n.amount.equals(s.splits[i].amount));
      if (sameShape && !financial) {
        // Solo clasificación: conserva los ids de split (los postings los siguen referenciando, INV-033).
        const reclassified = changes.splits.map((n, i) => {
          const old = s.splits[i] as Split;
          assertText(n.memo, 500, `/splits/${i}/memo`);
          return {
            ...old,
            categoryId: n.categoryId,
            counterpartyId: n.counterpartyId ?? null,
            tagIds: [...new Set(n.tagIds ?? [])],
            memo: n.memo ?? null,
            customFields: n.customFields === undefined ? old.customFields : sortedValues(n.customFields),
          };
        });
        classificationChanges = reclassified.flatMap((n, i) => {
          const old = s.splits[i] as Split;
          const added = n.tagIds.filter((t) => !old.tagIds.includes(t));
          const removed = old.tagIds.filter((t) => !n.tagIds.includes(t));
          if (n.categoryId === old.categoryId && added.length === 0 && removed.length === 0) return [];
          return [
            {
              splitId: n.id,
              amount: n.amount,
              previousCategoryId: old.categoryId,
              newCategoryId: n.categoryId,
              addedTagIds: added,
              removedTagIds: removed,
            },
          ];
        });
        const memoOrCounterparty = reclassified.some(
          (n, i) =>
            n.memo !== (s.splits[i] as Split).memo ||
            n.counterpartyId !== (s.splits[i] as Split).counterpartyId,
        );
        if (classificationChanges.length > 0 || memoOrCounterparty) changed.push('splits');
        next = { ...next, splits: reclassified };
      } else if (isTransfer || s.kind === 'CONVERSION') {
        throw validation(
          `the fee split of a ${s.kind} cannot be restructured here; use its own amend operation`,
          '/splits',
        );
      } else {
        // Al regenerar los splits, los valores de custom fields se copian a los nuevos que conservan su posición
        // (design decisión 2); los splits reemplazados conservan los suyos como historia.
        next = {
          ...next,
          splits: buildSplits(
            s.kind,
            amount,
            changes.splits.map((n, i) => ({
              ...n,
              customFields: n.customFields === undefined ? (s.splits[i]?.customFields ?? []) : n.customFields,
            })),
            { categoryId: null, splitId: undefined },
          ),
        };
        changed.push('splits');
        financial = true;
        splitsReplaced = true;
      }
    } else if (financial && changed.includes('amount') && hasNominalSplits(s.kind) && !isTransfer) {
      if (s.splits.length !== 1) {
        // Cambiar el monto de una transacción dividida exige reenviar los splits (no se reparte en silencio).
        assertSplitsSum(amount, s.splits);
      }
      const only = s.splits[0] as Split;
      next = { ...next, splits: [{ ...only, amount }] };
    }
    // Custom fields: metadatos sin impacto contable (INV-033); un cambio es una edición descriptiva.
    const customFieldChanges = diffCustomFields(s.splits, next.splits);
    if (customFieldChanges.length > 0) changed.push('customFields');
    if (changed.length === 0) {
      return {
        changedFields: [],
        customFieldChanges: [],
        ledgerImpact: false,
        classificationChanges: [],
        previousStatus,
        previousEntryId,
      };
    }
    if (financial && s.status === 'RECONCILED') {
      throw new DomainError(
        'TRANSACTION_RECONCILED',
        'a reconciled transaction must be un-reconciled before a financial change',
      );
    }
    const ledgerImpact = financial && hasActiveEntry(s.status);
    if (financial) {
      next = {
        ...next,
        legs:
          isTransfer && target
            ? transferLegs(
                { accountId: next.accountId, nature, currency: accountCurrency },
                target,
                amount,
                transferFee(next),
              )
            : [
                {
                  accountId: next.accountId,
                  nature,
                  amount: legAmount(s.kind, nature, amount, s.direction),
                  role: 'MAIN',
                },
              ],
      };
      if (ledgerImpact) {
        next = {
          ...next,
          revision: s.revision + 1,
          status: s.status === 'CLEARED' ? 'POSTED' : s.status,
          activeEntryId: null,
        };
      }
    }
    if (splitsReplaced || (financial && ledgerImpact)) this.replacedSplits = true;
    this.state = { ...next, version: s.version + 1 };
    if (ledgerImpact) this.mark('REVISE', previousStatus, this.state.status, s.revision, this.state.revision);
    if (this.state.status !== previousStatus) changed.push('status');
    return {
      changedFields: changed,
      customFieldChanges,
      ledgerImpact,
      classificationChanges,
      previousStatus,
      previousEntryId,
    };
  }

  /**
   * Edición masiva de UNA transacción (openspec add-bulk-edit): cambios descriptivos/de clasificación (`amend` sin
   * efecto financiero, INV-033) y, opcionalmente, `cleared` (`POSTED ↔ CLEARED`, mismas reglas que
   * `SetClearedStatus`). Combina ambos en UNA sola versión nueva. `statusChanged` y `previousStatus` informan la
   * transición; si nada cambió la transacción queda intacta (sin versión nueva).
   */
  bulkEdit(
    changes: TransactionChanges,
    cleared?: boolean,
  ): AmendResult & { readonly statusChanged: boolean; readonly statusPrevious: TransactionStatus | null } {
    const startVersion = this.state.version;
    const from = this.state.status;
    if (cleared !== undefined) {
      if (from === 'RECONCILED') {
        throw new DomainError('TRANSACTION_RECONCILED', `transaction ${this.state.id} is reconciled`);
      }
      const target = cleared ? 'CLEARED' : 'POSTED';
      if (from !== (cleared ? 'POSTED' : 'CLEARED')) {
        throw new DomainError(
          'INVALID_STATUS_TRANSITION',
          `transaction ${this.state.id} is ${from}, cannot become ${target}`,
        );
      }
    }
    const result = this.amend(changes);
    let statusPrevious: TransactionStatus | null = null;
    if (cleared !== undefined) statusPrevious = this.changeStatus(cleared ? 'CLEARED' : 'POSTED');
    const statusChanged = statusPrevious !== null;
    if (result.changedFields.length > 0 || statusChanged) {
      this.state = { ...this.state, version: startVersion + 1 };
    }
    return { ...result, statusChanged, statusPrevious };
  }

  /** Valida el paso contra la máquina declarada y lo deja como `lastTransition` (una sola fuente de reglas). */
  private mark(
    code: TransactionTransition,
    from: TransactionStatus | null,
    to: TransactionStatus,
    revisionFrom: number | null,
    revisionTo: number | null,
  ): void {
    this.transitionRecord = { ...TRANSACTION_LIFECYCLE.transition(code, from, to), revisionFrom, revisionTo };
  }

  /** Mutación con `version + 1` (optimistic locking). */
  private bump(patch: Partial<TransactionState>): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
  }
}
