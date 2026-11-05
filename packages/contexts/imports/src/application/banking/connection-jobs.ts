import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import { IMPORTS_EVENTS } from '../../contracts/index.js';
import {
  ProviderCallError,
  RequestBudget,
  isReadOnly,
  type Connection,
  type ConnectionState,
  type ImportFailure,
  type MappedAccount,
} from '../../domain/index.js';
import { publishJobEvent, recordJob } from '../job-recorder.js';
import type { ProcessImportService } from '../process-import.service.js';
import type { ImportsDeps } from '../ports/index.js';
import { recordConnection } from './connections.service.js';
import { credentialAad, type CredentialSecret } from './credential-vault.js';
import { ExternalRecordStager } from './external-stager.js';
import type { BankingDeps, BankingProvider, ProviderCallContext } from './ports.js';

export const CONNECTION_VERIFY_JOB = 'imports.connection-verify';
export const CONNECTION_SYNC_JOB = 'imports.connection-sync';
export const CREDENTIALS_REWRAP_JOB = 'imports.credentials-rewrap';

/** Códigos de `lastError` propios de las conexiones (no son errores HTTP). */
export const CONNECTION_KEY_UNAVAILABLE = 'CONNECTION_CREDENTIAL_KEY_UNAVAILABLE';

export type VerifyOutcome = 'VERIFIED' | 'REJECTED' | 'NEEDS_ATTENTION' | 'WAITING' | 'SKIPPED';
export type SyncOutcome = 'READY' | 'WAITING' | 'FAILED' | 'SKIPPED';

/** Intentos del job tras los que una falla transitoria del proveedor deja el import `PARSE_FAILED` (nunca `COMPLETED`). */
export const MAX_TRANSIENT_ATTEMPTS = 3;

const FAILED_STAGE = 'PARSE';

/**
 * Jobs de las conexiones (openspec add-banking-providers decisiones 5, 6 y 7): `imports.connection-verify`,
 * `imports.connection-sync` e `imports.credentials-rewrap`. Corren en el worker, que es el único proceso con las
 * claves privadas (D342); ninguno mantiene una conexión de BD abierta durante las esperas HTTP: cada escritura es una
 * transacción corta y la credencial descifrada vive solo en memoria mientras dura la llamada (NFR-SEC-015).
 */
export class ConnectionJobs {
  private readonly stager: ExternalRecordStager;
  /** Presupuesto de solicitudes por conexión (ventana deslizante en memoria; la espera del proveedor se persiste). */
  private readonly budgets = new Map<string, RequestBudget>();

  constructor(
    private readonly deps: ImportsDeps,
    private readonly banking: BankingDeps,
    private readonly process: Pick<ProcessImportService, 'processConnection'>,
  ) {
    this.stager = new ExternalRecordStager(deps);
  }

  // ───────────────────────────────────────────────────────────── verificar

  /**
   * `imports.connection-verify`: descifra la credencial, pregunta al proveedor por sus permisos EFECTIVOS (sin leer
   * movimientos) y activa la conexión solo si es de solo lectura; si permite operar, retirar o transferir se rechaza
   * (`CONNECTION_CREDENTIAL_NOT_READ_ONLY`) y la credencial se destruye.
   */
  async verify(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
  }): Promise<VerifyOutcome> {
    const { deps, banking } = this;
    const { workspaceId, connectionId } = input;
    const loaded = await deps.uow.run(workspaceId, async () => {
      const connection = await banking.connections.findById(workspaceId, connectionId);
      if (!connection || connection.state.status !== 'PENDING_VERIFICATION') return null;
      return {
        state: connection.state,
        sealed: await banking.connections.loadSealed(workspaceId, connectionId),
      };
    });
    if (!loaded) return 'SKIPPED';
    const provider = banking.adapters.api(loaded.state.providerId);
    if (!provider || !loaded.sealed) {
      await this.flag(workspaceId, connectionId, 'PENDING_VERIFICATION', 'PROVIDER_UNAVAILABLE');
      return 'NEEDS_ATTENTION';
    }
    if (!banking.vault.hasKey(loaded.sealed.kid)) {
      await this.flag(workspaceId, connectionId, 'PENDING_VERIFICATION', CONNECTION_KEY_UNAVAILABLE);
      return 'NEEDS_ATTENTION';
    }
    let permissions;
    try {
      permissions = await this.withCredential(workspaceId, connectionId, loaded.sealed, provider, (ctx) =>
        provider.verifyCredential(ctx),
      );
    } catch (err) {
      if (err instanceof ProviderCallError) {
        if (err.code === 'PROVIDER_AUTH_REJECTED') {
          await this.flag(workspaceId, connectionId, 'PENDING_VERIFICATION', 'IMPORT_CONNECTION_EXPIRED');
          return 'NEEDS_ATTENTION';
        }
        if (err.code === 'PROVIDER_RATE_LIMITED') {
          const until = err.retryNotBefore ?? new Date(deps.clock.now().epochMillis + 60_000).toISOString();
          await deps.uow.run(workspaceId, async () => {
            await this.waitUntilInTx(workspaceId, connectionId, until);
            await banking.queue.enqueueVerify(
              { workspaceId, connectionId, actorUserId: loaded.state.createdBy },
              new Date(Date.parse(until)),
            );
          });
          return 'WAITING';
        }
      }
      throw err;
    }
    const now = deps.clock.now().toString();
    const readOnly = isReadOnly(permissions);
    await deps.uow.run(workspaceId, async () => {
      const connection = await banking.connections.findById(workspaceId, connectionId, { lock: 'update' });
      if (!connection || connection.state.status !== 'PENDING_VERIFICATION') return;
      await banking.connections.setVerification(workspaceId, connectionId, { permissions, verifiedAt: now });
      if (readOnly) connection.verified(now);
      else {
        connection.rejected('CONNECTION_CREDENTIAL_NOT_READ_ONLY', now);
        await banking.connections.destroyCredential(workspaceId, connectionId, now);
      }
      await this.save(connection);
      await recordConnection(deps, connection, readOnly ? 'verified' : 'rejected', {
        changes: [
          { field: 'status', before: 'PENDING_VERIFICATION', after: connection.state.status },
          { field: 'permissions', before: null, after: JSON.stringify(permissions) },
        ],
      });
    });
    return readOnly ? 'VERIFIED' : 'REJECTED';
  }

  // ───────────────────────────────────────────────────────────── sincronizar

  /**
   * `imports.connection-sync`: re-verifica los permisos y recorre `fetchRecords` desde el cursor provisional; cada
   * página se escribe en el staging en una transacción corta junto con su cursor (una caída reanuda sin repetir). Al
   * terminar entrega los registros a la normalización y deja el import en vista previa. El cursor CONFIRMADO no se
   * mueve aquí: lo mueve la finalización del import.
   */
  async sync(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly importJobId: string;
    /** Intento de la cola (1 = primero). */
    readonly attempt?: number;
  }): Promise<SyncOutcome> {
    const { deps, banking } = this;
    const { workspaceId, connectionId, importJobId } = input;
    // Archivo de historial: los registros ya están en el staging; solo falta la normalización hasta la vista previa.
    const fileJob = await deps.uow.run(workspaceId, async () => {
      const job = await deps.jobs.findById(workspaceId, importJobId);
      return job?.state.source === 'EXCHANGE_FILE' && job.state.status === 'PROCESSING';
    });
    if (fileJob) {
      const processed = await this.process.processConnection({ workspaceId, importId: importJobId });
      return processed === 'AWAITING_REVIEW' ? 'READY' : 'SKIPPED';
    }
    const loaded = await deps.uow.run(workspaceId, async () => {
      const connection = await banking.connections.findById(workspaceId, connectionId);
      const job = await deps.jobs.findById(workspaceId, importJobId);
      if (!connection || !job) return null;
      const state = connection.state;
      if (job.state.status !== 'PROCESSING' || state.pendingSync?.jobId !== importJobId) return null;
      if (state.status !== 'ACTIVE') return null;
      return {
        state,
        sealed: await banking.connections.loadSealed(workspaceId, connectionId),
        timeZone: await deps.calendar.timeZoneOf(workspaceId),
      };
    });
    if (!loaded) return 'SKIPPED';
    const { state } = loaded;
    const pending = state.pendingSync as NonNullable<ConnectionState['pendingSync']>;

    // Espera persistida del proveedor: el job se reprograma, no duerme con recursos tomados.
    const nowMs = deps.clock.now().epochMillis;
    if (state.retryNotBefore !== null && Date.parse(state.retryNotBefore) > nowMs) {
      await deps.uow.run(workspaceId, () =>
        banking.queue.enqueueSync(
          { workspaceId, connectionId, actorUserId: state.createdBy, importJobId },
          new Date(Date.parse(state.retryNotBefore as string)),
        ),
      );
      return 'WAITING';
    }
    const provider = banking.adapters.api(state.providerId);
    if (!provider || !loaded.sealed) {
      await this.failImport(
        workspaceId,
        connectionId,
        importJobId,
        { code: 'PROVIDER_UNAVAILABLE', pointer: null },
        {
          attention: 'PROVIDER_UNAVAILABLE',
        },
      );
      return 'FAILED';
    }
    if (!banking.vault.hasKey(loaded.sealed.kid)) {
      // Clave maestra ausente: esta conexión pasa a atención sin detener las demás.
      await this.failImport(
        workspaceId,
        connectionId,
        importJobId,
        { code: 'PROVIDER_UNAVAILABLE', pointer: null },
        {
          attention: CONNECTION_KEY_UNAVAILABLE,
        },
      );
      return 'FAILED';
    }

    const scales = await this.mappedAccounts(workspaceId, state);
    try {
      return await this.withCredential(workspaceId, connectionId, loaded.sealed, provider, async (ctx) => {
        const budget = this.budgetOf(connectionId);
        // 1) Cada sincronización vuelve a verificar que la clave siga siendo de solo lectura (sin leer movimientos).
        //    Cuenta en el presupuesto de solicitudes de la conexión como cualquier otra.
        const verifyWait = budget.take(deps.clock.now().epochMillis);
        if (verifyWait > 0) {
          await this.defer(
            workspaceId,
            connectionId,
            importJobId,
            state.createdBy,
            deps.clock.now().epochMillis + verifyWait,
          );
          return 'WAITING' as const;
        }
        const permissions = await provider.verifyCredential(ctx);
        if (!isReadOnly(permissions)) {
          await this.failImport(
            workspaceId,
            connectionId,
            importJobId,
            { code: 'CONNECTION_CREDENTIAL_NOT_READ_ONLY', pointer: null },
            { attention: 'CONNECTION_CREDENTIAL_NOT_READ_ONLY' },
          );
          return 'FAILED' as const;
        }
        // 2) Páginas: cada una en su transacción corta, con el cursor provisional.
        const window = { from: pending.from, to: pending.to };
        const pages = provider.fetchRecords(ctx, window, pending.pageCursor)[Symbol.asyncIterator]();
        for (;;) {
          const wait = budget.take(deps.clock.now().epochMillis);
          if (wait > 0) {
            await this.defer(
              workspaceId,
              connectionId,
              importJobId,
              state.createdBy,
              deps.clock.now().epochMillis + wait,
            );
            return 'WAITING' as const;
          }
          const step = await pages.next();
          if (step.done) break;
          const page = step.value;
          const staged = await deps.uow.runDetached(workspaceId, async () => {
            const job = await deps.jobs.findById(workspaceId, importJobId, { lock: 'update' });
            const connection = await banking.connections.findById(workspaceId, connectionId, {
              lock: 'update',
            });
            if (!job || !connection || job.state.status !== 'PROCESSING') return false;
            if (connection.state.pendingSync?.jobId !== importJobId) return false;
            await this.stager.stageExternalRecords({
              workspaceId,
              importJobId,
              records: page.records,
              context: {
                providerId: provider.descriptor.id,
                exchange: provider.descriptor.exchange,
                timeZone: loaded.timeZone,
                resolve: (asset) => scales.get(asset) ?? null,
              },
            });
            connection.pageStaged(page.nextCursor, deps.clock.now().toString());
            await this.save(connection);
            return true;
          });
          // El usuario canceló el import mientras se traían las páginas: se detiene sin más.
          if (!staged) return 'SKIPPED' as const;
          if (page.nextCursor === null) break;
        }
        return 'READY' as const;
      }).then(async (outcome) => {
        if (outcome !== 'READY') return outcome;
        const processed = await this.process.processConnection({ workspaceId, importId: importJobId });
        return processed === 'AWAITING_REVIEW' ? ('READY' as const) : ('SKIPPED' as const);
      });
    } catch (err) {
      if (err instanceof ProviderCallError) return this.onProviderError(err, input, state);
      throw err;
    }
  }

  private async onProviderError(
    err: ProviderCallError,
    input: {
      readonly workspaceId: string;
      readonly connectionId: string;
      readonly importJobId: string;
      readonly attempt?: number;
    },
    state: ConnectionState,
  ): Promise<SyncOutcome> {
    const { workspaceId, connectionId, importJobId } = input;
    switch (err.code) {
      case 'PROVIDER_AUTH_REJECTED':
        await this.failImport(
          workspaceId,
          connectionId,
          importJobId,
          { code: 'IMPORT_CONNECTION_EXPIRED', pointer: null },
          {
            attention: 'IMPORT_CONNECTION_EXPIRED',
          },
        );
        return 'FAILED';
      case 'PROVIDER_RATE_LIMITED': {
        const until = err.retryNotBefore
          ? Date.parse(err.retryNotBefore)
          : this.deps.clock.now().epochMillis + 60_000;
        await this.defer(workspaceId, connectionId, importJobId, state.createdBy, until);
        return 'WAITING';
      }
      case 'PROVIDER_UNAVAILABLE':
        // Transitoria: la cola reintenta con backoff; agotados los intentos, el import queda fallido (nunca completo).
        if ((input.attempt ?? 1) < MAX_TRANSIENT_ATTEMPTS) throw err;
        await this.failImport(
          workspaceId,
          connectionId,
          importJobId,
          { code: 'PROVIDER_UNAVAILABLE', pointer: null },
          {},
        );
        return 'FAILED';
      default:
        await this.failImport(
          workspaceId,
          connectionId,
          importJobId,
          { code: 'PROVIDER_UNAVAILABLE', pointer: null },
          {},
        );
        return 'FAILED';
    }
  }

  // ───────────────────────────────────────────────────────────── rotación

  /**
   * `imports.credentials-rewrap`: vuelve a envolver la DEK de cada credencial con la clave maestra vigente SIN
   * descifrar el secreto. Una credencial cuyo `kid` ya no está en el llavero deja su conexión en «requiere atención»
   * sin detener las demás. Devuelve cuántas se rotaron.
   */
  async rewrap(input: {
    readonly workspaceId: string;
  }): Promise<{ readonly rewrapped: number; readonly flagged: number }> {
    const { deps, banking } = this;
    const { workspaceId } = input;
    const all = await deps.uow.run(workspaceId, () => banking.connections.credentialsOf(workspaceId));
    let rewrapped = 0;
    let flagged = 0;
    for (const item of all) {
      if (item.kid === banking.vault.activeKid) continue;
      if (!banking.vault.hasKey(item.kid)) {
        flagged += 1;
        await this.flagAny(workspaceId, item.connectionId, CONNECTION_KEY_UNAVAILABLE);
        continue;
      }
      await deps.uow.run(workspaceId, async () => {
        const sealed = await banking.connections.loadSealed(workspaceId, item.connectionId);
        if (!sealed) return;
        const aad = credentialAad(workspaceId, item.connectionId, sealed.credentialVersion);
        await banking.connections.rewrapCredential(
          workspaceId,
          item.connectionId,
          banking.vault.rewrap(sealed, aad),
        );
        rewrapped += 1;
      });
    }
    return { rewrapped, flagged };
  }

  // ───────────────────────────────────────────────────────────── helpers

  /** Descifra en memoria, ejecuta la llamada y descarta la credencial (nunca se registra ni se conserva). */
  private async withCredential<T>(
    workspaceId: string,
    connectionId: string,
    sealed: NonNullable<Awaited<ReturnType<BankingDeps['connections']['loadSealed']>>>,
    provider: BankingProvider,
    run: (ctx: ProviderCallContext) => Promise<T>,
  ): Promise<T> {
    const secret: CredentialSecret = this.banking.vault.open(
      sealed,
      credentialAad(workspaceId, connectionId, sealed.credentialVersion),
    );
    try {
      return await run({
        credential: secret,
        http: this.banking.http,
        nowMs: () => this.deps.clock.now().epochMillis,
      });
    } finally {
      // Descarte best-effort: las cadenas JS son inmutables, pero se suelta toda referencia.
      (secret as { keyId: string; secret: string }).secret = '';
      void provider;
    }
  }

  private budgetOf(connectionId: string): RequestBudget {
    let b = this.budgets.get(connectionId);
    if (!b) {
      b = new RequestBudget(this.banking.settings.requestsPerMinute);
      this.budgets.set(connectionId, b);
    }
    return b;
  }

  private async mappedAccounts(
    workspaceId: string,
    state: ConnectionState,
  ): Promise<Map<string, MappedAccount>> {
    const { deps } = this;
    const out = new Map<string, MappedAccount>();
    for (const m of state.assetMappings) {
      const account = await deps.uow.run(workspaceId, () =>
        deps.accounts.getAccount(workspaceId, m.accountId),
      );
      if (!account) continue;
      const scale = await deps.uow.run(workspaceId, () => deps.currencies.scaleOf(account.currency));
      if (scale === null) continue;
      out.set(m.asset, { accountId: m.accountId, currency: account.currency, scale });
    }
    return out;
  }

  /** Persiste la espera del proveedor y reprograma el job para ese instante. */
  private async defer(
    workspaceId: string,
    connectionId: string,
    importJobId: string,
    actorUserId: string,
    untilMs: number,
  ): Promise<void> {
    const until = new Date(untilMs).toISOString();
    // La espera persistida y la reprogramación del job son una sola unidad de trabajo.
    await this.deps.uow.run(workspaceId, async () => {
      await this.waitUntilInTx(workspaceId, connectionId, until);
      await this.banking.queue.enqueueSync(
        { workspaceId, connectionId, actorUserId, importJobId },
        new Date(untilMs),
      );
    });
  }

  private async waitUntil(workspaceId: string, connectionId: string, until: string | null): Promise<void> {
    await this.deps.uow.run(workspaceId, () => this.waitUntilInTx(workspaceId, connectionId, until));
  }

  private async waitUntilInTx(
    workspaceId: string,
    connectionId: string,
    until: string | null,
  ): Promise<void> {
    const { deps, banking } = this;
    const connection = await banking.connections.findById(workspaceId, connectionId, { lock: 'update' });
    if (!connection) return;
    connection.waitUntil(until, deps.clock.now().toString());
    await this.save(connection);
  }

  private async flag(
    workspaceId: string,
    connectionId: string,
    from: 'PENDING_VERIFICATION' | 'ACTIVE',
    code: string,
  ): Promise<void> {
    const { deps, banking } = this;
    await deps.uow.run(workspaceId, async () => {
      const connection = await banking.connections.findById(workspaceId, connectionId, { lock: 'update' });
      if (!connection || connection.state.status !== from) return;
      connection.needsAttention(code, deps.clock.now().toString());
      await this.save(connection);
      await recordConnection(deps, connection, 'needs_attention', {
        changes: [
          { field: 'status', before: from, after: 'NEEDS_ATTENTION' },
          { field: 'lastError', before: null, after: code },
        ],
      });
    });
  }

  private async flagAny(workspaceId: string, connectionId: string, code: string): Promise<void> {
    const { deps, banking } = this;
    await deps.uow.run(workspaceId, async () => {
      const connection = await banking.connections.findById(workspaceId, connectionId, { lock: 'update' });
      if (!connection) return;
      const from = connection.state.status;
      if (from !== 'ACTIVE' && from !== 'PENDING_VERIFICATION') return;
      connection.needsAttention(code, deps.clock.now().toString());
      await this.save(connection);
      await recordConnection(deps, connection, 'needs_attention', {
        changes: [
          { field: 'status', before: from, after: 'NEEDS_ATTENTION' },
          { field: 'lastError', before: null, after: code },
        ],
      });
    });
  }

  /**
   * El import de la sincronización falla (`PARSE_FAILED` con el código del proveedor, nunca completo): se descarta lo
   * escrito en el staging, el cursor confirmado queda como estaba y, si corresponde, la conexión pasa a atención.
   */
  private async failImport(
    workspaceId: string,
    connectionId: string,
    importJobId: string,
    failure: ImportFailure,
    options: { readonly attention?: string },
  ): Promise<void> {
    const { deps, banking } = this;
    await deps.uow.run(workspaceId, async () => {
      const job = await deps.jobs.findById(workspaceId, importJobId, { lock: 'update' });
      const connection = await banking.connections.findById(workspaceId, connectionId, { lock: 'update' });
      if (job && job.state.status === 'PROCESSING') {
        await deps.staging.deleteAll(workspaceId, importJobId);
        job.failParse({ failure, now: deps.clock.now().toString() });
        if (!(await deps.jobs.save(job))) {
          throw new DomainError('CONCURRENCY_CONFLICT', 'the import was modified concurrently');
        }
        job.markPersisted();
        const event = await publishJobEvent(deps, job, IMPORTS_EVENTS.failed, {
          code: failure.code,
          stage: FAILED_STAGE,
        });
        const changes: AuditChangeInput[] = [
          { field: 'status', before: 'PROCESSING', after: 'PARSE_FAILED' },
          { field: 'failure', before: null, after: JSON.stringify(failure) },
        ];
        await recordJob(deps, job, 'sync_failed', { events: [event], changes });
      }
      if (connection) {
        connection.abandonSync(importJobId, deps.clock.now().toString());
        if (options.attention && connection.state.status === 'ACTIVE') {
          connection.needsAttention(options.attention, deps.clock.now().toString());
          await this.save(connection);
          await recordConnection(deps, connection, 'needs_attention', {
            changes: [
              { field: 'status', before: 'ACTIVE', after: 'NEEDS_ATTENTION' },
              { field: 'lastError', before: null, after: options.attention },
            ],
          });
        } else {
          connection.recordError(failure.code, deps.clock.now().toString());
          await this.save(connection);
        }
      }
    });
  }

  private async save(connection: Connection): Promise<void> {
    if (!(await this.banking.connections.save(connection))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the connection was modified concurrently');
    }
    connection.markPersisted();
  }
}
