import {
  dec,
  FlowValuation,
  present,
  sumByCurrency,
  type Currency,
  type DatedAmount,
  type Decimal,
  type ExactRate,
  Money,
} from '@pf/shared-kernel';

/** Política de conversión declarada en cada reporte (design decisión 6). */
export type ReportConversionPolicyKind = 'TRANSACTION_DATE' | 'VALUATION_DATE' | 'CUTOFF_DATE';

/**
 * Cifra de un reporte: por moneda nativa (suma exacta, nunca depende de la moneda de reporte) y consolidada en la
 * moneda de reporte. `exact` conserva la precisión completa (40) para variaciones y promedios; HALF_EVEN solo al
 * presentar. Un monto sin tasa NO se convierte a 1:1: queda en `unconverted` y `complete` es `false`.
 */
export interface ReportAmount {
  readonly byCurrency: readonly Money[];
  readonly consolidated: Money;
  readonly exact: Decimal;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
}

export type RateLookup = (currency: string, date: string) => ExactRate | null;

/**
 * `ReportConversionPolicy` (FR-REPORTING-011, D109) sobre `FlowValuation`: agrega por (moneda, día) y convierte UNA vez
 * cada agregado con la tasa de su fecha (`TRANSACTION_DATE`), de la fecha de valoración (`VALUATION_DATE`, saldos) o de
 * la fecha de corte para todos (`CUTOFF_DATE`). Sin redondeo intermedio. Puro.
 */
export class ReportConversionPolicy {
  private constructor(
    readonly kind: ReportConversionPolicyKind,
    readonly target: Currency,
    readonly cutoffDate: string | null,
    private readonly rateFor: RateLookup,
  ) {}

  /** Flujos a la tasa del cierre del día de cada movimiento. */
  static transactionDate(target: Currency, rateFor: RateLookup): ReportConversionPolicy {
    return new ReportConversionPolicy('TRANSACTION_DATE', target, null, rateFor);
  }

  /** Saldos a la tasa de su fecha de valoración. */
  static valuationDate(target: Currency, rateFor: RateLookup): ReportConversionPolicy {
    return new ReportConversionPolicy('VALUATION_DATE', target, null, rateFor);
  }

  /** Todos los flujos a la tasa del cierre de la fecha de corte. */
  static cutoffDate(target: Currency, cutoffDate: string, rateFor: RateLookup): ReportConversionPolicy {
    return new ReportConversionPolicy('CUTOFF_DATE', target, cutoffDate, rateFor);
  }

  /** Fecha con la que se pide la tasa de un monto fechado en `date`. */
  rateDate(date: string): string {
    return this.kind === 'CUTOFF_DATE' && this.cutoffDate ? this.cutoffDate : date;
  }

  zero(): ReportAmount {
    return {
      byCurrency: [],
      consolidated: Money.zero(this.target),
      exact: dec('0'),
      complete: true,
      unconverted: [],
    };
  }

  /**
   * Valora los montos fechados. `perDays` (> 0) divide por los días del rango SIN redondeo intermedio (comparación
   * normalizada): las cifras nativas se presentan a la escala de su moneda y la consolidada al final.
   */
  value(rows: readonly DatedAmount[], perDays?: number): ReportAmount {
    const mapped = rows.map((r) => ({ date: this.rateDate(r.date), amount: r.amount }));
    const consolidated = FlowValuation.consolidate(mapped, this.target, this.rateFor);
    const divisor = perDays && perDays > 0 ? dec(String(perDays)) : null;
    const scaled = (m: Money): Money => (divisor ? m.divide(divisor, 'HALF_EVEN') : m);
    const exact = divisor ? consolidated.total.div(divisor) : consolidated.total;
    return {
      byCurrency: sumByCurrency(rows.map((r) => r.amount)).map(scaled),
      consolidated: present(exact, this.target),
      exact,
      complete: consolidated.complete,
      unconverted: consolidated.unconverted.map(scaled),
    };
  }

  /** Une varias cifras ya valoradas (suma exacta; los sin tasa se unen por moneda). */
  static combine(target: Currency, parts: readonly ReportAmount[], sign: 1 | -1 = 1): ReportAmount {
    let exact = dec('0');
    const native: Money[] = [];
    const missing: Money[] = [];
    let complete = true;
    for (const p of parts) {
      exact = sign === 1 ? exact.plus(p.exact) : exact.minus(p.exact);
      native.push(...p.byCurrency.map((m) => (sign === 1 ? m : m.negate())));
      missing.push(...p.unconverted.map((m) => (sign === 1 ? m : m.negate())));
      complete = complete && p.complete;
    }
    return {
      byCurrency: sumByCurrency(native),
      consolidated: present(exact, target),
      exact,
      complete,
      unconverted: sumByCurrency(missing).filter((m) => !m.isZero()),
    };
  }
}
