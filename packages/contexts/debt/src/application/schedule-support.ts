import { LocalDate, currency as makeCurrency, dec, Money } from '@pf/shared-kernel';
import {
  AmortizationCalculator,
  PAYMENT_COMPONENTS,
  installmentStatus,
  type AmortizationInput,
  type AmortizationSchedule,
  type ComponentAmounts,
  type InstallmentPaymentStatus,
  type LoanState,
  type ScheduleInstallment,
} from '../domain/index.js';
import type { StoredInstallment } from './ports/index.js';

/** Entrada del calculador a partir de las condiciones del préstamo (nuevo o en curso, decisiones 3 y 6). */
export function scheduleInputOf(state: LoanState, scale: number): AmortizationInput {
  const existing = state.existing;
  return {
    currency: makeCurrency(state.currency, scale),
    principal: state.principal,
    annualRate: state.annualRate,
    dayCount: state.dayCount,
    frequency: state.frequency,
    installments: state.termInstallments,
    accrualStart: LocalDate.parse(state.disbursementDate),
    firstDueDate: LocalDate.parse(state.firstDueDate),
    firstInstallmentNo: existing?.nextInstallmentNo ?? 1,
    charges: state.charges,
  };
}

export function computeSchedule(state: LoanState, scale: number): AmortizationSchedule {
  return AmortizationCalculator.calculateSchedule(scheduleInputOf(state, scale));
}

export const toStored = (
  ids: { next(): string },
  loanId: string,
  scheduleVersion: number,
  installments: readonly ScheduleInstallment[],
): StoredInstallment[] => installments.map((i) => ({ ...i, id: ids.next(), loanId, scheduleVersion }));

export const expectedOf = (i: ScheduleInstallment): ComponentAmounts => ({
  taxes: i.taxes,
  insurance: i.insurance,
  fees: i.fees,
  interest: i.interest,
  principal: i.principal,
});

export const zeroComponents = (scale: number): ComponentAmounts => {
  const zero = Money.zero(makeCurrency('XXX', scale)).toFixed();
  return { taxes: zero, insurance: zero, fees: zero, interest: zero, principal: zero };
};

export const sumComponents = (c: ComponentAmounts): string =>
  PAYMENT_COMPONENTS.reduce((acc, k) => acc.plus(dec(c[k])), dec('0')).toFixed();

export interface InstallmentState {
  readonly installment: StoredInstallment;
  readonly expected: ComponentAmounts;
  readonly paid: ComponentAmounts;
  readonly status: InstallmentPaymentStatus;
  /** Pendiente por componente (nunca negativo). */
  readonly pending: ComponentAmounts;
  /** Pendiente total de la cuota (0 si está pagada por principal). */
  readonly pendingTotal: string;
}

const pendingComponents = (expected: ComponentAmounts, paid: ComponentAmounts): ComponentAmounts => {
  const out = {} as Record<(typeof PAYMENT_COMPONENTS)[number], string>;
  for (const k of PAYMENT_COMPONENTS) {
    const d = dec(expected[k]).minus(paid[k]);
    out[k] = (d.isNegative() ? dec('0') : d).toFixed();
  }
  return out;
};

export function installmentStates(
  installments: readonly StoredInstallment[],
  paidBy: ReadonlyMap<string, ComponentAmounts>,
  scale: number,
): InstallmentState[] {
  const zero = zeroComponents(scale);
  return installments.map((installment) => {
    const expected = expectedOf(installment);
    const paid = paidBy.get(installment.id) ?? zero;
    const status = installmentStatus(expected, paid);
    const pending = status === 'PAID' ? zero : pendingComponents(expected, paid);
    return { installment, expected, paid, status, pending, pendingTotal: sumComponents(pending) };
  });
}

/** Principal pendiente del préstamo = Σ principal esperado − Σ principal imputado (sin bajar de cero). */
export function outstandingPrincipal(states: readonly InstallmentState[], scale: number): string {
  let expected = dec('0');
  let paid = dec('0');
  for (const s of states) {
    expected = expected.plus(s.expected.principal);
    paid = paid.plus(s.paid.principal);
  }
  const d = expected.minus(paid);
  return Money.parse((d.isNegative() ? dec('0') : d).toFixed(), makeCurrency('XXX', scale)).toFixed();
}
