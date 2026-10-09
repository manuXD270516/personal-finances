import { requireSqlExecutor } from '@pf/platform/api';
import { DomainError, type Instant } from '@pf/shared-kernel';
import type {
  ExpiredExportRef,
  ExportRepository,
  ImportRepository,
  OperationRepository,
  OperationView,
} from '../../application/portability/ports.js';
import { WorkspaceExport, type ExportStatus } from '../../domain/workspace-export.js';
import { WorkspaceImport, type ImportStatus } from '../../domain/workspace-import.js';

/** Adaptadores PostgreSQL de la portabilidad sobre la conexión de la `PgUnitOfWork` en curso (ADR-0007, ADR-0023). */
const exec = () => requireSqlExecutor();
const iso = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const code = (err: unknown): string | undefined => (err as { code?: string } | null)?.code;
const constraint = (err: unknown): string | undefined => (err as { constraint?: string } | null)?.constraint;

interface ExportRow {
  id: string;
  workspace_id: string;
  operation_id: string;
  status: ExportStatus;
  format_version: number;
  object_key: string | null;
  size_bytes: string | null;
  sha256: string | null;
  key_id: string | null;
  wrapped_key: Buffer | null;
  counts: Record<string, number>;
  requested_by: string;
  requested_at: string;
  completed_at: string | null;
  expires_at: string | null;
  discarded_at: string | null;
  discarded_by: string | null;
  expired_at: string | null;
  error: { code: string; message: string } | null;
  version: number;
}

const EXPORT_COLUMNS = `id, workspace_id, operation_id, status, format_version, object_key, size_bytes::text AS size_bytes,
  encode(sha256, 'hex') AS sha256, key_id, wrapped_key, counts, requested_by, ${iso('requested_at')} AS requested_at,
  ${iso('completed_at')} AS completed_at, ${iso('expires_at')} AS expires_at, ${iso('discarded_at')} AS discarded_at,
  discarded_by, ${iso('expired_at')} AS expired_at, error, version`;

const toExport = (r: ExportRow): WorkspaceExport =>
  WorkspaceExport.restore({
    id: r.id,
    workspaceId: r.workspace_id,
    operationId: r.operation_id,
    status: r.status,
    formatVersion: Number(r.format_version),
    objectKey: r.object_key,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
    sha256: r.sha256,
    keyId: r.key_id,
    wrappedKey: r.wrapped_key,
    counts: r.counts,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    completedAt: r.completed_at,
    expiresAt: r.expires_at,
    discardedAt: r.discarded_at,
    discardedBy: r.discarded_by,
    expiredAt: r.expired_at,
    error: r.error,
    version: Number(r.version),
  });

export class PgExportRepository implements ExportRepository {
  async insert(e: WorkspaceExport): Promise<void> {
    const p = e.snapshot();
    try {
      await exec().query(
        `INSERT INTO iam.workspace_export (id, workspace_id, operation_id, status, format_version, counts, requested_by,
                                           requested_at, version)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz, $9)`,
        [
          p.id,
          p.workspaceId,
          p.operationId,
          p.status,
          p.formatVersion,
          JSON.stringify(p.counts),
          p.requestedBy,
          p.requestedAt,
          p.version,
        ],
      );
    } catch (err) {
      if (code(err) === '23505' && constraint(err) === 'workspace_export_in_progress_uq') {
        throw new DomainError('EXPORT_IN_PROGRESS', 'the workspace already has an export in progress');
      }
      throw err;
    }
  }

  async find(workspaceId: string, id: string): Promise<WorkspaceExport | null> {
    const { rows } = await exec().query(
      `SELECT ${EXPORT_COLUMNS} FROM iam.workspace_export WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id],
    );
    const r = rows[0] as ExportRow | undefined;
    return r ? toExport(r) : null;
  }

  async list(workspaceId: string, limit: number): Promise<readonly WorkspaceExport[]> {
    const { rows } = await exec().query(
      `SELECT ${EXPORT_COLUMNS} FROM iam.workspace_export WHERE workspace_id = $1
        ORDER BY requested_at DESC, id DESC LIMIT $2`,
      [workspaceId, limit],
    );
    return (rows as ExportRow[]).map(toExport);
  }

  async save(e: WorkspaceExport, expectedVersion: number): Promise<boolean> {
    const p = e.snapshot();
    const { rowCount } = await exec().query(
      `UPDATE iam.workspace_export
          SET status = $3, object_key = $4, size_bytes = $5, sha256 = decode($6, 'hex'), key_id = $7, wrapped_key = $8,
              counts = $9::jsonb, completed_at = $10::timestamptz, expires_at = $11::timestamptz,
              discarded_at = $12::timestamptz, discarded_by = $13, expired_at = $14::timestamptz, error = $15::jsonb,
              version = $16
        WHERE workspace_id = $1 AND id = $2 AND version = $17`,
      [
        p.workspaceId,
        p.id,
        p.status,
        p.objectKey,
        p.sizeBytes,
        p.sha256,
        p.keyId,
        p.wrappedKey === null ? null : Buffer.from(p.wrappedKey),
        JSON.stringify(p.counts),
        p.completedAt,
        p.expiresAt,
        p.discardedAt,
        p.discardedBy,
        p.expiredAt,
        p.error === null ? null : JSON.stringify(p.error),
        p.version,
        expectedVersion,
      ],
    );
    return rowCount === 1;
  }

  async hasInProgress(workspaceId: string): Promise<boolean> {
    const { rows } = await exec().query(
      `SELECT 1 FROM iam.workspace_export WHERE workspace_id = $1 AND status IN ('REQUESTED', 'RUNNING') LIMIT 1`,
      [workspaceId],
    );
    return rows.length > 0;
  }

  async findExpired(now: Instant, limit: number): Promise<readonly ExpiredExportRef[]> {
    // Sin workspace en contexto: solo la política `retention_scan` (READY vencidos) lo permite al rol del worker.
    const { rows } = await exec().query(
      `SELECT id, workspace_id, requested_by FROM iam.workspace_export
        WHERE status = 'READY' AND expires_at <= $1::timestamptz ORDER BY expires_at, id LIMIT $2`,
      [now.toString(), limit],
    );
    return (rows as { id: string; workspace_id: string; requested_by: string }[]).map((r) => ({
      exportId: r.id,
      workspaceId: r.workspace_id,
      requestedBy: r.requested_by,
    }));
  }
}

interface ImportRow {
  id: string;
  requested_by: string;
  status: ImportStatus;
  object_key: string | null;
  key_id: string | null;
  wrapped_key: Buffer | null;
  size_bytes: string;
  source_workspace_id: string;
  source_exported_at: string;
  format_version: number;
  target_workspace_id: string | null;
  report: Record<string, unknown>;
  error: { code: string; message: string } | null;
  created_at: string;
  completed_at: string | null;
}

const IMPORT_COLUMNS = `id, requested_by, status, object_key, key_id, wrapped_key, size_bytes::text AS size_bytes,
  source_workspace_id, ${iso('source_exported_at')} AS source_exported_at, format_version, target_workspace_id, report,
  error, ${iso('created_at')} AS created_at, ${iso('completed_at')} AS completed_at`;

const toImport = (r: ImportRow): WorkspaceImport =>
  WorkspaceImport.restore({
    id: r.id,
    requestedBy: r.requested_by,
    status: r.status,
    objectKey: r.object_key,
    keyId: r.key_id,
    wrappedKey: r.wrapped_key,
    sizeBytes: Number(r.size_bytes),
    sourceWorkspaceId: r.source_workspace_id,
    sourceExportedAt: r.source_exported_at,
    formatVersion: Number(r.format_version),
    targetWorkspaceId: r.target_workspace_id,
    report: r.report,
    error: r.error,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  });

export class PgImportRepository implements ImportRepository {
  async insert(i: WorkspaceImport): Promise<void> {
    const p = i.snapshot();
    try {
      await exec().query(
        `INSERT INTO iam.workspace_import (id, requested_by, status, object_key, key_id, wrapped_key, size_bytes,
                                           source_workspace_id, source_exported_at, format_version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11::timestamptz)`,
        [
          p.id,
          p.requestedBy,
          p.status,
          p.objectKey,
          p.keyId,
          p.wrappedKey === null ? null : Buffer.from(p.wrappedKey),
          p.sizeBytes,
          p.sourceWorkspaceId,
          p.sourceExportedAt,
          p.formatVersion,
          p.createdAt,
        ],
      );
    } catch (err) {
      if (code(err) === '23505' && constraint(err) === 'workspace_import_in_progress_uq') {
        throw new DomainError('IMPORT_IN_PROGRESS', 'an import is already in progress');
      }
      throw err;
    }
  }

  async find(userId: string, id: string): Promise<WorkspaceImport | null> {
    const { rows } = await exec().query(
      `SELECT ${IMPORT_COLUMNS} FROM iam.workspace_import WHERE requested_by = $1 AND id = $2`,
      [userId, id],
    );
    const r = rows[0] as ImportRow | undefined;
    return r ? toImport(r) : null;
  }

  async save(i: WorkspaceImport): Promise<void> {
    const p = i.snapshot();
    await exec().query(
      `UPDATE iam.workspace_import
          SET status = $3, object_key = $4, key_id = $5, wrapped_key = $6, target_workspace_id = $7,
              report = $8::jsonb, error = $9::jsonb, completed_at = $10::timestamptz
        WHERE requested_by = $1 AND id = $2`,
      [
        p.requestedBy,
        p.id,
        p.status,
        p.objectKey,
        p.keyId,
        p.wrappedKey === null ? null : Buffer.from(p.wrappedKey),
        p.targetWorkspaceId,
        JSON.stringify(p.report),
        p.error === null ? null : JSON.stringify(p.error),
        p.completedAt,
      ],
    );
  }

  async hasInProgress(userId: string): Promise<boolean> {
    const { rows } = await exec().query(
      `SELECT 1 FROM iam.workspace_import WHERE requested_by = $1
        AND status IN ('RECEIVED', 'VALIDATING', 'IMPORTING', 'VERIFYING') LIMIT 1`,
      [userId],
    );
    return rows.length > 0;
  }
}

interface OperationRow {
  id: string;
  kind: 'EXPORT';
  status: OperationView['status'];
  progress_pct: number;
  resource_type: string;
  resource_id: string;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  requested_by: string;
  created_at: string;
  updated_at: string;
}

export class PgOperationRepository implements OperationRepository {
  async insert(op: Parameters<OperationRepository['insert']>[0]): Promise<void> {
    await exec().query(
      `INSERT INTO platform.operation (id, workspace_id, kind, resource_type, resource_id, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [op.id, op.workspaceId, op.kind, op.resourceType, op.resourceId, op.requestedBy],
    );
  }

  async find(workspaceId: string, id: string): Promise<OperationView | null> {
    const { rows } = await exec().query(
      `SELECT id, kind, status, progress_pct, resource_type, resource_id, result, error, requested_by,
              ${iso('created_at')} AS created_at, ${iso('updated_at')} AS updated_at
         FROM platform.operation WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id],
    );
    const r = rows[0] as OperationRow | undefined;
    return r
      ? {
          id: r.id,
          kind: r.kind,
          status: r.status,
          progressPct: Number(r.progress_pct),
          resourceType: r.resource_type,
          resourceId: r.resource_id,
          result: r.result,
          error: r.error,
          requestedBy: r.requested_by,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }
      : null;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: Parameters<OperationRepository['update']>[2],
  ): Promise<void> {
    await exec().query(
      `UPDATE platform.operation
          SET status = coalesce($3, status), progress_pct = coalesce($4, progress_pct),
              result = CASE WHEN $5::boolean THEN $6::jsonb ELSE result END,
              error = CASE WHEN $7::boolean THEN $8::jsonb ELSE error END, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`,
      [
        workspaceId,
        id,
        patch.status ?? null,
        patch.progressPct ?? null,
        patch.result !== undefined,
        patch.result === undefined || patch.result === null ? null : JSON.stringify(patch.result),
        patch.error !== undefined,
        patch.error === undefined || patch.error === null ? null : JSON.stringify(patch.error),
      ],
    );
  }
}
