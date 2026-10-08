import { DomainError, type Currency } from '@pf/shared-kernel';
import { resolveLineSpec, type BudgetLineInput, type BudgetLineSpec } from './budget-line.js';
import { isTargetKind, type BudgetNature, type BudgetTarget } from './budget-types.js';
import { TargetOverlapPolicy, resolveTarget, type TargetTree } from './target-overlap-policy.js';

export type TemplateStatus = 'ACTIVE' | 'ARCHIVED';

/** Línea de una versión de template (design § Modelo de datos): el mismo valor que valida `BudgetLine`, con moneda. */
export interface TemplateLine {
  readonly id: string;
  readonly target: BudgetTarget;
  readonly nature: BudgetNature;
  readonly spec: BudgetLineSpec;
  /** Moneda de los montos (la moneda base del workspace al publicar la versión; docs/33 D79). */
  readonly currency: string;
}

/** Versión inmutable de un template: instantánea completa de sus líneas (design decisión 1). */
export interface TemplateVersion {
  readonly id: string;
  readonly versionNo: number;
  readonly basedOnVersionNo: number | null;
  readonly changeNote: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly lines: readonly TemplateLine[];
}

export interface BudgetTemplateState {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly isDefault: boolean;
  readonly status: TemplateStatus;
  readonly currentVersionNo: number;
  readonly version: number;
  readonly createdAt: string;
}

/** Entrada de una línea de template (cuerpo de `createTemplate` / `publishTemplateVersion`). */
export interface TemplateLineInput extends BudgetLineInput {
  readonly target?: unknown;
}

const validation = (detail: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', detail).at(pointer);

export function parseTemplateName(raw: unknown): string {
  if (typeof raw !== 'string') throw validation('name is required', '/name');
  const name = raw.trim();
  if (name.length < 1 || name.length > 120) throw validation('name must have 1 to 120 characters', '/name');
  return name;
}

export function parseOptionalText(raw: unknown, field: string, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw validation(`${field} must be a string`, `/${field}`);
  const text = raw.trim();
  if (text === '') return null;
  if (text.length > max) throw validation(`${field} must have at most ${max} characters`, `/${field}`);
  return text;
}

/** Misma especificación (los montos ya están a la escala canónica de la moneda). */
export const sameSpec = (a: BudgetLineSpec, b: BudgetLineSpec): boolean =>
  a.kind === b.kind &&
  a.planned === b.planned &&
  a.min === b.min &&
  a.max === b.max &&
  a.percent === b.percent &&
  a.incomeBasis === b.incomeBasis &&
  a.rolloverPolicy === b.rolloverPolicy &&
  a.rolloverCap === b.rolloverCap &&
  a.thresholds.length === b.thresholds.length &&
  a.thresholds.every((t, i) => t === b.thresholds[i]);

export const targetKey = (t: BudgetTarget): string => `${t.kind}:${t.id}`;

function parseTarget(raw: unknown, pointer: string): BudgetTarget {
  const target = raw as { kind?: unknown; id?: unknown } | null | undefined;
  if (!target || !isTargetKind(target.kind) || typeof target.id !== 'string' || target.id === '') {
    throw validation('target must be {kind: CATEGORY|GROUP|TAG, id}', `${pointer}/target`);
  }
  return { kind: target.kind, id: target.id };
}

/**
 * Valida las líneas de una versión nueva con las MISMAS reglas que el plan (`add-budgets`: montos, moneda base,
 * escala, tipos, umbrales, objetivo único y sin solapamientos) y devuelve la instantánea. Los objetivos archivados se
 * rechazan (`CATEGORY_ARCHIVED` / `TAG_ARCHIVED`) SOLO en líneas nuevas o cambiadas: una línea idéntica a la de la
 * versión base se conserva aunque su objetivo se haya archivado después (se omite al aplicar; design decisión 3).
 */
export function buildTemplateLines(input: {
  readonly lines: unknown;
  readonly currency: Currency;
  readonly tree: TargetTree;
  readonly base: readonly TemplateLine[];
  readonly nextId: () => string;
}): TemplateLine[] {
  if (!Array.isArray(input.lines)) throw validation('lines must be an array', '/lines');
  const out: TemplateLine[] = [];
  const kept: BudgetTarget[] = [];
  (input.lines as readonly TemplateLineInput[]).forEach((raw, index) => {
    const pointer = `/lines/${index}`;
    if (typeof raw !== 'object' || raw === null) throw validation('line must be an object', pointer);
    const target = parseTarget(raw.target, pointer);
    const previous = input.base.find((l) => l.target.kind === target.kind && l.target.id === target.id);
    let nature: BudgetNature;
    let spec: BudgetLineSpec;
    if (previous) {
      spec = resolveLineSpec(raw, input.currency, previous.nature);
      nature = previous.nature;
      if (!sameSpec(spec, previous.spec) || previous.currency !== input.currency.code) {
        nature = resolveTarget(input.tree, target).nature;
        spec = resolveLineSpec(raw, input.currency, nature);
      }
    } else {
      nature = resolveTarget(input.tree, target).nature;
      spec = resolveLineSpec(raw, input.currency, nature);
    }
    TargetOverlapPolicy.assertAllowed(kept, target, input.tree);
    kept.push(target);
    out.push({ id: input.nextId(), target, nature, spec, currency: input.currency.code });
  });
  return out;
}

/**
 * AR `BudgetTemplate` (PLANNING, docs/04 §3.6; design.md decisión 1): nombre, estado, predeterminado y la versión
 * vigente (instantánea completa). Las versiones anteriores se leen aparte y NUNCA cambian (la BD las hace WS-RO).
 */
export class BudgetTemplate {
  private constructor(
    private state: BudgetTemplateState,
    private current: TemplateVersion,
    private persisted: number,
  ) {}

  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly name: string;
    readonly description: string | null;
    readonly firstVersion: TemplateVersion;
    readonly at: string;
  }): BudgetTemplate {
    return new BudgetTemplate(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description,
        isDefault: false,
        status: 'ACTIVE',
        currentVersionNo: 1,
        version: 1,
        createdAt: input.at,
      },
      input.firstVersion,
      0,
    );
  }

  static restore(state: BudgetTemplateState, current: TemplateVersion): BudgetTemplate {
    return new BudgetTemplate({ ...state }, current, state.version);
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get name(): string {
    return this.state.name;
  }
  get status(): TemplateStatus {
    return this.state.status;
  }
  get isDefault(): boolean {
    return this.state.isDefault;
  }
  get currentVersionNo(): number {
    return this.state.currentVersionNo;
  }
  get version(): number {
    return this.state.version;
  }
  get persistedVersion(): number {
    return this.persisted;
  }
  get snapshot(): BudgetTemplateState {
    return { ...this.state };
  }
  /** Última versión (la vigente). */
  get currentVersion(): TemplateVersion {
    return this.current;
  }

  markPersisted(): void {
    this.persisted = this.state.version;
  }

  /** Rechaza operar (aplicar, versionar, predeterminar) sobre un template archivado. */
  assertActive(): void {
    if (this.state.status === 'ARCHIVED') {
      throw new DomainError('BUDGET_TEMPLATE_ARCHIVED', `template ${this.state.name} is archived`);
    }
  }

  /**
   * `PublishTemplateVersion`: versión N+1 con el conjunto completo de líneas. `baseVersionNo` distinto de la vigente
   * => `CONCURRENCY_CONFLICT` (409) y no se crea la versión.
   */
  publishVersion(input: {
    readonly baseVersionNo: number;
    readonly versionId: string;
    readonly lines: readonly TemplateLine[];
    readonly changeNote: string | null;
    readonly by: string | null;
    readonly at: string;
  }): TemplateVersion {
    this.assertActive();
    if (input.baseVersionNo !== this.state.currentVersionNo) {
      throw new DomainError(
        'CONCURRENCY_CONFLICT',
        `template ${this.state.name} is at version ${this.state.currentVersionNo}, not ${input.baseVersionNo}`,
        { details: { currentVersionNo: this.state.currentVersionNo } },
      );
    }
    const next: TemplateVersion = {
      id: input.versionId,
      versionNo: this.state.currentVersionNo + 1,
      basedOnVersionNo: input.baseVersionNo,
      changeNote: input.changeNote,
      createdAt: input.at,
      createdBy: input.by,
      lines: input.lines,
    };
    this.current = next;
    this.state = { ...this.state, currentVersionNo: next.versionNo, version: this.state.version + 1 };
    return next;
  }

  /** `ArchiveTemplate`: deja de ser predeterminado; devuelve si hubo cambio. */
  archive(): boolean {
    if (this.state.status === 'ARCHIVED') return false;
    this.state = { ...this.state, status: 'ARCHIVED', isDefault: false, version: this.state.version + 1 };
    return true;
  }

  unarchive(): boolean {
    if (this.state.status === 'ACTIVE') return false;
    this.state = { ...this.state, status: 'ACTIVE', version: this.state.version + 1 };
    return true;
  }

  /** `SetDefaultTemplate`: archivado => `BUDGET_TEMPLATE_ARCHIVED`; devuelve si hubo cambio. */
  setDefault(): boolean {
    this.assertActive();
    if (this.state.isDefault) return false;
    this.state = { ...this.state, isDefault: true, version: this.state.version + 1 };
    return true;
  }

  clearDefault(): void {
    if (!this.state.isDefault) return;
    this.state = { ...this.state, isDefault: false, version: this.state.version + 1 };
  }
}
