import { context, propagation } from '@opentelemetry/api';
import type { Generated } from 'kysely';
import { requireSqlExecutor } from '../api/db/command-transaction.js';
import { unitOfWorkKysely } from '../api/db/uow-kysely.js';
import { currentCorrelation, uuidv7 } from '../logging/index.js';
import { isUuid, type DomainEventDraft, type EventEnvelope } from './envelope.js';
import type { EventSchemaRegistry } from './schema-registry.js';

/** Puerto: registra eventos de dominio en la transacción del comando en curso. */
export interface OutboxWriter {
  append<P extends object>(draft: DomainEventDraft<P>): Promise<EventEnvelope<P>>;
}

/** Columnas de `platform.outbox` que escribe el productor (rol `pf_app`, solo INSERT). */
interface OutboxTable {
  id: string;
  sequence: Generated<string>;
  workspace_id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: string;
  correlation_id: string;
  envelope: string;
  trace_context: string;
  created_at: Generated<Date>;
}

interface OutboxDb {
  'platform.outbox': OutboxTable;
}

/** Instante RFC 3339 normalizado a UTC con `Z` (el envelope exige `Z`). */
function toUtcInstant(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

/** Construye el envelope v1 completo (sin validar). */
export function buildEnvelope<P extends object>(draft: DomainEventDraft<P>): EventEnvelope<P> {
  const ambient = currentCorrelation()?.correlationId;
  const correlationId = draft.correlationId ?? (isUuid(ambient) ? ambient : uuidv7());
  return {
    eventId: draft.eventId,
    eventType: draft.eventType,
    eventVersion: draft.eventVersion,
    occurredAt: toUtcInstant(draft.occurredAt),
    workspaceId: draft.workspaceId,
    aggregateType: draft.aggregateType,
    aggregateId: draft.aggregateId,
    aggregateVersion: draft.aggregateVersion,
    correlationId,
    causationId: draft.causationId ?? null,
    actor: draft.actor ?? { type: 'SYSTEM', id: null },
    // Round-trip JSON: valida exactamente lo que se publicará (p. ej. objetos de valor con toJSON).
    payload: JSON.parse(JSON.stringify(draft.payload)) as P,
  };
}

/**
 * Escritor del outbox sobre PostgreSQL (openspec add-event-outbox, design §2). Inserta con Kysely sobre la conexión
 * de la `PgUnitOfWork` en curso: misma transacción y mismo contexto RLS que el cambio de estado; si el comando se
 * revierte, el evento desaparece con él. Fuera de una unidad de trabajo falla. Valida el envelope y el schema del
 * evento antes de escribir (`EventContractError` ⇒ el comando falla sin efectos).
 */
export class PgOutboxWriter implements OutboxWriter {
  constructor(private readonly schemas: EventSchemaRegistry) {}

  async append<P extends object>(draft: DomainEventDraft<P>): Promise<EventEnvelope<P>> {
    requireSqlExecutor();
    const envelope = buildEnvelope(draft);
    this.schemas.validate(envelope as EventEnvelope);
    const traceContext: Record<string, string> = {};
    propagation.inject(context.active(), traceContext);
    await unitOfWorkKysely<OutboxDb>()
      .insertInto('platform.outbox')
      .values({
        id: envelope.eventId,
        workspace_id: envelope.workspaceId,
        event_type: envelope.eventType,
        event_version: envelope.eventVersion,
        aggregate_type: envelope.aggregateType,
        aggregate_id: envelope.aggregateId,
        aggregate_version: envelope.aggregateVersion,
        occurred_at: envelope.occurredAt,
        correlation_id: envelope.correlationId,
        envelope: JSON.stringify(envelope),
        trace_context: JSON.stringify(traceContext),
      })
      .execute();
    return envelope;
  }
}
