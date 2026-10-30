import type { AuditChangeInput, AuditEntry } from '@pf/audit/contracts';
import { DomainError, normalizeText } from '@pf/shared-kernel';
import {
  Rule,
  parseDefinition,
  parseTriggers,
  ruleStatus,
  type RuleDefinition,
  type RuleState,
} from '../domain/index.js';
import type { RulesDeps } from './ports/index.js';

export interface CreateRuleCommand {
  readonly id?: string;
  readonly name: unknown;
  readonly description?: unknown;
  readonly priority?: unknown;
  readonly matchMode?: unknown;
  readonly conditions?: unknown;
  readonly actions?: unknown;
  readonly triggers?: unknown;
  readonly stopProcessing?: unknown;
}

/** Merge-patch de una regla: lo ausente no cambia; la definición se reemplaza por campo. */
export interface UpdateRuleCommand {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly priority?: unknown;
  readonly matchMode?: unknown;
  readonly conditions?: unknown;
  readonly actions?: unknown;
  readonly triggers?: unknown;
  readonly stopProcessing?: unknown;
}

const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `rule ${id} not found`);

type Snap = Readonly<Record<string, unknown>>;

/** Vista auditable de una regla: los valores compuestos viajan como texto JSON (allow-list de AUDIT). */
export function ruleAuditView(s: RuleState): Snap {
  return {
    name: s.name,
    description: s.description,
    priority: s.priority,
    status: ruleStatus(s),
    triggers: s.triggers.join(','),
    matchMode: s.matchMode,
    conditions: JSON.stringify(s.conditions),
    actions: JSON.stringify(s.actions),
    stopProcessing: s.stopProcessing,
    version: s.version,
  };
}

const AUDIT_FIELDS = [
  'name',
  'description',
  'priority',
  'status',
  'triggers',
  'matchMode',
  'conditions',
  'actions',
  'stopProcessing',
  'version',
] as const;

function diff(before: Snap | null, after: Snap): AuditChangeInput[] {
  return AUDIT_FIELDS.filter(
    (f) => JSON.stringify(before?.[f] ?? null) !== JSON.stringify(after[f] ?? null),
  ).map((f) => ({ field: f, before: before?.[f] ?? null, after: after[f] ?? null }));
}

/**
 * Casos de uso (comandos) de RULES (openspec add-rule-engine). Cada mutación se audita en la misma unidad de trabajo
 * (INV-029); la autorización por rol la aplica el guard de la API (`x-required-role`). No hay eliminación: se archiva.
 */
export class RulesService {
  constructor(private readonly deps: RulesDeps) {}

  private now(): string {
    return this.deps.clock.now().toString();
  }

  private async audit(
    userId: string,
    entry: Omit<AuditEntry, 'actor'> & { readonly changes: readonly AuditChangeInput[] },
  ): Promise<void> {
    await this.deps.audit.append({ ...entry, actor: { type: 'USER', userId } });
  }

  private definitionOf(s: RuleDefinition, patch: UpdateRuleCommand): RuleDefinition {
    return parseDefinition({
      matchMode: patch.matchMode ?? s.matchMode,
      conditions: patch.conditions ?? s.conditions,
      actions: patch.actions ?? s.actions,
      triggers: patch.triggers === undefined ? s.triggers : parseTriggers(patch.triggers),
      stopProcessing: patch.stopProcessing ?? s.stopProcessing,
    });
  }

  private async assertNameFree(workspaceId: string, rule: Rule): Promise<void> {
    if (rule.isArchived) return;
    const key = normalizeText(rule.snapshot.name);
    const all = await this.deps.rules.listAll(workspaceId, { includeArchived: false });
    if (all.some((r) => r.id !== rule.id && normalizeText(r.snapshot.name) === key)) {
      throw new DomainError('NAME_TAKEN', `a rule named '${rule.snapshot.name}' already exists`).at('/name');
    }
  }

  private async load(workspaceId: string, id: string, expectedRowVersion?: number): Promise<Rule> {
    const rule = await this.deps.rules.findById(workspaceId, id);
    if (!rule) throw notFound(id);
    if (expectedRowVersion !== undefined && rule.snapshot.rowVersion !== expectedRowVersion) {
      throw preconditionFailed(rule.snapshot.rowVersion);
    }
    return rule;
  }

  private async save(rule: Rule, expectedRowVersion: number): Promise<void> {
    if (!(await this.deps.rules.update(rule, expectedRowVersion))) {
      const current = await this.deps.rules.findById(rule.snapshot.workspaceId, rule.id);
      throw preconditionFailed(current?.snapshot.rowVersion);
    }
  }

  // ------------------------------------------------------------------ comandos

  async createRule(userId: string, workspaceId: string, cmd: CreateRuleCommand): Promise<RuleState> {
    return this.deps.uow.run(workspaceId, async () => {
      const definition = parseDefinition(cmd);
      const rule = Rule.create({
        id: cmd.id ?? this.deps.ids.next(),
        workspaceId,
        name: cmd.name,
        description: cmd.description,
        priority: cmd.priority,
        definition,
        createdBy: userId,
        now: this.now(),
      });
      if ((await this.deps.rules.countNonArchived(workspaceId)) >= this.deps.settings.maxRules) {
        throw new DomainError(
          'RULE_LIMIT_EXCEEDED',
          `a workspace has at most ${this.deps.settings.maxRules} non-archived rules`,
        );
      }
      await this.assertNameFree(workspaceId, rule);
      await this.deps.catalog.assertActions({ workspaceId, actions: definition.actions });
      await this.deps.rules.insert(rule, userId);
      await this.deps.rules.insertVersion(rule.snapshot, userId);
      await this.audit(userId, {
        workspaceId,
        action: 'rules.rule.created',
        aggregateType: 'Rule',
        aggregateId: rule.id,
        aggregateVersion: rule.snapshot.version,
        changes: diff(null, ruleAuditView(rule.snapshot)),
      });
      return rule.snapshot;
    });
  }

  async updateRule(
    userId: string,
    workspaceId: string,
    id: string,
    expectedRowVersion: number,
    patch: UpdateRuleCommand,
  ): Promise<RuleState> {
    return this.deps.uow.run(workspaceId, async () => {
      const rule = await this.load(workspaceId, id, expectedRowVersion);
      const before = ruleAuditView(rule.snapshot);
      const touchesDefinition = ['matchMode', 'conditions', 'actions', 'triggers', 'stopProcessing'].some(
        (k) => (patch as Record<string, unknown>)[k] !== undefined,
      );
      const definition = touchesDefinition ? this.definitionOf(rule.snapshot, patch) : undefined;
      const result = rule.update(
        {
          ...(patch.name !== undefined ? { name: patch.name as string } : {}),
          ...(patch.description !== undefined ? { description: patch.description as string | null } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority as number } : {}),
          ...(definition ? { definition } : {}),
        },
        this.now(),
      );
      if (!result.changed) return rule.snapshot;
      await this.assertNameFree(workspaceId, rule);
      if (result.definitionChanged) {
        await this.deps.catalog.assertActions({ workspaceId, actions: rule.snapshot.actions });
      }
      await this.save(rule, expectedRowVersion);
      if (result.definitionChanged) await this.deps.rules.insertVersion(rule.snapshot, userId);
      await this.audit(userId, {
        workspaceId,
        action: 'rules.rule.updated',
        aggregateType: 'Rule',
        aggregateId: rule.id,
        aggregateVersion: rule.snapshot.version,
        changes: diff(before, ruleAuditView(rule.snapshot)),
      });
      return rule.snapshot;
    });
  }

  private async transition(
    userId: string,
    workspaceId: string,
    id: string,
    expectedRowVersion: number,
    action: 'enabled' | 'disabled' | 'archived',
  ): Promise<RuleState> {
    return this.deps.uow.run(workspaceId, async () => {
      const rule = await this.load(workspaceId, id, expectedRowVersion);
      const before = ruleAuditView(rule.snapshot);
      const now = this.now();
      const changed =
        action === 'enabled'
          ? rule.enable(now)
          : action === 'disabled'
            ? rule.disable(now)
            : rule.archive(now);
      if (!changed) return rule.snapshot;
      await this.save(rule, expectedRowVersion);
      await this.audit(userId, {
        workspaceId,
        action: `rules.rule.${action}`,
        aggregateType: 'Rule',
        aggregateId: rule.id,
        aggregateVersion: rule.snapshot.version,
        changes: diff(before, ruleAuditView(rule.snapshot)),
      });
      return rule.snapshot;
    });
  }

  enableRule(userId: string, workspaceId: string, id: string, expectedRowVersion: number) {
    return this.transition(userId, workspaceId, id, expectedRowVersion, 'enabled');
  }

  disableRule(userId: string, workspaceId: string, id: string, expectedRowVersion: number) {
    return this.transition(userId, workspaceId, id, expectedRowVersion, 'disabled');
  }

  archiveRule(userId: string, workspaceId: string, id: string, expectedRowVersion: number) {
    return this.transition(userId, workspaceId, id, expectedRowVersion, 'archived');
  }

  /**
   * Reordena TODAS las reglas no archivadas: asigna prioridades 10, 20, 30… en el orden dado. No versiona; audita el
   * cambio de prioridad de cada regla movida (valor anterior y nuevo) con una correlación común.
   */
  async reorderRules(userId: string, workspaceId: string, ruleIds: readonly string[]): Promise<RuleState[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const current = await this.deps.rules.listAll(workspaceId, { includeArchived: false });
      const wanted = new Set(ruleIds);
      if (
        wanted.size !== ruleIds.length ||
        ruleIds.length !== current.length ||
        current.some((r) => !wanted.has(r.id))
      ) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'ruleIds must list every non-archived rule exactly once',
        ).at('/ruleIds');
      }
      const byId = new Map(current.map((r) => [r.id, r]));
      const correlationId = this.deps.ids.next();
      const now = this.now();
      const moved: Rule[] = [];
      for (const [i, id] of ruleIds.entries()) {
        const rule = byId.get(id) as Rule;
        const before = ruleAuditView(rule.snapshot);
        const expected = rule.snapshot.rowVersion;
        if (!rule.reprioritize((i + 1) * 10, now)) continue;
        await this.save(rule, expected);
        moved.push(rule);
        await this.audit(userId, {
          workspaceId,
          action: 'rules.rule.reordered',
          aggregateType: 'Rule',
          aggregateId: rule.id,
          aggregateVersion: rule.snapshot.version,
          correlationId,
          changes: diff(before, ruleAuditView(rule.snapshot)),
        });
      }
      if (moved.length > 0) {
        await this.audit(userId, {
          workspaceId,
          action: 'rules.order.changed',
          aggregateType: 'RuleOrder',
          aggregateId: correlationId,
          correlationId,
          changes: [
            { field: 'ruleIds', before: null, after: JSON.stringify(ruleIds) },
            { field: 'count', before: null, after: moved.length },
          ],
        });
      }
      return ruleIds.map((id) => (byId.get(id) as Rule).snapshot);
    });
  }
}
