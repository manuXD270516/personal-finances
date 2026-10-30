import { DomainError } from '@pf/shared-kernel';
import { extensionOf, normalizeFileName } from './file-name.js';
import { DOCUMENT_PURPOSES, isOneOf, type DocumentFormat, type DocumentPurpose } from './types.js';

/**
 * Lista permitida extensión ↔ tipo declarado ↔ familia (FR-DOCUMENTS-002; design decisión 4). Todo lo demás
 * (SVG, HTML, ejecutables, comprimidos, XLSM, XLS) ⇒ `UPLOAD_TYPE_NOT_ALLOWED` (D323: XLS fuera).
 */
export interface FamilyDefinition {
  readonly format: DocumentFormat;
  /** Tipo canónico con el que se entrega la descarga. */
  readonly canonicalType: string;
  /** Tipos declarados aceptados para esa extensión (comparados en minúsculas y sin parámetros). */
  readonly declaredTypes: readonly string[];
}

const TEXT_ANY = ['text/plain', 'application/octet-stream'] as const;

export const EXTENSION_FAMILIES: Readonly<Record<string, FamilyDefinition>> = {
  pdf: { format: 'PDF', canonicalType: 'application/pdf', declaredTypes: ['application/pdf'] },
  png: { format: 'PNG', canonicalType: 'image/png', declaredTypes: ['image/png'] },
  jpg: { format: 'JPEG', canonicalType: 'image/jpeg', declaredTypes: ['image/jpeg'] },
  jpeg: { format: 'JPEG', canonicalType: 'image/jpeg', declaredTypes: ['image/jpeg'] },
  webp: { format: 'WEBP', canonicalType: 'image/webp', declaredTypes: ['image/webp'] },
  heic: { format: 'HEIC', canonicalType: 'image/heic', declaredTypes: ['image/heic', 'image/heif'] },
  csv: {
    format: 'CSV',
    canonicalType: 'text/csv',
    declaredTypes: ['text/csv', 'application/csv', 'application/vnd.ms-excel', ...TEXT_ANY],
  },
  ofx: {
    format: 'OFX',
    canonicalType: 'application/x-ofx',
    declaredTypes: ['application/x-ofx', 'application/ofx', ...TEXT_ANY],
  },
  qfx: {
    format: 'OFX',
    canonicalType: 'application/x-ofx',
    declaredTypes: ['application/x-ofx', 'application/ofx', 'application/vnd.intu.qfx', ...TEXT_ANY],
  },
  qif: {
    format: 'QIF',
    canonicalType: 'application/qif',
    declaredTypes: ['application/qif', 'application/x-qif', ...TEXT_ANY],
  },
  json: {
    format: 'JSON',
    canonicalType: 'application/json',
    declaredTypes: ['application/json', 'text/json'],
  },
  xlsx: {
    format: 'XLSX',
    canonicalType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    declaredTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
};

export const CANONICAL_TYPE_OF: Readonly<Record<DocumentFormat, string>> = Object.freeze(
  Object.fromEntries(Object.values(EXTENSION_FAMILIES).map((f) => [f.format, f.canonicalType])) as Record<
    DocumentFormat,
    string
  >,
);

/** Tope duro (25 MiB, D317): la configuración no puede superarlo. */
export const HARD_MAX_BYTES = 26_214_400;

export interface UploadLimits {
  /** Documentos (15 MiB por defecto). */
  readonly maxBytes: number;
  /** Extractos a importar (20 MiB por defecto). */
  readonly importSourceMaxBytes: number;
}

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = { maxBytes: 15_728_640, importSourceMaxBytes: 20_971_520 };

/** Valida los límites de configuración (falla al arrancar si superan el tope duro o no son enteros positivos). */
export function assertUploadLimits(limits: UploadLimits): UploadLimits {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD_MAX_BYTES) {
      throw new RangeError(`${name} debe ser un entero entre 1 y ${HARD_MAX_BYTES}`);
    }
  }
  return limits;
}

export function maxBytesFor(purpose: DocumentPurpose, limits: UploadLimits): number {
  return purpose === 'IMPORT_SOURCE' ? limits.importSourceMaxBytes : limits.maxBytes;
}

export interface DeclaredFile {
  /** Nombre normalizado (NFC, sin rutas ni controles, ≤ 255). */
  readonly fileName: string;
  readonly extension: string;
  readonly declaredContentType: string;
  readonly sizeBytes: number;
  /** SHA-256 en hexadecimal minúscula (64). */
  readonly sha256: string;
  readonly purpose: DocumentPurpose;
  readonly format: DocumentFormat;
  readonly canonicalType: string;
}

export interface DeclarationInput {
  readonly fileName: unknown;
  readonly contentType: unknown;
  readonly sizeBytes: unknown;
  readonly sha256: unknown;
  readonly purpose: unknown;
}

const SHA256_HEX = /^[0-9a-f]{64}$/u;

/**
 * Valida la declaración del archivo contra la política (extensión ↔ tipo ↔ familia, tamaño, suma, propósito).
 * Orden: forma (`VALIDATION_FAILED`), tipo (`UPLOAD_TYPE_NOT_ALLOWED`), tamaño (`UPLOAD_TOO_LARGE`).
 */
export function validateDeclaration(input: DeclarationInput, limits: UploadLimits): DeclaredFile {
  const violations: { pointer: string; code: string }[] = [];
  if (typeof input.fileName !== 'string' || input.fileName.length === 0 || input.fileName.length > 1000) {
    violations.push({ pointer: '/fileName', code: 'VALIDATION_FAILED' });
  }
  if (typeof input.contentType !== 'string' || input.contentType.length === 0) {
    violations.push({ pointer: '/contentType', code: 'VALIDATION_FAILED' });
  }
  if (typeof input.sizeBytes !== 'number' || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
    violations.push({ pointer: '/sizeBytes', code: 'VALIDATION_FAILED' });
  }
  if (typeof input.sha256 !== 'string' || !SHA256_HEX.test(input.sha256)) {
    violations.push({ pointer: '/sha256', code: 'VALIDATION_FAILED' });
  }
  if (!isOneOf(DOCUMENT_PURPOSES, input.purpose)) {
    violations.push({ pointer: '/purpose', code: 'VALIDATION_FAILED' });
  }
  const fileName = typeof input.fileName === 'string' ? normalizeFileName(input.fileName) : '';
  if (fileName.length === 0 && !violations.some((v) => v.pointer === '/fileName')) {
    violations.push({ pointer: '/fileName', code: 'VALIDATION_FAILED' });
  }
  if (violations.length > 0) {
    throw new DomainError('VALIDATION_FAILED', 'invalid upload declaration', { violations });
  }
  const sizeBytes = input.sizeBytes as number;
  const purpose = input.purpose as DocumentPurpose;
  const extension = extensionOf(fileName);
  const family = EXTENSION_FAMILIES[extension];
  const declared = (input.contentType as string).split(';')[0]!.trim().toLowerCase();
  if (!family || !family.declaredTypes.includes(declared)) {
    throw new DomainError('UPLOAD_TYPE_NOT_ALLOWED', 'file type is not allowed').at('/contentType');
  }
  if (sizeBytes > maxBytesFor(purpose, limits)) {
    throw new DomainError('UPLOAD_TOO_LARGE', 'file exceeds the maximum size for its purpose').at(
      '/sizeBytes',
    );
  }
  return {
    fileName,
    extension,
    declaredContentType: declared,
    sizeBytes,
    sha256: input.sha256 as string,
    purpose,
    format: family.format,
    canonicalType: family.canonicalType,
  };
}
