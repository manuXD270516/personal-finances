import type {
  AuditChangeInput,
  AuditEntry,
  AuditLogEntryDto,
  AuditPort,
  LifecycleDto,
  LifecycleEventRefDto,
} from '@pf/audit/contracts';
import type { CustomFieldValueInputDto } from '@pf/classification/contracts';
import { currency as makeCurrency, DomainError, Money, type FieldViolation } from '@pf/shared-kernel';
import { RECURRING_OCCURRENCE_NAMESPACE, TRANSACTION_EVENTS } from '../contracts/index.js';
import {
  assertRefundAllowed,
  diffCustomFields,
  DUPLICATE_WINDOW_DAYS,
  findDuplicates,
  normalizeText,
  splitKindOf,
  Transaction,
  transferFee,
  type AdjustmentDirection,
  type ChangedField,
  type ConversionDetail,
  type CustomFieldChange,
  type CustomFieldValue,
  type Split,
  type LegRole,
  type ExternalRef,
  type PaymentMethod,
  type SplitClassificationChange,
  type SplitInput,
  type TransactionChanges,
  type TransactionKind,
  type TransactionSource,
  type TransactionState,
  type TransactionStatus,
} from '../domain/index.js';
import {
  legsPayload,
  linkEntry,
  postEntry,
  publishEvent,
  publishPosted,
  splitsAudit,
  splitsPayload,
  transactionSteps,
  type RevisionPosting,
} from './posting-support.js';
import type { TransactionListFilter, TransactionsDeps, TransactionSort } from './ports/index.js';

export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export interface SplitDto {
  readonly amount: MoneyDto;
  readonly categoryId: string;
  readonly counterpartyId?: string | null;
  readonly tagIds?: readonly string[];
  readonly memo?: string | null;
  /**
   * Cambios de custom fields del split (por `fieldId` o `key`; `value: null` quita): fijan o quitan SOLO los campos
   * mencionados; los demás conservan su valor (en una edición, el del split actual en la misma posición).
   */
  readonly customFields?: readonly CustomFieldValueInputDto[];
}

export interface RecordTransactionCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly id?: string;
  readonly kind: TransactionKind;
  readonly status?: 'PENDING' | 'POSTED' | 'CLEARED';
  readonly transactionDate: string;
  readonly postingDate?: string | null;
  readonly accountId: string;
  readonly amount: MoneyDto;
  readonly direction?: AdjustmentDirection | null;
  readonly description?: string | null;
  readonly notes?: string | null;
  readonly counterpartyId?: string | null;
  readonly paymentMethod?: PaymentMethod | null;
  readonly source?: TransactionSource;
  readonly externalRef?: ExternalRef | null;
  /** Importación que crea la transacción (`source = IMPORT`, add-basic-csv-import). */
  readonly importJobId?: string | null;
  readonly refundOfTransactionId?: string | null;
  readonly confirmRefundExceedsOriginal?: boolean;
  readonly reason?: string | null;
  readonly splits?: readonly SplitDto[];
}

/** `RecordTransfer` (add-transfers): fachada `POST W/transfers` sobre el agregado `Transaction`. */
export interface RecordTransferCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly id?: string;
  readonly status?: 'PENDING' | 'POSTED' | 'CLEARED';
  readonly transactionDate: string;
  readonly postingDate?: string | null;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount: MoneyDto;
  readonly fee?: { readonly amount: MoneyDto; readonly categoryId?: string | null } | null;
  readonly description?: string | null;
  readonly notes?: string | null;
  readonly paymentMethod?: PaymentMethod | null;
  readonly source?: TransactionSource;
  readonly externalRef?: ExternalRef | null;
}

export interface UpdateTransactionCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly transactionId: string;
  readonly expectedVersion: number;
  readonly transactionDate?: string;
  readonly postingDate?: string | null;
  readonly accountId?: string;
  /** Solo `TRANSFER`: nueva cuenta destino. */
  readonly toAccountId?: string;
  readonly amount?: MoneyDto;
  readonly description?: string | null;
  readonly notes?: string | null;
  readonly counterpartyId?: string | null;
  readonly paymentMethod?: PaymentMethod | null;
  readonly status?: 'POSTED' | 'CLEARED' | 'RECONCILED';
  /**
   * Obligatorio (y solo aceptado) con `status = RECONCILED`: el marcado directo exige el modo explícito
   * `WITHOUT_STATEMENT` (docs/33 D74); cualquier otro valor ⇒ `VALIDATION_FAILED`.
   */
  readonly reconciliationMode?: string;
  readonly splits?: readonly SplitDto[];
}

/** Sesión de reconciliación en cuyo nombre se confirman transacciones (add-reconciliation decisión 2). */
export interface ClearedSessionContext {
  readonly reconciliationId: string;
  readonly accountId: string;
  readonly statementDate: string;
}

/** Montos de una revisión para el recorrido (add-lifecycle-timeline decisión 7; transfers y conversions). */
export interface TransactionRevisionView {
  readonly revision: number;
  /** Monto de la revisión (en una transferencia, lo transferido sin la comisión). */
  readonly amount: Money;
  /** Comisión de una transferencia (Σ split de comisión); `null` si no hay. */
  readonly fee: Money | null;
  readonly legs: readonly { readonly accountId: string; readonly role: LegRole; readonly amount: Money }[];
  /** Detalle de conversión de la revisión (D11), `null` si no es conversión. */
  readonly conversion: ConversionDetail | null;
}

/** Sesión a la que enlaza el recorrido de una transacción (fecha y saldo del extracto, TC-AUDIT-LIFECYCLE-026). */
export interface TransactionReconciliationRef {
  readonly reconciliationId: string;
  readonly accountId: string;
  readonly statementDate: string;
  readonly statementBalance: Money;
}

export interface TransactionLifecycleView {
  readonly lifecycle: LifecycleDto;
  readonly revisions: readonly TransactionRevisionView[];
  /** Sesiones referenciadas por las transiciones/anotaciones (`detailRefs.reconciliationId`). */
  readonly reconciliations: readonly TransactionReconciliationRef[];
}

export interface TransactionWarning {
  readonly code: 'POSSIBLE_DUPLICATE';
  readonly transactionIds: readonly string[];
  readonly detail: string;
}

export interface DuplicateCheckQuery {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly amount: MoneyDto;
  readonly transactionDate: string;
  readonly description?: string | null;
  readonly counterpartyId?: string | null;
  readonly excludeTransactionId?: string | null;
}

export interface ListTransactionsQuery extends Omit<TransactionListFilter, 'q' | 'sort'> {
  readonly workspaceId: string;
  readonly q?: string;
  readonly sort?: TransactionSort;
  readonly offset: number;
  readonly limit: number;
}

const MAX_BULK = 500;
/**
 * `origin.refId` de `TransactionCreated.v1`: la ocurrencia recurrente que originó la transacción (add-recurrence-engine)
 * o la importación que la creó (add-basic-csv-import).
 */
const recurringRefOf = (s: {
  readonly source: string;
  readonly importJobId?: string | null;
  readonly externalRef: { readonly namespace: string; readonly id: string } | null;
}): string | null =>
  s.source === 'RECURRING' && s.externalRef?.namespace === RECURRING_OCCURRENCE_NAMESPACE
    ? s.externalRef.id
    : s.source === 'IMPORT'
      ? (s.importJobId ?? null)
      : null;

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `transaction ${id} not found`);
/** 412 con la versión vigente (`currentVersion`, docs/10 §6). */
const preconditionFailed = (currentVersion: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    details: { currentVersion },
  });
const concurrencyConflict = () =>
  new DomainError('CONCURRENCY_CONFLICT', 'the transaction was modified concurrently');
export const UPDATED_EVENT_FIELDS: ReadonlySet<ChangedField> = new Set([
  'customFields',
  'description',
  'notes',
  'counterpartyId',
  'postingDate',
  'status',
  'amount',
  'businessDate',
  'accountId',
  'splits',
  'reconciliationMode',
]);

/**
 * Casos de uso de TRANSACTIONS (design.md decisiones 1–13). Cada comando corre en UNA unidad de trabajo:
 * validación cross-context (Accounts `FOR SHARE`, Classification) → agregado → `LedgerPostingPort` (mismo
 * `BEGIN…COMMIT`, ARCHITECTURE §7) → persistencia con optimistic locking → outbox → `AuditPort` (INV-029). Si
 * cualquier paso falla, nada se persiste (TC-TRANSACTIONS-POSTING-001).
 */
export class TransactionsService {
  constructor(
    private readonly deps: TransactionsDeps,
    private readonly audit: AuditPort = deps.audit,
  ) {}

  // ------------------------------------------------------------------ comandos

  /** `RecordTransaction` / `RecordRefund` / `RecordAdjustment` (+ `warnings[]` de duplicados si `source = MANUAL`). */
  recordTransaction(
    cmd: RecordTransactionCommand,
  ): Promise<{ readonly transaction: TransactionState; readonly warnings: readonly TransactionWarning[] }> {
    const { uow, transactions, ids } = this.deps;
    return uow.run(cmd.workspaceId, async () => {
      const [eligibility] = await this.deps.accounts.assertCanPost({
        workspaceId: cmd.workspaceId,
        accounts: [{ accountId: cmd.accountId, currency: cmd.amount.currency }],
      });
      if (!eligibility) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/accountId');
      const amount = await this.parseMoney(cmd.amount, '/amount');
      let splits = cmd.splits ? await this.parseSplits(cmd.splits) : undefined;
      await this.validateClassification(
        cmd.userId,
        cmd.workspaceId,
        cmd.kind,
        cmd.splits,
        cmd.counterpartyId,
      );
      // Custom fields por split (FR-TRANSACTIONS-026): obligatorios en cada split de una transacción nueva.
      const customFields = await this.resolveCustomFields({
        userId: cmd.userId,
        workspaceId: cmd.workspaceId,
        kind: cmd.kind,
        splits: cmd.splits,
        current: null,
        requireMandatory: true,
      });
      if (splits && customFields)
        splits = splits.map((x, i) => ({ ...x, customFields: customFields[i] ?? [] }));
      let confirmedExcess = false;
      let defaultCategoryId: string | null = null;
      if (cmd.kind === 'REFUND' && cmd.refundOfTransactionId) {
        const original = await transactions.findById(cmd.workspaceId, cmd.refundOfTransactionId, {
          forUpdate: true,
        });
        const refunded = await transactions.refundedTotal(cmd.workspaceId, cmd.refundOfTransactionId);
        const { exceeds } = assertRefundAllowed({
          original: original?.snapshot ?? null,
          alreadyRefunded: Money.parse(refunded, amount.currency),
          amount,
          confirmExcess: cmd.confirmRefundExceedsOriginal ?? false,
        });
        confirmedExcess = exceeds;
        // Sin splits: el reembolso acredita la misma categoría del gasto (docs/09 §6.5).
        defaultCategoryId = original?.snapshot.splits[0]?.categoryId ?? null;
      }
      if (!splits && cmd.kind !== 'ADJUSTMENT' && !defaultCategoryId) {
        defaultCategoryId = await this.deps.categories.uncategorized(
          cmd.workspaceId,
          cmd.kind === 'INCOME' ? 'INCOME' : 'EXPENSE',
        );
      }
      // D69 (transactions/transaction-recording): una PENDING no entra en un periodo cerrado (no genera asiento, así
      // que el ledger no la frena). Las posteadas las rechaza el ledger al postear.
      if ((cmd.status ?? 'POSTED') === 'PENDING') {
        await this.deps.ledger.assertPeriodOpen({
          workspaceId: cmd.workspaceId,
          date: cmd.transactionDate,
        });
      }
      const tx = Transaction.record({
        id: cmd.id ?? ids.next(),
        workspaceId: cmd.workspaceId,
        kind: cmd.kind,
        status: cmd.status ?? 'POSTED',
        businessDate: cmd.transactionDate,
        postingDate: cmd.postingDate ?? null,
        accountId: cmd.accountId,
        accountNature: eligibility.nature,
        accountCurrency: eligibility.currency,
        amount,
        direction: cmd.direction ?? null,
        description: cmd.description ?? null,
        notes: cmd.notes ?? null,
        counterpartyId: cmd.counterpartyId ?? null,
        paymentMethod: cmd.paymentMethod ?? null,
        source: cmd.source ?? 'MANUAL',
        externalRef: cmd.externalRef ?? null,
        importJobId: cmd.importJobId ?? null,
        refundOfTransactionId: cmd.refundOfTransactionId ?? null,
        reason: cmd.reason ?? null,
        confirmedRefundExcess: confirmedExcess,
        ...(splits ? { splits } : {}),
        defaultCategoryId,
        defaultSplitId: ids.next(),
      });
      const warnings =
        (cmd.source ?? 'MANUAL') === 'MANUAL'
          ? await this.duplicateWarnings(tx.snapshot)
          : ([] as TransactionWarning[]);
      let entryId: string | null = null;
      if (tx.needsEntry) {
        entryId = await this.postEntry(tx);
        tx.attachEntry(entryId);
      }
      await transactions.insert(tx);
      if (entryId) await this.link(tx, entryId, 'POSTED');
      const s = tx.snapshot;
      const events: LifecycleEventRefDto[] = [
        await this.publish(tx, TRANSACTION_EVENTS.created, {
          transactionId: s.id,
          kind: s.kind,
          status: s.status,
          businessDate: s.businessDate,
          description: s.description,
          counterpartyId: s.counterpartyId,
          origin: { type: s.source, refId: recurringRefOf(s) },
          legs: legsPayload(s),
          splits: splitsPayload(s),
          postingDate: s.postingDate,
          refundOfTransactionId: s.refundOfTransactionId,
          paymentMethod: s.paymentMethod,
          transition: 'RECORD',
        }),
      ];
      if (entryId) events.push(...(await this.publishPosted(tx, entryId, null, null)));
      const changes: AuditChangeInput[] = [
        { field: 'kind', before: null, after: s.kind },
        { field: 'status', before: null, after: s.status },
        { field: 'transactionDate', before: null, after: s.businessDate },
        { field: 'accountId', before: null, after: s.accountId },
        { field: 'amount', before: null, after: s.amount },
        { field: 'splits', before: null, after: splitsAudit(s) },
      ];
      for (const f of ['description', 'notes', 'counterpartyId', 'paymentMethod', 'postingDate'] as const) {
        if (s[f] !== null) changes.push({ field: f, before: null, after: s[f] });
      }
      changes.push(...customFieldAudit(diffCustomFields([], s.splits)));
      if (s.refundOfTransactionId) {
        changes.push({ field: 'refundOfTransactionId', before: null, after: s.refundOfTransactionId });
        if (s.confirmedRefundExcess)
          changes.push({ field: 'confirmedRefundExcess', before: null, after: true });
      }
      if (s.kind === 'ADJUSTMENT') {
        changes.push({ field: 'adjustmentDirection', before: null, after: s.direction });
        changes.push({ field: 'adjustmentReason', before: null, after: s.adjustmentReason });
      }
      if (entryId) changes.push({ field: 'journalEntryId', before: null, after: entryId });
      await this.record(
        tx,
        {
          workspaceId: s.workspaceId,
          action: 'transactions.transaction.created',
          aggregateType: 'Transaction',
          aggregateId: s.id,
          aggregateVersion: s.version,
          changes,
          reason: s.adjustmentReason,
        },
        { events, journalEntries: { posted: entryId } },
      );
      // Releer la fila: `created_at` lo fija la base al insertar; sin esto el 201 llevaba `createdAt` nulo,
      // presentado como 1970-01-01 (regresión en transactions.api.test.ts, TC-TRANSACTIONS-FIELDS-001).
      return { transaction: ((await transactions.findById(s.workspaceId, s.id)) ?? tx).snapshot, warnings };
    });
  }

  /**
   * `RecordTransfer` (add-transfers design.md decisiones 1–5): misma unidad de trabajo que `RecordTransaction`
   * (Accounts `FOR SHARE` con INV-026 → agregado → ledger → persistencia → outbox → auditoría). Cuentas iguales ⇒
   * `TRANSFER_SAME_ACCOUNT`; monedas distintas ⇒ `TRANSFER_CURRENCY_MISMATCH` (orienta a conversión).
   */
  recordTransfer(cmd: RecordTransferCommand): Promise<TransactionState> {
    const { uow, ids } = this.deps;
    return uow.run(cmd.workspaceId, async () => {
      if (cmd.fromAccountId === cmd.toAccountId) {
        throw new DomainError('TRANSFER_SAME_ACCOUNT', 'source and destination are the same account').at(
          '/toAccountId',
        );
      }
      const [from, to] = await this.deps.accounts.assertCanPost({
        workspaceId: cmd.workspaceId,
        accounts: [{ accountId: cmd.fromAccountId }, { accountId: cmd.toAccountId }],
      });
      if (!from) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/fromAccountId');
      if (!to) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/toAccountId');
      const amount = await this.parseMoney(cmd.amount, '/amount');
      let fee: { amount: Money; categoryId: string; splitId: string } | null = null;
      if (cmd.fee) {
        const feeAmount = await this.parseMoney(cmd.fee.amount, '/fee/amount');
        let categoryId = cmd.fee.categoryId ?? null;
        if (categoryId) {
          await this.deps.classification.validate({
            userId: cmd.userId,
            workspaceId: cmd.workspaceId,
            categoryIds: [{ categoryId, splitKind: 'EXPENSE' }],
          });
        } else {
          categoryId = await this.deps.categories.fees(cmd.workspaceId);
          if (!categoryId) {
            throw new DomainError('REFERENCE_NOT_FOUND', 'system category Fees is not provisioned').at(
              '/fee/categoryId',
            );
          }
        }
        fee = { amount: feeAmount, categoryId, splitId: ids.next() };
      }
      if ((cmd.status ?? 'POSTED') === 'PENDING') {
        await this.deps.ledger.assertPeriodOpen({
          workspaceId: cmd.workspaceId,
          date: cmd.transactionDate,
        });
      }
      const tx = Transaction.recordTransfer({
        id: cmd.id ?? ids.next(),
        workspaceId: cmd.workspaceId,
        status: cmd.status ?? 'POSTED',
        businessDate: cmd.transactionDate,
        postingDate: cmd.postingDate ?? null,
        from: { accountId: from.accountId, nature: from.nature, currency: from.currency },
        to: { accountId: to.accountId, nature: to.nature, currency: to.currency },
        amount,
        fee,
        description: cmd.description ?? null,
        notes: cmd.notes ?? null,
        paymentMethod: cmd.paymentMethod ?? null,
        source: cmd.source ?? 'MANUAL',
        externalRef: cmd.externalRef ?? null,
      });
      let entryId: string | null = null;
      if (tx.needsEntry) {
        entryId = await this.postEntry(tx);
        tx.attachEntry(entryId);
      }
      await this.deps.transactions.insert(tx);
      if (entryId) await this.link(tx, entryId, 'POSTED');
      const s = tx.snapshot;
      const events: LifecycleEventRefDto[] = [
        await this.publish(tx, TRANSACTION_EVENTS.created, {
          transactionId: s.id,
          kind: s.kind,
          status: s.status,
          businessDate: s.businessDate,
          description: s.description,
          counterpartyId: s.counterpartyId,
          origin: { type: s.source, refId: recurringRefOf(s) },
          legs: legsPayload(s),
          splits: splitsPayload(s),
          postingDate: s.postingDate,
          refundOfTransactionId: null,
          paymentMethod: s.paymentMethod,
          transition: 'RECORD',
        }),
      ];
      if (entryId) events.push(...(await this.publishPosted(tx, entryId, null, null)));
      const changes: AuditChangeInput[] = [
        { field: 'kind', before: null, after: s.kind },
        { field: 'status', before: null, after: s.status },
        { field: 'transactionDate', before: null, after: s.businessDate },
        { field: 'accountId', before: null, after: s.accountId },
        { field: 'toAccountId', before: null, after: to.accountId },
        { field: 'amount', before: null, after: s.amount },
      ];
      const feeMoney = transferFee(s);
      if (feeMoney) changes.push({ field: 'fee', before: null, after: feeMoney });
      if (s.splits.length > 0) changes.push({ field: 'splits', before: null, after: splitsAudit(s) });
      for (const f of ['description', 'notes', 'paymentMethod', 'postingDate'] as const) {
        if (s[f] !== null) changes.push({ field: f, before: null, after: s[f] });
      }
      if (entryId) changes.push({ field: 'journalEntryId', before: null, after: entryId });
      await this.record(
        tx,
        {
          workspaceId: s.workspaceId,
          action: 'transactions.transfer.created',
          aggregateType: 'Transaction',
          aggregateId: s.id,
          aggregateVersion: s.version,
          changes,
        },
        { events, journalEntries: { posted: entryId } },
      );
      // Releer la fila: `created_at` lo fija la base al insertar (ver `recordTransaction`).
      return ((await this.deps.transactions.findById(s.workspaceId, s.id)) ?? tx).snapshot;
    });
  }

  /** `PostTransaction`: PENDING → POSTED creando el asiento (TC-TRANSACTIONS-PENDING-001). */
  postTransaction(
    workspaceId: string,
    transactionId: string,
    expectedVersion: number,
  ): Promise<TransactionState> {
    return this.deps.uow.run(workspaceId, async () => {
      const tx = await this.load(workspaceId, transactionId, expectedVersion);
      const previous = tx.status;
      tx.post();
      await this.assertAccounts(
        workspaceId,
        tx.snapshot.legs.map((l) => l.accountId),
      );
      const entryId = await this.postEntry(tx);
      tx.attachEntry(entryId);
      await this.save(tx);
      await this.link(tx, entryId, 'POSTED');
      const events = await this.publishPosted(tx, entryId, previous, null);
      await this.record(
        tx,
        {
          workspaceId,
          action: 'transactions.transaction.posted',
          aggregateType: 'Transaction',
          aggregateId: transactionId,
          aggregateVersion: tx.version,
          changes: [
            { field: 'status', before: previous, after: 'POSTED' },
            { field: 'journalEntryId', before: null, after: entryId },
          ],
        },
        { events, journalEntries: { posted: entryId } },
      );
      return tx.snapshot;
    });
  }

  /**
   * `AmendTransaction` / `ApplyClassification` / cambios de estado (`MarkReconciled`, cleared individual). Financiera
   * ⇒ reversa + revisión nueva; descriptiva/clasificación ⇒ in situ sin ledger (INV-033).
   */
  updateTransaction(cmd: UpdateTransactionCommand): Promise<TransactionState> {
    const { workspaceId } = cmd;
    return this.deps.uow.run(workspaceId, async () => {
      const financialKeys = ['transactionDate', 'accountId', 'toAccountId', 'amount', 'splits'] as const;
      if (cmd.status !== undefined && financialKeys.some((k) => cmd[k] !== undefined)) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'status changes cannot be combined with financial fields',
        ).at('/status');
      }
      // Marcado directo (docs/33 D74): `RECONCILED` exige el modo explícito `WITHOUT_STATEMENT` y ese modo solo se
      // acepta con `status = RECONCILED`; `STATEMENT` únicamente se alcanza finalizando una sesión.
      if (cmd.status === 'RECONCILED' && cmd.reconciliationMode !== 'WITHOUT_STATEMENT') {
        throw new DomainError(
          'VALIDATION_FAILED',
          'reconciling a transaction directly requires reconciliationMode WITHOUT_STATEMENT',
        ).at('/reconciliationMode');
      }
      if (cmd.reconciliationMode !== undefined && cmd.status !== 'RECONCILED') {
        throw new DomainError(
          'VALIDATION_FAILED',
          'reconciliationMode only applies together with status RECONCILED',
        ).at('/reconciliationMode');
      }
      const tx = await this.load(workspaceId, cmd.transactionId, cmd.expectedVersion);
      const before = tx.snapshot;
      const changes: { -readonly [K in keyof TransactionChanges]: TransactionChanges[K] } = {};
      if (cmd.transactionDate !== undefined) changes.businessDate = cmd.transactionDate;
      for (const f of ['postingDate', 'description', 'notes', 'counterpartyId', 'paymentMethod'] as const) {
        if (cmd[f] !== undefined) (changes as Record<string, unknown>)[f] = cmd[f];
      }
      let newAccountId: string | null = null;
      let newToAccountId: string | null = null;
      if (cmd.accountId !== undefined && cmd.accountId !== before.accountId) {
        const [target] = await this.deps.accounts.assertCanPost({
          workspaceId,
          accounts: [{ accountId: cmd.accountId }],
        });
        if (!target) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/accountId');
        changes.account = { accountId: target.accountId, nature: target.nature, currency: target.currency };
        newAccountId = target.accountId;
      }
      if (cmd.toAccountId !== undefined) {
        const [target] = await this.deps.accounts.assertCanPost({
          workspaceId,
          accounts: [{ accountId: cmd.toAccountId }],
        });
        if (!target) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/toAccountId');
        changes.toAccount = { accountId: target.accountId, nature: target.nature, currency: target.currency };
        newToAccountId = target.accountId;
      }
      if (cmd.amount !== undefined) changes.amount = await this.parseMoney(cmd.amount, '/amount');
      if (cmd.splits !== undefined) changes.splits = await this.parseSplits(cmd.splits);
      await this.validateClassification(cmd.userId, workspaceId, before.kind, cmd.splits, cmd.counterpartyId);
      if (cmd.splits !== undefined && changes.splits !== undefined) {
        // La obligatoriedad no es retroactiva (decisión 6): solo se exige al editar custom fields o al regenerar los
        // splits (cambia su cantidad o sus montos); una edición descriptiva o de clasificación no la dispara.
        const parsed = changes.splits;
        const reshaped =
          parsed.length !== before.splits.length ||
          parsed.some((x, i) => !x.amount.equals((before.splits[i] as Split).amount));
        const customFields = await this.resolveCustomFields({
          userId: cmd.userId,
          workspaceId,
          kind: before.kind,
          splits: cmd.splits,
          current: before.splits,
          requireMandatory: cmd.splits.some((x) => x.customFields !== undefined) || reshaped,
        });
        if (customFields) {
          changes.splits = parsed.map((x, i) => ({ ...x, customFields: customFields[i] ?? [] }));
        }
      }
      // INV-026: las cuentas de los legs deben estar activas antes de revertir/repostear.
      if (tx.needsEntry && financialKeys.some((k) => cmd[k] !== undefined)) {
        await this.assertAccounts(workspaceId, [
          ...before.legs.map((l) => l.accountId),
          ...(newAccountId ? [newAccountId] : []),
          ...(newToAccountId ? [newToAccountId] : []),
        ]);
      }
      const result = tx.amend(changes);
      // INV-015 (docs/31 D49): recategorizar no genera asiento, pero cambia lo reportado del mes; en un periodo cerrado
      // se rechaza con PERIOD_CLOSED (los cambios con asiento ya los rechaza el ledger, PF004).
      // Los custom fields de transacción siguen la misma regla (docs/33 D65, extensión de D49): un cambio en un periodo
      // cerrado se rechaza con PERIOD_CLOSED sin escribir valor ni auditoría (la UoW hace rollback).
      // Alcance de la edición en periodos cerrados (ADR-0028, planning/month-closing): además de categoría y custom
      // fields, cambian lo reportado los TAGS y la CONTRAPARTE (de la transacción o de algún split). Notas,
      // descripción, medio de pago, memo y adjuntos siguen permitidos.
      const afterAmend = tx.snapshot;
      const tagsChanged = result.classificationChanges.some(
        (c) => c.addedTagIds.length > 0 || c.removedTagIds.length > 0,
      );
      const counterpartyChanged =
        before.counterpartyId !== afterAmend.counterpartyId ||
        before.splits.some((s, i) => {
          const next = afterAmend.splits[i];
          return next !== undefined && next.id === s.id && next.counterpartyId !== s.counterpartyId;
        });
      if (
        result.classificationChanges.some((c) => c.previousCategoryId !== c.newCategoryId) ||
        result.customFieldChanges.length > 0 ||
        tagsChanged ||
        counterpartyChanged
      ) {
        await this.deps.ledger.assertPeriodOpen({ workspaceId, date: before.businessDate });
      }
      // D69: una PENDING (sin asiento) no puede quedar —ni seguir— con fecha de negocio en un periodo cerrado; se
      // evalúa la fecha RESULTANTE de la edición.
      if (before.status === 'PENDING' && result.changedFields.length > 0) {
        await this.deps.ledger.assertPeriodOpen({ workspaceId, date: afterAmend.businessDate });
      }
      let previousStatus: TransactionStatus | null = result.changedFields.includes('status')
        ? result.previousStatus
        : null;
      const changedFields = [...result.changedFields];
      if (cmd.status !== undefined && cmd.status !== tx.status) {
        // INV-015 (docs/33 D65, extensión de D49): cleared/unclear/conciliar no generan asiento pero cambian el estado
        // de conciliación que registró el cierre; en un periodo cerrado se rechazan con PERIOD_CLOSED.
        await this.deps.ledger.assertPeriodOpen({ workspaceId, date: before.businessDate });
        if (cmd.status === 'RECONCILED') {
          tx.reconcileWithoutStatement(cmd.reconciliationMode);
          previousStatus = 'CLEARED';
          changedFields.push('status', 'reconciliationMode');
        } else {
          previousStatus = tx.changeStatus(cmd.status);
          changedFields.push('status');
        }
      }
      if (changedFields.length === 0) return tx.snapshot;
      let newEntryId: string | null = null;
      let revision: RevisionPosting | null = null;
      if (result.ledgerImpact && result.previousEntryId) {
        const reversal = await this.deps.ledger.reverseJournalEntry({
          workspaceId,
          journalEntryId: result.previousEntryId,
          reverseDate: before.businessDate,
          reason: `transaction ${before.id} amended to revision ${tx.revision}`,
        });
        await this.deps.transactions.linkEntry({
          workspaceId,
          transactionId: before.id,
          revision: before.revision,
          journalEntryId: reversal.journalEntryId,
          linkType: 'REVERSAL',
        });
        revision = {
          revisionFrom: before.revision,
          reversedJournalEntryId: result.previousEntryId,
          reversalJournalEntryId: reversal.journalEntryId,
        };
        newEntryId = await this.postEntry(tx);
        tx.attachEntry(newEntryId);
      }
      await this.save(tx);
      if (newEntryId) await this.link(tx, newEntryId, 'POSTED');
      const after = tx.snapshot;
      const transition = tx.lastTransition?.transition;
      const events: LifecycleEventRefDto[] = [];
      if (transition === 'CLEAR' || transition === 'UNCLEAR') {
        events.push(await this.publishCleared(tx, previousStatus, null, null, transition));
      }
      const eventFields = changedFields.filter((f) => UPDATED_EVENT_FIELDS.has(f));
      if (eventFields.length > 0) {
        events.push(
          await this.publish(tx, TRANSACTION_EVENTS.updated, {
            transactionId: after.id,
            revision: after.revision,
            status: after.status,
            previousStatus,
            changedFields: [...new Set(eventFields)],
            ledgerImpact: result.ledgerImpact,
            reason: null,
            paymentMethod: after.paymentMethod,
            ...(transition ? { transition } : {}),
          }),
        );
      }
      if (newEntryId) {
        events.push(
          ...(await this.publishPosted(
            tx,
            newEntryId,
            result.previousStatus,
            result.previousEntryId,
            revision,
          )),
        );
      }
      if (result.classificationChanges.length > 0)
        events.push(await this.publishCategorized(tx, result.classificationChanges));
      await this.record(
        tx,
        {
          workspaceId,
          action: auditActionForStatus(cmd.status, previousStatus) ?? 'transactions.transaction.updated',
          aggregateType: 'Transaction',
          aggregateId: after.id,
          aggregateVersion: after.version,
          changes: diff(before, after, changedFields, newEntryId, result.customFieldChanges),
        },
        {
          events,
          journalEntries: {
            reversed: revision?.reversedJournalEntryId ?? null,
            reversal: revision?.reversalJournalEntryId ?? null,
            posted: newEntryId,
          },
          changedFields: changedFields.map(changedFieldName),
          revisionBefore: before.revision,
        },
      );
      return after;
    });
  }

  /** `VoidTransaction`: reversa del asiento activo (si lo hay) y estado VOIDED; nunca se borra. */
  voidTransaction(
    workspaceId: string,
    transactionId: string,
    expectedVersion: number,
    reason: string,
    options: { readonly correctInCurrentPeriod?: boolean } = {},
  ): Promise<TransactionState> {
    return this.deps.uow.run(workspaceId, async () => {
      const tx = await this.load(workspaceId, transactionId, expectedVersion);
      const before = tx.snapshot;
      if (before.status === 'POSTED' || before.status === 'CLEARED') {
        await this.assertAccounts(workspaceId, [before.accountId]);
      }
      const { previousStatus, entryToReverse } = tx.void(reason, this.deps.clock.now().toString());
      let reversalId: string | null = null;
      if (entryToReverse) {
        // Anulación corregida (`VoidRequest.correctInCurrentPeriod`, ADR-0028): si el periodo original está cerrado, la
        // reversa se fecha en la primera fecha abierta; si no está cerrado, `firstOpenDateOnOrAfter` devuelve la fecha
        // original. Con `false` y periodo cerrado, el ledger rechaza con PERIOD_CLOSED.
        const reverseDate =
          options.correctInCurrentPeriod === true
            ? await this.deps.ledger.firstOpenDateOnOrAfter({ workspaceId, date: before.businessDate })
            : before.businessDate;
        const reversal = await this.deps.ledger.reverseJournalEntry({
          workspaceId,
          journalEntryId: entryToReverse,
          reverseDate,
          reason: reason.trim(),
        });
        reversalId = reversal.journalEntryId;
      }
      await this.save(tx);
      if (reversalId) await this.link(tx, reversalId, 'REVERSAL');
      const s = tx.snapshot;
      const voided = await this.publish(tx, TRANSACTION_EVENTS.voided, {
        transactionId: s.id,
        kind: s.kind,
        businessDate: s.businessDate,
        previousStatus,
        reversalJournalEntryId: reversalId,
        reason: s.voidReason,
        legs: legsPayload(s),
        splits: splitsPayload(s),
        transition: 'VOID',
      });
      await this.record(
        tx,
        {
          workspaceId,
          action: 'transactions.transaction.voided',
          aggregateType: 'Transaction',
          aggregateId: s.id,
          aggregateVersion: s.version,
          reason: s.voidReason,
          changes: [
            { field: 'status', before: previousStatus, after: 'VOIDED' },
            ...(reversalId ? [{ field: 'journalEntryId', before: entryToReverse, after: reversalId }] : []),
          ],
        },
        {
          events: [voided],
          journalEntries: { reversed: reversalId ? entryToReverse : null, reversal: reversalId },
        },
      );
      return s;
    });
  }

  /** `UnreconcileTransaction`: RECONCILED → CLEARED con motivo (TC-TRANSACTIONS-RECONCILED-003). */
  unreconcileTransaction(
    workspaceId: string,
    transactionId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<TransactionState> {
    return this.deps.uow.run(workspaceId, async () => {
      const tx = await this.load(workspaceId, transactionId, expectedVersion);
      const before = tx.snapshot;
      tx.unreconcile(reason);
      // INV-015 (docs/33 D65): el snapshot del cierre registró la conciliación; no se deshace en un periodo cerrado.
      await this.deps.ledger.assertPeriodOpen({ workspaceId, date: before.businessDate });
      await this.save(tx);
      const s = tx.snapshot;
      const updated = await this.publish(tx, TRANSACTION_EVENTS.updated, {
        transactionId: s.id,
        revision: s.revision,
        status: s.status,
        previousStatus: 'RECONCILED',
        changedFields: ['status', 'reconciliationMode'],
        ledgerImpact: false,
        reason: reason.trim(),
        paymentMethod: s.paymentMethod,
        transition: 'UNRECONCILE',
      });
      // La sesión que la reconcilió conserva su resultado y registra la des-reconciliación posterior (decisión 8).
      const session = await this.deps.reconciliations.markUnreconciled({
        workspaceId,
        transactionId,
        reason: reason.trim(),
      });
      const steps = transactionSteps(tx, { events: [updated] });
      if (session) {
        steps.push({
          kind: 'ANNOTATION',
          aggregateType: 'Reconciliation',
          aggregateId: session.reconciliationId,
          aggregateVersion: null,
          changedFields: ['TRANSACTION_UNRECONCILED'],
          detailRefs: { transactionId },
          events: [],
        });
      }
      await this.deps.lifecycle.record(
        {
          workspaceId,
          action: 'transactions.transaction.unreconciled',
          aggregateType: 'Transaction',
          aggregateId: s.id,
          aggregateVersion: s.version,
          reason: reason.trim(),
          changes: [
            { field: 'status', before: 'RECONCILED', after: 'CLEARED' },
            { field: 'reconciliationMode', before: before.reconciliationMode, after: null },
          ],
        },
        steps,
      );
      return s;
    });
  }

  /**
   * `SetClearedStatus` en lote (≤ 500): all-or-nothing en una transacción BD; cualquier versión desfasada ⇒ 412 con
   * un `errors[]` por ítem. Cada `AuditLog` lleva el `bulkOperationId` común (TC-TRANSACTIONS-CLEARED-002).
   */
  markCleared(
    workspaceId: string,
    items: readonly { readonly id: string; readonly version: number }[],
    cleared: boolean,
    session?: ClearedSessionContext,
  ): Promise<{ readonly data: readonly TransactionState[]; readonly bulkOperationId: string }> {
    return this.deps.uow.run(workspaceId, async () => {
      if (items.length === 0 || items.length > MAX_BULK) {
        throw new DomainError('VALIDATION_FAILED', `between 1 and ${MAX_BULK} items`).at('/items');
      }
      const loaded: Transaction[] = [];
      const stale: FieldViolation[] = [];
      for (const [i, item] of items.entries()) {
        const tx = await this.deps.transactions.findById(workspaceId, item.id, { forUpdate: true });
        if (!tx) throw notFound(item.id);
        if (tx.version !== item.version) {
          stale.push({
            pointer: `/items/${i}/version`,
            code: 'PRECONDITION_FAILED',
            detail: `current ${tx.version}`,
          });
        }
        loaded.push(tx);
      }
      if (stale.length > 0) {
        throw new DomainError('PRECONDITION_FAILED', 'some items are stale', { violations: stale });
      }
      const bulkOperationId = this.deps.ids.next();
      const target = cleared ? 'CLEARED' : 'POSTED';
      for (const [i, tx] of loaded.entries()) {
        if (session) {
          // Dentro de una sesión solo se confirman transacciones de su cuenta con fecha ≤ extracto (decisión 2).
          const s0 = tx.snapshot;
          if (!s0.legs.some((l) => l.accountId === session.accountId)) {
            throw new DomainError(
              'VALIDATION_FAILED',
              `transaction ${tx.id} does not belong to the account of the reconciliation`,
            ).at(`/items/${i}/id`);
          }
          if (s0.businessDate > session.statementDate) {
            throw new DomainError(
              'VALIDATION_FAILED',
              `transaction ${tx.id} is dated after the statement date ${session.statementDate}`,
            ).at(`/items/${i}/id`);
          }
        }
        if (tx.status === 'RECONCILED' && !session) {
          throw new DomainError('TRANSACTION_RECONCILED', `transaction ${tx.id} is reconciled`);
        }
        if (tx.status !== (cleared ? 'POSTED' : 'CLEARED')) {
          throw new DomainError(
            'INVALID_STATUS_TRANSITION',
            `transaction ${tx.id} is ${tx.status}, cannot become ${target}`,
          );
        }
        // INV-015 (docs/33 D65): confirmar o desconfirmar no cambia en silencio un periodo cerrado.
        await this.deps.ledger.assertPeriodOpen({ workspaceId, date: tx.snapshot.businessDate });
        const previous = tx.changeStatus(target);
        if (!(await this.deps.transactions.updateStatus(tx))) throw concurrencyConflict();
        const s = tx.snapshot;
        const transition = cleared ? 'CLEAR' : 'UNCLEAR';
        const events: LifecycleEventRefDto[] = [
          await this.publishCleared(
            tx,
            previous,
            bulkOperationId,
            session?.reconciliationId ?? null,
            transition,
          ),
          await this.publish(tx, TRANSACTION_EVENTS.updated, {
            transactionId: s.id,
            revision: s.revision,
            status: s.status,
            previousStatus: previous,
            changedFields: ['status'],
            ledgerImpact: false,
            reason: null,
            paymentMethod: s.paymentMethod,
            transition,
          }),
        ];
        const steps = transactionSteps(tx, { events });
        if (session) {
          // La sesión registra la confirmación como anotación de su recorrido (no cambia su estado).
          steps.push({
            kind: 'ANNOTATION',
            aggregateType: 'Reconciliation',
            aggregateId: session.reconciliationId,
            aggregateVersion: null,
            changedFields: [cleared ? 'TRANSACTION_CLEARED' : 'TRANSACTION_UNCLEARED'],
            detailRefs: { transactionId: s.id },
            events: [],
          });
        }
        await this.deps.lifecycle.record(
          {
            workspaceId,
            action: cleared ? 'transactions.transaction.cleared' : 'transactions.transaction.uncleared',
            aggregateType: 'Transaction',
            aggregateId: s.id,
            aggregateVersion: s.version,
            changes: [
              { field: 'status', before: previous, after: target },
              { field: 'bulkOperationId', before: null, after: bulkOperationId },
            ],
          },
          steps,
        );
      }
      return { data: loaded.map((t) => t.snapshot), bulkOperationId };
    });
  }

  // ------------------------------------------------------------------ consultas

  getTransaction(workspaceId: string, transactionId: string): Promise<TransactionState> {
    return this.deps.uow.run(workspaceId, async () => {
      const tx = await this.deps.transactions.findById(workspaceId, transactionId);
      if (!tx) throw notFound(transactionId);
      return tx.snapshot;
    });
  }

  /** Listado con filtros (categoría incluye subcategorías; `q` sin acentos ni mayúsculas) — TC-TRANSACTIONS-LIST-001. */
  listTransactions(query: ListTransactionsQuery): Promise<TransactionState[]> {
    const { workspaceId, offset, limit, q, sort, ...rest } = query;
    return this.deps.uow.run(workspaceId, async () => {
      const categoryIds = rest.categoryIds?.length
        ? await this.deps.categories.withDescendants(workspaceId, rest.categoryIds)
        : undefined;
      const normalized = q ? normalizeText(q) : '';
      const filter: TransactionListFilter = {
        ...rest,
        ...(categoryIds ? { categoryIds } : {}),
        ...(normalized ? { q: normalized } : {}),
        sort: sort ?? '-transactionDate',
      };
      const found = await this.deps.transactions.list(workspaceId, filter, { offset, limit });
      return found.map((t) => t.snapshot);
    });
  }

  /** `CheckDuplicates` (sin efectos): candidatos por la heurística de `DuplicateDetector`. */
  checkDuplicates(query: DuplicateCheckQuery): Promise<TransactionState[]> {
    return this.deps.uow.run(query.workspaceId, async () => {
      const [account] = await this.deps.accounts.getPostingEligibility({
        workspaceId: query.workspaceId,
        accountIds: [query.accountId],
      });
      if (!account) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/accountId');
      if (account.currency !== query.amount.currency) {
        throw new DomainError('CURRENCY_MISMATCH', `the account is in ${account.currency}`).at(
          '/amount/currency',
        );
      }
      const amount = await this.parseMoney(query.amount, '/amount');
      return this.duplicates(query.workspaceId, {
        accountId: query.accountId,
        amount,
        businessDate: query.transactionDate,
        description: query.description ?? null,
        counterpartyId: query.counterpartyId ?? null,
        excludeTransactionId: query.excludeTransactionId ?? null,
      });
    });
  }

  /**
   * `getTransactionHistory` (D28, VIEWER): entradas de auditoría de la transacción y de sus asientos vinculados.
   * 404 si la transacción no existe en el workspace (RLS).
   */
  transactionHistory(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly after?: { readonly occurredAt: string; readonly id: string };
    readonly limit: number;
  }): Promise<readonly AuditLogEntryDto[]> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const tx = await this.deps.transactions.findById(input.workspaceId, input.transactionId);
      if (!tx) throw notFound(input.transactionId);
      const entries = await this.deps.transactions.linkedEntries(input.workspaceId, input.transactionId);
      return this.deps.history.historyOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        entities: [
          { aggregateType: 'Transaction', aggregateId: input.transactionId },
          ...entries.map((id) => ({ aggregateType: 'JournalEntry', aggregateId: id })),
        ],
        ...(input.after ? { after: input.after } : {}),
        limit: input.limit,
      });
    });
  }

  /**
   * `GetLifecycle` de una transacción (add-lifecycle-timeline decisión 7; VIEWER, D28): verifica que la transacción
   * existe en el workspace (404 idéntico a inexistente si es de otro, RLS), pide el recorrido a AUDIT con el estado
   * actual como fuente de verdad y lo compone con los montos de cada revisión (legs vigentes y reemplazadas y
   * `ConversionDetail` de cada revisión). AUDIT no hace joins cross-schema.
   */
  transactionLifecycle(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly transactionId: string;
  }): Promise<TransactionLifecycleView> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const tx = await this.deps.transactions.findById(input.workspaceId, input.transactionId);
      if (!tx) throw notFound(input.transactionId);
      const s = tx.snapshot;
      const lifecycle = await this.deps.lifecycleQuery.lifecycleOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateType: 'Transaction',
        aggregateId: s.id,
        currentState: s.status,
      });
      const legs = await this.deps.transactions.revisionLegs(input.workspaceId, s.id);
      const details =
        s.kind === 'CONVERSION'
          ? await this.deps.transactions.conversionRevisions(input.workspaceId, s.id)
          : [];
      const revisions: TransactionRevisionView[] = [...legs.entries()]
        .sort(([a], [b]) => a - b)
        .map(([revision, revisionLegs]) => {
          const detail = details.find((d) => d.detail.revision === revision)?.detail ?? null;
          return {
            revision,
            ...revisionAmounts(s.kind, revisionLegs, detail),
            legs: revisionLegs,
            conversion: detail,
          };
        });
      // Sesiones referenciadas por el recorrido: fecha y saldo del extracto contra el que se reconcilió/cotejó.
      const sessionIds = [
        ...new Set(
          lifecycle.items.flatMap((item) => {
            const id = item.detailRefs?.['reconciliationId'];
            return typeof id === 'string' ? [id] : [];
          }),
        ),
      ];
      const sessions =
        sessionIds.length > 0 ? await this.deps.reconciliations.findByIds(input.workspaceId, sessionIds) : [];
      const reconciliations: TransactionReconciliationRef[] = sessions.map((r) => ({
        reconciliationId: r.id,
        accountId: r.snapshot.accountId,
        statementDate: r.snapshot.statementDate,
        statementBalance: r.snapshot.statementBalance,
      }));
      return { lifecycle, revisions, reconciliations };
    });
  }

  // ------------------------------------------------------------------ helpers

  private async load(workspaceId: string, id: string, expectedVersion: number): Promise<Transaction> {
    const tx = await this.deps.transactions.findById(workspaceId, id, { forUpdate: true });
    if (!tx) throw notFound(id);
    if (tx.version !== expectedVersion) throw preconditionFailed(tx.version);
    return tx;
  }

  private async save(tx: Transaction): Promise<void> {
    if (!(await this.deps.transactions.update(tx))) throw concurrencyConflict();
  }

  private async assertAccounts(workspaceId: string, accountIds: readonly string[]): Promise<void> {
    await this.deps.accounts.assertCanPost({
      workspaceId,
      accounts: [...new Set(accountIds)].map((accountId) => ({ accountId })),
    });
  }

  private async parseMoney(dto: MoneyDto, pointer: string): Promise<Money> {
    const scale = await this.deps.currencies.scaleOf(dto.currency);
    if (scale === null) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${dto.currency} is not enabled`).at(
        `${pointer}/currency`,
      );
    }
    try {
      return Money.parse(dto.amount, makeCurrency(dto.currency, scale));
    } catch (err) {
      throw err instanceof DomainError ? err.at(`${pointer}/amount`) : err;
    }
  }

  private async parseSplits(splits: readonly SplitDto[]): Promise<SplitInput[]> {
    const out: SplitInput[] = [];
    for (const [i, s] of splits.entries()) {
      out.push({
        id: this.deps.ids.next(),
        amount: await this.parseMoney(s.amount, `/splits/${i}/amount`),
        categoryId: s.categoryId,
        counterpartyId: s.counterpartyId ?? null,
        tagIds: s.tagIds ?? [],
        memo: s.memo ?? null,
      });
    }
    return out;
  }

  /**
   * Valida con CLASSIFICATION (`ValidateCustomFieldValues`) los custom fields de los splits y devuelve la lista FINAL
   * de cada split: los valores actuales del split en la misma posición (`current`) con los cambios aplicados.
   * `undefined` ⇒ no hay nada que resolver (los splits conservan lo que tienen). Solo ingresos, gastos y reembolsos
   * llevan custom fields (docs/33 D97): en transferencias, conversiones y ajustes se rechazan.
   */
  private async resolveCustomFields(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly kind: TransactionKind;
    readonly splits: readonly SplitDto[] | undefined;
    readonly current: readonly Split[] | null;
    readonly requireMandatory: boolean;
  }): Promise<(readonly CustomFieldValue[])[] | undefined> {
    const { kind, splits, current } = input;
    const supported = kind === 'INCOME' || kind === 'EXPENSE' || kind === 'REFUND';
    if (!supported) {
      const offending = splits?.findIndex((x) => x.customFields !== undefined && x.customFields.length > 0);
      if (offending !== undefined && offending >= 0) {
        throw new DomainError(
          'CUSTOM_FIELD_TARGET_MISMATCH',
          `custom fields do not apply to ${kind} transactions`,
        ).at(`/splits/${offending}/customFields`);
      }
      return undefined;
    }
    const given = splits?.some((x) => x.customFields !== undefined) ?? false;
    if (!given && !input.requireMandatory) return undefined;
    const count = splits?.length ?? 1;
    const items = Array.from({ length: count }, (_, i) => ({
      pointer: `/splits/${i}/customFields`,
      values: splits?.[i]?.customFields ?? [],
      existingFieldIds: (current?.[i]?.customFields ?? []).map((v) => v.fieldId),
    }));
    const validated = await this.deps.classification.validateCustomFieldValues({
      userId: input.userId,
      workspaceId: input.workspaceId,
      target: 'TRANSACTION',
      requireMandatory: input.requireMandatory,
      items,
    });
    return items.map((_, i): readonly CustomFieldValue[] => {
      const result = validated[i];
      const merged = new Map((current?.[i]?.customFields ?? []).map((v) => [v.fieldId, v]));
      for (const id of result?.removeFieldIds ?? []) merged.delete(id);
      for (const v of result?.set ?? []) merged.set(v.fieldId, v);
      return [...merged.values()];
    });
  }

  private async validateClassification(
    userId: string,
    workspaceId: string,
    kind: TransactionKind,
    splits: readonly SplitDto[] | undefined,
    counterpartyId: string | null | undefined,
  ): Promise<void> {
    if (!splits && !counterpartyId) return;
    await this.deps.classification.validate({
      userId,
      workspaceId,
      ...(splits && kind !== 'ADJUSTMENT'
        ? {
            categoryIds: splits.map((s) => ({ categoryId: s.categoryId, splitKind: splitKindOf(kind) })),
            tagIds: [...new Set(splits.flatMap((s) => s.tagIds ?? []))],
          }
        : {}),
      ...(counterpartyId ? { counterpartyId } : {}),
    });
  }

  private postEntry(tx: Transaction): Promise<string> {
    return postEntry(this.deps, tx);
  }

  private link(tx: Transaction, journalEntryId: string, linkType: 'POSTED' | 'REVERSAL'): Promise<void> {
    return linkEntry(this.deps, tx, journalEntryId, linkType);
  }

  private async duplicates(
    workspaceId: string,
    probe: Parameters<typeof findDuplicates>[0],
  ): Promise<TransactionState[]> {
    const from = shiftDate(probe.businessDate, -DUPLICATE_WINDOW_DAYS);
    const to = shiftDate(probe.businessDate, DUPLICATE_WINDOW_DAYS);
    const candidates = await this.deps.transactions.duplicateCandidates(workspaceId, {
      accountId: probe.accountId,
      amount: probe.amount,
      from,
      to,
    });
    return findDuplicates(
      probe,
      candidates.map((c) => ({ ...c, state: c })),
    ).map((c) => c.state);
  }

  private async duplicateWarnings(s: TransactionState): Promise<TransactionWarning[]> {
    const found = await this.duplicates(s.workspaceId, {
      accountId: s.accountId,
      amount: s.amount,
      businessDate: s.businessDate,
      description: s.description,
      counterpartyId: s.counterpartyId,
      excludeTransactionId: s.id,
    });
    if (found.length === 0) return [];
    return [
      {
        code: 'POSSIBLE_DUPLICATE',
        transactionIds: found.map((f) => f.id),
        detail: `${found.length} similar transaction(s) within ±${DUPLICATE_WINDOW_DAYS} days`,
      },
    ];
  }

  private publish(
    tx: Transaction,
    event: { readonly eventType: string; readonly eventVersion: number },
    payload: object,
  ): Promise<LifecycleEventRefDto> {
    return publishEvent(this.deps, tx, event, payload);
  }

  /**
   * Auditoría + paso del recorrido (transición validada por la máquina o anotación) en la unidad de trabajo del
   * comando (add-lifecycle-timeline decisión 5, INV-029).
   */
  private record(
    tx: Transaction,
    entry: AuditEntry,
    input: Parameters<typeof transactionSteps>[1],
  ): Promise<void> {
    return this.deps.lifecycle.record(entry, transactionSteps(tx, input));
  }

  /** `TransactionPosted` + `TransferCompleted`/`ConversionRecorded` según el kind (ver `publishPosted`). */
  private publishPosted(
    tx: Transaction,
    journalEntryId: string,
    previousStatus: TransactionStatus | null,
    supersedes: string | null,
    revision: RevisionPosting | null = null,
  ): Promise<LifecycleEventRefDto[]> {
    return publishPosted(this.deps, tx, journalEntryId, previousStatus, supersedes, revision);
  }

  /**
   * `TransactionCleared` (docs/31 D47): un hecho por cada `CLEAR`/`UNCLEAR`, individual, en lote o en sesión.
   * Idempotencia natural `(transactionId, aggregateVersion)`.
   */
  private publishCleared(
    tx: Transaction,
    previousStatus: TransactionStatus | null,
    bulkOperationId: string | null,
    reconciliationId: string | null,
    transition: 'CLEAR' | 'UNCLEAR',
  ): Promise<LifecycleEventRefDto> {
    const s = tx.snapshot;
    return this.publish(tx, TRANSACTION_EVENTS.cleared, {
      transactionId: s.id,
      accountId: s.accountId,
      cleared: transition === 'CLEAR',
      status: s.status,
      previousStatus,
      revision: s.revision,
      reconciliationId,
      bulkOperationId,
      transition,
    });
  }

  private publishCategorized(
    tx: Transaction,
    changes: readonly SplitClassificationChange[],
  ): Promise<LifecycleEventRefDto> {
    const s = tx.snapshot;
    return this.publish(tx, TRANSACTION_EVENTS.categorized, {
      transactionId: s.id,
      status: s.status,
      businessDate: s.businessDate,
      appliedBy: 'USER',
      ruleId: null,
      changes: changes.map((c) => ({ ...c, amount: c.amount.toJSON() })),
    });
  }
}

/**
 * Monto (y comisión) de una revisión a partir de sus legs: transferencia ⇒ lo que recibe el destino y la diferencia con
 * lo que sale del origen; conversión ⇒ lo entregado; resto ⇒ la magnitud del leg principal.
 */
function revisionAmounts(
  kind: TransactionKind,
  legs: TransactionRevisionView['legs'],
  detail: ConversionDetail | null,
): { readonly amount: Money; readonly fee: Money | null } {
  if (kind === 'CONVERSION' && detail) return { amount: detail.sourceAmount, fee: null };
  const target = legs.find((l) => l.role === 'TARGET');
  const source = legs.find((l) => l.role === 'SOURCE');
  if (kind === 'TRANSFER' && target && source) {
    const fee = source.amount.abs().subtract(target.amount.abs());
    return { amount: target.amount.abs(), fee: fee.isZero() ? null : fee };
  }
  const main = legs.find((l) => l.role === 'MAIN') ?? legs[0];
  if (!main) throw new DomainError('INTERNAL_ERROR', 'revision without legs');
  return { amount: main.amount.abs(), fee: null };
}

/** Nombre de campo del contrato en las anotaciones (`businessDate` se expone como `transactionDate`). */
export const changedFieldName = (f: ChangedField): string => (f === 'businessDate' ? 'transactionDate' : f);

function auditActionForStatus(
  requested: string | undefined,
  previous: TransactionStatus | null,
): string | null {
  if (!requested || !previous) return null;
  // Marcado directo (docs/33 D74): la acción distingue la conciliación sin extracto de la de una sesión.
  if (requested === 'RECONCILED') return 'transactions.transaction.reconciled_without_statement';
  if (requested === 'CLEARED') return 'transactions.transaction.cleared';
  if (requested === 'POSTED' && previous === 'CLEARED') return 'transactions.transaction.uncleared';
  return null;
}

/**
 * Cambios de custom fields para la auditoría: un campo `customFields.<clave>` por cada clave que cambió, con el valor
 * antes/después (un split ⇒ el valor; varios ⇒ texto JSON con el valor de cada split, `null` si no lo tiene).
 */
function customFieldAudit(changes: readonly CustomFieldChange[]): AuditChangeInput[] {
  const scalar = (values: readonly (string | boolean | null)[]): string | boolean | null =>
    values.length === 1 ? (values[0] ?? null) : JSON.stringify(values);
  return changes.map((c) => ({
    field: `customFields.${c.key}`,
    before: c.before.every((v) => v === null) ? null : scalar(c.before),
    after: c.after.every((v) => v === null) ? null : scalar(c.after),
  }));
}

export function diff(
  before: TransactionState,
  after: TransactionState,
  fields: readonly ChangedField[],
  newEntryId: string | null,
  customFieldChanges: readonly CustomFieldChange[] = [],
): AuditChangeInput[] {
  const out: AuditChangeInput[] = [];
  for (const f of new Set(fields)) {
    if (f === 'customFields') out.push(...customFieldAudit(customFieldChanges));
    else if (f === 'businessDate')
      out.push({ field: 'transactionDate', before: before.businessDate, after: after.businessDate });
    else if (f === 'toAccountId')
      out.push({
        field: 'toAccountId',
        before: before.legs.find((l) => l.role === 'TARGET')?.accountId ?? null,
        after: after.legs.find((l) => l.role === 'TARGET')?.accountId ?? null,
      });
    else if (f === 'splits')
      out.push({ field: 'splits', before: splitsAudit(before), after: splitsAudit(after) });
    else out.push({ field: f, before: before[f], after: after[f] });
  }
  if (newEntryId) {
    out.push({ field: 'revision', before: before.revision, after: after.revision });
    out.push({ field: 'journalEntryId', before: before.activeEntryId, after: newEntryId });
  }
  return out;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
