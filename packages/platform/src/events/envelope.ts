/**
 * Envelope v1 de los eventos de integración (ARCHITECTURE §7, `contracts/events/envelope.v1.schema.json`). Su forma
 * solo cambia por ADR. El nombre completo de un evento es `${eventType}.v${eventVersion}`.
 */
export interface EventActor {
  readonly type: 'USER' | 'SYSTEM' | 'SERVICE';
  readonly id: string | null;
}

export interface EventEnvelope<P extends object = Record<string, unknown>> {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: string;
  readonly workspaceId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly actor: EventActor;
  readonly payload: P;
}

/**
 * Lo que aporta un productor. `correlationId` sale del contexto de correlación si no viene; `causationId` es `null` y
 * `actor` es `{ type: SYSTEM, id: null }` por defecto.
 */
export interface DomainEventDraft<P extends object = Readonly<Record<string, unknown>>> {
  /** UUIDv7 generado por el productor (clave de idempotencia del consumidor). */
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  /** Instante RFC 3339; se normaliza a UTC con sufijo `Z`. */
  readonly occurredAt: string;
  readonly workspaceId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: P;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly actor?: EventActor;
}

/** Nombre completo `<context>.<EventName>.v<N>`. */
export const fullEventName = (e: { eventType: string; eventVersion: number }): string =>
  `${e.eventType}.v${e.eventVersion}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/**
 * Chequeo mínimo del lado consumidor (tolerant reader, docs/11 §4): solo exige lo que la entrega necesita (identidad,
 * workspace, agregado). El payload no se valida estrictamente para tolerar cambios aditivos.
 */
export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<EventEnvelope>;
  return (
    isUuid(v.eventId) &&
    isUuid(v.workspaceId) &&
    isUuid(v.aggregateId) &&
    typeof v.eventType === 'string' &&
    Number.isInteger(v.eventVersion) &&
    Number.isInteger(v.aggregateVersion) &&
    typeof v.payload === 'object' &&
    v.payload !== null
  );
}
