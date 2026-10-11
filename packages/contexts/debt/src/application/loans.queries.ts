import type { LifecycleDto } from '@pf/audit/contracts';
import { DomainError, LocalDate, dec, type Decimal } from '@pf/shared-kernel';
import type { LoanPortfolioItemDto, LoanPortfolioQuery, LoanStatusDto } from '../contracts/index.js';
import { Loan, PAYMENT_COMPONENTS } from '../domain/index.js';
import type { LoanTermsCommand } from './loans.service.js';
import type { DebtDeps } from './ports/index.js';
import {
  computeSchedule,
  installmentStates,
  outstandingPrincipal,
  type InstallmentState,
} from './schedule-support.js';
import { LOAN_AGGREGATE } from './recorder.js';
import {
  money,
  toLoanView,
  toPaymentView,
  toScheduleView,
  type InstallmentView,
  type LoanDetailView,
  type LoanView,
  type PaymentView,
  type SchedulePreviewView,
} from './views.js';

type PreviewInput = LoanTermsCommand & {
  readonly workspaceId: string;
  readonly origin?: 'NEW' | 'EXISTING' | undefined;
  readonly existing?: { readonly asOf: string; readonly nextInstallmentNo: number } | undefined;
};

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `loan ${id} not found`);

/** Texto decimal a la escala de la moneda (sin pasar por punto flotante). */
const fixed = (value: Decimal, scale: number): string => value.toFixed(scale);

const daysBetween = (from: string, to: LocalDate): number =>
  Math.max(0, to.toEpochDay() - LocalDate.parse(from).toEpochDay());

/** Consultas de DEBT (sin efectos) y el contrato público `LoanPortfolioQuery`. */
export class LoansQueries implements LoanPortfolioQuery {
  constructor(private readonly deps: DebtDeps) {}

  private async scaleOf(code: string): Promise<number> {
    const scale = await this.deps.currencies.scaleOf(code);
    if (scale === null) throw new DomainError('VALIDATION_FAILED', `currency ${code} is not available`);
    return scale;
  }

  private async today(workspaceId: string): Promise<LocalDate> {
    const tz = await this.deps.calendar.timeZoneOf(workspaceId);
    return LocalDate.ofInstant(this.deps.clock.now(), tz);
  }

  private async lenderNames(workspaceId: string, loans: readonly Loan[]) {
    const ids = [
      ...new Set(loans.map((l) => l.snapshot.lenderCounterpartyId).filter((x): x is string => !!x)),
    ];
    return ids.length > 0 ? this.deps.counterparties.names(workspaceId, ids) : new Map<string, string>();
  }

  private async load(workspaceId: string, loanId: string): Promise<Loan> {
    const loan = await this.deps.loans.findById(workspaceId, loanId);
    if (!loan) throw notFound(loanId);
    return loan;
  }

  // ───────────────────────────────────────────────────────────── cronograma

  private previewOf(loan: Loan, scale: number): SchedulePreviewView {
    const s = loan.snapshot;
    const schedule = computeSchedule(s, scale);
    const totals = schedule.installments.reduce(
      (acc, i) => ({ interest: acc.interest.plus(i.interest), total: acc.total.plus(i.total) }),
      { interest: dec('0'), total: dec('0') },
    );
    return {
      currency: s.currency,
      installmentAmount: schedule.installmentAmount,
      leveled: schedule.leveled,
      totalInterest: fixed(totals.interest, scale),
      totalAmount: fixed(totals.total, scale),
      installments: schedule.installments.map(toScheduleView),
    };
  }

  /** Estados de las cuotas de la versión vigente (vacío en borrador). */
  private async states(loan: Loan, scale: number): Promise<InstallmentState[]> {
    const version = loan.snapshot.currentScheduleVersion;
    if (version === null) return [];
    const installments = await this.deps.schedules.installments(loan.id, version);
    return installmentStates(installments, await this.deps.payments.paidByInstallment(loan.id), scale);
  }

  // ───────────────────────────────────────────────────────────── lectura

  async list(
    workspaceId: string,
    filter: { statuses?: readonly LoanStatusDto[] } = {},
  ): Promise<readonly LoanView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const loans = await this.deps.loans.list(
        workspaceId,
        filter.statuses ? { statuses: filter.statuses } : {},
      );
      const names = await this.lenderNames(workspaceId, loans);
      return loans.map((l) => {
        const s = l.snapshot;
        return toLoanView(s, s.lenderCounterpartyId ? (names.get(s.lenderCounterpartyId) ?? null) : null);
      });
    });
  }

  async get(workspaceId: string, loanId: string): Promise<LoanDetailView> {
    return this.deps.uow.run(workspaceId, async () => {
      const { deps } = this;
      const loan = await this.load(workspaceId, loanId);
      const s = loan.snapshot;
      const scale = await this.scaleOf(s.currency);
      const names = await this.lenderNames(workspaceId, [loan]);
      const base = toLoanView(s, s.lenderCounterpartyId ? (names.get(s.lenderCounterpartyId) ?? null) : null);
      const today = await this.today(workspaceId);
      const balance = dec(await deps.balances.presentedBalance(workspaceId, s.accountId)).toFixed(scale);
      const states = await this.states(loan, scale);
      const zero = money(dec('0').toFixed(scale), s.currency);
      const totals = await deps.payments.totalsByLoan(workspaceId, [loan.id]);
      const paid = totals.get(loan.id);
      const paidTotals = {
        principal: money(paid?.principal ?? zero.amount, s.currency),
        interest: money(paid?.interest ?? zero.amount, s.currency),
        fees: money(paid?.fees ?? zero.amount, s.currency),
        insurance: money(paid?.insurance ?? zero.amount, s.currency),
        taxes: money(paid?.taxes ?? zero.amount, s.currency),
      };
      const hasSchedule = states.length > 0 && (s.status === 'ACTIVE' || s.status === 'PAID_OFF');
      const outstanding = hasSchedule ? outstandingPrincipal(states, scale) : null;
      const open = states.filter((x) => x.status !== 'PAID');
      const overdue = open
        .filter((x) => x.installment.dueDate < today.toString())
        .map((x) => ({
          n: x.installment.n,
          dueDate: x.installment.dueDate,
          outstanding: money(x.pendingTotal, s.currency),
          overdueDays: daysBetween(x.installment.dueDate, today),
        }));
      const next = open[0];
      return {
        ...base,
        outstandingPrincipal: outstanding === null ? null : money(outstanding, s.currency),
        accountBalance: money(balance, s.currency),
        unreconciledDifference:
          outstanding === null || s.status !== 'ACTIVE'
            ? null
            : money(dec(outstanding).minus(balance).toFixed(scale), s.currency),
        installmentAmount: next ? money(next.installment.total, s.currency) : null,
        nextInstallment:
          s.status === 'ACTIVE' && next
            ? {
                n: next.installment.n,
                dueDate: next.installment.dueDate,
                outstanding: money(next.pendingTotal, s.currency),
                overdueDays: daysBetween(next.installment.dueDate, today),
              }
            : null,
        overdueInstallments: s.status === 'ACTIVE' ? overdue : [],
        paidTotals,
        preview: s.status === 'DRAFT' ? this.previewOf(loan, scale) : null,
      };
    });
  }

  /** Vista previa de unas condiciones sin persistir (`POST schedule-preview`): mismas reglas que el cronograma fijado. */
  previewTerms(input: PreviewInput): Promise<SchedulePreviewView> {
    return this.deps.uow.run(input.workspaceId, () => this.previewTermsInUow(input));
  }

  private async previewTermsInUow(
    input: LoanTermsCommand & {
      readonly workspaceId: string;
      readonly origin?: 'NEW' | 'EXISTING' | undefined;
      readonly existing?: { readonly asOf: string; readonly nextInstallmentNo: number } | undefined;
    },
  ): Promise<SchedulePreviewView> {
    const code = input.principal?.currency;
    if (typeof code !== 'string') {
      throw new DomainError('VALIDATION_FAILED', 'currency is required').at('/principal/currency');
    }
    const scale = await this.scaleOf(code);
    const nil = '00000000-0000-0000-0000-000000000000';
    const origin = input.origin ?? 'NEW';
    const base = {
      id: nil,
      workspaceId: input.workspaceId,
      name: input.name,
      accountId: nil,
      disbursementAccountId: nil,
      paymentAccountId: nil,
      principal: input.principal.amount,
      currency: code,
      currencyScale: scale,
      annualRate: input.annualRate,
      rateType: input.rateType,
      dayCount: input.dayCount,
      frequency: input.frequency,
      termInstallments: input.termInstallments,
      method: input.method,
      disbursementDate: origin === 'EXISTING' ? (input.existing?.asOf as string) : input.disbursementDate,
      firstDueDate: input.firstDueDate,
      charges: input.charges,
      at: this.deps.clock.now().toString(),
      by: nil,
    };
    if (origin === 'EXISTING' && !input.existing) {
      throw new DomainError('VALIDATION_FAILED', 'existing is required for an ongoing loan').at('/existing');
    }
    const loan =
      origin === 'NEW'
        ? Loan.register(base)
        : Loan.registerExisting({
            ...base,
            nextInstallmentNo: (input.existing as { nextInstallmentNo: number }).nextInstallmentNo,
          });
    return this.previewOf(loan, scale);
  }

  async installments(
    workspaceId: string,
    loanId: string,
    version?: number,
  ): Promise<{ readonly version: number | null; readonly installments: readonly InstallmentView[] }> {
    return this.deps.uow.run(workspaceId, async () => {
      const { deps } = this;
      const loan = await this.load(workspaceId, loanId);
      const s = loan.snapshot;
      const scale = await this.scaleOf(s.currency);
      const today = await this.today(workspaceId);
      if (s.currentScheduleVersion === null) {
        if (version !== undefined) throw notFound(`${loanId} schedule version ${version}`);
        const preview = computeSchedule(s, scale);
        const zero = dec('0').toFixed(scale);
        const zeros = { taxes: zero, insurance: zero, fees: zero, interest: zero, principal: zero };
        return {
          version: null,
          installments: preview.installments.map((i) => ({
            ...toScheduleView(i),
            id: `${loanId}:${i.n}`,
            status: 'UNPAID' as const,
            overdue: false,
            expected: {
              taxes: i.taxes,
              insurance: i.insurance,
              fees: i.fees,
              interest: i.interest,
              principal: i.principal,
            },
            paid: zeros,
            differences: zeros,
            pendingTotal: i.total,
          })),
        };
      }
      const v = version ?? s.currentScheduleVersion;
      const stored = await deps.schedules.installments(loan.id, v);
      if (stored.length === 0) throw notFound(`${loanId} schedule version ${v}`);
      const states = installmentStates(stored, await deps.payments.paidByInstallment(loan.id), scale);
      return {
        version: v,
        installments: states.map((x) => {
          const differences = {} as Record<(typeof PAYMENT_COMPONENTS)[number], string>;
          for (const k of PAYMENT_COMPONENTS)
            differences[k] = dec(x.paid[k]).minus(x.expected[k]).toFixed(scale);
          return {
            ...toScheduleView(x.installment),
            id: x.installment.id,
            status: x.status,
            overdue: x.status !== 'PAID' && x.installment.dueDate < today.toString(),
            expected: x.expected,
            paid: x.paid,
            differences,
            pendingTotal: x.pendingTotal,
          };
        }),
      };
    });
  }

  async payments(workspaceId: string, loanId: string): Promise<readonly PaymentView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const loan = await this.load(workspaceId, loanId);
      const currency = loan.snapshot.currency;
      const list = await this.deps.payments.list(loan.id);
      const out: PaymentView[] = [];
      for (const p of list) {
        const allocations = await this.deps.payments.allocationsOf(p.id);
        out.push(
          toPaymentView(
            p,
            currency,
            allocations.map((a) => a.installmentNo).sort((a, b) => a - b),
          ),
        );
      }
      return out;
    });
  }

  async lifecycle(input: { userId: string; workspaceId: string; loanId: string }): Promise<LifecycleDto> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const loan = await this.load(input.workspaceId, input.loanId);
      const query = this.deps.lifecycleQuery;
      if (!query) throw new DomainError('INTERNAL_ERROR', 'lifecycle query is not configured');
      return query.lifecycleOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateType: LOAN_AGGREGATE,
        aggregateId: input.loanId,
        currentState: loan.status,
      });
    });
  }

  // ───────────────────────────────────────────────────────────── contrato público (LoanPortfolioQuery)

  async listLoans(input: {
    readonly workspaceId: string;
    readonly statuses?: readonly LoanStatusDto[];
  }): Promise<readonly LoanPortfolioItemDto[]> {
    const { deps } = this;
    const { workspaceId } = input;
    const run = async (): Promise<readonly LoanPortfolioItemDto[]> => {
      const requested = input.statuses;
      const loans = await deps.loans.list(workspaceId, {
        statuses: requested ?? ['ACTIVE', 'PAID_OFF'],
      });
      if (loans.length === 0) return [];
      const today = await this.today(workspaceId);
      const balances = await deps.balances.presentedBalances(
        workspaceId,
        loans.map((l) => l.snapshot.accountId),
      );
      const out: LoanPortfolioItemDto[] = [];
      for (const loan of loans) {
        const s = loan.snapshot;
        const scale = await this.scaleOf(s.currency);
        const balance = dec(balances.get(s.accountId) ?? '0').toFixed(scale);
        if (!requested && s.status === 'PAID_OFF' && dec(balance).isZero()) continue;
        const states = await this.states(loan, scale);
        const outstanding = states.length > 0 ? outstandingPrincipal(states, scale) : dec('0').toFixed(scale);
        const open = states.filter((x) => x.status !== 'PAID');
        const next = open[0];
        const last = open.length > 0 ? open[open.length - 1] : undefined;
        out.push({
          loanId: loan.id,
          name: s.name,
          accountId: s.accountId,
          currency: s.currency,
          status: s.status,
          method: s.method,
          rateType: s.rateType,
          annualRate: s.annualRate,
          outstandingPrincipal: money(outstanding, s.currency),
          accountBalance: money(balance, s.currency),
          unreconciledDifference: money(dec(outstanding).minus(balance).toFixed(scale), s.currency),
          installmentAmount: next ? money(next.installment.total, s.currency) : null,
          nextInstallment: next
            ? {
                n: next.installment.n,
                dueDate: next.installment.dueDate,
                outstanding: money(next.pendingTotal, s.currency),
                overdueDays: daysBetween(next.installment.dueDate, today),
              }
            : null,
          lastUnpaidInstallmentDueDate: last ? last.installment.dueDate : null,
        });
      }
      return out;
    };
    return deps.uow.run(workspaceId, run);
  }

  async interestPaid(input: { workspaceId: string; from: string; to: string }) {
    return this.deps.uow.run(input.workspaceId, async () => {
      const rows = await this.deps.payments.interestPaid(input.workspaceId, {
        from: input.from,
        to: input.to,
      });
      return rows.map((r) => ({ loanId: r.loanId, amount: money(r.amount, r.currency) }));
    });
  }
}
