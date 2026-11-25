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
import {
  DEFAULT_RULES_SETTINGS,
  type CategorySuggestSettings,
  type RuleSuggestSettings,
  type RulesMetricsPort,
  type RulesDeps,
  type RulesSettings,
  type WorkspaceToday,
} from '../application/ports/index.js';
import { CategorySuggestionService } from '../application/category-suggestions.js';
import { RuleProposalsService } from '../application/rule-proposals.service.js';
import { RulesQueries } from '../application/rules.queries.js';
import { RulesService } from '../application/rules.service.js';
import type {
  CategorySuggestionFeedbackPort,
  CategorySuggestionQuery,
  RuleEvaluationQuery,
} from '../contracts/index.js';
import { proposalFingerprint, type ProposalPattern } from '../domain/index.js';
import { ClassificationReferenceCatalog } from '../infrastructure/classification-catalog.js';
import {
  PgCategorySuggestionOutcomeRepository,
  PgRuleProposalDecisionRepository,
  PgRuleRepository,
  PgRulesUnitOfWork,
  uuidV7Ids,
} from '../infrastructure/pg-rules.js';
import {
  RULES_CATEGORY_SUGGESTIONS,
  RULES_DRY_RUN,
  RULES_PROPOSALS,
  RULES_QUERIES,
  RULES_SERVICE,
  RulesController,
} from './rules-http.js';

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
  /** Fecha de negocio de hoy en la zona horaria del workspace (ventana de las sugerencias). */
  readonly calendar: WorkspaceToday;
  readonly settings?: Partial<Omit<RulesSettings, 'suggest' | 'categorySuggest'>> & {
    readonly suggest?: Partial<RuleSuggestSettings>;
    readonly categorySuggest?: Partial<CategorySuggestSettings>;
  };
  /** Contadores `rules_category_suggestion_*` (sin descripciones ni montos). */
  readonly metrics?: RulesMetricsPort;
}

export interface RulesRuntime {
  readonly rules: RulesService;
  readonly queries: RulesQueries;
  readonly dryRuns: RuleDryRunService;
  readonly proposals: RuleProposalsService;
  /** Puerto público que consumen Imports (vista previa) y la composición (`RuleSuggestionPort`). */
  readonly evaluation: RuleEvaluationQuery;
  /** Sugerencias de categoría por historial (add-category-suggestions). */
  readonly categorySuggestions: CategorySuggestionService;
  /** Puerto público que consume Imports en la etapa de clasificación (`CATEGORY_SUGGESTION_QUERY`). */
  readonly suggestionQuery: CategorySuggestionQuery;
  /** Puerto público con el que Imports registra los resultados al aprobar (`CATEGORY_SUGGESTION_FEEDBACK_PORT`). */
  readonly suggestionFeedback: CategorySuggestionFeedbackPort;
}

/** Composición de RULES sobre PostgreSQL y los contratos públicos de CLASSIFICATION y TRANSACTIONS. */
export function createRulesRuntime(options: RulesRuntimeOptions): RulesRuntime {
  const deps: RulesDeps = {
    uow: new PgRulesUnitOfWork(options.pool),
    rules: new PgRuleRepository(),
    decisions: new PgRuleProposalDecisionRepository(),
    outcomes: new PgCategorySuggestionOutcomeRepository(),
    calendar: options.calendar,
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
    settings: {
      ...DEFAULT_RULES_SETTINGS,
      ...options.settings,
      suggest: { ...DEFAULT_RULES_SETTINGS.suggest, ...options.settings?.suggest },
      categorySuggest: { ...DEFAULT_RULES_SETTINGS.categorySuggest, ...options.settings?.categorySuggest },
    },
    ...(options.metrics ? { metrics: options.metrics } : {}),
  };
  const queries = new RulesQueries(deps);
  const categorySuggestions = new CategorySuggestionService(deps, queries);
  return {
    rules: new RulesService(deps),
    queries,
    dryRuns: new RuleDryRunService(deps, queries),
    proposals: new RuleProposalsService(deps, queries),
    evaluation: {
      evaluate: (input) => queries.evaluate(input),
    },
    categorySuggestions,
    suggestionQuery: { suggestMany: (input) => categorySuggestions.suggestMany(input) },
    suggestionFeedback: { recordBatch: (input) => categorySuggestions.recordBatch(input) },
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
        { provide: RULES_PROPOSALS, useValue: options.runtime.proposals },
        { provide: RULES_CATEGORY_SUGGESTIONS, useValue: options.runtime.categorySuggestions },
      ],
    };
  }
}

/**
 * Gancho `RULES_SUGGESTION_FINGERPRINT_HOOK`: la huella de una decisión es SHA-256 de `v1|tipo|valor|kind|categoría`, y la
 * importación remapea la categoría (y el id de la contraparte). Se recalcula con los ids nuevos para que una sugerencia
 * descartada siga sin mostrarse en el workspace restaurado.
 */
export function ruleSuggestionFingerprintHook(ctx: { readonly rows: Record<string, unknown>[] }): void {
  for (const row of ctx.rows) {
    row['suggestion_id'] = proposalFingerprint({
      type: String(row['pattern_type']) as ProposalPattern['type'],
      value: String(row['pattern_value']),
      kind: String(row['kind']) as ProposalPattern['kind'],
      categoryId: String(row['category_id']),
    });
  }
}

export {
  CATEGORY_SUGGESTION_FEEDBACK_PORT,
  CATEGORY_SUGGESTION_QUERY,
  RULES_AUDIT_POLICY,
  RULES_PORTABILITY_EXCLUSIONS,
  RULES_PORTABILITY_SECTIONS,
  RULES_SUGGESTION_FINGERPRINT_HOOK,
  RULE_EVALUATION_QUERY,
} from '../contracts/index.js';
