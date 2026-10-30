import { DomainError, LifecycleMachine, type StateTransition } from '@pf/shared-kernel';
import type { DeclaredFile } from './file-type-policy.js';
import type {
  DocumentFormat,
  DocumentPurpose,
  DocumentStatus,
  RejectionReason,
  ScanStatus,
} from './types.js';

/**
 * Máquina `Document` (openspec add-document-attachments, design decisión 1; docs/31 D37). Archivar, desarchivar,
 * vincular y desvincular NO cambian el estado: son anotaciones del recorrido (`archivedAt` es un atributo).
 *
 *   ∅ ──REQUEST_UPLOAD──▶ PENDING_UPLOAD ──CONFIRM──▶ UPLOADED ──ACCEPT──▶ AVAILABLE ──DELETE/PURGE──▶ DELETED
 *                              │ EXPIRE                  │ REJECT                ▲ RESTORE_CONTENT
 *                              ▼                         ▼               CONTENT_PENDING ──DELETE──▶ DELETED
 *                           REJECTED                  REJECTED
 */
export const DOCUMENT_AGGREGATE = 'Document';
const AVAILABLE_EVENT = 'documents.AttachmentUploaded.v1';
const REJECTED_EVENT = 'documents.DocumentRejected.v1';

export type DocumentTransition =
  'REQUEST_UPLOAD' | 'CONFIRM' | 'ACCEPT' | 'REJECT' | 'EXPIRE' | 'DELETE' | 'PURGE' | 'RESTORE_CONTENT';
export type DocumentTransitionRecord = StateTransition<DocumentStatus, DocumentTransition>;

export const DOCUMENT_LIFECYCLE = LifecycleMachine.define({
  aggregateType: DOCUMENT_AGGREGATE,
  machineVersion: 1,
  states: [
    { code: 'PENDING_UPLOAD', terminal: false },
    { code: 'UPLOADED', terminal: false },
    { code: 'AVAILABLE', terminal: false },
    { code: 'CONTENT_PENDING', terminal: false },
    { code: 'REJECTED', terminal: true },
    { code: 'DELETED', terminal: true },
  ],
  transitions: [
    {
      code: 'REQUEST_UPLOAD',
      from: [],
      to: ['PENDING_UPLOAD'],
      guard:
        'OWNER o EDITOR; tipo, tamaño y propósito dentro de la política; cuota y subidas pendientes con espacio',
      events: [],
    },
    {
      code: 'CONFIRM',
      from: ['PENDING_UPLOAD'],
      to: ['UPLOADED'],
      guard: 'el objeto existe en cuarentena con el tamaño declarado; inicia la verificación',
      events: [],
    },
    {
      code: 'ACCEPT',
      from: ['UPLOADED'],
      to: ['AVAILABLE'],
      guard: 'suma, tipo real y controles por formato superados; contenido cifrado y promovido',
      events: [AVAILABLE_EVENT],
    },
    {
      code: 'REJECT',
      from: ['UPLOADED'],
      to: ['REJECTED'],
      guard:
        'suma o tamaño distintos, tipo no permitido o distinto, contenido activo, cifrado, macros, límites o malware',
      events: [REJECTED_EVENT],
    },
    {
      code: 'EXPIRE',
      from: ['PENDING_UPLOAD'],
      to: ['REJECTED'],
      guard: 'sistema: la confirmación no llegó dentro del plazo de la dirección más la gracia',
      events: [REJECTED_EVENT],
    },
    {
      code: 'DELETE',
      from: ['AVAILABLE', 'CONTENT_PENDING'],
      to: ['DELETED'],
      guard: 'OWNER o EDITOR; destruye la clave de datos envuelta y quita los vínculos',
      events: [],
    },
    {
      code: 'PURGE',
      from: ['AVAILABLE'],
      to: ['DELETED'],
      guard: 'sistema: sin vínculos ni archivado por más del plazo de retención',
      events: [],
    },
    {
      code: 'RESTORE_CONTENT',
      from: ['CONTENT_PENDING'],
      to: ['AVAILABLE'],
      guard: 'OWNER; la suma del contenido del archivo de restauración coincide con la del documento',
      events: [AVAILABLE_EVENT],
    },
  ],
});

export interface DocumentState {
  readonly id: string;
  readonly workspaceId: string;
  readonly purpose: DocumentPurpose;
  readonly status: DocumentStatus;
  readonly originalName: string;
  readonly extension: string;
  readonly declaredContentType: string;
  readonly declaredFormat: DocumentFormat;
  readonly detectedContentType: string | null;
  readonly detectedFormat: DocumentFormat | null;
  readonly sizeBytes: number;
  /** SHA-256 en hexadecimal. */
  readonly sha256: string;
  readonly quarantineKey: string | null;
  readonly objectKey: string | null;
  readonly encryptedSizeBytes: number | null;
  readonly keyId: string | null;
  readonly wrappedKey: Uint8Array | null;
  readonly envelopeVersion: number | null;
  readonly scanStatus: ScanStatus | null;
  readonly scanEngine: string | null;
  readonly rejectionReason: RejectionReason | null;
  readonly uploadExpiresAt: string | null;
  readonly verificationStartedAt: string | null;
  readonly uploadedAt: string | null;
  readonly availableAt: string | null;
  readonly rejectedAt: string | null;
  readonly archivedAt: string | null;
  readonly archivedBy: string | null;
  readonly deletedAt: string | null;
  readonly deletedBy: string | null;
  readonly lastUnlinkedAt: string | null;
  readonly restoredFrom: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

const invalid = (code: string, detail: string): DomainError =>
  new DomainError('INVALID_STATUS_TRANSITION', `document: ${detail}`, { details: { transition: code } });

/** Agregado `Document`. Inmutable hacia afuera; cada cambio valida la máquina y deja `lastTransition`. */
export class Document {
  private state: DocumentState;
  private transition: DocumentTransitionRecord | null = null;
  private changed = new Set<string>();

  private constructor(state: DocumentState) {
    this.state = state;
  }

  static rehydrate(state: DocumentState): Document {
    return new Document(state);
  }

  /** Alta en `PENDING_UPLOAD`. La clave de cuarentena es opaca (workspace y documento). */
  static request(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly declared: DeclaredFile;
    readonly quarantineKey: string;
    readonly uploadExpiresAt: string;
    readonly createdBy: string;
    readonly at: string;
  }): Document {
    const { declared } = input;
    const doc = new Document({
      id: input.id,
      workspaceId: input.workspaceId,
      purpose: declared.purpose,
      status: 'PENDING_UPLOAD',
      originalName: declared.fileName,
      extension: declared.extension,
      declaredContentType: declared.declaredContentType,
      declaredFormat: declared.format,
      detectedContentType: null,
      detectedFormat: null,
      sizeBytes: declared.sizeBytes,
      sha256: declared.sha256,
      quarantineKey: input.quarantineKey,
      objectKey: null,
      encryptedSizeBytes: null,
      keyId: null,
      wrappedKey: null,
      envelopeVersion: null,
      scanStatus: null,
      scanEngine: null,
      rejectionReason: null,
      uploadExpiresAt: input.uploadExpiresAt,
      verificationStartedAt: null,
      uploadedAt: null,
      availableAt: null,
      rejectedAt: null,
      archivedAt: null,
      archivedBy: null,
      deletedAt: null,
      deletedBy: null,
      lastUnlinkedAt: null,
      restoredFrom: null,
      createdBy: input.createdBy,
      createdAt: input.at,
      updatedAt: input.at,
      version: 1,
    });
    doc.transition = { transition: 'REQUEST_UPLOAD', from: null, to: 'PENDING_UPLOAD' };
    return doc;
  }

  get snapshot(): DocumentState {
    return this.state;
  }
  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get status(): DocumentStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }
  get lastTransition(): DocumentTransitionRecord | null {
    return this.transition;
  }
  get changedFields(): readonly string[] {
    return [...this.changed];
  }

  private move(
    code: DocumentTransition,
    to: DocumentStatus,
    patch: Partial<DocumentState>,
    at: string,
  ): void {
    const def = DOCUMENT_LIFECYCLE.transitionDefinition(code);
    if (!def || !def.from.includes(this.state.status)) {
      throw invalid(code, `${code} is not allowed from ${this.state.status}`);
    }
    this.transition = { transition: code, from: this.state.status, to };
    this.changed = new Set(Object.keys(patch));
    this.state = { ...this.state, ...patch, status: to, updatedAt: at, version: this.state.version + 1 };
  }

  private annotate(patch: Partial<DocumentState>, at: string): void {
    this.transition = null;
    this.changed = new Set(Object.keys(patch));
    this.state = { ...this.state, ...patch, updatedAt: at, version: this.state.version + 1 };
  }

  /** `PENDING_UPLOAD → UPLOADED`: el archivo llegó; inicia la verificación. */
  confirm(at: string): void {
    this.move('CONFIRM', 'UPLOADED', { uploadedAt: at, verificationStartedAt: at }, at);
  }

  /** Anotación: otro intento toma una verificación atascada (`RecoverStuckUploads`). */
  restartVerification(at: string): void {
    this.annotate({ verificationStartedAt: at }, at);
  }

  /** `UPLOADED → AVAILABLE`: verificado, cifrado y promovido. */
  accept(
    input: {
      readonly detectedFormat: DocumentFormat;
      readonly detectedContentType: string;
      readonly objectKey: string;
      readonly encryptedSizeBytes: number;
      readonly keyId: string;
      readonly wrappedKey: Uint8Array;
      readonly scanStatus: ScanStatus;
      readonly scanEngine: string | null;
    },
    at: string,
  ): void {
    this.move(
      'ACCEPT',
      'AVAILABLE',
      {
        detectedFormat: input.detectedFormat,
        detectedContentType: input.detectedContentType,
        objectKey: input.objectKey,
        encryptedSizeBytes: input.encryptedSizeBytes,
        keyId: input.keyId,
        wrappedKey: input.wrappedKey,
        envelopeVersion: 1,
        scanStatus: input.scanStatus,
        scanEngine: input.scanEngine,
        quarantineKey: null,
        availableAt: at,
        verificationStartedAt: null,
      },
      at,
    );
  }

  /** `UPLOADED → REJECTED` con el motivo de la verificación. */
  reject(reason: RejectionReason, at: string): void {
    this.move(
      'REJECT',
      'REJECTED',
      { rejectionReason: reason, rejectedAt: at, quarantineKey: null, verificationStartedAt: null },
      at,
    );
  }

  /** `PENDING_UPLOAD → REJECTED` por vencimiento (`UPLOAD_NOT_COMPLETED`). */
  expire(at: string): void {
    this.move(
      'EXPIRE',
      'REJECTED',
      { rejectionReason: 'UPLOAD_NOT_COMPLETED', rejectedAt: at, quarantineKey: null },
      at,
    );
  }

  /** `AVAILABLE | CONTENT_PENDING → DELETED`: destruye la clave de datos envuelta (crypto-shredding). */
  delete(by: string, at: string, mode: 'USER' | 'PURGE' = 'USER'): void {
    this.move(
      mode === 'PURGE' ? 'PURGE' : 'DELETE',
      'DELETED',
      { deletedAt: at, deletedBy: by, wrappedKey: null, keyId: null, archivedAt: null, archivedBy: null },
      at,
    );
  }

  /** `CONTENT_PENDING → AVAILABLE`: contenido restaurado con claves nuevas. */
  restoreContent(
    input: {
      readonly objectKey: string;
      readonly encryptedSizeBytes: number;
      readonly keyId: string;
      readonly wrappedKey: Uint8Array;
      readonly scanStatus: ScanStatus;
      readonly scanEngine: string | null;
    },
    at: string,
  ): void {
    this.move(
      'RESTORE_CONTENT',
      'AVAILABLE',
      {
        objectKey: input.objectKey,
        encryptedSizeBytes: input.encryptedSizeBytes,
        keyId: input.keyId,
        wrappedKey: input.wrappedKey,
        envelopeVersion: 1,
        scanStatus: input.scanStatus,
        scanEngine: input.scanEngine,
        availableAt: at,
      },
      at,
    );
  }

  /**
   * Rotación de la clave maestra: reemplaza el envoltorio de la clave de datos. No es un cambio de negocio: no sube
   * la versión (un `If-Match` abierto del usuario sigue valiendo) ni deja recorrido.
   */
  rewrapKey(next: { readonly keyId: string; readonly wrappedKey: Uint8Array }): void {
    if (this.state.status !== 'AVAILABLE' && this.state.status !== 'CONTENT_PENDING') return;
    this.state = { ...this.state, keyId: next.keyId, wrappedKey: next.wrappedKey };
  }

  /** Anotación: archivar (solo documentos con contenido o pendientes de restaurar). */
  archive(by: string, at: string): void {
    this.assertArchivable();
    if (this.state.archivedAt !== null) return;
    this.annotate({ archivedAt: at, archivedBy: by }, at);
  }

  unarchive(at: string): void {
    this.assertArchivable();
    if (this.state.archivedAt === null) return;
    this.annotate({ archivedAt: null, archivedBy: null }, at);
  }

  /** Anotación: se quitó el último vínculo (inicia el plazo de la purga). */
  markUnlinked(at: string): void {
    this.annotate({ lastUnlinkedAt: at }, at);
  }

  private assertArchivable(): void {
    if (this.state.status !== 'AVAILABLE' && this.state.status !== 'CONTENT_PENDING') {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        `document: cannot archive a ${this.state.status} document`,
      );
    }
  }

  /** ¿Se puede vincular? Distingue el motivo (`DOCUMENT_NOT_AVAILABLE`, `DOCUMENT_REJECTED`, `DOCUMENT_DELETED`). */
  assertLinkable(): void {
    assertDocumentReadable(this.state.status, { allowContentPending: false });
  }

  /** ¿Se puede descargar? */
  assertDownloadable(): void {
    assertDocumentReadable(this.state.status, { allowContentPending: false });
  }
}

/** Errores de estado compartidos por vincular, descargar y leer para el pipeline. */
export function assertDocumentReadable(
  status: DocumentStatus,
  options: { readonly allowContentPending: boolean },
): void {
  if (status === 'AVAILABLE') return;
  if (status === 'CONTENT_PENDING' && options.allowContentPending) return;
  if (status === 'REJECTED') throw new DomainError('DOCUMENT_REJECTED', 'the document was rejected');
  if (status === 'DELETED') throw new DomainError('DOCUMENT_DELETED', 'the document was deleted');
  throw new DomainError('DOCUMENT_NOT_AVAILABLE', 'the document is not available');
}
