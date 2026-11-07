import type {
  CredentialPermissions,
  Connection,
  ExternalAsset,
  ExternalRecord,
  ProviderDescriptor,
  ProviderRegistry,
} from '../../domain/index.js';
import type { CredentialSecret, CredentialVault, SealedCredential } from './credential-vault.js';

/**
 * Puertos de las conexiones con proveedores (openspec add-banking-providers decisiones 2, 3 y 6). Los adapters de
 * proveedores viven en `infrastructure/banking`; el resto son repositorios PostgreSQL y colas del runtime.
 */

/** Respuesta HTTP de un proveedor: solo lo necesario (estado, cabeceras y cuerpo de texto). */
export interface ProviderHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Cliente HTTP con allowlist por descriptor (decisión 2): solo `https` (o el host de pruebas), sin cookies, SIN seguir
 * redirecciones fuera de la lista, con cabeceras fijas. Recibe la URL ya construida por el adapter (query fija).
 */
export interface ProviderHttp {
  get(
    descriptor: ProviderDescriptor,
    url: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<ProviderHttpResponse>;
}

export interface ProviderCallContext {
  /** Credencial descifrada SOLO en memoria del worker (`null` en proveedores de archivo). */
  readonly credential: CredentialSecret | null;
  readonly http: ProviderHttp;
  readonly nowMs: () => number;
}

export interface FetchWindow {
  /** `YYYY-MM-DD` inclusive. */
  readonly from: string;
  readonly to: string;
}

export interface RecordsPage {
  readonly records: readonly ExternalRecord[];
  /** Cursor para pedir la página siguiente; `null` en la última. */
  readonly nextCursor: string | null;
}

export interface BankingProvider {
  readonly descriptor: ProviderDescriptor;
  /** Verifica la credencial y devuelve sus permisos efectivos (sin leer movimientos). */
  verifyCredential(ctx: ProviderCallContext): Promise<CredentialPermissions>;
  listAssets(ctx: ProviderCallContext): Promise<readonly ExternalAsset[]>;
  /** Registros de la ventana, en páginas; reanudable desde `cursor` (el de la última página escrita). */
  fetchRecords(
    ctx: ProviderCallContext,
    window: FetchWindow,
    cursor: string | null,
  ): AsyncIterable<RecordsPage>;
}

/** Proveedor de archivo (sin credenciales): el mismo registro externo que la API del mismo exchange. */
export interface FileHistoryProvider {
  readonly descriptor: ProviderDescriptor;
  /** `null` si el archivo no coincide con un formato verificado del proveedor (`IMPORT_UNSUPPORTED_FORMAT`). */
  parse(bytes: Uint8Array): readonly ExternalRecord[] | null;
}

export interface ProviderAdapters {
  api(providerId: string): BankingProvider | null;
  file(providerId: string): FileHistoryProvider | null;
}

// ───────────────────────────────────────────────────────────── repositorio de conexiones

export interface CredentialSummary {
  readonly fingerprint: string;
  readonly kid: string;
  readonly credentialVersion: number;
  readonly verifiedAt: string | null;
  readonly permissions: CredentialPermissions | null;
  readonly destroyed: boolean;
}

export interface StoredCredential extends SealedCredential {
  readonly credentialVersion: number;
}

export interface ConnectionRepository {
  insert(connection: Connection): Promise<void>;
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly lock?: 'update' },
  ): Promise<Connection | null>;
  /** Control optimista por `persistedVersion`. */
  save(connection: Connection): Promise<boolean>;
  list(workspaceId: string): Promise<readonly Connection[]>;
  /** Nombre ya usado por otra conexión no revocada (insensible a mayúsculas). */
  nameTaken(workspaceId: string, name: string, exceptId?: string): Promise<boolean>;

  // ── credencial (el sobre completo solo lo lee el worker)
  insertCredential(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly credentialVersion: number;
    readonly sealed: SealedCredential;
    readonly fingerprint: string;
  }): Promise<void>;
  /** Reemplaza la credencial por una nueva versión (misma fila). */
  replaceCredential(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly credentialVersion: number;
    readonly sealed: SealedCredential;
    readonly fingerprint: string;
  }): Promise<void>;
  credentialSummary(workspaceId: string, connectionId: string): Promise<CredentialSummary | null>;
  /** Solo worker: sobre completo (`wrapped_dek` y `ciphertext`); `null` si no hay o fue destruida. */
  loadSealed(workspaceId: string, connectionId: string): Promise<StoredCredential | null>;
  setVerification(
    workspaceId: string,
    connectionId: string,
    input: { readonly permissions: CredentialPermissions; readonly verifiedAt: string },
  ): Promise<void>;
  /** Destrucción criptográfica: `wrapped_dek` y `ciphertext` quedan `NULL` con `destroyed_at`. */
  destroyCredential(workspaceId: string, connectionId: string, at: string): Promise<void>;
  /** Solo worker: reescribe la envoltura de la DEK (rotación) sin tocar el texto cifrado. */
  rewrapCredential(
    workspaceId: string,
    connectionId: string,
    wrapped: {
      readonly kid: string;
      readonly ephemeralPublicKey: Uint8Array;
      readonly wrappedDek: Uint8Array;
      readonly dekNonce: Uint8Array;
    },
  ): Promise<void>;
  /** Solo worker: conexiones con credencial viva, para la rotación y la comprobación de `kid`. */
  credentialsOf(
    workspaceId: string,
  ): Promise<
    readonly { readonly connectionId: string; readonly kid: string; readonly credentialVersion: number }[]
  >;
}

/** Cola de los tres jobs (`imports.connection-verify`, `imports.connection-sync`, `imports.credentials-rewrap`). */
export interface ConnectionJobQueue {
  enqueueVerify(job: ConnectionJobPayload, startAfter?: Date): Promise<void>;
  enqueueSync(job: ConnectionJobPayload & { readonly importJobId: string }, startAfter?: Date): Promise<void>;
}

export interface ConnectionJobPayload {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly actorUserId: string;
}

export interface ConnectionSettings {
  /** `CONNECTION_SYNC_MAX_DAYS` (365, D345). */
  readonly syncMaxDays: number;
  /** `CONNECTION_PROVIDER_REQUESTS_PER_MINUTE` (10, ADR-0029). */
  readonly requestsPerMinute: number;
  /** Registros por página de staging (cada página = una transacción corta). */
  readonly maxPages: number;
}

export interface BankingDeps {
  readonly registry: ProviderRegistry;
  readonly adapters: ProviderAdapters;
  readonly connections: ConnectionRepository;
  readonly vault: CredentialVault;
  readonly queue: ConnectionJobQueue;
  readonly http: ProviderHttp;
  readonly settings: ConnectionSettings;
}
