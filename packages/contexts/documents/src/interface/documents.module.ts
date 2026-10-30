import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import { LocalKeyringProvider } from '@pf/platform/crypto';
import type { ObjectStorage } from '@pf/platform/storage';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import { DomainError, type Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { AttachmentsService } from '../application/attachments.service.js';
import { ContentsService } from '../application/contents.service.js';
import { DocumentsQueries } from '../application/documents.queries.js';
import { DocumentsService } from '../application/documents.service.js';
import { DownloadService } from '../application/download.service.js';
import { MaintenanceService } from '../application/maintenance.service.js';
import {
  DEFAULT_DOCUMENTS_SETTINGS,
  type AttachmentTargetRegistry,
  type ContentRestoreJobPort,
  type DocumentsDeps,
  type DocumentsSettings,
  type MalwareScanner,
  type OutboxPort,
} from '../application/ports/index.js';
import { UploadsService } from '../application/uploads.service.js';
import { assertUploadLimits } from '../domain/file-type-policy.js';
import { EnvelopeDocumentCipher } from '../infrastructure/envelope-document-cipher.js';
import { WorkerThreadInspector } from '../infrastructure/inspection/worker-thread-inspector.js';
import { ClamdMalwareScanner, NoopMalwareScanner } from '../infrastructure/malware-scanners.js';
import {
  PgAttachmentLinkRepository,
  PgDocumentRepository,
  PgDocumentsUnitOfWork,
  PgMaintenanceScan,
  PgRestoreOperations,
  PgStorageUsageRepository,
  uuidV7Ids,
} from '../infrastructure/pg-documents.js';
import { CountingSemaphore } from '../infrastructure/verify-semaphore.js';
import {
  ContentRestoresController,
  ContentRestoreUploadGuard,
  DOCUMENTS_ATTACHMENTS,
  DOCUMENTS_CONTENTS,
  DOCUMENTS_REAUTH,
  type ReauthCheck,
  DOCUMENTS_DOWNLOAD,
  DOCUMENTS_QUERIES,
  DOCUMENTS_SERVICE,
  DOCUMENTS_UPLOADS,
  DocumentsController,
} from './documents-http.js';

/** Sin política de re-autenticación configurada: la restauración de contenidos exige autenticación reciente y falla cerrada. */
const denyReauth: ReauthCheck = () => {
  throw new DomainError('REAUTHENTICATION_REQUIRED', 'a recent authentication is required');
};

export interface DocumentsRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly lifecycle: LifecyclePort;
  readonly audit: AuditPort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  readonly storage: ObjectStorage;
  /** Encola la restauración de contenidos en la transacción del comando (solo la API). */
  readonly restoreJobs?: ContentRestoreJobPort;
  readonly targets: AttachmentTargetRegistry;
  /** `DOCUMENT_ENCRYPTION_KEYS` / `DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID` (llavero propio, decisión 6). */
  readonly encryption: { readonly keys: string; readonly activeKeyId?: string | undefined };
  readonly settings: Pick<DocumentsSettings, 'quarantineBucket' | 'documentsBucket'> &
    Partial<DocumentsSettings>;
  readonly verify?: {
    readonly maxConcurrency?: number;
    readonly inspectionTimeoutMs?: number;
    readonly jsonMaxDepth?: number;
    readonly archive?: {
      readonly maxEntries: number;
      readonly maxUncompressedBytes: number;
      readonly maxRatio: number;
    };
  };
  /** `none` (defecto) o `clamav`. */
  readonly scanner?:
    | { readonly kind: 'none' }
    | { readonly kind: 'clamav'; readonly host: string; readonly port: number; readonly timeoutMs: number };
}

export interface DocumentsRuntime {
  readonly uploads: UploadsService;
  readonly documents: DocumentsService;
  readonly attachments: AttachmentsService;
  readonly download: DownloadService;
  readonly contents: ContentsService;
  readonly queries: DocumentsQueries;
  readonly maintenance: MaintenanceService;
  readonly deps: DocumentsDeps;
  readonly settings: DocumentsSettings;
}

/** Composición de DOCUMENTS sobre PostgreSQL y el almacenamiento S3 (misma transacción que cada comando). */
export function createDocumentsRuntime(options: DocumentsRuntimeOptions): DocumentsRuntime {
  const settings: DocumentsSettings = { ...DEFAULT_DOCUMENTS_SETTINGS, ...options.settings };
  assertUploadLimits(settings.limits);
  const uow = new PgDocumentsUnitOfWork(options.pool);
  const scanner: MalwareScanner =
    options.scanner?.kind === 'clamav'
      ? new ClamdMalwareScanner({
          host: options.scanner.host,
          port: options.scanner.port,
          timeoutMs: options.scanner.timeoutMs,
        })
      : new NoopMalwareScanner();
  const deps: DocumentsDeps = {
    uow,
    documents: new PgDocumentRepository(),
    links: new PgAttachmentLinkRepository(),
    usage: new PgStorageUsageRepository(),
    scan: new PgMaintenanceScan(uow),
    storage: options.storage,
    cipher: new EnvelopeDocumentCipher(
      new LocalKeyringProvider(options.encryption.keys, options.encryption.activeKeyId, {
        keys: 'DOCUMENT_ENCRYPTION_KEYS',
        activeKeyId: 'DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID',
      }),
    ),
    inspector: new WorkerThreadInspector({
      ...(options.verify?.inspectionTimeoutMs ? { timeoutMs: options.verify.inspectionTimeoutMs } : {}),
      ...(options.verify?.jsonMaxDepth || options.verify?.archive
        ? {
            config: {
              jsonMaxDepth: options.verify?.jsonMaxDepth ?? 64,
              pdf: { maxObjects: 10_000, maxInflatedBytes: 50 * 1024 * 1024 },
              archive: options.verify?.archive ?? {
                maxEntries: 1000,
                maxUncompressedBytes: 104_857_600,
                maxRatio: 100,
              },
            },
          }
        : {}),
    }),
    scanner,
    targets: options.targets,
    semaphore: new CountingSemaphore(options.verify?.maxConcurrency ?? 2),
    lifecycle: options.lifecycle,
    audit: options.audit,
    ...(options.lifecycleQuery ? { lifecycleQuery: options.lifecycleQuery } : {}),
    outbox: options.outbox,
    operations: new PgRestoreOperations(),
    restoreJobs: options.restoreJobs ?? {
      enqueue: () => Promise.reject(new DomainError('SERVICE_UNAVAILABLE', 'the restore runs from the API')),
    },
    ids: uuidV7Ids,
    clock: options.clock,
    settings,
  };
  const uploads = new UploadsService(deps);
  const documents = new DocumentsService(deps);
  return {
    uploads,
    documents,
    attachments: new AttachmentsService(deps),
    download: new DownloadService(deps),
    contents: new ContentsService(deps),
    queries: new DocumentsQueries(deps),
    maintenance: new MaintenanceService(deps, uploads, documents),
    deps,
    settings,
  };
}

/**
 * Runtime de DOCUMENTS deshabilitado (sin `DOCUMENT_ENCRYPTION_KEYS`): toda operación responde 503
 * `SERVICE_UNAVAILABLE`, como la exportación del workspace sin su llavero. Nada toca la base ni el almacenamiento.
 */
export function disabledDocumentsRuntime(): DocumentsRuntime {
  const unavailable = (): never => {
    throw new DomainError(
      'SERVICE_UNAVAILABLE',
      'documents are disabled: DOCUMENT_ENCRYPTION_KEYS is not configured',
    );
  };
  const service = (): never => new Proxy({}, { get: () => async () => unavailable() }) as never;
  return {
    uploads: service(),
    documents: service(),
    attachments: service(),
    download: service(),
    contents: service(),
    queries: service(),
    maintenance: service(),
    deps: {} as DocumentsDeps,
    settings: { ...DEFAULT_DOCUMENTS_SETTINGS, quarantineBucket: '', documentsBucket: '' },
  };
}

export interface DocumentsModuleOptions {
  readonly runtime: DocumentsRuntime;
  /** Re-autenticación reciente de la restauración de contenidos (la misma que el export). */
  readonly reauth?: ReauthCheck;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de DOCUMENTS (`/documents*`). */
@Module({})
export class DocumentsModule {
  static register(options: DocumentsModuleOptions): DynamicModule {
    const r = options.runtime;
    return {
      module: DocumentsModule,
      controllers: [DocumentsController, ContentRestoresController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: DOCUMENTS_UPLOADS, useValue: r.uploads },
        { provide: DOCUMENTS_SERVICE, useValue: r.documents },
        { provide: DOCUMENTS_ATTACHMENTS, useValue: r.attachments },
        { provide: DOCUMENTS_DOWNLOAD, useValue: r.download },
        { provide: DOCUMENTS_QUERIES, useValue: r.queries },
        { provide: DOCUMENTS_CONTENTS, useValue: r.contents },
        { provide: DOCUMENTS_REAUTH, useValue: options.reauth ?? denyReauth },
        ContentRestoreUploadGuard,
      ],
    };
  }
}

export {
  DOCUMENTS_AUDIT_POLICY,
  DOCUMENTS_EVENTS,
  DOCUMENTS_MAINTENANCE_JOB,
  DOCUMENT_CONTENTS_RESTORE_JOB,
} from '../contracts/index.js';
export type { ContentRestoreJob, ContentRestoreJobPort } from '../application/ports/index.js';
export type { ReauthCheck } from './documents-http.js';
import { DOCUMENT_LIFECYCLE } from '../domain/document.js';

/** Máquina `Document` declarada (dato puro) para el recorrido (add-lifecycle-timeline). */
export const DOCUMENT_LIFECYCLE_MACHINE = DOCUMENT_LIFECYCLE.definition;
export type { MaintenanceReport } from '../application/maintenance.service.js';
export type {
  AttachmentTargetRegistry,
  DocumentsSettings,
  MalwareScanner,
  OutboxPort,
} from '../application/ports/index.js';

type RestoreRow = Record<string, unknown>;

/**
 * Gancho de importación `documents.content-pending` (tarea 8.1): un documento disponible en el origen queda con
 * «contenido pendiente de restaurar» (sus claves y su objeto no viajan en el export); eliminados y rechazados conservan
 * su estado. La importación nunca deja un documento `AVAILABLE`: su contenido solo vuelve por la restauración.
 */
export function documentsContentPendingHook(ctx: { readonly rows: RestoreRow[] }): void {
  for (const row of ctx.rows) {
    if (row['status'] === 'AVAILABLE' || row['status'] === 'CONTENT_PENDING')
      row['status'] = 'CONTENT_PENDING';
  }
}

/**
 * Gancho `documents.usage-recompute`: los contadores de cuota del workspace importado se recalculan desde los
 * documentos importados; los `CONTENT_PENDING` cuentan como usados (para que restaurar contenidos no supere la cuota) y
 * no hay reservas ni subidas pendientes.
 */
export function documentsUsageRecomputeHook(ctx: {
  readonly rows: RestoreRow[];
  related(sectionName: string): RestoreRow[];
}): void {
  const used = ctx
    .related('documents')
    .filter((d) => d['status'] === 'AVAILABLE' || d['status'] === 'CONTENT_PENDING')
    .reduce((sum, d) => sum + Number(d['size_bytes']), 0);
  for (const row of ctx.rows) {
    row['used_bytes'] = used;
    row['reserved_bytes'] = 0;
    row['pending_uploads'] = 0;
  }
}
