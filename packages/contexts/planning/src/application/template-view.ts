import type { BudgetMoneyDto } from '../contracts/index.js';
import type {
  BudgetLineSpec,
  BudgetTemplate,
  BudgetTarget,
  OmittedLine,
  PlannedChange,
  PlannedConflict,
  TemplateLine,
  TemplateVersion,
} from '../domain/index.js';
import type { TemplateVersionHeader } from './ports/index.js';

const amount = (value: string | null, currency: string): BudgetMoneyDto | null =>
  value === null ? null : { amount: value, currency };

/** Especificación de una línea tal como se publica (montos en la moneda indicada). */
export interface LineSpecDto {
  readonly kind: string;
  readonly planned: BudgetMoneyDto | null;
  readonly min: BudgetMoneyDto | null;
  readonly max: BudgetMoneyDto | null;
  readonly percent: string | null;
  readonly incomeBasis: 'EXPECTED' | 'ACTUAL' | null;
  readonly rolloverPolicy: 'NONE' | 'CARRY_POSITIVE' | 'CARRY_ALL';
  readonly rolloverCap: BudgetMoneyDto | null;
  readonly thresholds: readonly string[];
}

export function toSpecDto(spec: BudgetLineSpec, currency: string): LineSpecDto {
  return {
    kind: spec.kind,
    planned: amount(spec.planned, currency),
    min: amount(spec.min, currency),
    max: amount(spec.max, currency),
    percent: spec.percent,
    incomeBasis: spec.incomeBasis,
    rolloverPolicy: spec.rolloverPolicy,
    rolloverCap: amount(spec.rolloverCap, currency),
    thresholds: spec.thresholds,
  };
}

export interface TemplateLineDto extends LineSpecDto {
  readonly id: string;
  readonly target: BudgetTarget;
  readonly nature: 'EXPENSE' | 'INCOME';
  readonly currency: string;
}

export const toTemplateLineDto = (l: TemplateLine): TemplateLineDto => ({
  id: l.id,
  target: l.target,
  nature: l.nature,
  currency: l.currency,
  ...toSpecDto(l.spec, l.currency),
});

export interface TemplateVersionDto {
  readonly versionNo: number;
  readonly basedOnVersionNo: number | null;
  readonly changeNote: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly lines: readonly TemplateLineDto[];
}

export const toVersionDto = (v: TemplateVersion): TemplateVersionDto => ({
  versionNo: v.versionNo,
  basedOnVersionNo: v.basedOnVersionNo,
  changeNote: v.changeNote,
  createdAt: v.createdAt,
  createdBy: v.createdBy,
  lines: v.lines.map(toTemplateLineDto),
});

export interface TemplateVersionHeaderDto {
  readonly versionNo: number;
  readonly basedOnVersionNo: number | null;
  readonly changeNote: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly lineCount: number;
}

export interface TemplateSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isDefault: boolean;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly currentVersionNo: number;
  readonly lineCount: number;
  readonly version: number;
  readonly createdAt: string;
}

export interface TemplateDto extends TemplateSummaryDto {
  readonly currentVersion: TemplateVersionDto;
  readonly versions: readonly TemplateVersionHeaderDto[];
}

export function toSummaryDto(t: BudgetTemplate): TemplateSummaryDto {
  const s = t.snapshot;
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    isDefault: s.isDefault,
    status: s.status,
    currentVersionNo: s.currentVersionNo,
    lineCount: t.currentVersion.lines.length,
    version: s.version,
    createdAt: s.createdAt,
  };
}

export function toTemplateDto(
  t: BudgetTemplate,
  versions: readonly TemplateVersionHeader[] = [],
): TemplateDto {
  return {
    ...toSummaryDto(t),
    currentVersion: toVersionDto(t.currentVersion),
    versions: versions.map((h) => ({ ...h })),
  };
}

export interface OmittedLineDto {
  readonly target: BudgetTarget;
  readonly reason: 'TARGET_ARCHIVED' | 'CURRENCY_MISMATCH';
}

export const toOmittedDto = (o: OmittedLine): OmittedLineDto => ({ target: o.target, reason: o.reason });

export interface PropagationPeriodDto {
  readonly budgetId: string;
  readonly periodId: string;
  readonly periodLabel: string;
}

export interface PropagationChangeDto extends PropagationPeriodDto {
  readonly action: 'ADD' | 'UPDATE' | 'REMOVE';
  readonly target: BudgetTarget;
  readonly from: LineSpecDto | null;
  readonly to: LineSpecDto | null;
}

export interface PropagationConflictDto extends PropagationPeriodDto {
  readonly action: 'ADD' | 'UPDATE' | 'REMOVE';
  readonly reason: 'OVERRIDDEN' | 'MANUAL_LINE' | 'TARGET_OVERLAP' | 'CURRENCY_MISMATCH';
  readonly target: BudgetTarget;
  readonly current: LineSpecDto | null;
  readonly proposed: LineSpecDto | null;
}

export interface PropagationPreviewDto {
  readonly templateId: string;
  readonly baseVersionNo: number;
  readonly newVersionPreview: {
    readonly versionNo: number;
    readonly added: number;
    readonly updated: number;
    readonly removed: number;
    readonly lines: readonly TemplateLineDto[];
  };
  readonly periods: readonly PropagationPeriodDto[];
  readonly changes: readonly PropagationChangeDto[];
  readonly conflicts: readonly PropagationConflictDto[];
  readonly token: string;
}

export function toChangeDto(
  c: PlannedChange,
  period: PropagationPeriodDto,
  currency: string,
): PropagationChangeDto {
  return {
    ...period,
    action: c.action,
    target: c.target,
    from: c.from ? toSpecDto(c.from, currency) : null,
    to: c.to ? toSpecDto(c.to, currency) : null,
  };
}

export function toConflictDto(
  c: PlannedConflict,
  period: PropagationPeriodDto,
  currency: string,
): PropagationConflictDto {
  return {
    ...period,
    action: c.action,
    reason: c.reason,
    target: c.target,
    current: c.current ? toSpecDto(c.current, currency) : null,
    proposed: c.proposed ? toSpecDto(c.proposed, currency) : null,
  };
}
