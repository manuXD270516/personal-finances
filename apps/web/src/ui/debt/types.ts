/**
 * Tipos del contrato `finance-api.v1.yaml` (tag Debt, openspec add-loans). Montos y tasas como `DecimalString`
 * (INV-001), nunca `number`. La tasa viaja como fracción decimal (`"0.115"` = 11,50 %).
 */
import type { Money } from '../common/types';

export type LoanStatus = 'DRAFT' | 'ACTIVE' | 'PAID_OFF' | 'CANCELLED';
export type LoanDayCount = 'D30_360' | 'ACT_360' | 'ACT_365';
export const DAY_COUNTS: readonly LoanDayCount[] = ['D30_360', 'ACT_360', 'ACT_365'];
export type LoanFrequency = 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL';
export const FREQUENCIES: readonly LoanFrequency[] = [
  'MONTHLY',
  'BIMONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
];
export type LoanOrigin = 'NEW' | 'EXISTING';
export type ChargeMode = 'FIXED' | 'RATE_ON_BALANCE';
export type ChargeKey = 'fees' | 'insurance' | 'taxes';
export const CHARGE_KEYS: readonly ChargeKey[] = ['fees', 'insurance', 'taxes'];

export interface LoanChargeSpec {
  readonly mode: ChargeMode;
  /** `FIXED`: monto por cuota; `RATE_ON_BALANCE`: tasa MENSUAL como fracción decimal. */
  readonly value: string;
}
export type LoanCharges = Partial<Record<ChargeKey, LoanChargeSpec>>;

export interface Components {
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
}
export const COMPONENT_KEYS: readonly (keyof Components)[] = [
  'principal',
  'interest',
  'fees',
  'insurance',
  'taxes',
];

export interface Loan {
  readonly id: string;
  readonly name: string;
  readonly status: LoanStatus;
  readonly origin: LoanOrigin;
  readonly accountId: string;
  readonly disbursementAccountId: string;
  readonly paymentAccountId: string;
  readonly lenderCounterpartyId: string | null;
  readonly lenderName: string | null;
  readonly principal: Money;
  readonly annualRate: string;
  readonly rateType: 'FIXED' | 'VARIABLE';
  readonly dayCount: LoanDayCount;
  readonly frequency: LoanFrequency;
  readonly termInstallments: number;
  readonly method: string;
  readonly disbursementDate: string | null;
  readonly firstDueDate: string;
  readonly charges: LoanCharges;
  readonly retainedFee: Money;
  readonly existing: {
    readonly asOf: string;
    readonly outstanding: Money;
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

export interface ScheduleInstallment {
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

export interface SchedulePreview {
  readonly currency: string;
  readonly installmentAmount: string;
  readonly leveled: boolean;
  readonly totalInterest: string;
  readonly totalAmount: string;
  readonly installments: readonly ScheduleInstallment[];
}

export interface NextInstallment {
  readonly n: number;
  readonly dueDate: string;
  readonly outstanding: Money;
  readonly overdueDays: number;
}

export interface LoanDetail extends Loan {
  readonly outstandingPrincipal: Money | null;
  readonly accountBalance: Money;
  readonly unreconciledDifference: Money | null;
  readonly installmentAmount: Money | null;
  readonly nextInstallment: NextInstallment | null;
  readonly overdueInstallments: readonly NextInstallment[];
  readonly paidTotals: {
    readonly principal: Money;
    readonly interest: Money;
    readonly fees: Money;
    readonly insurance: Money;
    readonly taxes: Money;
  };
  readonly preview: SchedulePreview | null;
}

export type InstallmentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface LoanInstallment extends ScheduleInstallment {
  readonly id: string;
  readonly status: InstallmentStatus;
  readonly overdue: boolean;
  readonly expected: Components;
  readonly paid: Components;
  readonly differences: Components;
  readonly pendingTotal: string;
}

export interface LoanPayment {
  readonly id: string;
  readonly loanId: string;
  readonly paymentNo: number;
  readonly transactionId: string;
  readonly accountId: string;
  readonly businessDate: string;
  readonly amount: Money;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
  readonly explicitBreakdown: boolean;
  readonly paymentMethod: string | null;
  readonly status: 'ACTIVE' | 'VOIDED';
  readonly installmentNos: readonly number[];
  readonly voidedAt: string | null;
  readonly voidedReason: string | null;
  readonly createdAt: string;
}

export interface LoanPaymentResult {
  readonly payment: LoanPayment;
  readonly loan: Loan;
}

// ───────────────────────────── Comparación con la tabla del banco ─────────────────────────────

export type ReferenceSource = 'CSV' | 'PASTE' | 'MANUAL';
export type DateFormat = 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY';
export const DATE_FORMATS: readonly DateFormat[] = ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'];
export type Delimiter = ',' | ';' | '\t';
export const DELIMITERS: readonly Delimiter[] = [';', ',', '\t'];

export type MappingField =
  | 'installmentNo'
  | 'dueDate'
  | 'principal'
  | 'interest'
  | 'fees'
  | 'insurance'
  | 'taxes'
  | 'total'
  | 'balance';
export const MAPPING_FIELDS: readonly MappingField[] = [
  'installmentNo',
  'dueDate',
  'principal',
  'interest',
  'fees',
  'insurance',
  'taxes',
  'total',
  'balance',
];
export const REQUIRED_MAPPING: readonly MappingField[] = [
  'installmentNo',
  'dueDate',
  'principal',
  'interest',
];

export type ReferenceMapping = Partial<Record<MappingField, string>>;

export interface ReferenceManualRow {
  readonly n: number;
  readonly dueDate: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees?: string;
  readonly insurance?: string;
  readonly taxes?: string;
  readonly total?: string;
  readonly balance?: string;
}

export interface ReferenceInput {
  readonly source: ReferenceSource;
  readonly text?: string;
  readonly delimiter?: Delimiter;
  readonly hasHeader?: boolean;
  readonly mapping?: ReferenceMapping;
  readonly dateFormat?: DateFormat;
  readonly decimalSeparator?: ',' | '.';
  readonly rows?: readonly ReferenceManualRow[];
}

export interface ReferencePreview {
  readonly delimiter: string;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly preview: readonly (readonly string[])[];
}

export interface ReferenceSchedule {
  readonly id: string;
  readonly referenceVersion: number;
  readonly source: ReferenceSource;
  readonly rowCount: number;
  readonly createdAt: string;
}

export type ComparisonComponent = 'principal' | 'interest' | 'fees' | 'insurance' | 'taxes' | 'total';
export const COMPARED: readonly ComparisonComponent[] = [
  'principal',
  'interest',
  'fees',
  'insurance',
  'taxes',
  'total',
];

export interface ComparedSide {
  readonly dueDate: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
  readonly total: string;
}

export type ComparedRowStatus = 'MATCH' | 'DIFFERENT' | 'ONLY_REFERENCE' | 'ONLY_SYSTEM';

/** Fila del reporte (forma del comparador del backend; el contrato la declara abierta). */
export interface ComparedRow {
  readonly n: number;
  readonly status: ComparedRowStatus;
  readonly datesMatch: boolean | null;
  readonly system: ComparedSide | null;
  readonly reference: ComparedSide | null;
  /** Banco − sistema por componente. */
  readonly differences: Readonly<Record<ComparisonComponent, string>> | null;
}

export interface ComparisonSummary {
  readonly totalRows: number;
  readonly matching: number;
  readonly firstDifference: { readonly n: number } | null;
  readonly sumDifferences: Readonly<Record<ComparisonComponent, string>>;
  readonly differingComponents: readonly ComparisonComponent[];
  readonly dateMismatches: readonly number[];
  readonly referencePrincipal: string;
  readonly loanPrincipal: string;
  readonly onlyReference: readonly number[];
  readonly onlySystem: readonly number[];
}

export type Suggestion =
  | {
      readonly kind: 'CONVENTION';
      readonly dayCount: LoanDayCount;
      readonly current: boolean;
      readonly matchingInstallments: number;
      readonly interestMatchingInstallments: number;
      readonly totalRows: number;
      readonly betterThanCurrent: boolean;
    }
  | { readonly kind: 'ONLY_DATES' }
  | { readonly kind: 'ONLY_CHARGES' }
  | { readonly kind: 'ONLY_LAST_INSTALLMENT'; readonly tolerance: string }
  | { readonly kind: 'PRINCIPAL_SUM_DIFFERS'; readonly difference: string };

export type ComparisonStatus = 'MATCH' | 'UNEXPLAINED' | 'EXPLAINED';

export interface ScheduleComparison {
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
  readonly summary: ComparisonSummary;
  readonly rows: readonly ComparedRow[];
  readonly suggestions: readonly Suggestion[];
}

export interface ReferenceUploadResult extends ReferenceSchedule {
  readonly comparison: ScheduleComparison;
}

/** Error de fila de `LOAN_REFERENCE_INVALID` (`details.rows[]`). */
export interface ReferenceRowError {
  readonly row: number;
  readonly field: string;
  readonly code: string;
  readonly message: string;
}
