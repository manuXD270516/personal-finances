/**
 * Lógica pura de la portabilidad del workspace en la UI (openspec add-workspace-export, FR-IDENTITY-016/017):
 * tipos del contrato, estados y decisiones sin React para poder probarlas sin DOM.
 */

export type ExportStatus = 'REQUESTED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED' | 'DISCARDED';
export type ImportStatus = 'RECEIVED' | 'VALIDATING' | 'IMPORTING' | 'VERIFYING' | 'SUCCEEDED' | 'FAILED';

/** `WorkspaceExport` del contrato. */
export interface WorkspaceExportView {
  readonly id: string;
  readonly workspaceId: string;
  readonly status: ExportStatus;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly expiresAt: string | null;
  readonly errorCode: string | null;
}

/** `WorkspaceImport` del contrato. */
export interface WorkspaceImportView {
  readonly id: string;
  readonly status: ImportStatus;
  readonly workspaceId: string | null;
  readonly sizeBytes: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly errorCode: string | null;
}

/** Tamaño máximo del archivo a importar (`WORKSPACE_IMPORT_MAX_BYTES`, 200 MB): la UI avisa antes de subir. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export const POLL_MS = 2000;

export const exportInProgress = (e: Pick<WorkspaceExportView, 'status'>): boolean =>
  e.status === 'REQUESTED' || e.status === 'RUNNING';

export const importInProgress = (i: Pick<WorkspaceImportView, 'status'> | null | undefined): boolean =>
  i !== null && i !== undefined && i.status !== 'SUCCEEDED' && i.status !== 'FAILED';

/** Solo un export terminado y no vencido se puede descargar o eliminar. */
export const canDownload = (e: Pick<WorkspaceExportView, 'status'>): boolean => e.status === 'READY';

/** Pasos del progreso de una importación (1..4), para la barra. */
export const IMPORT_STEPS: readonly ImportStatus[] = ['RECEIVED', 'VALIDATING', 'IMPORTING', 'VERIFYING'];
export const importStep = (s: ImportStatus): number => {
  if (s === 'SUCCEEDED') return IMPORT_STEPS.length;
  const i = IMPORT_STEPS.indexOf(s);
  return i < 0 ? 0 : i + 1;
};

/** El problema pide volver a autenticarse: la UI ofrece reautenticar, nunca reintenta a ciegas. */
export const needsReauth = (problem: { readonly code?: string } | undefined): boolean =>
  problem?.code === 'REAUTHENTICATION_REQUIRED';

/** URL del BFF que fuerza credenciales de nuevo y regresa a la pantalla (`prompt=login`, `max_age=0`). */
export const reauthUrl = (returnTo: string): string =>
  `/api/bff/auth/login?reauth=1&returnTo=${encodeURIComponent(returnTo)}`;

/** Nombre de archivo del adjunto (`Content-Disposition: attachment; filename="…"`) o uno por defecto. */
export function filenameFrom(disposition: string | null, fallback: string): string {
  const m = disposition ? /filename="([A-Za-z0-9][A-Za-z0-9._-]*)"/u.exec(disposition) : null;
  return m?.[1] ?? fallback;
}

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
};

/** Validación local previa a la subida (la API vuelve a validar todo). */
export function checkImportFile(file: {
  readonly name: string;
  readonly size: number;
}): 'ok' | 'tooLarge' | 'empty' | 'notZip' {
  if (file.size === 0) return 'empty';
  if (file.size > MAX_IMPORT_BYTES) return 'tooLarge';
  if (!file.name.toLowerCase().endsWith('.zip')) return 'notZip';
  return 'ok';
}
