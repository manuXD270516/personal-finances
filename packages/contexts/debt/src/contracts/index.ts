/**
 * API pública de `@pf/debt` (openspec add-loans § Contratos; ADR-0003). Hoja: no importa capas internas.
 * Montos como `{amount: "<decimal>", currency: "<código>"}` (nunca `number`, ADR-0006).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

export const DEBT_CONTEXT = 'debt' as const;

/** Eventos publicados por el outbox (contracts/events/debt/*.v1.schema.json). */
export const DEBT_EVENTS = {
  loanDisbursed: { eventType: 'debt.LoanDisbursed', eventVersion: 1 },
  loanScheduleGenerated: { eventType: 'debt.LoanScheduleGenerated', eventVersion: 1 },
  loanPaymentRecorded: { eventType: 'debt.LoanPaymentRecorded', eventVersion: 1 },
  loanPaymentVoided: { eventType: 'debt.LoanPaymentVoided', eventVersion: 1 },
  loanPaidOff: { eventType: 'debt.LoanPaidOff', eventVersion: 1 },
  // add-credit-cards (Phase 4)
  cardStatementIssued: { eventType: 'debt.CardStatementIssued', eventVersion: 1 },
  cardPaymentDue: { eventType: 'debt.CardPaymentDue', eventVersion: 1 },
  creditUtilizationThresholdReached: { eventType: 'debt.CreditUtilizationThresholdReached', eventVersion: 1 },
} as const;

/** Consumidor del worker de tarjetas (add-credit-cards, decisión 14): movimientos de las cuentas de tarjeta. */
export const DEBT_CONSUMERS = {
  cardActivity: 'debt.card-activity',
} as const;

/** Job periódico de tarjetas (add-credit-cards, decisiones 5 y 8): emisión, recordatorios y red de seguridad. */
export const DEBT_CARD_DAILY_JOB = 'debt.card-daily' as const;

export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export type LoanStatusDto = 'DRAFT' | 'ACTIVE' | 'PAID_OFF' | 'CANCELLED';
export type LoanMethodDto = 'FRENCH' | 'GERMAN' | 'FIXED_PRINCIPAL' | 'CUSTOM';
export type LoanRateTypeDto = 'FIXED' | 'VARIABLE';
export type LoanDayCountDto = 'D30_360' | 'ACT_360' | 'ACT_365';
export type LoanFrequencyDto = 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL';

// ───────────────────────────────────────────── eventos (payloads)

export interface LoanDisbursedV1 {
  readonly workspaceId: string;
  readonly loanId: string;
  readonly accountId: string;
  readonly disbursementAccountId: string;
  readonly transactionId: string;
  readonly principal: MoneyDto;
  readonly retainedFee: MoneyDto;
  readonly disbursedOn: string;
}

export interface LoanInstallmentDto {
  readonly n: number;
  readonly dueDate: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
  readonly total: string;
}

export interface LoanScheduleGeneratedV1 {
  readonly workspaceId: string;
  readonly loanId: string;
  readonly scheduleVersion: number;
  readonly reason: 'INITIAL';
  readonly effectiveFrom: string;
  readonly currency: string;
  readonly installments: readonly LoanInstallmentDto[];
}

export interface LoanPaymentBreakdownEventDto {
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
  readonly total: string;
}

export interface LoanPaymentRecordedV1 {
  readonly workspaceId: string;
  readonly loanId: string;
  readonly paymentId: string;
  readonly transactionId: string;
  readonly installmentNos: readonly number[];
  readonly currency: string;
  readonly breakdown: LoanPaymentBreakdownEventDto;
  readonly remainingPrincipal: string;
  readonly paidOn: string;
}

export interface LoanPaymentVoidedV1 {
  readonly workspaceId: string;
  readonly loanId: string;
  readonly paymentId: string;
  readonly transactionId: string;
  readonly installmentNos: readonly number[];
  readonly currency: string;
  readonly remainingPrincipal: string;
}

export interface LoanPaidOffV1 {
  readonly workspaceId: string;
  readonly loanId: string;
  readonly paidOffOn: string;
  readonly lastTransactionId: string;
}

// ───────────────────────────────────────────── consultas públicas

/** Próxima cuota de un préstamo: pendiente tras pagos parciales y días de atraso (hoy en la TZ del workspace). */
export interface LoanNextInstallmentDto {
  readonly n: number;
  readonly dueDate: string;
  readonly outstanding: MoneyDto;
  /** 0 si aún no vence. */
  readonly overdueDays: number;
}

export interface LoanPortfolioItemDto {
  readonly loanId: string;
  readonly name: string;
  readonly accountId: string;
  readonly currency: string;
  readonly status: LoanStatusDto;
  readonly method: LoanMethodDto;
  readonly rateType: LoanRateTypeDto;
  /** Fracción decimal (`0.115` = 11.50 %). */
  readonly annualRate: string;
  /** Principal pendiente según el cronograma. */
  readonly outstandingPrincipal: MoneyDto;
  /** Saldo adeudado según la cuenta del préstamo. */
  readonly accountBalance: MoneyDto;
  /** Principal pendiente menos saldo de la cuenta (movimientos manuales no registrados como pagos). */
  readonly unreconciledDifference: MoneyDto;
  /** Cuota vigente (total de la primera cuota no pagada). */
  readonly installmentAmount: MoneyDto | null;
  readonly nextInstallment: LoanNextInstallmentDto | null;
  readonly lastUnpaidInstallmentDueDate: string | null;
}

/**
 * Insumo de `add-debt-summary` y del payoff simulator (pedidos L1–L2d aceptados). Sin efectos; corre en la unidad de
 * trabajo del llamador si existe.
 */
export interface LoanPortfolioQuery {
  /** Por omisión `ACTIVE` y `PAID_OFF` con saldo de cuenta distinto de cero. */
  listLoans(input: {
    readonly workspaceId: string;
    readonly statuses?: readonly LoanStatusDto[];
  }): Promise<readonly LoanPortfolioItemDto[]>;
  /** Σ interés de las imputaciones vigentes con fecha de pago en `[from, to]` (las anuladas no cuentan). */
  interestPaid(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<readonly { readonly loanId: string; readonly amount: MoneyDto }[]>;
}

export const LOAN_PORTFOLIO_QUERY = Symbol.for('pf.debt.LoanPortfolioQuery');

// ───────────────────────────────────────────── tarjetas de crédito (add-credit-cards)

export type CardStatementStatusDto = 'OPEN' | 'ISSUED' | 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE';
export type CardPaymentPolicyDto = 'NO_INTEREST' | 'MINIMUM';
export type CardLimitModeDto = 'SEPARATE' | 'SHARED';
export type DueWeekendAdjustmentDto = 'NONE' | 'PREVIOUS' | 'NEXT';

/** `debt.CardStatementIssued.v1` (clave natural `(cardAccountId, closingDate)`). */
export interface CardStatementIssuedV1 {
  readonly workspaceId: string;
  readonly cardId: string;
  readonly cardName: string;
  readonly cardAccountId: string;
  readonly accountId: string;
  readonly currency: string;
  readonly statementId: string;
  readonly cycleStart: string;
  readonly closingDate: string;
  readonly dueDate: string;
  readonly previousBalance: MoneyDto;
  readonly purchases: MoneyDto;
  readonly refunds: MoneyDto;
  readonly payments: MoneyDto;
  readonly otherNet: MoneyDto;
  readonly closingBalance: MoneyDto;
  readonly unbilledInstallments: MoneyDto;
  readonly billedBalance: MoneyDto;
  readonly minimumDue: MoneyDto;
  readonly noInterestPayment: MoneyDto;
}

/** `debt.CardPaymentDue.v1` (clave natural `(cardAccountId, closingDate)`); lo consume NOTIFY. */
export interface CardPaymentDueV1 {
  readonly workspaceId: string;
  readonly cardId: string;
  readonly cardName: string;
  readonly cardAccountId: string;
  readonly accountId: string;
  readonly currency: string;
  readonly statementId: string;
  readonly closingDate: string;
  readonly dueDate: string;
  readonly daysBefore: number;
  readonly remainingNoInterest: MoneyDto;
  readonly remainingMinimum: MoneyDto;
  readonly paymentPlanDefinitionId: string | null;
}

/** `debt.CreditUtilizationThresholdReached.v1` (clave `(cardId, scope, threshold, crossingNo)`); lo consume NOTIFY. */
export interface CreditUtilizationThresholdReachedV1 {
  readonly workspaceId: string;
  readonly cardId: string;
  readonly cardName: string;
  readonly scope: 'SHARED' | 'ACCOUNT';
  readonly accountId: string | null;
  readonly limit: MoneyDto;
  readonly used: MoneyDto;
  /** Porcentaje con 2 decimales HALF_EVEN (`85.00`). */
  readonly utilization: string;
  readonly threshold: string;
  readonly alsoCrossed: readonly string[];
  readonly crossingNo: number;
  readonly crossedAt: string;
}

/** Una cuenta de una tarjeta para `add-debt-summary` y Reporting (Phase 7); sin efectos. */
export interface CardPortfolioAccountDto {
  readonly cardId: string;
  readonly cardName: string;
  readonly cardAccountId: string;
  readonly accountId: string;
  readonly currency: string;
  /** Saldo adeudado de la cuenta (presentado). */
  readonly balance: MoneyDto;
  /** Último estado emitido: vencimiento y lo que falta (sin intereses y mínimo); `null` si no hay. */
  readonly lastStatement: {
    readonly statementId: string;
    readonly closingDate: string;
    readonly dueDate: string;
    readonly remainingNoInterest: MoneyDto;
    readonly remainingMinimum: MoneyDto;
    readonly status: CardStatementStatusDto;
  } | null;
  /** Ciclo abierto: cierre, vencimiento y estimación del pago para no generar intereses. */
  readonly openCycle: {
    readonly closingDate: string;
    readonly dueDate: string;
    readonly estimatedNoInterest: MoneyDto;
    /** El ciclo tiene compras propias (movimientos de compra desde el último cierre). */
    readonly hasOwnPurchases: boolean;
  };
  /** Capital de cuotas aún no facturado y vencimiento del pago que factura la última cuota. */
  readonly unbilledInstallments: MoneyDto;
  readonly lastInstallmentDueDate: string | null;
}

/** Contrato público de lectura de tarjetas (simétrico a `LoanPortfolioQuery`; insumo de `add-debt-summary`). */
export interface CardPortfolioQuery {
  listCards(input: { readonly workspaceId: string }): Promise<readonly CardPortfolioAccountDto[]>;
}

export const CARD_PORTFOLIO_QUERY = Symbol.for('pf.debt.CardPortfolioQuery');

/**
 * Allow-list de auditoría de DEBT (add-audit-trail, NFR-SEC-015): montos exactos (`money`); lo no listado nunca se
 * copia a `audit.audit_log`.
 */
export const DEBT_AUDIT_POLICY = {
  Loan: {
    name: 'plain',
    status: 'plain',
    origin: 'plain',
    method: 'plain',
    rateType: 'plain',
    dayCount: 'plain',
    frequency: 'plain',
    termInstallments: 'plain',
    annualRate: 'plain',
    principal: 'money',
    disbursementDate: 'plain',
    firstDueDate: 'plain',
    accountId: 'plain',
    disbursementAccountId: 'plain',
    paymentAccountId: 'plain',
    lenderCounterpartyId: 'plain',
    charges: 'plain',
    retainedFee: 'money',
    existingAsOf: 'plain',
    existingOutstanding: 'money',
    nextInstallmentNo: 'plain',
    currentScheduleVersion: 'plain',
    recurringDefinitionId: 'plain',
    disbursementTransactionId: 'plain',
    reason: 'plain',
  },
  LoanPayment: {
    loanId: 'plain',
    transactionId: 'plain',
    businessDate: 'plain',
    amount: 'money',
    principal: 'money',
    interest: 'money',
    fees: 'money',
    insurance: 'money',
    taxes: 'money',
    explicitBreakdown: 'plain',
    status: 'plain',
    voidedReason: 'plain',
    installmentNos: 'plain',
  },
  LoanReferenceSchedule: {
    loanId: 'plain',
    referenceVersion: 'plain',
    source: 'plain',
    rowCount: 'plain',
  },
  LoanScheduleComparison: {
    loanId: 'plain',
    referenceVersion: 'plain',
    scheduleVersion: 'plain',
    status: 'plain',
    matched: 'plain',
    totalRows: 'plain',
    explanation: 'plain',
  },
  // add-credit-cards: montos (`money`), días, umbrales, política e ids; el nombre es texto.
  CreditCard: {
    name: 'plain',
    status: 'plain',
    statementDay: 'plain',
    dueDay: 'plain',
    dueWeekendAdjustment: 'plain',
    annualRate: 'plain',
    limitMode: 'plain',
    sharedLimit: 'money',
    utilizationThresholds: 'plain',
    reminderDays: 'plain',
    // Campos por cuenta de la tarjeta, con el sufijo de su moneda (`creditLimit.BOB`): una por moneda.
    'accountId.*': 'plain',
    'creditLimit.*': 'money',
    'minimumRule.*': 'plain',
    'paymentPlanSourceAccountId.*': 'plain',
    'paymentPlanPolicy.*': 'plain',
    'paymentPlanMaterialization.*': 'plain',
    'paymentPlanDefinitionId.*': 'plain',
  },
  CardStatement: {
    cardAccountId: 'plain',
    closingDate: 'plain',
    dueDate: 'plain',
    billedBalance: 'money',
    minimumDue: 'money',
    reportedBilledBalance: 'money',
    reportedMinimumDue: 'money',
  },
  CardInstallmentPlan: {
    cardAccountId: 'plain',
    purchaseTransactionId: 'plain',
    principal: 'money',
    installmentCount: 'plain',
    annualRate: 'plain',
    startCycle: 'plain',
    status: 'plain',
    cancelReason: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;

export * from './portability.js';
