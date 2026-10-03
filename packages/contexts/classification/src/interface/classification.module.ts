import { Module, type DynamicModule } from '@nestjs/common';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { ClassificationQueries } from '../application/classification.queries.js';
import { ClassificationService } from '../application/classification.service.js';
import type {
  AuditPort,
  LastCategoryUsedQueryPort,
  LocaleResolver,
  OutboxPort,
} from '../application/ports/index.js';
import type {
  ClassificationLookup,
  ClassificationValidator,
  WorkspaceCatalogProvisioner,
} from '../contracts/index.js';
import { pgClassificationDeps } from '../infrastructure/pg-classification.js';
import {
  CLASSIFICATION_LOCALES,
  CLASSIFICATION_QUERIES,
  CLASSIFICATION_SERVICE,
  ClassificationController,
} from './classification.controller.js';

export interface ClassificationRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  /** Locale del usuario (`Me.locale`, IDENTITY) para los nombres de categorías de sistema. */
  readonly locales: LocaleResolver;
  /** Adapter hacia Transactions; por defecto, stub sin historial (hasta add-transaction-recording). */
  readonly lastCategoryUsed?: LastCategoryUsedQueryPort;
}

export interface ClassificationRuntime {
  readonly service: ClassificationService;
  readonly queries: ClassificationQueries;
  readonly locales: LocaleResolver;
  /** Gancho síncrono de `CreateWorkspace` (design §6). */
  readonly provisioner: WorkspaceCatalogProvisioner;
  /** `ValidateClassification` para Transactions (in-process, `@pf/classification/contracts`). */
  readonly validator: ClassificationValidator;
  /** Categorías de sistema y jerarquía para Transactions (`@pf/classification/contracts`). */
  readonly lookup: ClassificationLookup;
}

export function createClassificationRuntime(options: ClassificationRuntimeOptions): ClassificationRuntime {
  const deps = pgClassificationDeps({
    pool: options.pool,
    clock: options.clock,
    outbox: options.outbox,
    audit: options.audit,
    ...(options.lastCategoryUsed ? { lastCategoryUsed: options.lastCategoryUsed } : {}),
  });
  const service = new ClassificationService(deps);
  const queries = new ClassificationQueries(deps);
  return {
    service,
    queries,
    locales: options.locales,
    provisioner: { onWorkspaceCreated: (input) => service.onWorkspaceCreated(input) },
    validator: {
      validate: ({ userId, workspaceId, ...rest }) =>
        queries.validateClassification(userId, workspaceId, rest),
    },
    lookup: {
      systemCategoryId: ({ userId, workspaceId, systemCode }) =>
        queries.systemCategoryId(userId, workspaceId, systemCode),
      categoryIdsWithDescendants: ({ userId, workspaceId, categoryIds }) =>
        queries.categoryIdsWithDescendants(userId, workspaceId, categoryIds),
    },
  };
}

export interface ClassificationModuleOptions {
  readonly runtime: ClassificationRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de CLASSIFICATION (categorías, grupos, tags, counterparties). */
@Module({})
export class ClassificationModule {
  static register(options: ClassificationModuleOptions): DynamicModule {
    return {
      module: ClassificationModule,
      controllers: [ClassificationController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: CLASSIFICATION_SERVICE, useValue: options.runtime.service },
        { provide: CLASSIFICATION_QUERIES, useValue: options.runtime.queries },
        { provide: CLASSIFICATION_LOCALES, useValue: options.runtime.locales },
      ],
    };
  }
}

export type { AuditPort, LocaleResolver, OutboxPort };
