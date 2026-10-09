import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { DomainError, type Instant } from '@pf/shared-kernel';
import { parseExportManifest, type ExportManifest } from '../../domain/export-manifest.js';
import type { WorkspaceExport } from '../../domain/workspace-export.js';
import { WorkspaceExport as ExportAggregate } from '../../domain/workspace-export.js';
import { WorkspaceImport as ImportAggregate } from '../../domain/workspace-import.js';
import type { WorkspaceImport } from '../../domain/workspace-import.js';
import {
  ObjectMissingError,
  type BuiltArchive,
  type ExportJob,
  type ImportJob,
  type ImportOutcome,
  type OperationView,
  type PortabilityDeps,
  type WrappedDataKey,
} from '../portability/ports.js';
import { InMemoryIdentity } from './in-memory.js';

/**
 * Fakes en memoria de los puertos de portabilidad. El "cifrado" invierte los bytes y antepone una marca: sin texto en
 * claro y alterable (para probar la orquestación; el cifrado real tiene sus propias pruebas en infraestructura).
 */
const MARK = Buffer.from('FAKE-ENC:');

export const fakeSeal = (plain: Buffer): Buffer => Buffer.concat([MARK, Buffer.from(plain).reverse()]);
export const fakeOpen = (enc: Buffer): Buffer => {
  if (!enc.subarray(0, MARK.length).equals(MARK)) throw new DomainError('EXPORT_FILE_CORRUPTED', 'tampered');
  return Buffer.from(enc.subarray(MARK.length)).reverse();
};

export class InMemoryPortability {
  readonly base = new InMemoryIdentity();
  readonly exports = new Map<string, WorkspaceExport>();
  readonly imports = new Map<string, WorkspaceImport>();
  readonly operations = new Map<string, OperationView & { workspaceId: string }>();
  readonly objects = new Map<string, Buffer>();
  readonly exportJobs: ExportJob[] = [];
  readonly importJobs: ImportJob[] = [];
  /** Contenido del "ZIP" que produce el constructor de archivos. */
  zipContent: Buffer = Buffer.from('PK-fake-zip with Bank A');
  manifest: ExportManifest | undefined;
  buildFailure: Error | undefined;
  importFailure: Error | undefined;
  readonly importCalls: { newWorkspaceId: string; name: string }[] = [];
  reauthMaxAgeSeconds = 600;

  nextExportId = 0;

  deps(): PortabilityDeps {
    const mem = this.base;
    const baseDeps = mem.deps();
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- los fakes cierran sobre el estado
    const self = this;
    // Sobre la transacción en memoria: los repositorios de portabilidad restauran su estado si `fn` lanza.
    const uow = {
      async run<T>(ctx: Parameters<typeof baseDeps.uow.run>[0], fn: () => Promise<T>): Promise<T> {
        const snap = {
          exports: new Map(self.exports),
          imports: new Map(self.imports),
          operations: new Map(self.operations),
          objects: new Map(self.objects),
          exportJobs: self.exportJobs.length,
          importJobs: self.importJobs.length,
        };
        try {
          return await baseDeps.uow.run(ctx, fn);
        } catch (err) {
          self.exports.clear();
          for (const [k, v] of snap.exports) self.exports.set(k, v);
          self.imports.clear();
          for (const [k, v] of snap.imports) self.imports.set(k, v);
          self.operations.clear();
          for (const [k, v] of snap.operations) self.operations.set(k, v);
          // Los objetos del almacén NO participan de la transacción de la BD (no se restauran).
          self.exportJobs.length = snap.exportJobs;
          self.importJobs.length = snap.importJobs;
          throw err;
        }
      },
      runDetached<T>(ctx: Parameters<typeof baseDeps.uow.run>[0], fn: () => Promise<T>): Promise<T> {
        return uow.run(ctx, fn);
      },
      bind: baseDeps.uow.bind,
    };
    return {
      ...baseDeps,
      uow,
      exports: {
        async insert(e) {
          self.exports.set(e.id, ExportAggregate.restore(e.snapshot()));
        },
        async find(workspaceId, id) {
          const e = self.exports.get(id);
          return e && e.workspaceId === workspaceId ? ExportAggregate.restore(e.snapshot()) : null;
        },
        async list(workspaceId, limit) {
          return [...self.exports.values()]
            .filter((e) => e.workspaceId === workspaceId)
            .sort((a, b) => (a.id < b.id ? 1 : -1))
            .slice(0, limit)
            .map((e) => ExportAggregate.restore(e.snapshot()));
        },
        async save(e, expectedVersion) {
          if (self.exports.get(e.id)?.version !== expectedVersion) return false;
          self.exports.set(e.id, ExportAggregate.restore(e.snapshot()));
          return true;
        },
        async hasInProgress(workspaceId) {
          return [...self.exports.values()].some((e) => e.workspaceId === workspaceId && e.inProgress);
        },
        async findExpired(now: Instant, limit) {
          return [...self.exports.values()]
            .filter((e) => {
              const p = e.snapshot();
              return p.status === 'READY' && p.expiresAt !== null && p.expiresAt <= now.toString();
            })
            .slice(0, limit)
            .map((e) => ({
              workspaceId: e.workspaceId,
              exportId: e.id,
              requestedBy: e.snapshot().requestedBy,
            }));
        },
      },
      imports: {
        async insert(i) {
          if (
            [...self.imports.values()].some(
              (x) => x.snapshot().requestedBy === i.snapshot().requestedBy && x.inProgress,
            )
          ) {
            throw new DomainError('IMPORT_IN_PROGRESS', 'unique violation');
          }
          self.imports.set(i.id, ImportAggregate.restore(i.snapshot()));
        },
        async find(userId, id) {
          const i = self.imports.get(id);
          return i && i.snapshot().requestedBy === userId ? ImportAggregate.restore(i.snapshot()) : null;
        },
        async save(i) {
          self.imports.set(i.id, ImportAggregate.restore(i.snapshot()));
        },
        async hasInProgress(userId) {
          return [...self.imports.values()].some((x) => x.snapshot().requestedBy === userId && x.inProgress);
        },
      },
      operations: {
        async insert(op) {
          const now = mem.clock.now().toString();
          self.operations.set(op.id, {
            id: op.id,
            workspaceId: op.workspaceId,
            kind: op.kind,
            status: 'PENDING',
            progressPct: 0,
            resourceType: op.resourceType,
            resourceId: op.resourceId,
            result: null,
            error: null,
            requestedBy: op.requestedBy,
            createdAt: now,
            updatedAt: now,
          });
        },
        async find(workspaceId, id) {
          const op = self.operations.get(id);
          return op && op.workspaceId === workspaceId ? op : null;
        },
        async update(workspaceId, id, patch) {
          const op = self.operations.get(id);
          if (!op || op.workspaceId !== workspaceId) return;
          self.operations.set(id, {
            ...op,
            ...(patch.status ? { status: patch.status } : {}),
            ...(patch.progressPct !== undefined ? { progressPct: patch.progressPct } : {}),
            ...(patch.result !== undefined ? { result: patch.result } : {}),
            ...(patch.error !== undefined ? { error: patch.error } : {}),
            updatedAt: mem.clock.now().toString(),
          });
        },
      },
      store: {
        async put(key, body) {
          self.objects.set(key, Buffer.from(body));
        },
        async openStream(key) {
          const o = self.objects.get(key);
          if (!o) throw new ObjectMissingError(key);
          return Readable.from([o]);
        },
        async get(key) {
          const o = self.objects.get(key);
          if (!o) throw new ObjectMissingError(key);
          return o;
        },
        async delete(key) {
          self.objects.delete(key);
        },
      },
      cipher: {
        async seal(plain, context) {
          return {
            encrypted: fakeSeal(Buffer.concat([Buffer.from(`${context}\n`), plain])),
            keyId: 'k1',
            wrappedKey: Buffer.from('wrapped'),
          };
        },
        async open(enc, _wrapped: WrappedDataKey, context) {
          const opened = fakeOpen(enc);
          const prefix = Buffer.from(`${context}\n`);
          if (!opened.subarray(0, prefix.length).equals(prefix))
            throw new DomainError('EXPORT_FILE_CORRUPTED', 'ctx');
          return opened.subarray(prefix.length);
        },
        async verify(source, _wrapped, context) {
          const chunks: Buffer[] = [];
          for await (const c of source) chunks.push(c as Buffer);
          const opened = fakeOpen(Buffer.concat(chunks));
          const prefix = Buffer.from(`${context}\n`);
          if (!opened.subarray(0, prefix.length).equals(prefix))
            throw new DomainError('EXPORT_FILE_CORRUPTED', 'ctx');
          const plain = opened.subarray(prefix.length);
          return { sha256: createHash('sha256').update(plain).digest('hex'), size: plain.length };
        },
        async decryptStream(source, _wrapped, context) {
          const chunks: Buffer[] = [];
          for await (const c of source) chunks.push(c as Buffer);
          const opened = fakeOpen(Buffer.concat(chunks));
          return Readable.from([opened.subarray(Buffer.from(`${context}\n`).length)]);
        },
      },
      builder: {
        async build(input): Promise<BuiltArchive> {
          if (self.buildFailure) throw self.buildFailure;
          await input.onProgress?.(50);
          const manifest =
            self.manifest ??
            parseExportManifest({
              format: 'pfos-export',
              formatVersion: 1,
              workspaceId: input.workspaceId,
              workspaceName: 'W1',
              isDemo: false,
              exportedAt: input.exportedAt.toString(),
              snapshotAt: input.exportedAt.toString(),
              pfosVersion: '0.0.0',
              baseCurrency: 'BOB',
              timezone: 'America/La_Paz',
              sections: [],
              csv: [],
              verification: { accountBalances: [], trialBalance: [] },
              actors: [],
            });
          return { zip: self.zipContent, manifest, counts: { transactions: 120 } };
        },
      },
      inspector: {
        inspect(zip) {
          try {
            return parseExportManifest(JSON.parse(zip.toString('utf8')) as unknown);
          } catch (err) {
            if (err instanceof DomainError) throw err;
            throw new DomainError('EXPORT_FILE_CORRUPTED', 'not a zip');
          }
        },
      },
      importer: {
        async importInto(input): Promise<ImportOutcome> {
          if (self.importFailure) throw self.importFailure;
          self.importCalls.push({ newWorkspaceId: input.newWorkspaceId, name: input.name });
          await baseDeps.uow.bind({ userId: input.userId, workspaceId: input.newWorkspaceId });
          return {
            workspaceId: input.newWorkspaceId,
            workspaceName: input.name,
            report: { counts: { transactions: 120 } },
          };
        },
      },
      reauth: {
        assertRecent: (authTimeSeconds, now) => {
          if (
            authTimeSeconds === undefined ||
            now.epochMillis / 1000 - authTimeSeconds > self.reauthMaxAgeSeconds
          ) {
            throw new DomainError('REAUTHENTICATION_REQUIRED', 'a recent authentication is required');
          }
        },
      },
      jobs: {
        async enqueueExport(job) {
          self.exportJobs.push(job);
        },
        async enqueueImport(job) {
          self.importJobs.push(job);
        },
      },
      settings: {
        retentionMs: 7 * 24 * 3_600_000,
        formatVersion: 1,
        maxImportBytes: 1024,
        pfosVersion: '0.0.0',
        restoredSuffix: ' (restaurado)',
      },
    };
  }

  /** `auth_time` (segundos) de un login hecho hace `minutes` minutos respecto al reloj fijo. */
  authTime(minutesAgo: number): number {
    return Math.floor(this.base.clock.now().epochMillis / 1000) - minutesAgo * 60;
  }
}
