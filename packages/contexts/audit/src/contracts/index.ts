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
  /**
   * Id del registro (UUIDv7). Opcional: lo fija `LifecyclePort` para que el registro de transición referencie su
   * `audit_log_id` (add-lifecycle-timeline); por defecto lo genera AUDIT.
   */
  readonly id?: string;
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

// ───────────────────────────────────────────── add-lifecycle-timeline (docs/31 D37)

/**
 * Tipos de agregado con máquina de estados declarada (docs/31 D37; catálogos de CLASSIFICATION: D52; periodo
 * financiero de PLANNING: openspec add-financial-periods, Phase 2; sesión de reconciliación de TRANSACTIONS:
 * openspec add-reconciliation, Phase 2).
 */
export const LIFECYCLE_AGGREGATE_TYPES = [
  'Transaction',
  'Account',
  'ExchangeRate',
  'Category',
  'Counterparty',
  'FinancialPeriod',
  'Reconciliation',
] as const;
export type LifecycleAggregateType = (typeof LIFECYCLE_AGGREGATE_TYPES)[number];

/** Definición de una máquina de estados (dato puro; `from: []` = creación). Contrato `LifecycleMachine`. */
export interface LifecycleMachineDto {
  readonly aggregateType: string;
  readonly machineVersion: number;
  readonly states: readonly { readonly code: string; readonly terminal: boolean }[];
  readonly transitions: readonly {
    readonly code: string;
    readonly from: readonly string[];
    readonly to: readonly string[];
    readonly guard: string;
    readonly events: readonly string[];
  }[];
}

/** Evento publicado por un paso del flujo (`eventType` con versión: `transactions.TransactionPosted.v1`). */
export interface LifecycleEventRefDto {
  readonly eventId: string;
  readonly eventType: string;
}

/** Asientos del ledger involucrados en un paso (`reversed` = revertido, `reversal` = su reversa, `posted` = nuevo). */
export interface LifecycleJournalEntriesDto {
  readonly reversed: string | null;
  readonly reversal: string | null;
  readonly posted: string | null;
}

/** Referencias a detalles por revisión (p. ej. `conversionRevision`, `supersededByRateId`, `supersedesRateId`). */
export type LifecycleDetailRefsDto = Readonly<Record<string, string | number>>;

interface LifecycleStepBase {
  /** Por defecto, el agregado de la entrada de auditoría (una corrección de tasa también mueve la tasa original). */
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  /** Por defecto, `aggregateVersion` de la entrada de auditoría. */
  readonly aggregateVersion?: number | null;
  readonly revisionFrom?: number | null;
  readonly revisionTo?: number | null;
  readonly events?: readonly LifecycleEventRefDto[];
}

/** Paso de estado validado por la máquina del contexto dueño. */
export interface LifecycleTransitionInput extends LifecycleStepBase {
  readonly kind: 'TRANSITION';
  readonly transition: string;
  /** `null` = creación (∅). */
  readonly fromState: string | null;
  readonly toState: string;
  readonly machineVersion: number;
  readonly journalEntries?: Partial<LifecycleJournalEntriesDto>;
  readonly detailRefs?: LifecycleDetailRefsDto;
  /** Por defecto, el `reason` de la entrada de auditoría. */
  readonly reason?: string | null;
}

/** Cambio descriptivo (sin cambio de estado ni de ledger): solo los nombres de los campos cambiados. */
export interface LifecycleAnnotationInput extends LifecycleStepBase {
  readonly kind: 'ANNOTATION';
  readonly changedFields: readonly string[];
  /** Referencias a otros agregados (UUID o entero), p. ej. la sesión que cotejó una transacción (add-reconciliation). */
  readonly detailRefs?: LifecycleDetailRefsDto;
}

export type LifecycleStepInput = LifecycleTransitionInput | LifecycleAnnotationInput;

/**
 * Puerto síncrono del recorrido (add-lifecycle-timeline decisión 5; INV-029): escribe la entrada de auditoría y, a
 * continuación, sus pasos (transiciones o anotaciones) en `audit.lifecycle_transition`, TODO en la unidad de trabajo del
 * comando (falla fuera de ella con `AUDIT_OUTSIDE_UNIT_OF_WORK`). Si un paso no puede escribirse, el comando completo
 * hace rollback. Reemplaza a `AuditPort.append` en los comandos que cambian estado o editan un agregado con máquina.
 */
export interface LifecyclePort {
  record(entry: AuditEntry, steps: readonly LifecycleStepInput[]): Promise<void>;
}

export interface LifecycleActorDto {
  readonly type: 'USER' | 'SYSTEM' | 'WORKER';
  /** `userId` o identificador del proceso. */
  readonly id: string;
  readonly displayName: string | null;
}

export interface LifecycleTransitionDto {
  readonly sequence: number;
  readonly kind: 'TRANSITION';
  readonly transition: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly machineVersion: number;
  readonly occurredAt: string;
  readonly actor: LifecycleActorDto;
  readonly origin: AuditOriginDto;
  readonly reason: string | null;
  readonly revisionFrom: number | null;
  readonly revisionTo: number | null;
  readonly aggregateVersion: number | null;
  readonly journalEntries: LifecycleJournalEntriesDto;
  readonly detailRefs: LifecycleDetailRefsDto;
  readonly events: readonly string[];
  readonly auditLogId: string | null;
  readonly derived: boolean;
}

export interface LifecycleAnnotationDto {
  readonly sequence: number;
  readonly kind: 'ANNOTATION';
  readonly occurredAt: string;
  readonly actor: LifecycleActorDto;
  readonly origin: AuditOriginDto;
  readonly changedFields: readonly string[];
  /** Referencias de la anotación (aditivo, add-reconciliation); `{}` si no tiene. */
  readonly detailRefs?: LifecycleDetailRefsDto;
  readonly revisionFrom: number | null;
  readonly revisionTo: number | null;
  readonly aggregateVersion: number | null;
  readonly events: readonly string[];
  readonly auditLogId: string | null;
  readonly derived: boolean;
}

export type LifecycleItemDto = LifecycleTransitionDto | LifecycleAnnotationDto;

/** Recorrido de un agregado (contrato `Lifecycle`, sin enriquecer: el contexto dueño agrega montos por revisión). */
export interface LifecycleDto {
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Estado actual del agregado (lo aporta el contexto dueño; fuente de verdad). */
  readonly currentState: string | null;
  /** Estados visitados en orden (destino de cada transición). */
  readonly path: readonly string[];
  /** `false` si el recorrido no arranca en una creación (historia previa sin evidencia, FR-AUDIT-012). */
  readonly historyComplete: boolean;
  readonly machine: LifecycleMachineDto;
  readonly items: readonly LifecycleItemDto[];
}

/**
 * Consulta `GetLifecycle` (decisión 7). La invoca el contexto dueño del agregado DESPUÉS de verificar que el usuario
 * puede verlo (404 idéntico a inexistente si es de otro workspace); las filas de otros workspaces nunca aparecen (RLS).
 */
export interface LifecycleQuery {
  lifecycleOf(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly aggregateType: LifecycleAggregateType;
    readonly aggregateId: string;
    readonly currentState: string | null;
  }): Promise<LifecycleDto>;
  machineOf(aggregateType: LifecycleAggregateType): LifecycleMachineDto;
}

/** Tokens de inyección (Nest) de los puertos públicos. */
export const AUDIT_PORT = Symbol.for('pf.audit.AuditPort');
export const AUDIT_HISTORY_QUERY = Symbol.for('pf.audit.AuditHistoryQuery');
export const LIFECYCLE_PORT = Symbol.for('pf.audit.LifecyclePort');
export const LIFECYCLE_QUERY = Symbol.for('pf.audit.LifecycleQuery');

// ───────────────────────────────────────────── exportación del recorrido (docs/31 D52)

/** Formatos de descarga del recorrido (`GET …/lifecycle/export?format=`). */
export const LIFECYCLE_EXPORT_FORMATS = ['csv', 'pdf'] as const;
export type LifecycleExportFormat = (typeof LIFECYCLE_EXPORT_FORMATS)[number];

/** Monto de una revisión tal como lo publica el contrato (`Money`: decimal string + moneda, sin conversiones). */
export interface LifecycleMoneyDto {
  readonly amount: string;
  readonly currency: string;
}

/** Monto (y comisión) de cada revisión de una transacción; solo lo aporta TRANSACTIONS. */
export interface LifecycleRevisionAmountDto {
  readonly revision: number;
  readonly amount: LifecycleMoneyDto;
  readonly fee: LifecycleMoneyDto | null;
}

/** Recorrido ya compuesto por el contexto dueño (mismo contenido que su `GET …/lifecycle`). */
export interface LifecycleExportSource {
  readonly lifecycle: LifecycleDto;
  /** Nombre o descripción visible del elemento (nombre de la cuenta, categoría o contraparte; descripción). */
  readonly label?: string | null;
  readonly revisions?: readonly LifecycleRevisionAmountDto[];
}

/**
 * Carga del recorrido de UN tipo de agregado por su contexto dueño: verifica que el agregado existe en el workspace
 * (404 idéntico a inexistente si es de otro) y devuelve el mismo recorrido que su consulta HTTP. La aporta el
 * composition root desde los runtimes de cada contexto.
 */
export type LifecycleExportLoader = (input: {
  readonly userId: string;
  readonly workspaceId: string;
  readonly aggregateId: string;
}) => Promise<LifecycleExportSource>;

export type LifecycleExportLoaders = Readonly<Partial<Record<LifecycleAggregateType, LifecycleExportLoader>>>;

/** Allow-list de auditoría de la exportación del recorrido (evento auditado, docs/12 §13.2). */
export const LIFECYCLE_EXPORT_AUDIT_POLICY = {
  LifecycleExport: { aggregateType: 'plain', format: 'plain' },
} as const satisfies AuditFieldPoliciesDto;
