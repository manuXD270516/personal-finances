import { PgUnitOfWork, currentRequestContext, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { DomainError } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import type {
  AttachmentLinkRepository,
  DocumentFilter,
  DocumentPage,
  DocumentRef,
  DocumentRepository,
  IdGenerator,
  LinkRecord,
  MaintenanceScanPort,
  RestoreOperationPort,
  StorageUsageRepository,
  UnitOfWork,
} from '../application/ports/index.js';
import { objectKeyOf } from '../application/ports/index.js';
import { Document, type DocumentState } from '../domain/document.js';
import type { StorageUsage } from '../domain/storage-quota.js';
import type { AttachmentTargetType, DocumentStatus } from '../domain/types.js';

const db = () => unitOfWorkKysely<Record<string, never>>();
const ISO = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** Unidad de trabajo de DOCUMENTS: transacción PG con el contexto RLS del workspace; reutiliza la del llamador. */
export class PgDocumentsUnitOfWork implements UnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const actor = currentRequestContext()?.actor;
    return this.uow.run({ userId: actor && actor.type === 'USER' ? actor.userId : null, workspaceId }, fn);
  }

  /** Transacción SIN workspace (barridos de mantenimiento como `pf_maintenance`). */
  runSystem<T>(fn: () => Promise<T>): Promise<T> {
    return this.uow.run({ userId: null, workspaceId: null }, fn);
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };

// ───────────────────────────────────────────────────────────── documentos

interface DocumentRow {
  id: string;
  workspace_id: string;
  purpose: DocumentState['purpose'];
  status: DocumentStatus;
  original_name: string;
  extension: string;
  declared_content_type: string;
  declared_format: DocumentState['declaredFormat'];
  detected_content_type: string | null;
  detected_format: DocumentState['detectedFormat'];
  size_bytes: string;
  sha256_hex: string;
  quarantine_key: string | null;
  object_key: string | null;
  encrypted_size_bytes: string | null;
  key_id: string | null;
  wrapped_key: Buffer | null;
  envelope_version: number | null;
  scan_status: DocumentState['scanStatus'];
  scan_engine: string | null;
  rejection_reason: DocumentState['rejectionReason'];
  upload_expires_at: string | null;
  verification_started_at: string | null;
  uploaded_at: string | null;
  available_at: string | null;
  rejected_at: string | null;
  archived_at: string | null;
  archived_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  last_unlinked_at: string | null;
  restored_from: unknown;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

const COLUMNS = sql`
  d.id, d.workspace_id, d.purpose, d.status, d.original_name, d.extension, d.declared_content_type,
  d.declared_format, d.detected_content_type, d.detected_format, d.size_bytes::text AS size_bytes,
  encode(d.sha256, 'hex') AS sha256_hex, d.quarantine_key, d.object_key,
  d.encrypted_size_bytes::text AS encrypted_size_bytes, d.key_id, d.wrapped_key, d.envelope_version, d.scan_status,
  d.scan_engine, d.rejection_reason,
  ${ISO('d.upload_expires_at')} AS upload_expires_at,
  ${ISO('d.verification_started_at')} AS verification_started_at, ${ISO('d.uploaded_at')} AS uploaded_at,
  ${ISO('d.available_at')} AS available_at, ${ISO('d.rejected_at')} AS rejected_at,
  ${ISO('d.archived_at')} AS archived_at, d.archived_by, ${ISO('d.deleted_at')} AS deleted_at, d.deleted_by,
  ${ISO('d.last_unlinked_at')} AS last_unlinked_at, d.restored_from, d.created_by,
  ${ISO('d.created_at')} AS created_at, ${ISO('d.updated_at')} AS updated_at, d.version`;

const toDocument = (r: DocumentRow): Document =>
  Document.rehydrate({
    id: r.id,
    workspaceId: r.workspace_id,
    purpose: r.purpose,
    status: r.status,
    originalName: r.original_name,
    extension: r.extension,
    declaredContentType: r.declared_content_type,
    declaredFormat: r.declared_format,
    detectedContentType: r.detected_content_type,
    detectedFormat: r.detected_format,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256_hex,
    quarantineKey: r.quarantine_key,
    objectKey: r.object_key,
    encryptedSizeBytes: r.encrypted_size_bytes === null ? null : Number(r.encrypted_size_bytes),
    keyId: r.key_id,
    wrappedKey: r.wrapped_key,
    envelopeVersion: r.envelope_version,
    scanStatus: r.scan_status,
    scanEngine: r.scan_engine,
    rejectionReason: r.rejection_reason,
    uploadExpiresAt: r.upload_expires_at,
    verificationStartedAt: r.verification_started_at,
    uploadedAt: r.uploaded_at,
    availableAt: r.available_at,
    rejectedAt: r.rejected_at,
    archivedAt: r.archived_at,
    archivedBy: r.archived_by,
    deletedAt: r.deleted_at,
    deletedBy: r.deleted_by,
    lastUnlinkedAt: r.last_unlinked_at,
    restoredFrom: r.restored_from === null ? null : JSON.stringify(r.restored_from),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: Number(r.version),
  });

const wrapped = (key: Uint8Array | null): Buffer | null => (key === null ? null : Buffer.from(key));

/** Estados que muestra el listado por defecto (documentos utilizables). */
const DEFAULT_LISTED: readonly DocumentStatus[] = ['AVAILABLE', 'CONTENT_PENDING'];

interface Cursor {
  readonly c: string;
  readonly i: string;
}
const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(raw: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    return typeof c.c === 'string' && typeof c.i === 'string' ? c : null;
  } catch {
    return null;
  }
}

export class PgDocumentRepository implements DocumentRepository {
  async insert(doc: Document): Promise<void> {
    const s = doc.snapshot;
    await sql`
      INSERT INTO documents.document (
        id, workspace_id, purpose, status, original_name, extension, declared_content_type, declared_format,
        size_bytes, sha256, quarantine_key, upload_expires_at, created_by, created_at, updated_at, version)
      VALUES (
        ${s.id}, ${s.workspaceId}, ${s.purpose}, ${s.status}, ${s.originalName}, ${s.extension},
        ${s.declaredContentType}, ${s.declaredFormat}, ${s.sizeBytes}, decode(${s.sha256}, 'hex'),
        ${s.quarantineKey}, ${s.uploadExpiresAt}::timestamptz, ${s.createdBy}, ${s.createdAt}::timestamptz,
        ${s.updatedAt}::timestamptz, ${s.version})`.execute(db());
  }

  async save(doc: Document): Promise<boolean> {
    const s = doc.snapshot;
    const result = await sql`
      UPDATE documents.document SET
        status = ${s.status}, detected_content_type = ${s.detectedContentType}, detected_format = ${s.detectedFormat},
        quarantine_key = ${s.quarantineKey}, object_key = ${s.objectKey},
        encrypted_size_bytes = ${s.encryptedSizeBytes}, key_id = ${s.keyId}, wrapped_key = ${wrapped(s.wrappedKey)},
        envelope_version = ${s.envelopeVersion}, scan_status = ${s.scanStatus}, scan_engine = ${s.scanEngine},
        rejection_reason = ${s.rejectionReason}, upload_expires_at = ${s.uploadExpiresAt}::timestamptz,
        verification_started_at = ${s.verificationStartedAt}::timestamptz, uploaded_at = ${s.uploadedAt}::timestamptz,
        available_at = ${s.availableAt}::timestamptz, rejected_at = ${s.rejectedAt}::timestamptz,
        archived_at = ${s.archivedAt}::timestamptz, archived_by = ${s.archivedBy}, deleted_at = ${s.deletedAt}::timestamptz,
        deleted_by = ${s.deletedBy}, last_unlinked_at = ${s.lastUnlinkedAt}::timestamptz,
        updated_at = ${s.updatedAt}::timestamptz, version = ${s.version}
       WHERE id = ${s.id} AND workspace_id = ${s.workspaceId} AND version = ${s.version - 1}`.execute(db());
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async saveKey(doc: Document): Promise<boolean> {
    const s = doc.snapshot;
    const result = await sql`
      UPDATE documents.document SET key_id = ${s.keyId}, wrapped_key = ${wrapped(s.wrappedKey)}
       WHERE id = ${s.id} AND workspace_id = ${s.workspaceId} AND status IN ('AVAILABLE', 'CONTENT_PENDING')`.execute(
      db(),
    );
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async findById(workspaceId: string, id: string, options?: { lock?: 'update' }): Promise<Document | null> {
    const lock = options?.lock === 'update' ? sql`FOR UPDATE OF d` : sql``;
    const { rows } = await sql<DocumentRow>`
      SELECT ${COLUMNS} FROM documents.document d
       WHERE d.workspace_id = ${workspaceId} AND d.id = ${id} ${lock}`.execute(db());
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async findAvailableBySha256(workspaceId: string, sha256: string): Promise<Document | null> {
    const { rows } = await sql<DocumentRow>`
      SELECT ${COLUMNS} FROM documents.document d
       WHERE d.workspace_id = ${workspaceId} AND d.sha256 = decode(${sha256}, 'hex') AND d.status = 'AVAILABLE'
       LIMIT 1`.execute(db());
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async list(workspaceId: string, filter: DocumentFilter): Promise<DocumentPage> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const statuses = filter.status ? [filter.status] : DEFAULT_LISTED;
    const archived = filter.archived ?? 'EXCLUDE';
    const cursor = filter.cursor ? decodeCursor(filter.cursor) : null;
    if (filter.cursor && cursor === null)
      throw new DomainError('INVALID_CURSOR', 'invalid pagination cursor');
    const { rows } = await sql<DocumentRow>`
      SELECT ${COLUMNS} FROM documents.document d
       WHERE d.workspace_id = ${workspaceId}
         AND d.status = ANY(${[...statuses]}::text[])
         ${filter.purpose ? sql`AND d.purpose = ${filter.purpose}` : sql``}
         ${archived === 'EXCLUDE' ? sql`AND d.archived_at IS NULL` : archived === 'ONLY' ? sql`AND d.archived_at IS NOT NULL` : sql``}
         ${
           filter.target
             ? sql`AND EXISTS (SELECT 1 FROM documents.attachment_link l
                                WHERE l.workspace_id = d.workspace_id AND l.document_id = d.id
                                  AND l.target_type = ${filter.target.type} AND l.target_id = ${filter.target.id})`
             : sql``
         }
         ${cursor ? sql`AND (d.created_at, d.id) < (${cursor.c}::timestamptz, ${cursor.i}::uuid)` : sql``}
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT ${limit + 1}`.execute(db());
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toDocument),
      nextCursor: rows.length > limit && last ? encodeCursor({ c: last.created_at, i: last.id }) : null,
    };
  }
}

// ───────────────────────────────────────────────────────────── vínculos

interface LinkRow {
  id: string;
  workspace_id: string;
  document_id: string;
  target_type: AttachmentTargetType;
  target_id: string;
  created_by: string;
  created_at: string;
}

const LINK_COLUMNS = sql`
  l.id, l.workspace_id, l.document_id, l.target_type, l.target_id, l.created_by, ${ISO('l.created_at')} AS created_at`;
const toLink = (r: LinkRow): LinkRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  documentId: r.document_id,
  targetType: r.target_type,
  targetId: r.target_id,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export class PgAttachmentLinkRepository implements AttachmentLinkRepository {
  async find(
    workspaceId: string,
    documentId: string,
    targetType: AttachmentTargetType,
    targetId: string,
  ): Promise<LinkRecord | null> {
    const { rows } = await sql<LinkRow>`
      SELECT ${LINK_COLUMNS} FROM documents.attachment_link l
       WHERE l.workspace_id = ${workspaceId} AND l.document_id = ${documentId}
         AND l.target_type = ${targetType} AND l.target_id = ${targetId}`.execute(db());
    return rows[0] ? toLink(rows[0]) : null;
  }

  async findById(workspaceId: string, documentId: string, linkId: string): Promise<LinkRecord | null> {
    const { rows } = await sql<LinkRow>`
      SELECT ${LINK_COLUMNS} FROM documents.attachment_link l
       WHERE l.workspace_id = ${workspaceId} AND l.document_id = ${documentId} AND l.id = ${linkId}`.execute(
      db(),
    );
    return rows[0] ? toLink(rows[0]) : null;
  }

  async lockTarget(
    workspaceId: string,
    targetType: AttachmentTargetType,
    targetId: string,
  ): Promise<readonly LinkRecord[]> {
    // Serializa los vínculos paralelos al MISMO destino con un candado consultivo de transacción (sin `FOR UPDATE`:
    // `pf_app` no tiene UPDATE sobre los vínculos, que solo se insertan y borran). El índice único (workspace, documento,
    // destino) sigue impidiendo el duplicado exacto.
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`documents:${workspaceId}:${targetType}:${targetId}`}, 0))`.execute(
      db(),
    );
    const { rows } = await sql<LinkRow>`
      SELECT ${LINK_COLUMNS} FROM documents.attachment_link l
       WHERE l.workspace_id = ${workspaceId} AND l.target_type = ${targetType} AND l.target_id = ${targetId}
       ORDER BY l.id`.execute(db());
    return rows.map(toLink);
  }

  async insert(link: LinkRecord): Promise<void> {
    await sql`
      INSERT INTO documents.attachment_link (id, workspace_id, document_id, target_type, target_id, created_by, created_at)
      VALUES (${link.id}, ${link.workspaceId}, ${link.documentId}, ${link.targetType}, ${link.targetId},
              ${link.createdBy}, ${link.createdAt}::timestamptz)`.execute(db());
  }

  async delete(workspaceId: string, linkId: string): Promise<void> {
    await sql`DELETE FROM documents.attachment_link WHERE workspace_id = ${workspaceId} AND id = ${linkId}`.execute(
      db(),
    );
  }

  async deleteAllOf(workspaceId: string, documentId: string): Promise<readonly LinkRecord[]> {
    const { rows } = await sql<LinkRow>`
      DELETE FROM documents.attachment_link l
       WHERE l.workspace_id = ${workspaceId} AND l.document_id = ${documentId}
   RETURNING ${LINK_COLUMNS}`.execute(db());
    return rows.map(toLink);
  }

  async linksOf(
    workspaceId: string,
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly LinkRecord[]>> {
    const out = new Map<string, LinkRecord[]>();
    if (documentIds.length === 0) return out;
    const { rows } = await sql<LinkRow>`
      SELECT ${LINK_COLUMNS} FROM documents.attachment_link l
       WHERE l.workspace_id = ${workspaceId} AND l.document_id = ANY(${[...documentIds]}::uuid[])
       ORDER BY l.created_at, l.id`.execute(db());
    for (const r of rows) out.set(r.document_id, [...(out.get(r.document_id) ?? []), toLink(r)]);
    return out;
  }

  async countOf(workspaceId: string, documentId: string): Promise<number> {
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM documents.attachment_link
       WHERE workspace_id = ${workspaceId} AND document_id = ${documentId}`.execute(db());
    return Number(rows[0]?.n ?? 0);
  }
}

// ───────────────────────────────────────────────────────────── cuota

interface UsageRow {
  used_bytes: string;
  reserved_bytes: string;
  pending_uploads: number;
}
const toUsage = (r: UsageRow | undefined): StorageUsage =>
  r
    ? {
        usedBytes: Number(r.used_bytes),
        reservedBytes: Number(r.reserved_bytes),
        pendingUploads: Number(r.pending_uploads),
      }
    : { usedBytes: 0, reservedBytes: 0, pendingUploads: 0 };

export class PgStorageUsageRepository implements StorageUsageRepository {
  async read(workspaceId: string): Promise<StorageUsage> {
    const { rows } = await sql<UsageRow>`
      SELECT used_bytes::text AS used_bytes, reserved_bytes::text AS reserved_bytes, pending_uploads
        FROM documents.storage_usage WHERE workspace_id = ${workspaceId}`.execute(db());
    return toUsage(rows[0]);
  }

  async lock(workspaceId: string): Promise<StorageUsage> {
    await sql`
      INSERT INTO documents.storage_usage (workspace_id) VALUES (${workspaceId}) ON CONFLICT (workspace_id) DO NOTHING`.execute(
      db(),
    );
    const { rows } = await sql<UsageRow>`
      SELECT used_bytes::text AS used_bytes, reserved_bytes::text AS reserved_bytes, pending_uploads
        FROM documents.storage_usage WHERE workspace_id = ${workspaceId} FOR UPDATE`.execute(db());
    return toUsage(rows[0]);
  }

  async save(workspaceId: string, usage: StorageUsage, at: string): Promise<void> {
    await sql`
      UPDATE documents.storage_usage SET used_bytes = ${usage.usedBytes}, reserved_bytes = ${usage.reservedBytes},
             pending_uploads = ${usage.pendingUploads}, updated_at = ${at}::timestamptz
       WHERE workspace_id = ${workspaceId}`.execute(db());
  }

  async recompute(workspaceId: string): Promise<StorageUsage> {
    const { rows } = await sql<UsageRow>`
      SELECT COALESCE(sum(size_bytes) FILTER (WHERE status IN ('AVAILABLE', 'CONTENT_PENDING')), 0)::text AS used_bytes,
             COALESCE(sum(size_bytes) FILTER (WHERE status IN ('PENDING_UPLOAD', 'UPLOADED')), 0)::text AS reserved_bytes,
             count(*) FILTER (WHERE status IN ('PENDING_UPLOAD', 'UPLOADED'))::int AS pending_uploads
        FROM documents.document WHERE workspace_id = ${workspaceId}`.execute(db());
    return toUsage(rows[0]);
  }
}

// ───────────────────────────────────────────────────────────── mantenimiento (entre workspaces)

const BATCH = 200;

/**
 * Candidatos de los jobs de mantenimiento SIN workspace en contexto: el rol `pf_maintenance` (ADR-0023), asumido solo
 * en esa transacción con `SET LOCAL ROLE`, lee por `retention_scan` y solo columnas operativas (D308–D310). Las
 * políticas `ws_isolation` de `pf_app` y `pf_worker` fallan con PF002 sin contexto.
 */
export class PgMaintenanceScan implements MaintenanceScanPort {
  constructor(private readonly uow: PgDocumentsUnitOfWork) {}

  private query<T>(run: () => Promise<T>): Promise<T> {
    return this.uow.runSystem(async () => {
      await sql`SET LOCAL ROLE pf_maintenance`.execute(db());
      return run();
    });
  }

  private refs(rows: readonly { id: string; workspace_id: string }[]): DocumentRef[] {
    return rows.map((r) => ({ workspaceId: r.workspace_id, documentId: r.id }));
  }

  expiredPending(before: string): Promise<readonly DocumentRef[]> {
    return this.query(async () => {
      const { rows } = await sql<{ id: string; workspace_id: string }>`
        SELECT id, workspace_id FROM documents.document
         WHERE status = 'PENDING_UPLOAD' AND upload_expires_at < ${before}::timestamptz
         ORDER BY upload_expires_at, id LIMIT ${BATCH}`.execute(db());
      return this.refs(rows);
    });
  }

  stuckUploads(before: string): Promise<readonly DocumentRef[]> {
    return this.query(async () => {
      const { rows } = await sql<{ id: string; workspace_id: string }>`
        SELECT id, workspace_id FROM documents.document
         WHERE status = 'UPLOADED' AND verification_started_at < ${before}::timestamptz
         ORDER BY verification_started_at, id LIMIT ${BATCH}`.execute(db());
      return this.refs(rows);
    });
  }

  unlinkedCandidates(before: string): Promise<readonly DocumentRef[]> {
    return this.query(async () => {
      const { rows } = await sql<{ id: string; workspace_id: string }>`
        SELECT d.id, d.workspace_id FROM documents.document d
         WHERE d.status = 'AVAILABLE' AND d.archived_at IS NULL
           AND COALESCE(d.last_unlinked_at, d.available_at) < ${before}::timestamptz
           AND NOT EXISTS (SELECT 1 FROM documents.attachment_link l
                            WHERE l.workspace_id = d.workspace_id AND l.document_id = d.id)
         ORDER BY COALESCE(d.last_unlinked_at, d.available_at), d.id LIMIT ${BATCH}`.execute(db());
      return this.refs(rows);
    });
  }

  workspacesWithDocuments(): Promise<readonly string[]> {
    return this.query(async () => {
      const { rows } = await sql<{ workspace_id: string }>`
        SELECT DISTINCT workspace_id FROM documents.document`.execute(db());
      return rows.map((r) => r.workspace_id);
    });
  }

  keyIdsInUse(): Promise<readonly string[]> {
    return this.query(async () => {
      const { rows } = await sql<{ key_id: string }>`
        SELECT DISTINCT key_id FROM documents.document WHERE key_id IS NOT NULL`.execute(db());
      return rows.map((r) => r.key_id);
    });
  }

  withOtherKey(activeKeyId: string, limit: number): Promise<readonly DocumentRef[]> {
    return this.query(async () => {
      const { rows } = await sql<{ id: string; workspace_id: string }>`
        SELECT id, workspace_id FROM documents.document
         WHERE key_id IS NOT NULL AND key_id <> ${activeKeyId} ORDER BY id LIMIT ${limit}`.execute(db());
      return this.refs(rows);
    });
  }

  referencedObjectKeys(workspaceId: string): Promise<ReadonlySet<string>> {
    // La clave de objeto es determinista (`ws/{workspace}/documents/{id}`): no hace falta leer `object_key`.
    return this.query(async () => {
      const { rows } = await sql<{ id: string }>`
        SELECT id FROM documents.document
         WHERE workspace_id = ${workspaceId} AND status IN ('AVAILABLE', 'CONTENT_PENDING')`.execute(db());
      return new Set(rows.map((r) => objectKeyOf(workspaceId, r.id)));
    });
  }

  statusOf(ids: readonly string[]): Promise<ReadonlyMap<string, DocumentStatus>> {
    return this.query(async () => {
      if (ids.length === 0) return new Map<string, DocumentStatus>();
      const { rows } = await sql<{ id: string; status: DocumentStatus }>`
        SELECT id, status FROM documents.document WHERE id = ANY(${[...ids]}::uuid[])`.execute(db());
      return new Map(rows.map((r) => [r.id, r.status] as const));
    });
  }
}

// ───────────────────────────────────────────────────────────── operación de la restauración de contenidos

/**
 * `platform.operation` (kind `DOCUMENT_CONTENTS_RESTORE`) sobre la conexión de la unidad de trabajo en curso: la
 * misma tabla de operaciones asíncronas que consulta `GET W/operations/{id}` (docs/10 §8). Solo estado y conteos.
 */
export class PgRestoreOperations implements RestoreOperationPort {
  async insert(op: { id: string; workspaceId: string; requestedBy: string }): Promise<void> {
    await sql`INSERT INTO platform.operation (id, workspace_id, kind, resource_type, resource_id, requested_by)
              VALUES (${op.id}, ${op.workspaceId}, 'DOCUMENT_CONTENTS_RESTORE', 'DocumentContentRestore', ${op.id},
                      ${op.requestedBy})`.execute(db());
  }

  async update(
    workspaceId: string,
    id: string,
    patch: {
      status?: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
      progressPct?: number;
      result?: Readonly<Record<string, unknown>> | null;
      error?: Readonly<Record<string, unknown>> | null;
    },
  ): Promise<void> {
    await sql`UPDATE platform.operation
                 SET status = coalesce(${patch.status ?? null}, status),
                     progress_pct = coalesce(${patch.progressPct ?? null}::smallint, progress_pct),
                     result = CASE WHEN ${patch.result !== undefined} THEN ${patch.result === undefined || patch.result === null ? null : JSON.stringify(patch.result)}::jsonb ELSE result END,
                     error = CASE WHEN ${patch.error !== undefined} THEN ${patch.error === undefined || patch.error === null ? null : JSON.stringify(patch.error)}::jsonb ELSE error END,
                     updated_at = now()
               WHERE workspace_id = ${workspaceId} AND id = ${id}`.execute(db());
  }

  async status(
    workspaceId: string,
    id: string,
  ): Promise<'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | null> {
    const { rows } = await sql<{
      status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
    }>`SELECT status FROM platform.operation WHERE workspace_id = ${workspaceId} AND id = ${id}`.execute(
      db(),
    );
    return rows[0]?.status ?? null;
  }
}
