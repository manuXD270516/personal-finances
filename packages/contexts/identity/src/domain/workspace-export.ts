import { DomainError, Instant } from '@pf/shared-kernel';

/**
 * Agregado `WorkspaceExport` (openspec add-workspace-export, design § Capas): `REQUESTED → RUNNING → READY | FAILED` y
 * `READY → EXPIRED | DISCARDED`. UNA exportación en curso por workspace (lo garantiza además un índice único parcial).
 * El registro sobrevive a la expiración o eliminación del archivo (fechas, tamaño, suma, actor): es metadato, no el
 * contenido. Un export vencido nunca se descarga aunque el job de retención aún no haya corrido.
 */
export type ExportStatus = 'REQUESTED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED' | 'DISCARDED';

export const IN_PROGRESS_STATUSES: readonly ExportStatus[] = ['REQUESTED', 'RUNNING'];

export interface ExportFailure {
  readonly code: string;
  readonly message: string;
}

export interface WorkspaceExportProps {
  readonly id: string;
  readonly workspaceId: string;
  readonly operationId: string;
  readonly status: ExportStatus;
  readonly formatVersion: number;
  readonly objectKey: string | null;
  readonly sizeBytes: number | null;
  /** SHA-256 del ZIP en claro, en hexadecimal. */
  readonly sha256: string | null;
  readonly keyId: string | null;
  readonly wrappedKey: Uint8Array | null;
  readonly counts: Readonly<Record<string, number>>;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly expiresAt: string | null;
  readonly discardedAt: string | null;
  readonly discardedBy: string | null;
  readonly expiredAt: string | null;
  readonly error: ExportFailure | null;
  readonly version: number;
}

export interface ExportResult {
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly keyId: string;
  readonly wrappedKey: Uint8Array;
  readonly counts: Readonly<Record<string, number>>;
}

export class WorkspaceExport {
  private constructor(private props: WorkspaceExportProps) {}

  static request(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly operationId: string;
    readonly requestedBy: string;
    readonly formatVersion: number;
    readonly at: Instant;
  }): WorkspaceExport {
    return new WorkspaceExport({
      id: input.id,
      workspaceId: input.workspaceId,
      operationId: input.operationId,
      status: 'REQUESTED',
      formatVersion: input.formatVersion,
      objectKey: null,
      sizeBytes: null,
      sha256: null,
      keyId: null,
      wrappedKey: null,
      counts: {},
      requestedBy: input.requestedBy,
      requestedAt: input.at.toString(),
      completedAt: null,
      expiresAt: null,
      discardedAt: null,
      discardedBy: null,
      expiredAt: null,
      error: null,
      version: 1,
    });
  }

  static restore(props: WorkspaceExportProps): WorkspaceExport {
    return new WorkspaceExport({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get workspaceId(): string {
    return this.props.workspaceId;
  }
  get status(): ExportStatus {
    return this.props.status;
  }
  get version(): number {
    return this.props.version;
  }
  get inProgress(): boolean {
    return IN_PROGRESS_STATUSES.includes(this.props.status);
  }

  snapshot(): WorkspaceExportProps {
    return { ...this.props };
  }

  private next(patch: Partial<WorkspaceExportProps>): void {
    this.props = { ...this.props, ...patch, version: this.props.version + 1 };
  }

  private invalid(to: ExportStatus): DomainError {
    return new DomainError(
      'INVALID_STATUS_TRANSITION',
      `export cannot go from ${this.props.status} to ${to}`,
    );
  }

  /** `REQUESTED → RUNNING` (arranque del job; un reintento sobre RUNNING es idempotente y devuelve `false`). */
  start(): boolean {
    if (this.props.status === 'RUNNING') return false;
    if (this.props.status !== 'REQUESTED') throw this.invalid('RUNNING');
    this.next({ status: 'RUNNING' });
    return true;
  }

  /** `RUNNING → READY`: el archivo cifrado existe; vence a los `retentionMs` de terminado (docs/33 D102). */
  complete(result: ExportResult, at: Instant, retentionMs: number): void {
    if (this.props.status !== 'RUNNING') throw this.invalid('READY');
    if (!(retentionMs > 0)) throw new DomainError('VALIDATION_FAILED', 'retention must be positive');
    this.next({
      status: 'READY',
      objectKey: result.objectKey,
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
      keyId: result.keyId,
      wrappedKey: result.wrappedKey,
      counts: result.counts,
      completedAt: at.toString(),
      expiresAt: at.plusMillis(retentionMs).toString(),
    });
  }

  /** `REQUESTED | RUNNING → FAILED`: sin archivo; el motivo no incluye contenido exportado. */
  fail(error: ExportFailure, at: Instant): void {
    if (!this.inProgress) throw this.invalid('FAILED');
    this.next({ status: 'FAILED', error, completedAt: at.toString() });
  }

  /** ¿Venció? (aunque el job de retención aún no lo haya marcado). */
  isPastExpiry(at: Instant): boolean {
    const exp = this.props.expiresAt;
    return this.props.status === 'READY' && exp !== null && !at.isBefore(Instant.parse(exp));
  }

  /**
   * Descargable solo si está `READY` y no venció. En curso o fallido ⇒ `EXPORT_NOT_READY`; vencido, expirado o
   * eliminado ⇒ `EXPORT_EXPIRED`.
   */
  assertDownloadable(at: Instant): void {
    switch (this.props.status) {
      case 'REQUESTED':
      case 'RUNNING':
      case 'FAILED':
        throw new DomainError('EXPORT_NOT_READY', 'the export is not ready');
      case 'EXPIRED':
      case 'DISCARDED':
        throw new DomainError('EXPORT_EXPIRED', 'the export has expired or was discarded');
      case 'READY':
        if (this.isPastExpiry(at)) throw new DomainError('EXPORT_EXPIRED', 'the export has expired');
    }
  }

  /** `READY → EXPIRED` (job de retención, actor SYSTEM). `false` si no corresponde (aún vigente o ya cerrado). */
  expire(at: Instant): boolean {
    if (this.props.status !== 'READY' || !this.isPastExpiry(at)) return false;
    this.next({ status: 'EXPIRED', objectKey: null, expiredAt: at.toString() });
    return true;
  }

  /**
   * `READY → DISCARDED` (el OWNER elimina el archivo antes de vencer). Idempotente sobre EXPIRED/DISCARDED (`false`);
   * en curso o fallido ⇒ `EXPORT_NOT_READY`.
   */
  discard(by: string, at: Instant): boolean {
    switch (this.props.status) {
      case 'EXPIRED':
      case 'DISCARDED':
        return false;
      case 'REQUESTED':
      case 'RUNNING':
      case 'FAILED':
        throw new DomainError('EXPORT_NOT_READY', 'only a finished export can be discarded');
      case 'READY':
        this.next({ status: 'DISCARDED', objectKey: null, discardedAt: at.toString(), discardedBy: by });
        return true;
    }
  }
}
