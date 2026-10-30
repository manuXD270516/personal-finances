/**
 * API pública de `@pf/documents` (openspec add-document-attachments § Contratos; ADR-0003). Hoja: no importa capas
 * internas. Ningún contexto importa el dominio de DOCUMENTS: IMPORTS lee y vincula extractos solo por estos puertos
 * (design decisión 14).
 */
import type { Readable } from 'node:stream';
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';

export const DOCUMENTS_CONTEXT = 'documents' as const;

/** Eventos publicados por el outbox (contracts/events/documents/*.v1.schema.json). Sin consumidores obligatorios. */
export const DOCUMENTS_EVENTS = {
  attachmentUploaded: { eventType: 'documents.AttachmentUploaded', eventVersion: 1 },
  documentRejected: { eventType: 'documents.DocumentRejected', eventVersion: 1 },
} as const;

/** Jobs periódicos del worker (cron `DOCUMENT_MAINTENANCE_CRON`; sin consumidores nuevos, decisión 3). */
export const DOCUMENTS_MAINTENANCE_JOB = 'documents.maintenance' as const;
/** Cola de la restauración del archivo de contenidos del export (tarea 8.3). */
export const DOCUMENT_CONTENTS_RESTORE_JOB = 'documents.content-restore' as const;
/** Nombre de la primera entrada del archivo de contenidos (índice con `documentId`, `sha256` y `sizeBytes`). */
export const DOCUMENT_CONTENTS_MANIFEST = 'documents-manifest.json' as const;

export type DocumentPurposeDto = 'RECEIPT' | 'INVOICE' | 'STATEMENT' | 'CONTRACT' | 'IMPORT_SOURCE' | 'OTHER';
export type DocumentStatusDto =
  | 'PENDING_UPLOAD'
  | 'UPLOADED'
  | 'AVAILABLE'
  | 'REJECTED'
  | 'DELETED'
  | 'CONTENT_PENDING';
export type DocumentFormatDto =
  | 'PDF'
  | 'PNG'
  | 'JPEG'
  | 'WEBP'
  | 'HEIC'
  | 'CSV'
  | 'OFX'
  | 'QIF'
  | 'JSON'
  | 'XLSX';
export type AttachmentTargetTypeDto =
  | 'TRANSACTION'
  | 'CONVERSION'
  | 'LOAN'
  | 'SUBSCRIPTION'
  | 'ACCOUNT'
  | 'IMPORT_JOB'
  | 'MONTH_CLOSING';

// ───────────────────────────────────────────── eventos (payloads)

/** `documents.AttachmentUploaded.v1`: el documento quedó disponible. Sin nombre original. */
export interface AttachmentUploadedV1 {
  readonly documentId: string;
  readonly purpose: DocumentPurposeDto;
  readonly contentType: string;
  readonly format: DocumentFormatDto;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly scanStatus: 'NOT_SCANNED' | 'CLEAN';
}

/** `documents.DocumentRejected.v1`: el documento quedó rechazado. */
export interface DocumentRejectedV1 {
  readonly documentId: string;
  readonly purpose: DocumentPurposeDto;
  readonly reason: string;
}

// ───────────────────────────────────────────── errores públicos

/** El documento no está disponible para leerse (pendiente, rechazado, eliminado o con contenido por restaurar). */
export class DocumentNotAvailableError extends DomainError {
  constructor(code: 'DOCUMENT_NOT_AVAILABLE' | 'DOCUMENT_REJECTED' | 'DOCUMENT_DELETED' = 'DOCUMENT_NOT_AVAILABLE') {
    super(code, 'the document is not available');
  }
}

/** Contenido alterado en el almacenamiento (tag de bloque inválido, cabecera ilegible o clave inaccesible). */
export class DocumentIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentIntegrityError';
  }
}

// ───────────────────────────────────────────── puertos públicos (decisión 14)

export interface DocumentForProcessingDto {
  readonly documentId: string;
  readonly status: DocumentStatusDto;
  readonly purpose: DocumentPurposeDto;
  readonly detectedFormat: DocumentFormatDto | null;
  readonly detectedContentType: string | null;
  readonly sizeBytes: number;
  /** SHA-256 en hexadecimal. */
  readonly sha256: string;
  /** Solo para mostrar; nunca para registrar en logs. */
  readonly originalName: string;
  readonly availableAt: string | null;
}

export interface DocumentQuery {
  /** `null` si no existe en el workspace (RLS). */
  getForProcessing(input: {
    readonly workspaceId: string;
    readonly documentId: string;
  }): Promise<DocumentForProcessingDto | null>;
}

export interface DocumentContentReader {
  /**
   * Flujo del contenido original, verificado por bloque (memoria O(64 KiB)). Solo documentos `AVAILABLE`; si no,
   * `DocumentNotAvailableError`. Una alteración destruye el flujo con `DocumentIntegrityError` sin emitir el bloque.
   */
  open(input: { readonly workspaceId: string; readonly documentId: string }): Promise<Readable>;
}

export interface AttachmentCommand {
  /** En la unidad de trabajo del llamador (la transacción ambiental): idempotente y auditado. */
  link(input: {
    readonly workspaceId: string;
    readonly documentId: string;
    readonly targetType: AttachmentTargetTypeDto;
    readonly targetId: string;
    readonly actorUserId: string;
  }): Promise<{ readonly linkId: string; readonly created: boolean }>;
  unlink(input: {
    readonly workspaceId: string;
    readonly documentId: string;
    readonly targetType: AttachmentTargetTypeDto;
    readonly targetId: string;
    readonly actorUserId: string;
  }): Promise<{ readonly removed: boolean }>;
}

// ───────────────────────────────────────────── consultas de existencia que cumple cada contexto dueño

/** Registro de existencia de destinos: ids existentes en el workspace (RLS), por tipo de destino. */
export interface AttachmentTargetLookup {
  existing(workspaceId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
}

/** Allow-list de redacción de la auditoría (NUNCA el nombre original, ni claves ni contenido). */
export const DOCUMENTS_AUDIT_POLICY = {
  Document: {
    status: 'plain',
    purpose: 'plain',
    sizeBytes: 'plain',
    detectedFormat: 'plain',
    scanStatus: 'plain',
    rejectionReason: 'plain',
    archivedAt: 'plain',
    deletedAt: 'plain',
    targetType: 'plain',
    targetId: 'plain',
    linkId: 'plain',
    downloadedBytes: 'plain',
  },
  /** Restauración del archivo de contenidos: solo estado y conteos. */
  DocumentContentRestore: {
    status: 'plain',
    sizeBytes: 'plain',
    restored: 'plain',
    mismatched: 'plain',
    absent: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;

export * from './portability.js';

/**
 * Contenidos de los documentos disponibles de un workspace como un ZIP en claro y en streaming (se cifra y se guarda
 * en IDENTITY, que no conoce el formato interno). Lo consume el job del export con `includeDocumentContents`.
 */
export interface DocumentContentsExporter {
  open(workspaceId: string): Promise<{ readonly stream: Readable; readonly count: number }>;
}
