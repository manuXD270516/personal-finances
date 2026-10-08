/**
 * Vocabulario del dominio de presupuestos (openspec add-budgets, design.md decisiones 2 y 3).
 */
export const BUDGET_LINE_KINDS = ['FIXED', 'MAXIMUM', 'MINIMUM', 'RANGE', 'PERCENT_OF_INCOME'] as const;
/** `FIXED {planned}`, `MAXIMUM {planned}`, `MINIMUM {min}`, `RANGE {min, max}`, `PERCENT_OF_INCOME {percent, basis}`. */
export type BudgetLineKind = (typeof BUDGET_LINE_KINDS)[number];

export const TARGET_KINDS = ['CATEGORY', 'GROUP', 'TAG'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export interface BudgetTarget {
  readonly kind: TargetKind;
  readonly id: string;
}

export type BudgetNature = 'EXPENSE' | 'INCOME';

export const INCOME_BASES = ['EXPECTED', 'ACTUAL'] as const;
/** Base del `PERCENT_OF_INCOME`: ingresos esperados del plan o ingresos reales del periodo a la fecha. */
export type IncomeBasis = (typeof INCOME_BASES)[number];

export const ROLLOVER_POLICIES = ['NONE', 'CARRY_POSITIVE', 'CARRY_ALL'] as const;
export type RolloverPolicy = (typeof ROLLOVER_POLICIES)[number];

/** `PROVISIONAL` hasta el cierre del periodo anterior; `FINAL` desde `MonthClosed` (docs/33; design decisión 10). */
export type RolloverStatus = 'NONE' | 'PROVISIONAL' | 'FINAL';

export type BudgetOrigin = 'EMPTY' | 'TEMPLATE' | 'CLONE';
export type BudgetLineSource = 'MANUAL' | 'TEMPLATE' | 'CLONE';

/** Tipos de línea a los que aplica el rollover (design decisión 3). */
export const ROLLOVER_KINDS: readonly BudgetLineKind[] = ['FIXED', 'MAXIMUM', 'RANGE', 'PERCENT_OF_INCOME'];
/** Tipos de línea de gasto con umbrales de alerta (docs/33 D81: no en MINIMUM ni en ingresos). */
export const THRESHOLD_KINDS: readonly BudgetLineKind[] = ['FIXED', 'MAXIMUM', 'RANGE', 'PERCENT_OF_INCOME'];
/** Tipos de línea que proyectan linealmente al fin del periodo (docs/33 D83). */
export const PROJECTING_KINDS: readonly BudgetLineKind[] = ['MAXIMUM', 'RANGE', 'PERCENT_OF_INCOME'];

/** Umbrales por defecto de una línea de gasto (FR-PLANNING-022). */
export const DEFAULT_THRESHOLDS: readonly string[] = ['50', '75', '90', '100'];

export const isBudgetLineKind = (v: unknown): v is BudgetLineKind =>
  typeof v === 'string' && (BUDGET_LINE_KINDS as readonly string[]).includes(v);
export const isTargetKind = (v: unknown): v is TargetKind =>
  typeof v === 'string' && (TARGET_KINDS as readonly string[]).includes(v);
