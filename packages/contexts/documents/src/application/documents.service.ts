import type { AuditActorDto } from '@pf/audit/contracts';
import type { Document } from '../domain/document.js';
import { free } from '../domain/storage-quota.js';
import { wrapContextOf, type DocumentsDeps } from './ports/index.js';
import { documentChanges, documentEntry, documentSteps } from './recorder.js';
import { assertVersion, lockDocument, persist } from './support.js';
import { documentView, type DocumentView } from './views.js';

export interface DocumentActionCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly documentId: string;
  readonly expectedVersion?: number | undefined;
}

/**
 * Archivar, desarchivar y eliminar (FR-DOCUMENTS-007; design decisiones 6 y 10). Cada comando corre en UNA unidad de
 * trabajo con el documento bloqueado y deja auditoría y recorrido en ella (INV-029). Eliminar es crypto-shredding: la
 * clave de datos envuelta se destruye en la MISMA unidad de trabajo y después se borra el objeto y todas sus versiones.
 */
export class DocumentsService {
  constructor(private readonly deps: DocumentsDeps) {}

  async archive(cmd: DocumentActionCommand): Promise<DocumentView> {
    return this.annotateArchive(cmd, 'archived');
  }

  async unarchive(cmd: DocumentActionCommand): Promise<DocumentView> {
    return this.annotateArchive(cmd, 'unarchived');
  }

  private async annotateArchive(
    cmd: DocumentActionCommand,
    action: 'archived' | 'unarchived',
  ): Promise<DocumentView> {
    const { deps } = this;
    const { workspaceId } = cmd;
    return deps.uow.run(workspaceId, async () => {
      const doc = await lockDocument(deps, workspaceId, cmd.documentId);
      assertVersion(doc, cmd.expectedVersion);
      const before = doc.snapshot;
      const at = deps.clock.now().toString();
      if (action === 'archived') doc.archive(cmd.userId, at);
      else doc.unarchive(at);
      if (doc.version !== before.version) {
        await persist(deps, doc);
        await deps.lifecycle.record(
          documentEntry(doc, action, documentChanges(before, doc.snapshot)),
          documentSteps(doc, [], { changedFields: ['archivedAt'] }),
        );
      }
      const links = await deps.links.linksOf(workspaceId, [doc.id]);
      return documentView(doc, links.get(doc.id) ?? []);
    });
  }

  /** Elimina a pedido del usuario. */
  async delete(cmd: DocumentActionCommand): Promise<void> {
    await this.remove(cmd.workspaceId, cmd.documentId, {
      by: cmd.userId,
      expectedVersion: cmd.expectedVersion,
      mode: 'USER',
    });
  }

  /** Elimina por mantenimiento (purga de documentos sin vínculo, actor `SYSTEM`). Devuelve `false` si ya no aplica. */
  async purge(workspaceId: string, documentId: string, process: string): Promise<boolean> {
    return this.remove(workspaceId, documentId, {
      by: process,
      expectedVersion: undefined,
      mode: 'PURGE',
      actor: { type: 'SYSTEM', process },
    });
  }

  private async remove(
    workspaceId: string,
    documentId: string,
    options: {
      readonly by: string;
      readonly expectedVersion: number | undefined;
      readonly mode: 'USER' | 'PURGE';
      readonly actor?: AuditActorDto;
    },
  ): Promise<boolean> {
    const { deps } = this;
    let objectKey: string | null = null;
    const removed = await deps.uow.run(workspaceId, async () => {
      const doc: Document = await lockDocument(deps, workspaceId, documentId);
      assertVersion(doc, options.expectedVersion);
      if (options.mode === 'PURGE') {
        // Una purga se evalúa de nuevo bajo bloqueo: el estado pudo cambiar desde el barrido (vínculo nuevo, archivado).
        const s = doc.snapshot;
        const cutoff = deps.clock.now().epochMillis - deps.settings.unlinkedRetentionMs;
        const since = Date.parse(s.lastUnlinkedAt ?? s.availableAt ?? s.createdAt);
        if (doc.status !== 'AVAILABLE' || s.archivedAt !== null || since >= cutoff) return false;
        if ((await deps.links.countOf(workspaceId, doc.id)) > 0) return false;
      }
      const before = doc.snapshot;
      objectKey = before.objectKey;
      const at = deps.clock.now().toString();
      doc.delete(options.by, at, options.mode);
      await persist(deps, doc);
      const dropped = await deps.links.deleteAllOf(workspaceId, doc.id);
      const usage = await deps.usage.lock(workspaceId);
      await deps.usage.save(workspaceId, free(usage, before.sizeBytes), at);
      await deps.lifecycle.record(
        documentEntry(
          doc,
          options.mode === 'PURGE' ? 'purged' : 'deleted',
          documentChanges(before, doc.snapshot),
          {
            ...(options.actor ? { actor: options.actor } : {}),
          },
        ),
        documentSteps(doc, [], dropped.length > 0 ? { detailRefs: { linksRemoved: dropped.length } } : {}),
      );
      return true;
    });
    // Después de confirmar la destrucción de la clave: el objeto y sus versiones. Si falla, `SweepOrphanObjects` lo
    // borra (el contenido ya es ilegible sin la clave).
    if (removed && objectKey) {
      try {
        await deps.storage.deleteAllVersions(deps.settings.documentsBucket, objectKey);
      } catch {
        // Barrido de huérfanos.
      }
    }
    return removed;
  }

  /** Re-envuelve las claves de datos con la clave activa (rotación), en lotes; no toca el contenido. */
  async rewrapOne(workspaceId: string, documentId: string): Promise<boolean> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const doc = await deps.documents.findById(workspaceId, documentId, { lock: 'update' });
      if (!doc) return false;
      const s = doc.snapshot;
      if (!s.wrappedKey || !s.keyId || s.keyId === deps.cipher.activeKeyId) return false;
      const rewrapped = await deps.cipher.rewrap(
        { keyId: s.keyId, wrappedKey: s.wrappedKey },
        wrapContextOf(workspaceId, doc.id),
      );
      doc.rewrapKey(rewrapped);
      if (!(await deps.documents.saveKey(doc))) return false;
      return true;
    });
  }
}
