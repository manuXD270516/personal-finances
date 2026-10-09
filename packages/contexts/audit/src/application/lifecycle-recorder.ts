import type { Clock } from '@pf/shared-kernel';
import type { AuditEntry, AuditPort, LifecyclePort, LifecycleStepInput } from '../contracts/index.js';
import { AuditActor } from '../domain/audit-actor.js';
import { AuditError } from '../domain/audit-error.js';
import { isAuditOrigin, type AuditOrigin } from '../domain/audit-origin.js';
import { lifecycleEntry } from '../domain/lifecycle-entry.js';
import type { AuditEnvironment, IdGenerator, LifecycleStore } from './ports/index.js';

export interface LifecycleRecorderDeps {
  /** El `AuditPort` compuesto (el mismo que reciben los módulos; los tests pueden envolverlo). */
  readonly audit: AuditPort;
  readonly env: AuditEnvironment;
  readonly store: LifecycleStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * `LifecycleTransitionRecorder` (add-lifecycle-timeline decisiones 5 y 7): implementación de `LifecyclePort`. Dentro
 * de la unidad de trabajo del comando escribe primero la auditoría (con un id propio, para referenciarla) y luego cada
 * paso del flujo en `audit.lifecycle_transition`, con el mismo actor, origen, instante y correlación. AUDIT no conoce
 * las reglas de transición: las valida la máquina del contexto dueño antes de llamar. Cualquier fallo se propaga y la
 * unidad de trabajo revierte el comando completo (INV-029).
 */
export class LifecycleRecorder implements LifecyclePort {
  constructor(private readonly deps: LifecycleRecorderDeps) {}

  async record(entry: AuditEntry, steps: readonly LifecycleStepInput[]): Promise<void> {
    await this.recordMany([{ entry, steps }]);
  }

  /**
   * Varios agregados a la vez (operaciones masivas): primero TODA la auditoría (una sentencia multi-fila si el puerto lo
   * ofrece), luego los pasos con las secuencias de cada agregado asignadas en orden y una sola inserción. El resultado
   * es idéntico a `record` en bucle; solo cambia el número de viajes a la base.
   */
  async recordMany(
    items: readonly { readonly entry: AuditEntry; readonly steps: readonly LifecycleStepInput[] }[],
  ): Promise<void> {
    const { env, ids, clock, store, audit } = this.deps;
    if (items.length === 0) return;
    for (const { entry } of items) {
      if (!env.inUnitOfWork()) {
        throw new AuditError(
          'AUDIT_OUTSIDE_UNIT_OF_WORK',
          `${entry.action} must be recorded inside the command's unit of work`,
        );
      }
    }
    const withIds = items.map(({ entry, steps }) => ({
      entry,
      steps,
      auditLogId: entry.id ?? ids.next(),
    }));
    const auditEntries = withIds.map((i) => ({ ...i.entry, id: i.auditLogId }));
    if (audit.appendMany) await audit.appendMany(auditEntries);
    else for (const e of auditEntries) await audit.append(e);

    // Secuencias: una consulta por lote para los agregados distintos y el resto, en orden, en memoria.
    const ambient = env.ambient();
    const keyOf = (type: string, id: string) => `${type}|${id}`;
    const planned: { item: (typeof withIds)[number]; step: LifecycleStepInput; type: string; id: string }[] =
      [];
    for (const item of withIds) {
      for (const step of item.steps) {
        planned.push({
          item,
          step,
          type: step.aggregateType ?? item.entry.aggregateType,
          id: step.aggregateId ?? item.entry.aggregateId,
        });
      }
    }
    if (planned.length === 0) return;
    const workspaceIds = new Set(planned.map((p) => p.item.entry.workspaceId));
    const next = new Map<string, number>();
    for (const ws of workspaceIds) {
      const distinct = [
        ...new Map(
          planned
            .filter((p) => p.item.entry.workspaceId === ws)
            .map((p) => [keyOf(p.type, p.id), { aggregateType: p.type, aggregateId: p.id }]),
        ).values(),
      ];
      const bases = store.nextSequences
        ? await store.nextSequences(ws, distinct)
        : await Promise.all(distinct.map((a) => store.nextSequence(ws, a.aggregateType, a.aggregateId)));
      distinct.forEach((a, i) =>
        next.set(`${ws}|${keyOf(a.aggregateType, a.aggregateId)}`, bases[i] as number),
      );
    }
    const occurredAt = clock.now();
    const entries = planned.map(({ item, step, type, id }) => {
      const { entry, auditLogId } = item;
      const actorInput = entry.actor ?? ambient.actor;
      if (!actorInput) throw new AuditError('AUDIT_ACTOR_MISSING', `${entry.action} has no actor`);
      const actor = AuditActor.of(actorInput);
      const origin: AuditOrigin =
        entry.origin ??
        (isAuditOrigin(ambient.origin) ? ambient.origin : actor.type === 'USER' ? 'api' : 'system');
      const seqKey = `${entry.workspaceId}|${keyOf(type, id)}`;
      const sequence = next.get(seqKey) as number;
      next.set(seqKey, sequence + 1);
      const transition = step.kind === 'TRANSITION' ? step : null;
      return lifecycleEntry({
        id: ids.next(),
        workspaceId: entry.workspaceId,
        aggregateType: type,
        aggregateId: id,
        sequence,
        kind: step.kind,
        transition: transition?.transition ?? null,
        fromState: transition?.fromState ?? null,
        toState: transition?.toState ?? null,
        machineVersion: transition?.machineVersion ?? null,
        revisionFrom: step.revisionFrom ?? null,
        revisionTo: step.revisionTo ?? null,
        aggregateVersion:
          step.aggregateVersion !== undefined ? step.aggregateVersion : (entry.aggregateVersion ?? null),
        occurredAt,
        actor,
        origin,
        reason: transition
          ? transition.reason !== undefined
            ? transition.reason
            : (entry.reason ?? null)
          : null,
        correlationId: entry.correlationId ?? ambient.correlationId ?? auditLogId,
        auditLogId,
        eventIds: (step.events ?? []).map((e) => e.eventId),
        eventTypes: (step.events ?? []).map((e) => e.eventType),
        journalEntries: {
          reversed: transition?.journalEntries?.reversed ?? null,
          reversal: transition?.journalEntries?.reversal ?? null,
          posted: transition?.journalEntries?.posted ?? null,
        },
        detailRefs: step.detailRefs ?? {},
        changedFields: step.kind === 'ANNOTATION' ? [...new Set(step.changedFields)] : [],
        derived: false,
      });
    });
    if (store.insertMany) await store.insertMany(entries);
    else for (const e of entries) await store.insert(e);
  }
}
