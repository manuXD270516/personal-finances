/**
 * Lógica pura de templates de presupuesto (openspec add-budget-templates 6.1/6.2): tipos del contrato `Template`,
 * armado del cuerpo de las líneas y del borrador de una versión nueva, comparación entre versiones y agrupación de la
 * vista previa de propagación. Sin React; los montos son `DecimalString` (INV-001), nunca `number`.
 */
import type { Money } from '../common/types';
import type {
  BudgetLineKind,
  BudgetNature,
  BudgetTargetKind,
  IncomeBasis,
  LineBody,
  LineFormValues,
  RolloverPolicy,
} from './budget-logic';

export type TemplateStatus = 'ACTIVE' | 'ARCHIVED';

export interface LineSpec {
  readonly kind: BudgetLineKind;
  readonly planned: Money | null;
  readonly min: Money | null;
  readonly max: Money | null;
  readonly percent: string | null;
  readonly incomeBasis: IncomeBasis | null;
  readonly rolloverPolicy: RolloverPolicy;
  readonly rolloverCap: Money | null;
  readonly thresholds: readonly string[];
}

export interface LineTarget {
  readonly kind: BudgetTargetKind;
  readonly id: string;
}

/** Línea de una versión (o del borrador de una versión nueva, donde `id` es el de la clave local). */
export interface TemplateLine extends LineSpec {
  readonly id: string;
  readonly target: LineTarget;
  readonly nature: BudgetNature;
  readonly currency: string;
}

export interface TemplateVersion {
  readonly versionNo: number;
  readonly basedOnVersionNo: number | null;
  readonly changeNote: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly lines: readonly TemplateLine[];
}

export interface TemplateVersionHeader {
  readonly versionNo: number;
  readonly basedOnVersionNo: number | null;
  readonly changeNote: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly lineCount: number;
}

export interface TemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isDefault: boolean;
  readonly status: TemplateStatus;
  readonly currentVersionNo: number;
  readonly lineCount: number;
  readonly version: number;
  readonly createdAt: string;
}

export interface Template extends TemplateSummary {
  readonly currentVersion: TemplateVersion;
  readonly versions: readonly TemplateVersionHeader[];
}

export interface OmittedLine {
  readonly target: LineTarget;
  readonly reason: 'TARGET_ARCHIVED' | 'CURRENCY_MISMATCH';
}

export interface PropagationPeriod {
  readonly budgetId: string;
  readonly periodId: string;
  readonly periodLabel: string;
}

export interface PropagationChange extends PropagationPeriod {
  readonly action: 'ADD' | 'UPDATE' | 'REMOVE';
  readonly target: LineTarget;
  readonly from: LineSpec | null;
  readonly to: LineSpec | null;
}

export interface PropagationConflict extends PropagationPeriod {
  readonly action: 'ADD' | 'UPDATE' | 'REMOVE';
  readonly reason: 'OVERRIDDEN' | 'MANUAL_LINE' | 'TARGET_OVERLAP' | 'CURRENCY_MISMATCH';
  readonly target: LineTarget;
  readonly current: LineSpec | null;
  readonly proposed: LineSpec | null;
}

export interface PropagationPreview {
  readonly templateId: string;
  readonly baseVersionNo: number;
  readonly newVersionPreview: {
    readonly versionNo: number;
    readonly added: number;
    readonly updated: number;
    readonly removed: number;
    readonly lines: readonly TemplateLine[];
  };
  readonly periods: readonly PropagationPeriod[];
  readonly changes: readonly PropagationChange[];
  readonly conflicts: readonly PropagationConflict[];
  readonly token: string;
}

export type PropagationSource =
  | {
      readonly kind: 'TEMPLATE';
      readonly templateId: string;
      readonly baseVersionNo: number;
      readonly lines: readonly unknown[];
    }
  | { readonly kind: 'BUDGET'; readonly budgetId: string; readonly lineIds: readonly string[] };

export const targetKey = (t: LineTarget): string => `${t.kind}:${t.id}`;

/** Cuerpo de una línea para crear un template o una versión: sin campos nulos (el contrato no los admite). */
export function lineInput(target: LineTarget, body: LineBody): Record<string, unknown> {
  const out: Record<string, unknown> = { target, kind: body.kind, rolloverPolicy: body.rolloverPolicy };
  for (const key of [
    'planned',
    'min',
    'max',
    'percent',
    'incomeBasis',
    'rolloverCap',
    'thresholds',
  ] as const) {
    if (body[key] !== null) out[key] = body[key];
  }
  return out;
}

/** Cuerpo de una línea ya publicada (o de un plan): se reenvía tal cual, sin nulos. */
export function specInput(target: LineTarget, spec: LineSpec): Record<string, unknown> {
  return lineInput(target, {
    kind: spec.kind,
    planned: spec.planned,
    min: spec.min,
    max: spec.max,
    percent: spec.percent,
    incomeBasis: spec.incomeBasis,
    rolloverPolicy: spec.rolloverPolicy,
    rolloverCap: spec.rolloverCap,
    thresholds: spec.thresholds.length > 0 ? spec.thresholds : null,
  });
}

const amount = (m: Money | null): string => (m ? `${m.amount} ${m.currency}` : '');

/** Clave estable de la especificación de una línea (para detectar cambios entre versiones). */
export function specSignature(spec: LineSpec): string {
  return [
    spec.kind,
    amount(spec.planned),
    amount(spec.min),
    amount(spec.max),
    spec.percent ?? '',
    spec.incomeBasis ?? '',
    spec.rolloverPolicy,
    amount(spec.rolloverCap),
    spec.thresholds.join(','),
  ].join('|');
}

export type VersionDiffKind = 'ADDED' | 'REMOVED' | 'CHANGED';

export interface VersionDiffRow {
  readonly kind: VersionDiffKind;
  readonly target: LineTarget;
  readonly before: TemplateLine | null;
  readonly after: TemplateLine | null;
}

/** Diferencias entre dos versiones (o entre una versión y el borrador), por objetivo; sin las líneas iguales. */
export function compareVersions(
  before: readonly TemplateLine[],
  after: readonly TemplateLine[],
): VersionDiffRow[] {
  const a = new Map(before.map((l) => [targetKey(l.target), l]));
  const b = new Map(after.map((l) => [targetKey(l.target), l]));
  const rows: VersionDiffRow[] = [];
  for (const [key, line] of b) {
    const prev = a.get(key);
    if (!prev) rows.push({ kind: 'ADDED', target: line.target, before: null, after: line });
    else if (specSignature(prev) !== specSignature(line)) {
      rows.push({ kind: 'CHANGED', target: line.target, before: prev, after: line });
    }
  }
  for (const [key, line] of a) {
    if (!b.has(key)) rows.push({ kind: 'REMOVED', target: line.target, before: line, after: null });
  }
  return rows;
}

/** Línea del borrador a partir del formulario y su cuerpo validado. */
export function draftLine(input: {
  readonly key: string;
  readonly values: LineFormValues;
  readonly body: LineBody;
  readonly nature: BudgetNature;
  readonly currency: string;
}): TemplateLine {
  const { body } = input;
  return {
    id: input.key,
    target: { kind: input.values.targetKind, id: input.values.targetId },
    nature: input.nature,
    currency: input.currency,
    kind: body.kind,
    planned: body.planned,
    min: body.min,
    max: body.max,
    percent: body.percent,
    incomeBasis: body.incomeBasis,
    rolloverPolicy: body.rolloverPolicy,
    rolloverCap: body.rolloverCap,
    thresholds: body.thresholds ?? [],
  };
}

/** Valores del formulario para editar una línea del borrador. */
export function formFromTemplateLine(line: TemplateLine): LineFormValues {
  return {
    targetKind: line.target.kind,
    targetId: line.target.id,
    kind: line.kind,
    planned: line.planned?.amount ?? '',
    min: line.min?.amount ?? '',
    max: line.max?.amount ?? '',
    percent: line.percent ?? '',
    incomeBasis: line.incomeBasis ?? 'EXPECTED',
    rolloverPolicy: line.rolloverPolicy,
    rolloverCap: line.rolloverCap?.amount ?? '',
    thresholds: line.thresholds.join(', '),
  };
}

/** Los cambios de la vista previa agrupados por periodo, en el orden de `periods`. */
export function groupByPeriod(preview: PropagationPreview): {
  readonly period: PropagationPeriod;
  readonly changes: readonly PropagationChange[];
  readonly conflicts: readonly PropagationConflict[];
}[] {
  return preview.periods.map((period) => ({
    period,
    changes: preview.changes.filter((c) => c.budgetId === period.budgetId),
    conflicts: preview.conflicts.filter((c) => c.budgetId === period.budgetId),
  }));
}

/** ¿Hay algo que confirmar? (la API rechaza una propagación sin diferencias). */
export const hasPropagationChanges = (preview: PropagationPreview): boolean =>
  preview.newVersionPreview.added + preview.newVersionPreview.updated + preview.newVersionPreview.removed > 0;

/** Líneas de un plan como borrador de template ("crear template con estas líneas", docs/33 D84). */
export function linesFromPlan(
  lines: readonly (LineSpec & { readonly target: LineTarget })[],
): Record<string, unknown>[] {
  return lines.map((l) => specInput(l.target, l));
}
