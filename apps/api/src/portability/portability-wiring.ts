import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { S3Client } from '@aws-sdk/client-s3';
import { ACCOUNTS_PORTABILITY_SECTIONS } from '@pf/accounts/contracts';
import { AUDIT_PORTABILITY_SECTIONS } from '@pf/audit/contracts';
import { CLASSIFICATION_PORTABILITY_SECTIONS } from '@pf/classification/contracts';
import { COMMITMENTS_PORTABILITY_SECTIONS } from '@pf/commitments/contracts';
import { FX_PORTABILITY_SECTIONS } from '@pf/fx/contracts';
import { IMPORTS_PORTABILITY_EXCLUSIONS, IMPORTS_PORTABILITY_SECTIONS } from '@pf/imports/contracts';
import {
  EXPORT_RETENTION_QUEUE,
  IDENTITY_PORTABILITY_EXCLUSIONS,
  IDENTITY_PORTABILITY_SECTIONS,
  WORKSPACE_EXPORT_QUEUE,
  WORKSPACE_IMPORT_QUEUE,
} from '@pf/identity/contracts';
import {
  archiveInspector,
  KeyringEnvelopeCipher,
  LocalKeyringProvider,
  PgExportArchiveBuilder,
  PgWorkspaceImporter,
  S3ExportObjectStore,
  type ExportArchiveBuilder,
  type PortabilityJobPort,
  type WorkspaceImporter,
} from '@pf/identity/interface/identity.module';
import type { PortabilityOptions } from '@pf/identity/interface/identity.module';
import { LEDGER_PORTABILITY_EXCLUSIONS, LEDGER_PORTABILITY_SECTIONS } from '@pf/ledger/contracts';
import {
  NOTIFICATIONS_PORTABILITY_EXCLUSIONS,
  NOTIFICATIONS_PORTABILITY_SECTIONS,
} from '@pf/notifications/contracts';
import { PLANNING_CLOSE_SNAPSHOT_HASH_HOOK, PLANNING_PORTABILITY_SECTIONS } from '@pf/planning/contracts';
import { closeSnapshotRestoreHook } from '@pf/planning/interface/planning.module';
import { requireSqlExecutor } from '@pf/platform/api';
import { currentCorrelation, uuidv7 } from '@pf/platform/logging';
import type { JobQueue, QueueOptions } from '@pf/platform/queue';
import { DomainError, type PortabilityExclusion, type PortabilitySection } from '@pf/shared-kernel';
import { TRANSACTIONS_PORTABILITY_SECTIONS } from '@pf/transactions/contracts';
import type { Pool } from 'pg';

/**
 * Registro de portabilidad (`PortabilityRegistry`, openspec add-workspace-export, design decisión 2): las secciones que
 * declara cada contexto en su `contracts`, ordenadas por `order` (dependencias de FK primero; los bloqueos de periodo al
 * final). El test de cobertura exige que TODA tabla de `platform.workspace_scoped_table` esté aquí o en las exclusiones.
 */
export const PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  ...IDENTITY_PORTABILITY_SECTIONS,
  ...FX_PORTABILITY_SECTIONS,
  ...CLASSIFICATION_PORTABILITY_SECTIONS,
  ...ACCOUNTS_PORTABILITY_SECTIONS,
  ...LEDGER_PORTABILITY_SECTIONS,
  ...TRANSACTIONS_PORTABILITY_SECTIONS,
  ...PLANNING_PORTABILITY_SECTIONS,
  ...COMMITMENTS_PORTABILITY_SECTIONS,
  // add-basic-csv-import: jobs y vínculos de idempotencia (orden 770–771, después de COMMITMENTS 750–765).
  ...IMPORTS_PORTABILITY_SECTIONS,
  ...NOTIFICATIONS_PORTABILITY_SECTIONS,
  ...AUDIT_PORTABILITY_SECTIONS,
].sort((a, b) => a.order - b.order);

/** Tablas con `workspace_id` que no se exportan, con su motivo (regla de cobertura). */
export const PORTABILITY_EXCLUSIONS: readonly PortabilityExclusion[] = [
  ...IDENTITY_PORTABILITY_EXCLUSIONS,
  ...LEDGER_PORTABILITY_EXCLUSIONS,
  ...IMPORTS_PORTABILITY_EXCLUSIONS,
  ...NOTIFICATIONS_PORTABILITY_EXCLUSIONS,
];

/** Versión de producto que se escribe en el manifiesto (`pfosVersion`). */
export const PFOS_VERSION = '0.0.0';

/**
 * Esquemas JSON del formato: en el repo se lee la fuente (`contracts/export/v1`); en la imagen, la copia que deja el build
 * en `apps/api/contract/export/v1` (scripts/copy-contract.mjs).
 */
export function resolveExportContractsDir(): string {
  const candidates = [
    new URL('../../../../contracts/export/v1/', import.meta.url),
    new URL('../../contract/export/v1/', import.meta.url),
  ].map((u) => fileURLToPath(u));
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`contratos del export no encontrados (${candidates.join(' | ')})`);
  return found;
}

/**
 * Colas de add-workspace-export. El export reintenta una vez (la instantánea se rehace desde cero); la importación no
 * reintenta ciegamente (un fallo del dominio es final y el resto lo marca FAILED); la retención es idempotente.
 */
export const PORTABILITY_QUEUE_OPTIONS: Readonly<Record<string, QueueOptions>> = {
  [WORKSPACE_EXPORT_QUEUE]: { retryLimit: 1, retryDelaySeconds: 10, expireInSeconds: 1800 },
  [WORKSPACE_IMPORT_QUEUE]: { retryLimit: 1, retryDelaySeconds: 10, expireInSeconds: 3600 },
  [EXPORT_RETENTION_QUEUE]: { retryLimit: 2, retryDelaySeconds: 30, expireInSeconds: 600 },
};

export async function ensurePortabilityQueues(queue: JobQueue): Promise<void> {
  for (const [name, options] of Object.entries(PORTABILITY_QUEUE_OPTIONS))
    await queue.ensureQueue(name, options);
}

/**
 * `PortabilityJobPort` sobre pg-boss: el job se encola con la conexión de la transacción del comando
 * (`enqueueInTransaction`), así existe solo si el comando confirma. El id del job es el del export/importación (un
 * reintento del comando nunca duplica el trabajo).
 */
export function portabilityJobsPort(queue: JobQueue): PortabilityJobPort {
  let ready: Promise<void> | undefined;
  const enqueue = async (name: string, id: string, payload: object) => {
    ready ??= ensurePortabilityQueues(queue).catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
    await ready;
    const ambient = currentCorrelation()?.correlationId;
    await queue.enqueueInTransaction(
      name,
      [{ id, payload, correlationId: ambient ?? uuidv7(), traceContext: {} }],
      requireSqlExecutor(),
    );
  };
  return {
    enqueueExport: (job) => enqueue(WORKSPACE_EXPORT_QUEUE, job.exportId, job),
    enqueueImport: (job) => enqueue(WORKSPACE_IMPORT_QUEUE, job.importId, job),
  };
}

export interface PortabilityWiringInput {
  readonly storage: S3Client;
  readonly bucket: string;
  /** `EXPORT_ENCRYPTION_KEYS` / `EXPORT_ENCRYPTION_ACTIVE_KEY_ID`; sin llavero la portabilidad queda deshabilitada. */
  readonly keys: string | undefined;
  readonly activeKeyId: string | undefined;
  readonly retentionMs: number;
  readonly reauthMaxAgeMs: number;
  readonly maxImportBytes: number;
  /** `APP_DEFAULT_LOCALE`: respaldo del importer para un locale del archivo no soportado. */
  readonly defaultLocale?: string;
  readonly queue: JobQueue;
  /** Solo el worker construye e importa (rol `pf_worker`); la API recibe versiones que fallan si se invocan. */
  readonly pool?: Pool;
  readonly builderOverride?: Pick<ConstructorParameters<typeof PgExportArchiveBuilder>[0], 'afterSnapshot'>;
}

const unavailableBuilder: ExportArchiveBuilder = {
  build: () => Promise.reject(new DomainError('SERVICE_UNAVAILABLE', 'the export runs in the worker')),
};
const unavailableImporter: WorkspaceImporter = {
  importInto: () => Promise.reject(new DomainError('SERVICE_UNAVAILABLE', 'the import runs in the worker')),
};

/** Piezas de portabilidad para IDENTITY; `undefined` si no hay llavero de claves maestras (exportar/importar deshabilitado). */
export function portabilityOptions(input: PortabilityWiringInput): PortabilityOptions | undefined {
  if (!input.keys) return undefined;
  const sectionNames = new Set(PORTABILITY_SECTIONS.map((s) => s.name));
  const cipher = new KeyringEnvelopeCipher(new LocalKeyringProvider(input.keys, input.activeKeyId));
  return {
    store: new S3ExportObjectStore(input.storage, input.bucket),
    cipher,
    builder: input.pool
      ? new PgExportArchiveBuilder({
          pool: input.pool,
          sections: PORTABILITY_SECTIONS,
          pfosVersion: PFOS_VERSION,
          ...(input.builderOverride?.afterSnapshot
            ? { afterSnapshot: input.builderOverride.afterSnapshot }
            : {}),
        })
      : unavailableBuilder,
    importer: input.pool
      ? new PgWorkspaceImporter({
          sections: PORTABILITY_SECTIONS,
          hooks: { [PLANNING_CLOSE_SNAPSHOT_HASH_HOOK]: closeSnapshotRestoreHook },
          schemaDir: resolveExportContractsDir(),
          random: (n) => randomBytes(n),
          ...(input.defaultLocale ? { defaultLocale: input.defaultLocale } : {}),
        })
      : unavailableImporter,
    inspector: archiveInspector(sectionNames),
    jobs: portabilityJobsPort(input.queue),
    reauthMaxAgeMs: input.reauthMaxAgeMs,
    settings: {
      retentionMs: input.retentionMs,
      formatVersion: 1,
      maxImportBytes: input.maxImportBytes,
      pfosVersion: PFOS_VERSION,
      restoredSuffix: ' (restaurado)',
    },
  };
}
