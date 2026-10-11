import type { PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a TRANSACTIONS (openspec add-workspace-export):
 * transacciones con TODAS sus revisiones (legs y splits versionados), etiquetas y custom fields de los splits, detalle
 * de conversiones y sus comisiones, vínculos con los asientos y las sesiones de reconciliación con sus ítems.
 * Los montos viajan con la escala exacta de su moneda (`45.90`, `100.000000`).
 */
export const TRANSACTIONS_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'transactions',
    context: 'transactions',
    table: 'txn.transaction',
    order: 600,
    orderBy: ['id'],
    selfRefs: ['refund_of_transaction_id'],
    // `external_ref_id` de los pagos y desembolsos de préstamo (add-loans) es el id del pago/préstamo: se remapea con el
    // resto de ids al importar (el UUID no mapeado de otros espacios de nombres se conserva tal cual). El `jsonb`
    // `loan_payment_breakdown` (loanId) se remapea por el recorrido profundo del importador.
    textRefs: ['external_ref_id'],
    money: { amount: 't.currency' },
  },
  {
    name: 'transaction-legs',
    context: 'transactions',
    table: 'txn.transaction_leg',
    order: 610,
    orderBy: ['id'],
    money: { amount: 't.currency' },
  },
  {
    name: 'transaction-splits',
    context: 'transactions',
    table: 'txn.transaction_split',
    order: 620,
    orderBy: ['id'],
    money: { amount: 't.currency' },
  },
  {
    name: 'split-tags',
    context: 'transactions',
    table: 'txn.split_tag',
    order: 630,
    orderBy: ['split_id', 'tag_id'],
    idColumns: [],
  },
  {
    name: 'split-custom-field-values',
    context: 'transactions',
    table: 'txn.split_custom_field_value',
    order: 640,
    orderBy: ['split_id', 'field_id'],
    idColumns: [],
  },
  {
    name: 'conversion-details',
    context: 'transactions',
    table: 'txn.conversion_detail',
    order: 650,
    orderBy: ['transaction_id', 'revision'],
    idColumns: [],
    money: {
      source_amount: 't.source_currency',
      converted_source_amount: 't.source_currency',
      gross_target_amount: 't.target_currency',
      target_amount: 't.target_currency',
      spread_amount: 't.spread_currency',
    },
  },
  {
    name: 'conversion-fees',
    context: 'transactions',
    table: 'txn.conversion_fee',
    order: 660,
    orderBy: ['id'],
    money: { amount: 't.currency' },
  },
  {
    name: 'transaction-journal-links',
    context: 'transactions',
    table: 'txn.transaction_journal_link',
    order: 670,
    orderBy: ['journal_entry_id'],
    idColumns: [],
  },
  {
    name: 'reconciliations',
    context: 'transactions',
    table: 'txn.reconciliation',
    order: 680,
    orderBy: ['id'],
    money: { statement_balance: 't.currency', cleared_balance: 't.currency', difference: 't.currency' },
  },
  {
    name: 'reconciliation-items',
    context: 'transactions',
    table: 'txn.reconciliation_item',
    order: 690,
    orderBy: ['reconciliation_id', 'transaction_id'],
    idColumns: [],
  },
];
