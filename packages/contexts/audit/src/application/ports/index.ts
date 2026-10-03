import type { AuditActorInput } from '../../domain/audit-actor.js';
import type { AuditOrigin } from '../../domain/audit-origin.js';
import type { AuditRecord } from '../../domain/audit-record.js';

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

/** Unidad de trabajo de lectura con contexto RLS (usuario + workspace). */
export interface ReadUnitOfWork {
  run<T>(ctx: { userId: string; workspaceId: string }, fn: () => Promise<T>): Promise<T>;
}
