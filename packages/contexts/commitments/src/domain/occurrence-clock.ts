import type { LocalDate } from '@pf/shared-kernel';
import type { OccurrenceStatus, OccurrenceTransition } from './lifecycle.js';

/**
 * Transiciones por fecha (design decisión 7): próxima y atrasada, evaluadas con "hoy" en la zona horaria del workspace
 * (`LocalDate.ofInstant(now, tz)`, RISK-020: nunca la zona del proceso). Cada evaluación devuelve a lo sumo UNA
 * transición; como el estado cambia, repetirla no produce una segunda (exactamente una vez).
 */
export const OccurrenceClock = {
  next(input: {
    readonly status: OccurrenceStatus;
    readonly dueDate: LocalDate;
    readonly leadDays: number;
    readonly today: LocalDate;
  }): Extract<OccurrenceTransition, 'BECOME_DUE' | 'MARK_OVERDUE'> | null {
    const { status, dueDate, leadDays, today } = input;
    if (status !== 'SCHEDULED' && status !== 'DUE') return null;
    if (today.compare(dueDate) > 0) return 'MARK_OVERDUE';
    if (status === 'SCHEDULED' && today.compare(dueDate.plusDays(-leadDays)) >= 0) return 'BECOME_DUE';
    return null;
  },

  /** ¿Debe crearse ya la transacción en `AUTO_CREATE`? (`dueDate ≤ hoy`, sin resolver). */
  autoCreateDue(input: { readonly dueDate: LocalDate; readonly today: LocalDate }): boolean {
    return input.dueDate.compare(input.today) <= 0;
  },

  /** Fecha de negocio por omisión al aprobar: `min(vencimiento, hoy)` (design decisión 11). */
  defaultBusinessDate(dueDate: LocalDate, today: LocalDate): LocalDate {
    return dueDate.compare(today) < 0 ? dueDate : today;
  },
} as const;
