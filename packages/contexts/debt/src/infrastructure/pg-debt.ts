import { PgUnitOfWork, currentRequestContext, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { dec } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import type {
  AllocationRecord,
  ComparisonRecord,
  CurrencyCatalogPort,
  IdGenerator,
  LoanRepository,
  PaymentRecord,
  PaymentRepository,
  ReferenceRecord,
  ReferenceRepository,
  ScheduleRepository,
  ScheduleVersionRecord,
  StoredInstallment,
  UnitOfWork,
} from '../application/ports/index.js';
import {
  Loan,
  type ComponentAmounts,
  type LoanCharges,
  type LoanState,
  type ReferenceScheduleRow,
} from '../domain/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>();
const json = (value: unknown): string => JSON.stringify(value);
const CHUNK = 200;
const chunks = <T>(items: readonly T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
};

const ISO = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
/** `date` → `YYYY-MM-DD` (PG devuelve Date en pg; se fuerza texto). */
const D = (col: string) => sql.raw(`to_char(${col}, 'YYYY-MM-DD')`);

/** Unidad de trabajo de DEBT: transacción PG con el contexto RLS del workspace; reutiliza la del llamador. */
export class PgDebtUnitOfWork implements UnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const actor = currentRequestContext()?.actor;
    return this.uow.run({ userId: actor && actor.type === 'USER' ? actor.userId : null, workspaceId }, fn);
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };

/** Escala de `fx.currency`. */
export const pgCurrencyCatalog: CurrencyCatalogPort = {
  async scaleOf(code) {
    const { rows } = await sql<{ scale: number }>`
      SELECT scale FROM fx.currency WHERE code = ${code} AND is_active`.execute(db());
    return rows[0] ? Number(rows[0].scale) : null;
  },
};

/** Monto de BD (numeric(38,18)) a la escala de su moneda. */
const money = (value: string | null, scale: number): string => dec(value ?? '0').toFixed(scale);
const rate = (value: string): string => dec(value).toFixed();

// ───────────────────────────────────────────────────────────── loan

interface LoanRow {
  id: string;
  workspace_id: string;
  name: string;
  account_id: string;
  disbursement_account_id: string;
  payment_account_id: string;
  lender_counterparty_id: string | null;
  principal: string;
  currency: string;
  scale: number;
  annual_rate: string;
  rate_type: LoanState['rateType'];
  day_count: LoanState['dayCount'];
  frequency: LoanState['frequency'];
  term_installments: number;
  method: LoanState['method'];
  disbursement_date: string;
  first_due_date: string;
  charges: LoanCharges;
  retained_fee: string;
  origin: LoanState['origin'];
  existing_as_of: string | null;
  existing_outstanding: string | null;
  next_installment_no: number | null;
  status: LoanState['status'];
  current_schedule_version: number | null;
  recurring_definition_id: string | null;
  disbursement_transaction_id: string | null;
  cancelled_reason: string | null;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const LOAN_COLUMNS = sql`
  l.id, l.workspace_id, l.name, l.account_id, l.disbursement_account_id, l.payment_account_id,
  l.lender_counterparty_id, l.principal, l.currency, c.scale, l.annual_rate, l.rate_type, l.day_count, l.frequency,
  l.term_installments, l.method, ${D('l.disbursement_date')} AS disbursement_date,
  ${D('l.first_due_date')} AS first_due_date, l.charges, l.retained_fee, l.origin,
  ${D('l.existing_as_of')} AS existing_as_of, l.existing_outstanding, l.next_installment_no, l.status,
  l.current_schedule_version, l.recurring_definition_id, l.disbursement_transaction_id, l.cancelled_reason,
  l.version, l.created_by, ${ISO('l.created_at')} AS created_at, ${ISO('l.updated_at')} AS updated_at`;

const toLoan = (r: LoanRow): Loan => {
  const scale = Number(r.scale);
  return Loan.restore({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    accountId: r.account_id,
    disbursementAccountId: r.disbursement_account_id,
    paymentAccountId: r.payment_account_id,
    lenderCounterpartyId: r.lender_counterparty_id,
    principal: money(r.principal, scale),
    currency: r.currency,
    annualRate: rate(r.annual_rate),
    rateType: r.rate_type,
    dayCount: r.day_count,
    frequency: r.frequency,
    termInstallments: Number(r.term_installments),
    method: r.method,
    disbursementDate: r.disbursement_date,
    firstDueDate: r.first_due_date,
    charges: r.charges,
    retainedFee: money(r.retained_fee, scale),
    origin: r.origin,
    existing:
      r.origin === 'EXISTING'
        ? {
            asOf: r.existing_as_of as string,
            outstanding: money(r.existing_outstanding, scale),
            nextInstallmentNo: Number(r.next_installment_no),
          }
        : null,
    status: r.status,
    currentScheduleVersion: r.current_schedule_version === null ? null : Number(r.current_schedule_version),
    recurringDefinitionId: r.recurring_definition_id,
    disbursementTransactionId: r.disbursement_transaction_id,
    cancelledReason: r.cancelled_reason,
    version: Number(r.version),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
};

export class PgLoanRepository implements LoanRepository {
  async findById(workspaceId: string, id: string, options?: { lock?: 'update' }): Promise<Loan | null> {
    const lock = options?.lock === 'update' ? sql`FOR UPDATE OF l` : sql``;
    const { rows } = await sql<LoanRow>`
      SELECT ${LOAN_COLUMNS} FROM debt.loan l JOIN fx.currency c ON c.code = l.currency
       WHERE l.workspace_id = ${workspaceId} AND l.id = ${id} ${lock}`.execute(db());
    return rows[0] ? toLoan(rows[0]) : null;
  }

  async insert(loan: Loan): Promise<void> {
    const s = loan.snapshot;
    await sql`
      INSERT INTO debt.loan (
        id, workspace_id, name, account_id, disbursement_account_id, payment_account_id, lender_counterparty_id,
        principal, currency, annual_rate, rate_type, day_count, frequency, term_installments, method,
        disbursement_date, first_due_date, charges, retained_fee, origin, existing_as_of, existing_outstanding,
        next_installment_no, status, current_schedule_version, recurring_definition_id,
        disbursement_transaction_id, cancelled_reason, created_by, created_at, updated_at, version)
      VALUES (
        ${s.id}, ${s.workspaceId}, ${s.name}, ${s.accountId}, ${s.disbursementAccountId}, ${s.paymentAccountId},
        ${s.lenderCounterpartyId}, ${s.principal}, ${s.currency}, ${s.annualRate}, ${s.rateType}, ${s.dayCount},
        ${s.frequency}, ${s.termInstallments}, ${s.method}, ${s.disbursementDate}::date, ${s.firstDueDate}::date,
        ${json(s.charges)}::jsonb, ${s.retainedFee}, ${s.origin}, ${s.existing?.asOf ?? null}::date,
        ${s.existing?.outstanding ?? null}, ${s.existing?.nextInstallmentNo ?? null}, ${s.status},
        ${s.currentScheduleVersion}, ${s.recurringDefinitionId}, ${s.disbursementTransactionId},
        ${s.cancelledReason}, ${s.createdBy}, ${s.createdAt}::timestamptz, ${s.updatedAt}::timestamptz, ${s.version})`.execute(
      db(),
    );
  }

  async save(loan: Loan): Promise<boolean> {
    const s = loan.snapshot;
    const result = await sql`
      UPDATE debt.loan SET
        name = ${s.name}, account_id = ${s.accountId}, disbursement_account_id = ${s.disbursementAccountId},
        payment_account_id = ${s.paymentAccountId}, lender_counterparty_id = ${s.lenderCounterpartyId},
        principal = ${s.principal}, annual_rate = ${s.annualRate}, rate_type = ${s.rateType},
        day_count = ${s.dayCount}, frequency = ${s.frequency}, term_installments = ${s.termInstallments},
        method = ${s.method}, disbursement_date = ${s.disbursementDate}::date,
        first_due_date = ${s.firstDueDate}::date, charges = ${json(s.charges)}::jsonb,
        retained_fee = ${s.retainedFee}, status = ${s.status},
        current_schedule_version = ${s.currentScheduleVersion},
        recurring_definition_id = ${s.recurringDefinitionId},
        disbursement_transaction_id = ${s.disbursementTransactionId}, cancelled_reason = ${s.cancelledReason},
        updated_at = ${s.updatedAt}::timestamptz, version = ${s.version}
       WHERE workspace_id = ${s.workspaceId} AND id = ${s.id} AND version = ${loan.persistedVersion}`.execute(
      db(),
    );
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async list(workspaceId: string, filter: { statuses?: readonly string[] }): Promise<readonly Loan[]> {
    const statuses = filter.statuses && filter.statuses.length > 0 ? [...filter.statuses] : null;
    const { rows } = await sql<LoanRow>`
      SELECT ${LOAN_COLUMNS} FROM debt.loan l JOIN fx.currency c ON c.code = l.currency
       WHERE l.workspace_id = ${workspaceId}
         AND (${statuses}::text[] IS NULL OR l.status = ANY(${statuses}::text[]))
       ORDER BY l.created_at DESC, l.id DESC`.execute(db());
    return rows.map(toLoan);
  }

  async findActiveByAccount(workspaceId: string, accountId: string): Promise<Loan | null> {
    const { rows } = await sql<LoanRow>`
      SELECT ${LOAN_COLUMNS} FROM debt.loan l JOIN fx.currency c ON c.code = l.currency
       WHERE l.workspace_id = ${workspaceId} AND l.account_id = ${accountId} AND l.status <> 'CANCELLED'`.execute(
      db(),
    );
    return rows[0] ? toLoan(rows[0]) : null;
  }

  async findByTransactionId(workspaceId: string, transactionId: string) {
    const { rows } = await sql<{ loan_id: string }>`
      SELECT loan_id FROM debt.loan_payment WHERE workspace_id = ${workspaceId} AND transaction_id = ${transactionId}
      UNION ALL
      SELECT id FROM debt.loan WHERE workspace_id = ${workspaceId} AND disbursement_transaction_id = ${transactionId}
      LIMIT 1`.execute(db());
    return rows[0] ? { loanId: rows[0].loan_id } : null;
  }
}

// ───────────────────────────────────────────────────────────── cronograma

interface InstallmentRow {
  id: string;
  loan_id: string;
  schedule_version: number;
  installment_no: number;
  due_date: string;
  period_start: string;
  period_end: string;
  principal_amount: string;
  interest_amount: string;
  fees_amount: string;
  insurance_amount: string;
  tax_amount: string;
  total_amount: string;
  opening_balance: string;
  closing_balance: string;
  scale: number;
}

export class PgScheduleRepository implements ScheduleRepository {
  async insertVersion(
    workspaceId: string,
    version: ScheduleVersionRecord,
    installments: readonly StoredInstallment[],
  ): Promise<void> {
    await sql`
      INSERT INTO debt.loan_schedule_version
        (loan_id, workspace_id, schedule_version, reason, effective_from, parameters, created_by)
      VALUES (${version.loanId}, ${workspaceId}, ${version.scheduleVersion}, ${version.reason},
              ${version.effectiveFrom}::date, ${json(version.parameters)}::jsonb, ${version.createdBy})`.execute(
      db(),
    );
    for (const part of chunks(installments)) {
      await sql`
        INSERT INTO debt.loan_installment
          (id, workspace_id, loan_id, schedule_version, installment_no, due_date, period_start, period_end,
           principal_amount, interest_amount, fees_amount, insurance_amount, tax_amount, total_amount,
           opening_balance, closing_balance, currency)
        SELECT (e->>'id')::uuid, ${workspaceId}::uuid, ${version.loanId}::uuid, ${version.scheduleVersion}::int,
               (e->>'n')::int, (e->>'dueDate')::date, (e->>'periodStart')::date, (e->>'periodEnd')::date,
               (e->>'principal')::numeric, (e->>'interest')::numeric, (e->>'fees')::numeric,
               (e->>'insurance')::numeric, (e->>'taxes')::numeric, (e->>'total')::numeric,
               (e->>'openingBalance')::numeric, (e->>'closingBalance')::numeric, l.currency
          FROM jsonb_array_elements(${json(part)}::jsonb) e
          JOIN debt.loan l ON l.id = ${version.loanId}::uuid AND l.workspace_id = ${workspaceId}::uuid`.execute(
        db(),
      );
    }
  }

  async versionOf(loanId: string, version: number): Promise<ScheduleVersionRecord | null> {
    const { rows } = await sql<{
      loan_id: string;
      schedule_version: number;
      reason: 'INITIAL';
      effective_from: string;
      parameters: Record<string, unknown>;
      created_by: string;
    }>`
      SELECT loan_id, schedule_version, reason, ${D('effective_from')} AS effective_from, parameters, created_by
        FROM debt.loan_schedule_version WHERE loan_id = ${loanId} AND schedule_version = ${version}`.execute(
      db(),
    );
    const r = rows[0];
    return r
      ? {
          loanId: r.loan_id,
          scheduleVersion: Number(r.schedule_version),
          reason: r.reason,
          effectiveFrom: r.effective_from,
          parameters: r.parameters,
          createdBy: r.created_by,
        }
      : null;
  }

  async installments(loanId: string, version: number): Promise<readonly StoredInstallment[]> {
    const { rows } = await sql<InstallmentRow>`
      SELECT i.id, i.loan_id, i.schedule_version, i.installment_no, ${D('i.due_date')} AS due_date,
             ${D('i.period_start')} AS period_start, ${D('i.period_end')} AS period_end,
             i.principal_amount, i.interest_amount, i.fees_amount, i.insurance_amount, i.tax_amount,
             i.total_amount, i.opening_balance, i.closing_balance, c.scale
        FROM debt.loan_installment i JOIN fx.currency c ON c.code = i.currency
       WHERE i.loan_id = ${loanId} AND i.schedule_version = ${version}
       ORDER BY i.installment_no`.execute(db());
    return rows.map((r) => {
      const scale = Number(r.scale);
      return {
        id: r.id,
        loanId: r.loan_id,
        scheduleVersion: Number(r.schedule_version),
        n: Number(r.installment_no),
        dueDate: r.due_date,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        principal: money(r.principal_amount, scale),
        interest: money(r.interest_amount, scale),
        fees: money(r.fees_amount, scale),
        insurance: money(r.insurance_amount, scale),
        taxes: money(r.tax_amount, scale),
        total: money(r.total_amount, scale),
        openingBalance: money(r.opening_balance, scale),
        closingBalance: money(r.closing_balance, scale),
      };
    });
  }
}

// ───────────────────────────────────────────────────────────── pagos

interface PaymentRow {
  id: string;
  loan_id: string;
  payment_no: number;
  transaction_id: string;
  account_id: string;
  business_date: string;
  amount: string;
  principal: string;
  interest: string;
  fees: string;
  insurance: string;
  taxes: string;
  explicit_breakdown: boolean;
  payment_method: string | null;
  status: 'ACTIVE' | 'VOIDED';
  voided_at: string | null;
  voided_reason: string | null;
  created_by: string;
  created_at: string;
  scale: number;
}

const PAYMENT_COLUMNS = sql`
  p.id, p.loan_id, p.payment_no, p.transaction_id, p.account_id, ${D('p.business_date')} AS business_date,
  p.amount, p.principal, p.interest, p.fees, p.insurance, p.taxes, p.explicit_breakdown, p.payment_method, p.status,
  ${ISO('p.voided_at')} AS voided_at, p.voided_reason, p.created_by, ${ISO('p.created_at')} AS created_at, c.scale`;

const toPayment = (r: PaymentRow): PaymentRecord => {
  const scale = Number(r.scale);
  return {
    id: r.id,
    loanId: r.loan_id,
    paymentNo: Number(r.payment_no),
    transactionId: r.transaction_id,
    accountId: r.account_id,
    businessDate: r.business_date,
    amount: money(r.amount, scale),
    principal: money(r.principal, scale),
    interest: money(r.interest, scale),
    fees: money(r.fees, scale),
    insurance: money(r.insurance, scale),
    taxes: money(r.taxes, scale),
    explicitBreakdown: r.explicit_breakdown,
    paymentMethod: r.payment_method,
    status: r.status,
    voidedAt: r.voided_at,
    voidedReason: r.voided_reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
};

const FROM_PAYMENT = sql`FROM debt.loan_payment p JOIN debt.loan l ON l.id = p.loan_id JOIN fx.currency c ON c.code = l.currency`;

export class PgPaymentRepository implements PaymentRepository {
  async nextPaymentNo(loanId: string): Promise<number> {
    const { rows } = await sql<{ n: number }>`
      SELECT COALESCE(MAX(payment_no), 0) + 1 AS n FROM debt.loan_payment WHERE loan_id = ${loanId}`.execute(
      db(),
    );
    return Number(rows[0]?.n ?? 1);
  }

  async insert(
    workspaceId: string,
    p: PaymentRecord,
    allocations: readonly AllocationRecord[],
  ): Promise<void> {
    await sql`
      INSERT INTO debt.loan_payment
        (id, workspace_id, loan_id, payment_no, transaction_id, account_id, business_date, amount, principal,
         interest, fees, insurance, taxes, explicit_breakdown, payment_method, status, created_by, created_at)
      VALUES (${p.id}, ${workspaceId}, ${p.loanId}, ${p.paymentNo}, ${p.transactionId}, ${p.accountId},
              ${p.businessDate}::date, ${p.amount}, ${p.principal}, ${p.interest}, ${p.fees}, ${p.insurance},
              ${p.taxes}, ${p.explicitBreakdown}, ${p.paymentMethod}, 'ACTIVE', ${p.createdBy},
              ${p.createdAt}::timestamptz)`.execute(db());
    if (allocations.length > 0) {
      await sql`
        INSERT INTO debt.loan_payment_allocation
          (payment_id, installment_id, workspace_id, loan_id, installment_no, principal, interest, fees, insurance, taxes)
        SELECT ${p.id}::uuid, (e->>'installmentId')::uuid, ${workspaceId}::uuid, ${p.loanId}::uuid,
               (e->>'installmentNo')::int, (e->>'principal')::numeric, (e->>'interest')::numeric,
               (e->>'fees')::numeric, (e->>'insurance')::numeric, (e->>'taxes')::numeric
          FROM jsonb_array_elements(${json(allocations)}::jsonb) e`.execute(db());
    }
  }

  async markVoided(
    workspaceId: string,
    paymentId: string,
    input: { voidedAt: string; voidedBy: string; reason: string },
  ): Promise<void> {
    await sql`
      UPDATE debt.loan_payment SET status = 'VOIDED', voided_at = ${input.voidedAt}::timestamptz,
             voided_by = ${input.voidedBy}, voided_reason = ${input.reason}
       WHERE workspace_id = ${workspaceId} AND id = ${paymentId} AND status = 'ACTIVE'`.execute(db());
  }

  async list(loanId: string): Promise<readonly PaymentRecord[]> {
    const { rows } = await sql<PaymentRow>`
      SELECT ${PAYMENT_COLUMNS} ${FROM_PAYMENT} WHERE p.loan_id = ${loanId} ORDER BY p.payment_no`.execute(
      db(),
    );
    return rows.map(toPayment);
  }

  async find(loanId: string, paymentId: string): Promise<PaymentRecord | null> {
    const { rows } = await sql<PaymentRow>`
      SELECT ${PAYMENT_COLUMNS} ${FROM_PAYMENT} WHERE p.loan_id = ${loanId} AND p.id = ${paymentId}`.execute(
      db(),
    );
    return rows[0] ? toPayment(rows[0]) : null;
  }

  async latestActive(loanId: string): Promise<PaymentRecord | null> {
    const { rows } = await sql<PaymentRow>`
      SELECT ${PAYMENT_COLUMNS} ${FROM_PAYMENT} WHERE p.loan_id = ${loanId} AND p.status = 'ACTIVE'
       ORDER BY p.payment_no DESC LIMIT 1`.execute(db());
    return rows[0] ? toPayment(rows[0]) : null;
  }

  async allocationsOf(paymentId: string): Promise<readonly AllocationRecord[]> {
    const { rows } = await sql<{
      payment_id: string;
      installment_id: string;
      installment_no: number;
      principal: string;
      interest: string;
      fees: string;
      insurance: string;
      taxes: string;
      scale: number;
    }>`
      SELECT a.payment_id, a.installment_id, a.installment_no, a.principal, a.interest, a.fees, a.insurance,
             a.taxes, c.scale
        FROM debt.loan_payment_allocation a JOIN debt.loan l ON l.id = a.loan_id JOIN fx.currency c ON c.code = l.currency
       WHERE a.payment_id = ${paymentId} ORDER BY a.installment_no`.execute(db());
    return rows.map((r) => {
      const scale = Number(r.scale);
      return {
        paymentId: r.payment_id,
        installmentId: r.installment_id,
        installmentNo: Number(r.installment_no),
        principal: money(r.principal, scale),
        interest: money(r.interest, scale),
        fees: money(r.fees, scale),
        insurance: money(r.insurance, scale),
        taxes: money(r.taxes, scale),
      };
    });
  }

  async paidByInstallment(loanId: string): Promise<ReadonlyMap<string, ComponentAmounts>> {
    const { rows } = await sql<{
      installment_id: string;
      principal: string;
      interest: string;
      fees: string;
      insurance: string;
      taxes: string;
      scale: number;
    }>`
      SELECT a.installment_id, SUM(a.principal) AS principal, SUM(a.interest) AS interest, SUM(a.fees) AS fees,
             SUM(a.insurance) AS insurance, SUM(a.taxes) AS taxes, MAX(c.scale) AS scale
        FROM debt.loan_payment_allocation a
        JOIN debt.loan_payment p ON p.id = a.payment_id AND p.status = 'ACTIVE'
        JOIN debt.loan l ON l.id = a.loan_id JOIN fx.currency c ON c.code = l.currency
       WHERE a.loan_id = ${loanId} GROUP BY a.installment_id`.execute(db());
    return new Map(
      rows.map((r) => {
        const scale = Number(r.scale);
        return [
          r.installment_id,
          {
            taxes: money(r.taxes, scale),
            insurance: money(r.insurance, scale),
            fees: money(r.fees, scale),
            interest: money(r.interest, scale),
            principal: money(r.principal, scale),
          },
        ] as const;
      }),
    );
  }

  async totalsByLoan(workspaceId: string, loanIds: readonly string[]) {
    const { rows } = await sql<{
      loan_id: string;
      principal: string;
      interest: string;
      fees: string;
      insurance: string;
      taxes: string;
      scale: number;
    }>`
      SELECT p.loan_id, SUM(p.principal) AS principal, SUM(p.interest) AS interest, SUM(p.fees) AS fees,
             SUM(p.insurance) AS insurance, SUM(p.taxes) AS taxes, MAX(c.scale) AS scale
        ${FROM_PAYMENT}
       WHERE p.workspace_id = ${workspaceId} AND p.loan_id = ANY(${[...loanIds]}::uuid[]) AND p.status = 'ACTIVE'
       GROUP BY p.loan_id`.execute(db());
    return new Map(
      rows.map((r) => {
        const scale = Number(r.scale);
        return [
          r.loan_id,
          {
            taxes: money(r.taxes, scale),
            insurance: money(r.insurance, scale),
            fees: money(r.fees, scale),
            interest: money(r.interest, scale),
            principal: money(r.principal, scale),
          },
        ] as const;
      }),
    );
  }

  async interestPaid(workspaceId: string, range: { from: string; to: string }) {
    const { rows } = await sql<{ loan_id: string; amount: string; currency: string; scale: number }>`
      SELECT p.loan_id, SUM(p.interest) AS amount, l.currency, MAX(c.scale) AS scale
        ${FROM_PAYMENT}
       WHERE p.workspace_id = ${workspaceId} AND p.status = 'ACTIVE'
         AND p.business_date BETWEEN ${range.from}::date AND ${range.to}::date
       GROUP BY p.loan_id, l.currency HAVING SUM(p.interest) > 0
       ORDER BY p.loan_id`.execute(db());
    return rows.map((r) => ({
      loanId: r.loan_id,
      amount: money(r.amount, Number(r.scale)),
      currency: r.currency,
    }));
  }
}

// ───────────────────────────────────────────────────────────── referencias del banco

export class PgReferenceRepository implements ReferenceRepository {
  async nextVersion(loanId: string): Promise<number> {
    const { rows } = await sql<{ n: number }>`
      SELECT COALESCE(MAX(reference_version), 0) + 1 AS n FROM debt.loan_reference_schedule
       WHERE loan_id = ${loanId}`.execute(db());
    return Number(rows[0]?.n ?? 1);
  }

  async insert(
    workspaceId: string,
    ref: ReferenceRecord,
    rows: readonly ReferenceScheduleRow[],
  ): Promise<void> {
    await sql`
      INSERT INTO debt.loan_reference_schedule
        (id, workspace_id, loan_id, reference_version, source, mapping, row_count, created_at, created_by)
      VALUES (${ref.id}, ${workspaceId}, ${ref.loanId}, ${ref.referenceVersion}, ${ref.source},
              ${ref.mapping === null ? null : json(ref.mapping)}::jsonb, ${ref.rowCount},
              ${ref.createdAt}::timestamptz, ${ref.createdBy})`.execute(db());
    for (const part of chunks(rows)) {
      await sql`
        INSERT INTO debt.loan_reference_row
          (reference_id, workspace_id, installment_no, due_date, principal, interest, fees, insurance, taxes, total, balance)
        SELECT ${ref.id}::uuid, ${workspaceId}::uuid, (e->>'n')::int, (e->>'dueDate')::date,
               (e->>'principal')::numeric, (e->>'interest')::numeric, (e->>'fees')::numeric,
               (e->>'insurance')::numeric, (e->>'taxes')::numeric, (e->>'total')::numeric,
               NULLIF(e->>'balance', '')::numeric
          FROM jsonb_array_elements(${json(part)}::jsonb) e`.execute(db());
    }
  }

  private toRecord(r: {
    id: string;
    loan_id: string;
    reference_version: number;
    source: ReferenceRecord['source'];
    mapping: Record<string, unknown> | null;
    row_count: number;
    created_at: string;
    created_by: string;
  }): ReferenceRecord {
    return {
      id: r.id,
      loanId: r.loan_id,
      referenceVersion: Number(r.reference_version),
      source: r.source,
      mapping: r.mapping,
      rowCount: Number(r.row_count),
      createdAt: r.created_at,
      createdBy: r.created_by,
    };
  }

  async list(loanId: string): Promise<readonly ReferenceRecord[]> {
    const { rows } = await sql<Parameters<PgReferenceRepository['toRecord']>[0]>`
      SELECT id, loan_id, reference_version, source, mapping, row_count, ${ISO('created_at')} AS created_at, created_by
        FROM debt.loan_reference_schedule WHERE loan_id = ${loanId} ORDER BY reference_version DESC`.execute(
      db(),
    );
    return rows.map((r) => this.toRecord(r));
  }

  async find(loanId: string, referenceId: string): Promise<ReferenceRecord | null> {
    const { rows } = await sql<Parameters<PgReferenceRepository['toRecord']>[0]>`
      SELECT id, loan_id, reference_version, source, mapping, row_count, ${ISO('created_at')} AS created_at, created_by
        FROM debt.loan_reference_schedule WHERE loan_id = ${loanId} AND id = ${referenceId}`.execute(db());
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async latest(loanId: string): Promise<ReferenceRecord | null> {
    const { rows } = await sql<Parameters<PgReferenceRepository['toRecord']>[0]>`
      SELECT id, loan_id, reference_version, source, mapping, row_count, ${ISO('created_at')} AS created_at, created_by
        FROM debt.loan_reference_schedule WHERE loan_id = ${loanId}
       ORDER BY reference_version DESC LIMIT 1`.execute(db());
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async rows(referenceId: string): Promise<readonly ReferenceScheduleRow[]> {
    const { rows } = await sql<{
      installment_no: number;
      due_date: string;
      principal: string;
      interest: string;
      fees: string;
      insurance: string;
      taxes: string;
      total: string;
      balance: string | null;
      scale: number;
    }>`
      SELECT r.installment_no, ${D('r.due_date')} AS due_date, r.principal, r.interest, r.fees, r.insurance, r.taxes,
             r.total, r.balance, c.scale
        FROM debt.loan_reference_row r
        JOIN debt.loan_reference_schedule s ON s.id = r.reference_id
        JOIN debt.loan l ON l.id = s.loan_id JOIN fx.currency c ON c.code = l.currency
       WHERE r.reference_id = ${referenceId} ORDER BY r.installment_no`.execute(db());
    return rows.map((r) => {
      const scale = Number(r.scale);
      return {
        n: Number(r.installment_no),
        dueDate: r.due_date,
        principal: money(r.principal, scale),
        interest: money(r.interest, scale),
        fees: money(r.fees, scale),
        insurance: money(r.insurance, scale),
        taxes: money(r.taxes, scale),
        total: money(r.total, scale),
        ...(r.balance === null ? {} : { balance: money(r.balance, scale) }),
      };
    });
  }

  private toComparison(r: {
    id: string;
    loan_id: string;
    reference_id: string;
    schedule_version: number;
    matched: number;
    total_rows: number;
    first_difference_no: number | null;
    summary: Record<string, unknown>;
    status: ComparisonRecord['status'];
    explanation: string | null;
    explained_by: string | null;
    explained_at: string | null;
  }): ComparisonRecord {
    return {
      id: r.id,
      loanId: r.loan_id,
      referenceId: r.reference_id,
      scheduleVersion: Number(r.schedule_version),
      matched: Number(r.matched),
      totalRows: Number(r.total_rows),
      firstDifferenceNo: r.first_difference_no === null ? null : Number(r.first_difference_no),
      summary: r.summary,
      status: r.status,
      explanation: r.explanation,
      explainedBy: r.explained_by,
      explainedAt: r.explained_at,
    };
  }

  async findComparison(referenceId: string, scheduleVersion: number): Promise<ComparisonRecord | null> {
    const { rows } = await sql<Parameters<PgReferenceRepository['toComparison']>[0]>`
      SELECT id, loan_id, reference_id, schedule_version, matched, total_rows, first_difference_no, summary, status,
             explanation, explained_by, ${ISO('explained_at')} AS explained_at
        FROM debt.loan_schedule_comparison
       WHERE reference_id = ${referenceId} AND schedule_version = ${scheduleVersion}`.execute(db());
    return rows[0] ? this.toComparison(rows[0]) : null;
  }

  async upsertComparison(workspaceId: string, c: ComparisonRecord): Promise<void> {
    await sql`
      INSERT INTO debt.loan_schedule_comparison
        (id, workspace_id, loan_id, reference_id, schedule_version, matched, total_rows, first_difference_no, summary,
         status, explanation, explained_by, explained_at)
      VALUES (${c.id}, ${workspaceId}, ${c.loanId}, ${c.referenceId}, ${c.scheduleVersion}, ${c.matched},
              ${c.totalRows}, ${c.firstDifferenceNo}, ${json(c.summary)}::jsonb, ${c.status}, ${c.explanation},
              ${c.explainedBy}, ${c.explainedAt}::timestamptz)
      ON CONFLICT (reference_id, schedule_version) DO UPDATE SET
        matched = EXCLUDED.matched, total_rows = EXCLUDED.total_rows,
        first_difference_no = EXCLUDED.first_difference_no, summary = EXCLUDED.summary, status = EXCLUDED.status,
        explanation = EXCLUDED.explanation, explained_by = EXCLUDED.explained_by,
        explained_at = EXCLUDED.explained_at`.execute(db());
  }

  async explain(
    workspaceId: string,
    comparisonId: string,
    input: { explanation: string; explainedBy: string; explainedAt: string },
  ): Promise<void> {
    await sql`
      UPDATE debt.loan_schedule_comparison SET status = 'EXPLAINED', explanation = ${input.explanation},
             explained_by = ${input.explainedBy}, explained_at = ${input.explainedAt}::timestamptz
       WHERE workspace_id = ${workspaceId} AND id = ${comparisonId}`.execute(db());
  }
}
