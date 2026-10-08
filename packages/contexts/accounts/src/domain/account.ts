import { DomainError } from '@pf/shared-kernel';
import {
  ACCOUNT_LIFECYCLE,
  type AccountLifecycleStatus,
  type AccountTransition,
  type AccountTransitionRecord,
} from './account-lifecycle.js';
import {
  accountType,
  defaultLiquidityFor,
  liquidity as parseLiquidity,
  natureOf,
  type AccountNature,
  type AccountType,
  type Liquidity,
} from './account-type.js';

/** Estado derivado de `closedOn`/`archivedAt` (docs/31 D4): solo ACTIVE acepta movimientos (INV-026). */
export type AccountStatus = AccountLifecycleStatus;

/** Clase de moneda del catálogo `fx.currency` (la provee la aplicación). */
export type CurrencyKind = 'FIAT' | 'CRYPTO' | 'COMMODITY' | 'CUSTOM' | string;

const LAST4 = /^[A-Za-z0-9]{4}$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (pointer: string, message: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

/**
 * `MaskedAccountNumber` (design.md decisión 7): exactamente 4 caracteres alfanuméricos. El identificador completo
 * nunca llega al backend; más de 4 caracteres ⇒ `VALIDATION_FAILED` (TC-ACCOUNTS-MASK-001).
 */
export function maskedAccountNumber(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!LAST4.test(value)) throw invalid('/accountNumberLast4', 'accountNumberLast4 must be 4 alphanumerics');
  return value;
}

function accountName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 100) throw invalid('/name', 'name must have 1..100 characters');
  return name;
}

function optionalText(value: string | null | undefined, max: number, pointer: string): string | null {
  if (value === null || value === undefined) return null;
  if (value.length > max) throw invalid(pointer, `${pointer.slice(1)} exceeds ${max} characters`);
  return value;
}

/** Regla cripto (TC-ACCOUNTS-CRYPTO-001): una billetera cripto solo admite monedas `CRYPTO`. */
function assertCurrencyKind(type: AccountType, kind: CurrencyKind): void {
  if (type === 'CRYPTO_WALLET' && kind !== 'CRYPTO') {
    throw new DomainError(
      'ACCOUNT_CURRENCY_KIND_MISMATCH',
      `a CRYPTO_WALLET account requires a CRYPTO currency (got ${kind})`,
    ).at('/currency');
  }
}

/**
 * Valor de custom field de una cuenta (openspec add-custom-fields, FR-CLASSIFICATION-009): ya validado y normalizado
 * por CLASSIFICATION. `valueType` es la clase de almacenamiento (`SELECT` es `TEXT`; `NUMBER` y `DECIMAL` son `NUMBER`
 * con el string decimal canónico, nunca punto flotante). `key` es de solo lectura (derivada de la definición). No
 * afectan saldos ni movimientos.
 */
export interface AccountCustomFieldValue {
  readonly fieldId: string;
  readonly key: string;
  readonly valueType: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN';
  readonly value: string | boolean;
}

const sortedValues = (values: readonly AccountCustomFieldValue[] | undefined): AccountCustomFieldValue[] =>
  [...(values ?? [])].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

export interface AccountState {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly institutionId: string | null;
  readonly liquidity: Liquidity;
  readonly includeInNetWorth: boolean;
  readonly includeInBudget: boolean;
  readonly openedOn: string | null;
  readonly closedOn: string | null;
  readonly closeReason: string | null;
  readonly archivedAt: string | null;
  readonly archiveReason: string | null;
  readonly displayOrder: number;
  readonly accountNumberLast4: string | null;
  readonly color: string | null;
  readonly icon: string | null;
  readonly notes: string | null;
  readonly tagIds: readonly string[];
  readonly cryptoNetwork: string | null;
  /** Ordenados por clave. */
  readonly customFields: readonly AccountCustomFieldValue[];
  readonly version: number;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface OpenAccountInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly type: string;
  readonly currency: string;
  readonly currencyKind: CurrencyKind;
  readonly institutionId?: string | null;
  readonly liquidity?: string | null;
  readonly includeInNetWorth?: boolean;
  readonly includeInBudget?: boolean;
  readonly openedOn?: string | null;
  readonly displayOrder: number;
  readonly accountNumberLast4?: string | null;
  readonly color?: string | null;
  readonly icon?: string | null;
  readonly notes?: string | null;
  readonly tagIds?: readonly string[];
  readonly cryptoNetwork?: string | null;
  /** Valores finales ya resueltos por la aplicación (existentes ⊕ cambios validados). */
  readonly customFields?: readonly AccountCustomFieldValue[];
}

/** Campos editables (`AccountUpdate`): `type` NO está (inmutable, TC-ACCOUNTS-TYPES-002). */
export interface AccountChanges {
  readonly name?: string;
  readonly currency?: string;
  readonly institutionId?: string | null;
  readonly liquidity?: string;
  readonly includeInNetWorth?: boolean;
  readonly includeInBudget?: boolean;
  readonly displayOrder?: number;
  readonly accountNumberLast4?: string | null;
  readonly color?: string | null;
  readonly icon?: string | null;
  readonly notes?: string | null;
  readonly tagIds?: readonly string[];
  readonly cryptoNetwork?: string | null;
  /** Lista FINAL de valores de custom fields (ya validada); los valores no mencionados por el usuario se conservan. */
  readonly customFields?: readonly AccountCustomFieldValue[];
}

export type AccountField = keyof AccountChanges;

/**
 * Agregado `Account` (design.md decisión 1). No conoce saldos: la aplicación le provee `hasPostings` y si el saldo es
 * cero (calculados por LEDGER). Cada mutación incrementa `version` (optimistic locking, ETag).
 */
export class Account {
  private state: AccountState;
  /** Versión leída de la base (la que exige el `UPDATE … WHERE version = ?`). */
  readonly persistedVersion: number;
  /** Paso del flujo de esta unidad de trabajo, validado contra `ACCOUNT_LIFECYCLE` (add-lifecycle-timeline). */
  private transitionRecord: AccountTransitionRecord | null = null;

  private constructor(state: AccountState, persistedVersion: number) {
    this.state = state;
    this.persistedVersion = persistedVersion;
    // Una cuenta nueva (persistedVersion 0) nace con OPEN (∅ → ACTIVE).
    if (persistedVersion === 0) this.mark('OPEN', null, 'ACTIVE');
  }

  /** Transición del último comando (`null` si fue un cambio de metadatos: anotación). */
  get lastTransition(): AccountTransitionRecord | null {
    return this.transitionRecord;
  }

  private mark(code: AccountTransition, from: AccountStatus | null, to: AccountStatus): void {
    this.transitionRecord = ACCOUNT_LIFECYCLE.transition(code, from, to);
  }

  static restore(state: AccountState): Account {
    return new Account(state, state.version);
  }

  static open(input: OpenAccountInput): Account {
    const type = accountType(input.type);
    assertCurrencyKind(type, input.currencyKind);
    if (input.openedOn !== null && input.openedOn !== undefined && !LOCAL_DATE.test(input.openedOn)) {
      throw invalid('/openedOn', 'openedOn must be a date');
    }
    return new Account(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        name: accountName(input.name),
        type,
        currency: input.currency,
        institutionId: input.institutionId ?? null,
        liquidity:
          input.liquidity === null || input.liquidity === undefined
            ? defaultLiquidityFor(type)
            : parseLiquidity(input.liquidity),
        includeInNetWorth: input.includeInNetWorth ?? true,
        includeInBudget: input.includeInBudget ?? true,
        openedOn: input.openedOn ?? null,
        closedOn: null,
        closeReason: null,
        archivedAt: null,
        archiveReason: null,
        displayOrder: input.displayOrder,
        accountNumberLast4: maskedAccountNumber(input.accountNumberLast4),
        color: optionalText(input.color, 20, '/color'),
        icon: optionalText(input.icon, 40, '/icon'),
        notes: optionalText(input.notes, 2000, '/notes'),
        tagIds: [...new Set(input.tagIds ?? [])],
        cryptoNetwork: optionalText(input.cryptoNetwork, 20, '/cryptoNetwork'),
        customFields: sortedValues(input.customFields),
        version: 1,
        createdAt: null,
        updatedAt: null,
      },
      0,
    );
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get type(): AccountType {
    return this.state.type;
  }
  get nature(): AccountNature {
    return natureOf(this.state.type);
  }
  get currency(): string {
    return this.state.currency;
  }
  get version(): number {
    return this.state.version;
  }
  get status(): AccountStatus {
    if (this.state.archivedAt !== null) return 'ARCHIVED';
    if (this.state.closedOn !== null) return 'CLOSED';
    return 'ACTIVE';
  }
  get snapshot(): AccountState {
    return this.state;
  }

  /**
   * Aplica un `AccountUpdate`. Devuelve los campos que realmente cambiaron (vacío ⇒ sin efectos ni versión nueva).
   * Moneda: solo sin movimientos (`ACCOUNT_CURRENCY_IMMUTABLE`, TC-ACCOUNTS-CURRENCY-002).
   */
  update(
    changes: AccountChanges,
    ctx: { readonly hasPostings: boolean; readonly currencyKind?: CurrencyKind },
  ): AccountField[] {
    if (this.status === 'ARCHIVED') {
      throw new DomainError('ACCOUNT_ARCHIVED', `account ${this.id} is archived`);
    }
    const s = this.state;
    const next: { -readonly [K in keyof AccountState]: AccountState[K] } = { ...s };
    const changed: AccountField[] = [];
    const set = <K extends AccountField & keyof AccountState>(field: K, value: AccountState[K]) => {
      const before = s[field];
      const same =
        Array.isArray(before) && Array.isArray(value)
          ? before.length === value.length && before.every((v, i) => v === value[i])
          : before === value;
      if (same) return;
      next[field] = value;
      changed.push(field);
    };
    if (changes.name !== undefined) set('name', accountName(changes.name));
    if (changes.currency !== undefined && changes.currency !== s.currency) {
      if (ctx.hasPostings) {
        throw new DomainError(
          'ACCOUNT_CURRENCY_IMMUTABLE',
          `account ${this.id} has movements; its currency cannot change`,
        ).at('/currency');
      }
      assertCurrencyKind(s.type, ctx.currencyKind ?? 'FIAT');
      set('currency', changes.currency);
    }
    if (changes.institutionId !== undefined) set('institutionId', changes.institutionId);
    if (changes.liquidity !== undefined) set('liquidity', parseLiquidity(changes.liquidity));
    if (changes.includeInNetWorth !== undefined) set('includeInNetWorth', changes.includeInNetWorth);
    if (changes.includeInBudget !== undefined) set('includeInBudget', changes.includeInBudget);
    if (changes.displayOrder !== undefined) set('displayOrder', changes.displayOrder);
    if (changes.accountNumberLast4 !== undefined) {
      set('accountNumberLast4', maskedAccountNumber(changes.accountNumberLast4));
    }
    if (changes.color !== undefined) set('color', optionalText(changes.color, 20, '/color'));
    if (changes.icon !== undefined) set('icon', optionalText(changes.icon, 40, '/icon'));
    if (changes.notes !== undefined) set('notes', optionalText(changes.notes, 2000, '/notes'));
    if (changes.tagIds !== undefined) set('tagIds', [...new Set(changes.tagIds)]);
    if (changes.cryptoNetwork !== undefined) {
      set('cryptoNetwork', optionalText(changes.cryptoNetwork, 20, '/cryptoNetwork'));
    }
    if (changes.customFields !== undefined) {
      const values = sortedValues(changes.customFields);
      if (JSON.stringify(values) !== JSON.stringify(s.customFields)) {
        next.customFields = values;
        changed.push('customFields');
      }
    }
    if (changed.length > 0) this.state = { ...next, version: s.version + 1 };
    return changed;
  }

  /** Reordenamiento manual (no cuenta como cambio de metadatos auditable por cuenta). */
  moveTo(displayOrder: number): boolean {
    if (this.state.displayOrder === displayOrder) return false;
    this.state = { ...this.state, displayOrder, version: this.state.version + 1 };
    return true;
  }

  /** ACTIVE/CLOSED → ARCHIVED; archivar dos veces ⇒ `INVALID_STATUS_TRANSITION` (TC-ACCOUNTS-ARCHIVE-001). */
  archive(at: string, reason: string | null): void {
    if (this.status === 'ARCHIVED') {
      throw new DomainError('INVALID_STATUS_TRANSITION', `account ${this.id} is already archived`);
    }
    this.mark('ARCHIVE', this.status, 'ARCHIVED');
    this.state = {
      ...this.state,
      archivedAt: at,
      archiveReason: optionalText(reason, 500, '/reason'),
      version: this.state.version + 1,
    };
  }

  /**
   * ACTIVE → CLOSED; exige saldo cero (`ACCOUNT_BALANCE_NOT_ZERO`, FR-ACCOUNTS-007, TC-ACCOUNTS-CLOSE-001) y
   * `closedOn ≥ openedOn`.
   */
  close(closedOn: string, reason: string | null, ctx: { readonly balanceIsZero: boolean }): void {
    if (this.status !== 'ACTIVE') {
      throw new DomainError('INVALID_STATUS_TRANSITION', `account ${this.id} is ${this.status}`);
    }
    if (!LOCAL_DATE.test(closedOn)) throw invalid('/closedOn', 'closedOn must be a date');
    if (this.state.openedOn !== null && closedOn < this.state.openedOn) {
      throw invalid('/closedOn', 'closedOn must not be before openedOn');
    }
    if (!ctx.balanceIsZero) {
      throw new DomainError('ACCOUNT_BALANCE_NOT_ZERO', `account ${this.id} balance is not zero`);
    }
    this.mark('CLOSE', 'ACTIVE', 'CLOSED');
    this.state = {
      ...this.state,
      closedOn,
      closeReason: optionalText(reason, 500, '/reason'),
      version: this.state.version + 1,
    };
  }

  /** CLOSED/ARCHIVED → ACTIVE (TC-ACCOUNTS-ARCHIVE-003). Devuelve el estado previo. */
  reactivate(): 'ARCHIVED' | 'CLOSED' {
    const previous = this.status;
    if (previous === 'ACTIVE') {
      throw new DomainError('INVALID_STATUS_TRANSITION', `account ${this.id} is already active`);
    }
    this.mark('REACTIVATE', previous, 'ACTIVE');
    this.state = {
      ...this.state,
      archivedAt: null,
      archiveReason: null,
      closedOn: null,
      closeReason: null,
      version: this.state.version + 1,
    };
    return previous;
  }

  /** INV-026: una cuenta archivada o cerrada no recibe movimientos. */
  assertCanReceivePostings(): void {
    if (this.status === 'ARCHIVED')
      throw new DomainError('ACCOUNT_ARCHIVED', `account ${this.id} is archived`);
    if (this.status === 'CLOSED') throw new DomainError('ACCOUNT_CLOSED', `account ${this.id} is closed`);
  }
}
