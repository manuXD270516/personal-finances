import type { Readable } from 'node:stream';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { Document } from '../../domain/document.js';
import type { UploadLimits } from '../../domain/file-type-policy.js';
import type { QuotaLimits, StorageUsage } from '../../domain/storage-quota.js';
import type {
  AttachmentTargetType,
  DocumentFormat,
  DocumentPurpose,
  DocumentStatus,
  InspectionVerdict,
} from '../../domain/types.js';

/**
 * Puertos de DOCUMENTS (hexagonal). Los repositorios los implementa `infrastructure/` sobre PostgreSQL; el
 * almacenamiento de objetos, el cifrado, el inspector y el antimalware son adapters intercambiables (dobles en memoria
 * en `application/testing`).
 */

/** Transacción PG con `SET LOCAL app.workspace_id` (RLS, ADR-0023); reutiliza la del llamador si existe. */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

export interface IdGenerator {
  /** UUIDv7. */
  next(): string;
}

export interface OutboxPort {
  append(event: {
    readonly eventId: string;
    readonly eventType: string;
    readonly eventVersion: number;
    readonly occurredAt: string;
    readonly workspaceId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly payload: object;
  }): Promise<void>;
}

// ───────────────────────────────────────────── repositorios

export type ArchivedFilter = 'EXCLUDE' | 'ONLY' | 'INCLUDE';

export interface DocumentFilter {
  readonly purpose?: DocumentPurpose;
  readonly status?: DocumentStatus;
  /** Por defecto `EXCLUDE` (FR-DOCUMENTS-007). */
  readonly archived?: ArchivedFilter;
  readonly target?: { readonly type: AttachmentTargetType; readonly id: string };
  readonly cursor?: string;
  readonly limit?: number;
}

export interface DocumentPage {
  readonly items: readonly Document[];
  readonly nextCursor: string | null;
}

export interface DocumentRepository {
  insert(doc: Document): Promise<void>;
  /** Control optimista por versión; `false` si otro cambio ganó. */
  save(doc: Document): Promise<boolean>;
  /** Persiste solo el envoltorio de la clave (rotación) sin tocar `version` ni `updated_at`. */
  saveKey(doc: Document): Promise<boolean>;
  findById(workspaceId: string, id: string, options?: { lock?: 'update' }): Promise<Document | null>;
  /** Documento `AVAILABLE` de la misma suma en el workspace (deduplicación, FR-DOCUMENTS-006). */
  findAvailableBySha256(workspaceId: string, sha256: string): Promise<Document | null>;
  list(workspaceId: string, filter: DocumentFilter): Promise<DocumentPage>;
}

export interface LinkRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly documentId: string;
  readonly targetType: AttachmentTargetType;
  readonly targetId: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface AttachmentLinkRepository {
  find(
    workspaceId: string,
    documentId: string,
    targetType: AttachmentTargetType,
    targetId: string,
  ): Promise<LinkRecord | null>;
  findById(workspaceId: string, documentId: string, linkId: string): Promise<LinkRecord | null>;
  /** Vínculos del destino con `SELECT … FOR UPDATE` (serializa dos vínculos paralelos al mismo destino). */
  lockTarget(
    workspaceId: string,
    targetType: AttachmentTargetType,
    targetId: string,
  ): Promise<readonly LinkRecord[]>;
  insert(link: LinkRecord): Promise<void>;
  delete(workspaceId: string, linkId: string): Promise<void>;
  /** Quita todos los vínculos de un documento; devuelve los quitados. */
  deleteAllOf(workspaceId: string, documentId: string): Promise<readonly LinkRecord[]>;
  linksOf(
    workspaceId: string,
    documentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly LinkRecord[]>>;
  countOf(workspaceId: string, documentId: string): Promise<number>;
}

export interface StorageUsageRepository {
  /** Contadores del workspace sin bloquear (vacíos si aún no hay fila). */
  read(workspaceId: string): Promise<StorageUsage>;
  /** Fila del workspace con `FOR UPDATE` (la crea vacía si falta): serializa las solicitudes concurrentes. */
  lock(workspaceId: string): Promise<StorageUsage>;
  save(workspaceId: string, usage: StorageUsage, at: string): Promise<void>;
  /** Recalcula los contadores desde los documentos (`SUM`), para detectar deriva. */
  recompute(workspaceId: string): Promise<StorageUsage>;
}

/** Candidatos de mantenimiento entre workspaces: lectura con el rol `pf_maintenance` (política `retention_scan`). */
export interface MaintenanceScanPort {
  expiredPending(before: string): Promise<readonly DocumentRef[]>;
  stuckUploads(before: string): Promise<readonly DocumentRef[]>;
  unlinkedCandidates(before: string): Promise<readonly DocumentRef[]>;
  /** Workspaces que tienen documentos (para rotación y recálculo de cuota). */
  workspacesWithDocuments(): Promise<readonly string[]>;
  keyIdsInUse(): Promise<readonly string[]>;
  /** Documentos con contenido envueltos con una clave maestra distinta de la activa (rotación). */
  withOtherKey(activeKeyId: string, limit: number): Promise<readonly DocumentRef[]>;
  /** Claves de objeto referenciadas por documentos con contenido (para el barrido de huérfanos). */
  referencedObjectKeys(workspaceId: string): Promise<ReadonlySet<string>>;
  /** Estados de documentos por id (para el barrido de cuarentena). */
  statusOf(ids: readonly string[]): Promise<ReadonlyMap<string, DocumentStatus>>;
}

export interface DocumentRef {
  readonly workspaceId: string;
  readonly documentId: string;
}

// ───────────────────────────────────────────── adapters externos

/** Cifrado de sobre con clave de datos por documento (formato `PFXE` v1 de `@pf/platform/crypto`). */
export interface DocumentCipher {
  readonly activeKeyId: string;
  /** Cifra en streaming y devuelve el texto cifrado con la clave de datos envuelta (nunca el texto plano a disco). */
  seal(plain: Buffer, context: string): Promise<{ encrypted: Buffer; keyId: string; wrappedKey: Uint8Array }>;
  /**
   * Flujo de texto plano verificado por bloque: ante una alteración emite un error de integridad
   * (`DocumentIntegrityError`) sin emitir el bloque alterado ni los siguientes.
   */
  open(
    encrypted: Readable,
    wrapped: { keyId: string; wrappedKey: Uint8Array },
    context: string,
  ): Promise<Readable>;
  /** Vuelve a envolver la clave de datos con la clave activa, sin tocar el contenido. */
  rewrap(
    wrapped: { keyId: string; wrappedKey: Uint8Array },
    context: string,
  ): Promise<{ keyId: string; wrappedKey: Uint8Array }>;
  /** Claves maestras presentes en el llavero (para el diagnóstico de arranque; nunca las claves). */
  keyIds(): readonly string[];
}

export { DocumentIntegrityError } from '../../contracts/index.js';

export interface ContentInspector {
  inspect(content: Buffer, declared: DocumentFormat): Promise<InspectionVerdict>;
}

export type ScanResult =
  | { readonly status: 'NOT_SCANNED' }
  | { readonly status: 'CLEAN' }
  | { readonly status: 'INFECTED'; readonly signature: string }
  | { readonly status: 'UNAVAILABLE' };

export interface MalwareScanner {
  readonly engine: string | null;
  scan(content: Buffer): Promise<ScanResult>;
}

/** Existencia de los elementos destino, por contrato público de su contexto dueño (sin FK cruzadas). */
export interface AttachmentTargetRegistry {
  /** Ids existentes en el workspace (RLS) entre los pedidos. */
  existing(
    workspaceId: string,
    targetType: AttachmentTargetType,
    ids: readonly string[],
  ): Promise<ReadonlySet<string>>;
}

/** Acota la verificación síncrona concurrente (`DOCUMENT_VERIFY_MAX_CONCURRENCY`). */
export interface VerifySemaphore {
  /** `true` si pudo entrar; quien entra DEBE llamar a `release`. */
  tryAcquire(): boolean;
  release(): void;
}

export interface DocumentsSettings {
  readonly quarantineBucket: string;
  readonly documentsBucket: string;
  readonly uploadUrlTtlSeconds: number;
  readonly uploadGraceMs: number;
  readonly unlinkedRetentionMs: number;
  readonly stuckAfterMs: number;
  readonly quarantineMaxAgeMs: number;
  readonly maxLinksPerTarget: number;
  readonly limits: UploadLimits;
  readonly quota: QuotaLimits;
  /** Reintentos de rechazo en la respuesta: tiempo sugerido en `Retry-After` cuando el semáforo está lleno. */
  readonly retryAfterSeconds: number;
}

export const DEFAULT_DOCUMENTS_SETTINGS: Omit<DocumentsSettings, 'quarantineBucket' | 'documentsBucket'> = {
  uploadUrlTtlSeconds: 300,
  uploadGraceMs: 3_600_000,
  unlinkedRetentionMs: 30 * 86_400_000,
  stuckAfterMs: 600_000,
  quarantineMaxAgeMs: 24 * 3_600_000,
  maxLinksPerTarget: 20,
  limits: { maxBytes: 15_728_640, importSourceMaxBytes: 20_971_520 },
  quota: { quotaBytes: 5_368_709_120, maxPendingUploads: 20 },
  retryAfterSeconds: 5,
};

export interface ObjectStoragePort {
  presignPut(input: {
    readonly bucket: string;
    readonly key: string;
    readonly contentType: string;
    readonly contentLength: number;
    readonly sha256Base64: string;
    readonly expiresInSeconds: number;
  }): {
    readonly url: string;
    readonly method: 'PUT';
    readonly headers: Readonly<Record<string, string>>;
    readonly expiresAt: Date;
  };
  head(bucket: string, key: string): Promise<{ contentLength: number } | null>;
  get(bucket: string, key: string): Promise<Readable>;
  put(bucket: string, key: string, body: Buffer, contentType?: string): Promise<void>;
  /** Sube un flujo por multipart sin cargarlo en memoria; con `maxBytes`, un exceso lanza `ObjectTooLargeError`. */
  putStream(
    bucket: string,
    key: string,
    source: AsyncIterable<Buffer | Uint8Array>,
    options?: { readonly contentType?: string; readonly maxBytes?: number },
  ): Promise<{ readonly size: number }>;
  delete(bucket: string, key: string): Promise<void>;
  deleteAllVersions(bucket: string, key: string): Promise<void>;
  list(
    bucket: string,
    prefix: string,
  ): AsyncIterable<{ readonly key: string; readonly size: number; readonly lastModified: Date }>;
}

/** Operación asíncrona consultable (`platform.operation`, docs/10 §8) de la restauración de contenidos. */
export interface RestoreOperationPort {
  insert(op: {
    readonly id: string;
    readonly workspaceId: string;
    readonly requestedBy: string;
  }): Promise<void>;
  update(
    workspaceId: string,
    id: string,
    patch: {
      readonly status?: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
      readonly progressPct?: number;
      readonly result?: Readonly<Record<string, unknown>> | null;
      readonly error?: Readonly<Record<string, unknown>> | null;
    },
  ): Promise<void>;
  /** Estado actual (`null` si no existe). */
  status(workspaceId: string, id: string): Promise<'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | null>;
}

export interface ContentRestoreJob {
  readonly workspaceId: string;
  /** Id de la operación (y de la restauración). */
  readonly operationId: string;
  /** Objeto del ZIP subido en la cuarentena. */
  readonly objectKey: string;
  readonly requestedBy: string;
}

/** Encola el job EN la transacción del comando (existe solo si el comando confirma). */
export interface ContentRestoreJobPort {
  enqueue(job: ContentRestoreJob): Promise<void>;
}

export interface DocumentsDeps {
  readonly uow: UnitOfWork;
  readonly documents: DocumentRepository;
  readonly links: AttachmentLinkRepository;
  readonly usage: StorageUsageRepository;
  readonly scan: MaintenanceScanPort;
  readonly storage: ObjectStoragePort;
  readonly cipher: DocumentCipher;
  readonly inspector: ContentInspector;
  readonly scanner: MalwareScanner;
  readonly targets: AttachmentTargetRegistry;
  readonly semaphore: VerifySemaphore;
  /** Auditoría + recorrido en la misma unidad de trabajo del comando (INV-029). */
  readonly lifecycle: LifecyclePort;
  /** Auditoría de lecturas (descargas): escritura corta en la misma transacción que autoriza. */
  readonly audit: AuditPort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  readonly operations: RestoreOperationPort;
  readonly restoreJobs: ContentRestoreJobPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: DocumentsSettings;
}

/** Claves de objeto: solo identificadores opacos (FR-DOCUMENTS-005). */
export const quarantineKeyOf = (workspaceId: string, documentId: string): string =>
  `ws/${workspaceId}/${documentId}`;
export const objectKeyOf = (workspaceId: string, documentId: string): string =>
  `ws/${workspaceId}/documents/${documentId}`;
/** Contexto autenticado (AAD) del envoltorio de la clave de datos: un envoltorio copiado a otra fila no descifra. */
/** Objeto del ZIP de contenidos subido para restaurar: vive en la cuarentena (la barre el mantenimiento a las 24 h). */
export const restoreUploadKeyOf = (workspaceId: string, restoreId: string): string =>
  `ws/${workspaceId}/restores/${restoreId}`;
export const wrapContextOf = (workspaceId: string, documentId: string): string =>
  `documents:${workspaceId}:${documentId}`;
