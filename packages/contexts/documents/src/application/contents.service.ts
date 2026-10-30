import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { AuditActorDto } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import { DOCUMENT_CONTENTS_MANIFEST, type DocumentContentsExporter } from '../contracts/index.js';
import type { Document } from '../domain/document.js';
import { ContentsArchiveError, readArchive, writeArchive, type ArchiveEntry } from './contents-archive.js';
import { openVerified } from './download.service.js';
import {
  objectKeyOf,
  restoreUploadKeyOf,
  wrapContextOf,
  type ContentRestoreJob,
  type DocumentsDeps,
} from './ports/index.js';
import { documentChanges, documentEntry, documentSteps } from './recorder.js';

/** Agregado de auditoría de la restauración (no es un documento: lleva solo conteos). */
export const CONTENT_RESTORE_AGGREGATE = 'DocumentContentRestore';
export const CONTENT_RESTORE_PROCESS = 'documents.content-restore';

/** Forma de la entrada índice del archivo de contenidos (`documents-manifest.json`). */
interface ContentsManifest {
  readonly formatVersion: 1;
  readonly exportedAt: string;
  readonly documents: readonly { documentId: string; sha256: string; sizeBytes: number }[];
}

export interface StagedRestoreUpload {
  readonly restoreId: string;
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export type RestoreMismatchReason = 'CHECKSUM_MISMATCH' | 'SIZE_MISMATCH' | string;

/** Resultado de la restauración que se expone en `Operation.result`. */
export interface RestoreReport {
  readonly restored: number;
  readonly alreadyAvailable: number;
  readonly mismatched: readonly { documentId: string; reason: RestoreMismatchReason }[];
  readonly absent: readonly string[];
}

const HEX64 = /^[0-9a-f]{64}$/u;
const ZIP_LOCAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** Margen del archivo sobre la suma de los documentos (índice, cabeceras y directorio central). */
const ARCHIVE_OVERHEAD_BYTES = 8 * 1024 * 1024;

const unsupported = (why: string): DomainError => new DomainError('EXPORT_FORMAT_UNSUPPORTED', why);

/**
 * Archivo de contenidos del export (openspec add-document-attachments, tareas 8.2 y 8.3; D315): construcción en
 * streaming del ZIP de contenidos y su restauración. Cada documento se verifica como una subida nueva (un export puede
 * venir alterado): suma, inspección estructural y antimalware, y se cifra con claves nuevas.
 */
export class ContentsService implements DocumentContentsExporter {
  constructor(private readonly deps: DocumentsDeps) {}

  // ───────────────────────────────────────────────────────────── exportación

  /** ZIP en claro y en streaming: índice primero, luego `documents/<id>` de cada documento disponible. */
  async open(workspaceId: string): Promise<{ readonly stream: Readable; readonly count: number }> {
    const { deps } = this;
    const docs = await deps.uow.run(workspaceId, async () => {
      const out: Document[] = [];
      let cursor: string | undefined;
      do {
        const page = await deps.documents.list(workspaceId, {
          status: 'AVAILABLE',
          archived: 'INCLUDE',
          limit: 200,
          ...(cursor ? { cursor } : {}),
        });
        out.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return out;
    });
    const exportedAt = deps.clock.now();
    const manifest: ContentsManifest = {
      formatVersion: 1,
      exportedAt: exportedAt.toString(),
      documents: docs.map((d) => ({
        documentId: d.id,
        sha256: d.snapshot.sha256,
        sizeBytes: d.snapshot.sizeBytes,
      })),
    };
    const read = (doc: Document) => this.readContent(doc);
    async function* entries(): AsyncGenerator<ArchiveEntry> {
      yield { name: DOCUMENT_CONTENTS_MANIFEST, data: Buffer.from(JSON.stringify(manifest), 'utf8') };
      for (const doc of docs) yield { name: `documents/${doc.id}`, data: await read(doc) };
    }
    return {
      stream: Readable.from(writeArchive(entries(), exportedAt.toDate()), { objectMode: false }),
      count: docs.length,
    };
  }

  private async readContent(doc: Document): Promise<Buffer> {
    const s = doc.snapshot;
    const stream = await openVerified(this.deps, doc, (err) =>
      err instanceof DomainError
        ? err
        : new DomainError('DOCUMENT_CONTENT_CORRUPTED', 'the stored content failed its integrity check'),
    );
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of stream) {
        const buf = chunk as Buffer;
        total += buf.length;
        if (total > s.sizeBytes) break;
        chunks.push(buf);
      }
    } catch {
      throw new DomainError('DOCUMENT_CONTENT_CORRUPTED', 'the stored content failed its integrity check');
    }
    const content = Buffer.concat(chunks);
    if (content.length !== s.sizeBytes || createHash('sha256').update(content).digest('hex') !== s.sha256) {
      throw new DomainError('DOCUMENT_CONTENT_CORRUPTED', 'the stored content does not match its checksum');
    }
    return content;
  }

  // ───────────────────────────────────────────────────────────── restauración: solicitud

  /** Tope del archivo subido: la cuota del workspace más el margen del ZIP (`DOCUMENT_WORKSPACE_QUOTA_BYTES`). */
  get restoreMaxBytes(): number {
    return this.deps.settings.quota.quotaBytes + ARCHIVE_OVERHEAD_BYTES;
  }

  /**
   * Deja el ZIP subido en la cuarentena SIN cargarlo en memoria (multipart) y calcula su SHA-256 (la huella de la
   * idempotencia). Rechaza lo que no empieza como un ZIP. Un exceso lanza `UPLOAD_TOO_LARGE`.
   */
  async stageUpload(workspaceId: string, file: Readable): Promise<StagedRestoreUpload> {
    const { deps } = this;
    const restoreId = deps.ids.next();
    const objectKey = restoreUploadKeyOf(workspaceId, restoreId);
    const hash = createHash('sha256');
    let first = true;
    const tapped = (async function* () {
      for await (const chunk of file) {
        const buf = chunk as Buffer;
        if (first) {
          first = false;
          if (buf.length < 4 || !buf.subarray(0, 4).equals(ZIP_LOCAL_SIGNATURE)) {
            throw unsupported('the file is not a document contents archive');
          }
        }
        hash.update(buf);
        yield buf;
      }
    })();
    let size: number;
    try {
      ({ size } = await deps.storage.putStream(deps.settings.quarantineBucket, objectKey, tapped, {
        maxBytes: this.restoreMaxBytes,
      }));
    } catch (err) {
      await this.dropStaged(objectKey);
      if ((err as Error)?.name === 'ObjectTooLargeError') {
        throw new DomainError('UPLOAD_TOO_LARGE', `the file exceeds ${this.restoreMaxBytes} bytes`);
      }
      throw err;
    }
    if (first) {
      await this.dropStaged(objectKey);
      throw unsupported('the file is empty');
    }
    return { restoreId, objectKey, sizeBytes: size, sha256: hash.digest('hex') };
  }

  /** Quita el objeto en cuarentena (tras un fallo o al terminar); la barredora lo recoge si esto falla. */
  async dropStaged(objectKey: string): Promise<void> {
    try {
      await this.deps.storage.delete(this.deps.settings.quarantineBucket, objectKey);
    } catch {
      // `SweepQuarantine` lo elimina a las 24 h.
    }
  }

  /** `202 + operación`: crea la operación, audita y encola el job en la misma transacción. */
  async requestRestore(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly staged: StagedRestoreUpload;
  }): Promise<{ readonly operationId: string; readonly createdAt: string }> {
    const { deps } = this;
    const { workspaceId, userId, staged } = input;
    const now = deps.clock.now().toString();
    return deps.uow.run(workspaceId, async () => {
      await deps.operations.insert({ id: staged.restoreId, workspaceId, requestedBy: userId });
      await deps.audit.append({
        workspaceId,
        action: 'documents.contents_restore.requested',
        aggregateType: CONTENT_RESTORE_AGGREGATE,
        aggregateId: staged.restoreId,
        aggregateVersion: 1,
        changes: [
          { field: 'status', before: null, after: 'REQUESTED' },
          { field: 'sizeBytes', before: null, after: staged.sizeBytes },
        ],
        actor: { type: 'USER', userId },
      });
      await deps.restoreJobs.enqueue({
        workspaceId,
        operationId: staged.restoreId,
        objectKey: staged.objectKey,
        requestedBy: userId,
      });
      return { operationId: staged.restoreId, createdAt: now };
    });
  }

  // ───────────────────────────────────────────────────────────── restauración: job

  /**
   * Job `documents.content-restore`: recorre el ZIP de la cuarentena en streaming y, por cada entrada del índice cuya
   * suma coincide con la de un documento `CONTENT_PENDING` del workspace (el mapeo de ids del import no se conserva),
   * verifica como una subida nueva, cifra con clave nueva y deja el documento `AVAILABLE` (una unidad de trabajo por
   * documento). Idempotente: solo actúa sobre los pendientes; un reintento tras terminar no hace nada.
   */
  async runRestore(job: ContentRestoreJob): Promise<'SUCCEEDED' | 'FAILED' | 'SKIPPED'> {
    const { deps } = this;
    const { workspaceId, operationId, requestedBy } = job;
    const status = await deps.uow.run(workspaceId, () => deps.operations.status(workspaceId, operationId));
    if (status === null || status === 'SUCCEEDED' || status === 'FAILED') return 'SKIPPED';
    await deps.uow.run(workspaceId, () =>
      deps.operations.update(workspaceId, operationId, { status: 'RUNNING', progressPct: 1 }),
    );
    try {
      const report = await this.restoreFrom(job);
      await deps.uow.run(workspaceId, async () => {
        await deps.operations.update(workspaceId, operationId, {
          status: 'SUCCEEDED',
          progressPct: 100,
          result: { ...report },
        });
        await deps.audit.append({
          workspaceId,
          action: 'documents.contents_restore.completed',
          aggregateType: CONTENT_RESTORE_AGGREGATE,
          aggregateId: operationId,
          aggregateVersion: 2,
          changes: [
            { field: 'status', before: 'REQUESTED', after: 'COMPLETED' },
            { field: 'restored', before: null, after: report.restored },
            { field: 'mismatched', before: null, after: report.mismatched.length },
            { field: 'absent', before: null, after: report.absent.length },
          ],
          actor: { type: 'USER', userId: requestedBy },
        });
      });
      await this.dropStaged(job.objectKey);
      return 'SUCCEEDED';
    } catch (err) {
      const code =
        err instanceof DomainError
          ? err.code
          : err instanceof ContentsArchiveError
            ? 'EXPORT_FILE_CORRUPTED'
            : 'INTERNAL_ERROR';
      await deps.uow.run(workspaceId, () =>
        deps.operations.update(workspaceId, operationId, { status: 'FAILED', error: { code } }),
      );
      await this.dropStaged(job.objectKey);
      if (err instanceof DomainError || err instanceof ContentsArchiveError) return 'FAILED';
      throw err;
    }
  }

  private async restoreFrom(job: ContentRestoreJob): Promise<RestoreReport> {
    const { deps } = this;
    const { workspaceId, requestedBy } = job;
    const pending = await deps.uow.run(workspaceId, async () => {
      const out: Document[] = [];
      let cursor: string | undefined;
      do {
        const page = await deps.documents.list(workspaceId, {
          status: 'CONTENT_PENDING',
          archived: 'INCLUDE',
          limit: 200,
          ...(cursor ? { cursor } : {}),
        });
        out.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return out;
    });
    const bySha = new Map<string, Document[]>();
    for (const d of pending) bySha.set(d.snapshot.sha256, [...(bySha.get(d.snapshot.sha256) ?? []), d]);
    const handled = new Set<string>();
    const mismatched: { documentId: string; reason: RestoreMismatchReason }[] = [];
    let restored = 0;
    let alreadyAvailable = 0;

    let source: Readable;
    try {
      source = await deps.storage.get(deps.settings.quarantineBucket, job.objectKey);
    } catch {
      throw unsupported('the uploaded archive is gone');
    }
    const limits = {
      maxEntries: Math.max(1000, pending.length + 8),
      maxEntryBytes: deps.settings.limits.maxBytes + 1024 * 1024,
      maxTotalBytes: deps.settings.quota.quotaBytes + ARCHIVE_OVERHEAD_BYTES,
    };
    let manifest: ContentsManifest | null = null;
    const expectedByEntry = new Map<string, { sha256: string; sizeBytes: number }>();
    for await (const entry of readArchive(source, limits)) {
      if (manifest === null) {
        if (entry.name !== DOCUMENT_CONTENTS_MANIFEST) throw unsupported('the archive index is missing');
        manifest = parseManifest(entry.data);
        for (const d of manifest.documents) {
          expectedByEntry.set(`documents/${d.documentId}`, { sha256: d.sha256, sizeBytes: d.sizeBytes });
        }
        continue;
      }
      const expected = expectedByEntry.get(entry.name);
      if (!expected) continue; // entrada fuera del índice: se ignora, nunca se escribe
      const candidates = (bySha.get(expected.sha256) ?? []).filter((d) => !handled.has(d.id));
      if (candidates.length === 0) {
        alreadyAvailable += await this.countAvailable(workspaceId, expected.sha256);
        continue;
      }
      const actual = createHash('sha256').update(entry.data).digest('hex');
      for (const doc of candidates) {
        handled.add(doc.id);
        if (actual !== expected.sha256 || entry.data.length !== doc.snapshot.sizeBytes) {
          mismatched.push({ documentId: doc.id, reason: 'CHECKSUM_MISMATCH' });
          continue;
        }
        const reason = await this.restoreOne(doc, entry.data, requestedBy);
        if (reason === null) restored += 1;
        else mismatched.push({ documentId: doc.id, reason });
      }
    }
    if (manifest === null) throw unsupported('the archive index is missing');
    const absent = pending.filter((d) => !handled.has(d.id)).map((d) => d.id);
    return { restored, alreadyAvailable, mismatched, absent };
  }

  private async countAvailable(workspaceId: string, sha256: string): Promise<number> {
    const found = await this.deps.uow.run(workspaceId, () =>
      this.deps.documents.findAvailableBySha256(workspaceId, sha256),
    );
    return found ? 1 : 0;
  }

  /** Verifica el contenido como una subida nueva y lo deja disponible; devuelve el motivo si se rechaza. */
  private async restoreOne(doc: Document, content: Buffer, requestedBy: string): Promise<string | null> {
    const { deps } = this;
    const s = doc.snapshot;
    const verdict = await deps.inspector.inspect(content, s.declaredFormat);
    if (!verdict.ok) return verdict.reason;
    const scan = await deps.scanner.scan(content);
    if (scan.status === 'INFECTED') return 'MALWARE_DETECTED';
    if (scan.status === 'UNAVAILABLE') {
      throw new DomainError('SERVICE_UNAVAILABLE', 'the malware scanner is not available');
    }
    const sealed = await deps.cipher.seal(content, wrapContextOf(s.workspaceId, s.id));
    const objectKey = objectKeyOf(s.workspaceId, s.id);
    await deps.storage.put(deps.settings.documentsBucket, objectKey, sealed.encrypted);
    const actor: AuditActorDto = { type: 'USER', userId: requestedBy };
    await deps.uow.run(s.workspaceId, async () => {
      const current = await deps.documents.findById(s.workspaceId, s.id, { lock: 'update' });
      // Idempotencia: solo se actúa sobre un documento que sigue pendiente.
      if (!current || current.status !== 'CONTENT_PENDING') return;
      const before = current.snapshot;
      current.restoreContent(
        {
          objectKey,
          encryptedSizeBytes: sealed.encrypted.length,
          keyId: sealed.keyId,
          wrappedKey: sealed.wrappedKey,
          scanStatus: scan.status === 'CLEAN' ? 'CLEAN' : 'NOT_SCANNED',
          scanEngine: scan.status === 'CLEAN' ? deps.scanner.engine : null,
        },
        deps.clock.now().toString(),
      );
      if (!(await deps.documents.save(current))) {
        throw new DomainError('PRECONDITION_FAILED', 'the document was modified concurrently');
      }
      await deps.lifecycle.record(
        documentEntry(current, 'content_restored', documentChanges(before, current.snapshot), { actor }),
        documentSteps(current, []),
      );
    });
    return null;
  }
}

function parseManifest(data: Buffer): ContentsManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch {
    throw unsupported('the archive index is not valid JSON');
  }
  const m = parsed as Partial<ContentsManifest> | null;
  if (!m || m.formatVersion !== 1 || !Array.isArray(m.documents)) {
    throw unsupported('the archive index has an unsupported format');
  }
  for (const d of m.documents) {
    if (
      !d ||
      typeof d.documentId !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(d.documentId) ||
      typeof d.sha256 !== 'string' ||
      !HEX64.test(d.sha256) ||
      typeof d.sizeBytes !== 'number' ||
      !Number.isSafeInteger(d.sizeBytes) ||
      d.sizeBytes < 0
    ) {
      throw unsupported('the archive index has an invalid entry');
    }
  }
  return m as ContentsManifest;
}
