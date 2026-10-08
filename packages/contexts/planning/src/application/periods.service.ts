import type { AuditChangeInput, AuditEntry, AuditPort, LifecycleEventRefDto } from '@pf/audit/contracts';
import { DomainError, LocalDate } from '@pf/shared-kernel';
import { PERIOD_ACTIVATED, type FinancialPeriodDto, type PeriodActivatedV1 } from '../contracts/index.js';
import {
  FINANCIAL_PERIOD_LIFECYCLE,
  FinancialPeriod,
  horizonOf,
  planCoverage,
  planReschedule,
  type DateRange,
} from '../domain/index.js';
import { toPeriodDto } from './period-view.js';
import type { PlanningDeps } from './ports/index.js';

const AGGREGATE = 'FinancialPeriod';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `financial period ${id} not found`);
/** 412 con la versión vigente (`currentVersion`, docs/10 §6). */
const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

export interface EnsurePeriodsResult {
  /** Periodos insertados por esta ejecución (los que `ON CONFLICT DO NOTHING` descartó no figuran). */
  readonly created: readonly FinancialPeriodDto[];
  /** Periodos desde el que contiene hoy hasta el que contiene `through` (o hasta el último), por inicio ascendente. */
  readonly periods: readonly FinancialPeriodDto[];
}

/**
 * Casos de uso de periodos financieros (openspec add-financial-periods decisiones 5–9, 12 y 15). Cada ejecución corre
 * en UNA unidad de trabajo con el candado consultivo del workspace: activación de los DRAFT iniciados → recálculo de
 * los DRAFT si cambió el día de inicio → creación de los que falten (cobertura retroactiva mientras no haya cierres,
 * anticipación y tope de 24 meses), con auditoría + recorrido (INV-029), outbox y participantes de creación en la
 * MISMA transacción.
 */
export class PeriodsService {
  constructor(
    private readonly deps: PlanningDeps,
    private readonly audit: AuditPort = deps.audit,
  ) {}

  /**
   * `EnsurePeriods(through?)`: job `planning.ensure-periods`, consumidores de IDENTITY/LEDGER y comando
   * `POST …/periods`. Idempotente. `through` (comando) admite como máximo hoy + 24 meses (`VALIDATION_FAILED`).
   */
  async ensurePeriods(input: {
    readonly workspaceId: string;
    readonly through?: string | null;
  }): Promise<EnsurePeriodsResult> {
    const { workspaceId } = input;
    const requested = input.through ? parseDate(input.through, '/through') : null;
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    return this.deps.uow.run(workspaceId, async () => {
      await this.deps.periods.lockWorkspace(workspaceId);
      const now = this.deps.clock.now();
      const at = now.toString();
      const today = LocalDate.ofInstant(now, calendar.timeZone);
      if (requested && requested.compare(horizonOf(today)) > 0) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `through must be at most ${horizonOf(today).toString()} (today + 24 months)`,
        ).at('/through');
      }
      await this.activateDue(workspaceId, today, at);
      await this.reschedule(workspaceId, calendar.fiscalMonthStartDay);

      const existing = await this.deps.periods.list(workspaceId);
      const closedAny = existing.some((p) => p.status === 'CLOSED' || p.status === 'REOPENED');
      const activity = await this.deps.activity.getActivityRange(workspaceId);
      const first = existing[0];
      // Cobertura retroactiva solo mientras no haya cierres (decisión 5; docs/33 D62): después, el primer periodo
      // queda fijo y lo anterior lo protege el bloqueo del primer cierre (add-month-closing).
      let from = today;
      if (first) from = first.range.start.compare(today) < 0 ? first.range.start : today;
      if (activity && !closedAny) {
        const min = LocalDate.parse(activity.minEntryDate);
        if (min.compare(from) < 0) from = min;
      }
      let through = today;
      if (activity) {
        const max = LocalDate.parse(activity.maxEntryDate);
        if (max.compare(through) > 0) through = max;
      }
      if (requested && requested.compare(through) > 0) through = requested;

      const plan = planCoverage({
        existing: existing.map((p) => ({ label: p.label, range: p.range })),
        startDay: calendar.fiscalMonthStartDay,
        today,
        from,
        through,
        lookahead: Math.max(1, this.deps.lookahead),
      });
      const created: FinancialPeriodDto[] = [];
      for (const planned of plan) {
        const period = FinancialPeriod.create({
          id: this.deps.ids.next(),
          workspaceId,
          planned,
          today,
          at,
        });
        if (!(await this.deps.periods.insertIfAbsent(period))) continue;
        await this.recordCreated(period);
        const dto = toPeriodDto(period, today);
        // Participantes síncronos en la misma unidad de trabajo (decisión 15): un fallo revierte la creación.
        for (const hook of this.deps.onPeriodCreated ?? [])
          await hook.onPeriodCreated({ workspaceId, period: dto });
        created.push(dto);
      }

      const periods = (await this.deps.periods.list(workspaceId))
        .filter((p) => p.range.end.compare(today) >= 0)
        .filter((p) => requested === null || p.range.start.compare(requested) <= 0)
        .map((p) => toPeriodDto(p, today));
      return { created, periods };
    });
  }

  /**
   * Consumidor de `ledger.JournalEntryPosted.v1` (decisión 6c): solo ejecuta `EnsurePeriods` si `entryDate` cae fuera
   * del rango ya cubierto (comparación barata contra el primer inicio y el último fin). Devuelve si actuó.
   */
  async onJournalEntryPosted(input: {
    readonly workspaceId: string;
    readonly entryDate: string;
  }): Promise<boolean> {
    const covered = await this.deps.uow.run(input.workspaceId, () =>
      this.deps.periods.coveredRange(input.workspaceId),
    );
    if (covered && covered.start <= input.entryDate && input.entryDate <= covered.end) return false;
    await this.ensurePeriods({ workspaceId: input.workspaceId });
    return true;
  }

  /** `ActivatePeriod` manual (EDITOR/OWNER, `If-Match`): `PERIOD_NOT_STARTED` si su inicio es posterior a hoy. */
  async activatePeriod(input: {
    readonly workspaceId: string;
    readonly periodId: string;
    readonly expectedVersion: number;
  }): Promise<FinancialPeriodDto> {
    const { workspaceId, periodId } = input;
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    return this.deps.uow.run(workspaceId, async () => {
      await this.deps.periods.lockWorkspace(workspaceId);
      const period = await this.deps.periods.findById(workspaceId, periodId, { lock: 'update' });
      if (!period) throw notFound(periodId);
      if (period.version !== input.expectedVersion) throw preconditionFailed(period.version);
      const now = this.deps.clock.now();
      const today = LocalDate.ofInstant(now, calendar.timeZone);
      await this.activate(period, today, now.toString(), 'MANUAL');
      return toPeriodDto(period, today);
    });
  }

  /** `ActivateDuePeriods` (decisión 7): todo DRAFT con inicio ≤ hoy pasa a ACTIVE (actualización condicional). */
  private async activateDue(workspaceId: string, today: LocalDate, at: string): Promise<void> {
    for (const period of await this.deps.periods.list(workspaceId, ['DRAFT'])) {
      if (period.range.start.compare(today) <= 0) await this.activate(period, today, at, 'AUTOMATIC');
    }
  }

  private async activate(
    period: FinancialPeriod,
    today: LocalDate,
    at: string,
    activation: PeriodActivatedV1['activation'],
  ): Promise<void> {
    period.activate(today, at);
    if (!(await this.deps.periods.update(period))) {
      throw preconditionFailed((await this.deps.periods.findById(period.workspaceId, period.id))?.version);
    }
    const s = period.snapshot;
    const payload: PeriodActivatedV1 = {
      workspaceId: s.workspaceId,
      periodId: s.id,
      label: s.label,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      startDay: s.startDay,
      isTransition: s.isTransition,
      activatedAt: s.activatedAt ?? at,
      activation,
    };
    const event = await this.publish(period, payload);
    await this.record(
      period,
      {
        workspaceId: s.workspaceId,
        action: 'planning.period.activated',
        aggregateType: AGGREGATE,
        aggregateId: s.id,
        aggregateVersion: s.version,
        changes: [
          { field: 'status', before: 'DRAFT', after: 'ACTIVE' },
          { field: 'activation', before: null, after: activation },
        ],
      },
      [event],
    );
  }

  /** `RescheduleDraftPeriods` (decisión 9; docs/33 D61): DRAFT recalculados en sitio conservando id y etiqueta. */
  private async reschedule(workspaceId: string, startDay: number): Promise<void> {
    const periods = await this.deps.periods.list(workspaceId);
    const changes = planReschedule(
      periods.map((p) => ({
        label: p.label,
        range: p.range,
        status: p.status,
        startDay: p.snapshot.startDay,
        isTransition: p.snapshot.isTransition,
      })),
      startDay,
    );
    for (const change of changes) {
      const period = periods.find((p) => p.label === change.label);
      if (!period) continue;
      const before = period.snapshot;
      period.reschedule(change.after);
      if (!(await this.deps.periods.update(period))) throw preconditionFailed();
      const after = period.snapshot;
      const fields: AuditChangeInput[] = [
        { field: 'periodStart', before: before.periodStart, after: after.periodStart },
        { field: 'periodEnd', before: before.periodEnd, after: after.periodEnd },
        { field: 'range', before: rangeJson(before), after: rangeJson(after) },
      ];
      if (before.startDay !== after.startDay)
        fields.push({ field: 'startDay', before: before.startDay, after: after.startDay });
      if (before.isTransition !== after.isTransition)
        fields.push({ field: 'isTransition', before: before.isTransition, after: after.isTransition });
      await this.deps.lifecycle.record(
        {
          workspaceId,
          action: 'planning.period.rescheduled',
          aggregateType: AGGREGATE,
          aggregateId: after.id,
          aggregateVersion: after.version,
          changes: fields,
        },
        [{ kind: 'ANNOTATION', changedFields: fields.map((f) => f.field) }],
      );
    }
  }

  private recordCreated(period: FinancialPeriod): Promise<void> {
    const s = period.snapshot;
    return this.record(
      period,
      {
        workspaceId: s.workspaceId,
        action: 'planning.period.created',
        aggregateType: AGGREGATE,
        aggregateId: s.id,
        aggregateVersion: s.version,
        changes: [
          { field: 'label', before: null, after: s.label },
          { field: 'periodStart', before: null, after: s.periodStart },
          { field: 'periodEnd', before: null, after: s.periodEnd },
          { field: 'startDay', before: null, after: s.startDay },
          { field: 'isTransition', before: null, after: s.isTransition },
          { field: 'status', before: null, after: s.status },
        ],
      },
      [],
    );
  }

  /** Auditoría + paso de la máquina en la misma unidad de trabajo (`LifecyclePort`, add-lifecycle-timeline). */
  private record(
    period: FinancialPeriod,
    entry: AuditEntry,
    events: readonly LifecycleEventRefDto[],
  ): Promise<void> {
    const t = period.lastTransition;
    if (!t) return this.audit.append(entry);
    return this.deps.lifecycle.record(entry, [
      {
        kind: 'TRANSITION',
        transition: t.transition,
        fromState: t.from,
        toState: t.to,
        machineVersion: FINANCIAL_PERIOD_LIFECYCLE.version,
        events,
      },
    ]);
  }

  private async publish(period: FinancialPeriod, payload: PeriodActivatedV1): Promise<LifecycleEventRefDto> {
    const eventId = this.deps.ids.next();
    await this.deps.outbox.append({
      eventId,
      eventType: PERIOD_ACTIVATED.eventType,
      eventVersion: PERIOD_ACTIVATED.eventVersion,
      occurredAt: this.deps.clock.now().toString(),
      workspaceId: period.workspaceId,
      aggregateType: AGGREGATE,
      aggregateId: period.id,
      aggregateVersion: period.version,
      payload,
    });
    return { eventId, eventType: `${PERIOD_ACTIVATED.eventType}.v${PERIOD_ACTIVATED.eventVersion}` };
  }
}

/** Rango como JSON canónico (la auditoría solo admite valores planos; docs/31 D19). */
const rangeJson = (s: { readonly periodStart: string; readonly periodEnd: string }) =>
  JSON.stringify({ periodStart: s.periodStart, periodEnd: s.periodEnd });

export function parseDate(value: string, pointer: string): LocalDate {
  try {
    return LocalDate.parse(value);
  } catch (err) {
    if (err instanceof DomainError) throw new DomainError('VALIDATION_FAILED', err.message).at(pointer);
    throw err;
  }
}

export type { DateRange };
