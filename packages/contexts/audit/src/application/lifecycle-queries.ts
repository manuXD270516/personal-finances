import { DomainError } from '@pf/shared-kernel';
import {
  LIFECYCLE_AGGREGATE_TYPES,
  type LifecycleAggregateType,
  type LifecycleDto,
  type LifecycleItemDto,
  type LifecycleMachineDto,
  type LifecycleQuery,
} from '../contracts/index.js';
import { isUuid } from '../domain/audit-actor.js';
import {
  compareLifecycleEntries,
  historyComplete,
  lifecyclePath,
  type LifecycleEntry,
} from '../domain/lifecycle-entry.js';
import type { LifecycleStore, ReadUnitOfWork } from './ports/index.js';

export interface LifecycleQueriesDeps {
  readonly uow: ReadUnitOfWork;
  readonly store: LifecycleStore;
  /** Máquinas declaradas por los contextos dueños (las aporta el composition root desde sus módulos). */
  readonly machines: readonly LifecycleMachineDto[];
}

export const isLifecycleAggregateType = (v: unknown): v is LifecycleAggregateType =>
  typeof v === 'string' && (LIFECYCLE_AGGREGATE_TYPES as readonly string[]).includes(v);

/** Proyección pública de una fila (contrato `LifecycleTransition` / `LifecycleAnnotation`). */
export function toLifecycleItemDto(e: LifecycleEntry): LifecycleItemDto {
  const actor = {
    type: e.actor.type,
    id: e.actor.type === 'USER' ? e.actor.userId : e.actor.process,
    displayName: null,
  };
  const events = [...e.eventTypes];
  if (e.kind === 'ANNOTATION') {
    return {
      sequence: e.sequence,
      kind: 'ANNOTATION',
      occurredAt: e.occurredAt.toString(),
      actor,
      origin: e.origin,
      changedFields: [...e.changedFields],
      detailRefs: { ...e.detailRefs },
      revisionFrom: e.revisionFrom,
      revisionTo: e.revisionTo,
      aggregateVersion: e.aggregateVersion,
      events,
      auditLogId: e.auditLogId,
      derived: e.derived,
    };
  }
  return {
    sequence: e.sequence,
    kind: 'TRANSITION',
    transition: e.transition ?? '',
    fromState: e.fromState,
    toState: e.toState ?? '',
    machineVersion: e.machineVersion ?? 1,
    occurredAt: e.occurredAt.toString(),
    actor,
    origin: e.origin,
    reason: e.reason,
    revisionFrom: e.revisionFrom,
    revisionTo: e.revisionTo,
    aggregateVersion: e.aggregateVersion,
    journalEntries: { ...e.journalEntries },
    detailRefs: { ...e.detailRefs },
    events,
    auditLogId: e.auditLogId,
    derived: e.derived,
  };
}

/**
 * Query `GetLifecycle` (add-lifecycle-timeline decisión 7): transiciones y anotaciones del agregado (RLS), ordenadas por
 * `sequence`, con el camino de estados y la máquina del contexto dueño. AUDIT no hace joins cross-schema: los montos por
 * revisión los compone el contexto dueño con sus queries públicas.
 */
export class LifecycleQueries implements LifecycleQuery {
  private readonly machines: ReadonlyMap<string, LifecycleMachineDto>;

  constructor(private readonly deps: LifecycleQueriesDeps) {
    this.machines = new Map(deps.machines.map((m) => [m.aggregateType, m]));
  }

  machineOf(aggregateType: LifecycleAggregateType): LifecycleMachineDto {
    const machine = this.machines.get(aggregateType);
    if (!machine) throw new DomainError('RESOURCE_NOT_FOUND', `no lifecycle machine for ${aggregateType}`);
    return machine;
  }

  async lifecycleOf(input: Parameters<LifecycleQuery['lifecycleOf']>[0]): Promise<LifecycleDto> {
    if (!isLifecycleAggregateType(input.aggregateType) || !isUuid(input.aggregateId)) {
      throw new DomainError('VALIDATION_FAILED', 'invalid lifecycle reference');
    }
    const machine = this.machineOf(input.aggregateType);
    const entries = await this.deps.uow.run({ userId: input.userId, workspaceId: input.workspaceId }, () =>
      this.deps.store.entriesOf(input.workspaceId, input.aggregateType, input.aggregateId),
    );
    const path = lifecyclePath(entries);
    return {
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      currentState: input.currentState ?? path.at(-1) ?? null,
      path,
      historyComplete: historyComplete(entries),
      machine,
      items: [...entries].sort(compareLifecycleEntries).map(toLifecycleItemDto),
    };
  }
}
