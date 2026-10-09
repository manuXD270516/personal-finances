import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, type Instant } from '@pf/shared-kernel';
import { WorkspaceImport } from '../../domain/workspace-import.js';
import type { ImportJob, PortabilityDeps } from './ports.js';

export const IMPORT_PROCESS = 'identity.workspace-import';

/** Estado observable de una importación (`WorkspaceImport` del contrato). */
export interface ImportView {
  readonly id: string;
  readonly status: WorkspaceImport['status'];
  readonly sourceWorkspaceId: string;
  readonly sourceExportedAt: string;
  readonly formatVersion: number;
  readonly sizeBytes: number;
  /** Workspace nuevo (solo cuando `SUCCEEDED`). */
  readonly workspaceId: string | null;
  readonly counts: Readonly<Record<string, number>>;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export const importView = (i: WorkspaceImport): ImportView => {
  const p = i.snapshot();
  const counts = (p.report['counts'] ?? {}) as Record<string, number>;
  return {
    id: p.id,
    status: p.status,
    sourceWorkspaceId: p.sourceWorkspaceId,
    sourceExportedAt: p.sourceExportedAt,
    formatVersion: p.formatVersion,
    sizeBytes: p.sizeBytes,
    workspaceId: p.targetWorkspaceId,
    counts,
    errorCode: p.error?.code ?? null,
    createdAt: p.createdAt,
    completedAt: p.completedAt,
  };
};

/** Clave del archivo subido en el bucket de exports (cifrado; se elimina al terminar). */
export const importObjectKey = (userId: string, importId: string): string =>
  `imports/${userId}/${importId}.pfxe`;
export const importKeyContext = (userId: string, importId: string): string => `import|${userId}|${importId}`;

const notFound = () => new DomainError('RESOURCE_NOT_FOUND', 'import not found');

/**
 * Casos de uso de importación (openspec add-workspace-export, FR-IDENTITY-017): un usuario autenticado recientemente
 * sube un export válido y obtiene un workspace NUEVO del que es OWNER, con identificadores nuevos. Nunca escribe en un
 * workspace existente. La validación previa (manifiesto, versión, demo, hashes) es síncrona y no crea nada; la
 * importación es una sola transacción con verificación contra el manifiesto.
 */
export class WorkspaceImportService {
  constructor(private readonly deps: PortabilityDeps) {}

  /** `RequestWorkspaceImport` (202): valida, guarda el archivo cifrado, registra la importación y encola el job. */
  async requestImport(input: {
    readonly userId: string;
    readonly file: Buffer;
    readonly authTimeSeconds: number | undefined;
  }): Promise<ImportView> {
    const { userId, file } = input;
    const { uow, imports, store, cipher, inspector, ids, clock, jobs, settings } = this.deps;
    this.deps.reauth.assertRecent(input.authTimeSeconds, clock.now());
    if (file.length > settings.maxImportBytes) {
      throw new DomainError('UPLOAD_TOO_LARGE', `the file exceeds ${settings.maxImportBytes} bytes`);
    }
    let manifest;
    try {
      manifest = inspector.inspect(file);
    } catch (err) {
      await this.auditRejected(userId, file.length, err);
      throw err;
    }
    const importId = ids.next();
    const key = importObjectKey(userId, importId);
    const sealed = await cipher.seal(file, importKeyContext(userId, importId));
    await store.put(key, sealed.encrypted);
    try {
      return await uow.run({ userId, workspaceId: null }, async () => {
        if (await imports.hasInProgress(userId)) {
          throw new DomainError('IMPORT_IN_PROGRESS', 'an import is already in progress');
        }
        const record = WorkspaceImport.receive({
          id: importId,
          requestedBy: userId,
          objectKey: key,
          keyId: sealed.keyId,
          wrappedKey: sealed.wrappedKey,
          sizeBytes: file.length,
          sourceWorkspaceId: manifest.workspaceId,
          sourceExportedAt: manifest.exportedAt,
          formatVersion: manifest.formatVersion,
          at: clock.now(),
        });
        await imports.insert(record);
        await this.auditInHome(userId, {
          action: 'identity.import.requested',
          aggregateId: importId,
          changes: [
            { field: 'status', before: null, after: 'RECEIVED' },
            { field: 'sourceWorkspaceId', before: null, after: manifest.workspaceId },
            { field: 'sizeBytes', before: null, after: file.length },
            { field: 'formatVersion', before: null, after: manifest.formatVersion },
          ],
        });
        await jobs.enqueueImport({ importId, requestedBy: userId });
        return importView(record);
      });
    } catch (err) {
      await store.delete(key).catch(() => undefined);
      throw err;
    }
  }

  async getImport(userId: string, importId: string): Promise<ImportView> {
    return this.deps.uow.run({ userId, workspaceId: null }, async () => {
      const found = await this.deps.imports.find(userId, importId);
      if (!found) throw notFound();
      return importView(found);
    });
  }

  /**
   * Job `identity.workspace-import`: descifra el archivo, valida cada registro y, en UNA transacción, crea el workspace
   * nuevo, inserta la historia con ids remapeados, verifica saldos y balance contra el manifiesto, audita
   * (`identity.workspace.restored`) y publica `identity.WorkspaceRestored.v1`. Si algo falla, rollback completo.
   */
  async run(job: ImportJob): Promise<'SUCCEEDED' | 'FAILED' | 'SKIPPED'> {
    const { importId, requestedBy: userId } = job;
    const { uow, imports, store, cipher, importer, clock, ids, outbox, audit, settings } = this.deps;
    const snapshot = await uow.run({ userId, workspaceId: null }, async () => {
      const record = await imports.find(userId, importId);
      if (!record || !record.inProgress) return null;
      if (record.status === 'RECEIVED') {
        record.advance('VALIDATING');
        await imports.save(record);
      }
      return record.snapshot();
    });
    if (snapshot === null) return 'SKIPPED';
    const key = snapshot.objectKey;
    try {
      if (key === null || snapshot.keyId === null || snapshot.wrappedKey === null) {
        throw new DomainError('EXPORT_FILE_CORRUPTED', 'the import has no stored file');
      }
      const encrypted = await store.get(key);
      const zip = await cipher.open(
        encrypted,
        { keyId: snapshot.keyId, wrappedKey: snapshot.wrappedKey },
        importKeyContext(userId, importId),
      );
      // Paso visible para la UI: IMPORTING se confirma antes de la transacción larga.
      await uow.run({ userId, workspaceId: null }, async () => {
        const record = await imports.find(userId, importId);
        if (record && record.status === 'VALIDATING') {
          record.advance('IMPORTING');
          await imports.save(record);
        }
      });
      const view = await uow.run({ userId, workspaceId: null }, async () => {
        const record = (await imports.find(userId, importId)) as WorkspaceImport;
        const home = await this.homeWorkspaceOf(userId);
        const newWorkspaceId = ids.next();
        const manifest = this.deps.inspector.inspect(zip);
        const outcome = await importer.importInto({
          zip,
          userId,
          importId,
          newWorkspaceId,
          name: `${manifest.workspaceName}${settings.restoredSuffix}`.slice(0, 100),
          onStep: () => undefined,
        });
        const now: Instant = clock.now();
        await uow.bind({ userId, workspaceId: outcome.workspaceId });
        await audit.append({
          workspaceId: outcome.workspaceId,
          action: 'identity.workspace.restored',
          aggregateType: 'Workspace',
          aggregateId: outcome.workspaceId,
          aggregateVersion: 1,
          changes: [
            { field: 'sourceWorkspaceId', before: null, after: manifest.workspaceId },
            { field: 'importId', before: null, after: importId },
            { field: 'formatVersion', before: null, after: manifest.formatVersion },
          ],
          actor: { type: 'USER', userId },
        });
        await outbox.append({
          eventId: ids.next(),
          eventType: 'identity.WorkspaceRestored',
          eventVersion: 1,
          aggregateType: 'Workspace',
          aggregateId: outcome.workspaceId,
          aggregateVersion: 1,
          workspaceId: outcome.workspaceId,
          occurredAt: now.toString(),
          actor: { type: 'USER', id: userId },
          payload: {
            workspaceId: outcome.workspaceId,
            importId,
            sourceWorkspaceId: manifest.workspaceId,
            sourceExportedAt: manifest.exportedAt,
          },
        });
        if (record.status === 'VALIDATING') record.advance('IMPORTING');
        record.advance('VERIFYING');
        record.succeed(outcome.workspaceId, outcome.report, now);
        await imports.save(record);
        if (home) {
          await uow.bind({ userId, workspaceId: home });
          await audit.append({
            workspaceId: home,
            action: 'identity.import.succeeded',
            aggregateType: 'WorkspaceImport',
            aggregateId: importId,
            changes: [
              { field: 'status', before: 'IMPORTING', after: 'SUCCEEDED' },
              { field: 'targetWorkspaceId', before: null, after: outcome.workspaceId },
            ],
            actor: { type: 'USER', userId },
          });
        }
        return importView(record);
      });
      await store.delete(key).catch(() => undefined);
      return view.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED';
    } catch (err) {
      const code = err instanceof DomainError ? err.code : 'IMPORT_FAILED';
      const message = err instanceof DomainError ? err.message : 'the import could not be completed';
      await uow
        .run({ userId, workspaceId: null }, async () => {
          const record = await imports.find(userId, importId);
          if (record?.inProgress) {
            record.fail({ code, message }, clock.now());
            await imports.save(record);
            await this.auditInHome(userId, {
              action: 'identity.import.failed',
              aggregateId: importId,
              changes: [
                { field: 'status', before: 'IMPORTING', after: 'FAILED' },
                { field: 'errorCode', before: null, after: code },
              ],
            });
          }
        })
        .catch(() => undefined);
      if (key !== null) await store.delete(key).catch(() => undefined);
      // Un archivo corrupto o una verificación fallida son resultados finales (reintentar no cambia nada).
      if (err instanceof DomainError) return 'FAILED';
      throw err;
    }
  }

  // ------------------------------------------------------------------ helpers

  /** Workspace hogar del usuario (la membresía activa más antigua): allí se audita lo que no pertenece a un workspace. */
  private async homeWorkspaceOf(userId: string): Promise<string | null> {
    const first = await this.deps.workspaces.listForUser(userId, { limit: 1 });
    return first[0]?.id ?? null;
  }

  private async auditInHome(
    userId: string,
    entry: {
      readonly action: string;
      readonly aggregateId: string;
      readonly changes: readonly AuditChangeInput[];
    },
  ): Promise<void> {
    const home = await this.homeWorkspaceOf(userId);
    if (!home) return;
    await this.deps.uow.bind({ userId, workspaceId: home });
    await this.deps.audit.append({
      workspaceId: home,
      action: entry.action,
      aggregateType: 'WorkspaceImport',
      aggregateId: entry.aggregateId,
      changes: entry.changes,
      actor: { type: 'USER', userId },
    });
    await this.deps.uow.bind({ userId, workspaceId: null });
  }

  /** Solicitud rechazada en la validación previa: queda auditada SIN el contenido del archivo. */
  private async auditRejected(userId: string, sizeBytes: number, err: unknown): Promise<void> {
    const code = err instanceof DomainError ? err.code : 'EXPORT_FILE_CORRUPTED';
    // Detached: la solicitud rechazada lanza y revierte la transacción del comando; la auditoría debe sobrevivir.
    await this.deps.uow
      .runDetached({ userId, workspaceId: null }, () =>
        this.auditInHome(userId, {
          action: 'identity.import.rejected',
          aggregateId: this.deps.ids.next(),
          changes: [
            { field: 'errorCode', before: null, after: code },
            { field: 'sizeBytes', before: null, after: sizeBytes },
          ],
        }),
      )
      .catch(() => undefined);
  }
}
