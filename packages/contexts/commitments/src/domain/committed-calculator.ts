import { Money, type Currency } from '@pf/shared-kernel';
import type { RecurringKind } from './types.js';

/** Clase de una cuenta para el criterio del comprometido (D35: solo `ASSET` + `LIQUID` es dinero disponible). */
export interface AccountClass {
  readonly nature: 'ASSET' | 'LIABILITY';
  readonly liquidity: 'LIQUID' | 'SEMI_LIQUID' | 'ILLIQUID';
}

export const isLiquidAccount = (a: AccountClass): boolean => a.nature === 'ASSET' && a.liquidity === 'LIQUID';

/**
 * ¿Reduce el dinero disponible? (D127) Un egreso siempre; una transferencia solo si sale de una cuenta líquida hacia
 * una que no lo es (pago de tarjeta, aporte a ahorro, pago de pasivo). Entre dos cuentas líquidas no cuenta.
 */
export function countsAsCommittedOutflow(input: {
  readonly kind: RecurringKind | 'OTHER';
  readonly from: AccountClass | undefined;
  readonly to?: AccountClass | undefined;
}): boolean {
  // La cuota de préstamo es un egreso comprometido (openspec add-loans, N8).
  if (input.kind === 'EXPENSE' || input.kind === 'LOAN_PAYMENT') return true;
  if (input.kind === 'TRANSFER') {
    return (
      input.from !== undefined &&
      input.to !== undefined &&
      isLiquidAccount(input.from) &&
      !isLiquidAccount(input.to)
    );
  }
  return false;
}

export interface CommittedLine {
  readonly id: string;
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly currency: string;
  /** Monto a sumar (máximo en `MIN_MAX`); `null` ⇒ `VARIABLE` (se cuenta aparte, D115). */
  readonly amount: string | null;
}

export interface CurrencyTotal {
  readonly currency: string;
  readonly occurrences: string;
  readonly pending: string;
  readonly total: string;
}

export interface CommittedResult {
  readonly byCurrency: readonly CurrencyTotal[];
  readonly expectedIncome: readonly { readonly currency: string; readonly amount: string }[];
  readonly withoutAmount: readonly CommittedLine[];
}

/**
 * Total comprometido del periodo (FR-COMMITMENTS-011; design decisión 16): Σ por moneda de las ocurrencias de egreso
 * sin resolver más las transacciones pendientes de egreso, sin doble conteo (una ocurrencia materializada como
 * pendiente ya no está sin resolver). Aritmética exacta (Decimal 40); el redondeo HALF_EVEN solo al presentar. Las
 * `VARIABLE` no suman: se informan aparte. Los ingresos esperados se informan sin restar.
 */
export function computeCommitted(input: {
  readonly lines: readonly CommittedLine[];
  readonly income: readonly CommittedLine[];
  readonly currencyOf: (code: string) => Currency;
}): CommittedResult {
  const sum = (lines: readonly CommittedLine[], currency: Currency): Money =>
    lines.reduce(
      (acc, l) => (l.amount === null ? acc : acc.add(Money.parse(l.amount, currency))),
      Money.zero(currency),
    );
  const codes = [...new Set(input.lines.map((l) => l.currency))].sort();
  const byCurrency = codes.map((code) => {
    const currency = input.currencyOf(code);
    const mine = input.lines.filter((l) => l.currency === code);
    const occurrences = sum(
      mine.filter((l) => l.source === 'OCCURRENCE'),
      currency,
    );
    const pending = sum(
      mine.filter((l) => l.source === 'PENDING'),
      currency,
    );
    return {
      currency: code,
      occurrences: occurrences.toFixed(),
      pending: pending.toFixed(),
      total: occurrences.add(pending).toFixed(),
    };
  });
  const incomeCodes = [...new Set(input.income.map((l) => l.currency))].sort();
  const expectedIncome = incomeCodes.map((code) => ({
    currency: code,
    amount: sum(
      input.income.filter((l) => l.currency === code),
      input.currencyOf(code),
    ).toFixed(),
  }));
  return {
    byCurrency,
    expectedIncome,
    withoutAmount: input.lines.filter((l) => l.amount === null),
  };
}
