import { DomainError, LocalDate, currency as makeCurrency, type Currency } from '@pf/shared-kernel';
import {
  MAX_SIMULATED_LOANS,
  PAYOFF_STRATEGIES,
  simulateExtras,
  simulateStrategies,
  type CalculableMethod,
  type ExtraSpec,
  type Loan,
  type PayoffLoan,
  type PayoffStrategy,
  type ExtrasSimulation,
  type StrategiesSimulation,
  type ScheduleInstallment,
} from '../domain/index.js';
import { rateSteps, tailParametersOf } from './amortization.service.js';
import type { RateChangeView, ScheduleVersionView } from './amortization-views.js';
import type { DebtDeps } from './ports/index.js';
import { installmentStates, outstandingPrincipal } from './schedule-support.js';

const notFound = (what: string, id: string) =>
  new DomainError('RESOURCE_NOT_FOUND', `${what} ${id} not found`);

export type PayoffSimulationRequest =
  | {
      /** Un préstamo con pagos extra únicos o recurrentes. */
      readonly loanId: string;
      readonly extras: readonly ExtraSpec[];
    }
  | {
      /** Estrategias entre los préstamos activos de la moneda del extra. */
      readonly monthlyExtra: { readonly amount: string; readonly currency: string };
      readonly strategies?: readonly string[];
    };

export type PayoffSimulationResult =
  | ({ readonly type: 'LOAN_EXTRAS' } & ExtrasSimulation)
  | ({ readonly type: 'STRATEGIES' } & StrategiesSimulation);

/**
 * Consultas de amortización avanzada (sin efectos; VIEWER+): historial de versiones del cronograma, historial de
 * tasas y el payoff simulator, que NO persiste nada (ni transacciones, ni versiones, ni compromisos, ni auditoría).
 */
export class AmortizationQueries {
  constructor(private readonly deps: DebtDeps) {}

  private async load(workspaceId: string, loanId: string): Promise<Loan> {
    const loan = await this.deps.loans.findById(workspaceId, loanId);
    if (!loan) throw notFound('loan', loanId);
    return loan;
  }

  /** `GET …/schedule-versions`: motivo, vigencia, desde la cuota y parámetros de cada versión; la vigente al final. */
  async versions(workspaceId: string, loanId: string): Promise<readonly ScheduleVersionView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const loan = await this.load(workspaceId, loanId);
      const current = loan.snapshot.currentScheduleVersion;
      const list = await this.deps.schedules.versions(loan.id);
      return list.map((v, i): ScheduleVersionView => {
        const next = list[i + 1];
        return {
          scheduleVersion: v.scheduleVersion,
          reason: v.reason,
          effectiveFrom: v.effectiveFrom,
          fromInstallmentNo: v.fromInstallmentNo,
          replacedFromInstallmentNo: next ? next.fromInstallmentNo : null,
          current: v.scheduleVersion === current,
          installmentCount: v.installmentCount,
          sourcePaymentId: v.sourcePaymentId ?? null,
          sourceRateChangeId: v.sourceRateChangeId ?? null,
          sourceReferenceId: v.sourceReferenceId ?? null,
          parameters: v.parameters,
          createdBy: v.createdBy,
          createdAt: v.createdAt,
        };
      });
    });
  }

  /** `GET …/rate-changes`: la tasa inicial del préstamo y los cambios con su vigencia, por vigencia. */
  async rateChanges(workspaceId: string, loanId: string): Promise<readonly RateChangeView[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const loan = await this.load(workspaceId, loanId);
      const s = loan.snapshot;
      const changes = await this.deps.rateChanges.list(loan.id);
      return [
        {
          id: null,
          annualRate: s.annualRate,
          effectiveFrom: s.existing?.asOf ?? s.disbursementDate,
          scheduleVersion: 1,
          initial: true,
          createdAt: null,
        },
        ...changes.map((c): RateChangeView => ({
          id: c.id,
          annualRate: c.annualRate,
          effectiveFrom: c.effectiveFrom,
          scheduleVersion: c.scheduleVersion,
          initial: false,
          createdAt: c.createdAt,
        })),
      ];
    });
  }

  // ───────────────────────────────────────────────────────────── simulador

  /** Proyección de un préstamo activo: cuotas no pagadas vigentes, principal pendiente, tasa vigente hoy y parámetros. */
  private async projectionOf(loan: Loan, currency: Currency, today: string): Promise<PayoffLoan | null> {
    const { deps } = this;
    const s = loan.snapshot;
    const version = s.currentScheduleVersion as number;
    const installments = await deps.schedules.installments(loan.id, version);
    const paidBy = await deps.payments.paidByInstallment(loan.id);
    const states = installmentStates(installments, paidBy, currency.scale);
    const unpaid = states.filter((x) => x.status !== 'PAID');
    if (unpaid.length === 0) return null;
    const versionRecord = await deps.schedules.versionOf(loan.id, version);
    const changes = await deps.rateChanges.list(loan.id);
    const rates = rateSteps(s, changes);
    const effective = [...rates].reverse().find((r) => r.effectiveFrom <= today) ?? rates[0];
    return {
      id: loan.id,
      name: s.name,
      terms: {
        currency,
        method: (s.method === 'CUSTOM' ? 'FRENCH' : s.method) as CalculableMethod,
        dayCount: s.dayCount,
        frequency: s.frequency,
        charges: s.charges,
        firstInstallmentNo: s.existing?.nextInstallmentNo ?? 1,
        rates,
      },
      custom: s.method === 'CUSTOM',
      annualRate: effective?.annualRate ?? s.annualRate,
      // El tramo parcialmente pagado conserva su pendiente: se proyecta desde el principal pendiente del cronograma.
      balance: outstandingPrincipal(states, currency.scale),
      rows: unpaid.map((x): ScheduleInstallment =>
        // La cuota parcialmente pagada se proyecta con lo que falta de cada componente.
        x.status === 'PARTIALLY_PAID'
          ? {
              ...x.installment,
              principal: x.pending.principal,
              interest: x.pending.interest,
              fees: x.pending.fees,
              insurance: x.pending.insurance,
              taxes: x.pending.taxes,
              total: x.pendingTotal,
            }
          : { ...x.installment },
      ),
      parameters: tailParametersOf(versionRecord?.parameters ?? {}),
    };
  }

  /** `POST payoff-simulations`: sin efectos; un préstamo con extras o las estrategias entre los préstamos activos. */
  async simulate(workspaceId: string, request: PayoffSimulationRequest): Promise<PayoffSimulationResult> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const tz = await deps.calendar.timeZoneOf(workspaceId);
      const today = LocalDate.ofInstant(deps.clock.now(), tz).toString();
      if ('loanId' in request) {
        const loan = await this.load(workspaceId, request.loanId);
        if (loan.status !== 'ACTIVE')
          throw new DomainError('LOAN_NOT_ACTIVE', 'only an active loan can be simulated');
        const scale = await this.scaleOf(loan.snapshot.currency);
        const projection = await this.projectionOf(loan, makeCurrency(loan.snapshot.currency, scale), today);
        if (projection === null)
          throw new DomainError('LOAN_NOT_ACTIVE', 'the loan has no unpaid installments');
        if (!Array.isArray(request.extras) || request.extras.length === 0) {
          throw new DomainError('VALIDATION_FAILED', 'at least one extra is required').at('/extras');
        }
        return { type: 'LOAN_EXTRAS', ...simulateExtras(projection, request.extras) };
      }
      const extra = request.monthlyExtra;
      if (!extra || typeof extra.amount !== 'string' || typeof extra.currency !== 'string') {
        throw new DomainError('VALIDATION_FAILED', 'monthlyExtra must be {amount, currency}').at(
          '/monthlyExtra',
        );
      }
      const strategies = request.strategies?.map((x) => {
        if (!(PAYOFF_STRATEGIES as readonly string[]).includes(x)) {
          throw new DomainError('VALIDATION_FAILED', 'unknown strategy').at('/strategies');
        }
        return x as PayoffStrategy;
      });
      const scale = await this.scaleOf(extra.currency, '/monthlyExtra/currency');
      const active = await deps.loans.list(workspaceId, { statuses: ['ACTIVE'] });
      if (active.length > MAX_SIMULATED_LOANS) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `a simulation takes at most ${MAX_SIMULATED_LOANS} active loans`,
        ).at('/monthlyExtra');
      }
      const loans: PayoffLoan[] = [];
      for (const loan of active) {
        const loanScale = await this.scaleOf(loan.snapshot.currency);
        const projection = await this.projectionOf(
          loan,
          makeCurrency(loan.snapshot.currency, loanScale),
          today,
        );
        if (projection !== null) loans.push(projection);
      }
      const result = simulateStrategies({
        currency: makeCurrency(extra.currency, scale),
        monthlyExtra: extra.amount,
        loans,
        ...(strategies ? { strategies } : {}),
      });
      return { type: 'STRATEGIES', ...result };
    });
  }

  private async scaleOf(code: string, pointer = '/currency'): Promise<number> {
    const scale = await this.deps.currencies.scaleOf(code);
    if (scale === null) {
      throw new DomainError('VALIDATION_FAILED', `currency ${code} is not available`).at(pointer);
    }
    return scale;
  }
}
