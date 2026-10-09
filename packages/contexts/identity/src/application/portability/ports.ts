import type { Readable } from 'node:stream';
import type { Instant } from '@pf/shared-kernel';
import type { ExportManifest } from '../../domain/export-manifest.js';
import type { WorkspaceExport } from '../../domain/workspace-export.js';
import type { WorkspaceImport } from '../../domain/workspace-import.js';
import type { IdentityDeps } from '../ports/index.js';

/** Clave de datos envuelta con una clave maestra identificada (cifrado de sobre, design decisión 4). */
export interface WrappedDataKey {
  readonly keyId: string;
  readonly wrappedKey: Uint8Array;
}

/**
 * Proveedor de claves maestras rotables. Local/CI: llavero `EXPORT_ENCRYPTION_KEYS`; cloud: adapter KMS
 * (`GenerateDataKey`/`Decrypt`). La clave maestra nunca viaja a la base ni al bucket. `context` (workspace + export) va
 * como dato autenticado: un envoltorio copiado a otro registro no descifra.
 */
export interface ExportKeyProvider {
  readonly activeKeyId: string;
  wrap(dataKey: Buffer, context: string): Promise<WrappedDataKey>;
  unwrap(wrapped: WrappedDataKey, context: string): Promise<Buffer>;
}

/** Almacén de objetos S3 del bucket de exports (cifrados; jamás el ZIP en claro). */
export interface ExportObjectStore {
  put(key: string, body: Buffer): Promise<void>;
  /** Flujo del objeto cifrado; lanza `ObjectMissingError` si no existe. */
  openStream(key: string): Promise<Readable>;
  get(key: string): Promise<Buffer>;
  /** Idempotente: borrar un objeto inexistente no es un error. */
  delete(key: string): Promise<void>;
}

export class ObjectMissingError extends Error {
  constructor(key: string) {
    super(`object ${key} does not exist`);
    this.name = 'ObjectMissingError';
  }
}

/** Resultado de sellar un archivo: bytes cifrados + clave de datos envuelta. */
export interface SealedArchive {
  readonly encrypted: Buffer;
  readonly keyId: string;
  readonly wrappedKey: Uint8Array;
}

/** Sobre cifrado (`ExportKeyProvider` + formato por bloques); implementado en infraestructura. */
export interface EnvelopeCipher {
  seal(plain: Buffer, context: string): Promise<SealedArchive>;
  /** Descifra un objeto completo en memoria; `EXPORT_FILE_CORRUPTED` ante cualquier alteración. */
  open(encrypted: Buffer, wrapped: WrappedDataKey, context: string): Promise<Buffer>;
  /**
   * Primera pasada de la descarga: recorre TODO el flujo cifrado validando cada bloque y devuelve el SHA-256 y el tamaño
   * del contenido en claro, sin entregar nada. Alteración ⇒ `EXPORT_FILE_CORRUPTED`.
   */
  verify(
    source: Readable,
    wrapped: WrappedDataKey,
    context: string,
  ): Promise<{ sha256: string; size: number }>;
  /** Segunda pasada: flujo en claro (un bloque solo se emite tras validar su tag). */
  decryptStream(source: Readable, wrapped: WrappedDataKey, context: string): Promise<Readable>;
}

export interface BuiltArchive {
  /** ZIP en claro (nunca se persiste así). */
  readonly zip: Buffer;
  readonly manifest: ExportManifest;
  /** Filas por sección (el manifiesto y el registro del export comparten estas cifras). */
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * Construye el export de un workspace: abre UNA transacción `READ ONLY, ISOLATION LEVEL REPEATABLE READ` con el contexto
 * RLS del solicitante y recorre las secciones del `PortabilityRegistry` en orden. Implementado por la raíz de
 * composición con las secciones de cada contexto (ver `apps/api/src/portability`).
 */
export interface ExportArchiveBuilder {
  build(input: {
    readonly workspaceId: string;
    readonly requestedBy: string;
    readonly exportedAt: Instant;
    readonly onProgress?: (pct: number) => Promise<void>;
  }): Promise<BuiltArchive>;
}

/** Validación del ZIP subido (manifiesto, hashes y — en el job — esquemas) sin escribir nada. */
export interface ArchiveInspector {
  /** Manifiesto presente y soportado, `sha256` de cada archivo, conteos; NO valida cada registro (lo hace el job). */
  inspect(zip: Buffer): ExportManifest;
}

export interface ImportOutcome {
  readonly workspaceId: string;
  readonly workspaceName: string;
  /** Filas insertadas por sección y comprobaciones de verificación (sin contenido financiero). */
  readonly report: Readonly<Record<string, unknown>>;
}

/**
 * Importa un export en UNA transacción (la unidad de trabajo en curso) y devuelve el workspace nuevo. Valida los
 * registros contra el esquema ANTES de escribir; crea el workspace `RESTORING` con el solicitante como OWNER, inserta
 * toda la historia con identificadores nuevos (sin re-ejecutar comandos), verifica saldos y balance de comprobación contra
 * el manifiesto y lo pasa a `ACTIVE`. Cualquier fallo lanza `DomainError` (`EXPORT_FILE_CORRUPTED`,
 * `EXPORT_VERIFICATION_FAILED`) y la transacción del llamador hace rollback completo. El llamador (el servicio) agrega
 * dentro de la misma transacción la auditoría, el evento y el estado de la importación.
 */
export interface WorkspaceImporter {
  importInto(input: {
    readonly zip: Buffer;
    readonly userId: string;
    readonly importId: string;
    readonly newWorkspaceId: string;
    readonly name: string;
    readonly onStep: (step: 'IMPORTING' | 'VERIFYING') => void;
  }): Promise<ImportOutcome>;
}

export interface OperationView {
  readonly id: string;
  readonly kind: 'EXPORT';
  readonly status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  readonly progressPct: number;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly error: Readonly<Record<string, unknown>> | null;
  readonly requestedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OperationRepository {
  insert(op: {
    readonly id: string;
    readonly workspaceId: string;
    readonly kind: 'EXPORT';
    readonly resourceType: string;
    readonly resourceId: string;
    readonly requestedBy: string;
  }): Promise<void>;
  find(workspaceId: string, id: string): Promise<OperationView | null>;
  update(
    workspaceId: string,
    id: string,
    patch: {
      readonly status?: OperationView['status'];
      readonly progressPct?: number;
      readonly result?: Readonly<Record<string, unknown>> | null;
      readonly error?: Readonly<Record<string, unknown>> | null;
    },
  ): Promise<void>;
}

export interface ExpiredExportRef {
  readonly workspaceId: string;
  readonly exportId: string;
  readonly requestedBy: string;
}

export interface ExportRepository {
  insert(e: WorkspaceExport): Promise<void>;
  find(workspaceId: string, id: string): Promise<WorkspaceExport | null>;
  list(workspaceId: string, limit: number): Promise<readonly WorkspaceExport[]>;
  /** Guarda con control optimista (`version`); `false` si cambió. */
  save(e: WorkspaceExport, expectedVersion: number): Promise<boolean>;
  /** Hay una exportación en curso en el workspace. */
  hasInProgress(workspaceId: string): Promise<boolean>;
  /** Exports vencidos de TODOS los workspaces (job de retención). */
  findExpired(now: Instant, limit: number): Promise<readonly ExpiredExportRef[]>;
}

export interface ImportRepository {
  insert(i: WorkspaceImport): Promise<void>;
  find(userId: string, id: string): Promise<WorkspaceImport | null>;
  save(i: WorkspaceImport): Promise<void>;
  hasInProgress(userId: string): Promise<boolean>;
}

/** Solicitud de re-autenticación reciente: lee `auth_time` del access token (docs/12 §4). */
export interface ReauthPolicy {
  /** Lanza `REAUTHENTICATION_REQUIRED` si la autenticación es más antigua que el máximo (o no tiene `auth_time`). */
  assertRecent(authTimeSeconds: number | undefined, now: Instant): void;
}

export interface ExportJob {
  readonly workspaceId: string;
  readonly exportId: string;
  readonly requestedBy: string;
}

export interface ImportJob {
  readonly importId: string;
  readonly requestedBy: string;
}

/** Colas del worker, encoladas EN la transacción del comando. */
export interface PortabilityJobPort {
  enqueueExport(job: ExportJob): Promise<void>;
  enqueueImport(job: ImportJob): Promise<void>;
}

export interface PortabilitySettings {
  /** Retención del archivo desde que termina (`EXPORT_RETENTION`, en ms). */
  readonly retentionMs: number;
  readonly formatVersion: number;
  /** Tamaño máximo del archivo importable en bytes (`WORKSPACE_IMPORT_MAX_BYTES`). */
  readonly maxImportBytes: number;
  /** Nombre de aplicación para el manifiesto. */
  readonly pfosVersion: string;
  /** Sufijo del nombre del workspace restaurado ("W1 (restaurado)"). */
  readonly restoredSuffix: string;
}

export interface PortabilityDeps extends IdentityDeps {
  readonly exports: ExportRepository;
  readonly imports: ImportRepository;
  readonly operations: OperationRepository;
  readonly store: ExportObjectStore;
  readonly cipher: EnvelopeCipher;
  readonly builder: ExportArchiveBuilder;
  readonly inspector: ArchiveInspector;
  readonly importer: WorkspaceImporter;
  readonly reauth: ReauthPolicy;
  readonly jobs: PortabilityJobPort;
  readonly settings: PortabilitySettings;
}
