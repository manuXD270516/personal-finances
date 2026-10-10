import type { AuditEntry } from '@pf/audit/contracts';
import { LocalDate } from '@pf/shared-kernel';
import { COMMITMENTS_EVENTS } from '../contracts/index.js';
import { OccurrenceClock, seriesEnd, type RecurringDefinition, type RecurringKind } from '../domain/index.js';
import { generateOccurrences } from './generation.js';
import type { OccurrencesService } from './occurrences.service.js';
import type { CommitmentsDeps } from './ports/index.js';
import {
  DEFINITION_AGGREGATE,
  OCCURRENCE_AGGREGATE,
  definitionEntry,
  definitionSteps,
  occurrenceChanges,
  occurrenceEntry,
  occurrenceSteps,
  publishEvent,
  recordOccurrences,
} from './recorder.js';

export interface GenerateWorkspaceResult {
  readonly definitions: number;
  readonly generated: number;
  readonly becameDue: number;
  readonly overdue: number;
  readonly ended: number;
  readonly autoCreated: number;
  readonly autoRejected: number;
  /** Definiciones cuyo procesamiento falló (se reintentan en la próxima ejecución). */
  readonly failed: readonly { readonly definitionId: string; readonly error: string }[];
}

interface TickResult {
  generated: number;
  becameDue: number;
  overdue: number;
  ended: number;
  autoIds: string[];
}

/**
 * Job `commitments.generate-occurrences` por workspace (openspec add-recurrence-engine decisión 7). Por definición, en
 * UNA unidad de trabajo con `FOR UPDATE`: (a) extiende la ventana hasta `hoy + COMMITMENTS_HORIZON_DAYS`, (b) pasa a
 * próxima (`BECOME_DUE`) y a atrasada (`MARK_OVERDUE`) según "hoy" en la zona del workspace, (c) termina la definición
 * cuya serie se agotó. Después, cada creación automática (`AUTO_CREATE`) corre en su propia unidad de trabajo. Repetirlo
 * o ejecutarlo en paralelo es inocuo: la unicidad nominal, `FOR UPDATE` y el índice por `externalRef` impiden duplicados.
 */
export class GenerateOccurrencesService {
  constructor(
    private readonly deps: CommitmentsDeps,
    private readonly occurrencesService: OccurrencesService,
  ) {}

  async runWorkspace(workspaceId: string): Promise<GenerateWorkspaceResult> {
    const { deps } = this;
    const started = Date.now();
    const calendar = await deps.calendar.calendarOf(workspaceId);
    const today = LocalDate.ofInstant(deps.clock.now(), calendar.timeZone);
    const ids = await deps.uow.run(workspaceId, () => deps.definitions.idsNeedingWork(workspaceId));
    const totals = { generated: 0, becameDue: 0, overdue: 0, ended: 0, autoCreated: 0, autoRejected: 0 };
    const failed: { definitionId: string; error: string }[] = [];
    const auto: string[] = [];
    for (const definitionId of ids) {
      try {
        const tick = await this.tick(workspaceId, definitionId, today);
        totals.generated += tick.generated;
        totals.becameDue += tick.becameDue;
        totals.overdue += tick.overdue;
        totals.ended += tick.ended;
        auto.push(...tick.autoIds);
      } catch (err) {
        failed.push({ definitionId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    for (const occurrenceId of auto) {
      try {
        const outcome = await this.occurrencesService.autoMaterialize(workspaceId, occurrenceId);
        if (outcome === 'CREATED') totals.autoCreated += 1;
        if (outcome === 'REJECTED') totals.autoRejected += 1;
      } catch (err) {
        failed.push({ definitionId: occurrenceId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    deps.metrics?.increment('commitments_occurrences_generated_total', {}, totals.generated);
    deps.metrics?.observe?.('commitments_generation_duration_seconds', {}, (Date.now() - started) / 1000);
    return { definitions: ids.length, ...totals, failed };
  }

  private tick(workspaceId: string, definitionId: string, today: LocalDate): Promise<TickResult> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async (): Promise<TickResult> => {
      const result: TickResult = { generated: 0, becameDue: 0, overdue: 0, ended: 0, autoIds: [] };
      const def = await deps.definitions.findById(workspaceId, definitionId, { lock: 'update' });
      if (!def) return result;
      const at = deps.clock.now().toString();

      // (a) ventana deslizante
      if (def.status === 'ACTIVE') {
        const generation = await generateOccurrences(deps, def, { today, by: null });
        result.generated = generation.inserted.length;
      }

      // (b) próximas y atrasadas
      const open = await deps.occurrences.listForDefinition(workspaceId, definitionId, {
        statuses: ['SCHEDULED', 'DUE', 'OVERDUE'],
      });
      const items: { entry: AuditEntry; steps: ReturnType<typeof occurrenceSteps> }[] = [];
      const periodIds = new Map<string, string | null>();
      const periodOf = async (date: string): Promise<string | null> => {
        const key = date.slice(0, 7);
        if (!periodIds.has(key)) {
          periodIds.set(key, (await deps.periods.getPeriodContaining({ workspaceId, date }))?.id ?? null);
        }
        return periodIds.get(key) ?? null;
      };
      for (const occ of open) {
        const s = occ.snapshot;
        const version = def.versionNo(s.definitionVersionNo);
        const next = OccurrenceClock.next({
          status: s.status,
          dueDate: LocalDate.parse(s.dueDate),
          leadDays: version.materialization.leadDays,
          today,
        });
        if (next === null) continue;
        const before = s;
        if (next === 'BECOME_DUE') occ.becomeDue();
        else occ.markOverdue();
        if (!(await deps.occurrences.save(occ))) continue;
        const after = occ.snapshot;
        const aggregate = {
          workspaceId,
          aggregateType: OCCURRENCE_AGGREGATE,
          aggregateId: after.id,
          aggregateVersion: after.version,
        };
        const expected = {
          type: after.expected.type,
          amount: after.expected.amount,
          min: after.expected.min,
          max: after.expected.max,
        };
        const mode = version.materialization.mode;
        const event =
          next === 'BECOME_DUE'
            ? await publishEvent(deps, aggregate, COMMITMENTS_EVENTS.occurrenceDue, {
                workspaceId,
                occurrenceId: after.id,
                definitionId,
                name: def.name,
                kind: def.kind as RecurringKind,
                occurrenceDate: after.occurrenceDate,
                dueDate: after.dueDate,
                expected,
                currency: after.currency,
                requiresApproval: mode === 'PENDING_APPROVAL',
                mode,
                managedBy: def.snapshot.managedBy,
                periodId: await periodOf(after.dueDate),
              })
            : await publishEvent(deps, aggregate, COMMITMENTS_EVENTS.occurrenceChanged, {
                workspaceId,
                occurrenceId: after.id,
                definitionId,
                managedBy: def.snapshot.managedBy,
                transition: 'MARK_OVERDUE',
                status: after.status,
                dueDate: after.dueDate,
                expected,
                currency: after.currency,
                releasedTransactionId: null,
                reason: null,
              });
        items.push({
          entry: occurrenceEntry(
            occ,
            next === 'BECOME_DUE' ? 'became_due' : 'overdue',
            occurrenceChanges(before, after),
          ),
          steps: occurrenceSteps(occ, [event]),
        });
        if (next === 'BECOME_DUE') result.becameDue += 1;
        else result.overdue += 1;
      }
      await recordOccurrences(deps, items);

      // (c) fin de la serie: sin fechas por generar y hoy supera la última. Una definición administrada (suscripción)
      // la termina quien la administra al ejecutar su cancelación programada, para poder deshacerla (N10).
      if (def.status === 'ACTIVE' && def.snapshot.managedBy === 'USER') {
        const end = seriesEnd(def);
        if (end.finite && (end.last === null || today.compare(end.last) > 0)) {
          this.end(def, (end.last ?? today).toString(), at);
          await this.recordEnd(def);
          result.ended = 1;
        }
      }
      if (def.status === 'ACTIVE' || def.persistedVersion !== def.version) {
        if (!(await deps.definitions.save(def))) return result;
      }

      // creaciones automáticas pendientes (cada una en su propia unidad de trabajo)
      if (def.status === 'ACTIVE') {
        for (const occ of open) {
          const s = occ.snapshot;
          const version = def.versionNo(s.definitionVersionNo);
          if (
            version.materialization.mode === 'AUTO_CREATE' &&
            (s.status === 'SCHEDULED' || s.status === 'DUE' || s.status === 'OVERDUE') &&
            OccurrenceClock.autoCreateDue({ dueDate: LocalDate.parse(s.dueDate), today }) &&
            s.lastAutoCreateOn !== today.toString()
          ) {
            result.autoIds.push(s.id);
          }
        }
      }
      return result;
    });
  }

  private end(def: RecurringDefinition, endDate: string, at: string): void {
    def.end({ endDate, at, by: null });
  }

  private async recordEnd(def: RecurringDefinition): Promise<void> {
    const { deps } = this;
    const s = def.snapshot;
    const event = await publishEvent(
      deps,
      {
        workspaceId: s.workspaceId,
        aggregateType: DEFINITION_AGGREGATE,
        aggregateId: s.id,
        aggregateVersion: s.version,
      },
      COMMITMENTS_EVENTS.definitionChanged,
      {
        workspaceId: s.workspaceId,
        definitionId: s.id,
        managedBy: s.managedBy,
        transition: 'END',
        status: s.status,
        kind: s.kind as RecurringKind,
        versionNo: s.currentVersionNo,
        effectiveFrom: null,
        cancelledOccurrenceIds: [],
        reinstatedOccurrenceIds: [],
        rewrittenOccurrenceIds: [],
      },
    );
    await deps.lifecycle.record(
      definitionEntry(def, 'ended', [
        { field: 'status', before: 'ACTIVE', after: 'ENDED' },
        { field: 'endDate', before: null, after: s.endDate },
      ]),
      definitionSteps(def, [event]),
    );
  }
}
