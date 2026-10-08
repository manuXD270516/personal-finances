import type { ModuleMetadata } from '@nestjs/common';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import {
  AccountsModule,
  createAccountsRuntime,
  type AccountsRuntime,
  type BaseCurrencyValuationDeps,
  type CustomFieldCatalogPort,
  type WorkspaceCalendar,
  type WorkspaceCurrenciesPort,
} from '@pf/accounts/interface/accounts.module';
import type { ClassificationValidator } from '@pf/classification/contracts';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { createLedgerRuntime, type LedgerRuntime } from '@pf/ledger/interface/ledger.module';
import { currentRequestContext } from '@pf/platform/api';
import { PgOutboxWriter, type OutboxWriter } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import type { ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { eventSchemaRegistry } from '../runtime/event-contracts.js';
import { OpenAccountWithOpeningBalance } from './open-account-with-opening-balance.js';

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
  });
  return { ledger, accounts };
}

export function accountsImports(input: {
  readonly runtime: AccountsRuntime;
  readonly conventions: ApiConventionsOptions;
}): NonNullable<ModuleMetadata['imports']> {
  return [AccountsModule.register({ runtime: input.runtime, conventions: input.conventions })];
}
