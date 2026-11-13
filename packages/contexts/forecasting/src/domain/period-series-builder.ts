import {
  FinancialPeriodCalendar,
  LocalDate,
  Money,
  PeriodCalendar,
  convertExact,
  dec,
  shiftLabel,
  type Currency,
  type Decimal,
  type ExactRate,
  type PeriodLabel,
} from '@pf/shared-kernel';

/** Fila diaria de flujos nominales (la forma de `NominalFlowRowDto` de TRANSACTIONS). */
export interface FlowRow {
  readonly businessDate: string;
  readonly nature: 'INCOME' | 'EXPENSE';
  readonly categoryId: string;
  readonly amount: { readonly amount: string; readonly currency: string };
}

export interface CategoryFigure {
  readonly value: Decimal;
  /** Cantidad de filas diarias del periodo (aproxima la densidad: TRANSACTIONS no expone el conteo de transacciones). */
  readonly txCount: number;
}

export interface PeriodAggregate {
  readonly label: PeriodLabel;
  readonly start: string;
  readonly end: string;
  readonly expenseTotal: Decimal;
  readonly incomeTotal: Decimal;
  readonly expenseTx: number;
  readonly incomeTx: number;
  readonly expenseByCategory: ReadonlyMap<string, CategoryFigure>;
  /** Flujos excluidos por no tener tasa para su fecha (nunca 1:1). */
  readonly unvaluedCount: number;
  /** ¿El workspace registró algún ingreso o gasto en el periodo? (si no, es un hueco) */
  readonly active: boolean;
}

export interface PeriodHistory {
  /** Periodo en curso (el primero pronosticado). */
  readonly currentPeriod: PeriodLabel;
  /** Último periodo terminado, o `null` si aún no terminó ninguno con datos. */
  readonly lastFinished: PeriodLabel | null;
  /** Periodos terminados con datos desde el primero activo, en orden ascendente (acotados a `maxPeriods`). */
  readonly periods: readonly PeriodAggregate[];
}

export interface BuildPeriodHistoryInput {
  readonly rows: readonly FlowRow[];
  /** "Hoy" del workspace (fecha local de su zona). */
  readonly today: LocalDate;
  readonly startDay: number;
  readonly maxPeriods: number;
  readonly target: Currency;
  /** Tasa exacta de la moneda al cierre de la fecha (FlowValuation); `null` si no hay. */
  readonly rateFor: (currency: string, date: string) => ExactRate | null;
}

const scaleOfText = (amount: string): number => {
  const dot = amount.indexOf('.');
  return dot < 0 ? 0 : amount.length - dot - 1;
};

/**
 * `PeriodSeriesBuilder` (openspec add-ml-forecasting-service, decisión 7; FR-FORECAST-001): historia por periodo
 * financiero del workspace a partir de los flujos nominales. Pura. Solo periodos TERMINADOS (el periodo en curso queda
 * fuera), valorados en la moneda de reporte con la tasa de la fecha de cada flujo, netos de reembolsos (ya vienen netos).
 * Un flujo sin tasa se excluye y se cuenta; nunca se convierte 1:1.
 */
export const PeriodSeriesBuilder = {
  /** Rango de fechas que hay que pedir a TRANSACTIONS para `maxPeriods` periodos terminados. */
  queryRange(
    today: LocalDate,
    startDay: number,
    maxPeriods: number,
  ): { readonly dateFrom: string; readonly dateTo: string } | null {
    const current = FinancialPeriodCalendar.periodOf(startDay, today);
    const firstLabel = shiftLabel(current.label, -maxPeriods);
    const lastLabel = shiftLabel(current.label, -1);
    return {
      dateFrom: PeriodCalendar.rangeFor(firstLabel, startDay).start.toString(),
      dateTo: PeriodCalendar.rangeFor(lastLabel, startDay).end.toString(),
    };
  },

  build(input: BuildPeriodHistoryInput): PeriodHistory {
    const { today, startDay, target } = input;
    const current = FinancialPeriodCalendar.periodOf(startDay, today);
    const lastLabel = shiftLabel(current.label, -1);
    const firstWindow = shiftLabel(current.label, -input.maxPeriods);

    interface Acc {
      expense: Decimal;
      income: Decimal;
      expenseTx: number;
      incomeTx: number;
      unvalued: number;
      byCategory: Map<string, { value: Decimal; txCount: number }>;
      active: boolean;
    }
    const acc = new Map<PeriodLabel, Acc>();
    for (const row of input.rows) {
      const label = FinancialPeriodCalendar.periodOf(startDay, LocalDate.parse(row.businessDate)).label;
      if (label > lastLabel || label < firstWindow) continue; // el periodo en curso y los futuros no entran
      const a =
        acc.get(label) ??
        ({
          expense: dec('0'),
          income: dec('0'),
          expenseTx: 0,
          incomeTx: 0,
          unvalued: 0,
          byCategory: new Map(),
          active: false,
        } satisfies Acc);
      acc.set(label, a);
      a.active = true;
      let value: Decimal;
      if (row.amount.currency === target.code) {
        value = dec(row.amount.amount);
      } else {
        const rate = input.rateFor(row.amount.currency, row.businessDate);
        if (!rate) {
          a.unvalued += 1;
          continue;
        }
        value = convertExact(
          Money.parse(row.amount.amount, row.amount.currency, scaleOfText(row.amount.amount)),
          target,
          rate,
        );
      }
      if (row.nature === 'INCOME') {
        a.income = a.income.plus(value);
        a.incomeTx += 1;
      } else {
        a.expense = a.expense.plus(value);
        a.expenseTx += 1;
        const c = a.byCategory.get(row.categoryId) ?? { value: dec('0'), txCount: 0 };
        a.byCategory.set(row.categoryId, { value: c.value.plus(value), txCount: c.txCount + 1 });
      }
    }
    const activeLabels = [...acc.entries()].filter(([, a]) => a.active).map(([l]) => l);
    if (activeLabels.length === 0) return { currentPeriod: current.label, lastFinished: null, periods: [] };
    const first = activeLabels.reduce((m, l) => (l < m ? l : m));
    const periods: PeriodAggregate[] = [];
    for (let label = first; label <= lastLabel; label = shiftLabel(label, 1)) {
      const range = PeriodCalendar.rangeFor(label, startDay);
      const a = acc.get(label);
      periods.push({
        label,
        start: range.start.toString(),
        end: range.end.toString(),
        expenseTotal: a?.expense ?? dec('0'),
        incomeTotal: a?.income ?? dec('0'),
        expenseTx: a?.expenseTx ?? 0,
        incomeTx: a?.incomeTx ?? 0,
        expenseByCategory: a?.byCategory ?? new Map(),
        unvaluedCount: a?.unvalued ?? 0,
        active: a?.active ?? false,
      });
    }
    return { currentPeriod: current.label, lastFinished: lastLabel, periods };
  },
} as const;
