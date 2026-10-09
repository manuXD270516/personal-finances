import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, type Instant } from '@pf/shared-kernel';
import type { Role } from '../../domain/role.js';
import { WorkspaceExport } from '../../domain/workspace-export.js';
import {
  ObjectMissingError,
  type ExportJob,
  type OperationView,
  type PortabilityDeps,
  type WrappedDataKey,
} from './ports.js';

/** Procesos técnicos que firman la auditoría de lo que NO inicia un usuario (design § Auditoría). */
export const EXPORT_PROCESS = 'identity.workspace-export';
export const EXPORT_RETENTION_PROCESS = 'identity.export-retention';

/** Estado observable de una exportación (`WorkspaceExport` del contrato). Nunca incluye claves ni el objeto. */
export interface ExportView {
  readonly id: string;
  readonly workspaceId: string;
  readonly operationId: string;
  readonly status: WorkspaceExport['status'];
  readonly formatVersion: number;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
  readonly counts: Readonly<Record<string, number>>;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly expiresAt: string | null;
  readonly discardedAt: string | null;
  readonly expiredAt: string | null;
  readonly errorCode: string | null;
}

export const exportView = (e: WorkspaceExport): ExportView => {
  const p = e.snapshot();
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    operationId: p.operationId,
    status: p.status,
    formatVersion: p.formatVersion,
    sizeBytes: p.sizeBytes,
    sha256: p.sha256,
    counts: p.counts,
    requestedBy: p.requestedBy,
    requestedAt: p.requestedAt,
    completedAt: p.completedAt,
    expiresAt: p.expiresAt,
    discardedAt: p.discardedAt,
    expiredAt: p.expiredAt,
    errorCode: p.error?.code ?? null,
  };
};

/** Descarga lista para entregar: el contenido solo se emite tras verificar TODO el archivo. */
export interface ExportDownload {
  readonly fileName: string;
  readonly sha256: string;
  readonly size: number;
  readonly stream: Readable;
}

const accessDenied = () =>
  new DomainError('WORKSPACE_ACCESS_DENIED', 'not an active member of the workspace');
const notFound = () => new DomainError('RESOURCE_NOT_FOUND', 'export not found');

/** Clave del objeto en el bucket de exports (nunca contiene datos del usuario más allá de ids). */
export const exportObjectKey = (workspaceId: string, exportId: string): string =>
  `exports/${workspaceId}/${exportId}.pfxe`;

/** Contexto autenticado (AAD) que liga la clave de datos envuelta a su export. */
export const exportKeyContext = (workspaceId: string, exportId: string): string =>
  `${workspaceId}|${exportId}`;

/**
 * Casos de uso de exportación del workspace (openspec add-workspace-export, identity/workspace-portability): solicitar,
 * ejecutar (worker), descargar, eliminar y expirar. OWNER con re-autenticación reciente para solicitar y descargar;
 * todo el ciclo auditado; el archivo se guarda SIEMPRE cifrado (sobre) y se elimina al vencer (docs/33 D102).
 */
export class WorkspaceExportService {
  constructor(private readonly deps: PortabilityDeps) {}

  // ------------------------------------------------------------------ comandos del usuario

  /**
   * `RequestWorkspaceExport` (202 + operación): solo OWNER con autenticación ≤ `REAUTH_MAX_AGE`; una exportación en curso
   * por workspace (`EXPORT_IN_PROGRESS`). Crea el export, su operación, la auditoría y el job EN la misma transacción.
   */
  async requestExport(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly authTimeSeconds: number | undefined;
  }): Promise<ExportView> {
    const { userId, workspaceId } = input;
    await this.requireOwner(userId, workspaceId);
    this.deps.reauth.assertRecent(input.authTimeSeconds, this.deps.clock.now());
    const { uow, exports, operations, ids, clock, audit, jobs, settings } = this.deps;
    return uow.run({ userId, workspaceId }, async () => {
      if (await exports.hasInProgress(workspaceId)) {
        throw new DomainError('EXPORT_IN_PROGRESS', 'the workspace already has an export in progress');
      }
      const now = clock.now();
      const exportId = ids.next();
      const operationId = ids.next();
      const record = WorkspaceExport.request({
        id: exportId,
        workspaceId,
        operationId,
        requestedBy: userId,
        formatVersion: settings.formatVersion,
        at: now,
      });
      await operations.insert({
        id: operationId,
        workspaceId,
        kind: 'EXPORT',
        resourceType: 'WorkspaceExport',
        resourceId: exportId,
        requestedBy: userId,
      });
      await exports.insert(record);
      await audit.append({
        workspaceId,
        action: 'identity.export.requested',
        aggregateType: 'WorkspaceExport',
        aggregateId: exportId,
        aggregateVersion: 1,
        changes: [
          { field: 'status', before: null, after: 'REQUESTED' },
          { field: 'formatVersion', before: null, after: settings.formatVersion },
        ],
        actor: { type: 'USER', userId },
      });
      await jobs.enqueueExport({ workspaceId, exportId, requestedBy: userId });
      return exportView(record);
    });
  }

  async listExports(userId: string, workspaceId: string): Promise<readonly ExportView[]> {
    await this.requireOwner(userId, workspaceId);
    const rows = await this.deps.uow.run({ userId, workspaceId }, () =>
      this.deps.exports.list(workspaceId, 50),
    );
    return rows.map(exportView);
  }

  async getExport(userId: string, workspaceId: string, exportId: string): Promise<ExportView> {
    await this.requireOwner(userId, workspaceId);
    return this.deps.uow.run({ userId, workspaceId }, async () => {
      const found = await this.deps.exports.find(workspaceId, exportId);
      if (!found) throw notFound();
      return exportView(found);
    });
  }

  /** `getOperation` (`kind: EXPORT`): estado y progreso de la operación asíncrona. */
  async getOperation(userId: string, workspaceId: string, operationId: string): Promise<OperationView> {
    await this.requireOwner(userId, workspaceId);
    return this.deps.uow.run({ userId, workspaceId }, async () => {
      const op = await this.deps.operations.find(workspaceId, operationId);
      if (!op) throw new DomainError('RESOURCE_NOT_FOUND', 'operation not found');
      return op;
    });
  }

  /**
   * `DownloadWorkspaceExport`: OWNER con autenticación reciente. 409 `EXPORT_NOT_READY` en curso, 410 `EXPORT_EXPIRED`
   * vencido o eliminado. Pasada 1: valida TODOS los bloques del objeto cifrado y que la suma del contenido coincida con la
   * registrada (`EXPORT_FILE_CORRUPTED` sin entregar ni un byte); se audita; pasada 2: flujo descifrado en streaming.
   */
  async download(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly exportId: string;
    readonly authTimeSeconds: number | undefined;
  }): Promise<ExportDownload> {
    const { userId, workspaceId, exportId } = input;
    await this.requireOwner(userId, workspaceId);
    this.deps.reauth.assertRecent(input.authTimeSeconds, this.deps.clock.now());
    const { uow, exports, store, cipher, clock, audit } = this.deps;
    const record = await uow.run({ userId, workspaceId }, async () => {
      const found = await exports.find(workspaceId, exportId);
      if (!found) throw notFound();
      found.assertDownloadable(clock.now());
      return found.snapshot();
    });
    const wrapped = wrappedOf(record.keyId, record.wrappedKey);
    const key = record.objectKey as string;
    const context = exportKeyContext(workspaceId, exportId);
    let verified: { sha256: string; size: number };
    try {
      verified = await cipher.verify(await store.openStream(key), wrapped, context);
    } catch (err) {
      // Objeto desaparecido (retención en curso) = vencido; cualquier otro fallo es un archivo alterado.
      if (err instanceof ObjectMissingError)
        throw new DomainError('EXPORT_EXPIRED', 'the export file is gone');
      throw err;
    }
    if (verified.sha256 !== record.sha256) {
      throw new DomainError('EXPORT_FILE_CORRUPTED', 'the export file does not match its recorded checksum');
    }
    await uow.run({ userId, workspaceId }, () =>
      audit.append({
        workspaceId,
        action: 'identity.export.downloaded',
        aggregateType: 'WorkspaceExport',
        aggregateId: exportId,
        aggregateVersion: record.version,
        changes: [
          { field: 'sha256', before: null, after: record.sha256 },
          { field: 'sizeBytes', before: null, after: verified.size },
        ],
        actor: { type: 'USER', userId },
      }),
    );
    const stream = await cipher.decryptStream(await store.openStream(key), wrapped, context);
    return {
      fileName: `pfos-export-${workspaceId.slice(0, 8)}-${(record.completedAt ?? clock.now().toString()).slice(0, 10)}.zip`,
      sha256: verified.sha256,
      size: verified.size,
      stream,
    };
  }

  /** `DiscardWorkspaceExport` (Should): elimina el archivo y conserva el registro; idempotente. */
  async discard(userId: string, workspaceId: string, exportId: string): Promise<ExportView> {
    await this.requireOwner(userId, workspaceId);
    const { uow, exports, store, clock, audit } = this.deps;
    return uow.run({ userId, workspaceId }, async () => {
      const record = await exports.find(workspaceId, exportId);
      if (!record) throw notFound();
      const expected = record.version;
      const key = record.snapshot().objectKey;
      if (record.discard(userId, clock.now())) {
        if (key) await store.delete(key);
        if (!(await exports.save(record, expected))) {
          throw new DomainError('CONCURRENCY_CONFLICT', 'the export was modified concurrently');
        }
        await audit.append({
          workspaceId,
          action: 'identity.export.discarded',
          aggregateType: 'WorkspaceExport',
          aggregateId: exportId,
          aggregateVersion: record.version,
          changes: [{ field: 'status', before: 'READY', after: 'DISCARDED' }],
          actor: { type: 'USER', userId },
        });
      }
      return exportView(record);
    });
  }

  // ------------------------------------------------------------------ comandos del worker

  /**
   * Job `identity.workspace-export`: instantánea REPEATABLE READ → ZIP → cifrado de sobre → objeto en el bucket →
   * `READY` + auditoría + `identity.WorkspaceExportCompleted.v1` en una transacción. Idempotente (un reintento sobre
   * un export ya terminado no hace nada) y sin dejar objetos huérfanos si falla.
   */
  async run(job: ExportJob): Promise<'READY' | 'FAILED' | 'SKIPPED'> {
    const { workspaceId, exportId, requestedBy } = job;
    const { uow, exports, operations, builder, cipher, store, clock, settings } = this.deps;
    const started = await uow.run({ userId: requestedBy, workspaceId }, async () => {
      const record = await exports.find(workspaceId, exportId);
      if (!record) return null;
      const before = record.version;
      if (record.status !== 'REQUESTED' && record.status !== 'RUNNING') return null;
      if (record.start()) {
        await exports.save(record, before);
        await operations.update(workspaceId, record.snapshot().operationId, {
          status: 'RUNNING',
          progressPct: 1,
        });
      }
      return record.snapshot().operationId;
    });
    if (started === null) return 'SKIPPED';
    const operationId = started;
    const objectKey = exportObjectKey(workspaceId, exportId);
    let uploaded = false;
    try {
      const exportedAt = clock.now();
      const built = await builder.build({
        workspaceId,
        requestedBy,
        exportedAt,
        onProgress: (pct) =>
          uow.run({ userId: requestedBy, workspaceId }, () =>
            operations.update(workspaceId, operationId, {
              progressPct: Math.min(95, Math.max(1, Math.round(pct))),
            }),
          ),
      });
      const sealed = await cipher.seal(built.zip, exportKeyContext(workspaceId, exportId));
      await store.put(objectKey, sealed.encrypted);
      uploaded = true;
      const sha256 = createHash('sha256').update(built.zip).digest('hex');
      await this.finish(job, operationId, {
        ok: {
          objectKey,
          sizeBytes: built.zip.length,
          sha256,
          keyId: sealed.keyId,
          wrappedKey: sealed.wrappedKey,
          counts: built.counts,
        },
        retentionMs: settings.retentionMs,
      });
      return 'READY';
    } catch (err) {
      if (uploaded) await store.delete(objectKey).catch(() => undefined);
      await this.finish(job, operationId, {
        failure: {
          code: err instanceof DomainError ? err.code : 'EXPORT_FAILED',
          // Sin contenido exportado ni detalles internos del error en el registro.
          message: err instanceof DomainError ? err.message : 'the export could not be completed',
        },
      });
      throw err;
    }
  }

  private async finish(
    job: ExportJob,
    operationId: string,
    outcome:
      | {
          readonly ok: Parameters<WorkspaceExport['complete']>[0];
          readonly retentionMs: number;
          readonly failure?: undefined;
        }
      | { readonly failure: { readonly code: string; readonly message: string }; readonly ok?: undefined },
  ): Promise<void> {
    const { workspaceId, exportId, requestedBy } = job;
    const { uow, exports, operations, audit, outbox, ids, clock } = this.deps;
    await uow.run({ userId: requestedBy, workspaceId }, async () => {
      const record = await exports.find(workspaceId, exportId);
      if (!record) return;
      const before = record.version;
      const now = clock.now();
      if (outcome.ok) record.complete(outcome.ok, now, outcome.retentionMs);
      else record.fail(outcome.failure, now);
      if (!(await exports.save(record, before))) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'the export was modified concurrently');
      }
      const view = exportView(record);
      await operations.update(
        workspaceId,
        operationId,
        outcome.ok
          ? { status: 'SUCCEEDED', progressPct: 100, result: { exportId, expiresAt: view.expiresAt } }
          : { status: 'FAILED', error: { code: outcome.failure.code } },
      );
      await audit.append({
        workspaceId,
        action: outcome.ok ? 'identity.export.completed' : 'identity.export.failed',
        aggregateType: 'WorkspaceExport',
        aggregateId: exportId,
        aggregateVersion: record.version,
        changes: (outcome.ok
          ? [
              { field: 'status', before: 'RUNNING', after: 'READY' },
              { field: 'sizeBytes', before: null, after: view.sizeBytes },
              { field: 'sha256', before: null, after: view.sha256 },
              { field: 'expiresAt', before: null, after: view.expiresAt },
            ]
          : [
              { field: 'status', before: 'RUNNING', after: 'FAILED' },
              { field: 'errorCode', before: null, after: outcome.failure.code },
            ]) as readonly AuditChangeInput[],
        actor: { type: 'SYSTEM', process: EXPORT_PROCESS },
      });
      await outbox.append({
        eventId: ids.next(),
        eventType: 'identity.WorkspaceExportCompleted',
        eventVersion: 1,
        aggregateType: 'WorkspaceExport',
        aggregateId: exportId,
        aggregateVersion: record.version,
        workspaceId,
        occurredAt: now.toString(),
        actor: { type: 'SYSTEM', id: EXPORT_PROCESS },
        payload: {
          workspaceId,
          exportId,
          status: outcome.ok ? 'READY' : 'FAILED',
          expiresAt: view.expiresAt,
          requestedBy,
        },
      });
    });
  }

  /**
   * Job horario `identity.export-retention`: elimina del bucket los archivos vencidos y los marca `EXPIRED` (actor
   * SYSTEM, auditado). El registro con fechas, tamaño y suma se conserva. Devuelve cuántos expiró. Un fallo en uno no
   * detiene el barrido (se reintenta en el siguiente).
   */
  async expireDue(limit = 100): Promise<number> {
    const { uow, exports, store, clock, audit } = this.deps;
    const now: Instant = clock.now();
    // Sin workspace en contexto: solo la política de retención del rol del worker permite leer los vencidos.
    const due = await uow.run({ userId: null, workspaceId: null }, () => exports.findExpired(now, limit));
    let expired = 0;
    for (const ref of due) {
      try {
        await uow.run({ userId: ref.requestedBy, workspaceId: ref.workspaceId }, async () => {
          const record = await exports.find(ref.workspaceId, ref.exportId);
          if (!record) return;
          const before = record.version;
          const key = record.snapshot().objectKey;
          if (!record.expire(now)) return;
          if (key) await store.delete(key);
          if (!(await exports.save(record, before))) return;
          await audit.append({
            workspaceId: ref.workspaceId,
            action: 'identity.export.expired',
            aggregateType: 'WorkspaceExport',
            aggregateId: ref.exportId,
            aggregateVersion: record.version,
            changes: [{ field: 'status', before: 'READY', after: 'EXPIRED' }],
            actor: { type: 'SYSTEM', process: EXPORT_RETENTION_PROCESS },
          });
          expired += 1;
        });
      } catch {
        // Se reintenta en el siguiente barrido; el objeto ya borrado se trata como vencido en la descarga.
      }
    }
    return expired;
  }

  // ------------------------------------------------------------------ helpers

  private async requireOwner(userId: string, workspaceId: string): Promise<void> {
    const role: Role | null = await this.deps.uow.run({ userId, workspaceId: null }, () =>
      this.deps.memberships.activeRole(userId, workspaceId),
    );
    if (!role) throw accessDenied();
    if (role !== 'OWNER') {
      throw new DomainError('INSUFFICIENT_ROLE', `role ${role} does not grant workspace:admin`);
    }
  }
}

function wrappedOf(keyId: string | null, wrappedKey: Uint8Array | null): WrappedDataKey {
  if (keyId === null || wrappedKey === null) {
    throw new DomainError('EXPORT_FILE_CORRUPTED', 'the export has no key material');
  }
  return { keyId, wrappedKey };
}
