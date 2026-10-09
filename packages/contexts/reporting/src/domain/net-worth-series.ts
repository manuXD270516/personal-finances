import { DomainError, type Money, type Currency } from '@pf/shared-kernel';
import { NetWorthValuator, type ValuedAccount } from './net-worth-valuator.js';
import { present, type ExactRate } from './valuation.js';

/** Máximo de periodos (meses) de la serie (reporting/net-worth, "Rango de la serie de patrimonio"). */
export const MAX_SERIES_MONTHS = 120;
/** Periodos por defecto: los últimos 12, incluido el actual. */
export const DEFAULT_SERIES_MONTHS = 12;

/** Periodo financiero mensual (de `planning/financial-periods`), reducido a lo que necesita la serie. */
export interface SeriesPeriod {
  readonly id: string;
  /** `YYYY-MM` del inicio (docs/33 D59). */
  readonly label: string;
  /** Fechas de negocio inclusivas `YYYY-MM-DD`. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: string;
}

export interface SeriesCutoff {
  readonly period: SeriesPeriod;
  /** Fecha de corte: `periodEnd`, u hoy si el periodo está en curso. */
  readonly asOf: string;
  /** `true` si el periodo contiene hoy (se calcula a hoy). */
  readonly partial: boolean;
}

/** Cifras congeladas de un snapshot de cierre, ya en la moneda de reporte pedida. */
export interface ClosedFigures {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
}

export interface SeriesPointInput {
  readonly cutoff: SeriesCutoff;
  /** Saldos de las cuentas a la fecha de corte (todas; el valuador filtra `includeInNetWorth`). */
  readonly accounts: readonly ValuedAccount[];
  readonly rateFor: (currency: string) => ExactRate | null;
  /** Periodo con snapshot de cierre vigente (aunque su moneda no coincida con la de reporte). */
  readonly closed: boolean;
  /** Presente solo si el snapshot está en la moneda de reporte pedida: se usa en lugar del cálculo. */
  readonly snapshot?: ClosedFigures | null;
}

export interface SeriesPoint {
  readonly period: string;
  readonly periodId: string;
  readonly asOf: string;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  /** Variación del neto respecto al punto anterior de la serie; `null` en el primero. */
  readonly change: Money | null;
  /** `false` en el primer punto o si alguno de los dos puntos es incompleto. */
  readonly comparable: boolean;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
  readonly source: 'COMPUTED' | 'SNAPSHOT';
  readonly closed: boolean;
  readonly partial: boolean;
}

const LABEL = /^(\d{4})-(0[1-9]|1[0-2])$/;

const monthIndex = (label: string): number => {
  const m = LABEL.exec(label);
  if (!m) throw new DomainError('VALIDATION_FAILED', `invalid period label ${label}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
};

const labelOf = (index: number): string =>
  `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;

/**
 * DS `NetWorthSeriesBuilder` (design.md decisiones 1–7), puro: cortes por periodo financiero, validación del rango y
 * construcción de la serie reutilizando el `NetWorthValuator` de Phase 1 (misma valoración, sin 1:1: una moneda sin
 * tasa a la fecha deja el punto incompleto). Un punto cerrado con snapshot en la moneda pedida usa sus cifras
 * congeladas (NFR-DATA-006). Las cifras se presentan HALF_EVEN UNA sola vez; la variación es la diferencia de los
 * netos presentados.
 */
export const NetWorthSeriesBuilder = {
  /**
   * Resuelve `from`/`to` (etiquetas `YYYY-MM`) contra el periodo actual: por defecto 12 periodos terminando en el
   * actual; `from ≤ to ≤ actual` y como máximo 120 meses (si no, `VALIDATION_FAILED`).
   */
  resolveRange(
    input: { readonly from?: string | undefined; readonly to?: string | undefined },
    currentLabel: string,
  ): { readonly from: string; readonly to: string } {
    const bad = (message: string, pointer: string) =>
      new DomainError('VALIDATION_FAILED', message).at(pointer);
    for (const [key, value] of [
      ['from', input.from],
      ['to', input.to],
    ] as const) {
      if (value !== undefined && !LABEL.test(value)) throw bad(`${key} must be YYYY-MM`, `/${key}`);
    }
    const current = monthIndex(currentLabel);
    const to = input.to === undefined ? current : monthIndex(input.to);
    const from = input.from === undefined ? to - (DEFAULT_SERIES_MONTHS - 1) : monthIndex(input.from);
    if (to > current) throw bad('to must not be after the current period', '/to');
    if (from > to) throw bad('from must not be after to', '/from');
    if (to - from + 1 > MAX_SERIES_MONTHS) {
      throw bad(`range must not exceed ${MAX_SERIES_MONTHS} months`, '/from');
    }
    return { from: labelOf(from), to: labelOf(to) };
  },

  /**
   * Cortes de la serie: los periodos del rango que ya empezaron (los futuros se omiten). El que contiene hoy se calcula
   * a hoy (`partial`); los demás al fin del periodo (con día de inicio ≠ 1 también, p. ej. 2026-02-24).
   */
  cutoffs(
    periods: readonly SeriesPeriod[],
    range: { readonly from: string; readonly to: string },
    today: string,
  ): SeriesCutoff[] {
    return periods
      .filter((p) => p.label >= range.from && p.label <= range.to && p.periodStart <= today)
      .sort((a, b) => (a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0))
      .map((period) => {
        const partial = period.periodEnd >= today;
        return { period, asOf: partial ? today : period.periodEnd, partial };
      });
  },

  build(inputs: readonly SeriesPointInput[], target: Currency): SeriesPoint[] {
    const points: SeriesPoint[] = [];
    for (const input of inputs) {
      const { cutoff } = input;
      let assets: Money;
      let liabilities: Money;
      let netWorth: Money;
      let complete: boolean;
      let unconverted: readonly Money[];
      let source: SeriesPoint['source'];
      if (input.snapshot) {
        ({ assets, liabilities, netWorth, complete, unconverted } = input.snapshot);
        source = 'SNAPSHOT';
      } else {
        const nw = NetWorthValuator.value(input.accounts, target, input.rateFor);
        assets = present(nw.assets, target);
        liabilities = present(nw.liabilities, target);
        netWorth = present(nw.netWorth, target);
        complete = nw.complete;
        unconverted = nw.unvalued;
        source = 'COMPUTED';
      }
      const previous = points.at(-1);
      points.push({
        period: cutoff.period.label,
        periodId: cutoff.period.id,
        asOf: cutoff.asOf,
        assets,
        liabilities,
        netWorth,
        change: previous ? netWorth.subtract(previous.netWorth) : null,
        comparable: previous !== undefined && previous.complete && complete,
        complete,
        unconverted,
        source,
        closed: input.closed,
        partial: cutoff.partial,
      });
    }
    return points;
  },
} as const;
