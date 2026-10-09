import { DomainError, type Instant } from '@pf/shared-kernel';

/**
 * Agregado `WorkspaceImport` (openspec add-workspace-export, design § Capas y decisiones 8-11):
 * `RECEIVED → VALIDATING → IMPORTING → VERIFYING → SUCCEEDED | FAILED`. La importación SIEMPRE crea un workspace nuevo
 * (`targetWorkspaceId` solo existe en `SUCCEEDED`) y nunca escribe en uno existente. Una importación en curso por usuario.
 */
export type ImportStatus = 'RECEIVED' | 'VALIDATING' | 'IMPORTING' | 'VERIFYING' | 'SUCCEEDED' | 'FAILED';

export const IMPORT_IN_PROGRESS: readonly ImportStatus[] = [
  'RECEIVED',
  'VALIDATING',
  'IMPORTING',
  'VERIFYING',
];

const ORDER: readonly ImportStatus[] = ['RECEIVED', 'VALIDATING', 'IMPORTING', 'VERIFYING', 'SUCCEEDED'];

export interface ImportFailure {
  readonly code: string;
  readonly message: string;
}

export interface WorkspaceImportProps {
  readonly id: string;
  readonly requestedBy: string;
  readonly status: ImportStatus;
  readonly objectKey: string | null;
  readonly keyId: string | null;
  readonly wrappedKey: Uint8Array | null;
  readonly sizeBytes: number;
  readonly sourceWorkspaceId: string;
  readonly sourceExportedAt: string;
  readonly formatVersion: number;
  readonly targetWorkspaceId: string | null;
  readonly report: Readonly<Record<string, unknown>>;
  readonly error: ImportFailure | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export class WorkspaceImport {
  private constructor(private props: WorkspaceImportProps) {}

  static receive(input: {
    readonly id: string;
    readonly requestedBy: string;
    readonly objectKey: string;
    readonly keyId: string;
    readonly wrappedKey: Uint8Array;
    readonly sizeBytes: number;
    readonly sourceWorkspaceId: string;
    readonly sourceExportedAt: string;
    readonly formatVersion: number;
    readonly at: Instant;
  }): WorkspaceImport {
    return new WorkspaceImport({
      id: input.id,
      requestedBy: input.requestedBy,
      status: 'RECEIVED',
      objectKey: input.objectKey,
      keyId: input.keyId,
      wrappedKey: input.wrappedKey,
      sizeBytes: input.sizeBytes,
      sourceWorkspaceId: input.sourceWorkspaceId,
      sourceExportedAt: input.sourceExportedAt,
      formatVersion: input.formatVersion,
      targetWorkspaceId: null,
      report: {},
      error: null,
      createdAt: input.at.toString(),
      completedAt: null,
    });
  }

  static restore(props: WorkspaceImportProps): WorkspaceImport {
    return new WorkspaceImport({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get status(): ImportStatus {
    return this.props.status;
  }
  get inProgress(): boolean {
    return IMPORT_IN_PROGRESS.includes(this.props.status);
  }

  snapshot(): WorkspaceImportProps {
    return { ...this.props };
  }

  /** Avanza un paso del camino feliz (`RECEIVED → VALIDATING → IMPORTING → VERIFYING`). */
  advance(to: 'VALIDATING' | 'IMPORTING' | 'VERIFYING'): void {
    const from = ORDER.indexOf(this.props.status);
    if (from < 0 || ORDER.indexOf(to) !== from + 1) {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        `import cannot go from ${this.props.status} to ${to}`,
      );
    }
    this.props = { ...this.props, status: to };
  }

  /** `VERIFYING → SUCCEEDED`: el workspace nuevo ya es visible; el archivo subido deja de existir. */
  succeed(targetWorkspaceId: string, report: Readonly<Record<string, unknown>>, at: Instant): void {
    if (this.props.status !== 'VERIFYING') {
      throw new DomainError('INVALID_STATUS_TRANSITION', `import cannot succeed from ${this.props.status}`);
    }
    this.props = {
      ...this.props,
      status: 'SUCCEEDED',
      targetWorkspaceId,
      report,
      objectKey: null,
      completedAt: at.toString(),
    };
  }

  /** Cualquier paso en curso → `FAILED` (sin workspace destino; el rollback de la transacción no deja datos). */
  fail(error: ImportFailure, at: Instant): void {
    if (!this.inProgress) {
      throw new DomainError('INVALID_STATUS_TRANSITION', `import cannot fail from ${this.props.status}`);
    }
    this.props = { ...this.props, status: 'FAILED', error, objectKey: null, completedAt: at.toString() };
  }
}
