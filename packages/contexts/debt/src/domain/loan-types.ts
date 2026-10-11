/**
 * Vocabulario y tipos compartidos del dominio de préstamos (openspec add-loans, design decisiones 2, 3 y 8).
 * Todos los montos viajan como strings decimales a la escala de la moneda (nunca `number`, INV-001).
 */

/** Convención de días (FR-DEBT-001): 30/360 europeo por omisión, ACT/360 y ACT/365 por días reales. */
export const DAY_COUNTS = ['D30_360', 'ACT_360', 'ACT_365'] as const;
export type DayCount = (typeof DAY_COUNTS)[number];

/** Periodicidad de las cuotas y cuotas por año. */
export const LOAN_FREQUENCIES = ['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const;
export type LoanFrequency = (typeof LOAN_FREQUENCIES)[number];

/** Meses que dura un periodo de cada periodicidad (`12 / cuotas por año`). */
export const MONTHS_PER_PERIOD: Readonly<Record<LoanFrequency, number>> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export const MIN_LOAN_INSTALLMENTS = 1;
export const MAX_LOAN_INSTALLMENTS = 600;

/** Cargo por cuota: monto fijo o tasa MENSUAL (fracción: "0.0004" = 0.0400 %) sobre el saldo al inicio del periodo. */
export const CHARGE_MODES = ['FIXED', 'RATE_ON_BALANCE'] as const;
export type ChargeMode = (typeof CHARGE_MODES)[number];

export interface ChargeSpec {
  readonly mode: ChargeMode;
  /** FIXED: monto por cuota a la escala de la moneda; RATE_ON_BALANCE: tasa mensual como fracción decimal. */
  readonly value: string;
}

export interface LoanCharges {
  readonly fees?: ChargeSpec;
  readonly insurance?: ChargeSpec;
  readonly taxes?: ChargeSpec;
}

/** Componentes de una cuota o de un pago, en el orden de imputación D155: impuestos → seguro → comisiones → interés → principal. */
export const PAYMENT_COMPONENTS = ['taxes', 'insurance', 'fees', 'interest', 'principal'] as const;
export type PaymentComponent = (typeof PAYMENT_COMPONENTS)[number];

export type ComponentAmounts = Readonly<Record<PaymentComponent, string>>;

/** Una cuota del cronograma (strings decimales a la escala de la moneda). */
export interface ScheduleInstallment {
  readonly n: number;
  /** `YYYY-MM-DD`. */
  readonly dueDate: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
  readonly total: string;
  readonly openingBalance: string;
  readonly closingBalance: string;
}

/** Estado de pago de una cuota, derivado de las imputaciones vigentes (design decisión 4). */
export const INSTALLMENT_PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const;
export type InstallmentPaymentStatus = (typeof INSTALLMENT_PAYMENT_STATUSES)[number];

/** Estado de una comparación contra la tabla del banco (se deriva, design decisión 12). */
export const COMPARISON_STATUSES = ['MATCH', 'UNEXPLAINED', 'EXPLAINED'] as const;
export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];

/** Fila de una tabla de amortización de referencia (la del banco), ya validada. */
export interface ReferenceScheduleRow {
  readonly n: number;
  /** `YYYY-MM-DD`. */
  readonly dueDate: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
  readonly total: string;
  /** Saldo tras la cuota, si la tabla lo trae (informativo: no se compara). */
  readonly balance?: string;
}
