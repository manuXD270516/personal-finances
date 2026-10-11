import { DomainError, LocalDate, currency as makeCurrency, dec, Money } from '@pf/shared-kernel';
import {
  AmortizationCalculator,
  PAYMENT_COMPONENTS,
  validateCustomSchedule,
  installmentStatus,
  type AmortizationInput,
  type AmortizationSchedule,
  type ComponentAmounts,
  type CustomRowInput,
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
    method: state.method === 'CUSTOM' ? 'FRENCH' : state.method,
    ...(state.fixedPrincipalAmount !== null ? { fixedPrincipalAmount: state.fixedPrincipalAmount } : {}),
  };
}

/** Piso de los vencimientos del cronograma inicial: el desembolso o la fecha del saldo pendiente. */
const startOf = (state: LoanState): string => state.existing?.asOf ?? state.disbursementDate;

/**
 * Cronograma inicial del préstamo: calculado (francés, alemán, capital fijo) o, en `CUSTOM`, el cargado por el usuario
 * (`CUSTOM_SCHEDULE_INVALID` si aún no se definió).
 */
export function computeSchedule(state: LoanState, scale: number): AmortizationSchedule {
  if (state.method !== 'CUSTOM')
    return AmortizationCalculator.calculateSchedule(scheduleInputOf(state, scale));
  if (state.customSchedule === null || state.customSchedule.length === 0) {
    throw new DomainError('CUSTOM_SCHEDULE_INVALID', 'the custom schedule has not been defined', {
      details: {
        rows: [{ n: state.existing?.nextInstallmentNo ?? 1, field: 'rows', reason: 'NOT_DEFINED' }],
      },
    });
  }
  const installments = validateCustomSchedule({
    currency: makeCurrency(state.currency, scale),
    expectedPrincipal: state.principal,
    after: LocalDate.parse(startOf(state)),
    accrualStart: LocalDate.parse(startOf(state)),
    firstInstallmentNo: state.existing?.nextInstallmentNo ?? 1,
    rows: state.customSchedule,
  });
  const first = installments[0] as ScheduleInstallment;
  return {
    installments,
    installmentAmount: dec(first.principal).plus(first.interest).toFixed(scale),
    leveled: false,
  };
}

/** Parámetros de una versión del cronograma: los del sistema (para "misma cuota / mismo principal") y el contexto. */
export function scheduleParameters(
  state: LoanState,
  schedule: AmortizationSchedule,
): Record<string, unknown> {
  const first = schedule.installments[0] as ScheduleInstallment;
  return {
    method: state.method,
    annualRate: state.annualRate,
    dayCount: state.dayCount,
    frequency: state.frequency,
    termInstallments: state.termInstallments,
    principal: state.principal,
    firstDueDate: state.firstDueDate,
    charges: state.charges,
    installmentAmount: schedule.installmentAmount,
    leveled: schedule.leveled,
    ...(state.method === 'GERMAN' ? { principalPerInstallment: first.principal } : {}),
    ...(state.method === 'FIXED_PRINCIPAL' && state.fixedPrincipalAmount !== null
      ? { fixedPrincipalAmount: state.fixedPrincipalAmount }
      : {}),
  };
}

/** Cuota calculada → fila custom normalizada (lo que se guarda en el borrador y se vuelve a validar). */
export const toCustomRow = (i: ScheduleInstallment): CustomRowInput => ({
  n: i.n,
  dueDate: i.dueDate,
  principal: i.principal,
  interest: i.interest,
  fees: i.fees,
  insurance: i.insurance,
  taxes: i.taxes,
  total: i.total,
});

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
