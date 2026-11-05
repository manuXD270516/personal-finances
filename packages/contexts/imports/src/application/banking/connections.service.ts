import type { AuditActorDto, AuditChangeInput, AuditEntry, LifecycleStepInput } from '@pf/audit/contracts';
import { DomainError, LocalDate } from '@pf/shared-kernel';
import {
  CONNECTION_AGGREGATE,
  CONNECTION_LIFECYCLE,
  Connection,
  ImportJob,
  sha256Hex,
  type AssetMapping,
  type ConnectionState,
  type MappedAccount,
  type ProviderAvailability,
  type ProviderDescriptor,
} from '../../domain/index.js';
import { recordJob } from '../job-recorder.js';
import type { ImportsDeps } from '../ports/index.js';
import { credentialAad, maskedFingerprint } from './credential-vault.js';
import { ExternalRecordStager } from './external-stager.js';
import type { BankingDeps, CredentialSummary } from './ports.js';

/** Vista de la conexión para la API: SIN credenciales, solo la huella enmascarada (NFR-SEC-015). */
export interface ConnectionView {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly status: ConnectionState['status'];
  readonly assetMappings: readonly AssetMapping[];
  readonly credential: {
    readonly fingerprint: string;
    readonly kid: string;
    readonly verifiedAt: string | null;
    readonly permissions: CredentialSummary['permissions'];
  } | null;
  readonly lastError: { readonly code: string } | null;
  /** Fecha (`YYYY-MM-DD`) del cursor confirmado. */
  readonly syncCursor: string | null;
  readonly cursorConfirmedAt: string | null;
  readonly lastSyncAt: string | null;
  readonly retryNotBefore: string | null;
  readonly syncInProgress: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revokedAt: string | null;
  readonly version: number;
}

export interface ProviderView {
  readonly id: string;
  readonly kind: ProviderDescriptor['kind'];
  readonly displayName: string;
  readonly credentialMode: ProviderDescriptor['credentialMode'];
  readonly capabilities: ProviderDescriptor['capabilities'];
  readonly availability: ProviderAvailability;
  readonly attribution: string | null;
}

export interface CredentialInput {
  /** Identificador de la clave (visible solo en sus últimos 4 caracteres). */
  readonly keyId: string;
  /** Secreto: `writeOnly`, nunca se devuelve ni se registra. */
  readonly secret: string;
}

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `connection ${id} not found`);
const preconditionFailed = (currentVersion: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    details: { currentVersion },
  });

export const toConnectionView = (
  s: ConnectionState,
  credential: CredentialSummary | null,
): ConnectionView => ({
  id: s.id,
  providerId: s.providerId,
  name: s.name,
  status: s.status,
  assetMappings: s.assetMappings,
  credential:
    credential === null || credential.destroyed
      ? null
      : {
          fingerprint: credential.fingerprint,
          kid: credential.kid,
          verifiedAt: credential.verifiedAt,
          permissions: credential.permissions,
        },
  lastError: s.lastErrorCode === null ? null : { code: s.lastErrorCode },
  syncCursor: s.syncCursor,
  cursorConfirmedAt: s.cursorConfirmedAt,
  lastSyncAt: s.lastSyncAt,
  retryNotBefore: s.retryNotBefore,
  syncInProgress: s.pendingSync !== null,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  revokedAt: s.revokedAt,
  version: s.version,
});

/** Auditoría + recorrido de un cambio de la conexión en la MISMA unidad de trabajo (INV-029). Nunca secretos. */
export async function recordConnection(
  deps: ImportsDeps,
  connection: Connection,
  action: string,
  options: { readonly changes?: readonly AuditChangeInput[]; readonly actor?: AuditActorDto } = {},
): Promise<void> {
  const s = connection.state;
  const entry: AuditEntry = {
    workspaceId: s.workspaceId,
    action: `imports.connection.${action}`,
    aggregateType: CONNECTION_AGGREGATE,
    aggregateId: s.id,
    aggregateVersion: s.version,
    changes: options.changes ?? [],
    ...(options.actor ? { actor: options.actor } : {}),
  };
  const t = connection.lastTransition;
  const steps: LifecycleStepInput[] = t
    ? [
        {
          kind: 'TRANSITION',
          transition: t.transition,
          fromState: t.from,
          toState: t.to,
          machineVersion: CONNECTION_LIFECYCLE.version,
          events: [],
        },
      ]
    : [{ kind: 'ANNOTATION', changedFields: [...connection.changedFields], events: [] }];
  await deps.lifecycle.record(entry, steps);
}

const mappingsJson = (m: readonly AssetMapping[]): string => JSON.stringify(m);

/**
 * `ConnectionsService` (openspec add-banking-providers decisiones 3–6): crear, mapear, reemplazar la credencial,
 * revocar y pedir una sincronización. Roles: lo hace cumplir la API (OWNER gestiona; OWNER y EDITOR sincronizan). La
 * credencial se cifra aquí (la API solo tiene la clave pública) y el secreto no vuelve a salir de este módulo.
 */
export class ConnectionsService {
  constructor(
    private readonly deps: ImportsDeps,
    private readonly banking: BankingDeps,
  ) {}

  providers(): readonly ProviderView[] {
    return this.banking.registry.catalog().map(({ descriptor: d, availability }) => ({
      id: d.id,
      kind: d.kind,
      displayName: d.displayName,
      credentialMode: d.credentialMode,
      capabilities: d.capabilities,
      availability,
      attribution: d.attribution,
    }));
  }

  async list(workspaceId: string): Promise<readonly ConnectionView[]> {
    const { deps, banking } = this;
    return deps.uow.run(workspaceId, async () => {
      const all = await banking.connections.list(workspaceId);
      const out: ConnectionView[] = [];
      // Secuencial: nunca consultas en paralelo sobre el mismo cliente pg.
      for (const c of all) {
        out.push(toConnectionView(c.state, await banking.connections.credentialSummary(workspaceId, c.id)));
      }
      return out;
    });
  }

  async get(workspaceId: string, id: string): Promise<ConnectionView> {
    const { deps, banking } = this;
    return deps.uow.run(workspaceId, async () => {
      const c = await banking.connections.findById(workspaceId, id);
      if (!c) throw notFound(id);
      return toConnectionView(c.state, await banking.connections.credentialSummary(workspaceId, id));
    });
  }

  // ───────────────────────────────────────────────────────────── crear

  async create(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly providerId: string;
    readonly name: string;
    readonly assetMappings: readonly AssetMapping[];
    readonly credential?: CredentialInput | undefined;
  }): Promise<ConnectionView> {
    const { deps, banking } = this;
    const provider = banking.registry.requireAvailable(cmd.providerId);
    const needsCredential = provider.credentialMode !== 'NONE';
    if (needsCredential && !cmd.credential) {
      throw new DomainError('VALIDATION_FAILED', 'the provider needs a credential').at('/credential');
    }
    if (!needsCredential && cmd.credential) {
      throw new DomainError('VALIDATION_FAILED', 'the provider takes no credential').at('/credential');
    }
    if (needsCredential && !banking.vault.canEncrypt) {
      // Sin las claves `CONNECTION_CREDENTIALS_*` el módulo de conexiones queda deshabilitado (decisión 3).
      throw new DomainError('BANKING_PROVIDER_NOT_AVAILABLE', 'provider connections are not enabled').at(
        '/providerId',
      );
    }
    const id = deps.ids.next();
    const now = deps.clock.now().toString();
    const view = await deps.uow.run(cmd.workspaceId, async () => {
      await this.assertMappings(cmd.workspaceId, cmd.assetMappings);
      if (await banking.connections.nameTaken(cmd.workspaceId, cmd.name.trim())) {
        throw new DomainError('VALIDATION_FAILED', 'a connection with this name already exists').at('/name');
      }
      const connection = Connection.create({
        id,
        workspaceId: cmd.workspaceId,
        providerId: provider.id,
        name: cmd.name,
        assetMappings: cmd.assetMappings,
        createdBy: cmd.userId,
        now,
        initial: needsCredential ? 'PENDING_VERIFICATION' : 'ACTIVE',
      });
      await banking.connections.insert(connection);
      connection.markPersisted();
      let fingerprint: string | null = null;
      if (cmd.credential) {
        fingerprint = maskedFingerprint(cmd.credential.keyId);
        await banking.connections.insertCredential({
          workspaceId: cmd.workspaceId,
          connectionId: id,
          credentialVersion: 1,
          sealed: banking.vault.seal(cmd.credential, credentialAad(cmd.workspaceId, id, 1)),
          fingerprint,
        });
      }
      await recordConnection(deps, connection, 'created', {
        changes: [
          { field: 'providerId', before: null, after: provider.id },
          { field: 'name', before: null, after: connection.state.name },
          { field: 'status', before: null, after: connection.state.status },
          { field: 'assetMappings', before: null, after: mappingsJson(cmd.assetMappings) },
          ...(fingerprint ? [{ field: 'fingerprint', before: null, after: fingerprint }] : []),
        ],
      });
      // El job existe solo si la transacción confirma (como el relay del outbox).
      if (needsCredential) {
        await banking.queue.enqueueVerify({
          workspaceId: cmd.workspaceId,
          connectionId: id,
          actorUserId: cmd.userId,
        });
      }
      return toConnectionView(
        connection.state,
        await banking.connections.credentialSummary(cmd.workspaceId, id),
      );
    });
    return view;
  }

  // ───────────────────────────────────────────────────────────── mapear y reemplazar credencial

  async update(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly connectionId: string;
    readonly expectedVersion: number;
    readonly name?: string | undefined;
    readonly assetMappings?: readonly AssetMapping[] | undefined;
  }): Promise<ConnectionView> {
    const { deps, banking } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const connection = await this.load(cmd.workspaceId, cmd.connectionId, cmd.expectedVersion);
      const before = connection.state;
      if (cmd.assetMappings) {
        await this.assertMappings(cmd.workspaceId, cmd.assetMappings);
        connection.remap(cmd.assetMappings, deps.clock.now().toString());
      }
      if (cmd.name !== undefined && cmd.name.trim() !== before.name) {
        if (await banking.connections.nameTaken(cmd.workspaceId, cmd.name.trim(), before.id)) {
          throw new DomainError('VALIDATION_FAILED', 'a connection with this name already exists').at(
            '/name',
          );
        }
        connection.rename(cmd.name, deps.clock.now().toString());
      }
      await this.save(connection);
      await recordConnection(deps, connection, 'updated', {
        changes: [
          ...(connection.state.name !== before.name
            ? [{ field: 'name', before: before.name, after: connection.state.name }]
            : []),
          ...(cmd.assetMappings
            ? [
                {
                  field: 'assetMappings',
                  before: mappingsJson(before.assetMappings),
                  after: mappingsJson(connection.state.assetMappings),
                },
              ]
            : []),
        ],
      });
      return toConnectionView(
        connection.state,
        await banking.connections.credentialSummary(cmd.workspaceId, cmd.connectionId),
      );
    });
  }

  async replaceCredential(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly connectionId: string;
    readonly expectedVersion: number;
    readonly credential: CredentialInput;
  }): Promise<ConnectionView> {
    const { deps, banking } = this;
    const view = await deps.uow.run(cmd.workspaceId, async () => {
      const connection = await this.load(cmd.workspaceId, cmd.connectionId, cmd.expectedVersion);
      const descriptor = banking.registry.get(connection.state.providerId);
      if (!descriptor || descriptor.credentialMode === 'NONE') {
        throw new DomainError('VALIDATION_FAILED', 'the provider takes no credential').at('/credential');
      }
      if (!banking.vault.canEncrypt) {
        throw new DomainError('BANKING_PROVIDER_NOT_AVAILABLE', 'provider connections are not enabled');
      }
      const previous = await banking.connections.credentialSummary(cmd.workspaceId, cmd.connectionId);
      const version = (previous?.credentialVersion ?? 0) + 1;
      const fingerprint = maskedFingerprint(cmd.credential.keyId);
      const sealed = banking.vault.seal(
        cmd.credential,
        credentialAad(cmd.workspaceId, cmd.connectionId, version),
      );
      const before = connection.state.status;
      connection.credentialReplaced(deps.clock.now().toString());
      await this.save(connection);
      if (previous) {
        await banking.connections.replaceCredential({
          workspaceId: cmd.workspaceId,
          connectionId: cmd.connectionId,
          credentialVersion: version,
          sealed,
          fingerprint,
        });
      } else {
        await banking.connections.insertCredential({
          workspaceId: cmd.workspaceId,
          connectionId: cmd.connectionId,
          credentialVersion: version,
          sealed,
          fingerprint,
        });
      }
      await recordConnection(deps, connection, 'credential_replaced', {
        changes: [
          { field: 'status', before, after: connection.state.status },
          { field: 'fingerprint', before: previous?.fingerprint ?? null, after: fingerprint },
        ],
      });
      await banking.queue.enqueueVerify({
        workspaceId: cmd.workspaceId,
        connectionId: cmd.connectionId,
        actorUserId: cmd.userId,
      });
      return toConnectionView(
        connection.state,
        await banking.connections.credentialSummary(cmd.workspaceId, cmd.connectionId),
      );
    });
    return view;
  }

  // ───────────────────────────────────────────────────────────── revocar

  /** Revoca y destruye la credencial en la MISMA unidad de trabajo que la auditoría (destrucción criptográfica). */
  async revoke(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly connectionId: string;
    readonly expectedVersion: number;
  }): Promise<ConnectionView> {
    const { deps, banking } = this;
    return deps.uow.run(cmd.workspaceId, async () => {
      const connection = await this.load(cmd.workspaceId, cmd.connectionId, cmd.expectedVersion);
      const before = connection.state.status;
      const now = deps.clock.now().toString();
      // Una sincronización sin aprobar no sobrevive a la revocación: su import se cancela (lo ya aprobado sigue su curso).
      const pending = connection.state.pendingSync;
      if (pending) {
        const job = await deps.jobs.findById(cmd.workspaceId, pending.jobId, { lock: 'update' });
        if (job && ['PROCESSING', 'AWAITING_MAPPING', 'AWAITING_REVIEW'].includes(job.state.status)) {
          const jobBefore = job.state.status;
          job.cancel({ actor: { type: 'USER', userId: cmd.userId }, now });
          if (!(await deps.jobs.save(job))) {
            throw new DomainError('CONCURRENCY_CONFLICT', 'the import was modified concurrently');
          }
          job.markPersisted();
          await deps.staging.deleteAll(cmd.workspaceId, job.id);
          await recordJob(deps, job, 'cancelled', {
            changes: [{ field: 'status', before: jobBefore, after: 'CANCELLED' }],
          });
        }
      }
      connection.revoke(now);
      await this.save(connection);
      await banking.connections.destroyCredential(cmd.workspaceId, cmd.connectionId, now);
      await recordConnection(deps, connection, 'revoked', {
        changes: [{ field: 'status', before, after: 'REVOKED' }],
      });
      return toConnectionView(
        connection.state,
        await banking.connections.credentialSummary(cmd.workspaceId, cmd.connectionId),
      );
    });
  }

  // ───────────────────────────────────────────────────────────── sincronizar

  /** Crea el import de la sincronización (`PROCESSING`) y encola `imports.connection-sync`. */
  async sync(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly connectionId: string;
    readonly from?: string | undefined;
  }): Promise<{
    readonly importJobId: string;
    readonly window: { readonly from: string; readonly to: string };
  }> {
    const { deps, banking } = this;
    const jobId = deps.ids.next();
    const result = await deps.uow.run(cmd.workspaceId, async () => {
      const connection = await this.load(cmd.workspaceId, cmd.connectionId, null);
      const state = connection.state;
      const descriptor = banking.registry.get(state.providerId);
      if (!descriptor || descriptor.credentialMode === 'NONE') {
        throw new DomainError('VALIDATION_FAILED', 'this connection has no remote history to sync').at(
          '/connectionId',
        );
      }
      // Estado primero: una revocada responde INVALID_STATUS_TRANSITION aunque tenga algo en curso.
      connection.assertCanSync();
      if (state.pendingSync !== null) {
        throw new DomainError('CONNECTION_SYNC_IN_PROGRESS', 'a synchronization is already in progress');
      }
      const timeZone = await deps.calendar.timeZoneOf(cmd.workspaceId);
      const today = LocalDate.ofInstant(deps.clock.now(), timeZone);
      const earliest = today.plusDays(-banking.settings.syncMaxDays).toString();
      const from = cmd.from ?? state.syncCursor;
      if (from === null || from === undefined) {
        throw new DomainError('VALIDATION_FAILED', 'the first synchronization needs a start date').at(
          '/from',
        );
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from > today.toString() || from < earliest) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `the start date must be within the last ${banking.settings.syncMaxDays} days`,
        ).at('/from');
      }
      const anchor = state.assetMappings[0]?.accountId;
      if (!anchor) {
        throw new DomainError('VALIDATION_FAILED', 'the connection has no asset mapped to an account').at(
          '/assetMappings',
        );
      }
      const to = today.toString();
      const now = deps.clock.now().toString();
      const job = ImportJob.createFromConnection({
        id: jobId,
        workspaceId: cmd.workspaceId,
        accountId: anchor,
        connectionId: state.id,
        createdBy: cmd.userId,
        now,
        source: 'EXCHANGE_API',
        originalName: null,
        fileChecksum: sha256Hex(`${state.id}|${from}|${to}|${jobId}`),
        fileSizeBytes: 0,
        stage: 'PARSE',
      });
      try {
        await deps.jobs.insert(job);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new DomainError('CONNECTION_SYNC_IN_PROGRESS', 'a synchronization is already in progress');
        }
        throw err;
      }
      job.markPersisted();
      connection.beginSync({ jobId, from, to }, now);
      await this.save(connection);
      await recordJob(deps, job, 'sync_started', {
        changes: [
          { field: 'status', before: null, after: 'PROCESSING' },
          { field: 'stage', before: null, after: 'PARSE' },
        ],
      });
      await recordConnection(deps, connection, 'sync_requested', {
        changes: [{ field: 'syncWindow', before: null, after: JSON.stringify({ from, to }) }],
      });
      await banking.queue.enqueueSync({
        workspaceId: cmd.workspaceId,
        connectionId: cmd.connectionId,
        actorUserId: cmd.userId,
        importJobId: jobId,
      });
      return { importJobId: jobId, window: { from, to } };
    });
    return result;
  }

  // ───────────────────────────────────────────────────────────── archivo de historial

  /**
   * Sube el historial exportado por el usuario a una conexión de ARCHIVO (sin credenciales): lee el documento, lo
   * interpreta con el formato VERIFICADO del proveedor (si no coincide con ninguno, `IMPORT_UNSUPPORTED_FORMAT`) y
   * entrega los registros a la MISMA normalización que la API, con el mismo namespace de referencias. Crea el import en
   * `PROCESSING` y encola el job que lo lleva a la vista previa.
   */
  async createFileImport(cmd: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly connectionId: string;
    readonly documentId: string;
  }): Promise<{ readonly importJobId: string }> {
    const { deps, banking } = this;
    const jobId = deps.ids.next();
    return deps.uow.run(cmd.workspaceId, async () => {
      const connection = await this.load(cmd.workspaceId, cmd.connectionId, null);
      const state = connection.state;
      const descriptor = banking.registry.get(state.providerId);
      const provider = descriptor ? banking.adapters.file(descriptor.id) : null;
      if (!descriptor || !provider || descriptor.credentialMode !== 'NONE') {
        throw new DomainError('VALIDATION_FAILED', 'this connection does not take history files').at(
          '/connectionId',
        );
      }
      connection.assertCanSync();
      const document = await deps.documents.getForProcessing(cmd.workspaceId, cmd.documentId);
      if (!document) throw new DomainError('REFERENCE_NOT_FOUND', 'document not found').at('/documentId');
      if (document.status !== 'AVAILABLE') {
        throw new DomainError('DOCUMENT_NOT_AVAILABLE', 'the document is not available').at('/documentId');
      }
      if (document.purpose !== 'IMPORT_SOURCE') {
        throw new DomainError('VALIDATION_FAILED', 'the document is not a statement to import').at(
          '/documentId',
        );
      }
      const bytes = await deps.documents.readBytes(
        cmd.workspaceId,
        cmd.documentId,
        deps.settings.documentMaxBytes,
      );
      const records = provider.parse(bytes);
      if (records === null) {
        throw new DomainError(
          'IMPORT_UNSUPPORTED_FORMAT',
          'the file matches no verified format of the provider',
        );
      }
      const anchor = state.assetMappings[0]?.accountId;
      if (!anchor) {
        throw new DomainError('VALIDATION_FAILED', 'the connection has no asset mapped to an account').at(
          '/assetMappings',
        );
      }
      const now = deps.clock.now().toString();
      const job = ImportJob.createFromConnection({
        id: jobId,
        workspaceId: cmd.workspaceId,
        accountId: anchor,
        connectionId: state.id,
        createdBy: cmd.userId,
        now,
        source: 'EXCHANGE_FILE',
        originalName: document.originalName,
        fileChecksum: document.sha256,
        fileSizeBytes: document.sizeBytes,
        stage: 'PARSE',
      });
      await deps.jobs.insert(job);
      job.markPersisted();
      const timeZone = await deps.calendar.timeZoneOf(cmd.workspaceId);
      const resolve = await this.resolverOf(cmd.workspaceId, state);
      await new ExternalRecordStager(deps).stageExternalRecords({
        workspaceId: cmd.workspaceId,
        importJobId: jobId,
        records,
        context: { providerId: descriptor.id, exchange: descriptor.exchange, timeZone, resolve },
      });
      await deps.documents.linkToImport({
        workspaceId: cmd.workspaceId,
        documentId: cmd.documentId,
        importJobId: jobId,
        actorUserId: cmd.userId,
      });
      await recordJob(deps, job, 'file_uploaded', {
        changes: [
          { field: 'status', before: null, after: 'PROCESSING' },
          { field: 'documentId', before: null, after: cmd.documentId },
        ],
      });
      await banking.queue.enqueueSync({
        workspaceId: cmd.workspaceId,
        connectionId: cmd.connectionId,
        actorUserId: cmd.userId,
        importJobId: jobId,
      });
      return { importJobId: jobId };
    });
  }

  private async resolverOf(workspaceId: string, state: ConnectionState) {
    const map = new Map<string, MappedAccount>();
    for (const m of state.assetMappings) {
      const account = await this.deps.accounts.getAccount(workspaceId, m.accountId);
      const scale = account ? await this.deps.currencies.scaleOf(account.currency) : null;
      if (account && scale !== null)
        map.set(m.asset, { accountId: m.accountId, currency: account.currency, scale });
    }
    return (asset: string) => map.get(asset) ?? null;
  }

  // ───────────────────────────────────────────────────────────── helpers

  /** Cada activo mapea a una cuenta activa de SU moneda (INV-002); si no, `CURRENCY_MISMATCH` (422). */
  private async assertMappings(workspaceId: string, mappings: readonly AssetMapping[]): Promise<void> {
    for (const [i, m] of mappings.entries()) {
      const account = await this.deps.accounts
        .assertActive(workspaceId, m.accountId)
        .catch((err: unknown) => {
          throw err instanceof DomainError ? err.at(`/assetMappings/${i}/accountId`) : err;
        });
      if (account.currency !== m.asset) {
        throw new DomainError(
          'CURRENCY_MISMATCH',
          `the account is in ${account.currency} but the asset is ${m.asset}`,
        ).at(`/assetMappings/${i}/accountId`);
      }
    }
  }

  private async load(workspaceId: string, id: string, expectedVersion: number | null): Promise<Connection> {
    const connection = await this.banking.connections.findById(workspaceId, id, { lock: 'update' });
    if (!connection) throw notFound(id);
    if (expectedVersion !== null && connection.state.version !== expectedVersion) {
      throw preconditionFailed(connection.state.version);
    }
    return connection;
  }

  private async save(connection: Connection): Promise<void> {
    if (!(await this.banking.connections.save(connection))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the connection was modified concurrently');
    }
    connection.markPersisted();
  }
}

export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i += 1) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
