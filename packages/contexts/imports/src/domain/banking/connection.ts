import { DomainError, LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/**
 * Agregado `Connection` (openspec add-banking-providers decisión 4; docs/13 §2): enlace de un workspace con un
 * proveedor, el mapeo de cada activo a una cuenta de la misma moneda y el cursor de la sincronización incremental.
 * Las credenciales NO son parte del agregado (`imports.connection_credential`, cifradas, solo las lee el worker).
 *
 *   ∅ ─CREATE─▶ PENDING_VERIFICATION | ACTIVE (archivo, sin credencial) | NEEDS_CREDENTIAL (import del workspace)
 *   PENDING_VERIFICATION ─VERIFY_OK─▶ ACTIVE        ─REJECT─▶ REJECTED (no es solo lectura; credencial destruida)
 *   ACTIVE ─FLAG_ATTENTION─▶ NEEDS_ATTENTION (auth rechazada, permisos ampliados, clave maestra ausente)
 *   NEEDS_ATTENTION | REJECTED | NEEDS_CREDENTIAL | ACTIVE ─REPLACE_CREDENTIAL─▶ PENDING_VERIFICATION
 *   cualquier estado no terminal ─REVOKE─▶ REVOKED (terminal; credencial destruida)
 */
export const CONNECTION_AGGREGATE = 'ImportConnection';

export const CONNECTION_STATUSES = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'NEEDS_ATTENTION',
  'REJECTED',
  'REVOKED',
  'NEEDS_CREDENTIAL',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type ConnectionTransition =
  'CREATE' | 'VERIFY_OK' | 'REJECT' | 'FLAG_ATTENTION' | 'REPLACE_CREDENTIAL' | 'REVOKE';
export type ConnectionTransitionRecord = StateTransition<ConnectionStatus, ConnectionTransition>;

export const CONNECTION_LIFECYCLE = LifecycleMachine.define({
  aggregateType: CONNECTION_AGGREGATE,
  machineVersion: 1,
  states: [
    { code: 'PENDING_VERIFICATION', terminal: false },
    { code: 'ACTIVE', terminal: false },
    { code: 'NEEDS_ATTENTION', terminal: false },
    { code: 'REJECTED', terminal: false },
    { code: 'NEEDS_CREDENTIAL', terminal: false },
    { code: 'REVOKED', terminal: true },
  ],
  transitions: [
    {
      code: 'CREATE',
      from: [],
      to: ['PENDING_VERIFICATION', 'ACTIVE', 'NEEDS_CREDENTIAL'],
      guard: 'OWNER; proveedor disponible; mapeo con cuentas de la misma moneda',
      events: [],
    },
    {
      code: 'VERIFY_OK',
      from: ['PENDING_VERIFICATION'],
      to: ['ACTIVE'],
      guard: 'sistema: el proveedor confirmó que la credencial es de solo lectura',
      events: [],
    },
    {
      code: 'REJECT',
      from: ['PENDING_VERIFICATION'],
      to: ['REJECTED'],
      guard: 'sistema: la credencial permite operar, retirar o transferir; se destruye',
      events: [],
    },
    {
      code: 'FLAG_ATTENTION',
      from: ['PENDING_VERIFICATION', 'ACTIVE'],
      to: ['NEEDS_ATTENTION'],
      guard: 'sistema: credencial rechazada, permisos ampliados o clave maestra ausente',
      events: [],
    },
    {
      code: 'REPLACE_CREDENTIAL',
      from: ['ACTIVE', 'NEEDS_ATTENTION', 'REJECTED', 'NEEDS_CREDENTIAL'],
      to: ['PENDING_VERIFICATION'],
      guard: 'OWNER; se vuelve a verificar como al crear',
      events: [],
    },
    {
      code: 'REVOKE',
      from: ['PENDING_VERIFICATION', 'ACTIVE', 'NEEDS_ATTENTION', 'REJECTED', 'NEEDS_CREDENTIAL'],
      to: ['REVOKED'],
      guard: 'OWNER; destruye la credencial; conserva lo importado',
      events: [],
    },
  ],
});

export interface AssetMapping {
  readonly asset: string;
  readonly accountId: string;
}

export interface PendingSync {
  readonly jobId: string;
  /** Ventana pedida (fechas `YYYY-MM-DD` en la zona del workspace). */
  readonly from: string;
  readonly to: string;
  /** Cursor de paginación del proveedor, provisional hasta que el import termine. */
  readonly pageCursor: string | null;
  readonly pagesDone: number;
}

export interface ConnectionState {
  readonly id: string;
  readonly workspaceId: string;
  readonly providerId: string;
  readonly name: string;
  readonly status: ConnectionStatus;
  readonly assetMappings: readonly AssetMapping[];
  /** Cursor CONFIRMADO: fin (`YYYY-MM-DD`) de la última sincronización cuyo import terminó. */
  readonly syncCursor: string | null;
  readonly cursorConfirmedAt: string | null;
  readonly pendingSync: PendingSync | null;
  readonly retryNotBefore: string | null;
  readonly lastErrorCode: string | null;
  readonly lastSyncAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly revokedAt: string | null;
}

const NAME_MAX = 80;

const transition = (from: ConnectionStatus, to: ConnectionStatus) =>
  new DomainError('INVALID_STATUS_TRANSITION', `connection: ${from} → ${to} is not allowed`);

/** Nombre 1–80 y mapeo sin activos repetidos (la moneda de cada cuenta la valida el servicio). */
export function validateConnectionFields(name: string, mappings: readonly AssetMapping[]): void {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
    throw new DomainError('VALIDATION_FAILED', `the name must have 1 to ${NAME_MAX} characters`).at('/name');
  }
  const seen = new Set<string>();
  for (const [i, m] of mappings.entries()) {
    if (!/^[A-Z0-9]{1,20}$/.test(m.asset)) {
      throw new DomainError('VALIDATION_FAILED', 'the asset code is not valid').at(
        `/assetMappings/${i}/asset`,
      );
    }
    if (seen.has(m.asset)) {
      throw new DomainError('VALIDATION_FAILED', 'an asset is mapped twice').at(`/assetMappings/${i}/asset`);
    }
    seen.add(m.asset);
  }
}

export class Connection {
  private current: ConnectionState;
  private persisted: number;
  private transitionRecord: ConnectionTransitionRecord | null = null;
  private changed = new Set<string>();

  private constructor(state: ConnectionState, persistedVersion: number) {
    this.current = state;
    this.persisted = persistedVersion;
  }

  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly providerId: string;
    readonly name: string;
    readonly assetMappings: readonly AssetMapping[];
    readonly createdBy: string;
    readonly now: string;
    /** Archivo ⇒ `ACTIVE`; con credencial ⇒ `PENDING_VERIFICATION`; import del workspace ⇒ `NEEDS_CREDENTIAL`. */
    readonly initial: 'PENDING_VERIFICATION' | 'ACTIVE' | 'NEEDS_CREDENTIAL';
  }): Connection {
    validateConnectionFields(input.name, input.assetMappings);
    const c = new Connection(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        providerId: input.providerId,
        name: input.name.trim(),
        status: input.initial,
        assetMappings: input.assetMappings,
        syncCursor: null,
        cursorConfirmedAt: null,
        pendingSync: null,
        retryNotBefore: null,
        lastErrorCode: null,
        lastSyncAt: null,
        version: 1,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.createdBy,
        revokedAt: null,
      },
      0,
    );
    c.transitionRecord = { transition: 'CREATE', from: null, to: input.initial };
    return c;
  }

  static rehydrate(state: ConnectionState): Connection {
    return new Connection(state, state.version);
  }

  get state(): ConnectionState {
    return this.current;
  }

  get id(): string {
    return this.current.id;
  }

  get persistedVersion(): number {
    return this.persisted;
  }

  get lastTransition(): ConnectionTransitionRecord | null {
    return this.transitionRecord;
  }

  get changedFields(): readonly string[] {
    return [...this.changed];
  }

  markPersisted(): void {
    this.persisted = this.current.version;
  }

  private update(patch: Partial<ConnectionState>, now: string): void {
    this.changed = new Set(Object.keys(patch));
    this.transitionRecord = null;
    this.current = { ...this.current, ...patch, updatedAt: now, version: this.current.version + 1 };
  }

  private move(
    code: ConnectionTransition,
    to: ConnectionStatus,
    patch: Partial<ConnectionState>,
    now: string,
  ): void {
    const def = CONNECTION_LIFECYCLE.transitionDefinition(code);
    const from = this.current.status;
    if (!def || !def.from.includes(from) || !def.to.includes(to)) throw transition(from, to);
    this.update({ ...patch, status: to }, now);
    this.changed.add('status');
    this.transitionRecord = { transition: code, from, to };
  }

  /** Un proveedor de archivo no tiene credencial: sirve para subir historiales. */
  get isSyncable(): boolean {
    return this.current.status === 'ACTIVE';
  }

  /** El proveedor confirmó que la credencial es de solo lectura. */
  verified(now: string): void {
    this.move('VERIFY_OK', 'ACTIVE', { lastErrorCode: null }, now);
  }

  /** No es de solo lectura: la credencial se destruye aparte (misma unidad de trabajo). */
  rejected(code: string, now: string): void {
    this.move('REJECT', 'REJECTED', { lastErrorCode: code }, now);
  }

  needsAttention(code: string, now: string): void {
    this.move('FLAG_ATTENTION', 'NEEDS_ATTENTION', { lastErrorCode: code, pendingSync: null }, now);
  }

  credentialReplaced(now: string): void {
    this.move('REPLACE_CREDENTIAL', 'PENDING_VERIFICATION', { lastErrorCode: null }, now);
  }

  revoke(now: string): void {
    this.move('REVOKE', 'REVOKED', { revokedAt: now, pendingSync: null }, now);
  }

  rename(name: string, now: string): void {
    validateConnectionFields(name, this.current.assetMappings);
    this.guardNotRevoked();
    this.update({ name: name.trim() }, now);
  }

  remap(mappings: readonly AssetMapping[], now: string): void {
    validateConnectionFields(this.current.name, mappings);
    this.guardNotRevoked();
    this.update({ assetMappings: mappings }, now);
  }

  private guardNotRevoked(): void {
    if (this.current.status === 'REVOKED') throw transition('REVOKED', 'REVOKED');
  }

  // ───────────────────────────────────────────────────────────── sincronización

  /** Una sincronización requiere conexión activa; el rechazo del estado es `INVALID_STATUS_TRANSITION`. */
  assertCanSync(): void {
    if (this.current.status !== 'ACTIVE') throw transition(this.current.status, 'ACTIVE');
  }

  beginSync(
    input: { readonly jobId: string; readonly from: string; readonly to: string },
    now: string,
  ): void {
    this.assertCanSync();
    this.update(
      {
        pendingSync: { jobId: input.jobId, from: input.from, to: input.to, pageCursor: null, pagesDone: 0 },
        lastErrorCode: null,
      },
      now,
    );
  }

  /** Cursor provisional de la página escrita (reanudación tras una caída). */
  pageStaged(pageCursor: string | null, now: string): void {
    const p = this.current.pendingSync;
    if (!p) return;
    this.update({ pendingSync: { ...p, pageCursor, pagesDone: p.pagesDone + 1 } }, now);
  }

  /** Espera persistida ante un límite del proveedor. */
  waitUntil(retryNotBefore: string | null, now: string): void {
    this.update({ retryNotBefore }, now);
  }

  recordError(code: string | null, now: string): void {
    this.update({ lastErrorCode: code }, now);
  }

  /** El import terminó: el cursor confirmado avanza al fin de la ventana (nunca antes; cancelar no lo mueve). */
  confirmCursor(jobId: string, now: string): boolean {
    const p = this.current.pendingSync;
    if (!p || p.jobId !== jobId) return false;
    this.update(
      { syncCursor: p.to, cursorConfirmedAt: now, lastSyncAt: now, pendingSync: null, retryNotBefore: null },
      now,
    );
    return true;
  }

  /** El import se canceló, expiró o falló: el cursor confirmado queda como estaba. */
  abandonSync(jobId: string, now: string): boolean {
    const p = this.current.pendingSync;
    if (!p || p.jobId !== jobId) return false;
    this.update({ pendingSync: null }, now);
    return true;
  }
}
