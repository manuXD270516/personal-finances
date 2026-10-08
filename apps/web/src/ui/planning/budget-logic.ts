/**
 * Lógica pura de la pantalla de presupuestos (openspec add-budgets 6.1): tipos del contrato `Budget`, presentación del
 * estado de cada línea (siempre texto + icono, nunca solo color: NFR-USAB-104), reglas de qué muestra cada tipo y
 * armado/validación del cuerpo de una línea. Sin React ni zona horaria del proceso; los montos son `DecimalString`
 * (INV-001), nunca `number`.
 */
import { normalizeDecimalInput, parseAmount, subtractAmounts, isZeroAmount } from '../common/money';
import type { Money, Page } from '../common/types';

export type { Page };

export type BudgetLineKind = 'FIXED' | 'MAXIMUM' | 'MINIMUM' | 'RANGE' | 'PERCENT_OF_INCOME';
export type BudgetTargetKind = 'CATEGORY' | 'GROUP' | 'TAG';
export type BudgetNature = 'EXPENSE' | 'INCOME';
export type BudgetLineStatus =
  'UNDER' | 'ON_TARGET' | 'OVER' | 'WITHIN' | 'BELOW' | 'ABOVE' | 'PENDING' | 'MET' | 'NO_BUDGET';
export type RolloverPolicy = 'NONE' | 'CARRY_POSITIVE' | 'CARRY_ALL';
export type RolloverStatus = 'NONE' | 'PROVISIONAL' | 'FINAL';
export type IncomeBasis = 'EXPECTED' | 'ACTUAL';

export const BUDGET_LINE_KINDS: readonly BudgetLineKind[] = [
  'FIXED',
  'MAXIMUM',
  'MINIMUM',
  'RANGE',
  'PERCENT_OF_INCOME',
];
/** Tipos de línea de gasto que admiten rollover (design decisión 3). */
export const ROLLOVER_KINDS: readonly BudgetLineKind[] = ['FIXED', 'MAXIMUM', 'RANGE', 'PERCENT_OF_INCOME'];
/** Tipos de gasto con umbrales de alerta (docs/33 D81: no en MINIMUM ni en ingresos). */
export const THRESHOLD_KINDS: readonly BudgetLineKind[] = ['FIXED', 'MAXIMUM', 'RANGE', 'PERCENT_OF_INCOME'];
/** Tipos que proyectan al fin del periodo (docs/33 D83). */
export const PROJECTING_KINDS: readonly BudgetLineKind[] = ['MAXIMUM', 'RANGE', 'PERCENT_OF_INCOME'];

export interface BudgetLineProgress {
  readonly reference: Money;
  readonly effectivePlanned: Money;
  readonly minimum: Money | null;
  readonly rolloverIn: Money | null;
  readonly rolloverStatus: RolloverStatus;
  readonly actual: Money;
  readonly actualComplete: boolean;
  readonly unconverted: readonly Money[];
  readonly remaining: Money;
  readonly difference: Money;
  readonly utilization: string | null;
  readonly projection: Money | null;
  readonly status: BudgetLineStatus;
  readonly crossedThresholds: readonly string[];
}

export interface BudgetLine {
  readonly id: string;
  readonly target: { readonly kind: BudgetTargetKind; readonly id: string };
  readonly nature: BudgetNature;
  readonly kind: BudgetLineKind;
  readonly planned: Money | null;
  readonly min: Money | null;
  readonly max: Money | null;
  readonly percent: string | null;
  readonly incomeBasis: IncomeBasis | null;
  readonly rolloverPolicy: RolloverPolicy;
  readonly rolloverCap: Money | null;
  readonly thresholds: readonly string[];
  readonly source: 'MANUAL' | 'TEMPLATE' | 'CLONE';
  readonly overridden: boolean;
  readonly version: number;
  readonly progress: BudgetLineProgress;
}

export interface BudgetTotals {
  readonly planned: Money;
  readonly actual: Money;
  readonly remaining: Money;
  readonly availableToSpend: Money;
  readonly expectedIncome: Money;
  readonly actualIncome: Money;
  readonly toAssign: Money | null;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
}

export interface BudgetRateUsed {
  readonly rate: { readonly base: string; readonly quote: string; readonly value: string };
  readonly rateType: string;
  readonly source: string;
  readonly asOf: string;
  readonly provider?: string | null;
  readonly sourceLabel?: string | null;
}

export interface Budget {
  readonly id: string;
  readonly periodId: string;
  readonly periodLabel: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly periodStatus: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'REOPENED';
  readonly currency: string;
  readonly origin: 'EMPTY' | 'TEMPLATE' | 'CLONE';
  readonly zeroBased: boolean;
  readonly lines: readonly BudgetLine[];
  readonly totals: BudgetTotals;
  readonly meta: {
    readonly generatedAt: string;
    readonly timeZone: string;
    readonly rateWindowDays: number;
    readonly ratesUsed: readonly BudgetRateUsed[];
    readonly attributions: readonly {
      readonly provider: string;
      readonly text: string;
      readonly url: string;
    }[];
  };
  readonly version: number;
}

/** Icono (carácter decorativo, `aria-hidden`) y clave del texto de cada estado. */
export interface StatusPresentation {
  readonly icon: string;
  /** Clave bajo `status.*` del namespace `Budgets`. */
  readonly textKey: BudgetLineStatus;
  readonly tone: 'ok' | 'warn' | 'danger' | 'neutral';
}

const PRESENTATION: Record<BudgetLineStatus, StatusPresentation> = {
  UNDER: { icon: '◔', textKey: 'UNDER', tone: 'neutral' },
  ON_TARGET: { icon: '✓', textKey: 'ON_TARGET', tone: 'ok' },
  OVER: { icon: '▲', textKey: 'OVER', tone: 'danger' },
  WITHIN: { icon: '✓', textKey: 'WITHIN', tone: 'ok' },
  BELOW: { icon: '▼', textKey: 'BELOW', tone: 'warn' },
  ABOVE: { icon: '▲', textKey: 'ABOVE', tone: 'danger' },
  PENDING: { icon: '◔', textKey: 'PENDING', tone: 'neutral' },
  MET: { icon: '✓', textKey: 'MET', tone: 'ok' },
  NO_BUDGET: { icon: '∅', textKey: 'NO_BUDGET', tone: 'warn' },
};

export const statusPresentation = (status: BudgetLineStatus): StatusPresentation => PRESENTATION[status];

/**
 * "Pendiente / cumplido" de las líneas que no proyectan (docs/33 D83): FIXED (`UNDER` pendiente; `ON_TARGET` y
 * `OVER` cumplido) y MINIMUM (`PENDING` / `MET`). `null` para los demás tipos y para las líneas de ingreso.
 */
export function settlementOf(
  line: Pick<BudgetLine, 'kind' | 'nature' | 'progress'>,
): 'PENDING' | 'MET' | null {
  if (line.nature !== 'EXPENSE') return null;
  const status = line.progress.status;
  if (line.kind === 'FIXED') return status === 'UNDER' ? 'PENDING' : status === 'NO_BUDGET' ? null : 'MET';
  if (line.kind === 'MINIMUM') return status === 'PENDING' ? 'PENDING' : status === 'MET' ? 'MET' : null;
  return null;
}

/** ¿La proyección supera la referencia? (aviso "supera el máximo"). */
export function projectionExceeds(line: Pick<BudgetLine, 'progress'>): boolean {
  const { projection, reference } = line.progress;
  if (!projection || projection.currency !== reference.currency) return false;
  const scale = reference.amount.split('.')[1]?.length ?? 2;
  const diff = subtractAmounts(projection.amount, reference.amount, reference.currency, scale);
  return !diff.startsWith('-') && !isZeroAmount(diff);
}

/** Porcentaje para la barra de progreso (0..100, sin pasar de 100); `null` si no hay porcentaje definido. */
export function barValue(utilization: string | null): number | null {
  if (utilization === null) return null;
  const n = Number.parseFloat(utilization);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

// ───────────────────────────────────────────── formulario de línea

export interface LineFormValues {
  readonly targetKind: BudgetTargetKind;
  readonly targetId: string;
  readonly kind: BudgetLineKind;
  readonly planned: string;
  readonly min: string;
  readonly max: string;
  readonly percent: string;
  readonly incomeBasis: IncomeBasis;
  readonly rolloverPolicy: RolloverPolicy;
  readonly rolloverCap: string;
  /** Umbrales separados por coma o espacio; vacío = por defecto (50, 75, 90, 100). */
  readonly thresholds: string;
}

export const emptyLineForm = (targetKind: BudgetTargetKind = 'CATEGORY'): LineFormValues => ({
  targetKind,
  targetId: '',
  kind: 'MAXIMUM',
  planned: '',
  min: '',
  max: '',
  percent: '',
  incomeBasis: 'EXPECTED',
  rolloverPolicy: 'NONE',
  rolloverCap: '',
  thresholds: '',
});

const amountText = (m: Money | null): string => m?.amount ?? '';

/** Valores iniciales de la edición de una línea. */
export function formFromLine(line: BudgetLine): LineFormValues {
  return {
    targetKind: line.target.kind,
    targetId: line.target.id,
    kind: line.kind,
    planned: amountText(line.planned),
    min: amountText(line.min),
    max: amountText(line.max),
    percent: line.percent ?? '',
    incomeBasis: line.incomeBasis ?? 'EXPECTED',
    rolloverPolicy: line.rolloverPolicy,
    rolloverCap: amountText(line.rolloverCap),
    thresholds: line.thresholds.join(', '),
  };
}

export type LineFormErrors = Partial<Record<keyof LineFormValues, 'required' | 'invalid' | 'scale'>>;

export interface LineBody {
  readonly kind: BudgetLineKind;
  readonly planned: Money | null;
  readonly min: Money | null;
  readonly max: Money | null;
  readonly percent: string | null;
  readonly incomeBasis: IncomeBasis | null;
  readonly rolloverPolicy: RolloverPolicy;
  readonly rolloverCap: Money | null;
  readonly thresholds: readonly string[] | null;
}

export type BuildResult =
  { readonly ok: true; readonly body: LineBody } | { readonly ok: false; readonly errors: LineFormErrors };

export interface BuildOptions {
  readonly currency: string;
  readonly scale: number;
  readonly locale: string;
  readonly nature: BudgetNature;
}

/**
 * Cuerpo de la línea según su tipo. Valida lo evidente en el cliente (campos requeridos, montos con la escala de la
 * moneda, porcentaje en (0, 100]); las reglas de negocio (mínimo ≤ máximo, umbrales, solapamientos…) las decide la API y
 * la pantalla muestra su `code`. Los campos que no aplican al tipo se envían `null` para que un cambio de tipo no
 * arrastre montos del tipo anterior.
 */
export function buildLineBody(values: LineFormValues, opts: BuildOptions): BuildResult {
  const errors: Record<string, 'required' | 'invalid' | 'scale'> = {};
  const money = (field: 'planned' | 'min' | 'max' | 'rolloverCap', required: boolean): Money | null => {
    const raw = values[field];
    if (raw.trim() === '') {
      if (required) errors[field] = 'required';
      return null;
    }
    const r = parseAmount(raw, {
      locale: opts.locale,
      currency: opts.currency,
      scale: opts.scale,
      allowZero: true,
    });
    if (r.ok) return { amount: r.value, currency: opts.currency };
    errors[field] = r.error === 'SCALE' ? 'scale' : 'invalid';
    return null;
  };
  const kind = values.kind;
  const planned = kind === 'FIXED' || kind === 'MAXIMUM' ? money('planned', true) : null;
  const min = kind === 'MINIMUM' || kind === 'RANGE' ? money('min', true) : null;
  const max = kind === 'RANGE' ? money('max', true) : null;
  let percent: string | null = null;
  if (kind === 'PERCENT_OF_INCOME') {
    const normalized =
      values.percent.trim() === '' ? null : normalizeDecimalInput(values.percent, opts.locale);
    if (values.percent.trim() === '') errors['percent'] = 'required';
    else if (normalized === null || (normalized.split('.')[1]?.length ?? 0) > 4)
      errors['percent'] = 'invalid';
    else percent = normalized;
  }
  const rolloverEligible = opts.nature === 'EXPENSE' && ROLLOVER_KINDS.includes(kind);
  const rolloverPolicy = rolloverEligible ? values.rolloverPolicy : 'NONE';
  const rolloverCap = rolloverPolicy === 'NONE' ? null : money('rolloverCap', false);
  let thresholds: readonly string[] | null = null;
  if (opts.nature === 'EXPENSE' && THRESHOLD_KINDS.includes(kind) && values.thresholds.trim() !== '') {
    const parts = values.thresholds
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter((p) => p !== '');
    const normalized = parts.map((p) => normalizeDecimalInput(p, opts.locale));
    if (normalized.some((n) => n === null)) errors['thresholds'] = 'invalid';
    else thresholds = normalized as string[];
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors: errors as LineFormErrors };
  return {
    ok: true,
    body: {
      kind,
      planned,
      min,
      max,
      percent,
      incomeBasis: kind === 'PERCENT_OF_INCOME' ? values.incomeBasis : null,
      rolloverPolicy,
      rolloverCap,
      thresholds,
    },
  };
}
