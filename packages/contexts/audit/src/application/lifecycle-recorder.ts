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
    const { env, ids, clock, store, audit } = this.deps;
    if (!env.inUnitOfWork()) {
      throw new AuditError(
        'AUDIT_OUTSIDE_UNIT_OF_WORK',
        `${entry.action} must be recorded inside the command's unit of work`,
      );
    }
    const auditLogId = entry.id ?? ids.next();
    await audit.append({ ...entry, id: auditLogId });
    if (steps.length === 0) return;
    const ambient = env.ambient();
    const actorInput = entry.actor ?? ambient.actor;
    if (!actorInput) throw new AuditError('AUDIT_ACTOR_MISSING', `${entry.action} has no actor`);
    const actor = AuditActor.of(actorInput);
    const origin: AuditOrigin =
      entry.origin ??
      (isAuditOrigin(ambient.origin) ? ambient.origin : actor.type === 'USER' ? 'api' : 'system');
    const occurredAt = clock.now();
    const correlationId = ambient.correlationId ?? auditLogId;
    for (const step of steps) {
      const aggregateType = step.aggregateType ?? entry.aggregateType;
      const aggregateId = step.aggregateId ?? entry.aggregateId;
      const sequence = await store.nextSequence(entry.workspaceId, aggregateType, aggregateId);
      const transition = step.kind === 'TRANSITION' ? step : null;
      await store.insert(
        lifecycleEntry({
          id: ids.next(),
          workspaceId: entry.workspaceId,
          aggregateType,
          aggregateId,
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
          correlationId,
          auditLogId,
          eventIds: (step.events ?? []).map((e) => e.eventId),
          eventTypes: (step.events ?? []).map((e) => e.eventType),
          journalEntries: {
            reversed: transition?.journalEntries?.reversed ?? null,
            reversal: transition?.journalEntries?.reversal ?? null,
            posted: transition?.journalEntries?.posted ?? null,
          },
          detailRefs: transition?.detailRefs ?? {},
          changedFields: step.kind === 'ANNOTATION' ? [...new Set(step.changedFields)] : [],
          derived: false,
        }),
      );
    }
  }
}
