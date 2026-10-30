import type { AuditChangeInput } from '@pf/audit/contracts';
import { RECURRING_OCCURRENCE_NAMESPACE } from '../contracts/index.js';
import { diffCustomFields, type CustomFieldChange, type TransactionState } from '../domain/index.js';
import { legsPayload, splitsAudit, splitsPayload } from './posting-support.js';

/**
 * `origin.refId` de `TransactionCreated.v1`: la ocurrencia recurrente que originó la transacción (add-recurrence-engine)
 * o la importación que la creó (add-basic-csv-import).
 */
export const recurringRefOf = (s: {
  readonly source: string;
  readonly importJobId?: string | null;
  readonly externalRef: { readonly namespace: string; readonly id: string } | null;
}): string | null =>
  s.source === 'RECURRING' && s.externalRef?.namespace === RECURRING_OCCURRENCE_NAMESPACE
    ? s.externalRef.id
    : s.source === 'IMPORT'
      ? (s.importJobId ?? null)
      : null;

export function customFieldAudit(changes: readonly CustomFieldChange[]): AuditChangeInput[] {
  const scalar = (values: readonly (string | boolean | null)[]): string | boolean | null =>
    values.length === 1 ? (values[0] ?? null) : JSON.stringify(values);
  return changes.map((c) => ({
    field: `customFields.${c.key}`,
    before: c.before.every((v) => v === null) ? null : scalar(c.before),
    after: c.after.every((v) => v === null) ? null : scalar(c.after),
  }));
}

/** Payload de `transactions.TransactionCreated.v1` de una transacción recién registrada (`transition = RECORD`). */
export const createdEventPayload = (s: TransactionState) => ({
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
});

/** Cambios de auditoría de la creación (`transactions.transaction.created`), con el asiento si la transacción lo tiene. */
export function createdAuditChanges(s: TransactionState, entryId: string | null): AuditChangeInput[] {
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
    if (s.confirmedRefundExcess) changes.push({ field: 'confirmedRefundExcess', before: null, after: true });
  }
  if (s.kind === 'ADJUSTMENT') {
    changes.push({ field: 'adjustmentDirection', before: null, after: s.direction });
    changes.push({ field: 'adjustmentReason', before: null, after: s.adjustmentReason });
  }
  if (entryId) changes.push({ field: 'journalEntryId', before: null, after: entryId });
  return changes;
}
