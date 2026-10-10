import type { LocalDate } from '../time/local-date.js';

/**
 * Ajuste de fin de semana del vencimiento (FR-COMMITMENTS-005; docs/04 §2.7 reducido a `NONE | PREVIOUS | NEXT` en
 * Phase 3, sin feriados: D130). Solo mueve el VENCIMIENTO; la fecha nominal (clave de la ocurrencia, INV-013) no cambia.
 */
export const WEEKEND_ADJUSTMENTS = ['NONE', 'PREVIOUS', 'NEXT'] as const;
export type WeekendAdjustmentMode = (typeof WEEKEND_ADJUSTMENTS)[number];

export const WeekendAdjustment = {
  /** `PREVIOUS`: sábado y domingo → viernes; `NEXT`: sábado y domingo → lunes. Entre semana no cambia. */
  apply(date: LocalDate, mode: WeekendAdjustmentMode): LocalDate {
    if (mode === 'NONE') return date;
    const dow = date.dayOfWeek();
    if (dow < 6) return date;
    if (mode === 'PREVIOUS') return date.plusDays(dow === 6 ? -1 : -2);
    return date.plusDays(dow === 6 ? 2 : 1);
  },
} as const;
