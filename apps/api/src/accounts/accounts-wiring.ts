import type { ModuleMetadata } from '@nestjs/common';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import {
  AccountsModule,
  createAccountsRuntime,
  FileInstitutionCatalogReader,
  type AccountsRuntime,
  type BaseCurrencyValuationDeps,
  type CustomFieldCatalogPort,
  type InstitutionCatalogReader,
  type WorkspaceCalendar,
  type WorkspaceCurrenciesPort,
} from '@pf/accounts/interface/accounts.module';
import type { ClassificationValidator } from '@pf/classification/contracts';
import { providerTermsStatus } from '@pf/fx/interface/fx.module';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { createLedgerRuntime, type LedgerRuntime } from '@pf/ledger/interface/ledger.module';
import { currentRequestContext } from '@pf/platform/api';
import { PgOutboxWriter, type OutboxWriter } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import type { ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { eventSchemaRegistry } from '../runtime/event-contracts.js';
import { OpenAccountWithOpeningBalance } from './open-account-with-opening-balance.js';

/** Raíz del paquete de la API (`apps/api`; `/app` en la imagen): contra ella se resuelven las rutas relativas. */
const API_PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** Catálogo REAL por defecto: `reference/institutions/<PAÍS>.json` (sin archivo, el país no tiene catálogo). */
export const DEFAULT_INSTITUTION_CATALOG_DIR = 'reference/institutions';

/**
 * Lector del catálogo de referencia de instituciones sobre archivo (add-exchange-house-rate-providers, design.md
 * decisión 1): la ruta es `ACCOUNTS_INSTITUTION_CATALOG_DIR` (relativa al paquete de la API o absoluta) y NO está fija en
 * el código, así apunta al archivo real cuando exista o al catálogo FICTICIO de pruebas (`reference/institutions/demo`)
 * en desarrollo y CI. Valida con `CatalogValidator` y el estado de términos de los providers de FX.
 */
export function institutionCatalogReader(config: {
  readonly ACCOUNTS_INSTITUTION_CATALOG_DIR?: string | undefined;
}): FileInstitutionCatalogReader {
  const dir = config.ACCOUNTS_INSTITUTION_CATALOG_DIR ?? DEFAULT_INSTITUTION_CATALOG_DIR;
  return new FileInstitutionCatalogReader({
    directory: isAbsolute(dir) ? dir : resolve(API_PACKAGE_ROOT, dir),
    terms: providerTermsStatus,
  });
}

/** "Hoy" en la zona IANA del workspace (fallback: `APP_TIMEZONE`). */
export function workspaceCalendar(pool: Pool, clock: Clock, defaultTimeZone: string): WorkspaceCalendar {
  const zones = identityWorkspaceTimeZones(pool);
  return {
    async today(workspaceId) {
      const actor = currentRequestContext()?.actor;
      let zone = defaultTimeZone;
      if (actor && actor.type === 'USER') {
        zone = await zones.timeZoneOf(actor.userId, workspaceId).catch(() => defaultTimeZone);
      }
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(clock.now().toString()));
    },
  };
}

/**
 * Puerto de custom fields de cuenta de ACCOUNTS sobre `ValidateCustomFieldValues` de CLASSIFICATION (API pública,
 * misma unidad de trabajo; openspec add-custom-fields). El usuario sale del contexto de la petición.
 */
export function accountCustomFields(validator: ClassificationValidator): CustomFieldCatalogPort {
  return {
    async validate({ workspaceId, requireMandatory, values, existingFieldIds }) {
      const actor = currentRequestContext()?.actor;
      const [result] = await validator.validateCustomFieldValues({
        userId: actor && actor.type === 'USER' ? actor.userId : '',
        workspaceId,
        target: 'ACCOUNT',
        requireMandatory,
        items: [{ pointer: '/customFields', values, existingFieldIds }],
      });
      return result ?? { set: [], removeFieldIds: [] };
    },
  };
}

/**
 * Composición de LEDGER + ACCOUNTS (openspec add-accounts-management): el ledger no tiene HTTP; ACCOUNTS usa sus
 * saldos (`BalanceQuery`) y su puerto de registro a través de la orquestación `OpenAccountWithOpeningBalance`.
 */
export function accountsRuntime(input: {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Auditoría + recorrido y su consulta (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery: LifecycleQuery;
  readonly logger: Logger;
  readonly defaultTimeZone: string;
  readonly outbox?: OutboxWriter;
  /** Equivalente en moneda base (FX `FxValuationPort` + ajustes de IDENTITY); ausente ⇒ `null`. */
  readonly valuation?: BaseCurrencyValuationDeps;
  /** Monedas habilitadas del workspace (FX, docs/31 D45). */
  readonly workspaceCurrencies?: WorkspaceCurrenciesPort;
  /** Validación de custom fields de cuenta (CLASSIFICATION `ValidateCustomFieldValues`). */
  readonly customFields?: CustomFieldCatalogPort;
  /** Catálogo de referencia de instituciones (archivo de datos de la instalación); ausente ⇒ sin catálogo. */
  readonly catalog?: InstitutionCatalogReader;
}): { readonly ledger: LedgerRuntime; readonly accounts: AccountsRuntime } {
  const writer = input.outbox ?? new PgOutboxWriter(eventSchemaRegistry());
  const ledger = createLedgerRuntime({
    pool: input.pool,
    clock: input.clock,
    audit: input.audit,
    outbox: writer,
    logger: input.logger,
  });
  const accounts = createAccountsRuntime({
    pool: input.pool,
    clock: input.clock,
    audit: input.audit,
    lifecycle: input.lifecycle,
    lifecycleQuery: input.lifecycleQuery,
    outbox: { append: async (event) => void (await writer.append(event)) },
    balances: ledger.balances,
    openingBalance: new OpenAccountWithOpeningBalance(ledger.posting),
    calendar: workspaceCalendar(input.pool, input.clock, input.defaultTimeZone),
    ...(input.valuation ? { valuation: input.valuation } : {}),
    ...(input.workspaceCurrencies ? { workspaceCurrencies: input.workspaceCurrencies } : {}),
    ...(input.customFields ? { customFields: input.customFields } : {}),
    ...(input.catalog ? { catalog: input.catalog } : {}),
  });
  return { ledger, accounts };
}

export function accountsImports(input: {
  readonly runtime: AccountsRuntime;
  readonly conventions: ApiConventionsOptions;
}): NonNullable<ModuleMetadata['imports']> {
  return [AccountsModule.register({ runtime: input.runtime, conventions: input.conventions })];
}
