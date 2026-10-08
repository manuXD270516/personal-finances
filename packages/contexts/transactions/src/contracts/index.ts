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
  transferCompleted: { eventType: 'transactions.TransferCompleted', eventVersion: 1 },
  /** Edición financiera de una transferencia (add-lifecycle-timeline decisión 9; docs/31 D37). */
  transferRevised: { eventType: 'transactions.TransferRevised', eventVersion: 1 },
  conversionRecorded: { eventType: 'transactions.ConversionRecorded', eventVersion: 1 },
  /** Corrección financiera de una conversión posteada (docs/31 D48, simétrico a `transferRevised`). */
  conversionRevised: { eventType: 'transactions.ConversionRevised', eventVersion: 1 },
  /** `CLEAR`/`UNCLEAR` de una transacción (docs/31 D47; add-reconciliation). Aditivo a `updated`. */
  cleared: { eventType: 'transactions.TransactionCleared', eventVersion: 1 },
  /** Fin de una sesión de reconciliación (`COMPLETE`, add-reconciliation). Agregado `Reconciliation`. */
  reconciliationCompleted: { eventType: 'transactions.ReconciliationCompleted', eventVersion: 1 },
} as const;

export interface ReconciliationMoneyDto {
  readonly amount: string;
  readonly currency: string;
}

/**
 * Estado de reconciliación de una cuenta a un corte (openspec add-reconciliation, design decisión 9; docs/33 D111).
 * Contrato con `planning/month-closing` (FR-PLANNING-003): "cuentas sin conciliar" y "conciliada sin extracto —
 * pendiente de revisión". Regla única de `reconciledThrough`: no quedan `posted` ni `cleared` con fecha ≤ corte Y
 * (hay un extracto completado con fecha ≥ corte O alguna conciliada sin extracto posterior al último extracto).
 */
export interface ReconciliationCoverageDto {
  readonly accountId: string;
  /** Última sesión `COMPLETED` de la cuenta (mayor fecha de extracto), `null` si nunca se completó una. */
  readonly lastCompleted: {
    readonly reconciliationId: string;
    readonly statementDate: string;
    readonly statementBalance: ReconciliationMoneyDto;
    readonly difference: ReconciliationMoneyDto;
    readonly completedAt: string;
  } | null;
  readonly inProgressReconciliationId: string | null;
  readonly unreconciledPostedCountThrough: number;
  readonly unreconciledClearedCountThrough: number;
  /** `RECONCILED` en modo `WITHOUT_STATEMENT` con fecha en `[from, through]`. */
  readonly reconciledWithoutStatementCount: number;
  readonly reconciledThrough: boolean;
  /** `null` si `!reconciledThrough`; `WITHOUT_STATEMENT` si hay conciliadas sin extracto en el rango; si no, `STATEMENT`. */
  readonly reconciliationBasis: 'STATEMENT' | 'WITHOUT_STATEMENT' | null;
}

/**
 * Query pública `ReconciliationStatusQuery.getCoverage` (síncrona, sin efectos): corre en la unidad de trabajo del
 * llamador si existe (el cierre de mes la invoca dentro de su transacción). `from` por omisión: sin límite inferior.
 */
export interface ReconciliationStatusQuery {
  getCoverage(input: {
    readonly workspaceId: string;
    readonly accountIds: readonly string[];
    readonly from?: string;
    readonly through: string;
  }): Promise<readonly ReconciliationCoverageDto[]>;
}

export const RECONCILIATION_STATUS_QUERY = Symbol.for('pf.transactions.ReconciliationStatusQuery');

export interface FlowMoneyDto {
  readonly amount: string;
  readonly currency: string;
}

/**
 * Fila de `SummarizeNominalFlows` (openspec add-basic-dashboard): agregado por fecha de negocio, moneda, naturaleza y
 * categoría de las porciones (splits) vigentes de transacciones con asiento activo (`POSTED | CLEARED | RECONCILED`).
 * `amount` va con el signo del usuario: `INCOME` positivo; `EXPENSE` neto de reembolsos (un reembolso resta, así que
 * el neto puede ser negativo). Incluye las comisiones de transferencias y conversiones como `EXPENSE` (su split
 * *Fees*); nunca el principal de transferencias o conversiones, saldos iniciales ni ajustes (docs/14 §4.3).
 */
export interface NominalFlowRowDto {
  readonly businessDate: string;
  readonly nature: 'INCOME' | 'EXPENSE';
  readonly categoryId: string;
  /** En la escala canónica de la moneda. */
  readonly amount: FlowMoneyDto;
  /**
   * Tags de la porción (ids ordenados). Solo viaja con `withTags: true` (add-budgets, presupuestos por tag): sin él,
   * ausente (las filas no se parten por tags y las demás consultas conservan su agrupación).
   */
  readonly tagIds?: readonly string[];
}

/** Query pública `SummarizeNominalFlows` (sin efectos; en la unidad de trabajo del llamador si existe). */
export interface NominalFlowQuery {
  summarizeNominalFlows(input: {
    readonly workspaceId: string;
    /** Rango inclusivo de fechas de negocio `YYYY-MM-DD`. */
    readonly dateFrom: string;
    readonly dateTo: string;
    /** Solo las porciones de estas categorías (ids exactos; add-budgets). Ausente: todas. */
    readonly categoryIds?: readonly string[];
    /** Agrega además por el conjunto de tags de la porción y lo informa en `tagIds` (add-budgets). */
    readonly withTags?: boolean;
  }): Promise<readonly NominalFlowRowDto[]>;
}

export const NOMINAL_FLOW_QUERY = Symbol.for('pf.transactions.NominalFlowQuery');

/**
 * Query pública para la sugerencia de categoría por counterparty de CLASSIFICATION (add-classification design §8,
 * FR-CLASSIFICATION-011): categoría de la porción vigente más reciente, de una transacción no anulada del tipo pedido
 * (`EXPENSE` incluye reembolsos), con esa counterparty (en la porción o en la transacción). CLASSIFICATION decide si
 * es usable (activa y del tipo pedido). Sin efectos; en la unidad de trabajo del llamador si existe.
 */
export interface CounterpartyCategoryUsageQuery {
  lastCategoryUsed(input: {
    readonly workspaceId: string;
    readonly counterpartyId: string;
    readonly kind: 'EXPENSE' | 'INCOME';
  }): Promise<string | null>;
}

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
    toAccountId: 'plain',
    fee: 'money',
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
    // Conciliación (add-reconciliation, docs/33 D74): modo (`STATEMENT` | `WITHOUT_STATEMENT`) y sesión del ajuste.
    reconciliationMode: 'plain',
    reconciliationId: 'plain',
    // Conversiones (add-manual-conversions): montos exactos y detalle de precio de la revisión.
    targetAmount: 'money',
    convertedSourceAmount: 'money',
    grossTargetAmount: 'money',
    quotedRate: 'plain',
    effectiveRate: 'plain',
    referenceFxRateId: 'plain',
    spread: 'plain',
    quotedRateDeviation: 'money',
    conversionFees: 'plain',
    provider: 'plain',
    executedAt: 'plain',
    externalRef: 'plain',
    // Custom fields de los splits (add-custom-fields): un campo `customFields.<clave>` por clave que cambió.
    'customFields.*': 'plain',
  },
  // Sesión de reconciliación (add-reconciliation): montos exactos; sin texto libre salvo el motivo del ajuste.
  Reconciliation: {
    accountId: 'plain',
    statementDate: 'plain',
    statementBalance: 'money',
    clearedBalance: 'money',
    difference: 'money',
    status: 'plain',
    adjustmentTransactionId: 'plain',
    adjustmentReason: 'plain',
    transactionCount: 'plain',
    transactionId: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;
