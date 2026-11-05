import { LocalDate, type Money } from '@pf/shared-kernel';

export interface BalanceDay {
  readonly date: string;
  /** Saldo contable al cierre del día (el del día anterior si no hubo movimientos). */
  readonly balance: Money;
  readonly hasMovements: boolean;
  /** Cierra una conciliación de la cuenta ese día. */
  readonly reconciled: boolean;
}

/** Máximo de días del historial de saldo (design decisión 8). */
export const MAX_BALANCE_HISTORY_DAYS = 731;

/**
 * `BalanceStepSeries` (reporte 15): saldo diario "en escalón" de una cuenta. Parte del saldo de apertura (al cierre del
 * día anterior al rango) y suma los deltas diarios del ledger; los días sin movimientos conservan el saldo. Puro.
 */
export const BalanceStepSeries = {
  build(input: {
    readonly from: string;
    readonly to: string;
    readonly opening: Money;
    /** Delta contable por fecha de negocio (puede faltar un día sin movimientos). */
    readonly deltas: ReadonlyMap<string, Money>;
    readonly reconciledDates: ReadonlySet<string>;
  }): { days: BalanceDay[]; closing: Money } {
    const days: BalanceDay[] = [];
    let balance = input.opening;
    const end = LocalDate.parse(input.to).toEpochDay();
    for (let e = LocalDate.parse(input.from).toEpochDay(); e <= end; e += 1) {
      const date = LocalDate.ofEpochDay(e).toString();
      const delta = input.deltas.get(date);
      if (delta) balance = balance.add(delta);
      days.push({
        date,
        balance,
        hasMovements: delta !== undefined && !delta.isZero(),
        reconciled: input.reconciledDates.has(date),
      });
    }
    return { days, closing: balance };
  },
} as const;
