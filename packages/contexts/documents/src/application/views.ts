import type { Document } from '../domain/document.js';
import type { LinkRecord } from './ports/index.js';

/** `Document` del contrato OpenAPI. No expone claves, claves de objeto ni envoltorios. */
export interface DocumentView {
  readonly id: string;
  readonly purpose: string;
  readonly status: string;
  readonly originalName: string;
  readonly extension: string;
  readonly declaredContentType: string;
  readonly detectedContentType: string | null;
  readonly detectedFormat: string | null;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly scanStatus: string | null;
  readonly rejectionReason: string | null;
  readonly uploadExpiresAt: string | null;
  readonly availableAt: string | null;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly links: readonly { id: string; targetType: string; targetId: string; createdAt: string }[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly version: number;
}

export function documentView(doc: Document, links: readonly LinkRecord[] = []): DocumentView {
  const s = doc.snapshot;
  return {
    id: s.id,
    purpose: s.purpose,
    status: s.status,
    originalName: s.originalName,
    extension: s.extension,
    declaredContentType: s.declaredContentType,
    detectedContentType: s.detectedContentType,
    detectedFormat: s.detectedFormat,
    sizeBytes: s.sizeBytes,
    sha256: s.sha256,
    scanStatus: s.scanStatus,
    rejectionReason: s.rejectionReason,
    uploadExpiresAt: s.status === 'PENDING_UPLOAD' ? s.uploadExpiresAt : null,
    availableAt: s.availableAt,
    archivedAt: s.archivedAt,
    deletedAt: s.deletedAt,
    links: links.map((l) => ({
      id: l.id,
      targetType: l.targetType,
      targetId: l.targetId,
      createdAt: l.createdAt,
    })),
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    version: s.version,
  };
}

export interface UploadInstructions {
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}
