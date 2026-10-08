import { DomainError, LocalDate } from '@pf/shared-kernel';

/**
 * Calendario financiero (DS `PeriodCalendar`, openspec add-financial-periods decisiones 1, 2 y 9). Cálculo PURO de
 * rangos de fechas de negocio: nunca usa instantes ni la zona horaria (la fecha de negocio manda, RISK-020).
 *
 * - Etiqueta `YYYY-MM` = año y mes de la fecha de inicio (docs/33 D59).
 * - Rango inclusivo `[inicio, fin]`, con `fin` = día anterior al día de inicio del mes calendario siguiente.
 * - Día de inicio 1..28 (FR-IDENTITY-005, docs/31 D23): todo mes calendario contiene exactamente un inicio.
 */

/** `YYYY-MM` del inicio del periodo. */
export type PeriodLabel = string;

/** Rango inclusivo de fechas de negocio. */
export interface DateRange {
  readonly start: LocalDate;
  readonly end: LocalDate;
}

/** Periodo calculado (aún sin identidad ni estado). */
export interface PlannedPeriod {
  readonly label: PeriodLabel;
  readonly range: DateRange;
  /** Día de inicio con que se calculó el fin del rango. */
  readonly startDay: number;
  /** El inicio no cae en `startDay`: absorbe el desfase de un cambio del día de inicio (decisión 9). */
  readonly isTransition: boolean;
}

export const MIN_START_DAY = 1;
export const MAX_START_DAY = 28;
/** Horizonte máximo de creación de periodos: hoy + 24 meses (FR-PLANNING-002). */
export const HORIZON_MONTHS = 24;

const LABEL = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MS_PER_DAY = 86_400_000;

export function assertStartDay(startDay: number): void {
  if (!Number.isInteger(startDay) || startDay < MIN_START_DAY || startDay > MAX_START_DAY) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `start day must be an integer between 1 and 28 (got ${startDay})`,
    );
  }
}

export function parseLabel(label: string): { readonly year: number; readonly month: number } {
  const m = typeof label === 'string' ? LABEL.exec(label) : null;
  if (!m) throw new DomainError('VALIDATION_FAILED', `period label must be YYYY-MM (got ${String(label)})`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

const formatLabel = (year: number, month: number): PeriodLabel =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;

/** Etiqueta del periodo que empieza en `date` (año y mes de la fecha). */
export const labelOf = (date: LocalDate): PeriodLabel => formatLabel(date.year, date.month);

/** Etiqueta desplazada `months` meses (negativo = hacia atrás). */
export function shiftLabel(label: PeriodLabel, months: number): PeriodLabel {
  const { year, month } = parseLabel(label);
  const index = year * 12 + (month - 1) + months;
  return formatLabel(Math.floor(index / 12), (index % 12) + 1);
}

const epochDay = (d: LocalDate): number => Date.UTC(d.year, d.month - 1, d.day) / MS_PER_DAY;

/** Fecha de negocio desplazada `days` días (aritmética de calendario, sin zona horaria). */
export function plusDays(date: LocalDate, days: number): LocalDate {
  const t = new Date((epochDay(date) + days) * MS_PER_DAY);
  return LocalDate.of(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Fecha desplazada `months` meses; el día se acota al último del mes destino (31-ene + 1 mes = 28/29-feb). */
export function plusMonths(date: LocalDate, months: number): LocalDate {
  const { year, month } = parseLabel(shiftLabel(labelOf(date), months));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return LocalDate.of(year, month, Math.min(date.day, last));
}

/** Última fecha que puede cubrir un periodo creado hoy: hoy + 24 meses. */
export const horizonOf = (today: LocalDate): LocalDate => plusMonths(today, HORIZON_MONTHS);

const maxDate = (a: LocalDate, b: LocalDate) => (a.compare(b) >= 0 ? a : b);
const minDate = (a: LocalDate, b: LocalDate) => (a.compare(b) <= 0 ? a : b);
export { maxDate, minDate };

/** Inicio del periodo `label` con día de inicio `startDay`. */
function startOf(label: PeriodLabel, startDay: number): LocalDate {
  assertStartDay(startDay);
  const { year, month } = parseLabel(label);
  return LocalDate.of(year, month, startDay);
}

/** Fin de un periodo de etiqueta `label` con día de inicio `startDay`: el día anterior al inicio del siguiente. */
const endOf = (label: PeriodLabel, startDay: number): LocalDate =>
  plusDays(startOf(shiftLabel(label, 1), startDay), -1);

export const PeriodCalendar = {
  /** Rango del periodo regular `label` con día de inicio `startDay` (sin transición). */
  rangeFor(label: PeriodLabel, startDay: number): DateRange {
    return { start: startOf(label, startDay), end: endOf(label, startDay) };
  },

  /** Periodo regular que contiene `date` con día de inicio `startDay`. */
  periodContaining(date: LocalDate, startDay: number): PlannedPeriod {
    assertStartDay(startDay);
    const own = labelOf(date);
    const label = date.day >= startDay ? own : shiftLabel(own, -1);
    return { label, range: PeriodCalendar.rangeFor(label, startDay), startDay, isTransition: false };
  },

  /**
   * Periodo que sigue a uno que termina en `previousEnd`: empieza al día siguiente, se etiqueta con el mes de su
   * inicio y termina el día anterior al día de inicio `startDay` del mes calendario siguiente. Si no empieza en
   * `startDay` es un periodo de transición (6 a 58 días; decisión 9).
   */
  next(previousEnd: LocalDate, startDay: number): PlannedPeriod {
    const start = plusDays(previousEnd, 1);
    const label = labelOf(start);
    return {
      label,
      range: { start, end: endOf(label, startDay) },
      startDay,
      isTransition: start.day !== startDay,
    };
  },

  /**
   * Periodo que precede a uno que empieza en `nextStart` (cobertura retroactiva): regular, con el mismo día en que
   * empieza el siguiente (las fechas anteriores conservan el calendario vigente cuando ocurrieron; sin transiciones
   * retroactivas).
   */
  previous(nextStart: LocalDate): PlannedPeriod {
    const label = shiftLabel(labelOf(nextStart), -1);
    const startDay = nextStart.day;
    return { label, range: PeriodCalendar.rangeFor(label, startDay), startDay, isTransition: false };
  },

  contains(range: DateRange, date: LocalDate): boolean {
    return range.start.compare(date) <= 0 && date.compare(range.end) <= 0;
  },
} as const;

export interface CoverageInput {
  /** Periodos existentes, contiguos y ordenados por inicio. */
  readonly existing: readonly { readonly label: PeriodLabel; readonly range: DateRange }[];
  /** Día de inicio vigente del workspace (para los periodos nuevos hacia adelante y el primero). */
  readonly startDay: number;
  /** Hoy en la zona horaria del workspace. */
  readonly today: LocalDate;
  /** Primera fecha que debe quedar cubierta (cobertura retroactiva; nunca antes del primer periodo si hay cierres). */
  readonly from: LocalDate;
  /** Última fecha que debe quedar cubierta (se acota al horizonte de hoy + 24 meses). */
  readonly through: LocalDate;
  /** Periodos futuros (inicio > hoy) que deben existir como mínimo. */
  readonly lookahead: number;
}

/**
 * Periodos que FALTAN para cubrir `[from, through]` y la anticipación (decisión 5), en orden de inicio. Nunca crea un
 * periodo que empiece después del horizonte (hoy + 24 meses). Puro e idempotente: con lo ya creado devuelve `[]`.
 */
export function planCoverage(input: CoverageInput): PlannedPeriod[] {
  const horizon = horizonOf(input.today);
  const through = minDate(maxDate(input.through, input.today), horizon);
  const first = input.existing[0];
  const created: PlannedPeriod[] = [];
  let head: DateRange;
  let tail: DateRange;
  if (first) {
    head = first.range;
    tail = (input.existing.at(-1) ?? first).range;
  } else {
    const initial = PeriodCalendar.periodContaining(minDate(input.from, input.today), input.startDay);
    created.push(initial);
    head = initial.range;
    tail = initial.range;
  }
  const before: PlannedPeriod[] = [];
  while (input.from.compare(head.start) < 0) {
    const p = PeriodCalendar.previous(head.start);
    before.unshift(p);
    head = p.range;
  }
  const futureCount = () =>
    [...input.existing.map((e) => e.range), ...created.map((c) => c.range)].filter(
      (r) => r.start.compare(input.today) > 0,
    ).length;
  for (;;) {
    const needsDate = tail.end.compare(through) < 0;
    const needsLookahead = futureCount() < input.lookahead;
    if (!needsDate && !needsLookahead) break;
    const p = PeriodCalendar.next(tail.end, input.startDay);
    if (p.range.start.compare(horizon) > 0) break;
    created.push(p);
    tail = p.range;
  }
  return [...before, ...created].sort((a, b) => a.range.start.compare(b.range.start));
}

export interface RescheduleChange {
  readonly label: PeriodLabel;
  readonly before: DateRange;
  readonly after: PlannedPeriod;
}

/**
 * Recálculo de los periodos `DRAFT` ante un cambio del día de inicio (decisión 9, docs/33 D61): los no-DRAFT no
 * cambian; el primer DRAFT empieza al día siguiente del último no-DRAFT (transición si no cae en el nuevo día) y cada
 * DRAFT conserva su etiqueta. Devuelve solo los DRAFT cuyo rango, día o marca de transición cambian.
 */
export function planReschedule(
  periods: readonly {
    readonly label: PeriodLabel;
    readonly range: DateRange;
    readonly status: string;
    readonly startDay?: number;
    readonly isTransition?: boolean;
  }[],
  startDay: number,
): RescheduleChange[] {
  assertStartDay(startDay);
  const sorted = [...periods].sort((a, b) => a.range.start.compare(b.range.start));
  const lastFixed = sorted.map((p) => p.status !== 'DRAFT').lastIndexOf(true);
  const drafts = sorted.slice(lastFixed + 1);
  const anchor = sorted[lastFixed];
  const firstDraft = drafts[0];
  if (!firstDraft) return [];
  let previousEnd = anchor ? anchor.range.end : plusDays(firstDraft.range.start, -1);
  const changes: RescheduleChange[] = [];
  for (const draft of drafts) {
    const start = plusDays(previousEnd, 1);
    const after: PlannedPeriod = {
      label: draft.label,
      range: { start, end: endOf(draft.label, startDay) },
      startDay,
      isTransition: start.day !== startDay,
    };
    const same =
      after.range.start.equals(draft.range.start) &&
      after.range.end.equals(draft.range.end) &&
      (draft.startDay === undefined || draft.startDay === startDay) &&
      (draft.isTransition === undefined || draft.isTransition === after.isTransition);
    if (!same) changes.push({ label: draft.label, before: draft.range, after });
    previousEnd = after.range.end;
  }
  return changes;
}
