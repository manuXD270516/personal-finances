/**
 * API pública de `@pf/audit` (openspec add-audit-trail): el puerto síncrono `AuditPort` que todo comando mutante
 * invoca DENTRO de su unidad de trabajo, la consulta de historial por entidad (para vistas como el historial de una
 * transacción, D28) y los tipos de las políticas de redacción que cada contexto declara para sus agregados.
 * Hoja: no importa capas internas.
 */
export const AUDIT_CONTEXT = 'audit' as const;

export type AuditOriginDto = 'ui' | 'api' | 'import' | 'rule' | 'recurring' | 'system';

export type AuditActorDto =
  | { readonly type: 'USER'; readonly userId: string }
  | { readonly type: 'SYSTEM' | 'WORKER'; readonly process: string };

/** Cambio campo a campo; los montos como `Money` del shared-kernel o `{amount: "120.00", currency: "BOB"}`. */
export interface AuditChangeInput {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

/** Lo que aporta el comando; el resto (instante, correlación, IP, user agent…) lo completa AUDIT. */
export interface AuditEntry {
  readonly workspaceId: string;
  /** `<context>.<aggregate>.<verbo-en-pasado>`, p. ej. `transactions.transaction.voided`. */
  readonly action: string;
  /** PascalCase, p. ej. `Transaction`. */
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Versión resultante del agregado (null si el agregado no se versiona, p. ej. una sesión). */
  readonly aggregateVersion?: number | null;
  /** Se filtran por la allow-list del agregado: lo no listado se omite. */
  readonly changes?: readonly AuditChangeInput[];
  /** Obligatorio en los comandos que lo exigen (anular, reabrir, revertir). */
  readonly reason?: string | null;
  /** Por defecto, el actor del contexto de la petición/job. */
  readonly actor?: AuditActorDto;
  /** Por defecto, el origen del contexto de la petición/job. */
  readonly origin?: AuditOriginDto;
}

/**
 * Puerto síncrono de auditoría (INV-029, NFR-DATA-007). `append` escribe en la MISMA transacción que la mutación y
 * falla (`AUDIT_OUTSIDE_UNIT_OF_WORK`) si no hay unidad de trabajo activa: si la auditoría falla, el comando completo
 * hace rollback. Se invoca al final del caso de uso, después de validar (un comando rechazado no deja registro).
 */
export interface AuditPort {
  append(entry: AuditEntry): Promise<void>;
}

/** Regla de un campo permitido (`plain`, `money` exacto o `last4` enmascarado). */
export type AuditFieldRuleDto = 'plain' | 'money' | 'last4';
/** Allow-list por tipo de agregado que cada contexto aporta en el composition root. */
export type AuditFieldPoliciesDto = Readonly<Record<string, Readonly<Record<string, AuditFieldRuleDto>>>>;

/** Entrada del historial tal como se expone (`AuditLogEntry` del contrato OpenAPI). */
export interface AuditLogEntryDto {
  readonly id: string;
  readonly occurredAt: string;
  readonly actor: {
    readonly type: 'USER' | 'SYSTEM' | 'WORKER';
    readonly userId: string | null;
    readonly process: string | null;
  };
  readonly action: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number | null;
  readonly changes: readonly { readonly field: string; readonly before: unknown; readonly after: unknown }[];
  readonly reason: string | null;
  readonly correlationId: string;
  readonly origin: AuditOriginDto;
  readonly userAgent: string | null;
}

/** Posición keyset de una página (instante + id). */
export interface AuditPagePosition {
  readonly occurredAt: string;
  readonly id: string;
}

/**
 * Historial cronológico de un conjunto de entidades de un workspace (p. ej. una transacción, sus splits y su asiento:
 * `getTransactionHistory`, visible para VIEWER, D28). Lo consume el contexto dueño de la vista, que antes verifica
 * que el usuario puede ver la entidad; las filas de otros workspaces nunca aparecen (RLS).
 */
export interface AuditHistoryQuery {
  historyOf(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly entities: readonly { readonly aggregateType: string; readonly aggregateId: string }[];
    readonly after?: AuditPagePosition;
    readonly limit: number;
  }): Promise<readonly AuditLogEntryDto[]>;
}

/** Tokens de inyección (Nest) de los puertos públicos. */
export const AUDIT_PORT = Symbol.for('pf.audit.AuditPort');
export const AUDIT_HISTORY_QUERY = Symbol.for('pf.audit.AuditHistoryQuery');
