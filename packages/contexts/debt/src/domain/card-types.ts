import type { WeekendAdjustmentMode } from '@pf/shared-kernel';

/**
 * Vocabulario de tarjetas de crédito (openspec add-credit-cards, design § Decisiones 1–3; docs/04 §3.9). Los
 * porcentajes viajan como texto decimal con la unidad en el nombre (`5.00` = 5.00 %); el dinero, como `Money`.
 */

export const DUE_WEEKEND_ADJUSTMENTS = [
  'NONE',
  'PREVIOUS',
  'NEXT',
] as const satisfies readonly WeekendAdjustmentMode[];
export type DueWeekendAdjustment = (typeof DUE_WEEKEND_ADJUSTMENTS)[number];

export const CARD_LIMIT_MODES = ['SEPARATE', 'SHARED'] as const;
export type CardLimitMode = (typeof CARD_LIMIT_MODES)[number];

export const CARD_PAYMENT_POLICIES = ['NO_INTEREST', 'MINIMUM'] as const;
export type CardPaymentPolicy = (typeof CARD_PAYMENT_POLICIES)[number];

export const MATERIALIZATION_MODES = ['AUTO_CREATE', 'PENDING_APPROVAL', 'NOTIFY_ONLY'] as const;
export type CardMaterializationMode = (typeof MATERIALIZATION_MODES)[number];

export const CARD_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

/** Estado de un estado de cuenta: `OPEN` es el ciclo en curso (derivado); los demás, el emitido. */
export const CARD_STATEMENT_STATUSES = ['OPEN', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE'] as const;
export type CardStatementStatus = (typeof CARD_STATEMENT_STATUSES)[number];

/** Términos del calendario (compartidos por las cuentas de la tarjeta). */
export interface CardTerms {
  /** 1..31; en meses cortos cierra el último día. */
  readonly statementDay: number;
  /** 1..31; en meses cortos vence el último día. */
  readonly dueDay: number;
  readonly dueWeekendAdjustment: DueWeekendAdjustment;
}

/** Versión de los términos: rige para los cierres con fecha >= `effectiveFrom` (la primera rige desde siempre). */
export interface CardTermsVersion extends CardTerms {
  /** `YYYY-MM-DD`. */
  readonly effectiveFrom: string;
}

/** Regla de pago mínimo por cuenta. `percent` y `floor` en el texto del contrato (`5.00`, `50.00`). */
export type MinimumPaymentRuleSpec =
  | { readonly type: 'PERCENT'; readonly percent: string; readonly floor: string | null }
  | { readonly type: 'FIXED'; readonly amount: string };

export const MIN_REMINDER_DAYS = 1;
export const MAX_REMINDER_DAYS = 30;
export const MIN_UTILIZATION_THRESHOLDS = 1;
export const MAX_UTILIZATION_THRESHOLDS = 3;
export const DEFAULT_UTILIZATION_THRESHOLDS = ['30.00', '80.00'] as const;
export const DEFAULT_REMINDER_DAYS = 3;
export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 60;

/** Clases de movimiento de la cuenta de la tarjeta (las produce `AccountMovementsQuery` de TRANSACTIONS). */
export const CARD_MOVEMENT_CLASSES = ['PURCHASE', 'REFUND', 'PAYMENT', 'OTHER'] as const;
export type CardMovementClass = (typeof CARD_MOVEMENT_CLASSES)[number];

/** Movimiento de la cuenta: `amount` firmado = efecto sobre lo adeudado (positivo aumenta la deuda). */
export interface CardMovement {
  /** `YYYY-MM-DD`. */
  readonly businessDate: string;
  readonly movementClass: CardMovementClass;
  readonly amount: string;
}
