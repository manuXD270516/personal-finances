import type {
  AuditActorDto,
  AuditChangeInput,
  AuditEntry,
  LifecycleEventRefDto,
  LifecycleStepInput,
} from '@pf/audit/contracts';
import { IMPORT_JOB_AGGREGATE, IMPORT_JOB_LIFECYCLE, type ImportJob } from '../domain/index.js';
import type { ImportsDeps } from './ports/index.js';

/**
 * Auditoría + recorrido de un cambio del job en la MISMA unidad de trabajo (INV-029; `audit/lifecycle-timeline`
 * «Recorrido de una importación»): la transición declarada que aplicó la última operación del agregado, o una
 * anotación con los campos que cambiaron. El actor es el del contexto: el usuario en la API y el proceso (`WORKER`,
 * que el recorrido muestra como sistema) en el worker. Nunca se auditan celdas, descripciones ni montos de filas (NFR-SEC-015).
 */

/** El worker audita con su actor de proceso del contexto (`WORKER`): no se fija uno aquí. */
export const SYSTEM_ACTOR: AuditActorDto | undefined = undefined;

export function jobSteps(
  job: ImportJob,
  events: readonly LifecycleEventRefDto[] = [],
  extra: { readonly detailRefs?: Record<string, string | number>; readonly reason?: string | null } = {},
): LifecycleStepInput[] {
  const t = job.lastTransition;
  if (t) {
    return [
      {
        kind: 'TRANSITION',
        transition: t.transition,
        fromState: t.from,
        toState: t.to,
        machineVersion: IMPORT_JOB_LIFECYCLE.version,
        events,
        ...(extra.detailRefs ? { detailRefs: extra.detailRefs } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
      },
    ];
  }
  return [
    {
      kind: 'ANNOTATION',
      changedFields: [...job.changedFields],
      events,
      ...(extra.detailRefs ? { detailRefs: extra.detailRefs } : {}),
    },
  ];
}

export interface RecordOptions {
  readonly changes?: readonly AuditChangeInput[];
  readonly events?: readonly LifecycleEventRefDto[];
  readonly actor?: AuditActorDto | undefined;
  readonly reason?: string | null;
  readonly detailRefs?: Record<string, string | number>;
}

/** Registra la entrada de auditoría y el paso del recorrido de la última operación del job. */
export async function recordJob(
  deps: ImportsDeps,
  job: ImportJob,
  action: string,
  options: RecordOptions = {},
): Promise<void> {
  const s = job.state;
  const entry: AuditEntry = {
    workspaceId: s.workspaceId,
    action: `imports.import.${action}`,
    aggregateType: IMPORT_JOB_AGGREGATE,
    aggregateId: s.id,
    aggregateVersion: s.version,
    changes: options.changes ?? [],
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.actor ? { actor: options.actor } : {}),
  };
  await deps.lifecycle.record(
    entry,
    jobSteps(job, options.events ?? [], {
      ...(options.detailRefs ? { detailRefs: options.detailRefs } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    }),
  );
}

/** Publica un hecho del job en el outbox (misma unidad de trabajo) y devuelve su referencia para el recorrido. */
export async function publishJobEvent(
  deps: ImportsDeps,
  job: ImportJob,
  kind: { readonly eventType: string; readonly eventVersion: number },
  payload: Record<string, unknown>,
): Promise<LifecycleEventRefDto> {
  const s = job.state;
  const eventId = deps.ids.next();
  await deps.outbox.append({
    eventId,
    eventType: kind.eventType,
    eventVersion: kind.eventVersion,
    occurredAt: deps.clock.now().toString(),
    workspaceId: s.workspaceId,
    aggregateType: IMPORT_JOB_AGGREGATE,
    aggregateId: s.id,
    aggregateVersion: s.version,
    payload: { workspaceId: s.workspaceId, importJobId: s.id, accountId: s.accountId, ...payload },
  });
  return { eventId, eventType: `${kind.eventType}.v${kind.eventVersion}` };
}
