import type { LifecyclePort } from '@pf/audit/contracts';
import {
  DomainError,
  LocalDate,
  Money,
  dec,
  currency as makeCurrency,
  type Currency,
} from '@pf/shared-kernel';
import { DEBT_EVENTS } from '../contracts/index.js';
import {
  PREPAYMENT_OPTIONS,
  recalculatePrepayment,
  recalculateRateChange,
  restitute,
  summarizeTail,
  validateCustomSchedule,
  type CalculableMethod,
  type CustomRowInput,
  type Loan,
  type LoanState,
  type PrepaymentOption,
  type RateStep,
  type ScheduleInstallment,
  type TailParameters,
  type TailTerms,
} from '../domain/index.js';
import type {
  AllocationRecord,
  DebtDeps,
  PaymentRecord,
  RateChangeRecord,
  ScheduleVersionReason,
  ScheduleVersionRecord,
  StoredInstallment,
} from './ports/index.js';
import type {
  CustomScheduleResultView,
  PrepaymentPreviewView,
  PrepaymentResultView,
  RateChangePreviewView,
  RateChangeResultView,
  RateChangeView,
  RecalculationOptionView,
  TailSummaryView,
} from './amortization-views.js';
import { loanChanges, loanEntry, loanSteps, publishLoanEvent } from './recorder.js';
import {
  installmentStates,
  outstandingPrincipal,
  toCustomRow,
  toStored,
  type InstallmentState,
} from './schedule-support.js';
import {
  money,
  toLoanView,
  toPaymentView,
  toScheduleView,
  type LoanView,
  type PaymentView,
} from './views.js';

const notFound = (what: string, id: string) =>
  new DomainError('RESOURCE_NOT_FOUND', `${what} ${id} not found`);
const preconditionFailed = (currentVersion: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    details: { currentVersion },
  });

export interface MoneyArg {
  readonly amount: string;
  readonly currency: string;
}

export interface PrepaymentCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly loanId: string;
  readonly amount: MoneyArg;
  readonly businessDate: string;
  readonly option: string;
  /** Comisión por prepago ingresada por el usuario (gasto "Comisiones de préstamo"). */
  readonly fee?: MoneyArg | undefined;
  readonly accountId?: string | undefined;
  readonly paymentMethod?: string | null | undefined;
}

export interface RateChangeCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly loanId: string;
  /** Fracción decimal (`0.15` = 15 %). */
  readonly annualRate: string;
  readonly effectiveFrom: string;
}

export interface CustomScheduleCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly loanId: string;
  readonly expectedVersion: number;
  readonly rows: readonly CustomRowInput[];
}

export interface AdoptReferenceCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly loanId: string;
  readonly expectedVersion: number;
  readonly referenceId: string;
}

/** Foto del préstamo y su cronograma efectivo al momento de recalcular. */
interface Snapshot {
  readonly loan: Loan;
  readonly state: LoanState;
  readonly scale: number;
  readonly currency: Currency;
  readonly version: number;
  readonly parameters: TailParameters;
  readonly states: InstallmentState[];
  readonly outstanding: string;
  readonly rateChanges: readonly RateChangeRecord[];
  readonly terms: TailTerms;
}

/** Parámetros del sistema guardados con una versión (solo los textos decimales conocidos). */
export function tailParametersOf(parameters: Record<string, unknown>): TailParameters {
  const pick = (k: string): string | undefined => {
    const v = parameters[k];
    return typeof v === 'string' ? v : undefined;
  };
  return {
    installmentAmount: pick('installmentAmount'),
    principalPerInstallment: pick('principalPerInstallment'),
    fixedPrincipalAmount: pick('fixedPrincipalAmount'),
  };
}

/** Parámetros a guardar: solo los definidos. */
const compact = (p: TailParameters): Record<string, unknown> =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));

/** Historial de tasas ordenado por vigencia: la inicial del préstamo y los cambios registrados. */
export function rateSteps(state: LoanState, changes: readonly RateChangeRecord[]): RateStep[] {
  return [
    { effectiveFrom: state.existing?.asOf ?? state.disbursementDate, annualRate: state.annualRate },
    ...changes.map((c) => ({ effectiveFrom: c.effectiveFrom, annualRate: c.annualRate })),
  ].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}

const summaryView = (rows: readonly ScheduleInstallment[], code: string, scale: number): TailSummaryView => {
  const s = summarizeTail(rows);
  const zero = dec('0').toFixed(scale);
  return {
    installmentAmount: rows.length > 0 ? money(s.installmentAmount, code) : null,
    installmentCount: s.installmentCount,
    endDate: s.endDate,
    remainingInterest: money(rows.length > 0 ? s.remainingInterest : zero, code),
    remainingPrincipal: money(rows.length > 0 ? s.remainingPrincipal : zero, code),
  };
};

const moneyArg = (value: unknown, pointer: string): MoneyArg => {
  const v = value as { amount?: unknown; currency?: unknown } | null | undefined;
  if (!v || typeof v.amount !== 'string' || typeof v.currency !== 'string') {
    throw new DomainError('VALIDATION_FAILED', 'must be {amount, currency}').at(pointer);
  }
  return { amount: v.amount, currency: v.currency };
};

const parseDate = (value: unknown, pointer: string): string => {
  try {
    return LocalDate.parse(value as string).toString();
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'date must be YYYY-MM-DD').at(pointer);
  }
};

/**
 * Casos de uso de amortización avanzada (openspec add-loan-amortization-advanced, decisiones 2–6 y 8): cronograma
 * custom (definido o adoptado de la tabla del banco), pago extraordinario, cambio de tasa variable, anulación del
 * prepago y sus vistas previas. Cada comando corre en UNA unidad de trabajo con `FOR UPDATE` del préstamo, crea la
 * versión nueva del cronograma (nunca reescribe una anterior ni mueve pagos) y reemplaza el calendario del compromiso
 * de cuotas en la misma unidad (INV-013); auditoría, recorrido y outbox incluidos (INV-029).
 */
export class AmortizationService {
  constructor(private readonly deps: DebtDeps) {}

  private get lifecycle(): LifecyclePort {
    return this.deps.lifecycle;
  }

  // ───────────────────────────────────────────────────────────── utilidades

  private async scaleOf(code: string, pointer = '/amount/currency'): Promise<number> {
    const scale = await this.deps.currencies.scaleOf(code);
    if (scale === null) {
      throw new DomainError('VALIDATION_FAILED', `currency ${code} is not available`).at(pointer);
    }
    return scale;
  }

  private async todayOf(workspaceId: string): Promise<{ at: string; today: string }> {
    const tz = await this.deps.calendar.timeZoneOf(workspaceId);
    const now = this.deps.clock.now();
    return { at: now.toString(), today: LocalDate.ofInstant(now, tz).toString() };
  }

  private async lock(workspaceId: string, loanId: string): Promise<Loan> {
    const loan = await this.deps.loans.findById(workspaceId, loanId, { lock: 'update' });
    if (!loan) throw notFound('loan', loanId);
    return loan;
  }

  private async save(loan: Loan): Promise<void> {
    if (!(await this.deps.loans.save(loan))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the loan was modified concurrently');
    }
    loan.markPersisted();
  }

  private async view(workspaceId: string, loan: Loan): Promise<LoanView> {
    const s = loan.snapshot;
    const names = s.lenderCounterpartyId
      ? await this.deps.counterparties.names(workspaceId, [s.lenderCounterpartyId])
      : new Map<string, string>();
    return toLoanView(s, s.lenderCounterpartyId ? (names.get(s.lenderCounterpartyId) ?? null) : null);
  }

  /** Cronograma efectivo, imputaciones y condiciones de un préstamo activo (lecturas secuenciales). */
  private async snapshot(loan: Loan): Promise<Snapshot> {
    const { deps } = this;
    const state = loan.snapshot;
    const scale = await this.scaleOf(state.currency, '/currency');
    const version = state.currentScheduleVersion as number;
    const installments = await deps.schedules.installments(loan.id, version);
    const paidBy = await deps.payments.paidByInstallment(loan.id);
    const states = installmentStates(installments, paidBy, scale);
    const versionRecord = await deps.schedules.versionOf(loan.id, version);
    const rateChanges = await deps.rateChanges.list(loan.id);
    const currency = makeCurrency(state.currency, scale);
    return {
      loan,
      state,
      scale,
      currency,
      version,
      parameters: tailParametersOf(versionRecord?.parameters ?? {}),
      states,
      outstanding: outstandingPrincipal(states, scale),
      rateChanges,
      terms: {
        currency,
        method: (state.method === 'CUSTOM' ? 'FRENCH' : state.method) as CalculableMethod,
        dayCount: state.dayCount,
        frequency: state.frequency,
        charges: state.charges,
        firstInstallmentNo: state.existing?.nextInstallmentNo ?? 1,
        rates: rateSteps(state, rateChanges),
      },
    };
  }

  /**
   * Cuotas por recalcular desde `k0` (la primera no pagada). Precondición común (decisión 3): ninguna cuota parcialmente
   * pagada, ninguna pagada después de `k0` y, con `eventDate`, todas las de vencimiento ≤ esa fecha pagadas, para que
   * el recálculo empiece en una frontera de periodo y no haya imputaciones que repartir (`LOAN_INSTALLMENTS_PENDING`).
   */
  private tailOf(states: readonly InstallmentState[], eventDate: string | null): InstallmentState[] {
    const pending = (nos: readonly number[]) =>
      new DomainError('LOAN_INSTALLMENTS_PENDING', 'installments must be settled before recalculating', {
        details: { installmentNos: nos },
      });
    const partial = states.filter((x) => x.status === 'PARTIALLY_PAID');
    if (partial.length > 0) throw pending(partial.map((x) => x.installment.n));
    const i0 = states.findIndex((x) => x.status !== 'PAID');
    if (i0 < 0) throw new DomainError('LOAN_NOT_ACTIVE', 'the loan has no unpaid installments');
    const tail = states.slice(i0);
    const ahead = tail.filter((x) => x.status === 'PAID');
    if (ahead.length > 0) throw pending(ahead.map((x) => x.installment.n));
    if (eventDate !== null) {
      const overdue = tail.filter((x) => x.installment.dueDate <= eventDate);
      if (overdue.length > 0) throw pending(overdue.map((x) => x.installment.n));
    }
    return tail;
  }

  private rowOf(i: StoredInstallment | ScheduleInstallment): ScheduleInstallment {
    return {
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
    };
  }

  private generatedPayload(
    workspaceId: string,
    loan: Loan,
    version: number,
    reason: ScheduleVersionReason,
    fromInstallmentNo: number,
    effectiveFrom: string,
    rows: readonly ScheduleInstallment[],
  ) {
    return {
      workspaceId,
      loanId: loan.id,
      scheduleVersion: version,
      reason,
      fromInstallmentNo,
      effectiveFrom,
      currency: loan.snapshot.currency,
      installments: rows.map((i) => ({
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

  /** Guarda la versión nueva y sustituye el calendario del compromiso (misma unidad de trabajo). */
  private async persistVersion(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly snap: Snapshot;
    readonly version: number;
    readonly reason: ScheduleVersionReason;
    readonly effectiveFrom: string;
    readonly fromInstallmentNo: number;
    readonly rows: readonly ScheduleInstallment[];
    readonly parameters: Record<string, unknown>;
    readonly sourcePaymentId?: string | null;
    readonly sourceRateChangeId?: string | null;
    readonly sourceReferenceId?: string | null;
  }): Promise<void> {
    const { deps } = this;
    const { snap } = input;
    const record: ScheduleVersionRecord = {
      loanId: snap.loan.id,
      scheduleVersion: input.version,
      reason: input.reason,
      effectiveFrom: input.effectiveFrom,
      fromInstallmentNo: input.fromInstallmentNo,
      sourcePaymentId: input.sourcePaymentId ?? null,
      sourceRateChangeId: input.sourceRateChangeId ?? null,
      sourceReferenceId: input.sourceReferenceId ?? null,
      parameters: input.parameters,
      createdBy: input.userId,
    };
    await deps.schedules.insertVersion(
      input.workspaceId,
      record,
      toStored(deps.ids, snap.loan.id, input.version, input.rows),
    );
    await this.replaceCommitment(input.workspaceId, input.userId, snap.state, input.rows);
  }

  private async replaceCommitment(
    workspaceId: string,
    userId: string,
    state: LoanState,
    rows: readonly ScheduleInstallment[],
  ): Promise<void> {
    const definitionId = state.recurringDefinitionId;
    const items = rows.filter((r) => dec(r.total).gt(0));
    if (!definitionId || items.length === 0) return;
    await this.deps.recurring.replaceSchedule({
      workspaceId,
      userId,
      definitionId,
      effectiveFrom: (items[0] as ScheduleInstallment).dueDate,
      items: items.map((i) => ({ key: String(i.n), dueDate: i.dueDate, amount: i.total })),
    });
  }

  // ───────────────────────────────────────────────────────────── pago extraordinario

  private prepaymentInputs(cmd: {
    readonly amount: unknown;
    readonly businessDate: unknown;
    readonly option: unknown;
    readonly fee?: unknown;
  }) {
    const amount = moneyArg(cmd.amount, '/amount');
    const businessDate = parseDate(cmd.businessDate, '/businessDate');
    const option = cmd.option;
    if (typeof option !== 'string' || !(PREPAYMENT_OPTIONS as readonly string[]).includes(option)) {
      throw new DomainError('VALIDATION_FAILED', 'option must be REDUCE_TERM or REDUCE_INSTALLMENT').at(
        '/option',
      );
    }
    const fee = cmd.fee === undefined || cmd.fee === null ? null : moneyArg(cmd.fee, '/fee');
    return { amount, businessDate, option: option as PrepaymentOption, fee };
  }

  /** Cantidades positivas a la escala de la moneda del préstamo. */
  private amounts(
    snap: Snapshot,
    input: { amount: MoneyArg; fee: MoneyArg | null },
  ): { amount: string; fee: string } {
    const code = snap.state.currency;
    if (input.amount.currency !== code) {
      throw new DomainError('CURRENCY_MISMATCH', 'the prepayment must be in the loan currency').at(
        '/amount/currency',
      );
    }
    const amount = this.parseMoney(input.amount.amount, snap.currency, '/amount/amount', true);
    let fee = Money.zero(snap.currency).toFixed();
    if (input.fee !== null) {
      if (input.fee.currency !== code) {
        throw new DomainError('CURRENCY_MISMATCH', 'the prepayment fee must be in the loan currency').at(
          '/fee/currency',
        );
      }
      fee = this.parseMoney(input.fee.amount, snap.currency, '/fee/amount', false);
    }
    return { amount, fee };
  }

  private parseMoney(value: string, currency: Currency, pointer: string, positive: boolean): string {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
      throw new DomainError('VALIDATION_FAILED', 'must be a decimal string').at(pointer);
    }
    let parsed: Money;
    try {
      parsed = Money.parse(value, currency);
    } catch (err) {
      if (err instanceof DomainError) throw err.at(pointer);
      throw err;
    }
    if (positive && !parsed.isPositive()) {
      throw new DomainError('VALIDATION_FAILED', 'must be greater than zero').at(pointer);
    }
    return parsed.toFixed();
  }

  /** Cálculo común de la vista previa y del comando: las opciones recalculadas sobre el tramo no pagado. */
  private recalcPrepayment(
    snap: Snapshot,
    tail: readonly InstallmentState[],
    amount: string,
    option: PrepaymentOption,
  ) {
    return recalculatePrepayment({
      terms: snap.terms,
      rows: tail.map((x) => this.rowOf(x.installment)),
      balance: snap.outstanding,
      amount,
      option,
      parameters: snap.parameters,
    });
  }

  /** `POST …/prepayments/preview`: ambas opciones, sin persistir (VIEWER+). */
  async previewPrepayment(cmd: {
    readonly workspaceId: string;
    readonly loanId: string;
    readonly amount: unknown;
    readonly businessDate: unknown;
    readonly fee?: unknown;
  }): Promise<PrepaymentPreviewView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const loan = await deps.loans.findById(cmd.workspaceId, cmd.loanId);
      if (!loan) throw notFound('loan', cmd.loanId);
      loan.assertActive();
      loan.assertCalculable();
      const input = this.prepaymentInputs({ ...cmd, option: 'REDUCE_TERM' });
      const snap = await this.snapshot(loan);
      const { amount, fee } = this.amounts(snap, input);
      const tail = this.tailOf(snap.states, input.businessDate);
      const currentRows = tail.map((x) => this.rowOf(x.installment));
      const current = summarizeTail(currentRows);
      const code = snap.state.currency;
      const paysOff = dec(amount).eq(snap.outstanding);
      const options: RecalculationOptionView[] = [];
      if (!paysOff) {
        for (const option of PREPAYMENT_OPTIONS) {
          const r = this.recalcPrepayment(snap, tail, amount, option);
          const s = summarizeTail(r.installments);
          options.push({
            option,
            ...summaryView(r.installments, code, snap.scale),
            interestSaved: money(
              dec(current.remainingInterest).minus(s.remainingInterest).toFixed(snap.scale),
              code,
            ),
            installments: r.installments.map(toScheduleView),
          });
        }
      }
      return {
        loanId: loan.id,
        currency: code,
        outstandingPrincipal: money(snap.outstanding, code),
        amount: money(amount, code),
        fee: money(fee, code),
        paysOff,
        fromInstallmentNo: (tail[0] as InstallmentState).installment.n,
        current: summaryView(currentRows, code, snap.scale),
        options,
      };
    });
  }

  /**
   * `RecordPrepayment`: transacción de pago (principal + comisión como gasto), versión nueva del cronograma desde
   * `k0`, calendario del compromiso reemplazado y, si el pendiente llega a 0, `PAY_OFF` sin versión nueva.
   */
  async recordPrepayment(cmd: PrepaymentCommand): Promise<PrepaymentResultView> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const input = this.prepaymentInputs(cmd);
    const { at } = await this.todayOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const loan = await this.lock(workspaceId, cmd.loanId);
      loan.assertActive();
      loan.assertCalculable();
      const snap = await this.snapshot(loan);
      const before = loan.snapshot;
      const { amount, fee } = this.amounts(snap, input);
      const code = before.currency;
      const accountId = cmd.accountId ?? before.paymentAccountId;
      if (accountId === before.accountId) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'the payment account must differ from the loan account',
        ).at('/accountId');
      }
      await deps.accounts.assertCanPost(workspaceId, [
        { accountId, currency: code },
        { accountId: before.accountId, currency: code },
      ]);
      const tail = this.tailOf(snap.states, input.businessDate);
      if (dec(amount).gt(snap.outstanding)) {
        throw new DomainError('LOAN_OVERPAYMENT', 'the prepayment exceeds the outstanding principal', {
          details: { outstandingPrincipal: snap.outstanding, amount },
        });
      }
      const k0 = (tail[0] as InstallmentState).installment.n;
      const paysOff = dec(amount).eq(snap.outstanding);
      const recalculated = paysOff ? null : this.recalcPrepayment(snap, tail, amount, input.option);

      const paymentId = deps.ids.next();
      const total = dec(amount).plus(fee).toFixed(snap.scale);
      const zero = Money.zero(snap.currency).toFixed();
      const tx = await deps.transactions.recordPayment({
        workspaceId,
        userId: cmd.userId,
        paymentId,
        businessDate: input.businessDate,
        paymentAccountId: accountId,
        loanAccountId: before.accountId,
        amount: { amount: total, currency: code },
        breakdown: {
          loanId: loan.id,
          principal: amount,
          interest: zero,
          fees: fee,
          insurance: zero,
          taxes: zero,
        },
        paymentMethod: cmd.paymentMethod ?? null,
        counterpartyId: before.lenderCounterpartyId,
        description: `Pago extraordinario: ${before.name}`,
      });
      const payment: PaymentRecord = {
        id: paymentId,
        loanId: loan.id,
        paymentNo: await deps.payments.nextPaymentNo(loan.id),
        transactionId: tx.transactionId,
        accountId,
        businessDate: tx.businessDate,
        amount: total,
        principal: amount,
        interest: zero,
        fees: fee,
        insurance: zero,
        taxes: zero,
        explicitBreakdown: false,
        paymentMethod: cmd.paymentMethod ?? null,
        kind: 'PREPAYMENT',
        prepaymentOption: input.option,
        prepaymentFee: fee,
        status: 'ACTIVE',
        voidedAt: null,
        voidedReason: null,
        createdBy: cmd.userId,
        createdAt: at,
      };
      await deps.payments.insert(workspaceId, payment, [] as readonly AllocationRecord[]);

      let newVersion: number | null = null;
      if (recalculated !== null) {
        newVersion = snap.version + 1;
        await this.persistVersion({
          workspaceId,
          userId: cmd.userId,
          snap,
          version: newVersion,
          reason: 'PREPAYMENT',
          effectiveFrom: input.businessDate,
          fromInstallmentNo: k0,
          rows: recalculated.installments,
          parameters: {
            method: before.method,
            option: input.option,
            amount,
            fee,
            outstandingBefore: snap.outstanding,
            leveled: recalculated.leveled,
            ...compact(recalculated.parameters),
          },
          sourcePaymentId: paymentId,
        });
        loan.setScheduleVersion(newVersion, ['payment', 'scheduleVersion'], at);
      } else {
        if (before.recurringDefinitionId) {
          await deps.recurring.end({
            workspaceId,
            userId: cmd.userId,
            definitionId: before.recurringDefinitionId,
            from: input.businessDate,
          });
        }
        loan.payOff(at);
      }
      await this.save(loan);

      const remaining =
        recalculated === null ? zero : dec(snap.outstanding).minus(amount).toFixed(snap.scale);
      const recorded = await publishLoanEvent(deps, loan, DEBT_EVENTS.loanPaymentRecorded, {
        workspaceId,
        loanId: loan.id,
        paymentId,
        transactionId: tx.transactionId,
        kind: 'PREPAYMENT',
        prepaymentOption: input.option,
        installmentNos: [],
        currency: code,
        breakdown: { principal: amount, interest: zero, fees: fee, insurance: zero, taxes: zero, total },
        remainingPrincipal: remaining,
        paidOn: tx.businessDate,
      });
      const events = [recorded];
      if (recalculated !== null && newVersion !== null) {
        events.push(
          await publishLoanEvent(
            deps,
            loan,
            DEBT_EVENTS.loanScheduleGenerated,
            this.generatedPayload(
              workspaceId,
              loan,
              newVersion,
              'PREPAYMENT',
              k0,
              input.businessDate,
              recalculated.installments,
            ),
          ),
        );
      } else {
        events.push(
          await publishLoanEvent(deps, loan, DEBT_EVENTS.loanPaidOff, {
            workspaceId,
            loanId: loan.id,
            paidOffOn: tx.businessDate,
            lastTransactionId: tx.transactionId,
          }),
        );
      }
      const detailRefs = { paymentId, transactionId: tx.transactionId };
      const changes = [
        { field: 'prepaymentAmount', before: null, after: { amount, currency: code } },
        { field: 'prepaymentFee', before: null, after: { amount: fee, currency: code } },
        { field: 'prepaymentOption', before: null, after: input.option },
        { field: 'effectiveFrom', before: null, after: input.businessDate },
        ...(newVersion !== null
          ? [{ field: 'scheduleVersion', before: snap.version, after: newVersion }]
          : []),
        ...(newVersion === null ? loanChanges(before, loan.snapshot) : []),
      ];
      await this.lifecycle.record(
        loanEntry(loan, 'prepayment_recorded', changes),
        newVersion === null
          ? [
              {
                kind: 'ANNOTATION' as const,
                changedFields: ['payment'],
                events: [recorded],
                detailRefs,
              },
              ...loanSteps(loan, events.slice(1), { detailRefs: { transactionId: tx.transactionId } }),
            ]
          : loanSteps(loan, events, { detailRefs }),
      );
      return {
        payment: toPaymentView(payment, code, []),
        loan: await this.view(workspaceId, loan),
        scheduleVersion: newVersion,
        paidOff: newVersion === null,
      };
    });
  }

  // ───────────────────────────────────────────────────────────── anular un prepago

  /**
   * Anula el prepago más reciente (lo invoca `PaymentsService.void`): anula su transacción y fija una versión nueva que
   * vuelve a las cuotas que regían antes del prepago (nunca "reactiva" una versión vieja). Los cambios de tasa
   * registrados después se reaplican sobre el resultado. Un prepago que saldó el préstamo lo reactiva.
   */
  async voidPrepayment(args: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly loan: Loan;
    readonly payment: PaymentRecord;
    readonly reason: string;
    readonly at: string;
  }): Promise<{ payment: PaymentView; loan: LoanView }> {
    const { deps } = this;
    const { workspaceId, userId, loan, payment, reason, at } = args;
    const before = loan.snapshot;
    const scale = await this.scaleOf(before.currency, '/currency');
    const code = before.currency;
    let newVersion: number | null = null;
    let reactivationDefinitionId: string | null = null;
    let rows: readonly ScheduleInstallment[] = [];
    let k0 = 1;

    if (before.status === 'ACTIVE') {
      loan.assertCalculable();
      const snap = await this.snapshot(loan);
      const versions = await deps.schedules.versions(loan.id);
      const own = versions.find((v) => v.sourcePaymentId === payment.id);
      const prior = own ? versions.find((v) => v.scheduleVersion === own.scheduleVersion - 1) : undefined;
      if (!own || !prior) {
        throw new DomainError('INTERNAL_ERROR', 'the prepayment has no schedule version to restore');
      }
      k0 = own.fromInstallmentNo;
      const priorRows = (await deps.schedules.installments(loan.id, prior.scheduleVersion))
        .filter((i) => i.n >= k0)
        .map((i) => this.rowOf(i));
      const restored = dec(snap.outstanding).plus(payment.principal).toFixed(scale);
      const earlier = snap.rateChanges.filter((c) => c.scheduleVersion < own.scheduleVersion);
      const later = snap.rateChanges.filter((c) => c.scheduleVersion > own.scheduleVersion);
      const terms: TailTerms = { ...snap.terms, rates: rateSteps(before, earlier) };
      let result = restitute({
        terms,
        rows: priorRows,
        balance: restored,
        parameters: tailParametersOf(prior.parameters),
      });
      let steps = [...terms.rates];
      for (const change of later) {
        result = recalculateRateChange({
          terms: { ...terms, rates: steps },
          rows: result.installments,
          balance: restored,
          newRate: change.annualRate,
          effectiveFrom: change.effectiveFrom,
        });
        steps = [...steps, { effectiveFrom: change.effectiveFrom, annualRate: change.annualRate }].sort(
          (a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0),
        );
      }
      rows = result.installments;
      newVersion = snap.version + 1;
      await deps.transactions.voidManaged({
        workspaceId,
        userId,
        transactionId: payment.transactionId,
        reason,
      });
      await deps.payments.markVoided(workspaceId, payment.id, { voidedAt: at, voidedBy: userId, reason });
      await this.persistVersion({
        workspaceId,
        userId,
        snap,
        version: newVersion,
        reason: 'PREPAYMENT_VOIDED',
        effectiveFrom: (await this.todayOf(workspaceId)).today,
        fromInstallmentNo: k0,
        rows,
        parameters: {
          method: before.method,
          voidedPaymentId: payment.id,
          restoredFromVersion: prior.scheduleVersion,
          leveled: result.leveled,
          ...compact(result.parameters),
        },
        sourcePaymentId: payment.id,
      });
      loan.setScheduleVersion(newVersion, ['paymentVoided', 'scheduleVersion'], at);
    } else {
      // El prepago saldó el préstamo: se reinstaura el compromiso con las cuotas que siguen sin pagar.
      const installments = await deps.schedules.installments(
        loan.id,
        before.currentScheduleVersion as number,
      );
      const paidBy = await deps.payments.paidByInstallment(loan.id);
      const open = installmentStates(installments, paidBy, scale).filter((s) => s.status !== 'PAID');
      await deps.transactions.voidManaged({
        workspaceId,
        userId,
        transactionId: payment.transactionId,
        reason,
      });
      await deps.payments.markVoided(workspaceId, payment.id, { voidedAt: at, voidedBy: userId, reason });
      if (before.recurringDefinitionId) {
        const created = await deps.recurring.createManaged({
          workspaceId,
          userId,
          managedBy: 'DEBT',
          managedRef: loan.id,
          name: before.name,
          kind: 'LOAN_PAYMENT',
          accountId: before.paymentAccountId,
          counterpartyId: before.lenderCounterpartyId,
          currency: before.currency,
          explicitSchedule: open.map((s) => ({
            key: String(s.installment.n),
            dueDate: s.installment.dueDate,
            amount: s.pendingTotal,
          })),
          materialization: 'NOTIFY_ONLY',
        });
        reactivationDefinitionId = created.definitionId;
      }
      loan.reactivate(at, reactivationDefinitionId);
    }
    await this.save(loan);

    const states = installmentStates(
      await deps.schedules.installments(loan.id, loan.snapshot.currentScheduleVersion as number),
      await deps.payments.paidByInstallment(loan.id),
      scale,
    );
    const remaining = outstandingPrincipal(states, scale);
    const voided = await publishLoanEvent(deps, loan, DEBT_EVENTS.loanPaymentVoided, {
      workspaceId,
      loanId: loan.id,
      paymentId: payment.id,
      transactionId: payment.transactionId,
      installmentNos: [],
      currency: code,
      remainingPrincipal: remaining,
    });
    const events = [voided];
    if (newVersion !== null) {
      events.push(
        await publishLoanEvent(
          deps,
          loan,
          DEBT_EVENTS.loanScheduleGenerated,
          this.generatedPayload(
            workspaceId,
            loan,
            newVersion,
            'PREPAYMENT_VOIDED',
            k0,
            (await this.todayOf(workspaceId)).today,
            rows,
          ),
        ),
      );
    }
    const reactivated = before.status === 'PAID_OFF';
    const detailRefs = { paymentId: payment.id, transactionId: payment.transactionId };
    await this.lifecycle.record(
      loanEntry(
        loan,
        'payment_voided',
        [
          { field: 'prepaymentAmount', before: { amount: payment.principal, currency: code }, after: null },
          ...(newVersion !== null
            ? [{ field: 'scheduleVersion', before: newVersion - 1, after: newVersion }]
            : loanChanges(before, loan.snapshot)),
        ],
        reason,
      ),
      reactivated
        ? [
            { kind: 'ANNOTATION' as const, changedFields: ['paymentVoided'], events: [voided], detailRefs },
            ...loanSteps(loan, [], { reason }),
          ]
        : loanSteps(loan, events, { detailRefs }),
    );
    const voidedPayment: PaymentRecord = { ...payment, status: 'VOIDED', voidedAt: at, voidedReason: reason };
    return { payment: toPaymentView(voidedPayment, code, []), loan: await this.view(workspaceId, loan) };
  }

  // ───────────────────────────────────────────────────────────── cambio de tasa

  private rateInputs(cmd: { readonly annualRate: unknown; readonly effectiveFrom: unknown }) {
    const rate = cmd.annualRate;
    if (typeof rate !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate)) {
      throw new DomainError('VALIDATION_FAILED', 'annualRate must be a decimal string').at('/annualRate');
    }
    const d = dec(rate);
    if (d.gt(1) || d.decimalPlaces() > 18) {
      throw new DomainError('VALIDATION_FAILED', 'annualRate must be between 0 and 1').at('/annualRate');
    }
    return { annualRate: d.toFixed(), effectiveFrom: parseDate(cmd.effectiveFrom, '/effectiveFrom') };
  }

  /** Cálculo común de la vista previa y del comando de cambio de tasa. */
  private async rateChangeOf(
    snap: Snapshot,
    input: { annualRate: string; effectiveFrom: string },
    today: string,
  ) {
    snap.loan.assertCalculable();
    snap.loan.assertVariableRate();
    const tail = this.tailOf(snap.states, today);
    const rows = tail.map((x) => this.rowOf(x.installment));
    const result = recalculateRateChange({
      terms: snap.terms,
      rows,
      balance: snap.outstanding,
      newRate: input.annualRate,
      effectiveFrom: input.effectiveFrom,
    });
    return { tail, rows, result };
  }

  /** `POST …/rate-changes/preview`: el cronograma resultante frente al vigente, sin persistir (VIEWER+). */
  async previewRateChange(cmd: {
    readonly workspaceId: string;
    readonly loanId: string;
    readonly annualRate: unknown;
    readonly effectiveFrom: unknown;
  }): Promise<RateChangePreviewView> {
    const { deps } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const loan = await deps.loans.findById(cmd.workspaceId, cmd.loanId);
      if (!loan) throw notFound('loan', cmd.loanId);
      loan.assertActive();
      const input = this.rateInputs(cmd);
      const { today } = await this.todayOf(cmd.workspaceId);
      const snap = await this.snapshot(loan);
      const { tail, rows, result } = await this.rateChangeOf(snap, input, today);
      const code = snap.state.currency;
      const current = summarizeTail(rows);
      const proposed = summarizeTail(result.installments);
      return {
        loanId: loan.id,
        currency: code,
        annualRate: input.annualRate,
        effectiveFrom: input.effectiveFrom,
        fromInstallmentNo: (tail[0] as InstallmentState).installment.n,
        current: summaryView(rows, code, snap.scale),
        proposed: {
          ...summaryView(result.installments, code, snap.scale),
          interestSaved: money(
            dec(current.remainingInterest).minus(proposed.remainingInterest).toFixed(snap.scale),
            code,
          ),
          installments: result.installments.map(toScheduleView),
        },
      };
    });
  }

  /** `ChangeLoanRate`: tasa nueva con vigencia; recalcula las cuotas futuras como versión nueva y la anota en el historial. */
  async changeRate(
    cmd: RateChangeCommand & { readonly expectedVersion: number },
  ): Promise<RateChangeResultView> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const input = this.rateInputs(cmd);
    const { at, today } = await this.todayOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const loan = await this.lock(workspaceId, cmd.loanId);
      if (loan.version !== cmd.expectedVersion) throw preconditionFailed(loan.version);
      loan.assertActive();
      const snap = await this.snapshot(loan);
      const before = loan.snapshot;
      const { tail, result } = await this.rateChangeOf(snap, input, today);
      const k0 = (tail[0] as InstallmentState).installment.n;
      const previousRate = snap.terms.rates[snap.terms.rates.length - 1]?.annualRate ?? before.annualRate;
      const changeId = deps.ids.next();
      const newVersion = snap.version + 1;
      const record: RateChangeRecord = {
        id: changeId,
        loanId: loan.id,
        annualRate: input.annualRate,
        effectiveFrom: input.effectiveFrom,
        scheduleVersion: newVersion,
        createdBy: cmd.userId,
        createdAt: at,
      };
      await deps.rateChanges.insert(workspaceId, record);
      await this.persistVersion({
        workspaceId,
        userId: cmd.userId,
        snap,
        version: newVersion,
        reason: 'RATE_CHANGE',
        effectiveFrom: input.effectiveFrom,
        fromInstallmentNo: k0,
        rows: result.installments,
        parameters: {
          method: before.method,
          annualRate: input.annualRate,
          previousRate,
          leveled: result.leveled,
          ...compact(result.parameters),
        },
        sourceRateChangeId: changeId,
      });
      loan.setScheduleVersion(newVersion, ['rate', 'scheduleVersion'], at);
      await this.save(loan);
      const changed = await publishLoanEvent(deps, loan, DEBT_EVENTS.loanRateChanged, {
        workspaceId,
        loanId: loan.id,
        rateChangeId: changeId,
        previousRate,
        newRate: input.annualRate,
        effectiveFrom: input.effectiveFrom,
        scheduleVersion: newVersion,
      });
      const generated = await publishLoanEvent(
        deps,
        loan,
        DEBT_EVENTS.loanScheduleGenerated,
        this.generatedPayload(
          workspaceId,
          loan,
          newVersion,
          'RATE_CHANGE',
          k0,
          input.effectiveFrom,
          result.installments,
        ),
      );
      await this.lifecycle.record(
        loanEntry(loan, 'rate_changed', [
          { field: 'previousRate', before: null, after: previousRate },
          { field: 'newRate', before: null, after: input.annualRate },
          { field: 'effectiveFrom', before: null, after: input.effectiveFrom },
          { field: 'scheduleVersion', before: snap.version, after: newVersion },
        ]),
        loanSteps(loan, [changed, generated], { detailRefs: { rateChangeId: changeId } }),
      );
      const rateChange: RateChangeView = {
        id: changeId,
        annualRate: input.annualRate,
        effectiveFrom: input.effectiveFrom,
        scheduleVersion: newVersion,
        initial: false,
        createdAt: at,
      };
      return { rateChange, loan: await this.view(workspaceId, loan), scheduleVersion: newVersion };
    });
  }

  // ───────────────────────────────────────────────────────────── cronograma custom

  /**
   * Fija un cronograma custom: en borrador queda guardado hasta el desembolso (la versión 1); en un préstamo activo crea
   * una versión `CUSTOM_DEFINED`/`CUSTOM_ADOPTED` desde la primera cuota no pagada y el préstamo pasa a `CUSTOM` (el
   * sistema ya no lo recalcula, D196).
   */
  private async applyCustom(args: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly loanId: string;
    readonly expectedVersion: number;
    readonly rows: readonly CustomRowInput[];
    readonly adopt: { readonly referenceId: string; referenceVersion: number } | null;
    /** Adopción: filas de la referencia desde la primera cuota no pagada (se resuelven con el tramo). */
    readonly rowsFrom?: (firstNo: number) => Promise<readonly CustomRowInput[]>;
  }): Promise<CustomScheduleResultView> {
    const { deps } = this;
    const { workspaceId } = args;
    const { at, today } = await this.todayOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const loan = await this.lock(workspaceId, args.loanId);
      if (loan.version !== args.expectedVersion) throw preconditionFailed(loan.version);
      const before = loan.snapshot;
      const scale = await this.scaleOf(before.currency, '/currency');
      const currency = makeCurrency(before.currency, scale);
      const action = args.adopt ? 'custom_schedule_adopted' : 'custom_schedule_defined';

      if (before.status === 'DRAFT') {
        const rows = args.rowsFrom ? await args.rowsFrom(1) : args.rows;
        const start = LocalDate.parse(before.disbursementDate);
        const installments = validateCustomSchedule({
          currency,
          expectedPrincipal: before.principal,
          after: start,
          accrualStart: start,
          firstInstallmentNo: 1,
          rows,
        });
        loan.defineDraftCustomSchedule(installments.map(toCustomRow), at);
        await this.save(loan);
        await this.lifecycle.record(
          loanEntry(loan, action, [
            { field: 'method', before: before.method, after: 'CUSTOM' },
            { field: 'customInstallments', before: null, after: installments.length },
            ...(args.adopt
              ? [{ field: 'referenceVersion', before: null, after: args.adopt.referenceVersion }]
              : []),
          ]),
          loanSteps(loan, [], { changedFields: ['method', 'customSchedule'] }),
        );
        return {
          loan: await this.view(workspaceId, loan),
          scheduleVersion: null,
          installments: installments.map(toScheduleView),
        };
      }

      loan.assertActive();
      const snap = await this.snapshot(loan);
      const tail = this.tailOf(snap.states, null);
      const first = (tail[0] as InstallmentState).installment;
      const rows = args.rowsFrom ? await args.rowsFrom(first.n) : args.rows;
      const installments = validateCustomSchedule({
        currency,
        expectedPrincipal: snap.outstanding,
        after: LocalDate.parse(first.periodStart),
        accrualStart: LocalDate.parse(first.periodStart),
        firstInstallmentNo: first.n,
        rows,
      });
      const newVersion = snap.version + 1;
      await this.persistVersion({
        workspaceId,
        userId: args.userId,
        snap,
        version: newVersion,
        reason: args.adopt ? 'CUSTOM_ADOPTED' : 'CUSTOM_DEFINED',
        effectiveFrom: today,
        fromInstallmentNo: first.n,
        rows: installments,
        parameters: { method: 'CUSTOM', previousMethod: before.method, installments: installments.length },
        sourceReferenceId: args.adopt?.referenceId ?? null,
      });
      loan.setScheduleVersion(newVersion, ['method', 'scheduleVersion'], at, true);
      await this.save(loan);
      const generated = await publishLoanEvent(
        deps,
        loan,
        DEBT_EVENTS.loanScheduleGenerated,
        this.generatedPayload(
          workspaceId,
          loan,
          newVersion,
          args.adopt ? 'CUSTOM_ADOPTED' : 'CUSTOM_DEFINED',
          first.n,
          today,
          installments,
        ),
      );
      await this.lifecycle.record(
        loanEntry(loan, action, [
          { field: 'method', before: before.method, after: 'CUSTOM' },
          { field: 'scheduleVersion', before: snap.version, after: newVersion },
          { field: 'customInstallments', before: null, after: installments.length },
          ...(args.adopt
            ? [{ field: 'referenceVersion', before: null, after: args.adopt.referenceVersion }]
            : []),
        ]),
        loanSteps(loan, [generated]),
      );
      return {
        loan: await this.view(workspaceId, loan),
        scheduleVersion: newVersion,
        installments: installments.map(toScheduleView),
      };
    });
  }

  /** `PUT …/custom-schedule`. */
  defineCustomSchedule(cmd: CustomScheduleCommand): Promise<CustomScheduleResultView> {
    if (!Array.isArray(cmd.rows)) {
      throw new DomainError('VALIDATION_FAILED', 'rows is required').at('/rows');
    }
    return this.applyCustom({ ...cmd, adopt: null });
  }

  /** `POST …/custom-schedule/adopt`: la tabla del banco cargada como referencia pasa a ser el cronograma custom. */
  adoptReference(cmd: AdoptReferenceCommand): Promise<CustomScheduleResultView> {
    const { deps } = this;
    const adopt = { referenceId: cmd.referenceId, referenceVersion: 0 };
    return this.applyCustom({
      workspaceId: cmd.workspaceId,
      userId: cmd.userId,
      loanId: cmd.loanId,
      expectedVersion: cmd.expectedVersion,
      rows: [],
      adopt,
      rowsFrom: async (firstNo) => {
        const reference = await deps.references.find(cmd.loanId, cmd.referenceId);
        if (!reference) throw notFound('reference', cmd.referenceId);
        adopt.referenceVersion = reference.referenceVersion;
        const all = await deps.references.rows(reference.id);
        const rows = all.filter((r) => r.n >= firstNo);
        // La numeración de la referencia debe cubrir las cuotas no pagadas (CUSTOM_SCHEDULE_INVALID si no).
        return rows.map((r): CustomRowInput => ({
          n: r.n,
          dueDate: r.dueDate,
          principal: r.principal,
          interest: r.interest,
          fees: r.fees,
          insurance: r.insurance,
          taxes: r.taxes,
          total: r.total,
        }));
      },
    });
  }
}
