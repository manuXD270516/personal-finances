import type { PostingLineDto } from '@pf/ledger/contracts';
import { DomainError } from '@pf/shared-kernel';
import { TRANSACTION_EVENTS } from '../contracts/index.js';
import {
  toJournalEntryDraft,
  transferFee,
  type ConversionDetail,
  type Transaction,
  type TransactionState,
  type TransactionStatus,
} from '../domain/index.js';
import type { TransactionsDeps } from './ports/index.js';

/**
 * Pasos compartidos por los casos de uso de TRANSACTIONS (transacciones, transferencias y conversiones), siempre
 * dentro de la unidad de trabajo del comando: postear el asiento por `LedgerPostingPort`, encadenar
 * `transaction_journal_link` y publicar en el outbox (ARCHITECTURE §7, INV-028/INV-029).
 */
type Deps = Pick<TransactionsDeps, 'ledger' | 'transactions' | 'outbox' | 'ids' | 'clock'>;

/** Traduce la revisión vigente a asiento (docs/09 §6) y la postea; devuelve el id del asiento. */
export async function postEntry(deps: Deps, tx: Transaction): Promise<string> {
  const draft = toJournalEntryDraft(tx.snapshot);
  const postings: PostingLineDto[] = draft.postings.map((p) => ({
    target:
      p.target.kind === 'USER_ACCOUNT'
        ? { kind: 'USER_ACCOUNT', accountId: p.target.accountId, nature: p.target.nature }
        : { kind: 'SYSTEM', systemKind: p.target.systemKind },
    amount: p.amount.toJSON(),
    splitId: p.splitId,
  }));
  const posted = await deps.ledger.postJournalEntry({
    workspaceId: tx.workspaceId,
    entryDate: draft.entryDate,
    entryType: 'STANDARD',
    sourceRef: draft.sourceRef,
    memo: draft.memo,
    postings,
  });
  return posted.journalEntryId;
}

export function linkEntry(
  deps: Deps,
  tx: Transaction,
  journalEntryId: string,
  linkType: 'POSTED' | 'REVERSAL',
): Promise<void> {
  return deps.transactions.linkEntry({
    workspaceId: tx.workspaceId,
    transactionId: tx.id,
    revision: tx.revision,
    journalEntryId,
    linkType,
  });
}

export async function publishEvent(
  deps: Deps,
  tx: Transaction,
  event: { readonly eventType: string; readonly eventVersion: number },
  payload: object,
): Promise<void> {
  await deps.outbox.append({
    eventId: deps.ids.next(),
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    occurredAt: deps.clock.now().toString(),
    workspaceId: tx.workspaceId,
    aggregateType: 'Transaction',
    aggregateId: tx.id,
    aggregateVersion: tx.version,
    payload,
  });
}

export const legsPayload = (s: TransactionState) =>
  s.legs.map((l) => ({ accountId: l.accountId, amount: l.amount.toJSON() }));

export const splitsPayload = (s: TransactionState) =>
  s.splits.map((x) => ({
    splitId: x.id,
    amount: x.amount.toJSON(),
    categoryId: x.categoryId,
    tagIds: [...x.tagIds],
  }));

/**
 * Splits para la auditoría: `AuditPort` solo admite valores planos (string/boolean/entero/null) o `Money`, así que la
 * lista viaja como JSON canónico (un arreglo de objetos sería `AUDIT_INVALID_VALUE` y haría rollback del comando).
 */
export const splitsAudit = (s: TransactionState): string =>
  JSON.stringify(
    s.splits.map((x) => ({
      id: x.id,
      amount: x.amount.toJSON(),
      categoryId: x.categoryId,
      tagIds: [...x.tagIds],
    })),
  );

/** `Rate` del contrato: valor exacto de la cotizada; derivadas (efectiva) con 18 decimales HALF_EVEN. */
export const rateJson = (
  r: { readonly base: { code: string }; readonly quote: { code: string }; toPersisted(): string },
  exact?: string,
) => ({ base: r.base.code, quote: r.quote.code, value: exact ?? r.toPersisted() });

/** Valor canónico de una tasa ingresada (sin ceros finales: "6.9"). */
export const exactRateValue = (r: { readonly value: { toFixed(): string } }) => r.value.toFixed();

/** Payload de `transactions.ConversionRecorded.v1` (aditivo: revision, convertedSource, grossTarget, deviation). */
export function conversionRecordedPayload(s: TransactionState, d: ConversionDetail, journalEntryId: string) {
  return {
    transactionId: s.id,
    journalEntryId,
    businessDate: s.businessDate,
    executedAt: d.executedAt,
    source: { accountId: d.sourceAccountId, amount: d.sourceAmount.toJSON() },
    target: { accountId: d.targetAccountId, amount: d.targetAmount.toJSON() },
    quotedRate: d.quotedRate ? rateJson(d.quotedRate, exactRateValue(d.quotedRate)) : null,
    effectiveRate: rateJson(d.effectiveRate),
    referenceRate: d.referenceRate
      ? {
          rate: rateJson(d.referenceRate.rate, exactRateValue(d.referenceRate.rate)),
          fxRateId: d.referenceRate.fxRateId,
          source: d.referenceRate.source,
          ...(d.referenceRate.rateType ? { rateType: d.referenceRate.rateType } : {}),
        }
      : null,
    fees: d.fees.map((f) => ({
      type: f.type,
      amount: f.amount.toJSON(),
      paidFromAccountId: f.paidFromAccountId,
    })),
    spread: d.spread ? { percentage: d.spread.percentage, amount: d.spread.amount.toJSON() } : null,
    provider: { counterpartyId: d.provider.counterpartyId, name: d.provider.name },
    revision: d.revision,
    convertedSource: d.convertedSourceAmount.toJSON(),
    grossTarget: d.grossTargetAmount.toJSON(),
    quotedRateDeviation: d.quotedRateDeviation?.toJSON() ?? null,
  };
}

/**
 * `TransactionPosted` y, según el kind, `TransferCompleted` (add-transfers) o `ConversionRecorded` (exactamente uno por
 * revisión posteada; idempotencia natural `(transactionId, journalEntryId)`), en todos los caminos de posteo
 * (creación, `pending→posted`, edición con asiento nuevo) y nunca en `pending`.
 */
export async function publishPosted(
  deps: Deps,
  tx: Transaction,
  journalEntryId: string,
  previousStatus: TransactionStatus | null,
  supersedes: string | null,
): Promise<void> {
  const s = tx.snapshot;
  await publishEvent(deps, tx, TRANSACTION_EVENTS.posted, {
    transactionId: s.id,
    revision: s.revision,
    kind: s.kind,
    businessDate: s.businessDate,
    journalEntryId,
    previousStatus,
    counterpartyId: s.counterpartyId,
    legs: legsPayload(s),
    splits: splitsPayload(s),
    supersedesJournalEntryId: supersedes,
  });
  if (s.kind === 'TRANSFER') {
    const source = s.legs.find((l) => l.role === 'SOURCE');
    const target = s.legs.find((l) => l.role === 'TARGET');
    if (!source || !target) throw new DomainError('INTERNAL_ERROR', 'transfer without SOURCE/TARGET legs');
    await publishEvent(deps, tx, TRANSACTION_EVENTS.transferCompleted, {
      transactionId: s.id,
      journalEntryId,
      businessDate: s.businessDate,
      fromAccountId: source.accountId,
      toAccountId: target.accountId,
      amount: s.amount.toJSON(),
      fee: transferFee(s)?.toJSON() ?? null,
      matchedTransactionIds: [],
    });
  }
  if (s.kind === 'CONVERSION') {
    if (!s.conversion) throw new DomainError('INTERNAL_ERROR', 'conversion without ConversionDetail');
    await publishEvent(
      deps,
      tx,
      TRANSACTION_EVENTS.conversionRecorded,
      conversionRecordedPayload(s, s.conversion, journalEntryId),
    );
  }
}
