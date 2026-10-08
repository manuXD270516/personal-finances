import type {
  ChecklistItem,
  CloseChecklist,
  CloseSnapshotContent,
  KpiVariation,
  SnapshotDiff,
} from '../domain/index.js';
import type { SnapshotHeader, StoredSnapshot } from './ports/index.js';

/** `CloseChecklist` del contrato (GET close-checklist). */
export interface CloseChecklistDto {
  readonly periodId: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly evaluatedAt: string;
  readonly canClose: boolean;
  readonly requiresAcknowledgement: boolean;
  readonly items: readonly ChecklistItem[];
}

export function toChecklistDto(
  period: {
    readonly id: string;
    readonly label: string;
    readonly periodStart: string;
    readonly periodEnd: string;
  },
  checklist: CloseChecklist,
  evaluatedAt: string,
): CloseChecklistDto {
  return {
    periodId: period.id,
    label: period.label,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    evaluatedAt,
    canClose: checklist.canClose,
    requiresAcknowledgement: checklist.requiresAcknowledgement,
    items: checklist.items,
  };
}

export interface CloseSnapshotSummaryDto {
  readonly snapshotId: string;
  readonly closeNo: number;
  readonly closedAt: string;
  readonly closedBy: string | null;
  readonly previousSnapshotId: string | null;
  readonly isCurrent: boolean;
}

export const toSummaryDto = (h: SnapshotHeader, currentCloseNo: number): CloseSnapshotSummaryDto => ({
  snapshotId: h.id,
  closeNo: h.closeNo,
  closedAt: h.closedAt,
  closedBy: h.closedBy,
  previousSnapshotId: h.previousSnapshotId,
  isCurrent: h.closeNo === currentCloseNo,
});

/** `CloseSnapshot` del contrato: resumen de la versión + contenido congelado. */
export interface CloseSnapshotDto extends CloseSnapshotSummaryDto {
  readonly periodId: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly baseCurrency: string;
  readonly balances: CloseSnapshotContent['balances'];
  readonly flows: CloseSnapshotContent['flows'];
  readonly netWorth: CloseSnapshotContent['netWorth'];
  readonly budgetVsActual: CloseSnapshotContent['budgetVsActual'];
  readonly goalContributions: null;
  readonly reconciledWithoutStatement: CloseSnapshotContent['reconciledWithoutStatement'];
  readonly checklist: CloseSnapshotContent['checklist'];
  readonly acknowledgedWarnings: CloseSnapshotContent['acknowledgedWarnings'];
}

export function toSnapshotDto(s: StoredSnapshot, currentCloseNo: number): CloseSnapshotDto {
  const c = s.content;
  return {
    ...toSummaryDto(s, currentCloseNo),
    periodId: c.period.periodId,
    label: c.period.label,
    periodStart: c.period.periodStart,
    periodEnd: c.period.periodEnd,
    baseCurrency: c.baseCurrency,
    balances: c.balances,
    flows: c.flows,
    netWorth: c.netWorth,
    budgetVsActual: c.budgetVsActual,
    goalContributions: null,
    reconciledWithoutStatement: c.reconciledWithoutStatement,
    checklist: c.checklist,
    acknowledgedWarnings: c.acknowledgedWarnings,
  };
}

export interface CloseSnapshotDiffDto extends SnapshotDiff {
  readonly from: number;
  readonly to: number;
}

export interface CloseReportDto {
  readonly snapshot: CloseSnapshotDto;
  readonly versions: readonly CloseSnapshotSummaryDto[];
  readonly comparison: {
    readonly previousPeriodId: string;
    readonly previousLabel: string;
    readonly previousCloseNo: number;
    readonly deltas: readonly KpiVariation[];
  } | null;
  readonly comparisonUnavailableReason: 'NO_PREVIOUS_PERIOD' | 'NO_PREVIOUS_SNAPSHOT' | null;
}

export interface ClosingPolicyDto {
  readonly severities: Readonly<Record<string, 'BLOCKING' | 'WARNING'>>;
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}
