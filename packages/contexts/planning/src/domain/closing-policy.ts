import { DomainError } from '@pf/shared-kernel';

/** Ítems del checklist de cierre (openspec add-month-closing, design.md decisión 1 y 17). */
export const CHECKLIST_ITEM_KINDS = [
  'PENDING_TRANSACTIONS',
  'UNRECONCILED_ACCOUNTS',
  'UNRESOLVED_DUPLICATES',
  'UNCATEGORIZED',
  'UNRESOLVED_RECURRING',
  'RECONCILED_WITHOUT_STATEMENT',
] as const;
export type ChecklistItemKind = (typeof CHECKLIST_ITEM_KINDS)[number];

/** Ítems cuya severidad configura la política (el informativo de conciliadas sin extracto NO forma parte, decisión 17). */
export const POLICY_ITEM_KINDS = [
  'PENDING_TRANSACTIONS',
  'UNRECONCILED_ACCOUNTS',
  'UNRESOLVED_DUPLICATES',
  'UNCATEGORIZED',
  'UNRESOLVED_RECURRING',
] as const;
export type PolicyItemKind = (typeof POLICY_ITEM_KINDS)[number];

export type PolicySeverity = 'BLOCKING' | 'WARNING';
/** `INFO` solo para `RECONCILED_WITHOUT_STATEMENT`: nunca bloquea ni exige reconocimiento. */
export type ChecklistSeverity = PolicySeverity | 'INFO';

export type PolicySeverities = Readonly<Record<PolicyItemKind, PolicySeverity>>;

/** Por defecto bloquean pendientes y cuentas sin conciliar (docs/01 pregunta 5; docs/33 D66). */
export const DEFAULT_SEVERITIES: PolicySeverities = {
  PENDING_TRANSACTIONS: 'BLOCKING',
  UNRECONCILED_ACCOUNTS: 'BLOCKING',
  UNRESOLVED_DUPLICATES: 'WARNING',
  UNCATEGORIZED: 'WARNING',
  UNRESOLVED_RECURRING: 'WARNING',
};

export interface ClosingPolicyState {
  readonly workspaceId: string;
  readonly severities: PolicySeverities;
  /** Versión del ETag (≥ 1); la política por defecto (sin fila) es la versión 1 y se persiste al primer cambio. */
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export interface PolicyChange {
  readonly kind: PolicyItemKind;
  readonly before: PolicySeverity;
  readonly after: PolicySeverity;
}

const isSeverity = (v: unknown): v is PolicySeverity => v === 'BLOCKING' || v === 'WARNING';

/** AR `ClosingPolicy` (una por workspace; ausencia = valores por defecto). Solo el OWNER la cambia (rol en el guard HTTP). */
export class ClosingPolicy {
  private constructor(
    private state: ClosingPolicyState,
    readonly persistedVersion: number,
  ) {}

  static defaults(workspaceId: string): ClosingPolicy {
    return new ClosingPolicy(
      { workspaceId, severities: DEFAULT_SEVERITIES, version: 1, updatedAt: null, updatedBy: null },
      0,
    );
  }

  static restore(state: ClosingPolicyState): ClosingPolicy {
    return new ClosingPolicy({ ...state }, state.version);
  }

  get snapshot(): ClosingPolicyState {
    return { ...this.state };
  }
  get severities(): PolicySeverities {
    return this.state.severities;
  }
  get version(): number {
    return this.state.version;
  }

  /**
   * Cambia las severidades: las cinco claves son obligatorias y cada valor `BLOCKING|WARNING` (`VALIDATION_FAILED`).
   * Devuelve los ítems que cambiaron (para la auditoría `before/after`).
   */
  update(input: Readonly<Record<string, unknown>>, actorId: string | null, at: string): PolicyChange[] {
    const next: Record<PolicyItemKind, PolicySeverity> = { ...this.state.severities };
    for (const kind of POLICY_ITEM_KINDS) {
      const value = input[kind];
      if (!isSeverity(value)) {
        throw new DomainError('VALIDATION_FAILED', `${kind} must be BLOCKING or WARNING`).at(
          `/severities/${kind}`,
        );
      }
      next[kind] = value;
    }
    const extra = Object.keys(input).find((k) => !(POLICY_ITEM_KINDS as readonly string[]).includes(k));
    if (extra !== undefined) {
      throw new DomainError('VALIDATION_FAILED', `unknown policy item ${extra}`).at(`/severities/${extra}`);
    }
    const changes = POLICY_ITEM_KINDS.filter((k) => next[k] !== this.state.severities[k]).map((kind) => ({
      kind,
      before: this.state.severities[kind],
      after: next[kind],
    }));
    this.state = {
      ...this.state,
      severities: next,
      version: this.state.version + 1,
      updatedAt: at,
      updatedBy: actorId,
    };
    return changes;
  }
}
