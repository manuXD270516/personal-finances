/**
 * API pública de `@pf/transactions` (openspec add-transaction-recording; ADR-0003). Hoja: no importa capas internas.
 * Montos como `{amount: "<decimal>", currency: "<código>"}` (nunca `number`, ADR-0006).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

export const TRANSACTIONS_CONTEXT = 'transactions' as const;

/** Eventos publicados por el outbox (contracts/events/transactions/*.v1.schema.json). */
export const TRANSACTION_EVENTS = {
  created: { eventType: 'transactions.TransactionCreated', eventVersion: 1 },
  posted: { eventType: 'transactions.TransactionPosted', eventVersion: 1 },
  voided: { eventType: 'transactions.TransactionVoided', eventVersion: 1 },
  categorized: { eventType: 'transactions.TransactionCategorized', eventVersion: 1 },
  updated: { eventType: 'transactions.TransactionUpdated', eventVersion: 1 },
} as const;

/**
 * Allow-list de auditoría de TRANSACTIONS (add-audit-trail, NFR-SEC-015): montos exactos (`money`); lo no listado
 * nunca se copia a `audit.audit_log`.
 */
export const TRANSACTIONS_AUDIT_POLICY = {
  Transaction: {
    kind: 'plain',
    status: 'plain',
    transactionDate: 'plain',
    postingDate: 'plain',
    accountId: 'plain',
    amount: 'money',
    description: 'plain',
    notes: 'plain',
    counterpartyId: 'plain',
    paymentMethod: 'plain',
    splits: 'plain',
    refundOfTransactionId: 'plain',
    confirmedRefundExcess: 'plain',
    adjustmentReason: 'plain',
    adjustmentDirection: 'plain',
    revision: 'plain',
    journalEntryId: 'plain',
    bulkOperationId: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;
