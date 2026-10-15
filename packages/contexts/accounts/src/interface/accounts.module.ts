import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditPort, LifecycleMachineDto, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { BalanceQuery } from '@pf/ledger/contracts';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import { DomainError, type Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { AccountProvisioningAdapter } from '../application/account-provisioning.adapter.js';
import { AccountCatalogQueries } from '../application/account-catalog.queries.js';
import { AccountsService } from '../application/accounts.service.js';
import {
  AdoptCatalogInstitutions,
  InstitutionCatalogQueries,
} from '../application/institution-catalog.service.js';
import { InstitutionsService } from '../application/institutions.service.js';
import { ACCOUNT_LIFECYCLE } from '../domain/index.js';
import type {
  AccountsDeps,
  BaseCurrencyValuationDeps,
  CustomFieldCatalogPort,
  CustomFieldValueInput,
  InstitutionCatalogReader,
  OutboxPort,
  TagCatalogPort,
  ValidatedCustomFieldValue,
  WorkspaceCalendar,
  WorkspaceCurrenciesPort,
} from '../application/ports/index.js';
import {
  ACCOUNT_PROVISIONING_PORT,
  ACCOUNTS_QUERY_PORT,
  INSTITUTION_SUPPORT_QUERY,
  type AccountCatalogQuery,
  type AccountProvisioningPort,
  type AccountOpeningBalancePort,
  type AccountsQueryPort,
  type InstitutionSupportQuery,
} from '../contracts/index.js';
import {
  FileInstitutionCatalogReader,
  type FileInstitutionCatalogOptions,
} from '../infrastructure/file-institution-catalog.js';
import {
  LedgerBalancesAdapter,
  PgAccountRepository,
  PgAccountsUnitOfWork,
  PgInstitutionRepository,
  pgCurrencyCatalog,
  uuidV7Ids,
} from '../infrastructure/pg-accounts.js';
import {
  ACCOUNTS_SERVICE,
  ADOPT_CATALOG_INSTITUTIONS,
  AccountsController,
  INSTITUTION_CATALOG_QUERIES,
  INSTITUTIONS_SERVICE,
  InstitutionCatalogController,
  InstitutionsController,
} from './accounts-http.js';

export interface AccountsRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Auditoría + recorrido (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery: LifecycleQuery;
  readonly outbox: OutboxPort;
  /** Saldos (API pública de LEDGER). */
  readonly balances: BalanceQuery;
  /** Asiento de apertura (lo compone apps/api sobre `LedgerPostingPort`, ARCHITECTURE §7). */
  readonly openingBalance: AccountOpeningBalancePort;
  /** Fecha de negocio "hoy" en la zona del workspace. */
  readonly calendar: WorkspaceCalendar;
  /** Catálogo de etiquetas (Classification); por defecto acepta cualquier id (design.md §Implementación). */
  readonly tags?: TagCatalogPort;
  /**
   * Validación de custom fields de cuenta (`ValidateCustomFieldValues` de CLASSIFICATION, adaptada en el composition
   * root). Por defecto no hay definiciones: cualquier valor ⇒ `REFERENCE_NOT_FOUND`.
   */
  readonly customFields?: CustomFieldCatalogPort;
  /**
   * Equivalente en moneda base (`FxValuationPort` de `@pf/fx/contracts` + moneda base/zona de IDENTITY). Ausente ⇒
   * `baseCurrencyBalance: null`.
   */
  readonly valuation?: BaseCurrencyValuationDeps;
  /**
   * Monedas habilitadas del workspace (`FxValuationPort.enabledCurrencies` de `@pf/fx/contracts`, docs/31 D45).
   * Ausente ⇒ solo se exige la moneda activa en el catálogo global.
   */
  readonly workspaceCurrencies?: WorkspaceCurrenciesPort;
  /**
   * Catálogo de referencia de instituciones (archivo de datos de la instalación, `ACCOUNTS_INSTITUTION_CATALOG_DIR`;
   * add-exchange-house-rate-providers). Ausente ⇒ la instalación no tiene catálogo para ningún país (el listado y la
   * adopción responden 404 y las instituciones se crean a mano).
   */
  readonly catalog?: InstitutionCatalogReader;
}

/** Sin catálogo compuesto: ningún país tiene catálogo. */
const noCatalog: InstitutionCatalogReader = { get: async () => null };

/** Sin CLASSIFICATION compuesto no hay definiciones: no se aceptan valores. */
const noCustomFields: CustomFieldCatalogPort = {
  validate: async ({ values }) => {
    if (values.length > 0) {
      throw new DomainError('REFERENCE_NOT_FOUND', 'custom field not found').at('/customFields/0');
    }
    return { set: [], removeFieldIds: [] };
  },
};

export interface AccountsRuntime {
  readonly accounts: AccountsService;
  readonly institutions: InstitutionsService;
  /** Puerto público para Transactions (INV-026). */
  readonly query: AccountsQueryPort;
  /** Catálogo de cuentas para Reporting (openspec add-basic-dashboard). */
  readonly catalog: AccountCatalogQuery;
  /** Alta de cuentas en la unidad de trabajo del llamador (openspec add-loans). */
  readonly provisioning: AccountProvisioningPort;
  /** Consulta del catálogo de referencia de instituciones y estado de sus vínculos (add-exchange-house-rate-providers). */
  readonly catalogQueries: InstitutionCatalogQueries;
  /** Adopción de instituciones desde el catálogo (una operación auditada). */
  readonly adoption: AdoptCatalogInstitutions;
  /** Soporte en tasas de las instituciones adoptadas, para el estado de providers de FX. */
  readonly institutionSupport: InstitutionSupportQuery;
}

/** Composición de ACCOUNTS sobre PostgreSQL (misma transacción que la `PgUnitOfWork` de cada comando). */
export function createAccountsRuntime(options: AccountsRuntimeOptions): AccountsRuntime {
  const deps: AccountsDeps = {
    uow: new PgAccountsUnitOfWork(options.pool),
    accounts: new PgAccountRepository(),
    institutions: new PgInstitutionRepository(),
    currencies: pgCurrencyCatalog,
    ...(options.workspaceCurrencies ? { workspaceCurrencies: options.workspaceCurrencies } : {}),
    balances: new LedgerBalancesAdapter(options.balances),
    tags: options.tags ?? { assertAssignable: async () => undefined },
    customFields: options.customFields ?? noCustomFields,
    openingBalance: options.openingBalance,
    outbox: options.outbox,
    audit: options.audit,
    lifecycle: options.lifecycle,
    lifecycleQuery: options.lifecycleQuery,
    ids: uuidV7Ids,
    clock: options.clock,
    calendar: options.calendar,
    ...(options.valuation ? { valuation: options.valuation } : {}),
  };
  const accounts = new AccountsService(deps);
  const catalog = options.catalog ?? noCatalog;
  const catalogQueries = new InstitutionCatalogQueries({
    uow: deps.uow,
    institutions: deps.institutions,
    catalog,
  });
  return {
    accounts,
    institutions: new InstitutionsService(deps, options.audit),
    catalogQueries,
    adoption: new AdoptCatalogInstitutions(
      { uow: deps.uow, institutions: deps.institutions, catalog, ids: deps.ids, clock: deps.clock },
      options.audit,
    ),
    institutionSupport: { adoptedRatesSupport: (workspaceId) => catalogQueries.adoptedRatesSupport(workspaceId) },
    query: {
      getPostingEligibility: (input) => accounts.getPostingEligibility(input.workspaceId, input.accountIds),
      assertCanPost: (input) => accounts.assertCanPost(input.workspaceId, input.accounts),
    },
    catalog: new AccountCatalogQueries(deps),
    provisioning: new AccountProvisioningAdapter(accounts),
  };
}

export interface AccountsModuleOptions {
  readonly runtime: AccountsRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de ACCOUNTS (`/accounts*`, `/institutions*`); exporta `ACCOUNTS_QUERY_PORT`. */
@Module({})
export class AccountsModule {
  static register(options: AccountsModuleOptions): DynamicModule {
    return {
      module: AccountsModule,
      controllers: [AccountsController, InstitutionsController, InstitutionCatalogController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: ACCOUNTS_SERVICE, useValue: options.runtime.accounts },
        { provide: INSTITUTIONS_SERVICE, useValue: options.runtime.institutions },
        { provide: INSTITUTION_CATALOG_QUERIES, useValue: options.runtime.catalogQueries },
        { provide: ADOPT_CATALOG_INSTITUTIONS, useValue: options.runtime.adoption },
        { provide: INSTITUTION_SUPPORT_QUERY, useValue: options.runtime.institutionSupport },
        { provide: ACCOUNTS_QUERY_PORT, useValue: options.runtime.query },
        { provide: ACCOUNT_PROVISIONING_PORT, useValue: options.runtime.provisioning },
      ],
      exports: [ACCOUNTS_QUERY_PORT, ACCOUNT_PROVISIONING_PORT],
    };
  }
}

/** Máquina de estados `Account` declarada por el dominio (add-lifecycle-timeline), para AUDIT en el composition root. */
export const ACCOUNT_LIFECYCLE_MACHINE: LifecycleMachineDto = ACCOUNT_LIFECYCLE.definition;

export { FileInstitutionCatalogReader, type FileInstitutionCatalogOptions, type InstitutionCatalogReader };

export type {
  AccountOpeningBalancePort,
  AccountsQueryPort,
  BaseCurrencyValuationDeps,
  OutboxPort,
  TagCatalogPort,
  CustomFieldCatalogPort,
  CustomFieldValueInput,
  ValidatedCustomFieldValue,
  WorkspaceCalendar,
  WorkspaceCurrenciesPort,
};
