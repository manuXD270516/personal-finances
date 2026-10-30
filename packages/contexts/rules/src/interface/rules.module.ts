import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditPort } from '@pf/audit/contracts';
import type {
  CategoryCatalogQuery,
  ClassificationValidator,
  CounterpartyCatalogQuery,
} from '@pf/classification/contracts';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type {
  ClassificationCoverageQuery,
  ClassificationSubjectsQuery,
  RuleClassificationCommand,
} from '@pf/transactions/contracts';
import type { Pool } from 'pg';
import { RuleDryRunService } from '../application/dry-run.service.js';
import { DEFAULT_RULES_SETTINGS, type RulesDeps, type RulesSettings } from '../application/ports/index.js';
import { RulesQueries } from '../application/rules.queries.js';
import { RulesService } from '../application/rules.service.js';
import type { RuleEvaluationQuery } from '../contracts/index.js';
import { ClassificationReferenceCatalog } from '../infrastructure/classification-catalog.js';
import { PgRuleRepository, PgRulesUnitOfWork, uuidV7Ids } from '../infrastructure/pg-rules.js';
import { RULES_DRY_RUN, RULES_QUERIES, RULES_SERVICE, RulesController } from './rules-http.js';

export interface RulesRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Puertos públicos de CLASSIFICATION. */
  readonly validator: ClassificationValidator;
  readonly categories: CategoryCatalogQuery;
  readonly counterparties: CounterpartyCatalogQuery;
  /** Puertos públicos de TRANSACTIONS (sujetos, aplicación y cobertura). */
  readonly subjects: ClassificationSubjectsQuery;
  readonly classifier: RuleClassificationCommand;
  readonly coverage: Pick<ClassificationCoverageQuery, 'coverage' | 'ruleStats'>;
  readonly settings?: Partial<RulesSettings>;
}

export interface RulesRuntime {
  readonly rules: RulesService;
  readonly queries: RulesQueries;
  readonly dryRuns: RuleDryRunService;
  /** Puerto público que consumen Imports (vista previa) y la composición (`RuleSuggestionPort`). */
  readonly evaluation: RuleEvaluationQuery;
}

/** Composición de RULES sobre PostgreSQL y los contratos públicos de CLASSIFICATION y TRANSACTIONS. */
export function createRulesRuntime(options: RulesRuntimeOptions): RulesRuntime {
  const deps: RulesDeps = {
    uow: new PgRulesUnitOfWork(options.pool),
    rules: new PgRuleRepository(),
    catalog: new ClassificationReferenceCatalog(
      options.validator,
      options.categories,
      options.counterparties,
    ),
    subjects: options.subjects,
    coverage: options.coverage,
    classifier: options.classifier,
    audit: options.audit,
    ids: uuidV7Ids,
    clock: options.clock,
    settings: { ...DEFAULT_RULES_SETTINGS, ...options.settings },
  };
  const queries = new RulesQueries(deps);
  return {
    rules: new RulesService(deps),
    queries,
    dryRuns: new RuleDryRunService(deps, queries),
    evaluation: {
      evaluate: (input) => queries.evaluate(input),
    },
  };
}

export interface RulesModuleOptions {
  readonly runtime: RulesRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de RULES (`/rules*`). */
@Module({})
export class RulesModule {
  static register(options: RulesModuleOptions): DynamicModule {
    return {
      module: RulesModule,
      controllers: [RulesController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: RULES_SERVICE, useValue: options.runtime.rules },
        { provide: RULES_QUERIES, useValue: options.runtime.queries },
        { provide: RULES_DRY_RUN, useValue: options.runtime.dryRuns },
      ],
    };
  }
}

export { RULES_AUDIT_POLICY, RULE_EVALUATION_QUERY, RULES_PORTABILITY_SECTIONS } from '../contracts/index.js';
