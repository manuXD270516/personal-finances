import type { LifecyclePort } from '@pf/audit/contracts';
import { DomainError, LocalDate, dec } from '@pf/shared-kernel';
import { DEBT_EVENTS } from '../contracts/index.js';
import {
  Loan,
  validLoanName,
  validateTerms,
  type LoanEdit,
  type LoanState,
  type ScheduleInstallment,
  type AmortizationSchedule,
} from '../domain/index.js';
import type { AccountInfo, DebtDeps, StoredInstallment } from './ports/index.js';
import { loanChanges, loanEntry, loanSteps, publishLoanEvent } from './recorder.js';
import { computeSchedule, toStored } from './schedule-support.js';
import { toLoanView, type LoanView } from './views.js';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `loan ${id} not found`);
const preconditionFailed = (currentVersion: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    details: { currentVersion },
  });

export interface MoneyInput {
  readonly amount: string;
  readonly currency: string;
}

export interface LoanTermsCommand {
  readonly name: string;
  readonly principal: MoneyInput;
  readonly annualRate: string;
  readonly rateType?: string | undefined;
  readonly dayCount?: string | undefined;
  readonly frequency?: string | undefined;
  readonly termInstallments: number;
  readonly method?: string | undefined;
  readonly disbursementDate: string;
  readonly firstDueDate: string;
  readonly charges?: unknown;
}

export interface RegisterLoanCommand extends LoanTermsCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly origin?: 'NEW' | 'EXISTING' | undefined;
  readonly account:
    | { readonly id: string }
    | { readonly create: { readonly name: string; readonly institutionId?: string | null } };
  readonly disbursementAccountId: string;
  readonly paymentAccountId?: string | undefined;
  readonly lenderCounterpartyId?: string | null | undefined;
  /** Solo `origin = EXISTING`: fecha del saldo y número de la próxima cuota (principal = saldo pendiente). */
  readonly existing?: { readonly asOf: string; readonly nextInstallmentNo: number } | undefined;
  readonly disburseNow?: boolean | undefined;
  readonly retainedFee?: string | undefined;
}

export interface EditLoanCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly loanId: string;
  readonly expectedVersion: number;
  readonly name?: string | undefined;
  readonly lenderCounterpartyId?: string | null | undefined;
  readonly paymentAccountId?: string | undefined;
  readonly terms?: Record<string, unknown> | undefined;
  readonly accountId?: string | undefined;
  readonly disbursementAccountId?: string | undefined;
}

/**
 * Casos de uso de DEBT que crean y transicionan préstamos (openspec add-loans, decisiones 2, 5, 6, 7 y 14): registrar
 * (nuevo o en curso), editar, desembolsar y cancelar. Cada comando corre en UNA unidad de trabajo con su auditoría,
 * recorrido y hechos de outbox (INV-029); las transacciones, la cuenta y el compromiso se escriben por los puertos
 * públicos de sus contextos en esa misma unidad.
 */
export class LoansService {
  constructor(private readonly deps: DebtDeps) {}

  private get lifecycle(): LifecyclePort {
    return this.deps.lifecycle;
  }

  // ───────────────────────────────────────────────────────────── utilidades

  private async clockOf(workspaceId: string) {
    const tz = await this.deps.calendar.timeZoneOf(workspaceId);
    const now = this.deps.clock.now();
    return { at: now.toString(), today: LocalDate.ofInstant(now, tz) };
  }

  private async scaleOf(code: string, pointer = '/principal/currency'): Promise<number> {
    const scale = await this.deps.currencies.scaleOf(code);
    if (scale === null) {
      throw new DomainError('VALIDATION_FAILED', `currency ${code} is not available`).at(pointer);
    }
    return scale;
  }

  private async load(workspaceId: string, id: string): Promise<Loan> {
    const loan = await this.deps.loans.findById(workspaceId, id, { lock: 'update' });
    if (!loan) throw notFound(id);
    return loan;
  }

  private async save(loan: Loan): Promise<void> {
    if (!(await this.deps.loans.save(loan))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the loan was modified concurrently');
    }
    loan.markPersisted();
  }

  private async lenderName(workspaceId: string, state: LoanState): Promise<string | null> {
    if (!state.lenderCounterpartyId) return null;
    const names = await this.deps.counterparties.names(workspaceId, [state.lenderCounterpartyId]);
    return names.get(state.lenderCounterpartyId) ?? null;
  }

  private async view(workspaceId: string, loan: Loan): Promise<LoanView> {
    return toLoanView(loan.snapshot, await this.lenderName(workspaceId, loan.snapshot));
  }

  /**
   * Valida las cuentas del préstamo (decisión 7; specs "Cuenta del préstamo y cuenta destino"): la cuenta del
   * préstamo es `LOAN` activa en la moneda del préstamo y sin otro préstamo; destino y pago activas, distintas de la
   * cuenta del préstamo y en la misma moneda.
   */
  private async validateAccounts(input: {
    readonly workspaceId: string;
    readonly currency: string;
    readonly loanAccountId: string | null;
    readonly disbursementAccountId: string;
    readonly paymentAccountId: string;
    readonly excludeLoanId?: string | undefined;
  }): Promise<void> {
    const { deps } = this;
    const { workspaceId, currency } = input;
    const ids = [
      input.disbursementAccountId,
      input.paymentAccountId,
      ...(input.loanAccountId ? [input.loanAccountId] : []),
    ];
    const found = new Map<string, AccountInfo>(
      (await deps.accounts.find(workspaceId, ids)).map((a) => [a.accountId, a]),
    );
    if (input.loanAccountId !== null) {
      const acct = found.get(input.loanAccountId);
      if (!acct) throw new DomainError('REFERENCE_NOT_FOUND', 'loan account not found').at('/account/id');
      if (acct.type !== 'LOAN' || acct.status !== 'ACTIVE') {
        throw new DomainError('LOAN_ACCOUNT_INVALID', 'the loan account must be an active loan account').at(
          '/account/id',
        );
      }
      if (acct.currency !== currency) {
        throw new DomainError('CURRENCY_MISMATCH', 'the loan account is in another currency').at(
          '/account/id',
        );
      }
      const other = await deps.loans.findActiveByAccount(workspaceId, input.loanAccountId);
      if (other && other.id !== input.excludeLoanId) {
        throw new DomainError('LOAN_ACCOUNT_IN_USE', 'the account already backs another loan').at(
          '/account/id',
        );
      }
    }
    for (const [id, pointer] of [
      [input.disbursementAccountId, '/disbursementAccountId'],
      [input.paymentAccountId, '/paymentAccountId'],
    ] as const) {
      if (id === input.loanAccountId) {
        throw new DomainError('VALIDATION_FAILED', 'must differ from the loan account').at(pointer);
      }
      if (!found.has(id)) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at(pointer);
    }
    await deps.accounts.assertCanPost(
      workspaceId,
      [...new Set([input.disbursementAccountId, input.paymentAccountId])].map((accountId) => ({
        accountId,
        currency,
      })),
    );
  }

  private async persistSchedule(
    workspaceId: string,
    loan: Loan,
    schedule: AmortizationSchedule,
    userId: string,
  ): Promise<readonly StoredInstallment[]> {
    const { deps } = this;
    const s = loan.snapshot;
    const stored = toStored(deps.ids, loan.id, 1, schedule.installments);
    await deps.schedules.insertVersion(
      workspaceId,
      {
        loanId: loan.id,
        scheduleVersion: 1,
        reason: 'INITIAL',
        effectiveFrom: s.existing?.asOf ?? s.disbursementDate,
        parameters: {
          method: s.method,
          annualRate: s.annualRate,
          dayCount: s.dayCount,
          frequency: s.frequency,
          termInstallments: s.termInstallments,
          principal: s.principal,
          firstDueDate: s.firstDueDate,
          charges: s.charges,
          installmentAmount: schedule.installmentAmount,
          leveled: schedule.leveled,
        },
        createdBy: userId,
      },
      stored,
    );
    return stored;
  }

  private createCommitment(
    workspaceId: string,
    userId: string,
    loan: Loan,
    installments: readonly ScheduleInstallment[],
  ) {
    const s = loan.snapshot;
    return this.deps.recurring.createManaged({
      workspaceId,
      userId,
      managedBy: 'DEBT',
      managedRef: loan.id,
      name: s.name,
      kind: 'LOAN_PAYMENT',
      accountId: s.paymentAccountId,
      counterpartyId: s.lenderCounterpartyId,
      currency: s.currency,
      explicitSchedule: installments.map((i) => ({ key: String(i.n), dueDate: i.dueDate, amount: i.total })),
      materialization: 'NOTIFY_ONLY',
    });
  }

  private scheduleGenerated(loan: Loan, installments: readonly ScheduleInstallment[], workspaceId: string) {
    const s = loan.snapshot;
    return {
      workspaceId,
      loanId: loan.id,
      scheduleVersion: 1,
      reason: 'INITIAL' as const,
      effectiveFrom: s.existing?.asOf ?? s.disbursementDate,
      currency: s.currency,
      installments: installments.map((i) => ({
        n: i.n,
        dueDate: i.dueDate,
        principal: i.principal,
        interest: i.interest,
        fees: i.fees,
        insurance: i.insurance,
        taxes: i.taxes,
        total: i.total,
      })),
    };
  }

  // ───────────────────────────────────────────────────────────── registrar

  /**
   * `RegisterLoan` / `RegisterExistingLoan`: alta del préstamo. Nuevo ⇒ borrador sin asientos (con `disburseNow`
   * desembolsa en la misma unidad); en curso ⇒ activo con cronograma v1 sobre el saldo pendiente y su compromiso.
   */
  async register(cmd: RegisterLoanCommand): Promise<LoanView> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const origin = cmd.origin ?? 'NEW';
    if (origin === 'EXISTING' && !cmd.existing) {
      throw new DomainError('VALIDATION_FAILED', 'existing is required for an ongoing loan').at('/existing');
    }
    if (origin === 'EXISTING' && cmd.disburseNow) {
      throw new DomainError('VALIDATION_FAILED', 'an ongoing loan has no disbursement').at('/disburseNow');
    }
    const code = cmd.principal?.currency;
    if (typeof code !== 'string') {
      throw new DomainError('VALIDATION_FAILED', 'currency is required').at('/principal/currency');
    }
    const scale = await this.scaleOf(code);
    const { at } = await this.clockOf(workspaceId);

    return deps.uow.run(workspaceId, async () => {
      const paymentAccountId = cmd.paymentAccountId ?? cmd.disbursementAccountId;
      const asOf = cmd.existing?.asOf;
      const terms = {
        name: cmd.name,
        principal: cmd.principal.amount,
        currency: code,
        currencyScale: scale,
        annualRate: cmd.annualRate,
        rateType: cmd.rateType,
        dayCount: cmd.dayCount,
        frequency: cmd.frequency,
        termInstallments: cmd.termInstallments,
        method: cmd.method,
        disbursementDate: origin === 'EXISTING' ? (asOf as string) : cmd.disbursementDate,
        firstDueDate: cmd.firstDueDate,
        charges: cmd.charges,
        accountId: '',
        disbursementAccountId: cmd.disbursementAccountId,
        paymentAccountId,
        lenderCounterpartyId: cmd.lenderCounterpartyId ?? null,
      };
      // Valida condiciones (rangos, escala, método) antes de tocar cuentas.
      const loanId = deps.ids.next();
      validLoanName(cmd.name);
      validateTerms(terms, origin);
      if (cmd.lenderCounterpartyId) {
        await deps.counterparties.assertUsable(cmd.userId, workspaceId, cmd.lenderCounterpartyId);
      }

      // Cuenta del préstamo: existente (se valida) o creada en el acto (decisión 7).
      let accountId: string;
      if ('id' in cmd.account) {
        accountId = cmd.account.id;
        await this.validateAccounts({
          workspaceId,
          currency: code,
          loanAccountId: accountId,
          disbursementAccountId: cmd.disbursementAccountId,
          paymentAccountId,
        });
        if (origin === 'NEW') {
          const balance = await deps.balances.presentedBalance(workspaceId, accountId);
          if (!dec(balance).isZero()) {
            throw new DomainError(
              'LOAN_ACCOUNT_NOT_EMPTY',
              'a new loan needs a loan account with a zero balance',
            ).at('/account/id');
          }
        } else {
          const balance = await deps.balances.presentedBalance(workspaceId, accountId, asOf);
          if (!dec(balance).eq(dec(cmd.principal.amount))) {
            throw new DomainError(
              'LOAN_BALANCE_MISMATCH',
              'the account balance differs from the declared balance',
              {
                details: { accountBalance: { amount: balance, currency: code }, declared: cmd.principal },
              },
            ).at('/account/id');
          }
        }
      } else {
        await this.validateAccounts({
          workspaceId,
          currency: code,
          loanAccountId: null,
          disbursementAccountId: cmd.disbursementAccountId,
          paymentAccountId,
        });
        const created = await deps.provisioning.openAccount({
          workspaceId,
          userId: cmd.userId,
          type: 'LOAN',
          name: cmd.account.create.name,
          currency: code,
          institutionId: cmd.account.create.institutionId ?? null,
          ...(origin === 'EXISTING'
            ? {
                openingBalance: { amount: cmd.principal.amount, currency: code },
                openingDate: asOf as string,
              }
            : {}),
        });
        accountId = created.accountId;
      }

      const loan =
        origin === 'NEW'
          ? Loan.register({ ...terms, accountId, id: loanId, workspaceId, at, by: cmd.userId })
          : Loan.registerExisting({
              ...terms,
              accountId,
              id: loanId,
              workspaceId,
              nextInstallmentNo: cmd.existing!.nextInstallmentNo,
              at,
              by: cmd.userId,
            });
      const schedule = computeSchedule(loan.snapshot, scale);

      if (origin === 'NEW') {
        await deps.loans.insert(loan);
        loan.markPersisted();
        await this.lifecycle.record(
          loanEntry(loan, 'registered', loanChanges(null, loan.snapshot)),
          loanSteps(loan, []),
        );
        if (cmd.disburseNow) {
          return this.doDisburse(workspaceId, cmd.userId, loan, scale, cmd.retainedFee);
        }
        return this.view(workspaceId, loan);
      }

      // En curso: compromiso de cuotas, cronograma v1 y alta activa en la misma unidad.
      const definition = await this.createCommitment(workspaceId, cmd.userId, loan, schedule.installments);
      const restored = loan;
      restored.attachCommitment(definition.definitionId);
      await deps.loans.insert(restored);
      restored.markPersisted();
      await this.persistSchedule(workspaceId, restored, schedule, cmd.userId);
      const event = await publishLoanEvent(
        deps,
        restored,
        DEBT_EVENTS.loanScheduleGenerated,
        this.scheduleGenerated(restored, schedule.installments, workspaceId),
      );
      await this.lifecycle.record(
        loanEntry(restored, 'registered', loanChanges(null, restored.snapshot)),
        loanSteps(restored, [event]),
      );
      return this.view(workspaceId, restored);
    });
  }

  // ───────────────────────────────────────────────────────────── editar

  async edit(cmd: EditLoanCommand): Promise<LoanView> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { at, today } = await this.clockOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const loan = await this.load(workspaceId, cmd.loanId);
      if (loan.version !== cmd.expectedVersion) throw preconditionFailed(loan.version);
      const before = loan.snapshot;
      const scale = await this.scaleOf(before.currency, '/currency');
      if (cmd.lenderCounterpartyId) {
        await deps.counterparties.assertUsable(cmd.userId, workspaceId, cmd.lenderCounterpartyId);
      }
      const terms: Record<string, unknown> | undefined =
        cmd.terms || cmd.accountId !== undefined || cmd.disbursementAccountId !== undefined
          ? {
              ...(cmd.terms ?? {}),
              ...(cmd.accountId !== undefined ? { accountId: cmd.accountId } : {}),
              ...(cmd.disbursementAccountId !== undefined
                ? { disbursementAccountId: cmd.disbursementAccountId }
                : {}),
            }
          : undefined;
      const change: LoanEdit = {
        name: cmd.name,
        lenderCounterpartyId: cmd.lenderCounterpartyId,
        paymentAccountId: cmd.paymentAccountId,
        terms: terms as LoanEdit['terms'],
      };
      loan.edit(change, scale, at);
      if (loan.version === before.version) return this.view(workspaceId, loan);
      const after = loan.snapshot;
      if (
        cmd.paymentAccountId !== undefined ||
        after.accountId !== before.accountId ||
        after.disbursementAccountId !== before.disbursementAccountId
      ) {
        await this.validateAccounts({
          workspaceId,
          currency: after.currency,
          loanAccountId: after.accountId,
          disbursementAccountId: after.disbursementAccountId,
          paymentAccountId: after.paymentAccountId,
          excludeLoanId: loan.id,
        });
        if (after.accountId !== before.accountId) {
          const balance = await deps.balances.presentedBalance(workspaceId, after.accountId);
          if (!dec(balance).isZero()) {
            throw new DomainError(
              'LOAN_ACCOUNT_NOT_EMPTY',
              'a new loan needs a loan account with a zero balance',
            ).at('/accountId');
          }
        }
      }
      // Cambios de nombre, prestamista o cuenta de pago de un préstamo con compromiso: el compromiso los sigue.
      if (
        after.recurringDefinitionId &&
        (after.name !== before.name ||
          after.lenderCounterpartyId !== before.lenderCounterpartyId ||
          after.paymentAccountId !== before.paymentAccountId)
      ) {
        await deps.recurring.revise({
          workspaceId,
          userId: cmd.userId,
          definitionId: after.recurringDefinitionId,
          ...(after.name !== before.name ? { name: after.name } : {}),
          ...(after.lenderCounterpartyId !== before.lenderCounterpartyId
            ? { counterpartyId: after.lenderCounterpartyId }
            : {}),
          ...(after.paymentAccountId !== before.paymentAccountId
            ? { accountId: after.paymentAccountId }
            : {}),
          effectiveFrom: today.toString(),
        });
      }
      await this.save(loan);
      await this.lifecycle.record(
        loanEntry(loan, 'updated', loanChanges(before, after)),
        loanSteps(loan, []),
      );
      return this.view(workspaceId, loan);
    });
  }

  // ───────────────────────────────────────────────────────────── desembolsar

  async disburse(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly loanId: string;
    readonly retainedFee?: string | undefined;
  }): Promise<LoanView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const loan = await this.load(cmd.workspaceId, cmd.loanId);
      loan.assertDraft();
      const scale = await this.scaleOf(loan.snapshot.currency, '/currency');
      return this.doDisburse(cmd.workspaceId, cmd.userId, loan, scale, cmd.retainedFee);
    });
  }

  /** `DisburseLoan` (decisión 5) dentro de la unidad de trabajo en curso. */
  private async doDisburse(
    workspaceId: string,
    userId: string,
    loan: Loan,
    scale: number,
    retainedFeeInput: string | undefined,
  ): Promise<LoanView> {
    const { deps } = this;
    const { at } = await this.clockOf(workspaceId);
    loan.assertDraft();
    const before = loan.snapshot;
    const retainedFee = this.retainedFee(retainedFeeInput, before.principal, before.currency, scale);
    // Las cuentas pudieron cambiar desde el registro: se revalidan antes de escribir.
    await this.validateAccounts({
      workspaceId,
      currency: before.currency,
      loanAccountId: before.accountId,
      disbursementAccountId: before.disbursementAccountId,
      paymentAccountId: before.paymentAccountId,
      excludeLoanId: loan.id,
    });
    await deps.accounts.assertCanPost(workspaceId, [
      { accountId: before.accountId, currency: before.currency },
    ]);
    const schedule = computeSchedule(before, scale);
    const tx = await deps.transactions.recordDisbursement({
      workspaceId,
      userId,
      loanId: loan.id,
      businessDate: before.disbursementDate,
      loanAccountId: before.accountId,
      destinationAccountId: before.disbursementAccountId,
      principal: { amount: before.principal, currency: before.currency },
      retainedFee,
      counterpartyId: before.lenderCounterpartyId,
      description: `Desembolso: ${before.name}`,
    });
    const definition = await this.createCommitment(workspaceId, userId, loan, schedule.installments);
    loan.disburse(
      { transactionId: tx.transactionId, retainedFee, recurringDefinitionId: definition.definitionId },
      at,
    );
    await this.save(loan);
    await this.persistSchedule(workspaceId, loan, schedule, userId);
    const after = loan.snapshot;
    const disbursed = await publishLoanEvent(deps, loan, DEBT_EVENTS.loanDisbursed, {
      workspaceId,
      loanId: loan.id,
      accountId: after.accountId,
      disbursementAccountId: after.disbursementAccountId,
      transactionId: tx.transactionId,
      principal: { amount: after.principal, currency: after.currency },
      retainedFee: { amount: retainedFee, currency: after.currency },
      disbursedOn: tx.businessDate,
    });
    const generated = await publishLoanEvent(
      deps,
      loan,
      DEBT_EVENTS.loanScheduleGenerated,
      this.scheduleGenerated(loan, schedule.installments, workspaceId),
    );
    await this.snapshotComparisons(workspaceId, loan, scale);
    await this.lifecycle.record(
      loanEntry(loan, 'disbursed', loanChanges(before, after)),
      loanSteps(loan, [disbursed, generated], { detailRefs: { transactionId: tx.transactionId } }),
    );
    return this.view(workspaceId, loan);
  }

  private retainedFee(input: string | undefined, principal: string, currency: string, scale: number): string {
    const raw = input ?? '0';
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
      throw new DomainError('VALIDATION_FAILED', 'must be a decimal string').at('/retainedFee');
    }
    const d = dec(raw);
    if (d.decimalPlaces() > scale) {
      throw new DomainError('AMOUNT_SCALE_EXCEEDED', `${currency} allows ${scale} decimals`).at(
        '/retainedFee',
      );
    }
    if (d.gte(principal)) {
      throw new DomainError('VALIDATION_FAILED', 'the retained fee must be lower than the principal').at(
        '/retainedFee',
      );
    }
    return d.toFixed(scale);
  }

  /** Registra el resultado de la última referencia contra el cronograma v1 recién fijado (exit criterion). */
  private async snapshotComparisons(workspaceId: string, loan: Loan, scale: number): Promise<void> {
    const { comparisonHook } = this;
    if (comparisonHook) await comparisonHook(workspaceId, loan, scale);
  }

  /** Lo fija la composición: el comparador vive en `ReferencesService` (evita un ciclo entre servicios). */
  comparisonHook: ((workspaceId: string, loan: Loan, scale: number) => Promise<void>) | undefined = undefined;

  // ───────────────────────────────────────────────────────────── cancelar

  async cancel(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly loanId: string;
    readonly expectedVersion: number;
    readonly reason: string;
  }): Promise<LoanView> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { at } = await this.clockOf(workspaceId);
    const reason = typeof cmd.reason === 'string' ? cmd.reason.trim() : '';
    if (reason.length < 1 || reason.length > 500) {
      throw new DomainError('VALIDATION_FAILED', 'reason must have between 1 and 500 characters').at(
        '/reason',
      );
    }
    return deps.uow.run(workspaceId, async () => {
      const loan = await this.load(workspaceId, cmd.loanId);
      if (loan.version !== cmd.expectedVersion) throw preconditionFailed(loan.version);
      const before = loan.snapshot;
      if (before.status !== 'DRAFT' && before.status !== 'ACTIVE') {
        throw new DomainError('INVALID_STATUS_TRANSITION', `Loan: cannot cancel from ${before.status}`);
      }
      const active = (await deps.payments.list(loan.id)).filter((p) => p.status === 'ACTIVE');
      if (active.length > 0) {
        throw new DomainError('LOAN_HAS_PAYMENTS', 'the loan has payments and cannot be cancelled', {
          details: { payments: active.length },
        });
      }
      if (before.status === 'ACTIVE') {
        if (before.disbursementTransactionId) {
          await deps.transactions.voidManaged({
            workspaceId,
            userId: cmd.userId,
            transactionId: before.disbursementTransactionId,
            reason,
          });
        }
        if (before.recurringDefinitionId) {
          await deps.recurring.end({
            workspaceId,
            userId: cmd.userId,
            definitionId: before.recurringDefinitionId,
            from: before.existing?.asOf ?? before.disbursementDate,
          });
        }
      }
      loan.cancel(reason, at);
      await this.save(loan);
      await this.lifecycle.record(
        loanEntry(loan, 'cancelled', loanChanges(before, loan.snapshot), reason),
        loanSteps(loan, [], {
          reason,
          ...(before.disbursementTransactionId
            ? { detailRefs: { transactionId: before.disbursementTransactionId } }
            : {}),
        }),
      );
      return this.view(workspaceId, loan);
    });
  }
}
