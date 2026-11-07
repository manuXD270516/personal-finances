import { PgUnitOfWork, currentRequestContext, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { DomainError } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import type {
  IdGenerator,
  RuleNameRecord,
  RuleProposalDecisionRecord,
  RuleProposalDecisionRepository,
  RuleRepository,
  RuleVersionRecord,
  UnitOfWork,
} from '../application/ports/index.js';
import {
  Rule,
  type Action,
  type ConditionItem,
  type EvaluableRule,
  type MatchMode,
  type RuleState,
  type RuleTrigger,
} from '../domain/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>();

/** Unidad de trabajo de RULES: transacción PG con el contexto RLS del workspace; reutiliza la del llamador. */
export class PgRulesUnitOfWork implements UnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const actor = currentRequestContext()?.actor;
    return this.uow.run({ userId: actor && actor.type === 'USER' ? actor.userId : null, workspaceId }, fn);
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };

interface RuleRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  priority: number;
  triggers: RuleTrigger[];
  match_mode: MatchMode;
  conditions: ConditionItem[] | string;
  actions: Action[] | string;
  schema_version: number;
  stop_processing: boolean;
  enabled: boolean;
  needs_attention: boolean;
  archived_at: string | null;
  version: number;
  row_version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
}

const iso = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** Columnas de lectura con los instantes en ISO-8601 UTC con milisegundos. */
const COLUMNS = sql`id, workspace_id, name, description, priority, triggers, match_mode, conditions, actions,
  schema_version, stop_processing, enabled, needs_attention, version, row_version, created_by,
  ${iso('archived_at')} AS archived_at, ${iso('created_at')} AS created_at, ${iso('updated_at')} AS updated_at`;

const json = <T>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);

function stateOf(r: RuleRow): RuleState {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    description: r.description,
    priority: r.priority,
    triggers: r.triggers,
    matchMode: r.match_mode,
    conditions: json(r.conditions),
    actions: json(r.actions),
    schemaVersion: r.schema_version,
    stopProcessing: r.stop_processing,
    enabled: r.enabled,
    needsAttention: r.needs_attention,
    archivedAt: r.archived_at,
    version: r.version,
    rowVersion: r.row_version,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
  };
}

const evaluableOf = (r: RuleRow): EvaluableRule => {
  const s = stateOf(r);
  return {
    id: s.id,
    version: s.version,
    priority: s.priority,
    createdAt: s.createdAt,
    enabled: s.enabled,
    archived: s.archivedAt !== null,
    triggers: s.triggers,
    stopProcessing: s.stopProcessing,
    matchMode: s.matchMode,
    conditions: s.conditions,
    actions: s.actions,
  };
};

/** Repositorio PostgreSQL de `rules.*` (Kysely sobre la conexión de la unidad de trabajo; RLS forzada). */
export class PgRuleRepository implements RuleRepository {
  async findById(workspaceId: string, id: string): Promise<Rule | null> {
    const { rows } = await sql<RuleRow>`
      SELECT ${COLUMNS} FROM rules.rule WHERE workspace_id = ${workspaceId} AND id = ${id}`.execute(db());
    return rows[0] ? Rule.rehydrate(stateOf(rows[0])) : null;
  }

  async listAll(workspaceId: string, options: { readonly includeArchived: boolean }): Promise<Rule[]> {
    const { rows } = await sql<RuleRow>`
      SELECT ${COLUMNS} FROM rules.rule
       WHERE workspace_id = ${workspaceId} AND (${options.includeArchived} OR archived_at IS NULL)
       ORDER BY priority, created_at, id`.execute(db());
    return rows.map((r) => Rule.rehydrate(stateOf(r)));
  }

  /** UNA consulta, ordenada por la cadena de evaluación; el índice parcial `rule_evaluable_ix` la sustenta. */
  async listEvaluable(workspaceId: string, trigger: RuleTrigger): Promise<EvaluableRule[]> {
    const { rows } = await sql<RuleRow>`
      SELECT ${COLUMNS} FROM rules.rule
       WHERE workspace_id = ${workspaceId} AND enabled AND archived_at IS NULL AND ${trigger} = ANY (triggers)
       ORDER BY priority, created_at, id`.execute(db());
    return rows.map(evaluableOf);
  }

  async listEvaluableByIds(workspaceId: string, ids: readonly string[]): Promise<EvaluableRule[]> {
    if (ids.length === 0) return [];
    const { rows } = await sql<RuleRow>`
      SELECT ${COLUMNS} FROM rules.rule
       WHERE workspace_id = ${workspaceId} AND enabled AND archived_at IS NULL AND id = ANY (${[...ids]}::uuid[])
       ORDER BY priority, created_at, id`.execute(db());
    return rows.map(evaluableOf);
  }

  async countNonArchived(workspaceId: string): Promise<number> {
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM rules.rule WHERE workspace_id = ${workspaceId} AND archived_at IS NULL`.execute(
      db(),
    );
    return Number(rows[0]?.n ?? 0);
  }

  async insert(rule: Rule, createdBy: string): Promise<void> {
    const s = rule.snapshot;
    try {
      await sql`
        INSERT INTO rules.rule (id, workspace_id, name, description, priority, triggers, match_mode, conditions, actions,
                                schema_version, stop_processing, enabled, needs_attention, version, row_version,
                                created_at, created_by, updated_at)
        VALUES (${s.id}, ${s.workspaceId}, ${s.name}, ${s.description}, ${s.priority}, ${[...s.triggers]}::text[],
                ${s.matchMode}, ${JSON.stringify(s.conditions)}::jsonb, ${JSON.stringify(s.actions)}::jsonb,
                ${s.schemaVersion}, ${s.stopProcessing}, ${s.enabled}, ${s.needsAttention}, ${s.version},
                ${s.rowVersion}, ${s.createdAt}::timestamptz, ${createdBy}, ${s.updatedAt}::timestamptz)`.execute(
        db(),
      );
    } catch (err) {
      throw translate(err, s.name);
    }
  }

  async update(rule: Rule, expectedRowVersion: number): Promise<boolean> {
    const s = rule.snapshot;
    try {
      const result = await sql`
        UPDATE rules.rule
           SET name = ${s.name}, description = ${s.description}, priority = ${s.priority},
               triggers = ${[...s.triggers]}::text[], match_mode = ${s.matchMode},
               conditions = ${JSON.stringify(s.conditions)}::jsonb, actions = ${JSON.stringify(s.actions)}::jsonb,
               stop_processing = ${s.stopProcessing}, enabled = ${s.enabled}, needs_attention = ${s.needsAttention},
               archived_at = ${s.archivedAt}::timestamptz, version = ${s.version}, row_version = ${s.rowVersion},
               updated_at = ${s.updatedAt}::timestamptz
         WHERE workspace_id = ${s.workspaceId} AND id = ${s.id} AND row_version = ${expectedRowVersion}`.execute(
        db(),
      );
      return Number(result.numAffectedRows ?? 0) === 1;
    } catch (err) {
      throw translate(err, s.name);
    }
  }

  async insertVersion(state: RuleState, createdBy: string): Promise<void> {
    const snapshot = {
      name: state.name,
      triggers: state.triggers,
      matchMode: state.matchMode,
      conditions: state.conditions,
      actions: state.actions,
      stopProcessing: state.stopProcessing,
      schemaVersion: state.schemaVersion,
    };
    await sql`
      INSERT INTO rules.rule_version (workspace_id, rule_id, version, snapshot, created_at, created_by)
      VALUES (${state.workspaceId}, ${state.id}, ${state.version}, ${JSON.stringify(snapshot)}::jsonb,
              ${state.updatedAt}::timestamptz, ${createdBy})`.execute(db());
  }

  async listVersions(workspaceId: string, ruleId: string): Promise<RuleVersionRecord[]> {
    const { rows } = await sql<{
      rule_id: string;
      version: number;
      snapshot: RuleVersionRecord['snapshot'] | string;
      created_at: string;
      created_by: string;
    }>`
      SELECT rule_id, version, snapshot, created_by, ${iso('created_at')} AS created_at
        FROM rules.rule_version WHERE workspace_id = ${workspaceId} AND rule_id = ${ruleId} ORDER BY version`.execute(
      db(),
    );
    return rows.map((r) => ({
      ruleId: r.rule_id,
      version: r.version,
      snapshot: json(r.snapshot),
      createdAt: r.created_at,
      createdBy: r.created_by,
    }));
  }

  async names(workspaceId: string, ids: readonly string[]): Promise<RuleNameRecord[]> {
    if (ids.length === 0) return [];
    const { rows } = await sql<{ id: string; name: string; archived: boolean; version: number }>`
      SELECT id, name, (archived_at IS NOT NULL) AS archived, version
        FROM rules.rule WHERE workspace_id = ${workspaceId} AND id = ANY (${[...ids]}::uuid[])`.execute(db());
    return rows.map((r) => ({ ruleId: r.id, name: r.name, archived: r.archived, version: r.version }));
  }
}

/** Violación del índice único del nombre ⇒ `NAME_TAKEN` (la aplicación ya lo valida; esta es la defensa). */
function translate(err: unknown, name: string): unknown {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23505' && e.constraint === 'rule_name_uk') {
    return new DomainError('NAME_TAKEN', `a rule named '${name}' already exists`).at('/name');
  }
  return err;
}

interface DecisionRow {
  suggestion_id: string;
  pattern_type: RuleProposalDecisionRecord['patternType'];
  pattern_value: string;
  kind: RuleProposalDecisionRecord['kind'];
  category_id: string;
  decision: 'ACCEPTED' | 'DISMISSED';
  rule_id: string | null;
  support: number | null;
  evidence_count: number | null;
  confidence: string | null;
  decided_at: string;
  decided_by: string;
}

const DECISION_COLUMNS = sql`suggestion_id, pattern_type, pattern_value, kind, category_id, decision, rule_id, support,
  evidence_count, confidence::text AS confidence, decided_by, ${iso('decided_at')} AS decided_at`;

const decisionOf = (r: DecisionRow): RuleProposalDecisionRecord => ({
  suggestionId: r.suggestion_id,
  patternType: r.pattern_type,
  patternValue: r.pattern_value,
  kind: r.kind,
  categoryId: r.category_id,
  decision: r.decision,
  ruleId: r.rule_id,
  support: r.support,
  evidenceCount: r.evidence_count,
  confidence: r.confidence,
  decidedAt: r.decided_at,
  decidedBy: r.decided_by,
});

/** Decisiones sobre sugerencias de reglas (`rules.rule_suggestion_decision`, RLS forzada por workspace). */
export class PgRuleProposalDecisionRepository implements RuleProposalDecisionRepository {
  async list(workspaceId: string): Promise<RuleProposalDecisionRecord[]> {
    const { rows } = await sql<DecisionRow>`
      SELECT ${DECISION_COLUMNS} FROM rules.rule_suggestion_decision
       WHERE workspace_id = ${workspaceId} ORDER BY suggestion_id`.execute(db());
    return rows.map(decisionOf);
  }

  async find(workspaceId: string, suggestionId: string): Promise<RuleProposalDecisionRecord | null> {
    const { rows } = await sql<DecisionRow>`
      SELECT ${DECISION_COLUMNS} FROM rules.rule_suggestion_decision
       WHERE workspace_id = ${workspaceId} AND suggestion_id = ${suggestionId}`.execute(db());
    return rows[0] ? decisionOf(rows[0]) : null;
  }

  /** Atómico: la clave primaria `(workspace_id, suggestion_id)` serializa las decisiones concurrentes. */
  async insert(workspaceId: string, r: RuleProposalDecisionRecord): Promise<boolean> {
    const result = await sql`
      INSERT INTO rules.rule_suggestion_decision (workspace_id, suggestion_id, pattern_type, pattern_value, kind,
                                                  category_id, decision, rule_id, support, evidence_count, confidence,
                                                  decided_at, decided_by)
      VALUES (${workspaceId}, ${r.suggestionId}, ${r.patternType}, ${r.patternValue}, ${r.kind}, ${r.categoryId},
              ${r.decision}, ${r.ruleId}, ${r.support}, ${r.evidenceCount}, ${r.confidence}::numeric,
              ${r.decidedAt}::timestamptz, ${r.decidedBy})
      ON CONFLICT (workspace_id, suggestion_id) DO NOTHING`.execute(db());
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async deleteDismissed(workspaceId: string, suggestionId: string): Promise<boolean> {
    const result = await sql`
      DELETE FROM rules.rule_suggestion_decision
       WHERE workspace_id = ${workspaceId} AND suggestion_id = ${suggestionId} AND decision = 'DISMISSED'`.execute(
      db(),
    );
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async acceptedByRules(workspaceId: string, ruleIds: readonly string[]) {
    if (ruleIds.length === 0) return new Map<string, { suggestionId: string; acceptedAt: string }>();
    const { rows } = await sql<{ rule_id: string; suggestion_id: string; decided_at: string }>`
      SELECT rule_id, suggestion_id, ${iso('decided_at')} AS decided_at
        FROM rules.rule_suggestion_decision
       WHERE workspace_id = ${workspaceId} AND decision = 'ACCEPTED' AND rule_id = ANY (${[...ruleIds]}::uuid[])`.execute(
      db(),
    );
    return new Map(rows.map((r) => [r.rule_id, { suggestionId: r.suggestion_id, acceptedAt: r.decided_at }]));
  }
}
