/**
 * @pf/shared-kernel — tipos y value objects compartidos por TODOS los contextos (ADR-0003).
 *
 * Vacío a propósito en `bootstrap-platform-foundation`: el primer contenido real (Money con
 * decimal.js, DomainError, identificadores) llega con el change de Phase 1 que lo especifica.
 * Regla: sin dependencias de frameworks ni de I/O (lo verificará dependency-cruiser).
 */
export const SHARED_KERNEL_VERSION = '0.0.0';
