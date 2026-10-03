import { DomainError, Money } from '@pf/shared-kernel';
import { assertTransition, hasActiveEntry, type TransactionStatus } from './transaction-status.js';

/** Kinds de este change (transfers/conversions/opening los agregan otros changes sobre el mismo agregado). */
export const TRANSACTION_KINDS = ['INCOME', 'EXPENSE', 'REFUND', 'ADJUSTMENT'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
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

export interface ExternalRef {
  readonly namespace: string;
  readonly id: string;
}

/** Porción nominal de la transacción (FR-TRANSACTIONS-026): magnitud positiva; la dirección la da `kind`. */
export interface Split {
  readonly id: string;
  readonly amount: Money;
  readonly categoryId: string;
  readonly counterpartyId: string | null;
  readonly tagIds: readonly string[];
  readonly memo: string | null;
}

export interface SplitInput {
  readonly id: string;
  readonly amount: Money;
  readonly categoryId: string;
  readonly counterpartyId?: string | null;
  readonly tagIds?: readonly string[];
  readonly memo?: string | null;
}

/** Movimiento sobre una cuenta del usuario con signo contable (débito +, crédito −; docs/09 §3). */
export interface Leg {
  readonly accountId: string;
  readonly nature: AccountNature;
  readonly amount: Money;
  readonly role: 'MAIN';
}

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
  readonly legs: readonly Leg[];
  readonly splits: readonly Split[];
  readonly revision: number;
  readonly version: number;
  readonly activeEntryId: string | null;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

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
  | 'splits';

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

  private constructor(state: TransactionState, persistedVersion: number | null) {
    this.state = state;
    this.persistedVersion = persistedVersion;
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
    this.bump({ status: 'POSTED' });
  }

  /** `POSTED ↔ CLEARED`, `CLEARED → RECONCILED` sin tocar el ledger (transactions/reconciliation Phase 1). */
  changeStatus(to: 'POSTED' | 'CLEARED' | 'RECONCILED'): TransactionStatus {
    const from = this.state.status;
    if (from === to) return from;
    if (from === 'PENDING') {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'use postTransaction to post a PENDING transaction');
    }
    assertTransition(from, to);
    this.bump({ status: to });
    return from;
  }

  /** `RECONCILED → CLEARED` con motivo obligatorio (TC-TRANSACTIONS-RECONCILED-003). */
  unreconcile(reason: string): void {
    if (reason.trim().length === 0) throw validation('reason is required', '/reason');
    assertText(reason, 500, '/reason');
    if (this.state.status !== 'RECONCILED') {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'only RECONCILED transactions can be un-reconciled');
    }
    assertTransition('RECONCILED', 'CLEARED', { unreconcile: true });
    this.bump({ status: 'CLEARED' });
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
    let nature = s.legs[0]?.nature ?? 'ASSET';
    if (changes.account && changes.account.accountId !== s.accountId) {
      nature = changes.account.nature;
      next = { ...next, accountId: changes.account.accountId };
      changed.push('accountId');
      financial = true;
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
      } else {
        next = {
          ...next,
          splits: buildSplits(s.kind, amount, changes.splits, { categoryId: null, splitId: undefined }),
        };
        changed.push('splits');
        financial = true;
        splitsReplaced = true;
      }
    } else if (financial && changed.includes('amount') && hasNominalSplits(s.kind)) {
      if (s.splits.length !== 1) {
        // Cambiar el monto de una transacción dividida exige reenviar los splits (no se reparte en silencio).
        assertSplitsSum(amount, s.splits);
      }
      const only = s.splits[0] as Split;
      next = { ...next, splits: [{ ...only, amount }] };
    }
    if (changed.length === 0) {
      return {
        changedFields: [],
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
        legs: [
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
    if (this.state.status !== previousStatus) changed.push('status');
    return { changedFields: changed, ledgerImpact, classificationChanges, previousStatus, previousEntryId };
  }

  /** Mutación con `version + 1` (optimistic locking). */
  private bump(patch: Partial<TransactionState>): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
  }
}
