/**
 * Tipos del contrato `finance-api.v1.yaml` (tag Commitments, openspec add-recurrence-engine): definiciones,
 * versiones, ocurrencias y comprometido. Montos como `DecimalString` (INV-001), nunca `number`.
 */
import type { Money, PaymentMethod } from '../common/types';
import type { ResolvedRate } from '../dashboard/types';

export type RecurringKind = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'LOAN_PAYMENT' | 'CARD_PAYMENT';
/** Tipos que la UI ofrece: `LOAN_PAYMENT` y `CARD_PAYMENT` están reservados (Phase 4); el pago de tarjeta es una transferencia. */
export const OFFERED_KINDS = ['INCOME', 'EXPENSE', 'TRANSFER'] as const;
export type OfferedKind = (typeof OFFERED_KINDS)[number];

export type RecurringStatus = 'ACTIVE' | 'PAUSED' | 'ENDED';
export const RECURRING_STATUSES: readonly RecurringStatus[] = ['ACTIVE', 'PAUSED', 'ENDED'];

export type RecurringCadence =
  | 'DAILY'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'SEMIMONTHLY'
  | 'MONTHLY'
  | 'BIMONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUAL'
  | 'ANNUAL'
  | 'CUSTOM';
export const CADENCES: readonly RecurringCadence[] = [
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'SEMIMONTHLY',
  'MONTHLY',
  'BIMONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
  'CUSTOM',
];

export type WeekendAdjustmentMode = 'NONE' | 'PREVIOUS' | 'NEXT';
export const WEEKEND_ADJUSTMENTS: readonly WeekendAdjustmentMode[] = ['NONE', 'PREVIOUS', 'NEXT'];

export type RecurringAmountType = 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE';
export const AMOUNT_TYPES: readonly RecurringAmountType[] = ['FIXED', 'ESTIMATED', 'MIN_MAX', 'VARIABLE'];

export type MaterializationMode = 'AUTO_CREATE' | 'PENDING_APPROVAL' | 'NOTIFY_ONLY';
export const MATERIALIZATION_MODES: readonly MaterializationMode[] = [
  'AUTO_CREATE',
  'PENDING_APPROVAL',
  'NOTIFY_ONLY',
];

export type OccurrenceStatus =
  'SCHEDULED' | 'DUE' | 'OVERDUE' | 'MATERIALIZED' | 'MATCHED' | 'SKIPPED' | 'CANCELLED';
export const OCCURRENCE_STATUSES: readonly OccurrenceStatus[] = [
  'SCHEDULED',
  'DUE',
  'OVERDUE',
  'MATERIALIZED',
  'MATCHED',
  'SKIPPED',
  'CANCELLED',
];

export interface RecurringAmount {
  readonly type: RecurringAmountType;
  readonly amount?: Money;
  readonly min?: Money;
  readonly max?: Money;
}

export interface RecurringSchedule {
  readonly cadence: RecurringCadence;
  readonly interval: number;
  readonly monthDays: readonly number[];
  readonly rrule: string | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly maxOccurrences: number | null;
  readonly weekendAdjustment: WeekendAdjustmentMode;
}

export interface RecurringMaterialization {
  readonly mode: MaterializationMode;
  readonly autoCreateStatus: 'PENDING' | 'POSTED' | null;
  readonly leadDays: number;
}

export interface RecurringDefinitionVersion {
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly currency: string;
  readonly amount: RecurringAmount;
  readonly categoryId: string | null;
  readonly counterpartyId: string | null;
  readonly tagIds: readonly string[];
  readonly paymentMethod: PaymentMethod | null;
  readonly schedule: RecurringSchedule;
  readonly materialization: RecurringMaterialization;
}

export interface RecurringDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly notes: string | null;
  readonly kind: RecurringKind;
  readonly managedBy: 'USER' | 'SUBSCRIPTION' | 'DEBT';
  readonly managedRef: string | null;
  readonly status: RecurringStatus;
  readonly currentVersionNo: number;
  readonly generatedThrough: string | null;
  readonly endDate: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly current: RecurringDefinitionVersion;
  /** Tolerancias del matching sugerido (`null` = valor por omisión del tipo de monto). */
  readonly matching?: MatchingTolerances;
  /** Solo en el detalle; la más antigua primero. */
  readonly versions?: readonly RecurringDefinitionVersion[];
  /** Solo en el listado. */
  readonly nextOccurrence?: { readonly occurrenceDate: string; readonly dueDate: string } | null;
  readonly pendingApprovalCount?: number;
  readonly generatedCount?: number;
}

export interface RecurringOccurrence {
  readonly id: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly kind: RecurringKind;
  readonly managedBy: 'USER' | 'SUBSCRIPTION' | 'DEBT';
  readonly occurrenceDate: string;
  readonly dueDate: string;
  readonly definitionVersionNo: number;
  readonly expected: RecurringAmount;
  readonly projectedAmount: Money | null;
  readonly status: OccurrenceStatus;
  readonly cancelReason: 'PAUSED' | 'SUPERSEDED' | 'ENDED' | null;
  readonly requiresApproval: boolean;
  readonly mode: MaterializationMode;
  readonly overridden: boolean;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly transactionId: string | null;
  readonly resolution: 'CREATED' | 'MATCHED' | 'SKIPPED' | null;
  readonly matchedBy: 'USER_LINK' | 'SUGGESTION' | null;
  readonly skipReason: string | null;
  readonly lastAutoCreateError: string | null;
  readonly version: number;
}

export interface RecurringRevisionResult {
  readonly definition: RecurringDefinition;
  readonly rewritten: number;
  readonly cancelled: number;
  readonly created: number;
  readonly reinstated: number;
  readonly resetOverrides: number;
}

export interface CommittedItem {
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly id: string;
  readonly definitionId: string | null;
  readonly name: string | null;
  readonly kind: string;
  readonly date: string;
  readonly amount: Money | null;
  readonly status: OccurrenceStatus | null;
}

export interface CommittedAmount {
  readonly periodId: string;
  readonly periodLabel: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly byCurrency: readonly {
    readonly currency: string;
    readonly occurrences: Money;
    readonly pending: Money;
    readonly total: Money;
  }[];
  readonly consolidated: {
    readonly amount: Money;
    readonly complete: boolean;
    readonly unconverted: readonly Money[];
  };
  readonly expectedIncome: readonly Money[];
  readonly withoutAmountCount: number;
  readonly items: readonly CommittedItem[];
  readonly ratesUsed: readonly ResolvedRate[];
  readonly generatedAt: string;
}

// ───────────────────────────── Matching sugerido (openspec add-commitment-matching) ─────────────────────────────

/** Tolerancias del matching de una definición; `null` = el valor por omisión según el tipo de monto (D120). */
export interface MatchingTolerances {
  /** Porcentaje 0..100 con hasta 2 decimales (texto). */
  readonly amountTolerancePercent: string | null;
  /** Días 0..15. */
  readonly dateWindowDays: number | null;
}

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export const MATCH_CONFIDENCES: readonly MatchConfidence[] = ['HIGH', 'MEDIUM', 'LOW'];
export type MatchSuggestionStatus = 'PROPOSED' | 'CONFIRMED' | 'DISMISSED' | 'EXPIRED';

export interface MatchSuggestion {
  readonly id: string;
  readonly occurrence: {
    readonly id: string;
    readonly definitionId: string;
    readonly definitionName: string;
    readonly kind: RecurringKind;
    readonly status: OccurrenceStatus;
    readonly dueDate: string;
    readonly expected: RecurringAmount;
    readonly accountId: string;
    readonly toAccountId: string | null;
  } | null;
  readonly transaction: {
    readonly id: string;
    readonly kind: string;
    readonly status: string;
    readonly businessDate: string;
    readonly amount: Money;
    readonly accountId: string;
    readonly toAccountId: string | null;
    readonly counterpartyId: string | null;
    readonly source: string;
  } | null;
  /** 0..100 con 2 decimales (texto). */
  readonly score: string;
  readonly confidence: MatchConfidence;
  readonly reasons: {
    readonly amountDelta: Money | null;
    readonly dateDeltaDays: number;
    readonly counterparty: 'MATCH' | 'UNKNOWN';
  };
  readonly ambiguous: boolean;
  readonly status: MatchSuggestionStatus;
  readonly expireReason: string | null;
  readonly createdAt: string;
  readonly version: number;
}

export interface MatchSuggestionPage {
  readonly data: readonly MatchSuggestion[];
  readonly page: { readonly limit: number; readonly hasMore: boolean; readonly nextCursor: string | null };
  /** Sugerencias pendientes del workspace (el contador de "Coincidencias por revisar"). */
  readonly proposedCount: number;
}
