import type { AccountProvisioningPort } from '@pf/accounts/contracts';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { RecurringDefinitionPort } from '@pf/commitments/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { LoanTransactionsPort } from '@pf/transactions/contracts';
import type {
  ComparisonStatus,
  ComponentAmounts,
  Loan,
  ReferenceScheduleRow,
  ScheduleInstallment,
} from '../../domain/index.js';

/**
 * Puertos de DEBT (hexagonal). Los repositorios los implementa `infrastructure/` sobre PostgreSQL; los de otros
 * contextos son contratos públicos o adaptadores de la composición de `apps/api`.
 */

/** Transacción PG con `SET LOCAL app.workspace_id` (RLS, ADR-0023); reutiliza la del llamador si existe. */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

export interface IdGenerator {
  /** UUIDv7. */
  next(): string;
}

export interface OutboxPort {
  append(event: {
    readonly eventId: string;
    readonly eventType: string;
    readonly eventVersion: number;
    readonly occurredAt: string;
    readonly workspaceId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly payload: object;
  }): Promise<void>;
}

/** Zona horaria del workspace (IDENTITY; adapter en la composición). */
export interface CalendarPort {
  timeZoneOf(workspaceId: string): Promise<string>;
}

/** Escala de la moneda (`fx.currency`). */
export interface CurrencyCatalogPort {
  scaleOf(code: string): Promise<number | null>;
}

export interface AccountInfo {
  readonly accountId: string;
  readonly name: string;
  readonly type: string;
  readonly nature: 'ASSET' | 'LIABILITY';
  readonly currency: string;
  readonly status: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
}

export interface AccountsPort {
  /** Cuentas por id (las inexistentes no figuran). */
  find(workspaceId: string, accountIds: readonly string[]): Promise<readonly AccountInfo[]>;
  /** Elegibilidad para postear con bloqueo `FOR SHARE`: `REFERENCE_NOT_FOUND`, `ACCOUNT_ARCHIVED`, `ACCOUNT_CLOSED`. */
  assertCanPost(
    workspaceId: string,
    accounts: readonly { accountId: string; currency?: string }[],
  ): Promise<void>;
}

export interface BalancePort {
  /** Saldo PRESENTADO (pasivo positivo = adeudado) a la fecha; hoy si se omite. */
  presentedBalance(workspaceId: string, accountId: string, asOf?: string): Promise<string>;
  /** Saldos presentados por lote (hoy). */
  presentedBalances(workspaceId: string, accountIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export interface CounterpartyPort {
  /** `REFERENCE_NOT_FOUND` / `COUNTERPARTY_ARCHIVED` si no es utilizable. */
  assertUsable(userId: string, workspaceId: string, counterpartyId: string): Promise<void>;
  names(workspaceId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

// ───────────────────────────────────────────── repositorios

export interface StoredInstallment extends ScheduleInstallment {
  readonly id: string;
  readonly loanId: string;
  readonly scheduleVersion: number;
}

export const SCHEDULE_VERSION_REASONS = [
  'INITIAL',
  'PREPAYMENT',
  'PREPAYMENT_VOIDED',
  'RATE_CHANGE',
  'CUSTOM_DEFINED',
  'CUSTOM_ADOPTED',
] as const;
export type ScheduleVersionReason = (typeof SCHEDULE_VERSION_REASONS)[number];

export interface ScheduleVersionRecord {
  readonly loanId: string;
  readonly scheduleVersion: number;
  readonly reason: ScheduleVersionReason;
  readonly effectiveFrom: string;
  /** Primera cuota que la versión reemplaza (1 en la versión inicial). */
  readonly fromInstallmentNo: number;
  readonly sourcePaymentId?: string | null;
  readonly sourceRateChangeId?: string | null;
  readonly sourceReferenceId?: string | null;
  readonly parameters: Record<string, unknown>;
  readonly createdBy: string;
}

/** Versión con lo que solo la base conoce: fecha de creación y cuántas cuotas aporta. */
export interface ScheduleVersionListing extends ScheduleVersionRecord {
  readonly createdAt: string;
  readonly installmentCount: number;
}

export interface RateChangeRecord {
  readonly id: string;
  readonly loanId: string;
  /** Fracción decimal. */
  readonly annualRate: string;
  readonly effectiveFrom: string;
  readonly scheduleVersion: number;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface RateChangeRepository {
  insert(workspaceId: string, change: RateChangeRecord): Promise<void>;
  /** Por vigencia ascendente. */
  list(loanId: string): Promise<readonly RateChangeRecord[]>;
}

export interface LoanRepository {
  findById(workspaceId: string, id: string, options?: { lock?: 'update' }): Promise<Loan | null>;
  insert(loan: Loan): Promise<void>;
  /** Control optimista por versión; `false` si otro cambio ganó. */
  save(loan: Loan): Promise<boolean>;
  list(workspaceId: string, filter: { statuses?: readonly string[] }): Promise<readonly Loan[]>;
  /** Préstamo no cancelado que respalda la cuenta (sin bloqueo). */
  findActiveByAccount(workspaceId: string, accountId: string): Promise<Loan | null>;
  /** Préstamo (no cancelado) por id de definición recurrente o de transacción administrada (para guardas/etiquetas). */
  findByTransactionId(workspaceId: string, transactionId: string): Promise<{ loanId: string } | null>;
}

export interface ScheduleRepository {
  insertVersion(
    workspaceId: string,
    version: ScheduleVersionRecord,
    installments: readonly StoredInstallment[],
  ): Promise<void>;
  versionOf(loanId: string, version: number): Promise<ScheduleVersionRecord | null>;
  /** Versiones del cronograma, de la más antigua a la vigente. */
  versions(loanId: string): Promise<readonly ScheduleVersionListing[]>;
  /**
   * Cronograma EFECTIVO a esa versión: de cada número de cuota, la fila de la última versión ≤ `version` cuya
   * `from_installment_no` lo cubre (las cuotas que una versión posterior reemplazó se excluyen).
   */
  installments(loanId: string, version: number): Promise<readonly StoredInstallment[]>;
  /** Solo las cuotas que la versión aporta. */
  ownInstallments(loanId: string, version: number): Promise<readonly StoredInstallment[]>;
}

export interface PaymentRecord {
  readonly id: string;
  readonly loanId: string;
  readonly paymentNo: number;
  readonly transactionId: string;
  readonly accountId: string;
  readonly businessDate: string;
  readonly amount: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
  readonly explicitBreakdown: boolean;
  readonly paymentMethod: string | null;
  /** `PREPAYMENT`: pago extraordinario a principal (+ comisión) sin imputaciones a cuotas. */
  readonly kind: 'REGULAR' | 'PREPAYMENT';
  readonly prepaymentOption: 'REDUCE_TERM' | 'REDUCE_INSTALLMENT' | null;
  readonly prepaymentFee: string | null;
  readonly status: 'ACTIVE' | 'VOIDED';
  readonly voidedAt: string | null;
  readonly voidedReason: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface AllocationRecord {
  readonly paymentId: string;
  readonly installmentId: string;
  readonly installmentNo: number;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
}

export interface PaymentRepository {
  nextPaymentNo(loanId: string): Promise<number>;
  insert(
    workspaceId: string,
    payment: PaymentRecord,
    allocations: readonly AllocationRecord[],
  ): Promise<void>;
  markVoided(
    workspaceId: string,
    paymentId: string,
    input: { voidedAt: string; voidedBy: string; reason: string },
  ): Promise<void>;
  list(loanId: string): Promise<readonly PaymentRecord[]>;
  find(loanId: string, paymentId: string): Promise<PaymentRecord | null>;
  /** El pago ACTIVE de mayor `paymentNo`. */
  latestActive(loanId: string): Promise<PaymentRecord | null>;
  allocationsOf(paymentId: string): Promise<readonly AllocationRecord[]>;
  /** Σ por cuota y componente de las imputaciones de pagos ACTIVE. */
  paidByInstallment(loanId: string): Promise<ReadonlyMap<string, ComponentAmounts>>;
  /** Σ de los componentes pagados (pagos ACTIVE) de varios préstamos. */
  totalsByLoan(
    workspaceId: string,
    loanIds: readonly string[],
  ): Promise<ReadonlyMap<string, ComponentAmounts>>;
  /** Σ interés de pagos ACTIVE con fecha en el rango, por préstamo. */
  interestPaid(
    workspaceId: string,
    range: { from: string; to: string },
  ): Promise<readonly { loanId: string; amount: string; currency: string }[]>;
}

export interface ReferenceRecord {
  readonly id: string;
  readonly loanId: string;
  readonly referenceVersion: number;
  readonly source: 'CSV' | 'PASTE' | 'MANUAL';
  readonly mapping: Record<string, unknown> | null;
  readonly rowCount: number;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface ComparisonRecord {
  readonly id: string;
  readonly loanId: string;
  readonly referenceId: string;
  readonly scheduleVersion: number;
  readonly matched: number;
  readonly totalRows: number;
  readonly firstDifferenceNo: number | null;
  readonly summary: Record<string, unknown>;
  readonly status: ComparisonStatus;
  readonly explanation: string | null;
  readonly explainedBy: string | null;
  readonly explainedAt: string | null;
}

export interface ReferenceRepository {
  nextVersion(loanId: string): Promise<number>;
  insert(
    workspaceId: string,
    reference: ReferenceRecord,
    rows: readonly ReferenceScheduleRow[],
  ): Promise<void>;
  list(loanId: string): Promise<readonly ReferenceRecord[]>;
  find(loanId: string, referenceId: string): Promise<ReferenceRecord | null>;
  latest(loanId: string): Promise<ReferenceRecord | null>;
  rows(referenceId: string): Promise<readonly ReferenceScheduleRow[]>;
  findComparison(referenceId: string, scheduleVersion: number): Promise<ComparisonRecord | null>;
  /** Inserta o reemplaza el resultado de la comparación (conserva la explicación si ya existía y aún aplica). */
  upsertComparison(workspaceId: string, comparison: ComparisonRecord): Promise<void>;
  explain(
    workspaceId: string,
    comparisonId: string,
    input: { explanation: string; explainedBy: string; explainedAt: string },
  ): Promise<void>;
}

export interface DebtSettings {
  readonly maxReferenceBytes: number;
  readonly maxReferenceRows: number;
}

export interface DebtDeps {
  readonly uow: UnitOfWork;
  readonly loans: LoanRepository;
  readonly schedules: ScheduleRepository;
  readonly payments: PaymentRepository;
  readonly rateChanges: RateChangeRepository;
  readonly references: ReferenceRepository;
  readonly accounts: AccountsPort;
  readonly provisioning: AccountProvisioningPort;
  readonly balances: BalancePort;
  readonly counterparties: CounterpartyPort;
  readonly currencies: CurrencyCatalogPort;
  readonly calendar: CalendarPort;
  readonly transactions: LoanTransactionsPort;
  readonly recurring: RecurringDefinitionPort;
  readonly audit: AuditPort;
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: DebtSettings;
}
