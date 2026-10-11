import type {
  ComparisonStatus,
  ComponentAmounts,
  InstallmentPaymentStatus,
  LoanCharges,
  LoanState,
  ScheduleInstallment,
} from '../domain/index.js';
import type { PaymentRecord } from './ports/index.js';

export interface MoneyView {
  readonly amount: string;
  readonly currency: string;
}

export const money = (amount: string, currency: string): MoneyView => ({ amount, currency });

export interface LoanView {
  readonly id: string;
  readonly name: string;
  readonly status: LoanState['status'];
  readonly origin: LoanState['origin'];
  readonly accountId: string;
  readonly disbursementAccountId: string;
  readonly paymentAccountId: string;
  readonly lenderCounterpartyId: string | null;
  readonly lenderName: string | null;
  readonly principal: MoneyView;
  readonly annualRate: string;
  readonly rateType: LoanState['rateType'];
  readonly dayCount: LoanState['dayCount'];
  readonly frequency: LoanState['frequency'];
  readonly termInstallments: number;
  readonly method: LoanState['method'];
  readonly disbursementDate: string;
  readonly firstDueDate: string;
  readonly charges: LoanCharges;
  readonly retainedFee: MoneyView;
  readonly existing: {
    readonly asOf: string;
    readonly outstanding: MoneyView;
    readonly nextInstallmentNo: number;
  } | null;
  readonly currentScheduleVersion: number | null;
  readonly recurringDefinitionId: string | null;
  readonly disbursementTransactionId: string | null;
  readonly cancelledReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toLoanView(s: LoanState, lenderName: string | null = null): LoanView {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    origin: s.origin,
    accountId: s.accountId,
    disbursementAccountId: s.disbursementAccountId,
    paymentAccountId: s.paymentAccountId,
    lenderCounterpartyId: s.lenderCounterpartyId,
    lenderName,
    principal: money(s.principal, s.currency),
    annualRate: s.annualRate,
    rateType: s.rateType,
    dayCount: s.dayCount,
    frequency: s.frequency,
    termInstallments: s.termInstallments,
    method: s.method,
    disbursementDate: s.disbursementDate,
    firstDueDate: s.firstDueDate,
    charges: s.charges,
    retainedFee: money(s.retainedFee, s.currency),
    existing: s.existing
      ? {
          asOf: s.existing.asOf,
          outstanding: money(s.existing.outstanding, s.currency),
          nextInstallmentNo: s.existing.nextInstallmentNo,
        }
      : null,
    currentScheduleVersion: s.currentScheduleVersion,
    recurringDefinitionId: s.recurringDefinitionId,
    disbursementTransactionId: s.disbursementTransactionId,
    cancelledReason: s.cancelledReason,
    version: s.version,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Cuota del cronograma (sin estado de pago): vista previa y cronograma fijado. */
export interface ScheduleInstallmentView {
  readonly n: number;
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

export const toScheduleView = (i: ScheduleInstallment): ScheduleInstallmentView => ({
  n: i.n,
  dueDate: i.dueDate,
  periodStart: i.periodStart,
  periodEnd: i.periodEnd,
  principal: i.principal,
  interest: i.interest,
  fees: i.fees,
  insurance: i.insurance,
  taxes: i.taxes,
  total: i.total,
  openingBalance: i.openingBalance,
  closingBalance: i.closingBalance,
});

export interface SchedulePreviewView {
  readonly currency: string;
  readonly installmentAmount: string;
  readonly leveled: boolean;
  readonly totalInterest: string;
  readonly totalAmount: string;
  readonly installments: readonly ScheduleInstallmentView[];
}

/** Cuota con su estado derivado y esperado/pagado/diferencia por componente (decisión 4). */
export interface InstallmentView extends ScheduleInstallmentView {
  readonly id: string;
  readonly status: InstallmentPaymentStatus;
  /** `true` si no está pagada y venció antes de hoy (zona del workspace). */
  readonly overdue: boolean;
  readonly expected: ComponentAmounts;
  readonly paid: ComponentAmounts;
  /** Pagado − esperado por componente (negativo = falta). */
  readonly differences: ComponentAmounts;
  readonly pendingTotal: string;
}

export interface PaymentView {
  readonly id: string;
  readonly loanId: string;
  readonly paymentNo: number;
  readonly transactionId: string;
  readonly accountId: string;
  readonly businessDate: string;
  readonly amount: MoneyView;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
  readonly explicitBreakdown: boolean;
  readonly paymentMethod: string | null;
  readonly status: PaymentRecord['status'];
  readonly installmentNos: readonly number[];
  readonly voidedAt: string | null;
  readonly voidedReason: string | null;
  readonly createdAt: string;
}

export function toPaymentView(
  p: PaymentRecord,
  currency: string,
  installmentNos: readonly number[],
): PaymentView {
  return {
    id: p.id,
    loanId: p.loanId,
    paymentNo: p.paymentNo,
    transactionId: p.transactionId,
    accountId: p.accountId,
    businessDate: p.businessDate,
    amount: money(p.amount, currency),
    principal: p.principal,
    interest: p.interest,
    fees: p.fees,
    insurance: p.insurance,
    taxes: p.taxes,
    explicitBreakdown: p.explicitBreakdown,
    paymentMethod: p.paymentMethod,
    status: p.status,
    installmentNos,
    voidedAt: p.voidedAt,
    voidedReason: p.voidedReason,
    createdAt: p.createdAt,
  };
}

export interface NextInstallmentView {
  readonly n: number;
  readonly dueDate: string;
  readonly outstanding: MoneyView;
  readonly overdueDays: number;
}

export interface LoanDetailView extends LoanView {
  /** Principal pendiente según el cronograma; `null` en borrador o cancelado. */
  readonly outstandingPrincipal: MoneyView | null;
  /** Saldo adeudado según la cuenta del préstamo. */
  readonly accountBalance: MoneyView;
  /** Principal pendiente − saldo de la cuenta (movimientos manuales no registrados como pagos). */
  readonly unreconciledDifference: MoneyView | null;
  readonly installmentAmount: MoneyView | null;
  readonly nextInstallment: NextInstallmentView | null;
  readonly overdueInstallments: readonly {
    readonly n: number;
    readonly dueDate: string;
    readonly outstanding: MoneyView;
    readonly overdueDays: number;
  }[];
  readonly paidTotals: {
    readonly principal: MoneyView;
    readonly interest: MoneyView;
    readonly fees: MoneyView;
    readonly insurance: MoneyView;
    readonly taxes: MoneyView;
  };
  /** Vista previa del cronograma (solo en borrador). */
  readonly preview: SchedulePreviewView | null;
}

export interface ReferenceView {
  readonly id: string;
  readonly referenceVersion: number;
  readonly source: 'CSV' | 'PASTE' | 'MANUAL';
  readonly rowCount: number;
  readonly createdAt: string;
}

export interface ComparisonRowView {
  readonly n: number;
  readonly status: 'MATCH' | 'DIFFERENT' | 'ONLY_REFERENCE' | 'ONLY_SYSTEM';
  readonly dueDate: { readonly reference: string | null; readonly system: string | null };
  readonly components: Readonly<
    Record<
      'principal' | 'interest' | 'fees' | 'insurance' | 'taxes' | 'total',
      {
        readonly reference: string | null;
        readonly system: string | null;
        readonly difference: string | null;
      }
    >
  >;
}

export interface ComparisonView {
  readonly referenceId: string;
  readonly referenceVersion: number;
  readonly scheduleVersion: number;
  readonly status: ComparisonStatus;
  readonly explanation: string | null;
  readonly explainedBy: string | null;
  readonly explainedAt: string | null;
  readonly matched: number;
  readonly totalRows: number;
  readonly firstDifferenceNo: number | null;
  readonly summary: Record<string, unknown>;
  readonly rows: readonly Record<string, unknown>[];
  readonly suggestions: readonly Record<string, unknown>[];
}
