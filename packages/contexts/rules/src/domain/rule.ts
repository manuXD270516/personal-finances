import { DomainError } from '@pf/shared-kernel';
import { sameDefinition, type RuleDefinition } from './rule-definition.js';
import { MAX_DESCRIPTION, MAX_NAME, MAX_PRIORITY, RULE_SCHEMA_VERSION } from './types.js';

export type RuleStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface RuleState extends RuleDefinition {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly priority: number;
  readonly enabled: boolean;
  readonly archivedAt: string | null;
  /** Última verificación de destinos archivados (se recalcula al leer; ver `RulesQueries`). */
  readonly needsAttention: boolean;
  readonly schemaVersion: number;
  /** Versión de la DEFINICIÓN: sube solo con un cambio de condiciones, acciones, modo, disparadores o `stopProcessing`. */
  readonly version: number;
  /** Versión de la fila (`ETag`, `If-Match`): sube con cualquier cambio. */
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
}

export interface RulePatch {
  readonly name?: string;
  readonly description?: string | null;
  readonly priority?: number;
  readonly definition?: RuleDefinition;
}

export const ruleStatus = (s: Pick<RuleState, 'enabled' | 'archivedAt'>): RuleStatus =>
  s.archivedAt !== null ? 'ARCHIVED' : s.enabled ? 'ACTIVE' : 'INACTIVE';

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

export function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') throw invalid('name is required', '/name');
  const name = raw.trim().replace(/\s+/gu, ' ');
  if (name.length === 0 || name.length > MAX_NAME) {
    throw invalid(`name must have between 1 and ${MAX_NAME} characters`, '/name');
  }
  return name;
}

export function normalizeDescription(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || raw.length > MAX_DESCRIPTION) {
    throw invalid(`description must be at most ${MAX_DESCRIPTION} characters`, '/description');
  }
  const text = raw.trim();
  return text.length === 0 ? null : text;
}

export function normalizePriority(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_PRIORITY) {
    throw invalid(`priority must be an integer between 0 and ${MAX_PRIORITY}`, '/priority');
  }
  return raw;
}

const archivedError = () =>
  new DomainError('INVALID_STATUS_TRANSITION', 'an archived rule cannot be modified');

/**
 * AR `Rule` (openspec add-rule-engine): estados activo, inactivo y archivado (nunca se borra). Una definición nueva
 * crea una versión inmutable; nombre, descripción, prioridad y estado se auditan sin versión.
 */
export class Rule {
  private constructor(
    private state: RuleState,
    readonly persistedRowVersion: number | null,
  ) {}

  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly name: unknown;
    readonly description?: unknown;
    readonly priority?: unknown;
    readonly definition: RuleDefinition;
    readonly createdBy: string;
    readonly now: string;
  }): Rule {
    return new Rule(
      {
        ...input.definition,
        id: input.id,
        workspaceId: input.workspaceId,
        name: normalizeName(input.name),
        description: normalizeDescription(input.description),
        priority: input.priority === undefined ? 100 : normalizePriority(input.priority),
        enabled: true,
        archivedAt: null,
        needsAttention: false,
        schemaVersion: RULE_SCHEMA_VERSION,
        version: 1,
        rowVersion: 1,
        createdAt: input.now,
        createdBy: input.createdBy,
        updatedAt: input.now,
      },
      null,
    );
  }

  static rehydrate(state: RuleState): Rule {
    return new Rule(state, state.rowVersion);
  }

  get id(): string {
    return this.state.id;
  }
  get snapshot(): RuleState {
    return this.state;
  }
  get status(): RuleStatus {
    return ruleStatus(this.state);
  }
  get isArchived(): boolean {
    return this.state.archivedAt !== null;
  }

  /** Aplica un cambio parcial; devuelve si cambió la definición (⇒ versión nueva) y qué cambió. */
  update(patch: RulePatch, now: string): { readonly definitionChanged: boolean; readonly changed: boolean } {
    if (this.isArchived) throw archivedError();
    const s = this.state;
    let next: RuleState = s;
    if (patch.name !== undefined) next = { ...next, name: normalizeName(patch.name) };
    if (patch.description !== undefined)
      next = { ...next, description: normalizeDescription(patch.description) };
    if (patch.priority !== undefined) next = { ...next, priority: normalizePriority(patch.priority) };
    let definitionChanged = false;
    if (patch.definition !== undefined && !sameDefinition(patch.definition, s)) {
      definitionChanged = true;
      next = { ...next, ...patch.definition, version: s.version + 1, needsAttention: false };
    }
    const changed =
      definitionChanged ||
      next.name !== s.name ||
      next.description !== s.description ||
      next.priority !== s.priority;
    if (!changed) return { definitionChanged: false, changed: false };
    this.state = { ...next, rowVersion: s.rowVersion + 1, updatedAt: now };
    return { definitionChanged, changed: true };
  }

  enable(now: string): boolean {
    if (this.isArchived) throw archivedError();
    if (this.state.enabled) return false;
    this.state = { ...this.state, enabled: true, rowVersion: this.state.rowVersion + 1, updatedAt: now };
    return true;
  }

  disable(now: string): boolean {
    if (this.isArchived) throw archivedError();
    if (!this.state.enabled) return false;
    this.state = { ...this.state, enabled: false, rowVersion: this.state.rowVersion + 1, updatedAt: now };
    return true;
  }

  /** Archiva (la regla deja de evaluarse y libera su nombre); idempotente. */
  archive(now: string): boolean {
    if (this.isArchived) return false;
    this.state = {
      ...this.state,
      enabled: false,
      archivedAt: now,
      rowVersion: this.state.rowVersion + 1,
      updatedAt: now,
    };
    return true;
  }

  /** Cambia solo la prioridad (reordenar); no versiona. */
  reprioritize(priority: number, now: string): boolean {
    if (this.isArchived) throw archivedError();
    if (priority === this.state.priority) return false;
    this.state = {
      ...this.state,
      priority: normalizePriority(priority),
      rowVersion: this.state.rowVersion + 1,
      updatedAt: now,
    };
    return true;
  }

  /** Marca el resultado de la última verificación de destinos (no cambia la versión de la fila). */
  withAttention(needsAttention: boolean): RuleState {
    return { ...this.state, needsAttention };
  }
}
