/**
 * Lógica pura de los adjuntos (openspec add-document-attachments, tareas 6.1 y 6.2): tipos y límites que la UI valida
 * antes de subir (la API vuelve a validar todo), suma SHA-256 en el navegador, formato de tamaños y motivos de rechazo.
 */
export const ATTACHMENT_TARGET_TYPES = [
  'TRANSACTION',
  'CONVERSION',
  'LOAN',
  'SUBSCRIPTION',
  'ACCOUNT',
  'IMPORT_JOB',
  'MONTH_CLOSING',
] as const;
export type AttachmentTargetType = (typeof ATTACHMENT_TARGET_TYPES)[number];

export const DOCUMENT_PURPOSES = [
  'RECEIPT',
  'INVOICE',
  'STATEMENT',
  'CONTRACT',
  'IMPORT_SOURCE',
  'OTHER',
] as const;
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];

export const DOCUMENT_STATUS_FILTERS = ['AVAILABLE', 'CONTENT_PENDING', 'REJECTED', 'DELETED'] as const;

/** Extensión → tipo declarado (el navegador no informa un tipo para ofx, qfx, qif ni heic). */
const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  csv: 'text/csv',
  ofx: 'application/x-ofx',
  qfx: 'application/x-ofx',
  qif: 'application/qif',
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Límites por defecto de la API (15 MiB documentos; 20 MiB extractos a importar). */
export const MAX_BYTES = 15_728_640;
export const MAX_IMPORT_SOURCE_BYTES = 20_971_520;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Tipo declarado para la solicitud, o `null` si la extensión no está en la lista permitida. */
export function contentTypeOf(name: string): string | null {
  return TYPE_BY_EXTENSION[extensionOf(name)] ?? null;
}

export type FileCheck = 'OK' | 'EMPTY' | 'TYPE' | 'TOO_LARGE';

/** Validación previa a la subida (la API es la autoridad: esto solo evita subidas inútiles). */
export function checkFile(file: { name: string; size: number }, purpose: DocumentPurpose): FileCheck {
  if (file.size <= 0) return 'EMPTY';
  if (contentTypeOf(file.name) === null) return 'TYPE';
  return file.size > (purpose === 'IMPORT_SOURCE' ? MAX_IMPORT_SOURCE_BYTES : MAX_BYTES) ? 'TOO_LARGE' : 'OK';
}

/** SHA-256 en hexadecimal minúscula con `crypto.subtle` (el archivo, de hasta 25 MiB, cabe en memoria). */
export async function sha256Hex(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatBytes(bytes: number, locale = 'es-BO'): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 2 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

const KNOWN_REASONS = new Set([
  'UPLOAD_NOT_COMPLETED',
  'SIZE_MISMATCH',
  'CHECKSUM_MISMATCH',
  'TYPE_NOT_ALLOWED',
  'TYPE_MISMATCH',
  'ACTIVE_CONTENT',
  'ENCRYPTED_CONTENT',
  'MACROS_PRESENT',
  'ARCHIVE_LIMITS_EXCEEDED',
  'MALFORMED_CONTENT',
  'MALWARE_DETECTED',
]);

/** Clave del catálogo i18n del motivo de rechazo (conjunto abierto: un motivo desconocido cae en el genérico). */
export const reasonKey = (reason: string | null | undefined): string =>
  reason && KNOWN_REASONS.has(reason) ? `reasons.${reason}` : 'reasons.UNKNOWN';

export interface UploadInstructions {
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

/** Subida directa a la URL presignada con progreso (`XMLHttpRequest`: `fetch` no informa el avance de la subida). */
export function putWithProgress(
  upload: UploadInstructions,
  file: Blob,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0)
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT ${xhr.status}`));
    xhr.onerror = () => reject(new Error('PUT network error'));
    xhr.send(file);
  });
}

export interface DocumentLinkView {
  readonly id: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly createdAt: string;
}

export interface DocumentView {
  readonly id: string;
  readonly purpose: string;
  readonly status: string;
  readonly originalName: string;
  readonly sizeBytes: number;
  readonly detectedContentType: string | null;
  readonly rejectionReason: string | null;
  readonly availableAt: string | null;
  readonly archivedAt: string | null;
  readonly links: readonly DocumentLinkView[];
  readonly createdAt: string;
  readonly version: number;
}

export interface UsageView {
  readonly usedBytes: number;
  readonly reservedBytes: number;
  readonly quotaBytes: number;
  readonly pendingUploads: number;
  readonly maxPendingUploads: number;
}

/** Porcentaje de la cuota en uso (usado + reservado), de 0 a 100. */
export function quotaPercent(u: UsageView): number {
  return u.quotaBytes <= 0
    ? 0
    : Math.min(100, Math.round(((u.usedBytes + u.reservedBytes) / u.quotaBytes) * 100));
}

/** Ruta de la descarga por el BFF (siempre como adjunto; nunca una URL del almacenamiento). */
export const downloadPath = (bff: string, workspaceId: string, documentId: string): string =>
  `${bff}/workspaces/${workspaceId}/documents/${documentId}/download`;
