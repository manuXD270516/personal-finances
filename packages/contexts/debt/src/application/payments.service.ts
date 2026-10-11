import type { LifecyclePort } from '@pf/audit/contracts';
import { DomainError, LocalDate, dec } from '@pf/shared-kernel';
import { currency as makeCurrency } from '@pf/shared-kernel';
import { DEBT_EVENTS } from '../contracts/index.js';
import {
  PAYMENT_COMPONENTS,
  allocatePayment,
  type ComponentAmounts,
  type Loan,
  type PaymentComponent,
} from '../domain/index.js';
import type { AllocationRecord, DebtDeps, PaymentRecord, StoredInstallment } from './ports/index.js';
import { loanChanges, loanEntry, loanSteps, publishLoanEvent } from './recorder.js';
import { installmentStates, outstandingPrincipal, sumComponents } from './schedule-support.js';
import { toLoanView, toPaymentView, type LoanView, type PaymentView } from './views.js';

const notFound = (what: string, id: string) =>
  new DomainError('RESOURCE_NOT_FOUND', `${what} ${id} not found`);

export interface RecordPaymentCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly loanId: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly businessDate: string;
  /** Cuenta de pago; por omisión la cuenta de pago habitual del préstamo. */
  readonly accountId?: string | undefined;
  readonly paymentMethod?: string | null | undefined;
  readonly installmentNo?: number | undefined;
  readonly breakdown?: Partial<Record<PaymentComponent, string>> | undefined;
}

export interface PaymentResult {
  readonly payment: PaymentView;
  readonly loan: LoanView;
}

const COMPONENT_KEYS: readonly PaymentComponent[] = PAYMENT_COMPONENTS;

/**
 * Casos de uso de DEBT sobre los pagos (openspec add-loans, decisión 8): registrar un pago con imputación automática
 * o desglose indicado, y anular el último. Una sola unidad de trabajo por comando: transacción del pago
 * (`LoanTransactionsPort`), imputaciones, resolución de las ocurrencias de cuotas, transición del préstamo,
 * auditoría, recorrido y hechos de outbox. Dos pagos concurrentes se serializan con `FOR UPDATE` del préstamo.
 */
export class PaymentsService {
  constructor(private readonly deps: DebtDeps) {}

  private get lifecycle(): LifecyclePort {
    return this.deps.lifecycle;
  }

  private async scaleOf(code: string): Promise<number> {
    const scale = await this.deps.currencies.scaleOf(code);
    if (scale === null) throw new DomainError('VALIDATION_FAILED', `currency ${code} is not available`);
    return scale;
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

  private describe(name: string, nos: readonly number[]): string {
    if (nos.length === 0) return `Pago: ${name}`;
    const label = nos.length === 1 ? `cuota ${nos[0]}` : `cuotas ${nos[0]}-${nos[nos.length - 1]}`;
    return `Pago: ${name} — ${label}`;
  }

  // ───────────────────────────────────────────────────────────── registrar

  async record(cmd: RecordPaymentCommand): Promise<PaymentResult> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const code = cmd.amount?.currency;
    if (typeof code !== 'string') {
      throw new DomainError('VALIDATION_FAILED', 'currency is required').at('/amount/currency');
    }
    const scale = await this.scaleOf(code);
    const at = deps.clock.now().toString();
    try {
      LocalDate.parse(cmd.businessDate);
    } catch {
      throw new DomainError('VALIDATION_FAILED', 'date must be YYYY-MM-DD').at('/businessDate');
    }

    return deps.uow.run(workspaceId, async () => {
      const loan = await deps.loans.findById(workspaceId, cmd.loanId, { lock: 'update' });
      if (!loan) throw notFound('loan', cmd.loanId);
      loan.assertActive();
      const before = loan.snapshot;
      if (before.currency !== code) {
        throw new DomainError('CURRENCY_MISMATCH', 'the payment must be in the loan currency').at(
          '/amount/currency',
        );
      }
      const accountId = cmd.accountId ?? before.paymentAccountId;
      if (accountId === before.accountId) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'the payment account must differ from the loan account',
        ).at('/accountId');
      }
      // Moneda de la cuenta de pago distinta de la del préstamo ⇒ CURRENCY_MISMATCH (D157; sin conversión implícita).
      await deps.accounts.assertCanPost(workspaceId, [
        { accountId, currency: code },
        { accountId: before.accountId, currency: code },
      ]);

      const version = before.currentScheduleVersion as number;
      const installments = await deps.schedules.installments(loan.id, version);
      const paidBy = await deps.payments.paidByInstallment(loan.id);
      const states = installmentStates(installments, paidBy, scale);
      const result = allocatePayment({
        currency: makeCurrency(code, scale),
        amount: cmd.amount.amount,
        installments: states.map((s) => ({ n: s.installment.n, expected: s.expected, paid: s.paid })),
        ...(cmd.installmentNo !== undefined ? { installmentNo: cmd.installmentNo } : {}),
        ...(cmd.breakdown ? { breakdown: cmd.breakdown } : {}),
        outstandingPrincipal: outstandingPrincipal(states, scale),
      });
      const components = result.components;
      const paymentId = deps.ids.next();
      const nos = [...result.affectedInstallments];
      const tx = await deps.transactions.recordPayment({
        workspaceId,
        userId: cmd.userId,
        paymentId,
        businessDate: cmd.businessDate,
        paymentAccountId: accountId,
        loanAccountId: before.accountId,
        amount: { amount: cmd.amount.amount, currency: code },
        breakdown: { loanId: loan.id, ...components },
        paymentMethod: cmd.paymentMethod ?? null,
        counterpartyId: before.lenderCounterpartyId,
        description: this.describe(before.name, nos),
      });

      const byNo = new Map(installments.map((i) => [i.n, i]));
      const payment: PaymentRecord = {
        id: paymentId,
        loanId: loan.id,
        paymentNo: await deps.payments.nextPaymentNo(loan.id),
        transactionId: tx.transactionId,
        accountId,
        businessDate: tx.businessDate,
        amount: cmd.amount.amount,
        principal: components.principal,
        interest: components.interest,
        fees: components.fees,
        insurance: components.insurance,
        taxes: components.taxes,
        explicitBreakdown: cmd.breakdown !== undefined,
        paymentMethod: cmd.paymentMethod ?? null,
        status: 'ACTIVE',
        voidedAt: null,
        voidedReason: null,
        createdBy: cmd.userId,
        createdAt: at,
      };
      const allocations: AllocationRecord[] = result.installments.map((i) => {
        const inst = byNo.get(i.n) as StoredInstallment;
        return {
          paymentId,
          installmentId: inst.id,
          installmentNo: i.n,
          principal: i.allocated.principal,
          interest: i.allocated.interest,
          fees: i.allocated.fees,
          insurance: i.allocated.insurance,
          taxes: i.allocated.taxes,
        };
      });
      await deps.payments.insert(workspaceId, payment, allocations);

      // Compromisos: la cuota pagada resuelve su ocurrencia (varias con una transacción); la parcial espera el pendiente.
      const definitionId = before.recurringDefinitionId;
      if (definitionId) {
        const settled = result.installments.filter((i) => i.status === 'PAID').map((i) => String(i.n));
        if (settled.length > 0) {
          await deps.recurring.settle({
            workspaceId,
            userId: cmd.userId,
            definitionId,
            keys: settled,
            transactionId: tx.transactionId,
          });
        }
        for (const i of result.installments) {
          if (i.status === 'PAID') continue;
          const pending = dec(sumComponents(i.expected)).minus(sumComponents(i.paid));
          await deps.recurring.setExpected({
            workspaceId,
            userId: cmd.userId,
            definitionId,
            key: String(i.n),
            amount: (pending.isNegative() ? dec('0') : pending).toFixed(scale),
          });
        }
      }

      const paidOff = dec(result.principalAfter).isZero();
      if (paidOff) {
        loan.payOff(at);
        if (definitionId) {
          await deps.recurring.end({
            workspaceId,
            userId: cmd.userId,
            definitionId,
            from: cmd.businessDate,
          });
        }
      } else {
        loan.touch(['payment'], at);
      }
      await this.save(loan);

      const recorded = await publishLoanEvent(deps, loan, DEBT_EVENTS.loanPaymentRecorded, {
        workspaceId,
        loanId: loan.id,
        paymentId,
        transactionId: tx.transactionId,
        installmentNos: nos,
        currency: code,
        breakdown: { ...breakdownOf(components), total: cmd.amount.amount },
        remainingPrincipal: result.principalAfter,
        paidOn: tx.businessDate,
      });
      const events = [recorded];
      if (paidOff) {
        events.push(
          await publishLoanEvent(deps, loan, DEBT_EVENTS.loanPaidOff, {
            workspaceId,
            loanId: loan.id,
            paidOffOn: tx.businessDate,
            lastTransactionId: tx.transactionId,
          }),
        );
      }
      const steps = loanSteps(loan, events, {
        changedFields: ['payment'],
        detailRefs: { paymentId, transactionId: tx.transactionId },
      });
      await this.lifecycle.record(
        loanEntry(loan, 'payment_recorded', [
          { field: 'amount', before: null, after: { amount: cmd.amount.amount, currency: code } },
          ...COMPONENT_KEYS.map((k) => ({
            field: k,
            before: null,
            after: { amount: components[k], currency: code },
          })),
          { field: 'transactionId', before: null, after: tx.transactionId },
          { field: 'installmentNos', before: null, after: JSON.stringify(nos) },
          ...(paidOff ? loanChanges(before, loan.snapshot) : []),
        ]),
        paidOff
          ? [
              {
                kind: 'ANNOTATION' as const,
                changedFields: ['payment'],
                events: [recorded],
                detailRefs: { paymentId, transactionId: tx.transactionId },
              },
              ...steps.map((s) =>
                s.kind === 'TRANSITION' ? { ...s, detailRefs: { transactionId: tx.transactionId } } : s,
              ),
            ]
          : steps,
      );
      return { payment: toPaymentView(payment, code, nos), loan: await this.view(workspaceId, loan) };
    });
  }

  // ───────────────────────────────────────────────────────────── anular

  async void(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly loanId: string;
    readonly paymentId: string;
    readonly expectedVersion: number;
    readonly reason: string;
  }): Promise<PaymentResult> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const reason = typeof cmd.reason === 'string' ? cmd.reason.trim() : '';
    if (reason.length < 1 || reason.length > 500) {
      throw new DomainError('VALIDATION_FAILED', 'reason must have between 1 and 500 characters').at(
        '/reason',
      );
    }
    const at = deps.clock.now().toString();
    return deps.uow.run(workspaceId, async () => {
      const loan = await deps.loans.findById(workspaceId, cmd.loanId, { lock: 'update' });
      if (!loan) throw notFound('loan', cmd.loanId);
      if (loan.version !== cmd.expectedVersion) {
        throw new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
          details: { currentVersion: loan.version },
        });
      }
      const before = loan.snapshot;
      if (before.status !== 'ACTIVE' && before.status !== 'PAID_OFF') {
        throw new DomainError('LOAN_NOT_ACTIVE', `the loan is ${before.status}`);
      }
      const payment = await deps.payments.find(loan.id, cmd.paymentId);
      if (!payment) throw notFound('payment', cmd.paymentId);
      const latest = await deps.payments.latestActive(loan.id);
      if (payment.status !== 'ACTIVE' || latest?.id !== payment.id) {
        throw new DomainError(
          'LOAN_PAYMENT_NOT_LATEST',
          'only the most recent active payment can be voided',
          {
            details: { latestPaymentId: latest?.id ?? null },
          },
        );
      }
      const scale = await this.scaleOf(before.currency);
      const version = before.currentScheduleVersion as number;
      const installments = await deps.schedules.installments(loan.id, version);
      const paidNow = await deps.payments.paidByInstallment(loan.id);
      const allocations = await deps.payments.allocationsOf(payment.id);
      const statesBefore = installmentStates(installments, paidNow, scale);
      const paidAfter = new Map(paidNow);
      for (const a of allocations) {
        const cur = paidAfter.get(a.installmentId);
        if (!cur) continue;
        const next = {} as Record<PaymentComponent, string>;
        for (const k of COMPONENT_KEYS) next[k] = dec(cur[k]).minus(a[k]).toFixed(scale);
        paidAfter.set(a.installmentId, next as ComponentAmounts);
      }
      const statesAfter = installmentStates(installments, paidAfter, scale);

      await deps.transactions.voidManaged({
        workspaceId,
        userId: cmd.userId,
        transactionId: payment.transactionId,
        reason,
      });
      await deps.payments.markVoided(workspaceId, payment.id, { voidedAt: at, voidedBy: cmd.userId, reason });

      const nos = allocations.map((a) => a.installmentNo).sort((a, b) => a - b);
      const affected = new Set(allocations.map((a) => a.installmentId));
      let reactivationDefinitionId: string | null = null;
      if (before.recurringDefinitionId) {
        if (before.status === 'PAID_OFF') {
          // El compromiso terminó al saldarse: se reinstaura uno nuevo con lo que sigue sin pagar.
          const open = statesAfter.filter((s) => s.status !== 'PAID');
          const created = await deps.recurring.createManaged({
            workspaceId,
            userId: cmd.userId,
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
        } else {
          const restore: { key: string; amount: string }[] = [];
          const reopened: string[] = [];
          for (let idx = 0; idx < statesAfter.length; idx += 1) {
            const prev = statesBefore[idx]!;
            const next = statesAfter[idx]!;
            if (!affected.has(next.installment.id)) continue;
            const key = String(next.installment.n);
            if (prev.status === 'PAID' && next.status !== 'PAID') {
              reopened.push(key);
              restore.push({ key, amount: next.pendingTotal });
            } else if (next.status !== 'PAID') {
              await deps.recurring.setExpected({
                workspaceId,
                userId: cmd.userId,
                definitionId: before.recurringDefinitionId,
                key,
                amount: next.pendingTotal,
              });
            }
          }
          if (reopened.length > 0) {
            await deps.recurring.unsettle({
              workspaceId,
              userId: cmd.userId,
              definitionId: before.recurringDefinitionId,
              keys: reopened,
              restoreExpected: restore,
            });
          }
        }
      }

      if (before.status === 'PAID_OFF') loan.reactivate(at, reactivationDefinitionId);
      else loan.touch(['paymentVoided'], at);
      await this.save(loan);

      const remaining = outstandingPrincipal(statesAfter, scale);
      const voided = await publishLoanEvent(deps, loan, DEBT_EVENTS.loanPaymentVoided, {
        workspaceId,
        loanId: loan.id,
        paymentId: payment.id,
        transactionId: payment.transactionId,
        installmentNos: nos,
        currency: before.currency,
        remainingPrincipal: remaining,
      });
      const reactivated = before.status === 'PAID_OFF';
      await this.lifecycle.record(
        loanEntry(
          loan,
          'payment_voided',
          [
            { field: 'transactionId', before: null, after: payment.transactionId },
            { field: 'installmentNos', before: null, after: JSON.stringify(nos) },
            { field: 'amount', before: null, after: { amount: payment.amount, currency: before.currency } },
            ...(reactivated ? loanChanges(before, loan.snapshot) : []),
          ],
          reason,
        ),
        [
          {
            kind: 'ANNOTATION' as const,
            changedFields: ['paymentVoided'],
            events: [voided],
            detailRefs: { paymentId: payment.id, transactionId: payment.transactionId },
          },
          ...(reactivated ? loanSteps(loan, [], { reason }) : []),
        ],
      );
      const voidedPayment: PaymentRecord = {
        ...payment,
        status: 'VOIDED',
        voidedAt: at,
        voidedReason: reason,
      };
      return {
        payment: toPaymentView(voidedPayment, before.currency, nos),
        loan: await this.view(workspaceId, loan),
      };
    });
  }
}

const breakdownOf = (c: ComponentAmounts) => ({
  principal: c.principal,
  interest: c.interest,
  fees: c.fees,
  insurance: c.insurance,
  taxes: c.taxes,
});
