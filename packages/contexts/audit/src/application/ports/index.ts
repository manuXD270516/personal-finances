import type { AuditActionCategory, SecurityActionRules } from '../../domain/audit-action-category.js';
import type { AuditActorInput } from '../../domain/audit-actor.js';
import type { AuditOrigin } from '../../domain/audit-origin.js';
import type { AuditRecord } from '../../domain/audit-record.js';
import type { LifecycleEntry } from '../../domain/lifecycle-entry.js';

/** Contexto ambiental de la petición/job (lo aporta la plataforma: middleware HTTP, jobs, consumidores). */
export interface AuditAmbient {
  readonly actor?: AuditActorInput;
  readonly origin?: AuditOrigin;
  /** UUID de correlación de la petición o del evento que originó el trabajo. */
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly userAgent?: string | null;
  /** IP en claro: solo se usa para su HMAC. */
  readonly clientIp?: string | null;
  readonly idempotencyKey?: string | null;
}

/** Entorno de ejecución: contexto ambiental y si hay una unidad de trabajo (transacción) activa. */
export interface AuditEnvironment {
  ambient(): AuditAmbient;
  inUnitOfWork(): boolean;
}

/** Consulta de una página del log (siempre acotada a un workspace por RLS). */
export interface AuditLogPageQuery {
  readonly workspaceId: string;
  /** Entidades concretas (historial); vacío ⇒ todas las del workspace. */
  readonly entities: readonly { readonly aggregateType: string; readonly aggregateId: string }[];
  /** Solo un tipo de agregado (búsqueda por rango acotada a un tipo). */
  readonly aggregateType?: string;
  /** Solo registros de este actor USER (vista global, openspec add-global-audit-view). */
  readonly actorUserId?: string;
  /** Solo estas acciones exactas (`contexto.entidad.verbo`). */
  readonly actions?: readonly string[];
  readonly origin?: string;
  /** Solo la operación con esta correlación (en una edición masiva, su `bulkOperationId`). */
  readonly correlationId?: string;
  /** Solo eventos de seguridad, o solo cambios de datos (el resto), según el catálogo de acciones. */
  readonly category?: { readonly kind: AuditActionCategory; readonly security: SecurityActionRules };
  /** Rango `[from, to)` en UTC. */
  readonly from?: Date;
  readonly to?: Date;
  readonly ascending: boolean;
  readonly after?: { readonly occurredAt: string; readonly id: string };
  readonly limit: number;
}

/** Almacén append-only de la auditoría: escribe y lee SIEMPRE sobre la transacción de la unidad de trabajo. */
export interface AuditLogStore {
  insert(record: AuditRecord): Promise<void>;
  /** Inserción multi-fila (operaciones masivas). Opcional: sin ella se usa `insert` en bucle. */
  insertMany?(records: readonly AuditRecord[]): Promise<void>;
  page(query: AuditLogPageQuery): Promise<readonly AuditRecord[]>;
}

/** HMAC de la IP del cliente (clave rotativa desde secrets, docs/12 §13.2). */
export interface IpHasher {
  hash(ip: string): Uint8Array;
}

export interface IdGenerator {
  /** UUIDv7. */
  next(): string;
}

/** Zona horaria IANA del workspace (para interpretar `from`/`to` como fechas de negocio). */
export interface WorkspaceTimeZones {
  timeZoneOf(userId: string, workspaceId: string): Promise<string>;
}

/**
 * Nombre visible ACTUAL de los usuarios que figuran como actores en el log del workspace (lo implementa IDENTITY, dueño
 * de `iam.user`; mismo patrón que `WorkspaceTimeZones`). Se invoca dentro de la unidad de trabajo de lectura (contexto
 * RLS del usuario y el workspace) y resuelve todo el lote de una vez. Los ids que no se pueden resolver no aparecen en
 * el mapa.
 */
export interface UserDisplayNames {
  namesOf(workspaceId: string, userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** Unidad de trabajo de lectura con contexto RLS (usuario + workspace). */
export interface ReadUnitOfWork {
  run<T>(ctx: { userId: string; workspaceId: string }, fn: () => Promise<T>): Promise<T>;
}

/**
 * Almacén append-only de `audit.lifecycle_transition` (add-lifecycle-timeline decisión 5): escribe y lee SIEMPRE en la
 * transacción de la unidad de trabajo (RLS del workspace). Nunca actualiza ni borra.
 */
export interface LifecycleStore {
  /** Siguiente `sequence` del agregado (1 si no tiene filas); la serializa el bloqueo del agregado del comando. */
  nextSequence(workspaceId: string, aggregateType: string, aggregateId: string): Promise<number>;
  /** Siguiente `sequence` de cada agregado en una sola consulta (mismo orden que `aggregates`). Opcional. */
  nextSequences?(
    workspaceId: string,
    aggregates: readonly { readonly aggregateType: string; readonly aggregateId: string }[],
  ): Promise<readonly number[]>;
  insert(entry: LifecycleEntry): Promise<void>;
  /** Inserción multi-fila (operaciones masivas). Opcional: sin ella se usa `insert` en bucle. */
  insertMany?(entries: readonly LifecycleEntry[]): Promise<void>;
  /** Filas del agregado ordenadas por `sequence`. */
  entriesOf(
    workspaceId: string,
    aggregateType: string,
    aggregateId: string,
  ): Promise<readonly LifecycleEntry[]>;
}

/** Lectura de la auditoría y escritura de filas derivadas para el job `audit.lifecycle-backfill` (rol pf_worker). */
export interface LifecycleBackfillSource {
  /** Agregados del workspace con auditoría de los tipos dados y SIN filas de recorrido (id ascendente, paginado). */
  aggregatesWithoutLifecycle(input: {
    readonly workspaceId: string;
    readonly aggregateTypes: readonly string[];
    readonly afterAggregateId: string | null;
    readonly limit: number;
  }): Promise<readonly { readonly aggregateType: string; readonly aggregateId: string }[]>;
  /** Registros de auditoría del agregado en orden cronológico. */
  auditOf(workspaceId: string, aggregateType: string, aggregateId: string): Promise<readonly AuditRecord[]>;
}

// ───────────────────────────────────────────── add-global-audit-view: fallos de autorización

/** Directorio mínimo de workspaces para auditar un rechazo de un NO miembro: ¿existe un workspace activo con ese id? */
export interface WorkspaceExistence {
  exists(workspaceId: string): Promise<boolean>;
}

/**
 * Limitador del registro de fallos de autorización: concede a lo sumo UN registro por clave
 * (usuario + workspace + operación) por minuto. Sobre `RATE_LIMIT_STORE` (memoria hoy; Valkey cuando exista su adapter).
 */
export interface DenialThrottle {
  tryAcquire(key: string, now: Date): Promise<boolean>;
}

/** Métricas (baja cardinalidad: solo el código de rechazo) y registro de la falla de escritura. */
export interface DenialObserver {
  /** Cada rechazo, se audite o no (`authz_denied_total`). */
  denied(code: string): void;
  /** La escritura de auditoría del rechazo falló (se traga: el rechazo sigue siendo un 403). */
  writeFailed(error: unknown): void;
}
