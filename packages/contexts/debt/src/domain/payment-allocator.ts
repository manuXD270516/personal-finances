import { DomainError, Money, dec, type Currency } from '@pf/shared-kernel';
import {
  PAYMENT_COMPONENTS,
  type ComponentAmounts,
  type InstallmentPaymentStatus,
  type PaymentComponent,
} from './loan-types.js';

/**
 * `PaymentAllocator` (openspec add-loans, design decisión 8; D155). Puro: reparte un pago entre las cuotas de la
 * versión vigente del cronograma y sus componentes.
 *
 * - Sin desglose: recorre las cuotas con pendiente en orden de `n` y, dentro de cada una, impuestos → seguro →
 *   comisiones → interés → principal hasta agotar el monto. Más que el pendiente total ⇒ `LOAN_OVERPAYMENT`.
 *   Con `installmentNo` (y sin desglose) solo imputa dentro de esa cuota.
 * - Con desglose (`installmentNo` obligatorio): Σ componentes = monto (`PAYMENT_BREAKDOWN_MISMATCH`), principal ≤
 *   principal pendiente del préstamo (`LOAN_OVERPAYMENT`); lo que exceda lo esperado queda como diferencia positiva.
 * - La cuota queda `PAID` cuando Σ principal imputado ≥ principal esperado; `UNPAID` si nada se imputó.
 *
 * Diferencia por componente = imputado − esperado (negativa = falta pagar; positiva = excedente).
 */

/** Cuota de la versión vigente con lo esperado y lo ya imputado (imputaciones vigentes) por componente. */
export interface AllocatableInstallment {
  readonly n: number;
  readonly expected: ComponentAmounts;
  readonly paid: ComponentAmounts;
}

export interface AllocatePaymentInput {
  readonly currency: Currency;
  readonly amount: string;
  readonly installments: readonly AllocatableInstallment[];
  readonly installmentNo?: number;
  readonly breakdown?: Partial<Record<PaymentComponent, string>>;
  /** Principal pendiente del préstamo (principal − Σ principal imputado vigente). */
  readonly outstandingPrincipal: string;
}

export interface PaymentAllocation {
  readonly installmentNo: number;
  readonly component: PaymentComponent;
  readonly amount: string;
}

export interface AllocatedInstallment {
  readonly n: number;
  /** Estado resultante tras el pago. */
  readonly status: InstallmentPaymentStatus;
  readonly expected: ComponentAmounts;
  /** Imputado en total tras el pago (previo + este pago). */
  readonly paid: ComponentAmounts;
  /** Imputado solo por este pago. */
  readonly allocated: ComponentAmounts;
  /** Imputado − esperado por componente (con signo). */
  readonly differences: ComponentAmounts;
  readonly differenceTotal: string;
}

export interface PaymentAllocationResult {
  /** Porciones por cuota y componente (los componentes en cero no generan porción). */
  readonly allocations: readonly PaymentAllocation[];
  /** Componentes totales del pago. */
  readonly components: ComponentAmounts;
  /** Números de las cuotas afectadas, en orden. */
  readonly affectedInstallments: readonly number[];
  /** Estado resultante de cada cuota afectada. */
  readonly installments: readonly AllocatedInstallment[];
  /** Principal pendiente del préstamo tras el pago. */
  readonly principalAfter: string;
}

const validation = (message: string, details?: Record<string, unknown>) =>
  new DomainError('VALIDATION_FAILED', message, details ? { details } : {});

const zeroComponents = (zero: Money): Record<PaymentComponent, Money> => ({
  taxes: zero,
  insurance: zero,
  fees: zero,
  interest: zero,
  principal: zero,
});

const parseComponents = (c: ComponentAmounts, currency: Currency): Record<PaymentComponent, Money> => {
  const out = zeroComponents(Money.zero(currency));
  for (const k of PAYMENT_COMPONENTS) out[k] = Money.parse(c[k], currency);
  return out;
};

const toStrings = (c: Record<PaymentComponent, Money>): ComponentAmounts => ({
  taxes: c.taxes.toFixed(),
  insurance: c.insurance.toFixed(),
  fees: c.fees.toFixed(),
  interest: c.interest.toFixed(),
  principal: c.principal.toFixed(),
});

const pendingOf = (expected: Money, paid: Money): Money => {
  const diff = expected.subtract(paid);
  return diff.isPositive() ? diff : Money.zero(expected.currency);
};

/**
 * Estado de pago de una cuota según lo imputado: `PAID` si Σ principal imputado ≥ principal esperado; `UNPAID` si no
 * se imputó nada; `PARTIALLY_PAID` en otro caso. Reutilizable por las consultas del detalle del préstamo.
 */
export function installmentStatus(
  expected: ComponentAmounts,
  paid: ComponentAmounts,
): InstallmentPaymentStatus {
  const expectedPrincipal = dec(expected.principal);
  const settled = expectedPrincipal.gt(0)
    ? dec(paid.principal).gte(expectedPrincipal)
    : PAYMENT_COMPONENTS.every((k) => dec(paid[k]).gte(expected[k]));
  if (settled) return 'PAID';
  return PAYMENT_COMPONENTS.some((k) => dec(paid[k]).gt(0)) ? 'PARTIALLY_PAID' : 'UNPAID';
}

export function allocatePayment(input: AllocatePaymentInput): PaymentAllocationResult {
  const { currency } = input;
  const zero = Money.zero(currency);
  const amount = Money.parse(input.amount, currency);
  if (!amount.isPositive()) throw validation('the payment amount must be positive', { field: 'amount' });
  const outstanding = Money.parse(input.outstandingPrincipal, currency);
  const installments = [...input.installments].sort((a, b) => a.n - b.n);

  const state = installments.map((i) => ({
    n: i.n,
    expected: parseComponents(i.expected, currency),
    paid: parseComponents(i.paid, currency),
  }));
  const allocated = new Map<number, Record<PaymentComponent, Money>>();
  const allocations: PaymentAllocation[] = [];
  const grant = (n: number, component: PaymentComponent, value: Money) => {
    if (!value.isPositive()) return;
    const row = allocated.get(n) ?? zeroComponents(zero);
    row[component] = row[component].add(value);
    allocated.set(n, row);
    allocations.push({ installmentNo: n, component, amount: value.toFixed() });
  };

  if (input.breakdown !== undefined) {
    if (input.installmentNo === undefined) {
      throw validation('an explicit breakdown requires installmentNo', { field: 'installmentNo' });
    }
    const target = state.find((s) => s.n === input.installmentNo);
    if (!target)
      throw validation(`installment ${input.installmentNo} does not exist`, { field: 'installmentNo' });
    const parts = zeroComponents(zero);
    for (const k of PAYMENT_COMPONENTS) {
      const raw = input.breakdown[k];
      if (raw === undefined) continue;
      const value = Money.parse(raw, currency);
      if (value.isNegative())
        throw validation(`breakdown.${k} must not be negative`, { field: `breakdown.${k}` });
      parts[k] = value;
    }
    const total = Money.sum(Object.values(parts), currency);
    if (!total.equals(amount)) {
      throw new DomainError(
        'PAYMENT_BREAKDOWN_MISMATCH',
        'the breakdown does not add up to the payment amount',
        {
          details: { sum: total.toFixed(), amount: amount.toFixed() },
        },
      );
    }
    if (parts.principal.compare(outstanding) > 0) {
      throw new DomainError('LOAN_OVERPAYMENT', 'the principal exceeds what is still owed', {
        details: { principal: parts.principal.toFixed(), outstandingPrincipal: outstanding.toFixed() },
      });
    }
    for (const k of PAYMENT_COMPONENTS) grant(target.n, k, parts[k]);
  } else {
    const candidates = state.filter((s) => {
      if (input.installmentNo !== undefined && s.n !== input.installmentNo) return false;
      return installmentStatus(toStrings(s.expected), toStrings(s.paid)) !== 'PAID';
    });
    if (input.installmentNo !== undefined && !state.some((s) => s.n === input.installmentNo)) {
      throw validation(`installment ${input.installmentNo} does not exist`, { field: 'installmentNo' });
    }
    const pendingTotal = Money.sum(
      candidates.flatMap((s) => PAYMENT_COMPONENTS.map((k) => pendingOf(s.expected[k], s.paid[k]))),
      currency,
    );
    if (amount.compare(pendingTotal) > 0) {
      throw new DomainError('LOAN_OVERPAYMENT', 'the payment exceeds what is still owed on the loan', {
        details: { amount: amount.toFixed(), pending: pendingTotal.toFixed() },
      });
    }
    let remaining = amount;
    for (const s of candidates) {
      for (const k of PAYMENT_COMPONENTS) {
        if (!remaining.isPositive()) break;
        const pending = pendingOf(s.expected[k], s.paid[k]);
        const take = pending.compare(remaining) <= 0 ? pending : remaining;
        grant(s.n, k, take);
        remaining = remaining.subtract(take);
      }
      if (!remaining.isPositive()) break;
    }
    const principalGranted = Money.sum(
      allocations.filter((a) => a.component === 'principal').map((a) => Money.parse(a.amount, currency)),
      currency,
    );
    if (principalGranted.compare(outstanding) > 0) {
      throw new DomainError('LOAN_OVERPAYMENT', 'the principal exceeds what is still owed', {
        details: { principal: principalGranted.toFixed(), outstandingPrincipal: outstanding.toFixed() },
      });
    }
  }

  const components = zeroComponents(zero);
  for (const a of allocations) {
    components[a.component] = components[a.component].add(Money.parse(a.amount, currency));
  }
  const results: AllocatedInstallment[] = [];
  for (const s of state) {
    const mine = allocated.get(s.n);
    if (!mine) continue;
    const paid = zeroComponents(zero);
    const differences = zeroComponents(zero);
    for (const k of PAYMENT_COMPONENTS) {
      paid[k] = s.paid[k].add(mine[k]);
      differences[k] = paid[k].subtract(s.expected[k]);
    }
    const diffStrings = toStrings(differences);
    results.push({
      n: s.n,
      status: installmentStatus(toStrings(s.expected), toStrings(paid)),
      expected: toStrings(s.expected),
      paid: toStrings(paid),
      allocated: toStrings(mine),
      differences: diffStrings,
      differenceTotal: Money.sum(Object.values(differences), currency).toFixed(),
    });
  }
  return {
    allocations,
    components: toStrings(components),
    affectedInstallments: results.map((r) => r.n),
    installments: results,
    principalAfter: outstanding.subtract(components.principal).toFixed(),
  };
}

export const PaymentAllocator = { allocate: allocatePayment } as const;
