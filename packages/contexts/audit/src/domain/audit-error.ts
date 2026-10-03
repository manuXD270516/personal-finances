/**
 * Error interno de AUDIT (no de contrato): un registro que viola sus invariantes o una escritura fuera de la unidad de
 * trabajo es un defecto del llamador, nunca un error de cliente. La API lo traduce a 500 `INTERNAL_ERROR` y la unidad
 * de trabajo hace rollback del comando completo (INV-029).
 */
export type AuditErrorCode =
  'AUDIT_OUTSIDE_UNIT_OF_WORK' | 'AUDIT_INVALID_RECORD' | 'AUDIT_ACTOR_MISSING' | 'AUDIT_INVALID_VALUE';

export class AuditError extends Error {
  override readonly name = 'AuditError';
  constructor(
    readonly code: AuditErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}
