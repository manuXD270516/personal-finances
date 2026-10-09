import { context, propagation } from '@opentelemetry/api';
import type { Generated } from 'kysely';
import { currentRequestContext } from '../api/context/request-context.js';
import { requireSqlExecutor } from '../api/db/command-transaction.js';
import { unitOfWorkKysely } from '../api/db/uow-kysely.js';
import { currentCorrelation, uuidv7 } from '../logging/index.js';
import { isUuid, type DomainEventDraft, type EventEnvelope } from './envelope.js';
import type { EventSchemaRegistry } from './schema-registry.js';

/** Puerto: registra eventos de dominio en la transacción del comando en curso. */
export interface OutboxWriter {
  append<P extends object>(draft: DomainEventDraft<P>): Promise<EventEnvelope<P>>;
  /**
   * Varios eventos con una sola sentencia multi-fila (operaciones masivas, openspec add-bulk-edit): cada uno se valida
   * igual que con `append` y, si alguno es inválido, no se escribe ninguno. Opcional: sin ella el llamador usa `append`.
   */
  appendMany?(drafts: readonly DomainEventDraft[]): Promise<EventEnvelope[]>;
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

function ambientCausation(): string | null {
  const causation = currentRequestContext()?.causationId;
  return isUuid(causation) ? causation : null;
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
    // Sin causa explícita, la del contexto ambiental (evento/job que originó el trabajo, add-audit-trail design §4).
    causationId: draft.causationId ?? ambientCausation(),
    actor: draft.actor ?? { type: 'SYSTEM', id: null },
    // Round-trip JSON: valida exactamente lo que se publicará (p. ej. objetos de valor con toJSON).
    payload: JSON.parse(JSON.stringify(draft.payload)) as P,
  };
}

/** Filas por sentencia en la inserción masiva. */
const INSERT_CHUNK = 500;

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
    await unitOfWorkKysely<OutboxDb>()
      .insertInto('platform.outbox')
      .values(this.row(envelope as EventEnvelope))
      .execute();
    return envelope;
  }

  /** Valida todos los eventos y los inserta en sentencias multi-fila (misma transacción que `append`). */
  async appendMany(drafts: readonly DomainEventDraft[]): Promise<EventEnvelope[]> {
    requireSqlExecutor();
    if (drafts.length === 0) return [];
    const envelopes = drafts.map((d) => buildEnvelope(d));
    for (const e of envelopes) this.schemas.validate(e as EventEnvelope);
    const rows = envelopes.map((e) => this.row(e));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await unitOfWorkKysely<OutboxDb>()
        .insertInto('platform.outbox')
        .values(rows.slice(i, i + INSERT_CHUNK))
        .execute();
    }
    return envelopes;
  }

  private row(envelope: EventEnvelope) {
    const traceContext: Record<string, string> = {};
    propagation.inject(context.active(), traceContext);
    return {
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
    };
  }
}
