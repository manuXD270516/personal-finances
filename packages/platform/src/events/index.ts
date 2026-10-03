/**
 * `@pf/platform/events` — entrega de eventos de dominio (openspec `platform/event-delivery`, ADR-0008 con enmienda):
 * escritor del outbox sobre la Unit of Work, registro de JSON Schemas de `contracts/events`, relay hacia la cola,
 * consumidores idempotentes con inbox, dead-letter, purga y métricas OTel.
 */
export {
  fullEventName,
  isEventEnvelope,
  isUuid,
  type DomainEventDraft,
  type EventActor,
  type EventEnvelope,
} from './envelope.js';
export { ENVELOPE_V1_SCHEMA_ID, EventContractError, EventSchemaRegistry } from './schema-registry.js';
export { PgOutboxWriter, buildEnvelope, type OutboxWriter } from './outbox-writer.js';
export {
  OUTBOX_NOTIFY_CHANNEL,
  OUTBOX_RELAY_LOCK_KEY,
  OutboxRelay,
  type EventRoute,
  type EventRoutes,
  type OutboxRelayOptions,
} from './relay.js';
export {
  DEFAULT_EVENT_RETRY_LIMIT,
  EventConsumerRuntime,
  EventSubscriptions,
  deadLetterQueueName,
  eventQueueName,
  type DeliveryOutcome,
  type EventConsumerDefinition,
  type EventConsumerRuntimeOptions,
  type EventHandler,
  type EventHandlerContext,
} from './consumers.js';
export { purgeDeliveredEvents, type EventPurgeOptions, type EventPurgeResult } from './purge.js';
export {
  EVENT_METRICS,
  EventDeliveryMetrics,
  countOpenDeadLetters,
  readOutboxBacklog,
  type OutboxBacklog,
  type Queryable,
} from './metrics.js';
