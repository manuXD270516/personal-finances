import { createHmac, randomBytes } from 'node:crypto';
import {
  PgUnitOfWork,
  currentRequestContext,
  currentSqlExecutor,
  parseCursorKeys,
  unitOfWorkKysely,
  uuidFromOpaqueId,
} from '@pf/platform/api';
import { currentCorrelation, uuidv7 } from '@pf/platform/logging';
import { Instant } from '@pf/shared-kernel';
import { sql, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type {
  AuditAmbient,
  AuditEnvironment,
  AuditLogPageQuery,
  AuditLogStore,
  IdGenerator,
  IpHasher,
  ReadUnitOfWork,
  WorkspaceExistence,
} from '../application/ports/index.js';
import { AuditRecord } from '../domain/audit-record.js';
import { isAuditOrigin } from '../domain/audit-origin.js';
import type { AuditChange } from '../domain/change-set.js';

/** Columnas de `audit.audit_log` (migración 20261003160000_audit_audit_log.sql). */
interface AuditLogTable {
  id: string;
  occurred_at: Date;
  workspace_id: string;
  actor_type: 'USER' | 'SYSTEM' | 'WORKER';
  actor_user_id: string | null;
  actor_process: string | null;
  action: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number | null;
  changes: AuditChange[];
  reason: string | null;
  origin: string;
  correlation_id: string;
  request_id: string | null;
  idempotency_key: string | null;
  client_ip_hash: Buffer | null;
  user_agent: string | null;
}

interface AuditDb {
  'audit.audit_log': AuditLogTable;
}

const db = (): Kysely<AuditDb> => unitOfWorkKysely<AuditDb>();

/** Un número fraccionario en el diff es un defecto: los montos viajan como string (design §2, "validador"). */
function assertNoFractionalNumbers(value: unknown): void {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error('audit changes must not contain fractional numbers');
  }
  if (Array.isArray(value)) value.forEach(assertNoFractionalNumbers);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertNoFractionalNumbers);
}

/**
 * Almacén de AUDIT sobre PostgreSQL con Kysely (ADR-0007) usando SIEMPRE la conexión de la `PgUnitOfWork` en curso:
 * el INSERT viaja en la misma transacción que la mutación auditada (INV-029) y con su contexto RLS (WS-RO). Nunca abre
 * una conexión propia; fuera de una unidad de trabajo falla.
 */
const auditRow = (r: AuditRecord) => {
  assertNoFractionalNumbers(r.changes);
  return {
    id: r.id,
    occurred_at: r.occurredAt.toDate(),
    workspace_id: r.workspaceId,
    actor_type: r.actor.type,
    actor_user_id: r.actor.userId,
    actor_process: r.actor.process,
    action: r.action,
    aggregate_type: r.aggregateType,
    aggregate_id: r.aggregateId,
    aggregate_version: r.aggregateVersion,
    changes: sql<AuditChange[]>`${JSON.stringify(r.changes)}::jsonb`,
    reason: r.reason,
    origin: r.origin,
    correlation_id: r.correlationId,
    request_id: r.requestId,
    idempotency_key: r.idempotencyKey,
    client_ip_hash: r.clientIpHash ? Buffer.from(r.clientIpHash) : null,
    user_agent: r.userAgent,
  };
};

/** Filas por sentencia en la inserción masiva (19 columnas ⇒ muy por debajo del límite de 65 535 parámetros). */
const INSERT_CHUNK = 500;

export class PgAuditLogStore implements AuditLogStore {
  async insert(r: AuditRecord): Promise<void> {
    await db().insertInto('audit.audit_log').values(auditRow(r)).execute();
  }

  /** Inserción multi-fila de una operación masiva (misma transacción y mismo contexto RLS que `insert`). */
  async insertMany(records: readonly AuditRecord[]): Promise<void> {
    for (let i = 0; i < records.length; i += INSERT_CHUNK) {
      await db()
        .insertInto('audit.audit_log')
        .values(records.slice(i, i + INSERT_CHUNK).map(auditRow))
        .execute();
    }
  }

  async page(q: AuditLogPageQuery): Promise<readonly AuditRecord[]> {
    let query = db().selectFrom('audit.audit_log').selectAll().where('workspace_id', '=', q.workspaceId);
    if (q.entities.length > 0) {
      query = query.where((eb) =>
        eb.or(
          q.entities.map((e) =>
            eb.and([eb('aggregate_type', '=', e.aggregateType), eb('aggregate_id', '=', e.aggregateId)]),
          ),
        ),
      );
    }
    if (q.aggregateType !== undefined) query = query.where('aggregate_type', '=', q.aggregateType);
    if (q.actorUserId !== undefined) query = query.where('actor_user_id', '=', q.actorUserId);
    if (q.actions !== undefined) query = query.where('action', 'in', [...q.actions]);
    if (q.origin !== undefined) query = query.where('origin', '=', q.origin);
    if (q.correlationId !== undefined) query = query.where('correlation_id', '=', q.correlationId);
    if (q.category) {
      // SECURITY = acción del catálogo (índice `(workspace_id, action, occurred_at DESC)`); DATA = el resto.
      const exact = [...q.category.security.exact];
      query = query.where(
        q.category.kind === 'SECURITY'
          ? sql<boolean>`action = ANY(${exact}::text[])`
          : sql<boolean>`action <> ALL(${exact}::text[])`,
      );
    }
    if (q.from) query = query.where('occurred_at', '>=', q.from);
    if (q.to) query = query.where('occurred_at', '<', q.to);
    if (q.after) {
      const at = new Date(q.after.occurredAt);
      const id = q.after.id;
      query = query.where((eb) =>
        eb(eb.refTuple('occurred_at', 'id'), q.ascending ? '>' : '<', eb.tuple(at, id)),
      );
    }
    const dir = q.ascending ? 'asc' : 'desc';
    const rows = await query.orderBy('occurred_at', dir).orderBy('id', dir).limit(q.limit).execute();
    return rows.map(toRecord);
  }
}

function toRecord(r: AuditLogTable): AuditRecord {
  if (!isAuditOrigin(r.origin)) throw new Error(`origen desconocido en audit.audit_log: ${r.origin}`);
  return AuditRecord.restore({
    id: r.id,
    workspaceId: r.workspace_id,
    occurredAt: Instant.fromDate(r.occurred_at),
    actor:
      r.actor_type === 'USER'
        ? { type: 'USER', userId: r.actor_user_id ?? '' }
        : { type: r.actor_type, process: r.actor_process ?? '' },
    action: r.action,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    aggregateVersion: r.aggregate_version,
    changes: r.changes,
    reason: r.reason,
    origin: r.origin,
    correlationId: r.correlation_id,
    requestId: r.request_id,
    idempotencyKey: r.idempotency_key,
    clientIpHash: r.client_ip_hash ? new Uint8Array(r.client_ip_hash) : null,
    userAgent: r.user_agent,
  });
}

/**
 * Entorno de plataforma: contexto ambiental (`@pf/platform/api` RequestContext + correlación del logging) y la
 * transacción activa de la `PgUnitOfWork`. Un `X-Request-Id` que no es UUID se convierte en un UUID estable.
 */
export const platformAuditEnvironment: AuditEnvironment = {
  ambient(): AuditAmbient {
    const ctx = currentRequestContext();
    const corr = currentCorrelation();
    return {
      ...(ctx?.actor ? { actor: ctx.actor } : {}),
      ...(ctx?.origin ? { origin: ctx.origin } : {}),
      ...(corr?.correlationId ? { correlationId: uuidFromOpaqueId(corr.correlationId) } : {}),
      ...(corr?.requestId ? { requestId: uuidFromOpaqueId(corr.requestId) } : {}),
      userAgent: ctx?.userAgent ?? null,
      clientIp: ctx?.clientIp ?? null,
      idempotencyKey: ctx?.idempotencyKey ?? null,
    };
  },
  inUnitOfWork: () => currentSqlExecutor() !== undefined,
};

/**
 * HMAC-SHA256 de la IP con la clave vigente de `AUDIT_IP_HMAC_KEY` (`kid:secreto[,…]`, la primera firma). La IP nunca
 * se guarda ni se registra en claro (NFR-SEC-015). Rotar la clave vuelve incomparables los hashes anteriores
 * (aceptado: el hash sirve para correlacionar accesos cercanos en el tiempo, no como identificador permanente).
 */
export class HmacIpHasher implements IpHasher {
  private readonly secret: string;

  constructor(keys: string | undefined) {
    this.secret = keys ? (parseCursorKeys(keys)[0]?.secret ?? '') : randomBytes(32).toString('hex');
    if (!this.secret) throw new Error('AUDIT_IP_HMAC_KEY sin clave');
  }

  hash(ip: string): Uint8Array {
    return new Uint8Array(createHmac('sha256', this.secret).update(ip, 'utf8').digest());
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };

/** Unidad de trabajo de lectura (contexto RLS del usuario y el workspace consultado). */
export const pgReadUnitOfWork = (pool: Pool): ReadUnitOfWork => new PgUnitOfWork(pool);

/**
 * Mantenimiento de particiones (job `audit.ensure-partitions`, rol pf_worker): crea las del mes actual y los
 * `monthsAhead` siguientes y devuelve cuántas creó y cuántas filas hay en la partición DEFAULT (alerta si > 0).
 */
export async function ensureAuditPartitions(
  pool: Pool,
  monthsAhead = 2,
): Promise<{ readonly created: number; readonly defaultRows: number }> {
  const created = await pool.query<{ n: number }>('SELECT audit.ensure_partitions($1) AS n', [monthsAhead]);
  const rows = await pool.query<{ n: string }>('SELECT audit.default_partition_rows()::text AS n');
  return { created: created.rows[0]?.n ?? 0, defaultRows: Number(rows.rows[0]?.n ?? 0) };
}

// ───────────────────────────────────────────── add-global-audit-view: fallos de autorización

/** ¿Existe un workspace activo con ese id? `iam.workspace_exists` (SECURITY DEFINER): solo un booleano, nunca filas. */
export class PgWorkspaceExistence implements WorkspaceExistence {
  async exists(workspaceId: string): Promise<boolean> {
    const r = await sql<{ e: boolean }>`SELECT iam.workspace_exists(${workspaceId}::uuid) AS e`.execute(db());
    return r.rows[0]?.e === true;
  }
}
