import { DomainError } from '@pf/shared-kernel';
import type { Document } from '../domain/document.js';
import type { DocumentsDeps } from './ports/index.js';

export const notFound = (): DomainError => new DomainError('RESOURCE_NOT_FOUND', 'document not found');

export const preconditionFailed = (currentVersion?: number): DomainError =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

export function assertVersion(doc: Document, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && doc.version !== expectedVersion) throw preconditionFailed(doc.version);
}

/** Bloquea el documento o lanza `RESOURCE_NOT_FOUND` (también para el de otro workspace: RLS). */
export async function lockDocument(deps: DocumentsDeps, workspaceId: string, id: string): Promise<Document> {
  const doc = await deps.documents.findById(workspaceId, id, { lock: 'update' });
  if (!doc) throw notFound();
  return doc;
}

/** Guarda con control optimista; un cambio concurrente ⇒ `PRECONDITION_FAILED`. */
export async function persist(deps: DocumentsDeps, doc: Document): Promise<void> {
  if (!(await deps.documents.save(doc))) throw preconditionFailed(doc.version);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
