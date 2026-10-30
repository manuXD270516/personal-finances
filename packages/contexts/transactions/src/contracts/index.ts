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

/** Detalle de un hallazgo del checklist de cierre (openspec add-month-closing; planning/month-closing). */
export interface ClosingFindingDetailDto {
  readonly refType: 'TRANSACTION' | 'ACCOUNT' | 'DUPLICATE_CANDIDATE' | 'SPLIT';
  readonly refId: string;
  readonly label: string;
  readonly date: string | null;
  readonly amount: { readonly amount: string; readonly currency: string } | null;
}

/**
 * Hallazgo agregado: `count` total, `amounts` = Σ por moneda a su escala canónica (orden por moneda), `details` hasta 50
 * por fecha ascendente y luego id, `truncated` si hay más de los listados.
 */
export interface ClosingFindingDto {
  readonly count: number;
  readonly amounts: readonly { readonly amount: string; readonly currency: string }[];
  readonly details: readonly ClosingFindingDetailDto[];
  readonly truncated: boolean;
}

/**
 * Query pública `TransactionsClosingQuery` para el checklist y el snapshot del cierre de PLANNING (openspec
 * add-month-closing, tareas 2.5/3.5). Solo lectura, sin efectos: corre en la unidad de trabajo del llamador (RLS del
 * workspace). Los rangos son inclusivos por fecha de negocio (`YYYY-MM-DD`).
 */
export interface TransactionsClosingQuery {
  /** Transacciones `PENDING` con fecha de negocio en el rango (refType `TRANSACTION`). */
  countPendingInRange(input: ClosingRangeInput): Promise<ClosingFindingDto>;
  /**
   * Posibles duplicados sin resolver. DERIVADO: aún no existe flujo de descarte ni tabla de candidatos persistidos, así
   * que "sin resolver" = pares de transacciones no anuladas, con al menos una en el rango, que `findDuplicates` considera
   * posibles duplicados (misma cuenta/monto/moneda, ventana `DUPLICATE_WINDOW_DAYS`). `count` = nº de pares; refType
   * `DUPLICATE_CANDIDATE` con `refId` = la transacción más reciente del par.
   */
  countOpenDuplicatesInRange(input: ClosingRangeInput): Promise<ClosingFindingDto>;
  /**
   * Porciones `POSTED | CLEARED | RECONCILED` (asiento activo) del rango con la categoría de sistema *Uncategorized* o
   * *Uncategorized income* (D9). Transferencias y conversiones no cuentan. `count` = nº de porciones (refType `SPLIT`,
   * `refId` = id de la porción).
   */
  countUncategorizedInRange(input: ClosingRangeInput): Promise<ClosingFindingDto>;
  /**
   * Transacciones `RECONCILED` en modo `WITHOUT_STATEMENT` con fecha en el rango que tocan alguna de las cuentas
   * dadas (docs/33 D74/D111). `amount` = efecto neto con signo sobre esa cuenta (Σ de sus patas vigentes).
   */
  listReconciledWithoutStatementInRange(input: {
    readonly workspaceId: string;
    readonly accountIds: readonly string[];
    readonly dateFrom: string;
    readonly dateTo: string;
  }): Promise<
    readonly {
      readonly accountId: string;
      readonly transactionId: string;
      readonly businessDate: string;
      readonly amount: { readonly amount: string; readonly currency: string };
    }[]
  >;
  /** Cuentas con patas vigentes de transacciones no `VOIDED` ni `PENDING` con fecha en el rango. */
  listAccountIdsWithActivityInRange(input: ClosingRangeInput): Promise<readonly string[]>;
}

export interface ClosingRangeInput {
  readonly workspaceId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
}

export const TRANSACTIONS_CLOSING_QUERY = Symbol.for('pf.transactions.TransactionsClosingQuery');

// ───────────────────────────────────────────── add-recurrence-engine (COMMITMENTS)

/** Espacio de nombres de `externalRef` de las transacciones creadas por una ocurrencia recurrente. */
export const RECURRING_OCCURRENCE_NAMESPACE = 'commitments.occurrence' as const;

export type RecurringTransactionKindDto = 'INCOME' | 'EXPENSE' | 'TRANSFER';

/**
 * Puerto de escritura que usa COMMITMENTS para materializar una ocurrencia (design decisión 10; docs/06 relación 10):
 * crea un ingreso, gasto o transferencia con `source = RECURRING` y `externalRef = {commitments.occurrence, id}` en la
 * unidad de trabajo del llamador (transacción, ledger, outbox de Transactions, ocurrencia, auditoría y outbox de
 * COMMITMENTS se confirman juntos). Los errores de dominio (`PERIOD_CLOSED`, `ACCOUNT_CLOSED`,
 * `TRANSFER_CURRENCY_MISMATCH`…) se propagan sin traducir.
 */
export interface RecurringTransactionPort {
  record(input: {
    readonly workspaceId: string;
    /** Usuario que aprueba; vacío cuando la crea el worker (creación automática). */
    readonly userId: string;
    readonly kind: RecurringTransactionKindDto;
    readonly status: 'PENDING' | 'POSTED';
    readonly businessDate: string;
    readonly accountId: string;
    readonly toAccountId?: string | null;
    readonly amount: { readonly amount: string; readonly currency: string };
    readonly categoryId?: string | null;
    readonly counterpartyId?: string | null;
    readonly tagIds?: readonly string[];
    readonly description: string;
    readonly paymentMethod?: string | null;
    readonly occurrenceRef: { readonly occurrenceId: string; readonly definitionId: string };
  }): Promise<{
    readonly transactionId: string;
    readonly status: string;
    readonly businessDate: string;
  }>;
}

export const RECURRING_TRANSACTION_PORT = Symbol.for('pf.transactions.RecurringTransactionPort');

/** Transacción tal como la necesita COMMITMENTS para vincularla a una ocurrencia (matching manual). */
export interface TransactionLinkDto {
  readonly transactionId: string;
  readonly kind: string;
  readonly status: string;
  readonly businessDate: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly accountId: string;
  /** Cuenta destino de una transferencia; `null` en el resto. */
  readonly toAccountId: string | null;
  readonly counterpartyId: string | null;
  readonly source: string;
  readonly externalRef: { readonly namespace: string; readonly id: string } | null;
  /**
   * Revisión financiera vigente de la transacción (1 al registrarla; sube con cada `REVISE`). Aditivo
   * (openspec add-savings-goals, N2): Goals respalda cada aporte en `(transactionId, revision)`.
   */
  readonly revision: number;
}

export interface TransactionLinkQuery {
  /** `null` si no existe en el workspace. Toma `FOR SHARE` de la fila (anular toma `FOR UPDATE`). */
  getForLink(input: {
    readonly workspaceId: string;
    readonly transactionId: string;
  }): Promise<TransactionLinkDto | null>;
  /** Varias transacciones por id, SIN bloqueo (lectura para reportes); las inexistentes no figuran. */
  getManyForLink(input: {
    readonly workspaceId: string;
    readonly transactionIds: readonly string[];
  }): Promise<readonly TransactionLinkDto[]>;
  /**
   * Transacciones NO anuladas de ingreso, gasto o transferencia cuya cuenta de origen está en `accountIds` y cuya fecha
   * de negocio cae en `[from, to]` (inclusive), por fecha y id; SIN bloqueo (add-commitment-matching: backfill de
   * sugerencias). Aditivo.
   */
  listLinkCandidates(input: {
    readonly workspaceId: string;
    readonly accountIds: readonly string[];
    readonly from: string;
    readonly to: string;
  }): Promise<readonly TransactionLinkDto[]>;
}

export const TRANSACTION_LINK_QUERY = Symbol.for('pf.transactions.TransactionLinkQuery');

/** Transacción `PENDING` de egreso o ingreso (forma acordada con `add-upcoming-payments`). */
export interface PendingFlowRowDto {
  readonly transactionId: string;
  readonly kind: string;
  readonly businessDate: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly direction: 'IN' | 'OUT';
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly description: string | null;
  readonly source: string;
  readonly externalRef: { readonly namespace: string; readonly id: string } | null;
}

/** Solo transacciones `PENDING` (sin asiento); sin efectos; en la unidad de trabajo del llamador si existe. */
export interface PendingFlowQuery {
  listPending(input: {
    readonly workspaceId: string;
    readonly accountIds?: readonly string[];
    readonly dateFrom?: string;
    readonly dateTo?: string;
  }): Promise<readonly PendingFlowRowDto[]>;
}

export const PENDING_FLOW_QUERY = Symbol.for('pf.transactions.PendingFlowQuery');

// ───────────────────────────────────────────── add-credit-cards (DEBT)

/**
 * Clase de un movimiento sobre una cuenta de pasivo (tarjeta) para el resumen del ciclo (openspec add-credit-cards,
 * decisión 3 y 12): `PURCHASE` (gasto cargado a la cuenta, comisiones e intereses incluidos, y la pata origen de una
 * transferencia o conversión que SALE de la cuenta), `REFUND` (reembolso), `PAYMENT` (pata destino de una transferencia
 * o conversión que ENTRA a la cuenta) y `OTHER` (ajustes, saldo inicial, ingresos y cualquier otro movimiento).
 */
export type AccountMovementClassDto = 'PURCHASE' | 'REFUND' | 'PAYMENT' | 'OTHER';

export interface AccountMovementRowDto {
  readonly accountId: string;
  /** Fecha de negocio `YYYY-MM-DD` (de `DAY` y de `TRANSACTION`). */
  readonly businessDate: string;
  readonly movementClass: AccountMovementClassDto;
  /** Código de la categoría de sistema de la transacción (p. ej. `INTEREST_PAID`); `null` si no aplica. */
  readonly systemCategoryCode: string | null;
  /** Presente solo con `groupBy = 'TRANSACTION'`. */
  readonly transactionId: string | null;
  /**
   * Efecto sobre lo adeudado de la cuenta (saldo PRESENTADO de un pasivo), en la moneda de la cuenta: positivo
   * AUMENTA la deuda (`PURCHASE`, y `OTHER` de aumento) y negativo la REDUCE (`REFUND`, `PAYMENT` y `OTHER` de
   * reducción). Σ de las filas de un rango = variación del saldo presentado en el rango.
   */
  readonly amount: { readonly amount: string; readonly currency: string };
}

/**
 * Resumen de movimientos por cuenta, fecha y clase (solo transacciones con asiento activo: `POSTED`, `CLEARED`,
 * `RECONCILED`; nunca `PENDING` ni `VOIDED`). Sin efectos; en la unidad de trabajo del llamador si existe. Con
 * `groupBy = 'DAY'` suma por `(cuenta, fecha, clase, categoría de sistema)`; con `'TRANSACTION'` una fila por
 * transacción y clase. La clasificación vive aquí (Transactions es dueño de `kind` y de los roles de las patas).
 */
export interface AccountMovementsQuery {
  summarizeAccountMovements(input: {
    readonly workspaceId: string;
    readonly accountIds: readonly string[];
    /** Inclusivos, `YYYY-MM-DD`. */
    readonly dateFrom: string;
    readonly dateTo: string;
    readonly groupBy: 'DAY' | 'TRANSACTION';
  }): Promise<readonly AccountMovementRowDto[]>;
}

export const ACCOUNT_MOVEMENTS_QUERY = Symbol.for('pf.transactions.AccountMovementsQuery');

// ───────────────────────────────────────────── add-basic-csv-import (IMPORTS)

/** Espacio de nombres de `externalRef` de las transacciones creadas por una fila importada (huella de fila en hex). */
export const IMPORT_ROW_NAMESPACE = 'imports.csv-row' as const;

/** Formatos cuyo identificador del banco es una referencia externa (`imports.ext:<FORMAT>`, add-import-pipeline). */
export const IMPORT_EXTERNAL_FORMATS = ['CSV', 'OFX', 'QIF', 'JSON', 'XLSX'] as const;
export type ImportExternalFormat = (typeof IMPORT_EXTERNAL_FORMATS)[number];
/** Prefijo del espacio de nombres de las referencias con identificador del banco (FITID, referencia única). */
export const IMPORT_EXTERNAL_NAMESPACE_PREFIX = 'imports.ext:' as const;
export type ImportExternalNamespace = `imports.ext:${ImportExternalFormat}`;

export const importExternalNamespace = (format: ImportExternalFormat): ImportExternalNamespace =>
  `${IMPORT_EXTERNAL_NAMESPACE_PREFIX}${format}`;

/** ¿Es un espacio de nombres de referencia importada que `recordBatch` acepta? */
export function isImportRefNamespace(namespace: string): boolean {
  if (namespace === IMPORT_ROW_NAMESPACE) return true;
  return (
    namespace.startsWith(IMPORT_EXTERNAL_NAMESPACE_PREFIX) &&
    (IMPORT_EXTERNAL_FORMATS as readonly string[]).includes(
      namespace.slice(IMPORT_EXTERNAL_NAMESPACE_PREFIX.length),
    )
  );
}

export type ImportedMovementKind = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'CONVERSION';

export interface ImportedTransactionRowDto {
  /** Identificador de la fila en el llamador (el id del staging): se devuelve tal cual en el resultado. */
  readonly rowRef: string;
  /** Fecha de negocio `YYYY-MM-DD`. */
  readonly date: string;
  /** Sentido respecto de la cuenta del import: salida (`OUT`) o entrada (`IN`). */
  readonly direction: 'IN' | 'OUT';
  /**
   * Tipo de movimiento. Por omisión decide la dirección (`OUT` ⇒ gasto, `IN` ⇒ ingreso). `TRANSFER` y `CONVERSION`
   * mueven la cuenta del import contra `transfer.counterAccountId` / `conversion.counterAccountId` (con `OUT` la
   * cuenta del import es el origen; con `IN`, el destino) y se crean por los servicios de transferencias y
   * conversiones dentro del mismo lote.
   */
  readonly kind?: ImportedMovementKind;
  /** Monto positivo en la moneda de la cuenta (en una conversión, el monto en la moneda de la cuenta del import). */
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly description: string | null;
  readonly externalRef: { readonly namespace: string; readonly id: string };
  /**
   * Clasificación aprobada de la fila con su origen (openspec add-rule-engine). Ausente ⇒ el comportamiento de
   * Phase 3: «sin categoría» con origen `SYSTEM_DEFAULT`.
   */
  readonly classification?: ImportedClassificationDto;
  /** Obligatorio con `kind = 'TRANSFER'`. */
  readonly transfer?: { readonly counterAccountId: string };
  /** Obligatorio con `kind = 'CONVERSION'`. */
  readonly conversion?: {
    readonly counterAccountId: string;
    /** Monto en la moneda de la cuenta contraparte (su escala). */
    readonly counterAmount: { readonly amount: string; readonly currency: string };
    readonly fee?: { readonly amount: string; readonly currency: string };
    /** Tasa cotizada por la institución, `base`/`quote`/`value` exactos. */
    readonly quotedRate?: { readonly base: string; readonly quote: string; readonly value: string };
    /** Instante de ejecución (ISO 8601 con zona): la referencia de FX se resuelve a este instante. */
    readonly executedAt: string;
  };
}

/** Referencia de una regla a un campo del split (`field`: `TAG:<id>`, `COUNTERPARTY`, `CUSTOM_FIELD:<id>`, `DESCRIPTION`, `NOTES`). */
export interface RuleRefDto {
  readonly field: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
}

/** Origen de la categoría de un split; `UNKNOWN` para lo registrado antes de add-rule-engine. */
export type CategoryOriginDto = 'MANUAL' | 'RULE' | 'COUNTERPARTY_DEFAULT' | 'SYSTEM_DEFAULT' | 'UNKNOWN';

/**
 * Clasificación decidida de una fila importada (la vista previa del import la entrega ya resuelta, con su origen).
 * `categoryId = null` ⇒ la categoría de sistema «sin categoría» del tipo. Se valida con `ClassificationValidator` UNA vez
 * por lote (set-based).
 */
export interface ImportedClassificationDto {
  readonly categoryId: string | null;
  readonly categoryOrigin: 'RULE' | 'COUNTERPARTY_DEFAULT' | 'MANUAL' | 'SYSTEM_DEFAULT';
  /** Regla y versión cuando `categoryOrigin = RULE`. */
  readonly categoryRule?: { readonly ruleId: string; readonly ruleVersion: number } | null;
  readonly counterpartyId: string | null;
  readonly tagIds: readonly string[];
  readonly customFields: readonly {
    readonly fieldId?: string;
    readonly key?: string;
    readonly value: string | boolean | null;
  }[];
  /** Reemplazo visible de la descripción; el texto original queda en el staging. */
  readonly description?: string;
  readonly notes?: string;
  readonly needsReview: { readonly ruleId: string; readonly ruleVersion: number } | null;
  readonly ruleRefs: readonly RuleRefDto[];
}

/**
 * Registro en lote de transacciones importadas (design decisión 9 y 10 de add-basic-csv-import; add-import-pipeline lo
 * amplía con tipos de movimiento y clasificación). Corre en la unidad de trabajo del llamador (UNA transacción de BD
 * por lote): reutiliza el agregado, el traductor al ledger, la auditoría (`origin = import`, el actor del contexto de
 * la petición), el recorrido y el outbox de Transactions. Cada fila se crea como gasto (`OUT`) o ingreso (`IN`)
 * `POSTED` —o como transferencia o conversión entre cuentas propias— con `source = IMPORT` e `import_job_id`; sin
 * `classification` la categoría de sistema es «sin categoría» (D9). Las filas cuya referencia externa ya tiene una
 * transacción no anulada en la cuenta NO se crean: se informan en `alreadyExisting`. Un error de dominio
 * (`PERIOD_CLOSED`, `ACCOUNT_CLOSED`, …) se propaga y revierte todo el lote.
 */
export interface ImportedTransactionsCommand {
  recordBatch(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly importJobId: string;
    readonly actorUserId: string;
    readonly rows: readonly ImportedTransactionRowDto[];
  }): Promise<{
    readonly created: readonly { readonly rowRef: string; readonly transactionId: string }[];
    readonly alreadyExisting: readonly { readonly rowRef: string; readonly transactionId: string }[];
  }>;

  /**
   * Anula por conjunto las transacciones de un import (deshacer, add-import-pipeline decisión 15): reversa exacta de
   * sus asientos con `LedgerPostingPort.reverseJournalEntries` (INV-008), en la unidad de trabajo del llamador.
   * Idempotente: las ya anuladas se informan en `alreadyVoided`. Las que no se pueden anular (`TRANSACTION_RECONCILED`,
   * `PERIOD_CLOSED`, cuenta cerrada) se informan en `blocked` con `allowBlocked`; sin él se lanza el primer error.
   * Tope 1 000 por llamada. Transferencias y conversiones se anulan por el mismo conjunto de asientos.
   */
  voidBatch(input: {
    readonly workspaceId: string;
    /** Cuenta del import (informativa; el vínculo con el import lo da `importJobId`). */
    readonly accountId?: string;
    readonly importJobId: string;
    readonly actorUserId: string;
    readonly transactionIds: readonly string[];
    readonly reason: string;
    readonly allowBlocked?: boolean;
  }): Promise<{
    readonly voided: readonly string[];
    readonly alreadyVoided: readonly string[];
    readonly blocked: readonly { readonly transactionId: string; readonly code: string }[];
  }>;
}

/**
 * Conversiones importadas entre cuentas propias (add-import-pipeline decisión 12; el mismo comando lo usa
 * `add-banking-providers`). Cada conversión corre por `ConversionsService.recordConversion` (referencia de FX resuelta
 * al instante de ejecución, detalle inmutable, asiento propio) en la unidad de trabajo del llamador; es idempotente por
 * `externalRef` (INV-014). Para conversiones sueltas; `ImportedTransactionsCommand.recordBatch` con `kind =
 * 'CONVERSION'` las crea dentro de un lote mixto.
 */
export interface ImportedConversionsCommand {
  recordBatch(input: {
    readonly workspaceId: string;
    readonly importJobId: string;
    readonly actorUserId: string;
    readonly rows: readonly {
      readonly rowRef: string;
      readonly sourceAccountId: string;
      readonly targetAccountId: string;
      readonly date: string;
      readonly sourceAmount: { readonly amount: string; readonly currency: string };
      readonly targetAmount: { readonly amount: string; readonly currency: string };
      readonly fee?: { readonly amount: string; readonly currency: string };
      readonly quotedRate?: { readonly base: string; readonly quote: string; readonly value: string };
      readonly executedAt: string;
      readonly description: string | null;
      readonly externalRef: { readonly namespace: string; readonly id: string };
    }[];
  }): Promise<{
    readonly created: readonly { readonly rowRef: string; readonly transactionId: string }[];
    readonly alreadyExisting: readonly { readonly rowRef: string; readonly transactionId: string }[];
  }>;
}

export const IMPORTED_CONVERSIONS_COMMAND = Symbol.for('pf.transactions.ImportedConversionsCommand');

export const IMPORTED_TRANSACTIONS_COMMAND = Symbol.for('pf.transactions.ImportedTransactionsCommand');

export interface DuplicateCandidateDto {
  readonly transactionId: string;
  /** `INCOME`, `EXPENSE`, `REFUND`, `ADJUSTMENT`, `TRANSFER` o `CONVERSION`. */
  readonly kind: string;
  readonly status: string;
  readonly date: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly description: string | null;
  readonly counterpartyId: string | null;
  /**
   * Puntaje de posible duplicado (texto decimal con 4 decimales, `0.9000`) de la fila contra este candidato; solo si
   * la fila trae `scoring` (add-import-pipeline). Los candidatos de una fila vienen ordenados por puntaje descendente,
   * menor diferencia de días e identificador.
   */
  readonly score?: string;
  readonly signals?: {
    readonly amount: string;
    readonly date: string;
    readonly description: string;
    readonly counterparty: string;
    readonly origin: string;
  };
  /** El candidato tiene un identificador del banco (`imports.ext:*` o `imports.provider:*`). */
  readonly hasBankExternalRef?: boolean;
}

/**
 * Candidatos a duplicado para un lote de filas (docs/13 §8; ventana de `transactions/duplicate-detection`). Set-based:
 * movimientos NO anulados de la cuenta —transacciones `INCOME/EXPENSE/REFUND/ADJUSTMENT` y PATAS de `TRANSFER` y
 * `CONVERSION` sobre la cuenta— del mismo monto y moneda, en la misma dirección y con fecha a ±`windowDays`. No exige
 * similitud de descripción. Con `description`/`counterpartyId`/`externalId` en la fila (add-import-pipeline) cada
 * candidato trae su `score` y `signals`, y la lista sale ordenada. Sin efectos; en la unidad de trabajo del llamador
 * si existe.
 */
export interface DuplicateCandidatesQuery {
  findForImport(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly rows: readonly {
      readonly rowRef: string;
      readonly date: string;
      readonly direction: 'IN' | 'OUT';
      readonly amount: { readonly amount: string; readonly currency: string };
      readonly description?: string | null;
      readonly counterpartyId?: string | null;
      /** Identificador del banco de la fila (FITID / referencia única). */
      readonly externalId?: string | null;
      /** `true` ⇒ calcular `score`/`signals` aunque la fila no traiga descripción. Por omisión, calcula si hay alguno de los campos anteriores. */
      readonly scoring?: boolean;
    }[];
    readonly windowDays: number;
    readonly excludeTransactionIds?: readonly string[];
  }): Promise<readonly { readonly rowRef: string; readonly candidates: readonly DuplicateCandidateDto[] }[]>;
}

export const DUPLICATE_CANDIDATES_QUERY = Symbol.for('pf.transactions.DuplicateCandidatesQuery');

/** Estado actual de transacciones por id (vínculos superados de IMPORTS: una anulada libera su huella). */
export interface TransactionStatusQuery {
  statusOf(input: {
    readonly workspaceId: string;
    readonly transactionIds: readonly string[];
  }): Promise<readonly { readonly transactionId: string; readonly status: string }[]>;
}

export const TRANSACTION_STATUS_QUERY = Symbol.for('pf.transactions.TransactionStatusQuery');

/** Ventana de días de la detección de duplicados (`transactions/duplicate-detection`, ±3 días). */
export const DUPLICATE_WINDOW_DAYS_DEFAULT = 3;

// ───────────────────────────────────────────── add-loans (DEBT)

/** `externalRef` del desembolso: el id del préstamo. */
export const LOAN_DISBURSEMENT_NAMESPACE = 'debt.loan' as const;
/** `externalRef` de un pago: el id del pago del préstamo (`debt.loan_payment`). */
export const LOAN_PAYMENT_NAMESPACE = 'debt.loan-payment' as const;

/** Desglose de un pago de préstamo (docs/04 §3.6): montos decimales a la escala de la moneda; Σ = monto pagado. */
export interface LoanPaymentBreakdownDto {
  readonly loanId: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
}

/**
 * Puerto de escritura de DEBT sobre TRANSACTIONS (openspec add-loans, design decisiones 5, 8 y 10). Corre en la
 * unidad de trabajo del llamador (transacción, ledger, auditoría y outbox de Transactions se confirman junto con los
 * del préstamo). Los errores de dominio (`PERIOD_CLOSED`, `ACCOUNT_CLOSED`, `CURRENCY_MISMATCH`…) se propagan sin
 * traducir. Las transacciones creadas son `source = DEBT` y quedan administradas (`TRANSACTION_MANAGED_EXTERNALLY`).
 */
export interface LoanTransactionsPort {
  /**
   * `LOAN_DISBURSEMENT` POSTED: pata `TARGET` en `destinationAccountId` por `principal − retainedFee`, pata `SOURCE` en
   * `loanAccountId` por `principal` (aumenta la deuda) y, si `retainedFee > 0`, split de la categoría de sistema
   * `LOAN_FEES` por la comisión con su pata de gasto (asiento EXPENSE + ASSET + LIABILITY, docs/09 §6.9).
   * `externalRef = {debt.loan, loanId}`.
   */
  recordDisbursement(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly loanId: string;
    readonly businessDate: string;
    readonly loanAccountId: string;
    readonly destinationAccountId: string;
    readonly principal: { readonly amount: string; readonly currency: string };
    /** `"0.00"` (o ausente) si no hay comisión retenida. */
    readonly retainedFee?: string | null;
    readonly counterpartyId?: string | null;
    readonly description: string;
  }): Promise<{ readonly transactionId: string; readonly businessDate: string }>;
  /**
   * `LOAN_PAYMENT` POSTED: pata `SOURCE` en `paymentAccountId` por `−amount`, pata `TARGET` en `loanAccountId` por
   * `+principal` (omitida si el principal es 0) y un split por cada componente no nulo con la categoría de sistema
   * `INTEREST`, `LOAN_FEES`, `INSURANCE` o `TAXES`; Σ splits = amount − principal. Guarda `breakdown` en la transacción.
   * `externalRef = {debt.loan-payment, paymentId}`.
   */
  recordPayment(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly paymentId: string;
    readonly businessDate: string;
    readonly paymentAccountId: string;
    readonly loanAccountId: string;
    readonly amount: { readonly amount: string; readonly currency: string };
    readonly breakdown: LoanPaymentBreakdownDto;
    readonly paymentMethod?: string | null;
    readonly counterpartyId?: string | null;
    readonly description: string;
  }): Promise<{ readonly transactionId: string; readonly businessDate: string }>;
  /** Anula una transacción administrada (reversa del asiento); idempotente si ya está anulada. */
  voidManaged(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly transactionId: string;
    readonly reason: string;
  }): Promise<void>;
}

export const LOAN_TRANSACTIONS_PORT = Symbol.for('pf.transactions.LoanTransactionsPort');

// ───────────────────────────────────────────── add-savings-goals (GOALS)

/** `externalRef` de las transferencias creadas por una meta: el id del movimiento de la meta (`goals.goal_movement`). */
export const GOAL_MOVEMENT_NAMESPACE = 'goals.movement' as const;

/**
 * Puerto de escritura de GOALS sobre TRANSACTIONS (openspec add-savings-goals, decisión 3 y N1). Corre en la unidad
 * de trabajo del llamador (transferencia, asiento del ledger, auditoría y outbox de Transactions se confirman junto
 * con el movimiento de la meta). Crea una transferencia `POSTED` con `source = GOAL` y
 * `externalRef = {goals.movement, movementId}`; los errores de dominio (`PERIOD_CLOSED`, `ACCOUNT_CLOSED`,
 * `ACCOUNT_ARCHIVED`, `TRANSFER_CURRENCY_MISMATCH`, `TRANSFER_SAME_ACCOUNT`) se propagan sin traducir. A diferencia de
 * las transacciones de DEBT, quedan editables y anulables desde Transactions: Goals reacciona a esos hechos.
 */
export interface GoalTransferPort {
  recordTransfer(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly businessDate: string;
    readonly fromAccountId: string;
    readonly toAccountId: string;
    readonly amount: { readonly amount: string; readonly currency: string };
    readonly description: string;
    readonly goalRef: { readonly goalId: string; readonly movementId: string };
  }): Promise<{
    readonly transactionId: string;
    readonly businessDate: string;
    /** Revisión vigente de la transferencia recién creada (1). */
    readonly revision: number;
  }>;
}

export const GOAL_TRANSFER_PORT = Symbol.for('pf.transactions.GoalTransferPort');

/** Tasa `1 base = value quote` de un `ConversionDetail` (decimal exacto como texto). */
export interface ConversionRateDto {
  readonly base: string;
  readonly quote: string;
  readonly value: string;
}

/**
 * Revisión vigente de una conversión con el detalle que necesita el análisis de costo (add-conversion-cost-analysis,
 * D245): fecha de negocio, ejecución, cuentas, contraparte, montos, tasas, spread registrado y fees. Montos y tasas como
 * decimales exactos; `effectiveRate` está en la orientación de visualización del par.
 */
export interface ConversionCostRowDto {
  readonly transactionId: string;
  /** Revisión vigente del `ConversionDetail` (la de la transacción). */
  readonly revision: number;
  readonly businessDate: string;
  readonly executedAt: string;
  /** `true` si la transacción fue anulada (solo con `includeVoided`). */
  readonly voided: boolean;
  readonly sourceAccountId: string;
  readonly targetAccountId: string;
  readonly counterparty: { readonly counterpartyId: string | null; readonly name: string | null };
  /** Bruto entregado. */
  readonly sourceAmount: FlowMoneyDto;
  /** Bruto entregado menos los fees descontados en moneda origen. */
  readonly convertedSourceAmount: FlowMoneyDto;
  /** Neto recibido más los fees descontados en moneda destino. */
  readonly grossTargetAmount: FlowMoneyDto;
  /** Neto recibido. */
  readonly targetAmount: FlowMoneyDto;
  readonly quotedRate: ConversionRateDto | null;
  readonly effectiveRate: ConversionRateDto;
  /** Referencia registrada (versión exacta, en su orientación almacenada); `null` si no se registró una. */
  readonly referenceRate: {
    readonly rate: ConversionRateDto;
    readonly fxRateId: string;
    readonly source: string;
    readonly rateType: string | null;
    readonly asOf: string | null;
  } | null;
  /** Spread registrado: `percentage` con signo (positivo = desfavorable) y `amount` absoluto en la moneda quote. */
  readonly spread: { readonly percentage: string; readonly amount: FlowMoneyDto } | null;
  readonly fees: readonly {
    readonly type: string;
    readonly amount: FlowMoneyDto;
    readonly paidFromAccountId: string | null;
  }[];
}

/**
 * Query pública `ConversionDetailQuery` (add-conversion-cost-analysis, D245; sin efectos, en la unidad de trabajo del
 * llamador si existe): la REVISIÓN VIGENTE de las conversiones con asiento activo (`POSTED | CLEARED | RECONCILED`)
 * cuya fecha de negocio cae en `[from, to]`; nunca las pendientes. Con `includeVoided` incluye también las anuladas
 * (marcadas `voided`), para la carga inicial de observaciones de FX.
 */
export interface ConversionDetailQuery {
  listForCostAnalysis(input: {
    readonly workspaceId: string;
    /** Rango inclusivo de fechas de negocio `YYYY-MM-DD`. */
    readonly from: string;
    readonly to: string;
    readonly includeVoided?: boolean;
  }): Promise<readonly ConversionCostRowDto[]>;
}

export const CONVERSION_DETAIL_QUERY = Symbol.for('pf.transactions.ConversionDetailQuery');

// ───────────────────────────────────────────── add-rule-engine (RULES)

/** Sujeto de clasificación: una transacción de ingreso, gasto o reembolso no anulada, con lo que las reglas evalúan. */
export interface ClassificationSubjectDto {
  readonly transactionId: string;
  /** Versión de la transacción (control optimista de la aplicación). */
  readonly version: number;
  readonly status: string;
  /** Contexto que administra la transacción (`TRANSACTION_MANAGED_EXTERNALLY`), o `null`. */
  readonly managedBy: 'DEBT' | 'GOAL' | null;
  /** Fecha de negocio `YYYY-MM-DD`. */
  readonly date: string;
  readonly kind: 'INCOME' | 'EXPENSE' | 'REFUND';
  readonly accountId: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly description: string | null;
  readonly notes: string | null;
  readonly counterpartyId: string | null;
  /** `null` ⇒ «sin categoría» (categoría de sistema). */
  readonly categoryId: string | null;
  readonly categoryOrigin: CategoryOriginDto;
  readonly tagIds: readonly string[];
  /** `source` y espacio de nombres de la referencia externa (`IMPORT`, `imports.csv-row`…). */
  readonly externalSource: string | null;
  readonly customFields: readonly { readonly fieldId: string; readonly value: string | boolean }[];
  readonly splitCount: number;
  readonly needsReview: boolean;
}

/**
 * Sujetos de clasificación para RULES (dry-run, aplicación y vista previa). Sin efectos; en la unidad de trabajo del
 * llamador si existe. `list` recorre por keyset `(fecha, id)`, hasta 5 000, solo `INCOME`/`EXPENSE`/`REFUND` no anuladas.
 */
export interface ClassificationSubjectsQuery {
  list(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
    readonly accountIds?: readonly string[];
    readonly limit: number;
    /** Cursor opaco devuelto por la llamada anterior. */
    readonly after?: string;
  }): Promise<{ readonly items: readonly ClassificationSubjectDto[]; readonly next: string | null }>;
  /** Por id (las inexistentes, anuladas o de otro tipo no figuran). */
  byIds(input: {
    readonly workspaceId: string;
    readonly transactionIds: readonly string[];
  }): Promise<readonly ClassificationSubjectDto[]>;
}

export const CLASSIFICATION_SUBJECTS_QUERY = Symbol.for('pf.transactions.ClassificationSubjectsQuery');

export interface RuleAppliedChangesDto {
  readonly categoryId?: string;
  readonly addTagIds?: readonly string[];
  readonly removeTagIds?: readonly string[];
  readonly counterpartyId?: string;
  readonly customFields?: readonly { readonly fieldId: string; readonly value: string | boolean }[];
  readonly description?: string;
  readonly appendNotes?: readonly string[];
  readonly markForReview?: boolean;
}

export interface RuleClassificationItemDto {
  readonly transactionId: string;
  readonly expectedVersion: number;
  readonly changes: RuleAppliedChangesDto;
  /** Regla y versión de la categoría (si cambia). */
  readonly categoryRule?: { readonly ruleId: string; readonly ruleVersion: number };
  /** Regla y versión de cada otro campo cambiado. */
  readonly ruleRefs: readonly RuleRefDto[];
  /** Regla y versión que marca la revisión (si `markForReview`). */
  readonly reviewRule?: { readonly ruleId: string; readonly ruleVersion: number };
}

/**
 * Aplicación atómica de clasificación por reglas (dry-run, openspec add-rule-engine decisión 10). Reutiliza el dominio de
 * la edición masiva: versión por ítem, periodos cerrados no aplicables (`PERIOD_CLOSED`), un `bulkOperationId` común en
 * la auditoría y origen `RULE`. Lanza `CONCURRENCY_CONFLICT` si la versión de un ítem no coincide (todo o nada).
 */
export interface RuleClassificationCommand {
  applyBatch(input: {
    readonly workspaceId: string;
    readonly actorUserId: string;
    readonly operationId: string;
    readonly items: readonly RuleClassificationItemDto[];
  }): Promise<{
    readonly applied: readonly string[];
    readonly notApplicable: readonly { readonly transactionId: string; readonly reason: string }[];
  }>;
}

export const RULE_CLASSIFICATION_COMMAND = Symbol.for('pf.transactions.RuleClassificationCommand');

export interface ClassificationCoverageRuleDto {
  readonly ruleId: string;
  readonly ruleVersion: number | null;
  readonly count: number;
  /** Instante ISO de la última transacción clasificada (por `updated_at`). */
  readonly lastAppliedAt: string | null;
}

/**
 * Cobertura de clasificación (D334): universo = `INCOME`/`EXPENSE`/`REFUND` con `source = IMPORT` no anuladas, por rango
 * de fecha de negocio o por import; cuenta cada origen VIGENTE del split (una corrección manual saca la transacción del
 * numerador `RULE`). Una consulta agregada.
 */
export interface ClassificationCoverageQuery {
  coverage(input: {
    readonly workspaceId: string;
    readonly from?: string;
    readonly to?: string;
    readonly importJobId?: string;
  }): Promise<{
    readonly count: number;
    readonly byOrigin: Readonly<Record<CategoryOriginDto, number>>;
    readonly byRule: readonly ClassificationCoverageRuleDto[];
  }>;
  /** Estadísticas por regla en todo el workspace (clasificadas hoy y última aplicación). */
  ruleStats(input: { readonly workspaceId: string }): Promise<readonly ClassificationCoverageRuleDto[]>;
}

export const CLASSIFICATION_COVERAGE_QUERY = Symbol.for('pf.transactions.ClassificationCoverageQuery');

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
    // Préstamos (add-loans): préstamo que administra la transacción y principal del pago.
    loanId: 'plain',
    principal: 'money',
    // Custom fields de los splits (add-custom-fields): un campo `customFields.<clave>` por clave que cambió.
    'customFields.*': 'plain',
    // Origen de la clasificación y marca de revisión (add-rule-engine): `ruleRefs` viaja como texto JSON.
    categoryOrigin: 'plain',
    categoryRuleId: 'plain',
    categoryRuleVersion: 'plain',
    ruleRefs: 'plain',
    needsReview: 'plain',
    reviewReason: 'plain',
    reviewRuleId: 'plain',
    reviewRuleVersion: 'plain',
  },
  // Operación de edición masiva (add-bulk-edit): registro agregado; `requestedChanges` viaja como texto JSON.
  TransactionBulkOperation: {
    bulkOperationId: 'plain',
    count: 'plain',
    requestedCount: 'plain',
    requestedChanges: 'plain',
    transactionIds: 'plain',
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

export * from './portability.js';
export * from './duplicate-confidence.js';

// ───────────────────────────────────────────── add-document-attachments (DOCUMENTS)

/**
 * Existencia de transacciones y conversiones del workspace (consulta aditiva para los adjuntos de DOCUMENTS). Una
 * transacción anulada también existe: un comprobante de una transacción anulada sigue siendo evidencia.
 */
export interface TransactionExistenceQuery {
  existingTransactions(workspaceId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
  existingConversions(workspaceId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
}
