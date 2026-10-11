import type { PrepaymentOption, ScheduleInstallment } from '../domain/index.js';
import type { LoanView, MoneyView, PaymentView, ScheduleInstallmentView } from './views.js';

/** Resumen de un tramo del cronograma (lo no pagado) para comparar el vigente con una alternativa. */
export interface TailSummaryView {
  readonly installmentAmount: MoneyView | null;
  readonly installmentCount: number;
  readonly endDate: string | null;
  readonly remainingInterest: MoneyView;
  readonly remainingPrincipal: MoneyView;
}

export interface RecalculationOptionView extends TailSummaryView {
  readonly option: PrepaymentOption;
  /** Ahorro de interés frente al cronograma vigente. */
  readonly interestSaved: MoneyView;
  readonly installments: readonly ScheduleInstallmentView[];
}

/** Vista previa del pago extraordinario (`POST …/prepayments/preview`): ambas opciones, sin persistir. */
export interface PrepaymentPreviewView {
  readonly loanId: string;
  readonly currency: string;
  readonly outstandingPrincipal: MoneyView;
  readonly amount: MoneyView;
  readonly fee: MoneyView;
  /** El pago extraordinario salda el préstamo: no hay cronograma nuevo. */
  readonly paysOff: boolean;
  /** Primera cuota que el recálculo reemplaza (`k0`). */
  readonly fromInstallmentNo: number;
  readonly current: TailSummaryView;
  readonly options: readonly RecalculationOptionView[];
}

/** Vista previa del cambio de tasa (`POST …/rate-changes/preview`). */
export interface RateChangePreviewView {
  readonly loanId: string;
  readonly currency: string;
  readonly annualRate: string;
  readonly effectiveFrom: string;
  readonly fromInstallmentNo: number;
  readonly current: TailSummaryView;
  readonly proposed: TailSummaryView & {
    readonly interestSaved: MoneyView;
    readonly installments: readonly ScheduleInstallmentView[];
  };
}

export interface PrepaymentResultView {
  readonly payment: PaymentView;
  readonly loan: LoanView;
  /** Versión del cronograma creada por el prepago (`null` si saldó el préstamo). */
  readonly scheduleVersion: number | null;
  readonly paidOff: boolean;
}

export interface ScheduleVersionView {
  readonly scheduleVersion: number;
  readonly reason: string;
  readonly effectiveFrom: string;
  /** Primera cuota que la versión reemplaza. */
  readonly fromInstallmentNo: number;
  /** Primera cuota que una versión posterior reemplaza (`null` si es la vigente). */
  readonly replacedFromInstallmentNo: number | null;
  readonly current: boolean;
  readonly installmentCount: number;
  readonly sourcePaymentId: string | null;
  readonly sourceRateChangeId: string | null;
  readonly sourceReferenceId: string | null;
  readonly parameters: Record<string, unknown>;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface RateChangeView {
  /** `null` en la tasa inicial del préstamo. */
  readonly id: string | null;
  readonly annualRate: string;
  readonly effectiveFrom: string;
  readonly scheduleVersion: number;
  readonly initial: boolean;
  readonly createdAt: string | null;
}

export interface RateChangeResultView {
  readonly rateChange: RateChangeView;
  readonly loan: LoanView;
  readonly scheduleVersion: number;
}

export interface CustomScheduleResultView {
  readonly loan: LoanView;
  /** Versión creada en un préstamo activo; `null` en un borrador (la versión 1 se fija al desembolsar). */
  readonly scheduleVersion: number | null;
  readonly installments: readonly ScheduleInstallmentView[];
}

export const toRows = (
  rows: readonly ScheduleInstallment[],
  map: (i: ScheduleInstallment) => ScheduleInstallmentView,
): ScheduleInstallmentView[] => rows.map(map);
