import type { LifecycleEventRefDto, LifecycleStepInput } from '@pf/audit/contracts';
import type { PostingLineDto } from '@pf/ledger/contracts';
import { DomainError } from '@pf/shared-kernel';
import { TRANSACTION_EVENTS } from '../contracts/index.js';
import {
  TRANSACTION_LIFECYCLE,
  toJournalEntryDraft,
  transferFee,
  type ConversionDetail,
  type Transaction,
  type TransactionState,
  type TransactionStatus,
  type TransactionTransitionRecord,
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

/** Publica en el outbox y devuelve la referencia del evento para el registro de transición (add-lifecycle-timeline). */
export async function publishEvent(
  deps: Deps,
  tx: Transaction,
  event: { readonly eventType: string; readonly eventVersion: number },
  payload: object,
): Promise<LifecycleEventRefDto> {
  const eventId = deps.ids.next();
  await deps.outbox.append({
    eventId,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    occurredAt: deps.clock.now().toString(),
    workspaceId: tx.workspaceId,
    aggregateType: 'Transaction',
    aggregateId: tx.id,
    aggregateVersion: tx.version,
    payload,
  });
  return { eventId, eventType: `${event.eventType}.v${event.eventVersion}` };
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
 * Payload de `transactions.ConversionRevised.v1` (docs/31 D48): el `ConversionDetail` de la revisión nueva y los
 * tres asientos de la transición `REVISE` (revertido, reversa y nuevo). Idempotencia natural `(transactionId,
 * revisionTo)`.
 */
export function conversionRevisedPayload(
  s: TransactionState,
  d: ConversionDetail,
  revision: RevisionPosting,
  journalEntryId: string,
) {
  const p = conversionRecordedPayload(s, d, journalEntryId);
  return {
    transactionId: p.transactionId,
    revisionFrom: revision.revisionFrom,
    revisionTo: s.revision,
    businessDate: p.businessDate,
    executedAt: p.executedAt,
    source: p.source,
    target: p.target,
    quotedRate: p.quotedRate,
    effectiveRate: p.effectiveRate,
    referenceRate: p.referenceRate,
    fees: p.fees,
    spread: p.spread,
    provider: p.provider,
    convertedSource: p.convertedSource,
    grossTarget: p.grossTarget,
    quotedRateDeviation: p.quotedRateDeviation,
    reversedJournalEntryId: revision.reversedJournalEntryId,
    reversalJournalEntryId: revision.reversalJournalEntryId,
    journalEntryId,
  };
}

/** Revisión que reemplaza el asiento activo (transición `REVISE`): asientos revertido y de reversa. */
export interface RevisionPosting {
  readonly revisionFrom: number;
  readonly reversedJournalEntryId: string;
  readonly reversalJournalEntryId: string;
}

/**
 * `TransactionPosted` y, según el kind (en todos los caminos de posteo y nunca en `pending`):
 * - `TRANSFER`: `TransferCompleted` UNA SOLA VEZ, en su primer asiento (`RECORD`/`POST`; idempotencia natural
 *   `transactionId`); cada edición financiera (`REVISE`, `revision` presente) publica `TransferRevised` con los tres
 *   asientos (docs/31 D37, add-lifecycle-timeline decisión 9; reemplaza la re-emisión de add-transfers decisión 6).
 *   Idempotencia natural de `TransferRevised`: `(transactionId, revisionTo)`.
 * - `CONVERSION`: `ConversionRecorded` UNA SOLA VEZ, en su primer asiento; cada corrección financiera (`REVISE`)
 *   publica `ConversionRevised` con el detalle nuevo y los tres asientos (docs/31 D48, simétrico a `TransferRevised`;
 *   reemplaza la re-emisión de `ConversionRecorded` con `revision + 1`). Idempotencia natural `(transactionId,
 *   revisionTo)`.
 * `TransactionPosted` lleva el campo aditivo `transition` (decisión 10). Devuelve las referencias de los eventos.
 */
export async function publishPosted(
  deps: Deps,
  tx: Transaction,
  journalEntryId: string,
  previousStatus: TransactionStatus | null,
  supersedes: string | null,
  revision: RevisionPosting | null = null,
): Promise<LifecycleEventRefDto[]> {
  const s = tx.snapshot;
  const transition = tx.lastTransition?.transition;
  const refs: LifecycleEventRefDto[] = [
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
      ...(transition ? { transition } : {}),
      // Aditivo (add-reconciliation): el ajuste que crea una sesión de reconciliación referencia la sesión.
      ...(s.reconciliationId ? { reconciliationId: s.reconciliationId } : {}),
    }),
  ];
  if (s.kind === 'TRANSFER') {
    const source = s.legs.find((l) => l.role === 'SOURCE');
    const target = s.legs.find((l) => l.role === 'TARGET');
    if (!source || !target) throw new DomainError('INTERNAL_ERROR', 'transfer without SOURCE/TARGET legs');
    refs.push(
      revision
        ? await publishEvent(deps, tx, TRANSACTION_EVENTS.transferRevised, {
            transactionId: s.id,
            revisionFrom: revision.revisionFrom,
            revisionTo: s.revision,
            businessDate: s.businessDate,
            fromAccountId: source.accountId,
            toAccountId: target.accountId,
            amount: s.amount.toJSON(),
            fee: transferFee(s)?.toJSON() ?? null,
            reversedJournalEntryId: revision.reversedJournalEntryId,
            reversalJournalEntryId: revision.reversalJournalEntryId,
            journalEntryId,
          })
        : await publishEvent(deps, tx, TRANSACTION_EVENTS.transferCompleted, {
            transactionId: s.id,
            journalEntryId,
            businessDate: s.businessDate,
            fromAccountId: source.accountId,
            toAccountId: target.accountId,
            amount: s.amount.toJSON(),
            fee: transferFee(s)?.toJSON() ?? null,
            matchedTransactionIds: [],
          }),
    );
  }
  if (s.kind === 'CONVERSION') {
    if (!s.conversion) throw new DomainError('INTERNAL_ERROR', 'conversion without ConversionDetail');
    refs.push(
      revision
        ? await publishEvent(
            deps,
            tx,
            TRANSACTION_EVENTS.conversionRevised,
            conversionRevisedPayload(s, s.conversion, revision, journalEntryId),
          )
        : await publishEvent(
            deps,
            tx,
            TRANSACTION_EVENTS.conversionRecorded,
            conversionRecordedPayload(s, s.conversion, journalEntryId),
          ),
    );
  }
  return refs;
}

/**
 * Pasos del recorrido de una transacción para `LifecyclePort` (add-lifecycle-timeline decisiones 2 y 5): la transición
 * que dejó el agregado (validada por `TRANSACTION_LIFECYCLE`) o, si el comando no cambió el estado ni el ledger, una
 * anotación con los campos cambiados. Las conversiones enlazan el `ConversionDetail` de la revisión
 * (`detailRefs.conversionRevision`, D11).
 */
export function transactionSteps(
  tx: Transaction,
  input: {
    readonly events: readonly LifecycleEventRefDto[];
    readonly journalEntries?: {
      readonly reversed?: string | null;
      readonly reversal?: string | null;
      readonly posted?: string | null;
    };
    readonly changedFields?: readonly string[];
    readonly revisionBefore?: number;
    /** Referencias del paso (p. ej. `reconciliationId` de la sesión que reconcilió o cotejó la transacción). */
    readonly detailRefs?: Readonly<Record<string, string | number>>;
    /** Paso explícito (varios pasos en un mismo comando); por defecto el último registrado por el agregado. */
    readonly transition?: TransactionTransitionRecord | null;
  },
): LifecycleStepInput[] {
  const t = input.transition !== undefined ? input.transition : tx.lastTransition;
  const s = tx.snapshot;
  if (t) {
    const linksDetail = s.kind === 'CONVERSION' && (t.transition === 'RECORD' || t.transition === 'REVISE');
    const detailRefs = {
      ...(linksDetail ? { conversionRevision: s.revision } : {}),
      ...(input.detailRefs ?? {}),
    };
    return [
      {
        kind: 'TRANSITION',
        transition: t.transition,
        fromState: t.from,
        toState: t.to,
        machineVersion: TRANSACTION_LIFECYCLE.version,
        revisionFrom: t.revisionFrom,
        revisionTo: t.revisionTo,
        events: input.events,
        ...(input.journalEntries ? { journalEntries: input.journalEntries } : {}),
        ...(Object.keys(detailRefs).length > 0 ? { detailRefs } : {}),
      },
    ];
  }
  const revised = input.revisionBefore !== undefined && input.revisionBefore !== s.revision;
  return [
    {
      kind: 'ANNOTATION',
      changedFields: input.changedFields ?? [],
      events: input.events,
      ...(input.detailRefs ? { detailRefs: input.detailRefs } : {}),
      ...(revised ? { revisionFrom: input.revisionBefore ?? null, revisionTo: s.revision } : {}),
    },
  ];
}
