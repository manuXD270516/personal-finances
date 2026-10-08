import { DomainError, dec, Money, type Currency, type Decimal } from '@pf/shared-kernel';
import {
  DEFAULT_THRESHOLDS,
  INCOME_BASES,
  ROLLOVER_KINDS,
  ROLLOVER_POLICIES,
  THRESHOLD_KINDS,
  isBudgetLineKind,
  type BudgetLineKind,
  type BudgetLineSource,
  type BudgetNature,
  type BudgetTarget,
  type IncomeBasis,
  type RolloverPolicy,
  type RolloverStatus,
} from './budget-types.js';
import { normalizeThresholds } from './thresholds.js';

/** Monto tal como llega por la API: string decimal + moneda (ADR-0006). */
export interface MoneyInput {
  readonly amount: string;
  readonly currency: string;
}

/** Entrada de creación o parche de una línea (cuerpo de `addBudgetLine` / `updateBudgetLine`). */
export interface BudgetLineInput {
  readonly kind?: unknown;
  readonly planned?: MoneyInput | null | undefined;
  readonly min?: MoneyInput | null | undefined;
  readonly max?: MoneyInput | null | undefined;
  readonly percent?: string | null | undefined;
  readonly incomeBasis?: string | null | undefined;
  readonly rolloverPolicy?: string | null | undefined;
  readonly rolloverCap?: MoneyInput | null | undefined;
  readonly thresholds?: readonly unknown[] | null | undefined;
}

/** Especificación validada de una línea (sin identidad): todo lo que define su comportamiento. */
export interface BudgetLineSpec {
  readonly kind: BudgetLineKind;
  /** Planificado de `FIXED` / `MAXIMUM` en la moneda del plan (string decimal canónico a su escala). */
  readonly planned: string | null;
  readonly min: string | null;
  readonly max: string | null;
  /** `PERCENT_OF_INCOME`: porcentaje (0, 100] con hasta 4 decimales. */
  readonly percent: string | null;
  readonly incomeBasis: IncomeBasis | null;
  readonly rolloverPolicy: RolloverPolicy;
  readonly rolloverCap: string | null;
  readonly thresholds: readonly string[];
}

/** Estado persistible de una `BudgetLine`. */
export interface BudgetLineState extends BudgetLineSpec {
  readonly id: string;
  readonly workspaceId: string;
  readonly budgetId: string;
  readonly target: BudgetTarget;
  readonly nature: BudgetNature;
  /** Remanente recibido del periodo anterior (definitivo cuando `rolloverStatus` es `FINAL`). */
  readonly rolloverInAmount: string | null;
  readonly rolloverStatus: RolloverStatus;
  readonly source: BudgetLineSource;
  readonly templateLineId: string | null;
  readonly overridden: boolean;
  readonly version: number;
}

const invalidAmounts = (detail: string, pointer: string) =>
  new DomainError('BUDGET_INVALID_AMOUNTS', detail).at(pointer);
const invalidKind = (detail: string, pointer: string) =>
  new DomainError('BUDGET_INVALID_LINE_KIND', detail).at(pointer);
const validation = (detail: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', detail).at(pointer);

/** Monto de la línea: moneda del plan (`CURRENCY_MISMATCH`), escala (`AMOUNT_SCALE_EXCEEDED`), no negativo. */
function parseMoney(input: MoneyInput, currency: Currency, pointer: string): Money {
  if (typeof input !== 'object' || input === null || typeof input.amount !== 'string') {
    throw validation('amount must be {amount, currency}', pointer);
  }
  if (input.currency !== currency.code) {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `the plan is in ${currency.code}; got ${String(input.currency)}`,
    ).at(`${pointer}/currency`);
  }
  let money: Money;
  try {
    money = Money.parse(input.amount, currency);
  } catch (err) {
    if (err instanceof DomainError) throw err.at(`${pointer}/amount`);
    throw err;
  }
  if (money.isNegative()) throw invalidAmounts('amounts must not be negative', `${pointer}/amount`);
  return money;
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function parsePercent(raw: unknown): Decimal {
  if (typeof raw !== 'string' || !DECIMAL.test(raw)) {
    throw validation('percent must be a decimal string', '/percent');
  }
  const value = dec(raw);
  if (value.lte(0) || value.gt(100) || value.decimalPlaces() > 4) {
    throw invalidAmounts(
      'percent must be greater than 0 and at most 100 with at most 4 decimals',
      '/percent',
    );
  }
  return value;
}

const present = (value: unknown): boolean => value !== undefined && value !== null;

function require(value: unknown, field: string): void {
  if (!present(value)) throw validation(`${field} is required for this kind`, `/${field}`);
}

function forbid(value: unknown, field: string, kind: BudgetLineKind): void {
  if (present(value)) throw validation(`${field} does not apply to ${kind} lines`, `/${field}`);
}

/**
 * Valida la entrada de una línea y la lleva a su especificación (design decisiones 2, 3 y 7; FR-PLANNING-015/018/022):
 *   - ingresos: solo `FIXED`, sin umbrales ni rollover (`BUDGET_INVALID_LINE_KIND`);
 *   - `MINIMUM`: sin umbrales (docs/33 D81) ni rollover;
 *   - montos no negativos en la moneda del plan y a su escala; `RANGE`: `min <= max` (`BUDGET_INVALID_AMOUNTS`);
 *   - umbrales por defecto 50/75/90/100 en líneas de gasto que los admiten.
 */
export function resolveLineSpec(
  input: BudgetLineInput,
  currency: Currency,
  nature: BudgetNature,
): BudgetLineSpec {
  if (!isBudgetLineKind(input.kind)) throw validation('kind is not a valid budget line kind', '/kind');
  const kind = input.kind;
  const policyRaw = input.rolloverPolicy ?? 'NONE';
  if (!(ROLLOVER_POLICIES as readonly string[]).includes(policyRaw)) {
    throw validation('rolloverPolicy is not valid', '/rolloverPolicy');
  }
  const rolloverPolicy = policyRaw as RolloverPolicy;
  const thresholdsGiven = input.thresholds !== undefined && input.thresholds !== null;

  if (nature === 'INCOME') {
    if (kind !== 'FIXED') throw invalidKind('income lines only admit the FIXED kind', '/kind');
    if (thresholdsGiven && (input.thresholds as readonly unknown[]).length > 0) {
      throw invalidKind('income lines do not admit alert thresholds', '/thresholds');
    }
    if (rolloverPolicy !== 'NONE') throw invalidKind('income lines do not admit rollover', '/rolloverPolicy');
  }
  if (kind === 'MINIMUM') {
    if (thresholdsGiven && (input.thresholds as readonly unknown[]).length > 0) {
      throw invalidKind('MINIMUM lines do not admit alert thresholds', '/thresholds');
    }
  }
  if (rolloverPolicy !== 'NONE' && !ROLLOVER_KINDS.includes(kind)) {
    throw invalidKind(`${kind} lines do not admit rollover`, '/rolloverPolicy');
  }

  let planned: Money | null = null;
  let min: Money | null = null;
  let max: Money | null = null;
  let percent: Decimal | null = null;
  let incomeBasis: IncomeBasis | null = null;

  switch (kind) {
    case 'FIXED':
    case 'MAXIMUM':
      require(input.planned, 'planned');
      forbid(input.min, 'min', kind);
      forbid(input.max, 'max', kind);
      forbid(input.percent, 'percent', kind);
      planned = parseMoney(input.planned as MoneyInput, currency, '/planned');
      break;
    case 'MINIMUM':
      require(input.min, 'min');
      forbid(input.planned, 'planned', kind);
      forbid(input.max, 'max', kind);
      forbid(input.percent, 'percent', kind);
      min = parseMoney(input.min as MoneyInput, currency, '/min');
      break;
    case 'RANGE':
      require(input.min, 'min');
      require(input.max, 'max');
      forbid(input.planned, 'planned', kind);
      forbid(input.percent, 'percent', kind);
      min = parseMoney(input.min as MoneyInput, currency, '/min');
      max = parseMoney(input.max as MoneyInput, currency, '/max');
      if (min.compare(max) > 0) throw invalidAmounts('min must not be greater than max', '/min');
      break;
    case 'PERCENT_OF_INCOME': {
      require(input.percent, 'percent');
      forbid(input.planned, 'planned', kind);
      forbid(input.min, 'min', kind);
      forbid(input.max, 'max', kind);
      percent = parsePercent(input.percent);
      const basis = input.incomeBasis ?? 'EXPECTED';
      if (!(INCOME_BASES as readonly string[]).includes(basis)) {
        throw validation('incomeBasis must be EXPECTED or ACTUAL', '/incomeBasis');
      }
      incomeBasis = basis as IncomeBasis;
      break;
    }
  }
  if (kind !== 'PERCENT_OF_INCOME') forbid(input.incomeBasis, 'incomeBasis', kind);

  let rolloverCap: Money | null = null;
  if (present(input.rolloverCap)) {
    if (rolloverPolicy === 'NONE') throw validation('rolloverCap needs a rollover policy', '/rolloverCap');
    rolloverCap = parseMoney(input.rolloverCap as MoneyInput, currency, '/rolloverCap');
  }

  let thresholds: string[] = [];
  if (nature === 'EXPENSE' && THRESHOLD_KINDS.includes(kind)) {
    thresholds = thresholdsGiven
      ? normalizeThresholds(input.thresholds as readonly unknown[])
      : [...DEFAULT_THRESHOLDS];
  }

  return {
    kind,
    planned: planned?.toFixed() ?? null,
    min: min?.toFixed() ?? null,
    max: max?.toFixed() ?? null,
    percent: percent?.toFixed() ?? null,
    incomeBasis,
    rolloverPolicy,
    rolloverCap: rolloverCap?.toFixed() ?? null,
    thresholds,
  };
}

/**
 * Entidad `BudgetLine` (design § Decisiones 2-3). Inmutable por valor: cada cambio produce una nueva línea con la
 * versión incrementada. Las líneas son configuración del plan, no hechos financieros (su historia está en el audit
 * log); el gastado NUNCA se guarda en ella (INV-034).
 */
export class BudgetLine {
  private constructor(
    private readonly state: BudgetLineState,
    /** Versión persistida (control optimista del repositorio). */
    readonly persistedVersion: number,
  ) {}

  static create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly budgetId: string;
    readonly target: BudgetTarget;
    readonly nature: BudgetNature;
    readonly spec: BudgetLineSpec;
    readonly source?: BudgetLineSource;
    readonly templateLineId?: string | null;
  }): BudgetLine {
    return new BudgetLine(
      {
        ...input.spec,
        id: input.id,
        workspaceId: input.workspaceId,
        budgetId: input.budgetId,
        target: input.target,
        nature: input.nature,
        rolloverInAmount: null,
        rolloverStatus: 'NONE',
        source: input.source ?? 'MANUAL',
        templateLineId: input.templateLineId ?? null,
        overridden: false,
        version: 1,
      },
      0,
    );
  }

  static restore(state: BudgetLineState): BudgetLine {
    return new BudgetLine({ ...state }, state.version);
  }

  get id(): string {
    return this.state.id;
  }
  get target(): BudgetTarget {
    return this.state.target;
  }
  get nature(): BudgetNature {
    return this.state.nature;
  }
  get kind(): BudgetLineKind {
    return this.state.kind;
  }
  get version(): number {
    return this.state.version;
  }
  get snapshot(): BudgetLineState {
    return { ...this.state };
  }
  get spec(): BudgetLineSpec {
    const { kind, planned, min, max, percent, incomeBasis, rolloverPolicy, rolloverCap, thresholds } =
      this.state;
    return { kind, planned, min, max, percent, incomeBasis, rolloverPolicy, rolloverCap, thresholds };
  }

  /** Reemplaza la especificación (PATCH) y marca la línea como modificada a mano respecto del template. */
  withSpec(spec: BudgetLineSpec): BudgetLine {
    return new BudgetLine(
      {
        ...this.state,
        ...spec,
        // El remanente recibido lo gobierna la política de la línea del periodo anterior: no se toca aquí.
        overridden: this.state.source === 'MANUAL' ? false : true,
        version: this.state.version + 1,
      },
      this.persistedVersion,
    );
  }

  /** Congela (`FINAL`) o vuelve a provisional el remanente recibido (consumidor `planning.rollover-finalizer`). */
  withRollover(rolloverInAmount: string | null, rolloverStatus: RolloverStatus): BudgetLine {
    return new BudgetLine(
      { ...this.state, rolloverInAmount, rolloverStatus, version: this.state.version + 1 },
      this.persistedVersion,
    );
  }
}
