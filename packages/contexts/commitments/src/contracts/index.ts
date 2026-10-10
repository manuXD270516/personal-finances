/**
 * API pública de `@pf/commitments` (openspec add-recurrence-engine § Contratos; ADR-0003). Hoja: no importa capas
 * internas. Montos como `{amount: "<decimal>", currency: "<código>"}` (nunca `number`, ADR-0006).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

export const COMMITMENTS_CONTEXT = 'commitments' as const;

/** Eventos publicados por el outbox (contracts/events/commitments/*.v1.schema.json). */
export const COMMITMENTS_EVENTS = {
  occurrencesGenerated: { eventType: 'commitments.OccurrencesGenerated', eventVersion: 1 },
  occurrenceDue: { eventType: 'commitments.RecurringOccurrenceDue', eventVersion: 1 },
  occurrenceMaterialized: { eventType: 'commitments.RecurringOccurrenceMaterialized', eventVersion: 1 },
  occurrenceChanged: { eventType: 'commitments.RecurringOccurrenceChanged', eventVersion: 1 },
  definitionChanged: { eventType: 'commitments.RecurringDefinitionChanged', eventVersion: 1 },
  // add-subscriptions (Phase 3)
  subscriptionPriceChanged: { eventType: 'commitments.SubscriptionPriceChanged', eventVersion: 1 },
  subscriptionRenewalUpcoming: { eventType: 'commitments.SubscriptionRenewalUpcoming', eventVersion: 1 },
  subscriptionTrialEnding: { eventType: 'commitments.SubscriptionTrialEnding', eventVersion: 1 },
  subscriptionCancelled: { eventType: 'commitments.SubscriptionCancelled', eventVersion: 1 },
  // add-commitment-matching (Phase 3)
  occurrenceMatchSuggested: { eventType: 'commitments.OccurrenceMatchSuggested', eventVersion: 1 },
} as const;

/** Consumidores del worker (colas propias, lotes de improve-event-throughput). */
export const COMMITMENTS_CONSUMERS = {
  transactionVoided: 'commitments.transaction-voided',
  /** add-subscriptions: cargos de suscripciones (detección de cambios de precio). */
  subscriptionCharges: 'commitments.subscription-charges',
  /** add-commitment-matching: `TransactionCreated/Updated/Voided.v1` ⇒ sugerencias de coincidencia. */
  occurrenceMatcher: 'commitments.occurrence-matcher',
  /** add-commitment-matching: `OccurrencesGenerated.v1` y `RecurringDefinitionChanged.v1` ⇒ transacciones ya registradas. */
  matchBackfill: 'commitments.match-backfill',
} as const;

/** Job periódico de suscripciones (add-subscriptions): fin de trial, cancelación programada y recordatorios. */
export const COMMITMENTS_SUBSCRIPTION_JOB = 'commitments.subscription-daily' as const;

/** Job periódico del worker (cron `COMMITMENTS_SCHEDULER_CRON`). */
export const COMMITMENTS_GENERATE_JOB = 'commitments.generate-occurrences' as const;

export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export type RecurringKindDto = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type ManagedByDto = 'USER' | 'SUBSCRIPTION' | 'DEBT';
export type OccurrenceStatusDto =
  | 'SCHEDULED'
  | 'DUE'
  | 'OVERDUE'
  | 'MATERIALIZED'
  | 'MATCHED'
  | 'SKIPPED'
  | 'CANCELLED';
export type AmountTypeDto = 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE';

/** Monto esperado: texto decimal a la escala de la moneda; `null` según el tipo. */
export interface ExpectedAmountDto {
  readonly type: AmountTypeDto;
  readonly amount: string | null;
  readonly min: string | null;
  readonly max: string | null;
  readonly currency: string;
}

// ───────────────────────────────────────────── eventos (payloads)

export interface OccurrencesGeneratedV1 {
  readonly workspaceId: string;
  readonly definitionId: string;
  readonly definitionVersionNo: number;
  readonly window: { readonly from: string; readonly to: string };
  readonly occurrences: readonly {
    readonly occurrenceId: string;
    readonly occurrenceDate: string;
    readonly dueDate: string;
    readonly expected: {
      readonly type: AmountTypeDto;
      readonly amount: string | null;
      readonly min: string | null;
      readonly max: string | null;
    };
    readonly currency: string;
    readonly kind: RecurringKindDto;
  }[];
}

export interface RecurringOccurrenceDueV1 {
  readonly workspaceId: string;
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly name: string;
  readonly kind: RecurringKindDto;
  readonly occurrenceDate: string;
  readonly dueDate: string;
  readonly expected: {
    readonly type: AmountTypeDto;
    readonly amount: string | null;
    readonly min: string | null;
    readonly max: string | null;
  };
  readonly currency: string;
  readonly requiresApproval: boolean;
  readonly mode: 'AUTO_CREATE' | 'PENDING_APPROVAL' | 'NOTIFY_ONLY';
  readonly managedBy: ManagedByDto;
  /** Periodo financiero del vencimiento (para el enlace de la notificación); `null` si ninguno lo cubre. */
  readonly periodId: string | null;
}

export interface RecurringOccurrenceMaterializedV1 {
  readonly workspaceId: string;
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly occurrenceDate: string;
  readonly managedBy: ManagedByDto;
  readonly transactionId: string;
  readonly mode: 'CREATED' | 'MATCHED';
  readonly matchedBy: 'USER_LINK' | 'SUGGESTION' | null;
  readonly amount: MoneyDto;
  readonly businessDate: string;
}

export type MatchConfidenceDto = 'HIGH' | 'MEDIUM' | 'LOW';
export type MatchCounterpartyDto = 'MATCH' | 'UNKNOWN';

/** Sugerencia de coincidencia creada o re-propuesta (`commitments.OccurrenceMatchSuggested.v1`). */
export interface OccurrenceMatchSuggestedV1 {
  readonly workspaceId: string;
  readonly suggestionId: string;
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly transactionId: string;
  /** 0..100 con 2 decimales (texto). */
  readonly score: string;
  readonly confidence: MatchConfidenceDto;
  /** Diferencia absoluta de monto; `null` si la ocurrencia es `VARIABLE`. */
  readonly amountDelta: MoneyDto | null;
  readonly dateDeltaDays: number;
  readonly ambiguous: boolean;
  /** Origen de la transacción (`MANUAL`, `IMPORT`, …). */
  readonly transactionOrigin: string;
}

// ───────────────────────────────────────────── eventos de suscripciones (add-subscriptions)

export type SubscriptionPriceOriginDto = 'DETECTED' | 'MANUAL' | 'CORRECTION';

export interface SubscriptionPriceChangedV1 {
  readonly workspaceId: string;
  readonly subscriptionId: string;
  readonly definitionId: string;
  readonly counterpartyId: string;
  readonly providerName: string;
  readonly previousPrice: MoneyDto;
  readonly newPrice: MoneyDto;
  readonly effectiveFrom: string;
  /** Variación con signo y 2 decimales (`+20.02`). */
  readonly changePercentage: string;
  readonly origin: SubscriptionPriceOriginDto;
  readonly proposalId: string | null;
  readonly chargeId: string | null;
  readonly transactionId: string | null;
}

export interface SubscriptionRenewalUpcomingV1 {
  readonly workspaceId: string;
  readonly subscriptionId: string;
  readonly definitionId: string;
  readonly providerName: string;
  readonly planName: string | null;
  readonly renewalDate: string;
  readonly daysBefore: number;
  readonly expectedPrice: MoneyDto;
  /** Cargo esperado en la moneda de la cuenta; `null` si es un precio indexado sin tasa o aún no hay ocurrencia. */
  readonly expectedCharge: MoneyDto | null;
  readonly paymentAccountId: string;
  readonly paymentAccountName: string;
  readonly requiresApproval: boolean;
}

export interface SubscriptionTrialEndingV1 {
  readonly workspaceId: string;
  readonly subscriptionId: string;
  readonly definitionId: string;
  readonly providerName: string;
  readonly trialEndsOn: string;
  readonly daysBefore: number;
  readonly firstChargePrice: MoneyDto;
  readonly paymentAccountId: string;
  readonly paymentAccountName: string;
}

export interface SubscriptionCancelledV1 {
  readonly workspaceId: string;
  readonly subscriptionId: string;
  readonly definitionId: string;
  readonly counterpartyId: string;
  readonly cancelledOn: string;
  readonly scheduled: boolean;
  readonly reason: string | null;
}

/** Suscripción activa para lectores futuros (Reporting, Planning). */
export interface ActiveSubscriptionDto {
  readonly subscriptionId: string;
  readonly name: string;
  readonly status: 'TRIAL' | 'ACTIVE' | 'PAUSED';
  readonly price: MoneyDto;
  readonly cadence: string;
  readonly interval: number;
  readonly paymentAccountId: string;
  readonly nextRenewalOn: string | null;
}

export interface SubscriptionsQuery {
  listActive(input: { readonly workspaceId: string }): Promise<readonly ActiveSubscriptionDto[]>;
}

// ───────────────────────────────────────────── consultas públicas

export interface CommittedItemDto {
  readonly source: 'OCCURRENCE' | 'PENDING';
  /** `occurrenceId` o `transactionId` según `source`. */
  readonly id: string;
  readonly definitionId: string | null;
  readonly name: string | null;
  readonly kind: string;
  /** Vencimiento (ocurrencia) o fecha de negocio (pendiente). */
  readonly date: string;
  /** Monto que suma (máximo en `MIN_MAX`); `null` si es `VARIABLE`. */
  readonly amount: MoneyDto | null;
  readonly status: OccurrenceStatusDto | null;
}

/**
 * Comprometido de un rango en montos NATIVOS por moneda (la API consolida con la valoración de Reporting). Lo consume
 * Reporting (Q4, `add-upcoming-payments`). Lectura directa de la fuente de verdad (RISK-022).
 */
export interface CommittedRangeDto {
  readonly fromCommitments: readonly MoneyDto[];
  readonly fromPending: readonly MoneyDto[];
  readonly withoutAmountCount: number;
  readonly expectedIncome: readonly MoneyDto[];
  /** Ocurrencias de egreso sin resolver con vencimiento anterior al rango (atrasadas de periodos previos). */
  readonly overdueBefore: { readonly count: number; readonly amounts: readonly MoneyDto[] };
  readonly items: readonly CommittedItemDto[];
}

export interface CommittedQuery {
  getForRange(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<CommittedRangeDto>;
}

/** Pago próximo (egreso sin resolver de cualquier antigüedad con vencimiento ≤ `through`; D127). */
export interface UpcomingPaymentDto {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly kind: RecurringKindDto;
  readonly occurrenceDate: string;
  readonly dueDate: string;
  readonly status: 'SCHEDULED' | 'DUE' | 'OVERDUE';
  readonly requiresApproval: boolean;
  readonly expected: ExpectedAmountDto;
  /** Monto proyectado (máximo en `MIN_MAX`); `null` si es `VARIABLE`. */
  readonly projected: MoneyDto | null;
  readonly accountId: string;
  readonly toAccountId: string | null;
}

export interface UpcomingPaymentsQuery {
  listUpcoming(input: {
    readonly workspaceId: string;
    /** Fecha límite inclusiva (`YYYY-MM-DD`). */
    readonly through: string;
  }): Promise<readonly UpcomingPaymentDto[]>;
}

/** Egreso resuelto por una transacción no anulada (insumo de SM-07 de Reporting). */
export interface ResolvedOutflowDto {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  /** Instante en que se generó la ocurrencia. */
  readonly generatedAt: string;
  readonly resolution: 'MATERIALIZED' | 'MATCHED';
  readonly matchedBy: 'USER_LINK' | 'SUGGESTION' | null;
  readonly transactionId: string;
  readonly transactionDate: string;
  readonly amount: MoneyDto;
}

export interface ResolvedOccurrencesQuery {
  listResolvedOutflows(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<readonly ResolvedOutflowDto[]>;
}

export interface DefinitionStatsQuery {
  hasActiveDefinitions(input: { readonly workspaceId: string }): Promise<boolean>;
}

/**
 * Reservado para Debt (`DEBT`). Las suscripciones (`managedBy = SUBSCRIPTION`) operan su definición dentro del
 * contexto con `ManagedDefinitionPort` (application) sobre `DefinitionsService`, sin pasar por la API de usuario
 * (openspec add-subscriptions); este tipo público sigue sin implementación.
 */
export interface RecurringDefinitionPort {
  createManaged(input: {
    readonly workspaceId: string;
    readonly managedBy: Exclude<ManagedByDto, 'USER'>;
    readonly managedRef: string;
    readonly definition: Record<string, unknown>;
  }): Promise<{ readonly definitionId: string }>;
}

/**
 * Vincula una transacción existente a una ocurrencia dentro de la unidad de trabajo del llamador (la usan
 * `add-commitment-matching` al confirmar una sugerencia y, en Phase 6, Imports).
 */
export interface OccurrenceLinkPort {
  link(input: {
    readonly workspaceId: string;
    readonly occurrenceId: string;
    readonly transactionId: string;
    readonly matchedBy: 'USER_LINK' | 'SUGGESTION';
    readonly userId: string;
  }): Promise<{ readonly occurrenceId: string; readonly transactionId: string }>;
}

/** Candidata de una fila de import: la ocurrencia compatible con su puntaje, confianza y motivos. */
export interface MatchCandidateDto {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly dueDate: string;
  readonly expected: ExpectedAmountDto;
  readonly score: string;
  readonly confidence: MatchConfidenceDto;
  readonly amountDelta: MoneyDto | null;
  readonly dateDeltaDays: number;
  readonly counterparty: MatchCounterpartyDto;
  readonly ambiguous: boolean;
}

/**
 * Candidatas para filas aún no registradas (vista previa de un import, Phase 6; openspec add-commitment-matching,
 * decisión 10): solo lectura, SIN persistir sugerencias, máximo 500 filas por llamada.
 */
export interface OccurrenceMatchCandidatesQuery {
  findCandidates(input: {
    readonly workspaceId: string;
    readonly rows: readonly {
      readonly rowRef: string;
      readonly kind: RecurringKindDto;
      readonly accountId: string;
      readonly toAccountId?: string | null;
      readonly amount: MoneyDto;
      readonly businessDate: string;
      readonly counterpartyId?: string | null;
    }[];
  }): Promise<readonly { readonly rowRef: string; readonly candidates: readonly MatchCandidateDto[] }[]>;
}

/** Máximo de filas por llamada a `OccurrenceMatchCandidatesQuery.findCandidates`. */
export const MAX_MATCH_CANDIDATE_ROWS = 500;

export const COMMITTED_QUERY = Symbol.for('pf.commitments.CommittedQuery');
export const UPCOMING_PAYMENTS_QUERY = Symbol.for('pf.commitments.UpcomingPaymentsQuery');
export const RESOLVED_OCCURRENCES_QUERY = Symbol.for('pf.commitments.ResolvedOccurrencesQuery');
export const DEFINITION_STATS_QUERY = Symbol.for('pf.commitments.DefinitionStatsQuery');
export const OCCURRENCE_LINK_PORT = Symbol.for('pf.commitments.OccurrenceLinkPort');
export const OCCURRENCE_MATCH_CANDIDATES_QUERY = Symbol.for('pf.commitments.OccurrenceMatchCandidatesQuery');

/**
 * Allow-list de auditoría de COMMITMENTS (add-audit-trail, NFR-SEC-015): montos exactos (`money`); los valores
 * compuestos (tags, días del mes) viajan como texto JSON. Lo no listado nunca se copia a `audit.audit_log`.
 */
export const COMMITMENTS_AUDIT_POLICY = {
  RecurringDefinition: {
    name: 'plain',
    description: 'plain',
    notes: 'plain',
    kind: 'plain',
    managedBy: 'plain',
    status: 'plain',
    versionNo: 'plain',
    effectiveFrom: 'plain',
    endDate: 'plain',
    accountId: 'plain',
    toAccountId: 'plain',
    amountType: 'plain',
    amount: 'money',
    amountMin: 'money',
    amountMax: 'money',
    indexedPrice: 'plain',
    categoryId: 'plain',
    counterpartyId: 'plain',
    tagIds: 'plain',
    paymentMethod: 'plain',
    cadence: 'plain',
    interval: 'plain',
    monthDays: 'plain',
    rrule: 'plain',
    startDate: 'plain',
    maxOccurrences: 'plain',
    weekendAdjustment: 'plain',
    materializationMode: 'plain',
    autoCreateStatus: 'plain',
    leadDays: 'plain',
    cancelledOccurrences: 'plain',
    reinstatedOccurrences: 'plain',
    rewrittenOccurrences: 'plain',
    resetOverrides: 'plain',
    // add-commitment-matching: tolerancias del matching sugerido (anotación de la definición).
    matchingAmountTolerancePct: 'plain',
    matchingDateWindowDays: 'plain',
  },
  RecurringOccurrence: {
    definitionId: 'plain',
    occurrenceDate: 'plain',
    dueDate: 'plain',
    status: 'plain',
    definitionVersionNo: 'plain',
    amountType: 'plain',
    expectedAmount: 'money',
    expectedMin: 'money',
    expectedMax: 'money',
    amount: 'money',
    businessDate: 'plain',
    transactionId: 'plain',
    resolution: 'plain',
    matchedBy: 'plain',
    skipReason: 'plain',
    cancelReason: 'plain',
    lastAutoCreateError: 'plain',
  },
  // add-commitment-matching: decisiones del usuario sobre una sugerencia (confirmar o descartar; D134: sin recorrido).
  MatchSuggestion: {
    occurrenceId: 'plain',
    transactionId: 'plain',
    definitionId: 'plain',
    status: 'plain',
    score: 'plain',
    confidence: 'plain',
    amountDelta: 'money',
    dateDeltaDays: 'plain',
    ambiguous: 'plain',
  },
  // add-subscriptions: la suscripción. Las notas de cancelación son texto libre acotado (500); el enlace de
  // cancelación se audita (decisión 15).
  Subscription: {
    name: 'plain',
    planName: 'plain',
    counterpartyId: 'plain',
    definitionId: 'plain',
    priceCurrency: 'plain',
    status: 'plain',
    trialEndsOn: 'plain',
    scheduledCancellationOn: 'plain',
    cancelledOn: 'plain',
    cancellationReason: 'plain',
    cancellationUrl: 'plain',
    reminderEnabled: 'plain',
    reminderDaysBefore: 'plain',
    tolerancePercent: 'plain',
    nextRenewalOn: 'plain',
    price: 'money',
    previousPrice: 'money',
    effectiveFrom: 'plain',
    priceOrigin: 'plain',
    paymentAccountId: 'plain',
    cadence: 'plain',
    interval: 'plain',
    categoryId: 'plain',
    materializationMode: 'plain',
    proposalId: 'plain',
    proposalStatus: 'plain',
    chargeId: 'plain',
    priceCurrencyAmount: 'money',
  },
} as const satisfies AuditFieldPoliciesDto;

export * from './portability.js';
