import { LocalDate } from '@pf/shared-kernel';
import { MONTH_CLOSE_PENDING, type MonthClosePendingV1 } from '../contracts/index.js';
import { plusDays } from '../domain/index.js';
import type { ClosingDeps } from './ports/index.js';

/**
 * Job `planning.close-pending` (openspec add-month-closing decisión 16; requirement "Aviso de cierre pendiente"):
 * por workspace, publica `planning.MonthClosePending.v1` UNA sola vez por periodo en toda su vida cuando sigue
 * `ACTIVE|REOPENED` `delayDays` días después de su fin (zona horaria del workspace). La fila de
 * `planning.close_pending_notice` (`ON CONFLICT DO NOTHING`) es el árbitro: reintentos y ejecuciones concurrentes no
 * duplican, y sobrevive a un cierre y reapertura posteriores. Sin auditoría (no es una acción de usuario).
 */
export class ClosePendingService {
  constructor(private readonly deps: ClosingDeps) {}

  /** Devuelve los periodos para los que se publicó el hecho en esta ejecución. */
  publishDue(workspaceId: string): Promise<readonly string[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const { timeZone } = await this.deps.calendar.calendarOf(workspaceId);
      const now = this.deps.clock.now();
      const today = LocalDate.ofInstant(now, timeZone);
      const delay = this.deps.closePendingDelayDays;
      const published: string[] = [];
      for (const period of await this.deps.periods.list(workspaceId, ['ACTIVE', 'REOPENED'])) {
        const s = period.snapshot;
        if (today.compare(plusDays(period.range.end, delay)) < 0) continue;
        const eventId = this.deps.ids.next();
        if (!(await this.deps.notices.insertIfAbsent({ workspaceId, periodId: s.id, eventId }))) continue;
        const payload: MonthClosePendingV1 = {
          workspaceId,
          periodId: s.id,
          periodLabel: s.label,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          pendingSince: plusDays(period.range.end, 1).toString(),
          delayDays: delay,
        };
        await this.deps.outbox.append({
          eventId,
          eventType: MONTH_CLOSE_PENDING.eventType,
          eventVersion: MONTH_CLOSE_PENDING.eventVersion,
          occurredAt: now.toString(),
          workspaceId,
          aggregateType: 'FinancialPeriod',
          aggregateId: s.id,
          aggregateVersion: s.version,
          payload,
        });
        published.push(s.id);
      }
      return published;
    });
  }
}
