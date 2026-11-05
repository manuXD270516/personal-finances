import { LocalDate, PeriodCalendar, shiftLabel } from '@pf/shared-kernel';

/**
 * Estado base de un periodo de la ventana, antes de mirar los montos (openspec add-historical-budgets, decisiones 2 y 3):
 *   - `ELIGIBLE`: terminado y posterior a la primera actividad; su real se calcula;
 *   - `BEFORE_FIRST_ACTIVITY`: terminó antes de la primera actividad del workspace (o no hay actividad);
 *   - `INCOMPLETE`: contiene la primera actividad (empezó antes);
 *   - `IN_PROGRESS`: el periodo en curso, que nunca entra en el cálculo.
 */
export type WindowBase = 'ELIGIBLE' | 'BEFORE_FIRST_ACTIVITY' | 'INCOMPLETE' | 'IN_PROGRESS';

export interface WindowPeriod {
  /** Etiqueta `YYYY-MM`: clave del periodo en toda la sugerencia. */
  readonly label: string;
  /** `null` si el periodo todavía no existe como fila (anterior a la creación retroactiva). */
  readonly periodId: string | null;
  readonly start: string;
  readonly end: string;
  readonly closed: boolean;
  readonly base: WindowBase;
}

export interface PeriodRowRef {
  readonly id: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: string;
}

export interface SuggestionWindowResult {
  /** Periodos terminados (los N pedidos) más, si existe, el periodo en curso; del más antiguo al más reciente. */
  readonly periods: readonly WindowPeriod[];
  /** Periodo que empezó 12 periodos antes del que se planifica. */
  readonly sameLastYear: WindowPeriod;
}

/** Máximo de etiquetas que se recorren hacia atrás para reunir N periodos terminados. */
const MAX_LOOKBACK = 60;

/**
 * VO `SuggestionWindow`: los N periodos terminados inmediatamente anteriores al periodo que se planifica, según el
 * calendario de periodos (respeta el día de inicio; usa la fila real si existe y el calendario si no), más el periodo
 * en curso (informado, nunca usado) y el mismo periodo del año anterior. La ventana es fija: excluir periodos no la
 * extiende hacia atrás.
 */
export const SuggestionWindow = {
  build(input: {
    readonly targetLabel: string;
    readonly targetStart: string;
    readonly count: number;
    readonly today: LocalDate;
    readonly startDay: number;
    /** `minEntryDate` del ledger; `null` si el workspace no tiene asientos. */
    readonly firstActivity: string | null;
    readonly rows: readonly PeriodRowRef[];
  }): SuggestionWindowResult {
    const byLabel = new Map(input.rows.map((r) => [r.label, r]));
    const targetStart = LocalDate.parse(input.targetStart);
    const first = input.firstActivity === null ? null : LocalDate.parse(input.firstActivity);

    const describe = (label: string): { period: WindowPeriod; finished: boolean; future: boolean } => {
      const row = byLabel.get(label);
      const range = row
        ? { start: LocalDate.parse(row.periodStart), end: LocalDate.parse(row.periodEnd) }
        : PeriodCalendar.rangeFor(label, input.startDay);
      const finished = range.end.compare(input.today) < 0 && range.end.compare(targetStart) < 0;
      const future = range.start.compare(input.today) > 0;
      let base: WindowBase;
      if (!finished) base = 'IN_PROGRESS';
      else if (first === null || range.end.compare(first) < 0) base = 'BEFORE_FIRST_ACTIVITY';
      else if (range.start.compare(first) < 0) base = 'INCOMPLETE';
      else base = 'ELIGIBLE';
      return {
        finished,
        future,
        period: {
          label,
          periodId: row?.id ?? null,
          start: range.start.toString(),
          end: range.end.toString(),
          closed: row?.status === 'CLOSED',
          base,
        },
      };
    };

    const finished: WindowPeriod[] = [];
    let inProgress: WindowPeriod | null = null;
    for (let k = 1; k <= MAX_LOOKBACK && finished.length < input.count; k += 1) {
      const d = describe(shiftLabel(input.targetLabel, -k));
      if (d.finished) finished.push(d.period);
      else if (!d.future && inProgress === null) inProgress = d.period;
    }
    const periods = [...finished].reverse();
    if (inProgress) periods.push(inProgress);
    return { periods, sameLastYear: describe(shiftLabel(input.targetLabel, -12)).period };
  },
} as const;
