import type { AuditChangeInput, LifecycleEventRefDto } from '@pf/audit/contracts';
import { DomainError, LocalDate } from '@pf/shared-kernel';
import {
  COMMITMENTS_EVENTS,
  type OccurrencesGeneratedV1,
  type RecurringKindDto,
} from '../contracts/index.js';
import {
  RECURRING_DEFINITION_LIFECYCLE,
  RecurringDefinition,
  RecurringOccurrence,
  RevisionPlanner,
  assertKindAvailable,
  assertRevisionDate,
  buildDefinitionVersion,
  candidates,
  ruleOfSchedule,
  templateOf,
  type Candidate,
  type DefinitionVersion,
  type ScheduleInput,
} from '../domain/index.js';
import { expandRecurrence } from '@pf/shared-kernel';
import { generateOccurrences } from './generation.js';
import type { CommitmentsDeps } from './ports/index.js';
import {
  DEFINITION_AGGREGATE,
  definitionEntry,
  definitionSteps,
  json,
  occurrenceChanges,
  occurrenceEntry,
  occurrenceSteps,
  publishEvent,
  recordOccurrences,
  versionChanges,
} from './recorder.js';
import { resolveTemplate, type AmountInput, type ApiTemplate } from './template-resolver.js';
import { definitionDto, type DefinitionDto } from './views.js';

const notFound = (id: string) =>
  new DomainError('RESOURCE_NOT_FOUND', `recurring definition ${id} not found`);
const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

export interface CreateDefinitionCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly kind: string;
  readonly template: ApiTemplate;
}

/** Cambios de una revisión: reemplazan campos de la plantilla vigente; `schedule` y `materialization` son parciales. */
export interface TemplateChanges {
  readonly accountId?: string | undefined;
  readonly toAccountId?: string | null | undefined;
  readonly amount?: AmountInput | undefined;
  readonly categoryId?: string | null | undefined;
  readonly counterpartyId?: string | null | undefined;
  readonly tagIds?: readonly string[] | undefined;
  readonly paymentMethod?: string | null | undefined;
  readonly schedule?: Partial<ScheduleInput> | undefined;
  readonly materialization?:
    | {
        readonly mode?: string | undefined;
        readonly autoCreateStatus?: string | null | undefined;
        readonly leadDays?: number | undefined;
      }
    | undefined;
}

export interface RevisionResult {
  readonly definition: DefinitionDto;
  readonly rewritten: number;
  readonly cancelled: number;
  readonly created: number;
  readonly reinstated: number;
  readonly resetOverrides: number;
}

interface ChangedIds {
  cancelled: string[];
  reinstated: string[];
  rewritten: string[];
}

/**
 * Casos de uso de la definición recurrente (openspec add-recurrence-engine decisiones 14, 15 y 18): crear, anotar,
 * revisar "esta y las siguientes", pausar, reanudar y terminar. Cada comando corre en UNA unidad de trabajo con
 * `SELECT … FOR UPDATE` de la definición (serializa generación, revisiones y pausas) y deja auditoría + recorrido +
 * outbox en esa misma transacción (INV-029).
 */
export class DefinitionsService {
  constructor(private readonly deps: CommitmentsDeps) {}

  private async todayOf(workspaceId: string): Promise<{ today: LocalDate; at: string }> {
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    const now = this.deps.clock.now();
    return { today: LocalDate.ofInstant(now, calendar.timeZone), at: now.toString() };
  }

  private async load(workspaceId: string, id: string, expectedVersion: number): Promise<RecurringDefinition> {
    const def = await this.deps.definitions.findById(workspaceId, id, { lock: 'update' });
    if (!def) throw notFound(id);
    if (def.version !== expectedVersion) throw preconditionFailed(def.version);
    return def;
  }

  private async persist(def: RecurringDefinition): Promise<void> {
    if (!(await this.deps.definitions.save(def))) {
      throw preconditionFailed((await this.deps.definitions.findById(def.workspaceId, def.id))?.version);
    }
  }

  private definitionChanged(
    def: RecurringDefinition,
    ids: ChangedIds,
    effectiveFrom: string | null,
  ): Promise<LifecycleEventRefDto> {
    const s = def.snapshot;
    const t = def.lastTransition;
    return publishEvent(
      this.deps,
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
        transition: t?.transition ?? 'REVISE',
        status: s.status,
        kind: s.kind as RecurringKindDto,
        versionNo: s.currentVersionNo,
        effectiveFrom,
        cancelledOccurrenceIds: ids.cancelled,
        reinstatedOccurrenceIds: ids.reinstated,
        rewrittenOccurrenceIds: ids.rewritten,
      },
    );
  }

  // ───────────────────────────────────────────────────────────── crear

  /** `CreateDefinition`: valida, crea la versión 1 y genera síncronamente hasta el horizonte (≤ 366 filas). */
  async create(cmd: CreateDefinitionCommand): Promise<DefinitionDto> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const calendarNow = await this.todayOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const kind = assertKindAvailable(cmd.kind);
      const resolved = await resolveTemplate(deps, {
        workspaceId,
        userId: cmd.userId,
        kind,
        template: cmd.template,
      });
      const { today, at } = calendarNow;
      const startDate = String(cmd.template.schedule.startDate);
      const v1 = buildDefinitionVersion({
        kind,
        versionNo: 1,
        effectiveFrom: startDate,
        currency: resolved.currency,
        template: resolved.template,
      });
      const def = RecurringDefinition.create({
        id: deps.ids.next(),
        workspaceId,
        name: cmd.name,
        description: cmd.description,
        notes: cmd.notes,
        kind,
        version1: v1,
        at,
        by: cmd.userId,
      });
      await deps.definitions.insert(def);
      const changed = await this.definitionChanged(
        def,
        { cancelled: [], reinstated: [], rewritten: [] },
        null,
      );
      const generation = await generateOccurrences(deps, def, { today, by: cmd.userId });
      await this.persist(def);
      const s = def.snapshot;
      await deps.lifecycle.record(
        definitionEntry(def, 'created', [
          { field: 'name', before: null, after: s.name },
          { field: 'description', before: null, after: s.description },
          { field: 'notes', before: null, after: s.notes },
          { field: 'kind', before: null, after: s.kind },
          { field: 'managedBy', before: null, after: s.managedBy },
          { field: 'status', before: null, after: s.status },
          ...versionChanges(null, v1),
        ]),
        definitionSteps(def, generation.event ? [changed, generation.event] : [changed]),
      );
      return definitionDto(def, { withVersions: true, generatedCount: generation.inserted.length });
    });
  }

  // ───────────────────────────────────────────────────────────── anotar

  /** `UpdateDefinitionDetails`: nombre, descripción y notas (anotación sin versión de plantilla). */
  async updateDetails(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly definitionId: string;
    readonly expectedVersion: number;
    readonly name?: string | undefined;
    readonly description?: string | null | undefined;
    readonly notes?: string | null | undefined;
  }): Promise<DefinitionDto> {
    const { deps } = this;
    const { at } = await this.todayOf(cmd.workspaceId);
    return deps.uow.run(cmd.workspaceId, async () => {
      const def = await this.load(cmd.workspaceId, cmd.definitionId, cmd.expectedVersion);
      const before = def.snapshot;
      def.annotate(
        {
          ...(cmd.name !== undefined ? { name: cmd.name } : {}),
          ...(cmd.description !== undefined ? { description: cmd.description } : {}),
          ...(cmd.notes !== undefined ? { notes: cmd.notes } : {}),
        },
        at,
        cmd.userId,
      );
      if (def.changedFields.length === 0) return definitionDto(def, { withVersions: true });
      await this.persist(def);
      const after = def.snapshot;
      const changes: AuditChangeInput[] = def.changedFields.map((field) => ({
        field,
        before: before[field as 'name' | 'description' | 'notes'],
        after: after[field as 'name' | 'description' | 'notes'],
      }));
      await deps.lifecycle.record(definitionEntry(def, 'updated', changes), definitionSteps(def, []));
      return definitionDto(def, { withVersions: true });
    });
  }

  // ───────────────────────────────────────────────────────────── revisar

  /**
   * `ReviseDefinition` ("esta y las siguientes", decisión 15): versión `n+1` inmutable desde `effectiveFrom`; las
   * ocurrencias no resueltas desde esa fecha se reescriben (se descartan sus ediciones), se cancelan (`SUPERSEDED`),
   * se reinstauran o se crean; las resueltas y sus transacciones jamás cambian.
   */
  async revise(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly definitionId: string;
    readonly expectedVersion: number;
    readonly effectiveFrom: string;
    readonly changes: TemplateChanges;
  }): Promise<RevisionResult> {
    const { deps } = this;
    const { workspaceId } = cmd;
    const { today, at } = await this.todayOf(workspaceId);
    return deps.uow.run(workspaceId, async () => {
      const def = await this.load(workspaceId, cmd.definitionId, cmd.expectedVersion);
      // Estado terminal ⇒ INVALID_STATUS_TRANSITION antes de cualquier otra validación.
      RECURRING_DEFINITION_LIFECYCLE.transition('REVISE', def.status, def.status);
      let effectiveFrom: LocalDate;
      try {
        effectiveFrom = LocalDate.parse(cmd.effectiveFrom);
      } catch {
        throw new DomainError('VALIDATION_FAILED', 'effectiveFrom must be YYYY-MM-DD').at('/effectiveFrom');
      }
      const existing = await deps.occurrences.listExisting(workspaceId, def.id);
      const first = def.versions[0] as DefinitionVersion;
      assertRevisionDate({
        effectiveFrom,
        seriesStart: LocalDate.parse(first.schedule.startDate),
        currentEffectiveFrom: LocalDate.parse(def.current.effectiveFrom),
        existing,
      });

      const merged = this.mergeTemplate(def, cmd.changes, effectiveFrom);
      const resolved = await resolveTemplate(deps, {
        workspaceId,
        userId: cmd.userId,
        kind: def.kind,
        template: merged,
      });
      const previous = def.current;
      const next = buildDefinitionVersion({
        kind: def.kind,
        versionNo: previous.versionNo + 1,
        effectiveFrom: effectiveFrom.toString(),
        currency: resolved.currency,
        template: resolved.template,
      });
      def.revise(next, at, cmd.userId);
      // La versión nueva se guarda antes de tocar ocurrencias: estas la referencian (FK por versión).
      await this.persist(def);

      const ids: ChangedIds = { cancelled: [], reinstated: [], rewritten: [] };
      let resetOverrides = 0;
      let created = 0;
      const generatedRows: RecurringOccurrence[] = [];
      if (def.status === 'ACTIVE') {
        const through = def.snapshot.generatedThrough ? LocalDate.parse(def.snapshot.generatedThrough) : null;
        const plan = RevisionPlanner.planRevision({ source: def, effectiveFrom, through, existing });
        const loaded = new Map(
          (
            await deps.occurrences.listForDefinition(workspaceId, def.id, { from: effectiveFrom.toString() })
          ).map((o) => [o.id, o] as const),
        );
        const items: {
          entry: ReturnType<typeof occurrenceEntry>;
          steps: ReturnType<typeof occurrenceSteps>;
        }[] = [];
        const apply = async (
          occ: RecurringOccurrence,
          action: string,
          mutate: () => void,
          bucket: string[],
        ): Promise<void> => {
          const before = occ.snapshot;
          mutate();
          if (!(await deps.occurrences.save(occ))) {
            throw new DomainError('CONCURRENCY_CONFLICT', `occurrence ${occ.id} changed concurrently`);
          }
          bucket.push(occ.id);
          items.push({
            entry: occurrenceEntry(occ, action, occurrenceChanges(before, occ.snapshot)),
            steps: occurrenceSteps(occ, []),
          });
        };
        const rewrite = (occ: RecurringOccurrence, candidate: Candidate) => {
          const { resetOverrides: reset } = occ.rewrite({
            dueDate: candidate.dueDate.toString(),
            definitionVersionNo: candidate.versionNo,
            expected: candidate.expected,
            currency: candidate.currency,
          });
          if (reset) resetOverrides += 1;
        };
        for (const { id, candidate } of plan.rewrite) {
          const occ = loaded.get(id);
          if (occ) await apply(occ, 'updated', () => rewrite(occ, candidate), ids.rewritten);
        }
        for (const { id, candidate } of plan.reinstate) {
          const occ = loaded.get(id);
          if (!occ) continue;
          await apply(
            occ,
            'reinstated',
            () => {
              occ.reinstate();
              rewrite(occ, candidate);
            },
            ids.reinstated,
          );
        }
        for (const id of plan.cancel) {
          const occ = loaded.get(id);
          if (occ) await apply(occ, 'cancelled', () => occ.cancel('SUPERSEDED'), ids.cancelled);
        }
        if (plan.insert.length > 0) {
          const rows = plan.insert.map((c) =>
            RecurringOccurrence.generate({
              id: deps.ids.next(),
              workspaceId,
              definitionId: def.id,
              occurrenceDate: c.occurrenceDate.toString(),
              dueDate: c.dueDate.toString(),
              definitionVersionNo: c.versionNo,
              expected: c.expected,
              currency: c.currency,
              at,
            }),
          );
          const inserted = await deps.occurrences.insertIfAbsent(rows);
          created = inserted.length;
          generatedRows.push(...inserted);
        }
        // Hecho de generación: las nuevas y las reinstauradas dentro de la ventana revisada.
        const reinstatedRows = ids.reinstated
          .map((id) => loaded.get(id))
          .filter((o): o is RecurringOccurrence => !!o);
        const announced = [...generatedRows, ...reinstatedRows];
        let generatedRef: LifecycleEventRefDto | null = null;
        if (announced.length > 0 && through) {
          def.touch(at, cmd.userId);
          const dv = def.snapshot;
          const payload: OccurrencesGeneratedV1 = {
            workspaceId,
            definitionId: dv.id,
            definitionVersionNo: dv.currentVersionNo,
            window: { from: effectiveFrom.toString(), to: through.toString() },
            occurrences: announced.map((o) => {
              const s = o.snapshot;
              return {
                occurrenceId: s.id,
                occurrenceDate: s.occurrenceDate,
                dueDate: s.dueDate,
                expected: {
                  type: s.expected.type,
                  amount: s.expected.amount,
                  min: s.expected.min,
                  max: s.expected.max,
                },
                currency: s.currency,
                kind: dv.kind as RecurringKindDto,
              };
            }),
          };
          generatedRef = await publishEvent(
            deps,
            {
              workspaceId,
              aggregateType: DEFINITION_AGGREGATE,
              aggregateId: dv.id,
              aggregateVersion: dv.version,
            },
            COMMITMENTS_EVENTS.occurrencesGenerated,
            payload,
          );
        }
        items.push(
          ...generatedRows.map((o) => ({
            entry: occurrenceEntry(o, 'generated', occurrenceChanges(null, o.snapshot)),
            steps: occurrenceSteps(o, generatedRef ? [generatedRef] : []),
          })),
        );
        await recordOccurrences(deps, items);
        // La ventana futura (más allá de lo ya generado) la cubre el generador con la versión nueva.
        const extra = await generateOccurrences(deps, def, { today, by: cmd.userId });
        created += extra.inserted.length;
      }
      const changed = await this.definitionChanged(def, ids, effectiveFrom.toString());
      await this.persist(def);
      await deps.lifecycle.record(
        definitionEntry(def, 'revised', [
          ...versionChanges(previous, next),
          { field: 'cancelledOccurrences', before: null, after: json(ids.cancelled) },
          { field: 'reinstatedOccurrences', before: null, after: json(ids.reinstated) },
          { field: 'rewrittenOccurrences', before: null, after: json(ids.rewritten) },
          { field: 'resetOverrides', before: null, after: resetOverrides },
        ]),
        definitionSteps(def, [changed], {
          revisionFrom: previous.versionNo,
          revisionTo: next.versionNo,
          // Fecha efectiva de la versión: el recorrido solo admite UUID o enteros en `detailRefs`.
          reason: effectiveFrom.toString(),
        }),
      );
      return {
        definition: definitionDto(def, { withVersions: true }),
        rewritten: ids.rewritten.length,
        cancelled: ids.cancelled.length,
        created,
        reinstated: ids.reinstated.length,
        resetOverrides,
      };
    });
  }

  /** Plantilla vigente + cambios (`schedule` y `materialization` parciales). La cadencia/regla nueva reinicia el ancla. */
  private mergeTemplate(
    def: RecurringDefinition,
    changes: TemplateChanges,
    effectiveFrom: LocalDate,
  ): ApiTemplate {
    const cur = def.current;
    const base = templateOf(cur);
    const moneyOf = (v: string | null) => (v === null ? null : { amount: v, currency: cur.currency });
    const baseSchedule = base.schedule;
    let schedule: ScheduleInput = { ...baseSchedule, ...stripUndefined(changes.schedule ?? {}) };
    const sc = changes.schedule;
    if (sc) {
      const shapeChanged =
        (sc.cadence !== undefined && sc.cadence !== baseSchedule.cadence) ||
        (sc.interval !== undefined && sc.interval !== baseSchedule.interval) ||
        (sc.rrule !== undefined && sc.rrule !== baseSchedule.rrule);
      if (shapeChanged && sc.startDate === undefined) {
        schedule = { ...schedule, startDate: effectiveFrom.toString() };
        // Si la serie reinicia, el máximo restante descuenta las fechas ya producidas antes de la fecha efectiva.
        if (
          sc.maxOccurrences === undefined &&
          baseSchedule.maxOccurrences !== null &&
          baseSchedule.maxOccurrences !== undefined
        ) {
          const produced = expandRecurrence(ruleOfSchedule(cur.schedule), {
            from: LocalDate.parse(cur.schedule.startDate),
            to: effectiveFrom.plusDays(-1),
          }).length;
          const remaining = baseSchedule.maxOccurrences - produced;
          if (remaining < 1) {
            throw new DomainError(
              'RECURRING_INVALID_SCHEDULE',
              'the series has no occurrences left after the effective date',
            ).at('/changes/schedule');
          }
          schedule = { ...schedule, maxOccurrences: remaining };
        }
      }
    }
    return {
      accountId: changes.accountId ?? base.accountId,
      toAccountId: changes.toAccountId !== undefined ? changes.toAccountId : base.toAccountId,
      amount: changes.amount ?? {
        type: cur.amount.type,
        amount: moneyOf(cur.amount.amount),
        min: moneyOf(cur.amount.min),
        max: moneyOf(cur.amount.max),
      },
      categoryId: changes.categoryId !== undefined ? changes.categoryId : base.categoryId,
      counterpartyId: changes.counterpartyId !== undefined ? changes.counterpartyId : base.counterpartyId,
      tagIds: changes.tagIds ?? base.tagIds,
      paymentMethod: changes.paymentMethod !== undefined ? changes.paymentMethod : base.paymentMethod,
      schedule,
      materialization: { ...base.materialization, ...stripUndefined(changes.materialization ?? {}) },
    };
  }

  // ───────────────────────────────────────────────────────────── pausar / reanudar / terminar

  /** `PauseDefinition`: cancela (`PAUSED`) las no resueltas con fecha nominal ≥ hoy; las atrasadas quedan como están. */
  async pause(cmd: DefinitionActionCommand): Promise<DefinitionDto> {
    const { deps } = this;
    const { today, at } = await this.todayOf(cmd.workspaceId);
    return deps.uow.run(cmd.workspaceId, async () => {
      const def = await this.load(cmd.workspaceId, cmd.definitionId, cmd.expectedVersion);
      def.pause(at, cmd.userId);
      const existing = await deps.occurrences.listExisting(cmd.workspaceId, def.id, today.toString());
      const cancelledIds = [...RevisionPlanner.planPause(existing, today)];
      const rows = await this.mutateOccurrences(cmd.workspaceId, def.id, cancelledIds, 'cancelled', (o) =>
        o.cancel('PAUSED'),
      );
      const ids: ChangedIds = { cancelled: rows.map((r) => r.id), reinstated: [], rewritten: [] };
      const changed = await this.definitionChanged(def, ids, null);
      await this.persist(def);
      await deps.lifecycle.record(
        definitionEntry(def, 'paused', [
          { field: 'status', before: 'ACTIVE', after: 'PAUSED' },
          { field: 'cancelledOccurrences', before: null, after: json(ids.cancelled) },
        ]),
        definitionSteps(def, [changed]),
      );
      return definitionDto(def, { withVersions: true });
    });
  }

  /**
   * `ResumeDefinition`: reinstaura las canceladas por la pausa con fecha nominal ≥ hoy (las del intervalo pausado
   * siguen canceladas) y genera las faltantes. Una reinstaurada de una versión anterior se reescribe con la vigente.
   */
  async resume(cmd: DefinitionActionCommand): Promise<DefinitionDto> {
    const { deps } = this;
    const { today, at } = await this.todayOf(cmd.workspaceId);
    return deps.uow.run(cmd.workspaceId, async () => {
      const def = await this.load(cmd.workspaceId, cmd.definitionId, cmd.expectedVersion);
      def.resume(at, cmd.userId);
      const existing = await deps.occurrences.listExisting(cmd.workspaceId, def.id, today.toString());
      const toReinstate = [...RevisionPlanner.planResume(existing, today)];
      const ids: ChangedIds = { cancelled: [], reinstated: [], rewritten: [] };
      const items: Parameters<typeof recordOccurrences>[1][number][] = [];
      const loaded = await deps.occurrences.listForDefinition(cmd.workspaceId, def.id, {
        from: today.toString(),
        statuses: ['CANCELLED'],
      });
      for (const occ of loaded.filter((o) => toReinstate.includes(o.id))) {
        const before = occ.snapshot;
        occ.reinstate();
        const date = LocalDate.parse(occ.occurrenceDate);
        const version = def.versionAt(date);
        if (version.versionNo !== before.definitionVersionNo) {
          const candidate = candidates(def, { from: date, to: date })[0];
          if (candidate) {
            occ.rewrite({
              dueDate: candidate.dueDate.toString(),
              definitionVersionNo: candidate.versionNo,
              expected: candidate.expected,
              currency: candidate.currency,
            });
          } else {
            occ.cancel('SUPERSEDED');
          }
        }
        if (!(await deps.occurrences.save(occ))) {
          throw new DomainError('CONCURRENCY_CONFLICT', `occurrence ${occ.id} changed concurrently`);
        }
        if (occ.status === 'CANCELLED') ids.cancelled.push(occ.id);
        else {
          ids.reinstated.push(occ.id);
        }
        items.push({
          entry: occurrenceEntry(occ, 'reinstated', occurrenceChanges(before, occ.snapshot)),
          steps: occurrenceSteps(occ, []),
        });
      }
      // No se recrean las fechas del intervalo pausado: la generación continúa desde hoy.
      const gt = def.snapshot.generatedThrough ? LocalDate.parse(def.snapshot.generatedThrough) : null;
      if (gt && gt.compare(today.plusDays(-1)) < 0) def.setGeneratedThrough(today.plusDays(-1).toString());
      const generation = await generateOccurrences(deps, def, { today, by: cmd.userId });
      const changed = await this.definitionChanged(def, ids, null);
      await recordOccurrences(deps, items);
      await this.persist(def);
      await deps.lifecycle.record(
        definitionEntry(def, 'resumed', [
          { field: 'status', before: 'PAUSED', after: 'ACTIVE' },
          { field: 'reinstatedOccurrences', before: null, after: json(ids.reinstated) },
        ]),
        definitionSteps(def, generation.event ? [changed, generation.event] : [changed]),
      );
      return definitionDto(def, { withVersions: true, generatedCount: generation.inserted.length });
    });
  }

  /**
   * `EndDefinition`: con `endDate` hoy (o sin fecha) la definición pasa a `ENDED` al instante; con una fecha futura
   * se fija el cierre de la serie y el job la termina al superarla. En ambos casos las no resueltas posteriores a la
   * fecha se cancelan (`ENDED`); las anteriores siguen siendo resolubles.
   */
  async end(
    cmd: DefinitionActionCommand & { readonly endDate?: string | undefined },
  ): Promise<DefinitionDto> {
    const { deps } = this;
    const { today, at } = await this.todayOf(cmd.workspaceId);
    return deps.uow.run(cmd.workspaceId, async () => {
      const def = await this.load(cmd.workspaceId, cmd.definitionId, cmd.expectedVersion);
      RECURRING_DEFINITION_LIFECYCLE.transition('END', def.status, 'ENDED');
      let endDate: LocalDate;
      try {
        endDate = cmd.endDate ? LocalDate.parse(cmd.endDate) : today;
      } catch {
        throw new DomainError('VALIDATION_FAILED', 'endDate must be YYYY-MM-DD').at('/endDate');
      }
      if (endDate.compare(today) < 0) {
        throw new DomainError('VALIDATION_FAILED', 'endDate must not be in the past').at('/endDate');
      }
      const existing = await deps.occurrences.listExisting(cmd.workspaceId, def.id, endDate.toString());
      const cancelIds = [...RevisionPlanner.planEnd(existing, endDate)];
      const rows = await this.mutateOccurrences(cmd.workspaceId, def.id, cancelIds, 'cancelled', (o) =>
        o.cancel('ENDED'),
      );
      const ids: ChangedIds = { cancelled: rows.map((r) => r.id), reinstated: [], rewritten: [] };
      const before = def.snapshot;
      if (endDate.compare(today) <= 0) {
        def.end({ endDate: endDate.toString(), at, by: cmd.userId });
      } else {
        def.scheduleEnd(endDate.toString(), at, cmd.userId);
      }
      const changed = await this.definitionChanged(def, ids, null);
      await this.persist(def);
      await deps.lifecycle.record(
        definitionEntry(def, 'ended', [
          { field: 'status', before: before.status, after: def.status },
          { field: 'endDate', before: before.endDate, after: endDate.toString() },
          { field: 'cancelledOccurrences', before: null, after: json(ids.cancelled) },
        ]),
        definitionSteps(def, [changed]),
      );
      return definitionDto(def, { withVersions: true });
    });
  }

  /** Aplica `mutate` a las ocurrencias dadas (con control optimista) y registra su auditoría y recorrido. */
  private async mutateOccurrences(
    workspaceId: string,
    definitionId: string,
    ids: readonly string[],
    action: string,
    mutate: (occ: RecurringOccurrence) => void,
  ): Promise<RecurringOccurrence[]> {
    if (ids.length === 0) return [];
    const { deps } = this;
    const wanted = new Set(ids);
    const loaded = (await deps.occurrences.listForDefinition(workspaceId, definitionId)).filter((o) =>
      wanted.has(o.id),
    );
    const items: Parameters<typeof recordOccurrences>[1][number][] = [];
    for (const occ of loaded) {
      const before = occ.snapshot;
      mutate(occ);
      if (!(await deps.occurrences.save(occ))) {
        throw new DomainError('CONCURRENCY_CONFLICT', `occurrence ${occ.id} changed concurrently`);
      }
      items.push({
        entry: occurrenceEntry(occ, action, occurrenceChanges(before, occ.snapshot)),
        steps: occurrenceSteps(occ, []),
      });
    }
    await recordOccurrences(deps, items);
    return loaded;
  }
}

export interface DefinitionActionCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly definitionId: string;
  readonly expectedVersion: number;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
