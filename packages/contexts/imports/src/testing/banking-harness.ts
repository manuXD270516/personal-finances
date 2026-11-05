import { ConnectionHooks } from '../application/banking/connection-hooks.js';
import { ConnectionJobs } from '../application/banking/connection-jobs.js';
import { ConnectionsService } from '../application/banking/connections.service.js';
import { CredentialVault } from '../application/banking/credential-vault.js';
import type {
  BankingDeps,
  ConnectionJobPayload,
  ConnectionJobQueue,
  ConnectionRepository,
  CredentialSummary,
  StoredCredential,
} from '../application/banking/ports.js';
import type { ImportsDeps } from '../application/ports/index.js';
import { ImportsQueries } from '../application/imports.queries.js';
import { ImportsService } from '../application/imports.service.js';
import { PersistImportService } from '../application/persist-import.service.js';
import { ProcessImportService } from '../application/process-import.service.js';
import { createMemoryDeps } from '../application/testing/in-memory.js';
import {
  Connection,
  ProviderRegistry,
  type ConnectionState,
  type CredentialPermissions,
} from '../domain/index.js';
import { PROVIDER_DESCRIPTORS } from '../infrastructure/banking/descriptors.js';
import {
  FAKE_EXCHANGE_DESCRIPTOR,
  FAKE_EXCHANGE_FILE_DESCRIPTOR,
  FakeExchangeBackend,
  FakeExchangeFileProvider,
  FakeExchangeProvider,
} from '../infrastructure/banking/fake-exchange.js';
import { AllowlistedProviderHttp } from '../infrastructure/banking/provider-http.js';
import {
  X25519CredentialKeyUnwrapper,
  X25519CredentialKeyWrapper,
  generateCredentialKeyPair,
  nodeSymmetricCipher,
} from '../infrastructure/banking/x25519-key-wrapper.js';
import { ACCOUNT, USER, WS, setupPipeline, type PipelineCtx } from './pipeline-harness.js';

/** Arnés de las conexiones con dobles en memoria y el proveedor simulado (sin base de datos ni red). */

export const A_USDT = 'acc-usdt';
export const A_BTC = 'acc-btc';
export const SECRET = { keyId: 'AKIA-TEST-0000-a1b2', secret: 'sk-test-secreto-que-no-debe-aparecer-9f8e7d' };

interface MemCredential {
  version: number;
  sealed: StoredCredential | null;
  fingerprint: string;
  permissions: CredentialPermissions | null;
  verifiedAt: string | null;
  destroyed: boolean;
}

export class MemConnections implements ConnectionRepository {
  readonly rows = new Map<string, ConnectionState>();
  readonly creds = new Map<string, MemCredential>();

  async insert(c: Connection) {
    this.rows.set(c.id, c.state);
  }
  async findById(_ws: string, id: string) {
    const s = this.rows.get(id);
    return s ? Connection.rehydrate(s) : null;
  }
  async save(c: Connection) {
    const current = this.rows.get(c.id);
    if (!current || current.version !== c.persistedVersion) return false;
    this.rows.set(c.id, c.state);
    return true;
  }
  async list() {
    return [...this.rows.values()].map((s) => Connection.rehydrate(s));
  }
  async nameTaken(_ws: string, name: string, exceptId?: string) {
    return [...this.rows.values()].some(
      (s) => s.id !== exceptId && s.status !== 'REVOKED' && s.name.toLowerCase() === name.toLowerCase(),
    );
  }
  async insertCredential(i: Parameters<ConnectionRepository['insertCredential']>[0]) {
    this.creds.set(i.connectionId, {
      version: i.credentialVersion,
      sealed: { ...i.sealed, credentialVersion: i.credentialVersion },
      fingerprint: i.fingerprint,
      permissions: null,
      verifiedAt: null,
      destroyed: false,
    });
  }
  async replaceCredential(i: Parameters<ConnectionRepository['replaceCredential']>[0]) {
    await this.insertCredential(i);
  }
  async credentialSummary(_ws: string, id: string): Promise<CredentialSummary | null> {
    const c = this.creds.get(id);
    return c
      ? {
          fingerprint: c.fingerprint,
          kid: c.sealed?.kid ?? '',
          credentialVersion: c.version,
          verifiedAt: c.verifiedAt,
          permissions: c.permissions,
          destroyed: c.destroyed,
        }
      : null;
  }
  async loadSealed(_ws: string, id: string) {
    const c = this.creds.get(id);
    return c && !c.destroyed ? c.sealed : null;
  }
  async setVerification(
    _ws: string,
    id: string,
    input: { permissions: CredentialPermissions; verifiedAt: string },
  ) {
    const c = this.creds.get(id);
    if (c) Object.assign(c, input);
  }
  async destroyCredential(_ws: string, id: string) {
    const c = this.creds.get(id);
    if (c) {
      c.sealed = null;
      c.destroyed = true;
    }
  }
  async rewrapCredential(
    _ws: string,
    id: string,
    w: Parameters<ConnectionRepository['rewrapCredential']>[2],
  ) {
    const c = this.creds.get(id);
    if (c?.sealed) c.sealed = { ...c.sealed, ...w };
  }
  async credentialsOf() {
    return [...this.creds.entries()]
      .filter(([, c]) => !c.destroyed && c.sealed)
      .map(([connectionId, c]) => ({
        connectionId,
        kid: (c.sealed as StoredCredential).kid,
        credentialVersion: c.version,
      }));
  }
}

export class MemQueue implements ConnectionJobQueue {
  readonly verify: { job: ConnectionJobPayload; startAfter?: Date }[] = [];
  readonly sync: { job: ConnectionJobPayload & { importJobId: string }; startAfter?: Date }[] = [];
  async enqueueVerify(job: ConnectionJobPayload, startAfter?: Date) {
    this.verify.push({ job, ...(startAfter ? { startAfter } : {}) });
  }
  async enqueueSync(job: ConnectionJobPayload & { importJobId: string }, startAfter?: Date) {
    this.sync.push({ job, ...(startAfter ? { startAfter } : {}) });
  }
}

export interface BankingCtx {
  readonly pipeline: PipelineCtx;
  readonly world: PipelineCtx['world'];
  readonly deps: ImportsDeps;
  readonly connections: MemConnections;
  readonly queue: MemQueue;
  readonly backend: FakeExchangeBackend;
  readonly bankingDeps: BankingDeps;
  readonly service: ConnectionsService;
  readonly jobs: ConnectionJobs;
  readonly imports: ImportsService;
  readonly queries: ImportsQueries;
  readonly persist: PersistImportService;
  readonly process: ProcessImportService;
  readonly keys: {
    k1: ReturnType<typeof generateCredentialKeyPair>;
    k2: ReturnType<typeof generateCredentialKeyPair>;
  };
  vaultOf(active: 'k1' | 'k2', ring?: 'both' | 'k1' | 'k2'): CredentialVault;
}

export function setupBanking(
  options: {
    environment?: 'local' | 'ci' | 'staging' | 'production';
    /** Solo con la clave pública (como la API): no puede descifrar. */
    apiOnly?: boolean;
    backend?: FakeExchangeBackend;
    requestsPerMinute?: number;
  } = {},
): BankingCtx {
  const pipeline = setupPipeline();
  const { world } = pipeline;
  world.addAccount({ accountId: A_USDT, currency: 'USDT' });
  world.addAccount({ accountId: A_BTC, currency: 'BTC' });
  const keys = { k1: generateCredentialKeyPair(), k2: generateCredentialKeyPair() };
  const publicRing = (first: 'k1' | 'k2') =>
    first === 'k1'
      ? `k1:${keys.k1.publicKey},k2:${keys.k2.publicKey}`
      : `k2:${keys.k2.publicKey},k1:${keys.k1.publicKey}`;
  const privateRing = (ring: 'both' | 'k1' | 'k2') =>
    ring === 'both'
      ? `k1:${keys.k1.privateKey},k2:${keys.k2.privateKey}`
      : `${ring}:${keys[ring].privateKey}`;
  const vaultOf = (active: 'k1' | 'k2', ring: 'both' | 'k1' | 'k2' = 'both') =>
    new CredentialVault(
      nodeSymmetricCipher,
      new X25519CredentialKeyWrapper(publicRing(active)),
      new X25519CredentialKeyUnwrapper(publicRing(active), privateRing(ring)),
    );
  const vault = options.apiOnly
    ? new CredentialVault(nodeSymmetricCipher, new X25519CredentialKeyWrapper(publicRing('k1')))
    : vaultOf('k1');

  const connections = new MemConnections();
  const baseDeps = createMemoryDeps(world);
  const holder: { deps?: ImportsDeps } = {};
  const deps: ImportsDeps = {
    ...baseDeps,
    connectionHooks: new ConnectionHooks(() => holder.deps as ImportsDeps, connections),
    systemCategories: { feesCategoryId: async () => 'cat-fees' },
  };
  holder.deps = deps;

  const backend = options.backend ?? new FakeExchangeBackend([]);
  const queue = new MemQueue();
  const registry = ProviderRegistry.create(PROVIDER_DESCRIPTORS, {
    environment: options.environment ?? 'ci',
    fakeEnabled: true,
  });
  const banking: BankingDeps = {
    registry,
    adapters: {
      api: (id) => (id === FAKE_EXCHANGE_DESCRIPTOR.id ? new FakeExchangeProvider() : null),
      file: (id) => (id === FAKE_EXCHANGE_FILE_DESCRIPTOR.id ? new FakeExchangeFileProvider() : null),
    },
    connections,
    vault,
    queue,
    http: new AllowlistedProviderHttp(backend.transport),
    settings: { syncMaxDays: 365, requestsPerMinute: options.requestsPerMinute ?? 10, maxPages: 1000 },
  };
  const process = new ProcessImportService(deps);
  return {
    pipeline,
    world,
    deps,
    connections,
    queue,
    backend,
    bankingDeps: banking,
    service: new ConnectionsService(deps, banking),
    jobs: new ConnectionJobs(deps, banking, process),
    imports: new ImportsService(deps),
    queries: new ImportsQueries(deps),
    persist: new PersistImportService(deps),
    process,
    keys,
    vaultOf,
  };
}

/** Crea la conexión de ejemplo (USDT y BTC mapeados) y corre la verificación hasta dejarla activa. */
export async function activeConnection(ctx: BankingCtx, name = 'Exchange principal') {
  const created = await ctx.service.create({
    workspaceId: WS,
    userId: USER,
    providerId: 'FAKE_EXCHANGE',
    name,
    assetMappings: [
      { asset: 'USDT', accountId: A_USDT },
      { asset: 'BTC', accountId: A_BTC },
    ],
    credential: SECRET,
  });
  await ctx.jobs.verify({ workspaceId: WS, connectionId: created.id });
  return ctx.service.get(WS, created.id);
}

export { ACCOUNT, USER, WS };
