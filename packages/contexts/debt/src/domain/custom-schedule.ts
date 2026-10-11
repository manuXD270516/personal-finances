import { DomainError, LocalDate, Money, type Currency } from '@pf/shared-kernel';
import { fmt } from './amortization-math.js';
import { MAX_LOAN_INSTALLMENTS, type ScheduleInstallment } from './loan-types.js';

/**
 * `CustomScheduleValidator` (openspec add-loan-amortization-advanced, decisión 2; capability `debt/amortization`):
 * valida un cronograma cargado cuota por cuota o adoptado de la tabla del banco y lo convierte en cuotas del
 * sistema. Puro. Σ principal exacto (INV-017), vencimientos estrictamente crecientes y posteriores al piso,
 * componentes ≥ 0 a la escala de la moneda y total = Σ componentes; el error `CUSTOM_SCHEDULE_INVALID` informa la
 * cuota (`details.rows[]`) y la suma de principal (`details.principalSum`).
 */

export interface CustomRowInput {
  /** Número de la cuota; si se indica debe ser el correlativo esperado. */
  readonly n?: number | undefined;
  readonly dueDate: string;
  readonly principal: string;
  readonly interest?: string | undefined;
  readonly fees?: string | undefined;
  readonly insurance?: string | undefined;
  readonly taxes?: string | undefined;
  /** Si se indica debe ser la suma de los componentes. */
  readonly total?: string | undefined;
}

export interface CustomScheduleInput {
  readonly currency: Currency;
  /** Principal del préstamo (borrador) o principal pendiente (activo, desde la primera cuota no pagada). */
  readonly expectedPrincipal: string;
  /** Los vencimientos deben ser posteriores a esta fecha (desembolso, saldo o última cuota pagada). */
  readonly after: LocalDate;
  /** Inicio del periodo de la primera cuota. */
  readonly accrualStart: LocalDate;
  readonly firstInstallmentNo: number;
  readonly rows: readonly CustomRowInput[];
}

export interface CustomRowProblem {
  /** Número de la cuota (o posición esperada). */
  readonly n: number;
  readonly field: string;
  readonly reason: string;
}

const COMPONENTS = ['principal', 'interest', 'fees', 'insurance', 'taxes'] as const;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const invalid = (
  message: string,
  rows: readonly CustomRowProblem[],
  principalSum?: { expected: string; actual: string },
) =>
  new DomainError('CUSTOM_SCHEDULE_INVALID', message, {
    details: { rows, ...(principalSum ? { principalSum } : {}) },
  });

export function validateCustomSchedule(input: CustomScheduleInput): ScheduleInstallment[] {
  const { currency, rows } = input;
  const scale = currency.scale;
  if (rows.length < 1 || rows.length > MAX_LOAN_INSTALLMENTS) {
    throw invalid(`a custom schedule needs between 1 and ${MAX_LOAN_INSTALLMENTS} installments`, [
      { n: input.firstInstallmentNo, field: 'rows', reason: 'COUNT_OUT_OF_RANGE' },
    ]);
  }
  const problems: CustomRowProblem[] = [];
  const expected = Money.parse(input.expectedPrincipal, currency).toMinorUnits();

  const parsed: {
    n: number;
    due: LocalDate | null;
    values: Record<(typeof COMPONENTS)[number], bigint | null>;
    total: bigint | null;
  }[] = [];
  const units = (value: string | undefined, n: number, field: string): bigint | null => {
    const raw = value ?? '0';
    if (typeof raw !== 'string') {
      problems.push({ n, field, reason: 'NOT_A_DECIMAL' });
      return null;
    }
    if (raw.startsWith('-')) {
      problems.push({ n, field, reason: 'NEGATIVE' });
      return null;
    }
    if (!DECIMAL.test(raw)) {
      problems.push({ n, field, reason: 'NOT_A_DECIMAL' });
      return null;
    }
    try {
      return Money.parse(raw, currency).toMinorUnits();
    } catch {
      problems.push({ n, field, reason: 'SCALE_EXCEEDED' });
      return null;
    }
  };

  rows.forEach((row, index) => {
    const n = input.firstInstallmentNo + index;
    if (row.n !== undefined && row.n !== n) {
      problems.push({ n, field: 'n', reason: 'NUMBERING_GAP' });
    }
    let due: LocalDate | null = null;
    try {
      due = LocalDate.parse(row.dueDate);
    } catch {
      problems.push({ n, field: 'dueDate', reason: 'NOT_A_DATE' });
    }
    const values = {
      principal: units(row.principal, n, 'principal'),
      interest: units(row.interest, n, 'interest'),
      fees: units(row.fees, n, 'fees'),
      insurance: units(row.insurance, n, 'insurance'),
      taxes: units(row.taxes, n, 'taxes'),
    };
    const total = row.total === undefined ? null : units(row.total, n, 'total');
    if (total !== null && COMPONENTS.every((k) => values[k] !== null)) {
      const components = COMPONENTS.reduce((acc, k) => acc + (values[k] as bigint), 0n);
      if (components !== total) problems.push({ n, field: 'total', reason: 'TOTAL_MISMATCH' });
    }
    parsed.push({ n, due, values, total });
  });

  // Vencimientos estrictamente crecientes y posteriores al piso.
  let previous: LocalDate = input.after;
  for (const row of parsed) {
    if (row.due === null) continue;
    if (row.due.compare(previous) <= 0) {
      problems.push({
        n: row.n,
        field: 'dueDate',
        reason: previous === input.after ? 'NOT_AFTER_START' : 'NOT_INCREASING',
      });
    }
    previous = row.due;
  }

  // Σ principal exacto.
  let actual = 0n;
  let comparable = true;
  for (const row of parsed) {
    if (row.values.principal === null) comparable = false;
    else actual += row.values.principal;
  }
  if (problems.length > 0 || (comparable && actual !== expected)) {
    const principalSum =
      comparable && actual !== expected
        ? { expected: fmt(expected, scale), actual: fmt(actual, scale) }
        : undefined;
    if (principalSum)
      problems.push({ n: input.firstInstallmentNo, field: 'principal', reason: 'SUM_MISMATCH' });
    throw invalid(
      principalSum
        ? `the principal of the installments adds up to ${principalSum.actual}, not ${principalSum.expected}`
        : 'the custom schedule is invalid',
      problems,
      principalSum,
    );
  }

  const out: ScheduleInstallment[] = [];
  let balance = expected;
  let start = input.accrualStart;
  for (const row of parsed) {
    const due = row.due as LocalDate;
    const v = row.values as Record<(typeof COMPONENTS)[number], bigint>;
    const closing = balance - v.principal;
    out.push({
      n: row.n,
      dueDate: due.toString(),
      periodStart: start.toString(),
      periodEnd: due.toString(),
      principal: fmt(v.principal, scale),
      interest: fmt(v.interest, scale),
      fees: fmt(v.fees, scale),
      insurance: fmt(v.insurance, scale),
      taxes: fmt(v.taxes, scale),
      total: fmt(v.principal + v.interest + v.fees + v.insurance + v.taxes, scale),
      openingBalance: fmt(balance, scale),
      closingBalance: fmt(closing, scale),
    });
    balance = closing;
    start = due;
  }
  return out;
}
