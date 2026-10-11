/**
 * Calendario financiero: se extrajo al shared-kernel (openspec add-savings-goals N8) para que otros contextos lo usen
 * sin depender de PLANNING. Este módulo conserva los nombres históricos del dominio de PLANNING sin cambio de
 * comportamiento.
 */
export {
  HORIZON_MONTHS,
  MAX_START_DAY,
  MIN_START_DAY,
  PeriodCalendar,
  assertStartDay,
  horizonOf,
  labelOf,
  maxDate,
  minDate,
  parseLabel,
  planCoverage,
  planReschedule,
  plusDays,
  plusMonths,
  shiftLabel,
  type CoverageInput,
  type DateRange,
  type PeriodLabel,
  type PlannedPeriod,
  type RescheduleChange,
} from '@pf/shared-kernel';
