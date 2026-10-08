import { DomainError, type Currency } from '@pf/shared-kernel';
import { BudgetLine, resolveLineSpec, type BudgetLineInput, type BudgetLineSpec } from './budget-line.js';
import type { BudgetOrigin, BudgetTarget } from './budget-types.js';
import { TargetOverlapPolicy, resolveTarget, type TargetTree } from './target-overlap-policy.js';

/** Estado persistible del plan (sin las líneas, que se cargan aparte). */
export interface BudgetState {
  readonly id: string;
  readonly workspaceId: string;
  readonly periodId: string;
  /** Moneda del plan = moneda base del workspace al crearlo (design decisión 1, docs/33 D78/D79). */
  readonly currency: string;
  readonly origin: BudgetOrigin;
  readonly templateVersionId: string | null;
  readonly clonedFromBudgetId: string | null;
  readonly zeroBased: boolean;
  readonly version: number;
  readonly createdAt: string | null;
}

/**
 * AR `Budget` (PLANNING, docs/04 §3.6; design.md decisión 1): el plan mensual de UN periodo financiero, en la moneda
 * base del workspace, con sus `BudgetLine`. No tiene estados propios: sigue al periodo (docs/33 D110, sin máquina de
 * recorrido); la historia queda en el audit log. Las reglas que cruzan líneas (objetivo repetido, solapamientos, tipo
 * según naturaleza) viven aquí.
 */
export class Budget {
  private constructor(
    private state: BudgetState,
    private lineList: BudgetLine[],
    private persisted: number,
  ) {}

  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly periodId: string;
    readonly currency: Currency;
    readonly zeroBased?: boolean;
    readonly origin?: BudgetOrigin;
    readonly templateVersionId?: string | null;
    readonly clonedFromBudgetId?: string | null;
    readonly at: string;
  }): Budget {
    return new Budget(
      {
        id: input.id,
        workspaceId: input.workspaceId,
        periodId: input.periodId,
        currency: input.currency.code,
        origin: input.origin ?? 'EMPTY',
        templateVersionId: input.templateVersionId ?? null,
        clonedFromBudgetId: input.clonedFromBudgetId ?? null,
        zeroBased: input.zeroBased ?? false,
        version: 1,
        createdAt: input.at,
      },
      [],
      0,
    );
  }

  static restore(state: BudgetState, lines: readonly BudgetLine[]): Budget {
    return new Budget({ ...state }, [...lines], state.version);
  }

  /** Versión que tiene la BD (control optimista del repositorio). */
  get persistedVersion(): number {
    return this.persisted;
  }

  /** El repositorio guardó el plan: la versión persistida es ahora la vigente. */
  markPersisted(): void {
    this.persisted = this.state.version;
  }

  get id(): string {
    return this.state.id;
  }
  get workspaceId(): string {
    return this.state.workspaceId;
  }
  get periodId(): string {
    return this.state.periodId;
  }
  get version(): number {
    return this.state.version;
  }
  get zeroBased(): boolean {
    return this.state.zeroBased;
  }
  get snapshot(): BudgetState {
    return { ...this.state };
  }
  get lines(): readonly BudgetLine[] {
    return this.lineList;
  }

  line(lineId: string): BudgetLine | undefined {
    return this.lineList.find((l) => l.id === lineId);
  }

  /**
   * `AddBudgetLine`: resuelve el objetivo contra el catálogo (existente, activo; naturaleza), valida la especificación
   * y las reglas de plan (objetivo único y sin solapamientos). Devuelve la línea nueva.
   */
  addLine(input: {
    readonly lineId: string;
    readonly target: BudgetTarget;
    readonly spec: BudgetLineInput;
    readonly currency: Currency;
    readonly tree: TargetTree;
  }): BudgetLine {
    const { nature } = resolveTarget(input.tree, input.target);
    const spec = resolveLineSpec(input.spec, input.currency, nature);
    TargetOverlapPolicy.assertAllowed(
      this.lineList.map((l) => l.target),
      input.target,
      input.tree,
    );
    const line = BudgetLine.create({
      id: input.lineId,
      workspaceId: this.state.workspaceId,
      budgetId: this.state.id,
      target: input.target,
      nature,
      spec,
    });
    this.lineList = [...this.lineList, line];
    this.bump();
    return line;
  }

  /** `UpdateBudgetLine`: el parche se mezcla con la línea vigente y se revalida completo. */
  updateLine(input: {
    readonly lineId: string;
    readonly expectedVersion: number;
    readonly patch: BudgetLineInput;
    readonly currency: Currency;
  }): { readonly before: BudgetLine; readonly after: BudgetLine } {
    const before = this.line(input.lineId);
    if (!before) throw new DomainError('RESOURCE_NOT_FOUND', `budget line ${input.lineId} not found`);
    if (before.version !== input.expectedVersion) {
      throw new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
        details: { currentVersion: before.version },
      });
    }
    const merged = mergeInput(before.spec, input.patch, input.currency.code);
    const spec: BudgetLineSpec = resolveLineSpec(merged, input.currency, before.nature);
    const after = before.withSpec(spec);
    this.lineList = this.lineList.map((l) => (l.id === before.id ? after : l));
    this.bump();
    return { before, after };
  }

  /**
   * Incorpora líneas ya validadas de una versión de template o del plan anterior (add-budget-templates decisiones 2 y
   * 4): el origen garantiza objetivos únicos y sin solapamientos; no suben la versión (el plan nace con ellas).
   */
  seedLines(lines: readonly BudgetLine[]): void {
    this.lineList = [...this.lineList, ...lines];
  }

  /** Propagación: línea nueva proveniente del template (no cuenta como edición manual). */
  attachTemplateLine(line: BudgetLine): void {
    this.lineList = [...this.lineList, line];
    this.bump();
  }

  /** Propagación: reemplaza una línea por la de la versión nueva del template. */
  replaceTemplateLine(line: BudgetLine): void {
    this.lineList = this.lineList.map((l) => (l.id === line.id ? line : l));
    this.bump();
  }

  /** Propagación: el plan pasa a apuntar a la versión nueva del template. */
  adoptTemplateVersion(templateVersionId: string): void {
    this.state = { ...this.state, templateVersionId };
    this.bump();
  }

  removeLine(lineId: string): BudgetLine {
    const line = this.line(lineId);
    if (!line) throw new DomainError('RESOURCE_NOT_FOUND', `budget line ${lineId} not found`);
    this.lineList = this.lineList.filter((l) => l.id !== lineId);
    this.bump();
    return line;
  }

  /** `SetZeroBasedMode`. */
  setZeroBased(zeroBased: boolean): boolean {
    if (this.state.zeroBased === zeroBased) return false;
    this.state = { ...this.state, zeroBased };
    this.bump();
    return true;
  }

  /** Reemplaza una línea ya persistida (rollover congelado por el consumidor) y sube la versión del plan. */
  replaceLine(line: BudgetLine): void {
    this.lineList = this.lineList.map((l) => (l.id === line.id ? line : l));
  }

  /** Sube la versión del plan (cambio hecho por el sistema: rollover congelado o provisional). */
  touch(): void {
    this.bump();
  }

  private bump(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
  }
}

/** Mezcla un parche (campos presentes, incluidos los `null` explícitos) sobre la especificación vigente. */
function mergeInput(current: BudgetLineSpec, patch: BudgetLineInput, currencyCode: string): BudgetLineInput {
  const money = (amount: string | null) => (amount === null ? null : { amount, currency: currencyCode });
  const has = (key: keyof BudgetLineInput) => Object.prototype.hasOwnProperty.call(patch, key);
  const kind = has('kind') ? patch.kind : current.kind;
  const kindChanged = has('kind') && patch.kind !== current.kind;
  // Al cambiar de tipo no se heredan los montos del tipo anterior (cada tipo exige su propio conjunto de campos).
  const inherit = <T>(key: keyof BudgetLineInput, fallback: T): unknown =>
    has(key) ? patch[key] : kindChanged ? null : fallback;
  return {
    kind,
    planned: inherit('planned', money(current.planned)) as BudgetLineInput['planned'],
    min: inherit('min', money(current.min)) as BudgetLineInput['min'],
    max: inherit('max', money(current.max)) as BudgetLineInput['max'],
    percent: inherit('percent', current.percent) as BudgetLineInput['percent'],
    incomeBasis: inherit('incomeBasis', current.incomeBasis) as BudgetLineInput['incomeBasis'],
    rolloverPolicy: has('rolloverPolicy') ? patch.rolloverPolicy : current.rolloverPolicy,
    rolloverCap: has('rolloverCap') ? patch.rolloverCap : money(current.rolloverCap),
    thresholds: has('thresholds') ? patch.thresholds : kindChanged ? null : current.thresholds,
  };
}
