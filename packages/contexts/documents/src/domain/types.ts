/** Vocabulario del dominio DOCUMENTS (openspec add-document-attachments, design decisiones 4, 8 y 9). */

export const DOCUMENT_PURPOSES = [
  'RECEIPT',
  'INVOICE',
  'STATEMENT',
  'CONTRACT',
  'IMPORT_SOURCE',
  'OTHER',
] as const;
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];

export const DOCUMENT_STATUSES = [
  'PENDING_UPLOAD',
  'UPLOADED',
  'AVAILABLE',
  'REJECTED',
  'DELETED',
  'CONTENT_PENDING',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_FORMATS = [
  'PDF',
  'PNG',
  'JPEG',
  'WEBP',
  'HEIC',
  'CSV',
  'OFX',
  'QIF',
  'JSON',
  'XLSX',
] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/** Motivos de rechazo (enum abierto, no HTTP). */
export const REJECTION_REASONS = [
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
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

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

export type ScanStatus = 'NOT_SCANNED' | 'CLEAN';

/** Resultado de inspeccionar el contenido: aceptado con su formato o rechazado con motivo. */
export type InspectionVerdict =
  | { readonly ok: true; readonly format: DocumentFormat }
  | { readonly ok: false; readonly reason: RejectionReason };

export const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);
