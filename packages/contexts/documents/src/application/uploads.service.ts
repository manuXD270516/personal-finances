import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { AuditActorDto } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import { Document } from '../domain/document.js';
import { CANONICAL_TYPE_OF, validateDeclaration } from '../domain/file-type-policy.js';
import { promote, release, reserve } from '../domain/storage-quota.js';
import type { DocumentFormat, RejectionReason, ScanStatus } from '../domain/types.js';
import {
  objectKeyOf,
  quarantineKeyOf,
  wrapContextOf,
  type DocumentsDeps,
  type LinkRecord,
} from './ports/index.js';
import {
  documentChanges,
  documentEntry,
  documentSteps,
  publishAvailable,
  publishRejected,
} from './recorder.js';
import { documentView, type DocumentView, type UploadInstructions } from './views.js';

export interface RequestUploadCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly fileName: unknown;
  readonly contentType: unknown;
  readonly sizeBytes: unknown;
  readonly sha256: unknown;
  readonly purpose: unknown;
}

export type RequestUploadResult =
  | { readonly deduplicated: false; readonly document: DocumentView; readonly upload: UploadInstructions }
  | { readonly deduplicated: true; readonly document: DocumentView; readonly upload: null };

export interface CompleteUploadCommand {
  readonly workspaceId: string;
  readonly documentId: string;
  /** Sin usuario: el mantenimiento (`RecoverStuckUploads`) reintenta con actor `SYSTEM`. */
  readonly system?: string;
}

type Outcome =
  | {
      readonly kind: 'ACCEPT';
      readonly encrypted: Buffer;
      readonly sealed: Sealed;
      readonly detected: Detected;
      readonly scan: ScanInfo;
    }
  | { readonly kind: 'REJECT'; readonly reason: RejectionReason };
interface Sealed {
  readonly keyId: string;
  readonly wrappedKey: Uint8Array;
}
interface Detected {
  readonly format: DocumentFormat;
}
interface ScanInfo {
  readonly status: ScanStatus;
  readonly engine: string | null;
}

const serviceUnavailable = (retryAfterSeconds: number, why: string): DomainError =>
  new DomainError('SERVICE_UNAVAILABLE', why, { details: { retryAfterSeconds } });

/** Lee un flujo en memoria con tope; devuelve `null` si lo excede (el almacenamiento no debería permitirlo). */
async function readCapped(stream: Readable, cap: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > cap) {
      stream.destroy();
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Solicitud y confirmación de la subida (openspec add-document-attachments, decisiones 2 y 3). La API nunca recibe el
 * contenido: entrega una URL presignada a la cuarentena y, al confirmar, VERIFICA de forma síncrona fuera de toda
 * transacción (HEAD → lectura → suma → inspección → antimalware → cifrado → promoción), con dos unidades de trabajo
 * cortas alrededor (`PENDING_UPLOAD → UPLOADED` y `UPLOADED → AVAILABLE | REJECTED`).
 */
export class UploadsService {
  constructor(private readonly deps: DocumentsDeps) {}

  // ───────────────────────────────────────────────────────────── solicitar

  async requestUpload(cmd: RequestUploadCommand): Promise<RequestUploadResult> {
    const { deps } = this;
    const { workspaceId, userId } = cmd;
    const declared = validateDeclaration(cmd, deps.settings.limits);
    const now = deps.clock.now();
    const at = now.toString();

    const created = await deps.uow.run(workspaceId, async () => {
      // Deduplicación por contenido dentro del workspace (FR-DOCUMENTS-006): sin cuota ni URL.
      const existing = await deps.documents.findAvailableBySha256(workspaceId, declared.sha256);
      if (existing) {
        const links = await deps.links.linksOf(workspaceId, [existing.id]);
        return { kind: 'dedup' as const, doc: existing, links: links.get(existing.id) ?? [] };
      }
      // El bloqueo de fila serializa las solicitudes concurrentes del workspace (escenario del último espacio).
      const usage = await deps.usage.lock(workspaceId);
      const next = reserve(usage, declared.sizeBytes, deps.settings.quota);
      const id = deps.ids.next();
      const doc = Document.request({
        id,
        workspaceId,
        declared,
        quarantineKey: quarantineKeyOf(workspaceId, id),
        uploadExpiresAt: now.plusMillis(deps.settings.uploadUrlTtlSeconds * 1000).toString(),
        createdBy: userId,
        at,
      });
      await deps.documents.insert(doc);
      await deps.usage.save(workspaceId, next, at);
      await deps.lifecycle.record(
        documentEntry(doc, 'upload_requested', documentChanges(null, doc.snapshot)),
        documentSteps(doc, []),
      );
      return { kind: 'new' as const, doc, links: [] as LinkRecord[] };
    });

    if (created.kind === 'dedup') {
      return { deduplicated: true, document: documentView(created.doc, created.links), upload: null };
    }
    const s = created.doc.snapshot;
    const put = deps.storage.presignPut({
      bucket: deps.settings.quarantineBucket,
      key: s.quarantineKey as string,
      contentType: s.declaredContentType,
      contentLength: s.sizeBytes,
      sha256Base64: Buffer.from(s.sha256, 'hex').toString('base64'),
      expiresInSeconds: deps.settings.uploadUrlTtlSeconds,
    });
    return {
      deduplicated: false,
      document: documentView(created.doc),
      upload: {
        url: put.url,
        method: 'PUT',
        headers: put.headers,
        expiresAt: s.uploadExpiresAt as string,
      },
    };
  }

  // ───────────────────────────────────────────────────────────── confirmar y verificar

  async completeUpload(cmd: CompleteUploadCommand): Promise<DocumentView> {
    const { deps } = this;
    const { workspaceId, documentId } = cmd;
    const quarantine = deps.settings.quarantineBucket;

    const current = await deps.uow.run(workspaceId, () => deps.documents.findById(workspaceId, documentId));
    if (!current) throw new DomainError('RESOURCE_NOT_FOUND', 'document not found');
    const status = current.status;
    // Repetir la confirmación de un documento ya verificado devuelve el mismo resultado, sin verificar de nuevo.
    if (status === 'AVAILABLE' || status === 'REJECTED') return this.viewOf(workspaceId, current);
    if (status === 'DELETED' || status === 'CONTENT_PENDING') {
      throw new DomainError('INVALID_STATUS_TRANSITION', `document: cannot confirm a ${status} document`);
    }
    const nowMs = deps.clock.now().epochMillis;
    const started = current.snapshot.verificationStartedAt;
    if (
      status === 'UPLOADED' &&
      !cmd.system &&
      started !== null &&
      nowMs - Date.parse(started) < deps.settings.stuckAfterMs
    ) {
      throw new DomainError('INVALID_STATUS_TRANSITION', 'the verification of this document is in progress');
    }

    // Existencia del objeto (fuera de toda transacción). Sin objeto ⇒ 409 y el documento sigue pendiente.
    let head: { contentLength: number } | null;
    try {
      head = await deps.storage.head(
        quarantine,
        current.snapshot.quarantineKey ?? quarantineKeyOf(workspaceId, documentId),
      );
    } catch {
      throw serviceUnavailable(deps.settings.retryAfterSeconds, 'object storage is not available');
    }
    if (head === null && status === 'PENDING_UPLOAD') {
      throw new DomainError('DOCUMENT_UPLOAD_MISSING', 'the file was not uploaded');
    }

    if (!deps.semaphore.tryAcquire()) {
      throw serviceUnavailable(deps.settings.retryAfterSeconds, 'too many verifications in progress');
    }
    try {
      // UoW 1: PENDING_UPLOAD → UPLOADED (o reinicio de una verificación atascada).
      const claimed = await deps.uow.run(workspaceId, async () => {
        const doc = await deps.documents.findById(workspaceId, documentId, { lock: 'update' });
        if (!doc) throw new DomainError('RESOURCE_NOT_FOUND', 'document not found');
        if (doc.status === 'AVAILABLE' || doc.status === 'REJECTED') return { done: true as const, doc };
        const at = deps.clock.now().toString();
        if (doc.status === 'PENDING_UPLOAD') {
          doc.confirm(at);
          await this.persist(doc);
          await deps.lifecycle.record(
            documentEntry(
              doc,
              'upload_confirmed',
              documentChanges(null, doc.snapshot).filter((c) => c.field === 'status'),
              this.actorOf(cmd),
            ),
            documentSteps(doc, []),
          );
        } else if (doc.status === 'UPLOADED') {
          doc.restartVerification(at);
          await this.persist(doc);
        } else {
          throw new DomainError(
            'INVALID_STATUS_TRANSITION',
            `document: cannot confirm a ${doc.status} document`,
          );
        }
        return { done: false as const, doc };
      });
      if (claimed.done) return this.viewOf(workspaceId, claimed.doc);

      // Verificación fuera de transacción.
      const outcome = await this.verify(claimed.doc, head?.contentLength ?? null);

      // UoW 2: UPLOADED → AVAILABLE | REJECTED.
      const finished = await deps.uow.run(workspaceId, async () => {
        const doc = await deps.documents.findById(workspaceId, documentId, { lock: 'update' });
        if (!doc) throw new DomainError('RESOURCE_NOT_FOUND', 'document not found');
        if (doc.status !== 'UPLOADED') return doc;
        const before = doc.snapshot;
        const at = deps.clock.now().toString();
        const usage = await deps.usage.lock(workspaceId);
        if (outcome.kind === 'ACCEPT') {
          doc.accept(
            {
              detectedFormat: outcome.detected.format,
              detectedContentType: CANONICAL_TYPE_OF[outcome.detected.format],
              objectKey: objectKeyOf(workspaceId, documentId),
              encryptedSizeBytes: outcome.encrypted.length,
              keyId: outcome.sealed.keyId,
              wrappedKey: outcome.sealed.wrappedKey,
              scanStatus: outcome.scan.status,
              scanEngine: outcome.scan.engine,
            },
            at,
          );
          await deps.usage.save(workspaceId, promote(usage, before.sizeBytes), at);
        } else {
          doc.reject(outcome.reason, at);
          await deps.usage.save(workspaceId, release(usage, before.sizeBytes), at);
        }
        await this.persist(doc);
        const event =
          outcome.kind === 'ACCEPT' ? await publishAvailable(deps, doc) : await publishRejected(deps, doc);
        await deps.lifecycle.record(
          documentEntry(
            doc,
            outcome.kind === 'ACCEPT' ? 'accepted' : 'rejected',
            documentChanges(before, doc.snapshot),
            this.actorOf(cmd),
          ),
          documentSteps(doc, [event]),
        );
        return doc;
      });

      // Tras confirmar (aceptado o rechazado) el objeto ya no puede quedar en cuarentena. Si falla, lo barre
      // `SweepQuarantine` (red de seguridad de 24 h).
      await this.dropQuarantine(workspaceId, documentId);
      return this.viewOf(workspaceId, finished);
    } finally {
      deps.semaphore.release();
    }
  }

  // ───────────────────────────────────────────────────────────── internos

  private actorOf(cmd: CompleteUploadCommand): { actor: AuditActorDto } | Record<string, never> {
    return cmd.system ? { actor: { type: 'SYSTEM', process: cmd.system } } : {};
  }

  private async persist(doc: Document): Promise<void> {
    const saved = await this.deps.documents.save(doc);
    if (!saved) {
      throw new DomainError('PRECONDITION_FAILED', 'the document was modified concurrently', {
        details: { currentVersion: doc.version },
      });
    }
  }

  private async viewOf(workspaceId: string, doc: Document): Promise<DocumentView> {
    const links = await this.deps.uow.run(workspaceId, () => this.deps.links.linksOf(workspaceId, [doc.id]));
    return documentView(doc, links.get(doc.id) ?? []);
  }

  private async dropQuarantine(workspaceId: string, documentId: string): Promise<void> {
    try {
      await this.deps.storage.delete(
        this.deps.settings.quarantineBucket,
        quarantineKeyOf(workspaceId, documentId),
      );
    } catch {
      // La red de seguridad del barrido de cuarentena lo elimina; el documento ya tiene su estado final.
    }
  }

  /** Lectura, suma, inspección, antimalware y cifrado. Falla cerrada: ante duda, rechazo; si el servicio cae, 503. */
  private async verify(doc: Document, headLength: number | null): Promise<Outcome> {
    const { deps } = this;
    const s = doc.snapshot;
    const unavailable = () =>
      serviceUnavailable(deps.settings.retryAfterSeconds, 'object storage is not available');
    if (headLength !== null && headLength !== s.sizeBytes) return { kind: 'REJECT', reason: 'SIZE_MISMATCH' };

    let content: Buffer | null;
    try {
      const stream = await deps.storage.get(deps.settings.quarantineBucket, s.quarantineKey as string);
      content = await readCapped(stream, s.sizeBytes);
    } catch (err) {
      if ((err as Error)?.name === 'ObjectMissingError')
        return { kind: 'REJECT', reason: 'UPLOAD_NOT_COMPLETED' };
      throw unavailable();
    }
    if (content === null || content.length !== s.sizeBytes)
      return { kind: 'REJECT', reason: 'SIZE_MISMATCH' };
    if (createHash('sha256').update(content).digest('hex') !== s.sha256) {
      return { kind: 'REJECT', reason: 'CHECKSUM_MISMATCH' };
    }

    const verdict = await deps.inspector.inspect(content, s.declaredFormat);
    if (!verdict.ok) return { kind: 'REJECT', reason: verdict.reason };

    const scan = await deps.scanner.scan(content);
    if (scan.status === 'INFECTED') return { kind: 'REJECT', reason: 'MALWARE_DETECTED' };
    if (scan.status === 'UNAVAILABLE') {
      throw serviceUnavailable(deps.settings.retryAfterSeconds, 'the malware scanner is not available');
    }

    const sealed = await deps.cipher.seal(content, wrapContextOf(s.workspaceId, s.id));
    try {
      await deps.storage.put(
        deps.settings.documentsBucket,
        objectKeyOf(s.workspaceId, s.id),
        sealed.encrypted,
      );
    } catch {
      throw unavailable();
    }
    return {
      kind: 'ACCEPT',
      encrypted: sealed.encrypted,
      sealed: { keyId: sealed.keyId, wrappedKey: sealed.wrappedKey },
      detected: { format: verdict.format },
      scan: {
        status: scan.status === 'CLEAN' ? 'CLEAN' : 'NOT_SCANNED',
        engine: scan.status === 'CLEAN' ? deps.scanner.engine : null,
      },
    };
  }
}
