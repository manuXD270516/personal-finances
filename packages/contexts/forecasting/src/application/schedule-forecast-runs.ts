import { FinancialPeriodCalendar, Instant, LocalDate, PeriodCalendar, shiftLabel } from '@pf/shared-kernel';
import { ForecastRun } from '../domain/index.js';
import type { ForecastingDeps } from './ports.js';
import { runChanges, runEntry, runSteps } from './support.js';

export interface ScheduleSummary {
  readonly workspaces: number;
  readonly created: number;
  readonly purged: number;
  /** Workspaces cuya unidad de trabajo falló (se reintentan al día siguiente); solo el nombre del error. */
  readonly failed: number;
  readonly errors: readonly string[];
}

const DAY_MS = 86_400_000;
const SUPERSEDED_RETENTION_DAYS = 30;
const FAILED_RETENTION_DAYS = 90;
const KEPT_PERIODS = 24;

/**
 * `ScheduleForecastRuns` (job `forecasting.schedule`; openspec add-ml-forecasting-service, decisión 13): por workspace y
 * UNO a UNO crea una corrida programada si terminó un periodo financiero posterior al de la última corrida terminada o
 * si la completada vigente supera la antigüedad máxima, y como máximo una por día; luego purga según la retención.
 * No consume eventos (D249: sin consumidores nuevos): detecta el periodo nuevo con el calendario del workspace.
 */
export class ScheduleForecastRuns {
  constructor(private readonly deps: ForecastingDeps) {}

  async run(): Promise<ScheduleSummary> {
    const { deps } = this;
    if (!deps.settings.enabled) return { workspaces: 0, created: 0, purged: 0, failed: 0, errors: [] };
    let workspaces = 0;
    let created = 0;
    let purged = 0;
    const errors: string[] = [];
    for (const { workspaceId } of await deps.workspaces.list()) {
      try {
        if (await this.scheduleWorkspace(workspaceId)) created += 1;
        workspaces += 1;
      } catch (err) {
        errors.push(err instanceof Error ? err.name : typeof err);
      }
    }
    try {
      purged = await this.purge();
    } catch (err) {
      errors.push(err instanceof Error ? err.name : typeof err);
    }
    return { workspaces, created, purged, failed: errors.length, errors };
  }

  /** `true` si creó una corrida programada. */
  scheduleWorkspace(workspaceId: string): Promise<boolean> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const ws = await deps.settingsOf.settingsOf(workspaceId);
      const now = deps.clock.now();
      const today = LocalDate.ofInstant(now, ws.timeZone);
      const lastFinished = shiftLabel(FinancialPeriodCalendar.periodOf(ws.startDay, today).label, -1);
      if (await deps.runs.hasActive(workspaceId)) return false;
      const lastScheduled = await deps.runs.lastScheduledAt(workspaceId);
      if (
        lastScheduled &&
        LocalDate.ofInstant(Instant.parse(lastScheduled), ws.timeZone).toString() === today.toString()
      ) {
        return false;
      }
      const [lastTerminated] = await deps.runs.list(workspaceId, {
        statuses: ['COMPLETED', 'INSUFFICIENT_DATA'],
        limit: 1,
      });
      const completed = await deps.runs.latestCompleted(workspaceId);
      const newPeriod =
        !lastTerminated?.snapshot.asOfPeriod || lastTerminated.snapshot.asOfPeriod < lastFinished;
      const tooOld =
        completed?.snapshot.completedAt !== null &&
        completed?.snapshot.completedAt !== undefined &&
        now.epochMillis - Date.parse(completed.snapshot.completedAt) > deps.settings.maxAgeDays * DAY_MS;
      if (!newPeriod && !tooOld) return false;
      const run = ForecastRun.request({
        id: deps.ids.next(),
        workspaceId,
        trigger: 'SCHEDULED',
        requestedBy: null,
        at: now.toString(),
        reportingCurrency: ws.reportingCurrency,
      });
      if (!(await deps.runs.insertIfNoActive(run))) return false;
      await deps.lifecycle.record(runEntry(run, 'requested', runChanges(null, run.snapshot)), runSteps(run));
      return true;
    });
  }

  /**
   * Retención (decisión 16): conserva la vigente y, por cada uno de los últimos 24 periodos terminados, la última
   * corrida completada hasta el día en que ese periodo empezó (la que lo pronosticó); las demás reemplazadas se purgan a
   * los 30 días y las fallidas o sin datos suficientes a los 90, por el rol de mantenimiento.
   */
  async purge(): Promise<number> {
    const { deps } = this;
    const now = deps.clock.now();
    const candidates = await deps.maintenance.purgeCandidates({
      supersededBeforeIso: now.plusMillis(-SUPERSEDED_RETENTION_DAYS * DAY_MS).toString(),
      failedBeforeIso: now.plusMillis(-FAILED_RETENTION_DAYS * DAY_MS).toString(),
    });
    const byWorkspace = new Map<string, typeof candidates>();
    for (const c of candidates)
      byWorkspace.set(c.workspaceId, [...(byWorkspace.get(c.workspaceId) ?? []), c]);
    let purged = 0;
    for (const [workspaceId, list] of byWorkspace) {
      const keep = await deps.uow.run(workspaceId, async () => {
        const ws = await deps.settingsOf.settingsOf(workspaceId);
        const today = LocalDate.ofInstant(now, ws.timeZone);
        const current = FinancialPeriodCalendar.periodOf(ws.startDay, today).label;
        const history = await deps.runs.list(workspaceId, {
          statuses: ['COMPLETED', 'SUPERSEDED'],
          limit: 500,
        });
        const kept = new Set<string>();
        for (let i = 1; i <= KEPT_PERIODS; i += 1) {
          const start = PeriodCalendar.rangeFor(shiftLabel(current, -i), ws.startDay).start.toString();
          const forecasters = history
            .filter(
              (r) =>
                r.snapshot.completedAt !== null &&
                LocalDate.ofInstant(Instant.parse(r.snapshot.completedAt), ws.timeZone).toString() <= start,
            )
            .sort(
              (a, b) => Date.parse(b.snapshot.completedAt ?? '') - Date.parse(a.snapshot.completedAt ?? ''),
            );
          if (forecasters[0]) kept.add(forecasters[0].id);
        }
        return kept;
      });
      const toDelete = list
        .filter((c) => c.status !== 'SUPERSEDED' || !keep.has(c.runId))
        .map((c) => c.runId);
      if (toDelete.length > 0) {
        purged += await deps.uow.run(workspaceId, () => deps.maintenance.deleteRuns(workspaceId, toDelete));
      }
    }
    return purged;
  }
}
