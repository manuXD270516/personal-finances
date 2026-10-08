import type { LocalDate } from '@pf/shared-kernel';
import type { FinancialPeriodDto } from '../contracts/index.js';
import type { FinancialPeriod } from '../domain/index.js';

/** `FinancialPeriod` del contrato; `pendingClosure` se deriva de hoy en la zona del workspace (docs/33 D60). */
export function toPeriodDto(period: FinancialPeriod, today: LocalDate): FinancialPeriodDto {
  const s = period.snapshot;
  return {
    id: s.id,
    label: s.label,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    status: s.status,
    startDay: s.startDay,
    isTransition: s.isTransition,
    pendingClosure: period.pendingClosure(today),
    closeCount: s.closeCount,
    reopenCount: s.reopenCount,
    latestCloseNo: s.latestCloseNo,
    version: s.version,
    createdAt: s.createdAt ?? '1970-01-01T00:00:00.000Z',
    activatedAt: s.activatedAt,
  };
}
