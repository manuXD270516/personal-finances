import { Module, type DynamicModule } from '@nestjs/common';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { ClassificationQueries } from '../application/classification.queries.js';
import { ClassificationService } from '../application/classification.service.js';
import { CustomFieldsQueries } from '../application/custom-fields.queries.js';
import { CustomFieldsService } from '../application/custom-fields.service.js';
import type { LifecycleMachineDto } from '@pf/audit/contracts';
import type {
  AuditPort,
  LastCategoryUsedQueryPort,
  LifecyclePort,
  LifecycleQuery,
  LocaleResolver,
  OutboxPort,
} from '../application/ports/index.js';
import type {
  CategoryCatalogQuery,
  ClassificationLookup,
  ClassificationValidator,
  WorkspaceCatalogProvisioner,
} from '../contracts/index.js';
import { CATEGORY_LIFECYCLE, COUNTERPARTY_LIFECYCLE } from '../domain/classification-lifecycle.js';
import { pgClassificationDeps } from '../infrastructure/pg-classification.js';
import {
  CLASSIFICATION_LOCALES,
  CLASSIFICATION_QUERIES,
  CLASSIFICATION_SERVICE,
  ClassificationController,
  CUSTOM_FIELDS_QUERIES,
  CUSTOM_FIELDS_SERVICE,
} from './classification.controller.js';

export interface ClassificationRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  /** Auditoría + recorrido (add-lifecycle-timeline, docs/31 D52). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery: LifecycleQuery;
  /** Locale del usuario (`Me.locale`, IDENTITY) para los nombres de categorías de sistema. */
  readonly locales: LocaleResolver;
  /** Adapter hacia Transactions; por defecto, stub sin historial (hasta add-transaction-recording). */
  readonly lastCategoryUsed?: LastCategoryUsedQueryPort;
}

export interface ClassificationRuntime {
  readonly service: ClassificationService;
  readonly queries: ClassificationQueries;
  readonly customFields: CustomFieldsService;
  readonly customFieldQueries: CustomFieldsQueries;
  readonly locales: LocaleResolver;
  /** Gancho síncrono de `CreateWorkspace` (design §6). */
  readonly provisioner: WorkspaceCatalogProvisioner;
  /** `ValidateClassification` para Transactions (in-process, `@pf/classification/contracts`). */
  readonly validator: ClassificationValidator;
  /** Categorías de sistema y jerarquía para Transactions (`@pf/classification/contracts`). */
  readonly lookup: ClassificationLookup;
  /** Nombres de categorías para Reporting (add-basic-dashboard). */
  readonly categories: CategoryCatalogQuery;
}

export function createClassificationRuntime(options: ClassificationRuntimeOptions): ClassificationRuntime {
  const deps = pgClassificationDeps({
    pool: options.pool,
    clock: options.clock,
    outbox: options.outbox,
    audit: options.audit,
    lifecycle: options.lifecycle,
    lifecycleQuery: options.lifecycleQuery,
    ...(options.lastCategoryUsed ? { lastCategoryUsed: options.lastCategoryUsed } : {}),
  });
  const service = new ClassificationService(deps);
  const queries = new ClassificationQueries(deps);
  const customFields = new CustomFieldsService(deps);
  const customFieldQueries = new CustomFieldsQueries(deps);
  return {
    service,
    queries,
    customFields,
    customFieldQueries,
    locales: options.locales,
    provisioner: { onWorkspaceCreated: (input) => service.onWorkspaceCreated(input) },
    validator: {
      validate: ({ userId, workspaceId, ...rest }) =>
        queries.validateClassification(userId, workspaceId, rest),
      validateCustomFieldValues: ({ userId, workspaceId, ...rest }) =>
        customFieldQueries.validateCustomFieldValues(userId, workspaceId, rest),
    },
    lookup: {
      systemCategoryId: ({ userId, workspaceId, systemCode }) =>
        queries.systemCategoryId(userId, workspaceId, systemCode),
      categoryIdsWithDescendants: ({ userId, workspaceId, categoryIds }) =>
        queries.categoryIdsWithDescendants(userId, workspaceId, categoryIds),
    },
    categories: {
      categoriesByIds: async ({ userId, workspaceId, categoryIds }) =>
        (await queries.categoriesByIds(userId, workspaceId, categoryIds)).map((c) => ({
          categoryId: c.id,
          name: c.name,
          kind: c.kind,
          parentId: c.parentId,
          systemCode: c.systemCode,
          archived: c.isArchived,
        })),
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
        { provide: CUSTOM_FIELDS_SERVICE, useValue: options.runtime.customFields },
        { provide: CUSTOM_FIELDS_QUERIES, useValue: options.runtime.customFieldQueries },
        { provide: CLASSIFICATION_LOCALES, useValue: options.runtime.locales },
      ],
    };
  }
}

/**
 * Máquinas de estado `Category` y `Counterparty` declaradas por el dominio (docs/31 D52), para AUDIT en el
 * composition root (`GET W/lifecycle-machines/{aggregateType}` y el recorrido).
 */
export const CATEGORY_LIFECYCLE_MACHINE: LifecycleMachineDto = CATEGORY_LIFECYCLE.definition;
export const COUNTERPARTY_LIFECYCLE_MACHINE: LifecycleMachineDto = COUNTERPARTY_LIFECYCLE.definition;

export type { AuditPort, LifecyclePort, LifecycleQuery, LocaleResolver, OutboxPort };
