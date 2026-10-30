import type { AuditActorDto, AuditEntry } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import type { AttachmentCommand } from '../contracts/index.js';
import type { Document } from '../domain/document.js';
import { assertLinkCapacity } from '../domain/storage-quota.js';
import { ATTACHMENT_TARGET_TYPES, isOneOf, type AttachmentTargetType } from '../domain/types.js';
import type { DocumentsDeps, LinkRecord } from './ports/index.js';
import { DOCUMENT_AGGREGATE } from './recorder.js';
import { isUuid, lockDocument, persist } from './support.js';

export interface LinkCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly documentId: string;
  readonly targetType: unknown;
  readonly targetId: unknown;
}

export interface UnlinkCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly documentId: string;
  readonly linkId: string;
}

export interface LinkView {
  readonly id: string;
  readonly documentId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly createdAt: string;
}

const linkView = (l: LinkRecord): LinkView => ({
  id: l.id,
  documentId: l.documentId,
  targetType: l.targetType,
  targetId: l.targetId,
  createdAt: l.createdAt,
});

/**
 * Vínculos N:M entre documentos y elementos del workspace (FR-DOCUMENTS-003; design decisión 9). Vincular y
 * desvincular NO consulta el periodo: un comprobante tardío de un mes cerrado se adjunta igual (D65) y ningún asiento
 * cambia. Los vínculos son anotaciones del recorrido del documento. Implementa también `AttachmentCommand`, el contrato
 * público para IMPORTS, en la unidad de trabajo del llamador.
 */
export class AttachmentsService {
  constructor(private readonly deps: DocumentsDeps) {}

  private entry(doc: Document, action: string, link: LinkRecord, actor?: AuditActorDto): AuditEntry {
    return {
      workspaceId: doc.workspaceId,
      action: `documents.attachment.${action}`,
      aggregateType: DOCUMENT_AGGREGATE,
      aggregateId: doc.id,
      aggregateVersion: doc.version,
      changes: [
        { field: 'targetType', before: null, after: link.targetType },
        { field: 'targetId', before: null, after: link.targetId },
        { field: 'linkId', before: null, after: link.id },
      ],
      ...(actor ? { actor } : {}),
    };
  }

  async link(cmd: LinkCommand): Promise<{ link: LinkView; created: boolean }> {
    const { deps } = this;
    const { workspaceId } = cmd;
    if (!isOneOf(ATTACHMENT_TARGET_TYPES, cmd.targetType)) {
      throw new DomainError('VALIDATION_FAILED', 'unsupported target type').at('/targetType');
    }
    if (!isUuid(cmd.targetId))
      throw new DomainError('VALIDATION_FAILED', 'invalid target id').at('/targetId');
    const targetType = cmd.targetType;
    const targetId = cmd.targetId;

    return deps.uow.run(workspaceId, async () => {
      const doc = await lockDocument(deps, workspaceId, cmd.documentId);
      // DOCUMENT_NOT_AVAILABLE / DOCUMENT_REJECTED / DOCUMENT_DELETED, sin crear el vínculo.
      doc.assertLinkable();
      const existing = await deps.links.find(workspaceId, doc.id, targetType, targetId);
      if (existing) return { link: linkView(existing), created: false };
      const found = await deps.targets.existing(workspaceId, targetType, [targetId]);
      if (!found.has(targetId)) {
        throw new DomainError('REFERENCE_NOT_FOUND', 'attachment target not found').at('/targetId');
      }
      const siblings = await deps.links.lockTarget(workspaceId, targetType, targetId);
      assertLinkCapacity(siblings.length, deps.settings.maxLinksPerTarget);
      const link: LinkRecord = {
        id: deps.ids.next(),
        workspaceId,
        documentId: doc.id,
        targetType,
        targetId,
        createdBy: cmd.userId,
        createdAt: deps.clock.now().toString(),
      };
      await deps.links.insert(link);
      await deps.lifecycle.record(this.entry(doc, 'linked', link), [
        { kind: 'ANNOTATION', changedFields: ['links'] },
      ]);
      return { link: linkView(link), created: true };
    });
  }

  async unlink(cmd: UnlinkCommand): Promise<void> {
    const { deps } = this;
    const { workspaceId } = cmd;
    await deps.uow.run(workspaceId, async () => {
      const doc = await lockDocument(deps, workspaceId, cmd.documentId);
      const link = await deps.links.findById(workspaceId, doc.id, cmd.linkId);
      if (!link) throw new DomainError('RESOURCE_NOT_FOUND', 'attachment link not found');
      await this.remove(doc, link);
    });
  }

  /** Quita el vínculo y, si fue el último, inicia el plazo de la purga (`last_unlinked_at`). */
  private async remove(doc: Document, link: LinkRecord, actor?: AuditActorDto): Promise<void> {
    const { deps } = this;
    await deps.links.delete(doc.workspaceId, link.id);
    if (doc.status === 'AVAILABLE' && (await deps.links.countOf(doc.workspaceId, doc.id)) === 0) {
      doc.markUnlinked(deps.clock.now().toString());
      await persist(deps, doc);
    }
    await deps.lifecycle.record(this.entry(doc, 'unlinked', link, actor), [
      { kind: 'ANNOTATION', changedFields: ['links'] },
    ]);
  }

  // ───────────────────────────────────────────────────────────── contrato público para IMPORTS

  async linkTo(input: Parameters<AttachmentCommand['link']>[0]) {
    const out = await this.link({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      documentId: input.documentId,
      targetType: input.targetType,
      targetId: input.targetId,
    });
    return { linkId: out.link.id, created: out.created };
  }

  async unlinkFrom(input: Parameters<AttachmentCommand['unlink']>[0]) {
    const { deps } = this;
    return deps.uow.run(input.workspaceId, async () => {
      const doc = await lockDocument(deps, input.workspaceId, input.documentId);
      const link = await deps.links.find(
        input.workspaceId,
        doc.id,
        input.targetType,
        input.targetId as string,
      );
      if (!link) return { removed: false };
      await this.remove(doc, link);
      return { removed: true };
    });
  }

  /** Adaptador del contrato `AttachmentCommand` (los nombres `link`/`unlink` del contrato difieren de los HTTP). */
  asCommand(): AttachmentCommand {
    return {
      link: (i) => this.linkTo(i),
      unlink: (i) => this.unlinkFrom(i),
    };
  }
}

export type { AttachmentTargetType };
