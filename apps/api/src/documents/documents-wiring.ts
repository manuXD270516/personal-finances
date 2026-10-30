import type { S3Client } from '@aws-sdk/client-s3';
import { accountExistenceQuery } from '@pf/accounts/interface/accounts.module';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import { subscriptionExistenceQuery } from '@pf/commitments/interface/commitments.module';
import { loanExistenceQuery } from '@pf/debt/interface/debt.module';
import {
  createDocumentsRuntime,
  type AttachmentTargetRegistry,
  type ContentRestoreJobPort,
  type DocumentsRuntime,
  type OutboxPort,
} from '@pf/documents/interface/documents.module';
import { importJobExistenceQuery } from '@pf/imports/interface/imports.module';
import type { ApiConfig, WorkerConfig } from '@pf/platform/config';
import { financialPeriodExistenceQuery } from '@pf/planning/interface/planning.module';
import { S3ObjectStorage } from '@pf/platform/storage';
import { transactionExistenceQuery } from '@pf/transactions/interface/transactions.module';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';

type DocumentsConfig = Pick<
  ApiConfig & WorkerConfig,
  | 'OBJECT_STORAGE_ENDPOINT'
  | 'OBJECT_STORAGE_REGION'
  | 'OBJECT_STORAGE_ACCESS_KEY'
  | 'OBJECT_STORAGE_SECRET_KEY'
  | 'OBJECT_STORAGE_BUCKET'
  | 'OBJECT_STORAGE_QUARANTINE_BUCKET'
  | 'DOCUMENT_MAX_BYTES'
  | 'DOCUMENT_IMPORT_SOURCE_MAX_BYTES'
  | 'DOCUMENT_WORKSPACE_QUOTA_BYTES'
  | 'DOCUMENT_MAX_PENDING_UPLOADS'
  | 'DOCUMENT_MAX_LINKS_PER_TARGET'
  | 'DOCUMENT_UPLOAD_URL_TTL'
  | 'DOCUMENT_UPLOAD_GRACE'
  | 'DOCUMENT_UNLINKED_RETENTION'
  | 'DOCUMENT_VERIFY_MAX_CONCURRENCY'
  | 'DOCUMENT_INSPECTION_TIMEOUT'
  | 'DOCUMENT_XLSX_MAX_ENTRIES'
  | 'DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES'
  | 'DOCUMENT_ARCHIVE_MAX_RATIO'
  | 'DOCUMENT_JSON_MAX_DEPTH'
  | 'DOCUMENT_ENCRYPTION_KEYS'
  | 'DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID'
  | 'DOCUMENT_MALWARE_SCANNER'
  | 'CLAMAV_HOST'
  | 'CLAMAV_PORT'
  | 'DOCUMENT_MALWARE_SCAN_TIMEOUT'
> & { readonly OBJECT_STORAGE_PUBLIC_ENDPOINT?: string | undefined };

/**
 * Registro de destinos de adjuntos (decisión 9): cada tipo se resuelve con la consulta de existencia aditiva del
 * contexto dueño (contrato público; sin FK cruzadas). El periodo cerrado no se consulta (D65).
 */
export function attachmentTargets(): AttachmentTargetRegistry {
  return {
    async existing(workspaceId, targetType, ids) {
      switch (targetType) {
        case 'TRANSACTION':
          return transactionExistenceQuery.existingTransactions(workspaceId, ids);
        case 'CONVERSION':
          return transactionExistenceQuery.existingConversions(workspaceId, ids);
        case 'LOAN':
          return loanExistenceQuery.existing(workspaceId, ids);
        case 'SUBSCRIPTION':
          return subscriptionExistenceQuery.existing(workspaceId, ids);
        case 'ACCOUNT':
          return accountExistenceQuery.existing(workspaceId, ids);
        case 'IMPORT_JOB':
          return importJobExistenceQuery.existing(workspaceId, ids);
        case 'MONTH_CLOSING':
          // El cierre de mes adjunta al id del periodo financiero que se cierra (existe antes del cierre).
          return financialPeriodExistenceQuery.existing(workspaceId, ids);
        default:
          return new Set<string>();
      }
    },
  };
}

/** Ajustes de DOCUMENTS desde la configuración (`DOCUMENT_*`, `OBJECT_STORAGE_*`). */
export function documentsSettingsFrom(config: DocumentsConfig) {
  return {
    quarantineBucket: config.OBJECT_STORAGE_QUARANTINE_BUCKET,
    documentsBucket: config.OBJECT_STORAGE_BUCKET,
    uploadUrlTtlSeconds: Math.round(config.DOCUMENT_UPLOAD_URL_TTL / 1000),
    uploadGraceMs: config.DOCUMENT_UPLOAD_GRACE,
    unlinkedRetentionMs: config.DOCUMENT_UNLINKED_RETENTION,
    maxLinksPerTarget: config.DOCUMENT_MAX_LINKS_PER_TARGET,
    limits: {
      maxBytes: config.DOCUMENT_MAX_BYTES,
      importSourceMaxBytes: config.DOCUMENT_IMPORT_SOURCE_MAX_BYTES,
    },
    quota: {
      quotaBytes: config.DOCUMENT_WORKSPACE_QUOTA_BYTES,
      maxPendingUploads: config.DOCUMENT_MAX_PENDING_UPLOADS,
    },
  };
}

export interface DocumentsWiringInput {
  readonly config: DocumentsConfig;
  readonly pool: Pool;
  readonly clock: Clock;
  readonly storage: S3Client;
  readonly audit: AuditPort;
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  /** Solo la API: encola la restauración de contenidos en la transacción del comando. */
  readonly restoreJobs?: ContentRestoreJobPort;
}

/**
 * Composición de DOCUMENTS sobre el cliente S3 del proceso. `undefined` si no hay llavero de claves maestras
 * (`DOCUMENT_ENCRYPTION_KEYS`): los documentos quedan deshabilitados (503), como la exportación sin su llavero.
 */
export function documentsRuntimeFor(input: DocumentsWiringInput): DocumentsRuntime | undefined {
  const { config } = input;
  if (!config.DOCUMENT_ENCRYPTION_KEYS) return undefined;
  return createDocumentsRuntime({
    pool: input.pool,
    clock: input.clock,
    audit: input.audit,
    lifecycle: input.lifecycle,
    ...(input.lifecycleQuery ? { lifecycleQuery: input.lifecycleQuery } : {}),
    outbox: input.outbox,
    ...(input.restoreJobs ? { restoreJobs: input.restoreJobs } : {}),
    storage: new S3ObjectStorage({
      client: input.storage,
      publicEndpoint: config.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? config.OBJECT_STORAGE_ENDPOINT,
      region: config.OBJECT_STORAGE_REGION,
      accessKey: config.OBJECT_STORAGE_ACCESS_KEY,
      secretKey: config.OBJECT_STORAGE_SECRET_KEY,
    }),
    targets: attachmentTargets(),
    encryption: {
      keys: config.DOCUMENT_ENCRYPTION_KEYS,
      activeKeyId: config.DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID,
    },
    settings: documentsSettingsFrom(config),
    verify: {
      maxConcurrency: config.DOCUMENT_VERIFY_MAX_CONCURRENCY,
      inspectionTimeoutMs: config.DOCUMENT_INSPECTION_TIMEOUT,
      jsonMaxDepth: config.DOCUMENT_JSON_MAX_DEPTH,
      archive: {
        maxEntries: config.DOCUMENT_XLSX_MAX_ENTRIES,
        maxUncompressedBytes: config.DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
        maxRatio: config.DOCUMENT_ARCHIVE_MAX_RATIO,
      },
    },
    scanner:
      config.DOCUMENT_MALWARE_SCANNER === 'clamav' && config.CLAMAV_HOST
        ? {
            kind: 'clamav',
            host: config.CLAMAV_HOST,
            port: config.CLAMAV_PORT,
            timeoutMs: config.DOCUMENT_MALWARE_SCAN_TIMEOUT,
          }
        : { kind: 'none' },
  });
}
