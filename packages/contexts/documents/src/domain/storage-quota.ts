import { DomainError } from '@pf/shared-kernel';

/**
 * Cuota de almacenamiento por workspace (design decisión 11; NFR-SEC-011/012). Contadores desnormalizados que se
 * actualizan en la misma unidad de trabajo que la transición del documento:
 *
 *   solicitar    → reserva (`reserved += size`, `pending += 1`)
 *   disponible   → `reserved -= size`, `used += size`, `pending -= 1`
 *   rechazado    → `reserved -= size`, `pending -= 1`
 *   eliminado    → `used -= size`   (archivar no cambia nada)
 *
 * Las funciones son puras: devuelven los contadores nuevos o lanzan el error de dominio de la regla.
 */
export interface StorageUsage {
  readonly usedBytes: number;
  readonly reservedBytes: number;
  readonly pendingUploads: number;
}

export interface QuotaLimits {
  readonly quotaBytes: number;
  readonly maxPendingUploads: number;
}

export const EMPTY_USAGE: StorageUsage = { usedBytes: 0, reservedBytes: 0, pendingUploads: 0 };

export const DEFAULT_QUOTA_LIMITS: QuotaLimits = { quotaBytes: 5_368_709_120, maxPendingUploads: 20 };

export function reserve(usage: StorageUsage, sizeBytes: number, limits: QuotaLimits): StorageUsage {
  if (usage.pendingUploads >= limits.maxPendingUploads) {
    throw new DomainError('DOCUMENT_PENDING_UPLOADS_EXCEEDED', 'too many pending uploads', {
      details: { maxPendingUploads: limits.maxPendingUploads },
    });
  }
  if (usage.usedBytes + usage.reservedBytes + sizeBytes > limits.quotaBytes) {
    throw new DomainError('DOCUMENT_QUOTA_EXCEEDED', 'workspace document quota exceeded', {
      details: {
        quotaBytes: limits.quotaBytes,
        usedBytes: usage.usedBytes + usage.reservedBytes,
        requestedBytes: sizeBytes,
      },
    });
  }
  return {
    usedBytes: usage.usedBytes,
    reservedBytes: usage.reservedBytes + sizeBytes,
    pendingUploads: usage.pendingUploads + 1,
  };
}

const nonNegative = (n: number): number => Math.max(0, n);

/** La reserva pasa a uso (el documento quedó disponible). */
export function promote(usage: StorageUsage, sizeBytes: number): StorageUsage {
  return {
    usedBytes: usage.usedBytes + sizeBytes,
    reservedBytes: nonNegative(usage.reservedBytes - sizeBytes),
    pendingUploads: nonNegative(usage.pendingUploads - 1),
  };
}

/** Se libera la reserva (rechazado o vencido). */
export function release(usage: StorageUsage, sizeBytes: number): StorageUsage {
  return {
    usedBytes: usage.usedBytes,
    reservedBytes: nonNegative(usage.reservedBytes - sizeBytes),
    pendingUploads: nonNegative(usage.pendingUploads - 1),
  };
}

/** Se libera el uso (documento eliminado). */
export function free(usage: StorageUsage, sizeBytes: number): StorageUsage {
  return { ...usage, usedBytes: nonNegative(usage.usedBytes - sizeBytes) };
}

/** Límite de adjuntos por elemento (`DOCUMENT_MAX_LINKS_PER_TARGET`, 20 por defecto; FR-DOCUMENTS-003). */
export function assertLinkCapacity(currentLinks: number, maxLinks: number): void {
  if (currentLinks >= maxLinks) {
    throw new DomainError(
      'ATTACHMENT_LIMIT_EXCEEDED',
      'the target already has the maximum number of attachments',
      {
        details: { maxLinksPerTarget: maxLinks },
      },
    );
  }
}
