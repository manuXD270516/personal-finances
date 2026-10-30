import type { LifecycleDto } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import { DOCUMENT_LIFECYCLE } from '../domain/document.js';
import {
  isOneOf,
  ATTACHMENT_TARGET_TYPES,
  type AttachmentTargetType,
  DOCUMENT_PURPOSES,
  DOCUMENT_STATUSES,
} from '../domain/types.js';
import type { ArchivedFilter, DocumentFilter, DocumentsDeps } from './ports/index.js';
import { isUuid, notFound } from './support.js';
import { documentView, type DocumentView } from './views.js';

export interface ListDocumentsQuery {
  readonly purpose?: string | undefined;
  readonly status?: string | undefined;
  readonly archived?: string | undefined;
  readonly targetType?: string | undefined;
  readonly targetId?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface UsageView {
  readonly usedBytes: number;
  readonly reservedBytes: number;
  readonly quotaBytes: number;
  readonly pendingUploads: number;
  readonly maxPendingUploads: number;
}

const bad = (pointer: string): DomainError =>
  new DomainError('VALIDATION_FAILED', 'invalid query').at(pointer);

/** Consultas puras (VIEWER+): bajo RLS, nunca devuelven documentos de otro workspace. */
export class DocumentsQueries {
  constructor(private readonly deps: DocumentsDeps) {}

  async get(workspaceId: string, documentId: string): Promise<DocumentView> {
    return this.deps.uow.run(workspaceId, async () => {
      const doc = await this.deps.documents.findById(workspaceId, documentId);
      if (!doc) throw notFound();
      const links = await this.deps.links.linksOf(workspaceId, [doc.id]);
      return documentView(doc, links.get(doc.id) ?? []);
    });
  }

  async list(
    workspaceId: string,
    query: ListDocumentsQuery,
  ): Promise<{ items: readonly DocumentView[]; nextCursor: string | null; limit: number }> {
    const filter = this.parse(query);
    return this.deps.uow.run(workspaceId, async () => {
      const page = await this.deps.documents.list(workspaceId, filter);
      const links = await this.deps.links.linksOf(
        workspaceId,
        page.items.map((d) => d.id),
      );
      return {
        items: page.items.map((d) => documentView(d, links.get(d.id) ?? [])),
        nextCursor: page.nextCursor,
        limit: filter.limit ?? 50,
      };
    });
  }

  private parse(q: ListDocumentsQuery): DocumentFilter {
    if (q.purpose !== undefined && !isOneOf(DOCUMENT_PURPOSES, q.purpose)) throw bad('/purpose');
    if (q.status !== undefined && !isOneOf(DOCUMENT_STATUSES, q.status)) throw bad('/status');
    if (q.targetType !== undefined && !isOneOf(ATTACHMENT_TARGET_TYPES, q.targetType))
      throw bad('/targetType');
    if ((q.targetType === undefined) !== (q.targetId === undefined)) throw bad('/targetId');
    if (q.targetId !== undefined && !isUuid(q.targetId)) throw bad('/targetId');
    const archived: ArchivedFilter =
      q.archived === 'only' ? 'ONLY' : q.archived === 'include' ? 'INCLUDE' : 'EXCLUDE';
    return {
      ...(q.purpose ? { purpose: q.purpose as NonNullable<DocumentFilter['purpose']> } : {}),
      ...(q.status ? { status: q.status as NonNullable<DocumentFilter['status']> } : {}),
      archived,
      ...(q.targetType && q.targetId
        ? { target: { type: q.targetType as AttachmentTargetType, id: q.targetId } }
        : {}),
      ...(q.cursor ? { cursor: q.cursor } : {}),
      limit: Math.min(Math.max(q.limit ?? 50, 1), 200),
    };
  }

  async usage(workspaceId: string): Promise<UsageView> {
    const { deps } = this;
    const u = await deps.uow.run(workspaceId, () => deps.usage.read(workspaceId));
    return {
      usedBytes: u.usedBytes,
      reservedBytes: u.reservedBytes,
      quotaBytes: deps.settings.quota.quotaBytes,
      pendingUploads: u.pendingUploads,
      maxPendingUploads: deps.settings.quota.maxPendingUploads,
    };
  }

  async lifecycle(input: { userId: string; workspaceId: string; documentId: string }): Promise<LifecycleDto> {
    const { deps } = this;
    if (!deps.lifecycleQuery) throw new DomainError('INTERNAL_ERROR', 'lifecycle query is not composed');
    const query = deps.lifecycleQuery;
    return deps.uow.run(input.workspaceId, async () => {
      const doc = await deps.documents.findById(input.workspaceId, input.documentId);
      if (!doc) throw notFound();
      return query.lifecycleOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateType: DOCUMENT_LIFECYCLE.aggregateType as 'Document',
        aggregateId: doc.id,
        currentState: doc.status,
      });
    });
  }
}
