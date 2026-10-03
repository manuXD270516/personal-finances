import { DomainError, type Currency } from '@pf/shared-kernel';

/** Naturaleza contable (docs/09 §2.1). Determina el signo del saldo presentado (`BalanceCalculator`). */
export type AccountNature = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export const ACCOUNT_NATURES: readonly AccountNature[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
];

/** Cuentas de sistema por workspace y moneda, creadas bajo demanda (docs/09 §2.2, FR-LEDGER-004). */
export type SystemKind = 'INCOME' | 'EXPENSE' | 'OPENING_BALANCE' | 'FX_TRADING' | 'ADJUSTMENTS';
export const SYSTEM_KINDS: readonly SystemKind[] = [
  'INCOME',
  'EXPENSE',
  'OPENING_BALANCE',
  'FX_TRADING',
  'ADJUSTMENTS',
];

export const natureOfSystemKind = (kind: SystemKind): AccountNature =>
  kind === 'INCOME' ? 'INCOME' : kind === 'EXPENSE' ? 'EXPENSE' : 'EQUITY';

/** Cuentas nominales: todo posting a ellas referencia un split (FR-LEDGER-008). */
export const isNominal = (nature: AccountNature): boolean => nature === 'INCOME' || nature === 'EXPENSE';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYSTEM_CODE =
  /^(INCOME|EXPENSE|EQUITY:(OPENING_BALANCE|FX_TRADING|ADJUSTMENTS)):[A-Z0-9][A-Z0-9_.-]{1,15}$/;

/**
 * VO `LedgerAccountCode`: `ASSET:<accountId>` / `LIABILITY:<accountId>` para cuentas del usuario y
 * `INCOME:<CCY>`, `EXPENSE:<CCY>`, `EQUITY:<KIND>:<CCY>` para las de sistema (mismo patrón que
 * `systemAccountCode` de `ledger.JournalEntryPosted.v1`).
 */
export class LedgerAccountCode {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static forUserAccount(nature: 'ASSET' | 'LIABILITY', accountId: string): LedgerAccountCode {
    if (!UUID.test(accountId))
      throw new DomainError('VALIDATION_FAILED', `invalid account id '${accountId}'`);
    return new LedgerAccountCode(`${nature}:${accountId.toLowerCase()}`);
  }

  static forSystem(kind: SystemKind, currency: Currency): LedgerAccountCode {
    const prefix = kind === 'INCOME' || kind === 'EXPENSE' ? kind : `EQUITY:${kind}`;
    return new LedgerAccountCode(`${prefix}:${currency.code}`);
  }

  static parse(value: string): LedgerAccountCode {
    const [head, rest] = [value.split(':')[0], value.slice(value.indexOf(':') + 1)];
    const user = (head === 'ASSET' || head === 'LIABILITY') && UUID.test(rest);
    if (!user && !SYSTEM_CODE.test(value)) {
      throw new DomainError('VALIDATION_FAILED', `invalid ledger account code '${value}'`);
    }
    return new LedgerAccountCode(value);
  }

  get isSystem(): boolean {
    return SYSTEM_CODE.test(this.value);
  }

  equals(other: LedgerAccountCode): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/** Vista de una cuenta contable que necesitan el validador y los postings (sin comportamiento). */
export interface LedgerAccountRef {
  readonly id: string;
  readonly workspaceId: string;
  readonly nature: AccountNature;
  readonly currency: Currency;
  readonly sourceAccountId: string | null;
  readonly code: LedgerAccountCode;
}

export interface LedgerAccountProps extends LedgerAccountRef {
  readonly systemKind: SystemKind | null;
  readonly archivedAt: string | null;
}

/**
 * AR `LedgerAccount` (docs/09 §2, INV-006): exactamente una naturaleza y una moneda, ambas INMUTABLES — el agregado
 * no ofrece ninguna operación para cambiarlas (TC-LEDGER-CHART-001); la única transición es `archive`.
 * Una cuenta del usuario es `ASSET`/`LIABILITY` con `sourceAccountId`; una de sistema tiene `systemKind`.
 */
export class LedgerAccount implements LedgerAccountRef {
  readonly id: string;
  readonly workspaceId: string;
  readonly nature: AccountNature;
  readonly currency: Currency;
  readonly systemKind: SystemKind | null;
  readonly sourceAccountId: string | null;
  readonly code: LedgerAccountCode;
  readonly archivedAt: string | null;

  private constructor(props: LedgerAccountProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.nature = props.nature;
    this.currency = props.currency;
    this.systemKind = props.systemKind;
    this.sourceAccountId = props.sourceAccountId;
    this.code = props.code;
    this.archivedAt = props.archivedAt;
    Object.freeze(this);
  }

  /** Cuenta contable 1:1 de una cuenta del usuario (FR-ACCOUNTS-003): `ASSET` o `LIABILITY` en su moneda. */
  static forUserAccount(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly sourceAccountId: string;
    readonly nature: 'ASSET' | 'LIABILITY';
    readonly currency: Currency;
  }): LedgerAccount {
    if (input.nature !== 'ASSET' && input.nature !== 'LIABILITY') {
      throw new DomainError(
        'VALIDATION_FAILED',
        `user ledger accounts are ASSET or LIABILITY, got ${String(input.nature)}`,
      );
    }
    return new LedgerAccount({
      id: input.id,
      workspaceId: input.workspaceId,
      nature: input.nature,
      currency: input.currency,
      systemKind: null,
      sourceAccountId: input.sourceAccountId,
      code: LedgerAccountCode.forUserAccount(input.nature, input.sourceAccountId),
      archivedAt: null,
    });
  }

  /** Cuenta de sistema `INCOME:<CCY>`, `EXPENSE:<CCY>` o `EQUITY:<KIND>:<CCY>` (FR-LEDGER-004). */
  static system(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly kind: SystemKind;
    readonly currency: Currency;
  }): LedgerAccount {
    if (!SYSTEM_KINDS.includes(input.kind)) {
      throw new DomainError('VALIDATION_FAILED', `unknown system kind ${String(input.kind)}`);
    }
    return new LedgerAccount({
      id: input.id,
      workspaceId: input.workspaceId,
      nature: natureOfSystemKind(input.kind),
      currency: input.currency,
      systemKind: input.kind,
      sourceAccountId: null,
      code: LedgerAccountCode.forSystem(input.kind, input.currency),
      archivedAt: null,
    });
  }

  /** Rehidrata desde persistencia verificando la coherencia naturaleza/origen/código. */
  static restore(props: LedgerAccountProps): LedgerAccount {
    const expected =
      props.systemKind !== null
        ? LedgerAccountCode.forSystem(props.systemKind, props.currency)
        : props.sourceAccountId !== null && (props.nature === 'ASSET' || props.nature === 'LIABILITY')
          ? LedgerAccountCode.forUserAccount(props.nature, props.sourceAccountId)
          : null;
    if (
      expected === null ||
      !expected.equals(props.code) ||
      (props.systemKind !== null && natureOfSystemKind(props.systemKind) !== props.nature)
    ) {
      throw new DomainError('INTERNAL_ERROR', `inconsistent ledger account ${props.id}`);
    }
    return new LedgerAccount(props);
  }

  get isArchived(): boolean {
    return this.archivedAt !== null;
  }

  /** Única transición permitida (y único grant de UPDATE en BD: `archived_at`). */
  archive(at: string): LedgerAccount {
    return new LedgerAccount({ ...this, archivedAt: this.archivedAt ?? at });
  }
}
