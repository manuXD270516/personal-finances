import { Readable } from 'node:stream';
import type { AuditEntry } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import {
  DocumentIntegrityError,
  DocumentNotAvailableError,
  type DocumentContentReader,
  type DocumentForProcessingDto,
  type DocumentQuery,
} from '../contracts/index.js';
import { assertDocumentReadable, type Document } from '../domain/document.js';
import { contentDispositionOf } from '../domain/file-name.js';
import { CANONICAL_TYPE_OF } from '../domain/file-type-policy.js';
import { wrapContextOf, type DocumentsDeps } from './ports/index.js';
import { DOCUMENT_AGGREGATE } from './recorder.js';
import { notFound } from './support.js';

export interface DownloadResult {
  /** Cabeceras de la respuesta (decisión 7): adjunto, tipo canónico, sin adivinar, aislado, sin caché compartida. */
  readonly headers: Readonly<Record<string, string>>;
  readonly contentType: string;
  readonly contentLength: number;
  readonly stream: Readable;
}

const corrupted = (): DomainError =>
  new DomainError('DOCUMENT_CONTENT_CORRUPTED', 'the stored content failed its integrity check');

/** Abre el contenido descifrado: el primer bloque se valida ANTES de devolver nada (así un fallo sigue siendo 422). */
export async function openVerified(
  deps: DocumentsDeps,
  doc: Document,
  enforce: (err: unknown) => Error,
): Promise<Readable> {
  const s = doc.snapshot;
  if (!s.objectKey || !s.keyId || !s.wrappedKey)
    throw enforce(new DocumentIntegrityError('missing key material'));
  let plain: Readable;
  try {
    const encrypted = await deps.storage.get(deps.settings.documentsBucket, s.objectKey);
    plain = await deps.cipher.open(
      encrypted,
      { keyId: s.keyId, wrappedKey: s.wrappedKey },
      wrapContextOf(s.workspaceId, s.id),
    );
  } catch (err) {
    throw enforce(err);
  }
  const iterator = plain[Symbol.asyncIterator]();
  let first: IteratorResult<unknown>;
  try {
    first = await iterator.next();
  } catch (err) {
    throw enforce(err);
  }
  async function* rest(): AsyncGenerator<Buffer> {
    if (!first.done) yield first.value as Buffer;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value as Buffer;
    }
  }
  return Readable.from(rest(), { objectMode: false });
}

const asCorrupted = (err: unknown): Error => {
  if (err instanceof DomainError) return err;
  if (err instanceof DocumentIntegrityError) return corrupted();
  // Objeto ausente en el almacenamiento, clave maestra retirada o error de descifrado: contenido no entregable.
  return corrupted();
};

/**
 * Descarga SOLO a través de la API, en streaming (decisión 7; D313). La auditoría se escribe en la misma transacción
 * de lectura que autoriza y ANTES de emitir el cuerpo: si falla, no se entrega el archivo. Implementa además los
 * contratos públicos `DocumentQuery` y `DocumentContentReader` para el pipeline de IMPORTS.
 */
export class DownloadService implements DocumentQuery, DocumentContentReader {
  constructor(private readonly deps: DocumentsDeps) {}

  async download(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly documentId: string;
  }): Promise<DownloadResult> {
    const { deps } = this;
    const doc = await deps.uow.run(input.workspaceId, async () => {
      const found = await deps.documents.findById(input.workspaceId, input.documentId);
      if (!found) throw notFound();
      // DOCUMENT_NOT_AVAILABLE / DOCUMENT_REJECTED / DOCUMENT_DELETED (también para el contenido pendiente de restaurar).
      found.assertDownloadable();
      const entry: AuditEntry = {
        workspaceId: input.workspaceId,
        action: 'documents.document.downloaded',
        aggregateType: DOCUMENT_AGGREGATE,
        aggregateId: found.id,
        aggregateVersion: found.version,
        changes: [{ field: 'downloadedBytes', before: null, after: found.snapshot.sizeBytes }],
      };
      await deps.audit.append(entry);
      return found;
    });
    const stream = await openVerified(deps, doc, asCorrupted);
    const s = doc.snapshot;
    const type = s.detectedFormat ? CANONICAL_TYPE_OF[s.detectedFormat] : 'application/octet-stream';
    return {
      contentType: type,
      contentLength: s.sizeBytes,
      stream,
      headers: {
        'content-disposition': contentDispositionOf(s.originalName),
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'cache-control': 'private, no-store',
        'repr-digest': `sha-256=:${Buffer.from(s.sha256, 'hex').toString('base64')}:`,
      },
    };
  }

  // ───────────────────────────────────────────────────────────── contratos públicos (IMPORTS)

  async getForProcessing(input: {
    readonly workspaceId: string;
    readonly documentId: string;
  }): Promise<DocumentForProcessingDto | null> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const doc = await this.deps.documents.findById(input.workspaceId, input.documentId);
      if (!doc) return null;
      const s = doc.snapshot;
      return {
        documentId: s.id,
        status: s.status,
        purpose: s.purpose,
        detectedFormat: s.detectedFormat,
        detectedContentType: s.detectedContentType,
        sizeBytes: s.sizeBytes,
        sha256: s.sha256,
        originalName: s.originalName,
        availableAt: s.availableAt,
      };
    });
  }

  async open(input: { readonly workspaceId: string; readonly documentId: string }): Promise<Readable> {
    const doc = await this.deps.uow.run(input.workspaceId, () =>
      this.deps.documents.findById(input.workspaceId, input.documentId),
    );
    if (!doc) throw new DocumentNotAvailableError('DOCUMENT_NOT_AVAILABLE');
    try {
      assertDocumentReadable(doc.status, { allowContentPending: false });
    } catch (err) {
      const code = err instanceof DomainError ? err.code : 'DOCUMENT_NOT_AVAILABLE';
      throw new DocumentNotAvailableError(
        code as 'DOCUMENT_NOT_AVAILABLE' | 'DOCUMENT_REJECTED' | 'DOCUMENT_DELETED',
      );
    }
    // Para el pipeline el error es el de integridad del contrato, no un problema HTTP.
    return openVerified(this.deps, doc, (err) =>
      err instanceof DocumentIntegrityError
        ? err
        : new DocumentIntegrityError(String((err as Error)?.message ?? err)),
    );
  }
}
