import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditPort } from '@pf/audit/contracts';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import type { FxConversionPricingPort } from '../contracts/index.js';
import { FxQueries } from '../application/fx.queries.js';
import { FxService } from '../application/fx.service.js';
import type { FxDeps, OutboxPort, WorkspaceSettingsPort } from '../application/ports/index.js';
import {
  PgCurrencyRepository,
  PgExchangeRateRepository,
  PgFxUnitOfWork,
  PgRatePreferenceRepository,
  uuidV7Ids,
} from '../infrastructure/pg-fx.js';
import { FX_QUERIES, FX_SERVICE, FxController } from './fx-http.js';

export interface FxRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly outbox: OutboxPort;
  /** Moneda de reporte y zona horaria del workspace (IDENTITY, vía composition root). */
  readonly workspaces: WorkspaceSettingsPort;
  /** Ventana de vigencia de la resolución *as-of* en días (7 por defecto). */
  readonly windowDays?: number;
}

export interface FxRuntime {
  readonly service: FxService;
  readonly queries: FxQueries;
  /** Puerto in-process para TRANSACTIONS (`@pf/fx/contracts`): referencia y costo de conversiones. */
  readonly pricing: FxConversionPricingPort;
  /** Gancho síncrono de `CreateWorkspace`: habilita las monedas por defecto. */
  readonly provisioner: {
    onWorkspaceCreated(input: { readonly workspaceId: string; readonly userId: string }): Promise<void>;
  };
}

/** Composición de FX sobre PostgreSQL. */
export function createFxRuntime(options: FxRuntimeOptions): FxRuntime {
  const deps: FxDeps = {
    uow: new PgFxUnitOfWork(options.pool),
    rates: new PgExchangeRateRepository(),
    currencies: new PgCurrencyRepository(),
    preferences: new PgRatePreferenceRepository(),
    workspaces: options.workspaces,
    outbox: options.outbox,
    audit: options.audit,
    ids: uuidV7Ids,
    clock: options.clock,
    ...(options.windowDays ? { windowDays: options.windowDays } : {}),
  };
  const service = new FxService(deps);
  const queries = new FxQueries(deps);
  return {
    service,
    queries,
    pricing: queries,
    provisioner: {
      // Sin consultar IDENTITY: el workspace aún se está creando en la misma transacción (BOB, USD, USDT).
      onWorkspaceCreated: ({ workspaceId }) => service.onWorkspaceCreated({ workspaceId }),
    },
  };
}

export interface FxModuleOptions {
  readonly runtime: FxRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de FX (`/currencies`, `/fx-rates*`, `/fx-rate-preferences`). */
@Module({})
export class FxModule {
  static register(options: FxModuleOptions): DynamicModule {
    return {
      module: FxModule,
      controllers: [FxController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: FX_SERVICE, useValue: options.runtime.service },
        { provide: FX_QUERIES, useValue: options.runtime.queries },
      ],
    };
  }
}

export { FX_AUDIT_POLICY, type FxConversionPricingPort } from '../contracts/index.js';
export type { OutboxPort, WorkspaceSettingsPort };
