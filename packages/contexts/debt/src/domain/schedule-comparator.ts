import { DomainError, dec, type Currency, type Decimal } from '@pf/shared-kernel';
import {
  calculateSchedule,
  type AmortizationInput,
  type AmortizationSchedule,
} from './amortization-calculator.js';
import {
  DAY_COUNTS,
  type ComparisonStatus,
  type DayCount,
  type ReferenceScheduleRow,
  type ScheduleInstallment,
} from './loan-types.js';

/**
 * `ScheduleComparator` (openspec add-loans, design decisión 12; TC-DEBT-AMORT-017..019): compara el cronograma
 * vigente con la tabla del banco, cuota por número y al centavo. Puro: no cambia el préstamo ni la referencia.
 *
 * Diferencias = banco − sistema, con signo y a la escala de la moneda. Los componentes opcionales ausentes en la
 * referencia valen 0 (así una tabla sin columna de seguro delata la diferencia de cargos).
 */

export const COMPARED_COMPONENTS = ['principal', 'interest', 'fees', 'insurance', 'taxes', 'total'] as const;
export type ComparedComponent = (typeof COMPARED_COMPONENTS)[number];

export interface ComparedSide {
  readonly dueDate: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees: string;
  readonly insurance: string;
  readonly taxes: string;
  readonly total: string;
}

export type ComparedRowStatus = 'MATCH' | 'DIFFERENT' | 'ONLY_REFERENCE' | 'ONLY_SYSTEM';

export interface ComparedRow {
  readonly n: number;
  readonly status: ComparedRowStatus;
  /** `null` si la cuota existe en un solo lado. */
  readonly datesMatch: boolean | null;
  readonly system: ComparedSide | null;
  readonly reference: ComparedSide | null;
  /** Banco − sistema por componente; `null` si la cuota existe en un solo lado. */
  readonly differences: Readonly<Record<ComparedComponent, string>> | null;
}

export interface ComparisonSummary {
  /** Cuotas distintas entre ambos lados (unión por número). */
  readonly totalRows: number;
  /** Cuotas presentes en ambos lados y coincidentes al centavo (con el mismo vencimiento). */
  readonly matching: number;
  readonly firstDifference: {
    readonly n: number;
    readonly datesMatch: boolean | null;
    readonly differences: Readonly<Record<ComparedComponent, string>> | null;
  } | null;
  /** Σ de las diferencias por componente sobre las cuotas presentes en ambos lados. */
  readonly sumDifferences: Readonly<Record<ComparedComponent, string>>;
  /** Componentes con alguna diferencia distinta de cero. */
  readonly differingComponents: readonly ComparedComponent[];
  /** Números de cuota con vencimiento distinto. */
  readonly dateMismatches: readonly number[];
  readonly referencePrincipal: string;
  readonly loanPrincipal: string;
  readonly onlyReference: readonly number[];
  readonly onlySystem: readonly number[];
}

export interface ScheduleComparison {
  readonly currency: Currency;
  readonly rows: readonly ComparedRow[];
  readonly summary: ComparisonSummary;
}

export interface CompareSchedulesInput {
  readonly currency: Currency;
  readonly system: readonly ScheduleInstallment[];
  readonly reference: readonly ReferenceScheduleRow[];
  /** Principal del préstamo (o saldo pendiente en un préstamo en curso); por omisión Σ principal del sistema. */
  readonly loanPrincipal?: string;
}

const side = (r: ScheduleInstallment | ReferenceScheduleRow): ComparedSide => ({
  dueDate: r.dueDate,
  principal: r.principal,
  interest: r.interest,
  fees: r.fees,
  insurance: r.insurance,
  taxes: r.taxes,
  total: r.total,
});

export function compareSchedules(input: CompareSchedulesInput): ScheduleComparison {
  const scale = input.currency.scale;
  const fixed = (value: Decimal): string => value.toFixed(scale);
  const systemByN = new Map(input.system.map((r) => [r.n, r] as const));
  const referenceByN = new Map(input.reference.map((r) => [r.n, r] as const));
  const numbers = [...new Set([...systemByN.keys(), ...referenceByN.keys()])].sort((a, b) => a - b);

  const sums: Record<ComparedComponent, Decimal> = {
    principal: dec('0'),
    interest: dec('0'),
    fees: dec('0'),
    insurance: dec('0'),
    taxes: dec('0'),
    total: dec('0'),
  };
  const differing = new Set<ComparedComponent>();
  const rows: ComparedRow[] = [];
  const onlyReference: number[] = [];
  const onlySystem: number[] = [];
  const dateMismatches: number[] = [];
  let matching = 0;

  for (const n of numbers) {
    const sys = systemByN.get(n);
    const ref = referenceByN.get(n);
    if (sys && !ref) {
      onlySystem.push(n);
      rows.push({
        n,
        status: 'ONLY_SYSTEM',
        datesMatch: null,
        system: side(sys),
        reference: null,
        differences: null,
      });
      continue;
    }
    if (ref && !sys) {
      onlyReference.push(n);
      rows.push({
        n,
        status: 'ONLY_REFERENCE',
        datesMatch: null,
        system: null,
        reference: side(ref),
        differences: null,
      });
      continue;
    }
    const s = sys as ScheduleInstallment;
    const r = ref as ReferenceScheduleRow;
    const diff = {} as Record<ComparedComponent, string>;
    let amountsMatch = true;
    for (const c of COMPARED_COMPONENTS) {
      const delta = dec(r[c]).minus(s[c]);
      sums[c] = sums[c].plus(delta);
      diff[c] = delta.toFixed(scale);
      if (!delta.isZero()) {
        amountsMatch = false;
        differing.add(c);
      }
    }
    const datesMatch = r.dueDate === s.dueDate;
    if (!datesMatch) dateMismatches.push(n);
    const isMatch = amountsMatch && datesMatch;
    if (isMatch) matching += 1;
    rows.push({
      n,
      status: isMatch ? 'MATCH' : 'DIFFERENT',
      datesMatch,
      system: side(s),
      reference: side(r),
      differences: diff,
    });
  }

  const first = rows.find((r) => r.status !== 'MATCH');
  const sumDifferences = Object.fromEntries(
    COMPARED_COMPONENTS.map((c) => [c, sums[c].toFixed(scale)]),
  ) as Record<ComparedComponent, string>;
  const referencePrincipal = input.reference.reduce((acc, r) => acc.plus(r.principal), dec('0'));
  const systemPrincipal = input.system.reduce((acc, r) => acc.plus(r.principal), dec('0'));
  return {
    currency: input.currency,
    rows,
    summary: {
      totalRows: numbers.length,
      matching,
      firstDifference: first
        ? { n: first.n, datesMatch: first.datesMatch, differences: first.differences }
        : null,
      sumDifferences,
      differingComponents: COMPARED_COMPONENTS.filter((c) => differing.has(c)),
      dateMismatches,
      referencePrincipal: fixed(referencePrincipal),
      loanPrincipal: (input.loanPrincipal === undefined ? systemPrincipal : dec(input.loanPrincipal)).toFixed(
        scale,
      ),
      onlyReference,
      onlySystem,
    },
  };
}

/** `true` si la comparación no tiene diferencia alguna (todas las cuotas coinciden y no hay huérfanas). */
export const isExactMatch = (comparison: ScheduleComparison): boolean =>
  comparison.summary.totalRows > 0 && comparison.summary.matching === comparison.summary.totalRows;

/**
 * Estado derivado (no se almacena): `MATCH` sin diferencias; `EXPLAINED` con diferencias y explicación no vacía;
 * `UNEXPLAINED` con diferencias sin explicación.
 */
export function deriveComparisonStatus(
  comparison: ScheduleComparison,
  explanation?: string | null,
): ComparisonStatus {
  if (isExactMatch(comparison)) return 'MATCH';
  return explanation !== undefined && explanation !== null && explanation.trim() !== ''
    ? 'EXPLAINED'
    : 'UNEXPLAINED';
}

// ---------- sugerencias ----------

export type ExplanationSuggestion =
  | {
      readonly kind: 'CONVENTION';
      readonly dayCount: DayCount;
      /** `true` para la convención con que está registrado el préstamo. */
      readonly current: boolean;
      /** Cuotas que coinciden al centavo (con vencimiento) al recalcular con esa convención. */
      readonly matchingInstallments: number;
      /** Cuotas cuyo interés coincide. */
      readonly interestMatchingInstallments: number;
      readonly totalRows: number;
      readonly betterThanCurrent: boolean;
    }
  | { readonly kind: 'ONLY_DATES' }
  | { readonly kind: 'ONLY_CHARGES' }
  | { readonly kind: 'ONLY_LAST_INSTALLMENT'; readonly tolerance: string }
  | { readonly kind: 'PRINCIPAL_SUM_DIFFERS'; readonly difference: string };

export interface SuggestExplanationsInput {
  readonly comparison: ScheduleComparison;
  readonly reference: readonly ReferenceScheduleRow[];
  /** Condiciones del préstamo; se recalculan con las demás convenciones de días. */
  readonly calculatorInput: AmortizationInput;
  /** Calculador inyectado (por omisión `calculateSchedule`). */
  readonly calculate?: (input: AmortizationInput) => AmortizationSchedule;
}

const interestMatches = (c: ScheduleComparison): number =>
  c.rows.filter((r) => r.differences !== null && dec(r.differences.interest).isZero()).length;

/**
 * Sugerencias deterministas (Should): para cada convención de días, cuántas cuotas coinciden con la referencia, y
 * heurísticas "solo fechas", "solo cargos", "solo última cuota" (|Δ| ≤ 0.01 × n) y "Σ principal distinto". Sin
 * diferencias no hay sugerencias. Nunca cambia el préstamo.
 */
export function suggestExplanations(input: SuggestExplanationsInput): ExplanationSuggestion[] {
  const { comparison } = input;
  if (isExactMatch(comparison)) return [];
  const calculate = input.calculate ?? calculateSchedule;
  const { summary } = comparison;
  const out: ExplanationSuggestion[] = [];

  const current = input.calculatorInput.dayCount;
  const variants: ExplanationSuggestion[] = [];
  for (const dayCount of DAY_COUNTS) {
    if (dayCount === current) {
      variants.push({
        kind: 'CONVENTION',
        dayCount,
        current: true,
        matchingInstallments: summary.matching,
        interestMatchingInstallments: interestMatches(comparison),
        totalRows: summary.totalRows,
        betterThanCurrent: false,
      });
      continue;
    }
    try {
      const schedule = calculate({ ...input.calculatorInput, dayCount });
      const alt = compareSchedules({
        currency: comparison.currency,
        system: schedule.installments,
        reference: input.reference,
        loanPrincipal: summary.loanPrincipal,
      });
      variants.push({
        kind: 'CONVENTION',
        dayCount,
        current: false,
        matchingInstallments: alt.summary.matching,
        interestMatchingInstallments: interestMatches(alt),
        totalRows: alt.summary.totalRows,
        betterThanCurrent: alt.summary.matching > summary.matching,
      });
    } catch (e) {
      // Una convención que no se puede calcular (amortización negativa) simplemente no se sugiere.
      if (!(e instanceof DomainError)) throw e;
    }
  }
  out.push(...variants);

  const paired = comparison.rows.filter((r) => r.differences !== null);
  const noOrphans = summary.onlyReference.length === 0 && summary.onlySystem.length === 0;
  const zero = (r: ComparedRow, c: ComparedComponent) =>
    dec((r.differences as Record<ComparedComponent, string>)[c]).isZero();
  const differingRows = comparison.rows.filter((r) => r.status !== 'MATCH');

  if (
    noOrphans &&
    summary.dateMismatches.length > 0 &&
    paired.every((r) => COMPARED_COMPONENTS.every((c) => zero(r, c)))
  ) {
    out.push({ kind: 'ONLY_DATES' });
  }
  if (
    noOrphans &&
    summary.dateMismatches.length === 0 &&
    paired.every((r) => zero(r, 'principal') && zero(r, 'interest')) &&
    summary.differingComponents.some(
      (c) => c === 'fees' || c === 'insurance' || c === 'taxes' || c === 'total',
    )
  ) {
    out.push({ kind: 'ONLY_CHARGES' });
  }
  const lastN = Math.max(...comparison.rows.map((r) => r.n));
  const tolerance = dec('0.01').times(summary.totalRows);
  if (
    noOrphans &&
    differingRows.length === 1 &&
    (differingRows[0] as ComparedRow).n === lastN &&
    (differingRows[0] as ComparedRow).datesMatch === true &&
    COMPARED_COMPONENTS.every((c) =>
      dec(((differingRows[0] as ComparedRow).differences as Record<ComparedComponent, string>)[c])
        .abs()
        .lte(tolerance),
    )
  ) {
    out.push({ kind: 'ONLY_LAST_INSTALLMENT', tolerance: tolerance.toFixed(comparison.currency.scale) });
  }
  const principalDiff = dec(summary.referencePrincipal).minus(summary.loanPrincipal);
  if (!principalDiff.isZero()) {
    out.push({ kind: 'PRINCIPAL_SUM_DIFFERS', difference: principalDiff.toFixed(comparison.currency.scale) });
  }
  return out;
}

// ---------- CSV ----------

const CSV_HEADER_NAMES: Readonly<Record<ComparedComponent, string>> = {
  principal: 'principal',
  interest: 'interes',
  fees: 'comisiones',
  insurance: 'seguro',
  taxes: 'impuestos',
  total: 'total',
};

const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/**
 * Reporte de la comparación en CSV (separador `,`, decimal `.`, saltos `\n`): por cuota el vencimiento y cada
 * componente de ambos lados con su diferencia (banco − sistema).
 */
export function comparisonToCsv(comparison: ScheduleComparison): string {
  const header = [
    'cuota',
    'estado',
    'vencimiento_sistema',
    'vencimiento_banco',
    ...COMPARED_COMPONENTS.flatMap((c) => [
      `${CSV_HEADER_NAMES[c]}_sistema`,
      `${CSV_HEADER_NAMES[c]}_banco`,
      `${CSV_HEADER_NAMES[c]}_diferencia`,
    ]),
  ];
  const lines = [header.join(',')];
  for (const r of comparison.rows) {
    const cells = [
      String(r.n),
      r.status,
      r.system?.dueDate ?? '',
      r.reference?.dueDate ?? '',
      ...COMPARED_COMPONENTS.flatMap((c) => [
        r.system?.[c] ?? '',
        r.reference?.[c] ?? '',
        r.differences?.[c] ?? '',
      ]),
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
