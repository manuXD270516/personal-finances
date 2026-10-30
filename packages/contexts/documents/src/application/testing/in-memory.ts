import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { AuditEntry, LifecycleStepInput } from '@pf/audit/contracts';
import { DecryptStream, LocalKeyringProvider, encryptEnvelope, newDataKey } from '@pf/platform/crypto';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { DocumentIntegrityError } from '../../contracts/index.js';
import { Document, type DocumentState } from '../../domain/document.js';
import { EMPTY_USAGE, type StorageUsage } from '../../domain/storage-quota.js';
import type { AttachmentTargetType, DocumentFormat, InspectionVerdict } from '../../domain/types.js';
import {
  DEFAULT_DOCUMENTS_SETTINGS,
  type ContentInspector,
  type ContentRestoreJob,
  type DocumentCipher,
  type DocumentFilter,
  type DocumentPage,
  type DocumentRef,
  type DocumentsDeps,
  type DocumentsSettings,
  type LinkRecord,
  type MalwareScanner,
  type ScanResult,
} from '../ports/index.js';

/**
 * Dobles en memoria de los puertos de DOCUMENTS (pruebas de aplicación). `InMemoryWorld.uow` hace rollback de TODO el
 * estado (documentos, vínculos, cuota, auditoría, recorrido, outbox y objetos) si el caso de uso lanza: así se prueba
 * la atomicidad de INV-029 sin base de datos.
 */
interface Snapshot {
  documents: Map<string, DocumentState>;
  links: Map<string, LinkRecord>;
  usage: Map<string, StorageUsage>;
  audits: AuditEntry[];
  lifecycle: { entry: AuditEntry; steps: readonly LifecycleStepInput[] }[];
  events: { eventType: string; payload: object; aggregateId: string }[];
}

export const WORKSPACE = '11111111-1111-7111-8111-111111111111';
export const OTHER_WORKSPACE = '22222222-2222-7222-8222-222222222222';
export const EDITOR = '33333333-3333-7333-8333-333333333333';

export class InMemoryWorld {
  documents = new Map<string, DocumentState>();
  links = new Map<string, LinkRecord>();
  usage = new Map<string, StorageUsage>();
  audits: AuditEntry[] = [];
  lifecycle: { entry: AuditEntry; steps: readonly LifecycleStepInput[] }[] = [];
  events: { eventType: string; payload: object; aggregateId: string }[] = [];
  objects = new Map<string, { body: Buffer; lastModified: Date }>();
  targets = new Map<AttachmentTargetType, Set<string>>();
  clock = new FixedClock(Instant.parse('2026-10-29T14:00:00.000Z'));
  scanResult: ScanResult = { status: 'NOT_SCANNED' };
  inspectVerdict: ((content: Buffer, declared: DocumentFormat) => InspectionVerdict) | null = null;
  inspected = 0;
  semaphoreFull = false;
  failNextOutbox = false;
  private readonly masterK1 = newDataKey().toString('hex');
  keyring = new LocalKeyringProvider(`k1:${this.masterK1}`);

  /** Activa una clave maestra nueva `k2` conservando `k1` en el llavero (rotación). */
  rotateKeys(): void {
    this.keyring = new LocalKeyringProvider(`k2:${newDataKey().toString('hex')},k1:${this.masterK1}`);
  }
  settings: DocumentsSettings = {
    ...DEFAULT_DOCUMENTS_SETTINGS,
    quarantineBucket: 'quarantine',
    documentsBucket: 'documents',
  };
  private seq = 0;
  private readonly als = new AsyncLocalStorage<string>();
  private tail: Promise<unknown> = Promise.resolve();

  private snapshot(): Snapshot {
    return {
      documents: new Map(this.documents),
      links: new Map(this.links),
      usage: new Map(this.usage),
      audits: [...this.audits],
      lifecycle: [...this.lifecycle],
      events: [...this.events],
    };
  }

  private restore(s: Snapshot): void {
    this.documents = s.documents;
    this.links = s.links;
    this.usage = s.usage;
    this.audits = s.audits;
    this.lifecycle = s.lifecycle;
    this.events = s.events;
  }

  private ws(): string {
    const ws = this.als.getStore();
    if (!ws) throw new Error('fuera de una unidad de trabajo');
    return ws;
  }

  readonly deps: DocumentsDeps = {
    uow: {
      run: async (workspaceId, fn) => {
        if (this.als.getStore() !== undefined) return fn();
        // Las unidades de trabajo de primer nivel se serializan (como el FOR UPDATE de la cuota en PostgreSQL).
        const previous = this.tail;
        let unlock!: () => void;
        this.tail = new Promise<void>((r) => (unlock = r));
        await previous;
        const before = this.snapshot();
        try {
          return await this.als.run(workspaceId, fn);
        } catch (err) {
          this.restore(before);
          throw err;
        } finally {
          unlock();
        }
      },
    },
    documents: {
      insert: async (doc) => void this.documents.set(doc.id, doc.snapshot),
      save: async (doc) => {
        const stored = this.documents.get(doc.id);
        if (!stored || stored.version !== doc.version - 1) return false;
        this.documents.set(doc.id, doc.snapshot);
        return true;
      },
      saveKey: async (doc) => {
        this.documents.set(doc.id, doc.snapshot);
        return true;
      },
      findById: async (workspaceId, id) => {
        const s = this.documents.get(id);
        return s && s.workspaceId === workspaceId && workspaceId === this.ws() ? Document.rehydrate(s) : null;
      },
      findAvailableBySha256: async (workspaceId, sha) => {
        for (const s of this.documents.values()) {
          if (s.workspaceId === workspaceId && s.sha256 === sha && s.status === 'AVAILABLE') {
            return Document.rehydrate(s);
          }
        }
        return null;
      },
      list: async (workspaceId, filter) => this.list(workspaceId, filter),
    },
    links: {
      find: async (ws, documentId, targetType, targetId) =>
        [...this.links.values()].find(
          (l) =>
            l.workspaceId === ws &&
            l.documentId === documentId &&
            l.targetType === targetType &&
            l.targetId === targetId,
        ) ?? null,
      findById: async (ws, documentId, linkId) => {
        const l = this.links.get(linkId);
        return l && l.workspaceId === ws && l.documentId === documentId ? l : null;
      },
      lockTarget: async (ws, targetType, targetId) =>
        [...this.links.values()].filter(
          (l) => l.workspaceId === ws && l.targetType === targetType && l.targetId === targetId,
        ),
      insert: async (link) => void this.links.set(link.id, link),
      delete: async (_ws, linkId) => void this.links.delete(linkId),
      deleteAllOf: async (ws, documentId) => {
        const gone = [...this.links.values()].filter(
          (l) => l.workspaceId === ws && l.documentId === documentId,
        );
        for (const l of gone) this.links.delete(l.id);
        return gone;
      },
      linksOf: async (ws, ids) => {
        const out = new Map<string, LinkRecord[]>();
        for (const l of this.links.values()) {
          if (l.workspaceId === ws && ids.includes(l.documentId)) {
            out.set(l.documentId, [...(out.get(l.documentId) ?? []), l]);
          }
        }
        return out;
      },
      countOf: async (ws, documentId) =>
        [...this.links.values()].filter((l) => l.workspaceId === ws && l.documentId === documentId).length,
    },
    usage: {
      read: async (ws) => this.usage.get(ws) ?? EMPTY_USAGE,
      lock: async (ws) => this.usage.get(ws) ?? EMPTY_USAGE,
      save: async (ws, u) => void this.usage.set(ws, u),
      recompute: async (ws) => {
        let used = 0;
        let reserved = 0;
        let pending = 0;
        for (const d of this.documents.values()) {
          if (d.workspaceId !== ws) continue;
          if (d.status === 'AVAILABLE' || d.status === 'CONTENT_PENDING') used += d.sizeBytes;
          if (d.status === 'PENDING_UPLOAD' || d.status === 'UPLOADED') {
            reserved += d.sizeBytes;
            pending += 1;
          }
        }
        return { usedBytes: used, reservedBytes: reserved, pendingUploads: pending };
      },
    },
    scan: {
      expiredPending: async (before) =>
        this.refs(
          (d) => d.status === 'PENDING_UPLOAD' && d.uploadExpiresAt !== null && d.uploadExpiresAt < before,
        ),
      stuckUploads: async (before) =>
        this.refs(
          (d) =>
            d.status === 'UPLOADED' && d.verificationStartedAt !== null && d.verificationStartedAt < before,
        ),
      unlinkedCandidates: async (before) =>
        this.refs(
          (d) =>
            d.status === 'AVAILABLE' &&
            d.archivedAt === null &&
            (d.lastUnlinkedAt ?? d.availableAt ?? d.createdAt) < before &&
            ![...this.links.values()].some((l) => l.documentId === d.id),
        ),
      workspacesWithDocuments: async () => [
        ...new Set([...this.documents.values()].map((d) => d.workspaceId)),
      ],
      keyIdsInUse: async () => [
        ...new Set([...this.documents.values()].flatMap((d) => (d.keyId ? [d.keyId] : []))),
      ],
      withOtherKey: async (active, limit) =>
        this.refs((d) => d.keyId !== null && d.keyId !== active).slice(0, limit),
      referencedObjectKeys: async (ws) =>
        new Set(
          [...this.documents.values()].flatMap((d) =>
            d.workspaceId === ws &&
            d.objectKey &&
            (d.status === 'AVAILABLE' || d.status === 'CONTENT_PENDING')
              ? [d.objectKey]
              : [],
          ),
        ),
      statusOf: async (ids) =>
        new Map(
          ids.flatMap((id) =>
            this.documents.has(id) ? [[id, this.documents.get(id)!.status] as const] : [],
          ),
        ),
    },
    storage: {
      presignPut: (i) => ({
        url: `http://storage.test/${i.bucket}/${i.key}?sig=1`,
        method: 'PUT',
        headers: { 'Content-Type': i.contentType, 'x-amz-checksum-sha256': i.sha256Base64 },
        expiresAt: new Date(this.clock.now().epochMillis + i.expiresInSeconds * 1000),
      }),
      head: async (bucket, key) => {
        const o = this.objects.get(`${bucket}/${key}`);
        return o ? { contentLength: o.body.length } : null;
      },
      get: async (bucket, key) => {
        const o = this.objects.get(`${bucket}/${key}`);
        if (!o) {
          const err = new Error('missing');
          err.name = 'ObjectMissingError';
          throw err;
        }
        return Readable.from([o.body]);
      },
      put: async (bucket, key, body) =>
        void this.objects.set(`${bucket}/${key}`, { body, lastModified: this.clock.now().toDate() }),
      putStream: async (bucket, key, source, options) => {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of source) {
          const b = Buffer.from(c);
          size += b.length;
          if (options?.maxBytes !== undefined && size > options.maxBytes) {
            const err = new Error('too large');
            err.name = 'ObjectTooLargeError';
            throw err;
          }
          chunks.push(b);
        }
        this.objects.set(`${bucket}/${key}`, {
          body: Buffer.concat(chunks),
          lastModified: this.clock.now().toDate(),
        });
        return { size };
      },
      delete: async (bucket, key) => void this.objects.delete(`${bucket}/${key}`),
      deleteAllVersions: async (bucket, key) => void this.objects.delete(`${bucket}/${key}`),
      list: (bucket, prefix) =>
        (async function* (objects: InMemoryWorld['objects']) {
          for (const [full, o] of [...objects]) {
            const [b, ...rest] = full.split('/');
            const key = rest.join('/');
            if (b === bucket && key.startsWith(prefix)) {
              yield { key, size: o.body.length, lastModified: o.lastModified };
            }
          }
        })(this.objects),
    },
    cipher: this.cipher(),
    inspector: this.inspector(),
    scanner: this.scanner(),
    targets: {
      existing: async (_ws, type, ids) => new Set(ids.filter((id) => this.targets.get(type)?.has(id))),
    },
    semaphore: {
      tryAcquire: () => !this.semaphoreFull,
      release: () => undefined,
    },
    lifecycle: {
      record: async (entry, steps) => {
        this.lifecycle.push({ entry, steps });
        this.audits.push(entry);
      },
    },
    audit: { append: async (entry) => void this.audits.push(entry) },
    outbox: {
      append: async (e) => {
        if (this.failNextOutbox) {
          this.failNextOutbox = false;
          throw new Error('outbox caído');
        }
        this.events.push({
          eventType: `${e.eventType}.v${e.eventVersion}`,
          payload: e.payload,
          aggregateId: e.aggregateId,
        });
      },
    },
    operations: {
      insert: async (op) => void this.operations.set(op.id, { status: 'PENDING', result: null, error: null }),
      update: async (_ws, id, patch) => {
        const cur = this.operations.get(id);
        if (!cur) return;
        this.operations.set(id, {
          status: patch.status ?? cur.status,
          result: patch.result === undefined ? cur.result : (patch.result as Record<string, unknown> | null),
          error: patch.error === undefined ? cur.error : (patch.error as Record<string, unknown> | null),
        });
      },
      status: async (_ws, id) => this.operations.get(id)?.status ?? null,
    },
    restoreJobs: { enqueue: async (job) => void this.restoreJobsQueued.push(job) },
    ids: { next: () => randomUUID() },
    clock: this.clock,
    settings: this.settings,
  };

  operations = new Map<
    string,
    {
      status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
      result: Record<string, unknown> | null;
      error: Record<string, unknown> | null;
    }
  >();
  restoreJobsQueued: ContentRestoreJob[] = [];

  private refs(pred: (d: DocumentState) => boolean): DocumentRef[] {
    return [...this.documents.values()]
      .filter(pred)
      .map((d) => ({ workspaceId: d.workspaceId, documentId: d.id }));
  }

  private list(workspaceId: string, filter: DocumentFilter): DocumentPage {
    const items = [...this.documents.values()]
      .filter(
        (d) => d.workspaceId === workspaceId && d.status !== 'PENDING_UPLOAD' && d.status !== 'UPLOADED',
      )
      .filter((d) => (filter.purpose ? d.purpose === filter.purpose : true))
      .filter((d) => (filter.status ? d.status === filter.status : true))
      .filter((d) =>
        (filter.archived ?? 'EXCLUDE') === 'EXCLUDE'
          ? d.archivedAt === null
          : filter.archived === 'ONLY'
            ? d.archivedAt !== null
            : true,
      )
      .filter((d) =>
        filter.target
          ? [...this.links.values()].some(
              (l) =>
                l.documentId === d.id &&
                l.targetType === filter.target!.type &&
                l.targetId === filter.target!.id,
            )
          : true,
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { items: items.map((s) => Document.rehydrate(s)), nextCursor: null };
  }

  private cipher(): DocumentCipher {
    // El llavero se lee en cada llamada: `rotateKeys()` lo reemplaza.
    const ring = (): LocalKeyringProvider => this.keyring;
    return {
      get activeKeyId() {
        return ring().activeKeyId;
      },
      seal: async (plain, context) => {
        const dataKey = newDataKey();
        const wrapped = await ring().wrap(dataKey, context);
        return {
          encrypted: encryptEnvelope(plain, dataKey),
          keyId: wrapped.keyId,
          wrappedKey: wrapped.wrappedKey,
        };
      },
      open: async (encrypted, wrapped, context) => {
        let dataKey: Buffer;
        try {
          dataKey = await ring().unwrap(wrapped, context);
        } catch (err) {
          throw new DocumentIntegrityError(String((err as Error).message));
        }
        const decrypt = new DecryptStream(dataKey);
        encrypted.on('error', (e) => decrypt.destroy(e));
        decrypt.on('error', () => undefined);
        const out = encrypted.pipe(decrypt);
        const wrapErr = new Readable({ read() {} });
        out.on('data', (c) => wrapErr.push(c));
        out.on('end', () => wrapErr.push(null));
        out.on('error', (e) => wrapErr.destroy(new DocumentIntegrityError(String(e.message))));
        return wrapErr;
      },
      rewrap: async (wrapped, context) => {
        const dataKey = await ring().unwrap(wrapped, context);
        return ring().wrap(dataKey, context);
      },
      keyIds: () => ring().keyIds(),
    };
  }

  private inspector(): ContentInspector {
    return {
      inspect: async (content, declared) => {
        this.inspected += 1;
        return this.inspectVerdict ? this.inspectVerdict(content, declared) : { ok: true, format: declared };
      },
    };
  }

  private scanner(): MalwareScanner {
    return { engine: 'fake-av', scan: async () => this.scanResult };
  }

  // ───────────────────────────────────────────── atajos de prueba

  /** Simula la subida directa del navegador a la cuarentena. */
  uploadToQuarantine(workspaceId: string, documentId: string, body: Buffer): void {
    this.objects.set(`${this.settings.quarantineBucket}/ws/${workspaceId}/${documentId}`, {
      body,
      lastModified: this.clock.now().toDate(),
    });
  }

  quarantineKeys(): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${this.settings.quarantineBucket}/`));
  }

  documentKeys(): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${this.settings.documentsBucket}/`));
  }

  advance(ms: number): void {
    this.clock.set(this.clock.now().plusMillis(ms));
  }
}
