/**
 * Vocabulario canónico del motor de recurrencia (openspec add-recurrence-engine, design decisión 2; docs/04 §3.7).
 * UI en español: Programada, Próxima, Atrasada, Creada, Vinculada, Omitida, Cancelada.
 */
export const RECURRING_KINDS = ['INCOME', 'EXPENSE', 'TRANSFER'] as const;

/**
 * Tipos que SOLO crea el contexto administrador (openspec add-loans, N2): `LOAN_PAYMENT` únicamente en definiciones
 * administradas por `DEBT` con calendario explícito. La API de usuario los rechaza con `RECURRING_KIND_NOT_AVAILABLE`.
 */
export const MANAGED_ONLY_KINDS = ['LOAN_PAYMENT', 'CARD_PAYMENT'] as const;
export type RecurringKind = (typeof RECURRING_KINDS)[number] | (typeof MANAGED_ONLY_KINDS)[number];

/** Cuota de préstamo: la resuelve DEBT (1 transacción puede resolver varias), nunca el motor ni el matching. */
export const LOAN_PAYMENT_KIND = 'LOAN_PAYMENT' as const;

/**
 * Pago de tarjeta (openspec add-credit-cards, decisión 7): `CARD_PAYMENT` solo en definiciones administradas por
 * `DEBT`, con regla mensual; es una TRANSFERENCIA de la cuenta de pago (activo) a la cuenta de la tarjeta (pasivo).
 */
export const CARD_PAYMENT_KIND = 'CARD_PAYMENT' as const;

/** Tipos cuya materialización es una transferencia entre dos cuentas (`TRANSFER` y `CARD_PAYMENT`). */
export const isTransferLike = (kind: string): boolean => kind === 'TRANSFER' || kind === CARD_PAYMENT_KIND;

/** Tipo de la transacción que materializa o vincula una ocurrencia (`CARD_PAYMENT` ⇒ `TRANSFER`). */
export const transactionKindOf = (
  kind: RecurringKind,
): Exclude<RecurringKind, 'LOAN_PAYMENT' | 'CARD_PAYMENT'> => {
  if (kind === 'LOAN_PAYMENT') throw new Error('a loan payment is resolved by its manager');
  return kind === CARD_PAYMENT_KIND ? 'TRANSFER' : kind;
};

/** Tipos reservados para Phase 4 (D116): se rechazan con `RECURRING_KIND_NOT_AVAILABLE` salvo el administrador. */
export const RESERVED_RECURRING_KINDS = ['LOAN_PAYMENT', 'CARD_PAYMENT'] as const;

export const MANAGED_BY = ['USER', 'SUBSCRIPTION', 'DEBT'] as const;
export type ManagedBy = (typeof MANAGED_BY)[number];

export const AMOUNT_TYPES = ['FIXED', 'ESTIMATED', 'MIN_MAX', 'VARIABLE'] as const;
export type AmountType = (typeof AMOUNT_TYPES)[number];

export const MATERIALIZATION_MODES = ['AUTO_CREATE', 'PENDING_APPROVAL', 'NOTIFY_ONLY'] as const;
export type MaterializationMode = (typeof MATERIALIZATION_MODES)[number];

export const AUTO_CREATE_STATUSES = ['PENDING', 'POSTED'] as const;
export type AutoCreateStatus = (typeof AUTO_CREATE_STATUSES)[number];

export const PAYMENT_METHODS = [
  'CASH',
  'QR',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'BANK_TRANSFER',
  'DIGITAL_WALLET',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CANCEL_REASONS = ['PAUSED', 'SUPERSEDED', 'ENDED'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const MATCHED_BY = ['USER_LINK', 'SUGGESTION'] as const;
export type MatchedBy = (typeof MATCHED_BY)[number];

export const RESOLUTIONS = ['CREATED', 'MATCHED', 'SKIPPED'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** Anticipación (días antes del vencimiento) en que la ocurrencia pasa a próxima. */
export const MAX_LEAD_DAYS = 60;
