/**
 * API pública de `@pf/accounts` (openspec add-accounts-management; ADR-0003). Hoja: no importa capas internas.
 * Montos como `{amount: "<decimal>", currency: "<código>"}` (nunca `number`, ADR-0006).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

export const ACCOUNTS_CONTEXT = 'accounts' as const;

export type AccountTypeDto =
  | 'BANK'
  | 'CASH'
  | 'DIGITAL_WALLET'
  | 'CREDIT_CARD'
  | 'LOAN'
  | 'CRYPTO_WALLET'
  | 'INVESTMENT'
  | 'SAVINGS'
  | 'VIRTUAL'
  | 'MANUAL_ASSET'
  | 'MANUAL_LIABILITY';
export type AccountStatusDto = 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
export type AccountNatureDto = 'ASSET' | 'LIABILITY';
export type AccountLiquidityDto = 'LIQUID' | 'SEMI_LIQUID' | 'ILLIQUID';

export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

/** Datos que Transactions/Ledger necesitan antes de postear (INV-026, INV-006; design.md decisión 4). */
export interface PostingEligibilityDto {
  readonly accountId: string;
  readonly currency: string;
  readonly nature: AccountNatureDto;
  readonly status: AccountStatusDto;
}

/**
 * Consulta de elegibilidad para postear. Se invoca DENTRO de la unidad de trabajo del llamador y bloquea las filas
 * con `FOR SHARE` (archivar/cerrar toman `FOR UPDATE`): evita la carrera "archivar mientras se postea". Las cuentas
 * inexistentes (u de otro workspace) no aparecen en el resultado.
 */
export interface AccountsQueryPort {
  getPostingEligibility(input: {
    readonly workspaceId: string;
    readonly accountIds: readonly string[];
  }): Promise<readonly PostingEligibilityDto[]>;
  /**
   * Igual que `getPostingEligibility` pero lanza `REFERENCE_NOT_FOUND`, `ACCOUNT_ARCHIVED`, `ACCOUNT_CLOSED` o
   * `CURRENCY_MISMATCH` (si `currencies[accountId]` difiere) — la verificación que Transactions aplica a cada comando.
   */
  assertCanPost(input: {
    readonly workspaceId: string;
    readonly accounts: readonly { readonly accountId: string; readonly currency?: string }[];
  }): Promise<readonly PostingEligibilityDto[]>;
}

/**
 * Asiento de apertura de una cuenta recién creada (ARCHITECTURE §7): lo implementa el composition root (`apps/api`)
 * sobre el puerto de registro del ledger — Accounts no depende de Transactions ni del ledger para escribir. Se invoca
 * en la MISMA unidad de trabajo que la creación: si falla, la cuenta tampoco se crea. `amount` es el saldo
 * PRESENTADO (para pasivos, positivo = adeudado); el adaptador lo traduce al signo contable (docs/09 §6.7).
 */
export interface AccountOpeningBalancePort {
  recordOpeningBalance(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly nature: AccountNatureDto;
    readonly amount: MoneyDto;
    readonly date: string;
  }): Promise<{ readonly journalEntryId: string }>;
}

/** Cuenta del catálogo para lecturas de otros contextos (Reporting, openspec add-basic-dashboard). Sin saldo. */
export interface AccountSummaryDto {
  readonly accountId: string;
  readonly name: string;
  readonly type: AccountTypeDto;
  readonly nature: AccountNatureDto;
  readonly currency: string;
  readonly status: AccountStatusDto;
  /** Solo `LIQUID` cuenta como dinero disponible (docs/31 D5, FR-ACCOUNTS-011). */
  readonly liquidity: AccountLiquidityDto;
  readonly includeInNetWorth: boolean;
  readonly displayOrder: number;
}

/**
 * Consulta pública del catálogo de cuentas (sin efectos, sin bloqueo). Se ejecuta en la unidad de trabajo del
 * llamador si existe. Por defecto devuelve las cuentas no archivadas (ACTIVE y CLOSED) en orden de visualización.
 */
export interface AccountCatalogQuery {
  listAccounts(input: {
    readonly workspaceId: string;
    readonly includeArchived?: boolean;
  }): Promise<readonly AccountSummaryDto[]>;
}

export const ACCOUNTS_QUERY_PORT = Symbol.for('pf.accounts.AccountsQueryPort');
export const ACCOUNT_CATALOG_QUERY = Symbol.for('pf.accounts.AccountCatalogQuery');
export const ACCOUNT_OPENING_BALANCE_PORT = Symbol.for('pf.accounts.AccountOpeningBalancePort');

/**
 * Alta de una cuenta en la unidad de trabajo del llamador (openspec add-loans, design decisión 7): lo implementa
 * ACCOUNTS (es su agregado) con las mismas validaciones, auditoría y asiento de apertura que `OpenAccount`
 * (nombre único, moneda habilitada). Los errores de dominio se propagan sin traducir y abortan la unidad de trabajo
 * del llamador. `openingBalance` es el saldo PRESENTADO (para pasivos, positivo = adeudado).
 */
export interface AccountProvisioningPort {
  openAccount(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly type: AccountTypeDto;
    readonly name: string;
    readonly currency: string;
    readonly institutionId?: string | null;
    readonly openingBalance?: MoneyDto | null;
    readonly openingDate?: string | null;
  }): Promise<{ readonly accountId: string }>;
}

export const ACCOUNT_PROVISIONING_PORT = Symbol.for('pf.accounts.AccountProvisioningPort');

/** Eventos publicados por el outbox (contracts/events/accounts/*.v1.schema.json). */
export const ACCOUNT_EVENTS = {
  opened: { eventType: 'accounts.AccountOpened', eventVersion: 1 },
  archived: { eventType: 'accounts.AccountArchived', eventVersion: 1 },
  closed: { eventType: 'accounts.AccountClosed', eventVersion: 1 },
  reactivated: { eventType: 'accounts.AccountReactivated', eventVersion: 1 },
  updated: { eventType: 'accounts.AccountUpdated', eventVersion: 1 },
} as const;

/**
 * Allow-list de auditoría de ACCOUNTS (add-audit-trail, NFR-SEC-015): `accountNumberLast4` se enmascara (`last4`);
 * lo no listado nunca se copia a `audit.audit_log`.
 */
export const ACCOUNTS_AUDIT_POLICY = {
  Account: {
    name: 'plain',
    type: 'plain',
    currency: 'plain',
    institutionId: 'plain',
    liquidity: 'plain',
    includeInNetWorth: 'plain',
    includeInBudget: 'plain',
    displayOrder: 'plain',
    accountNumberLast4: 'last4',
    color: 'plain',
    icon: 'plain',
    notes: 'plain',
    tagIds: 'plain',
    // Custom fields de cuenta (add-custom-fields): un campo `customFields.<clave>` por clave que cambió.
    'customFields.*': 'plain',
    cryptoNetwork: 'plain',
    openedOn: 'plain',
    closedOn: 'plain',
    archivedAt: 'plain',
    status: 'plain',
    openingBalance: 'money',
  },
  Institution: {
    name: 'plain',
    kind: 'plain',
    countryCode: 'plain',
    website: 'plain',
    icon: 'plain',
    color: 'plain',
    notes: 'plain',
    archivedAt: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;

export * from './portability.js';
