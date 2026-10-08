import type { LifecycleDto, LifecycleQuery } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import type { ClosingSnapshotQuery } from '../contracts/index.js';
import {
  PeriodVariation,
  SnapshotComparator,
  type CloseSnapshotContent,
  type MoneyValue,
} from '../domain/index.js';
import {
  toSnapshotDto,
  toSummaryDto,
  type CloseReportDto,
  type CloseSnapshotDiffDto,
  type CloseSnapshotDto,
  type CloseSnapshotSummaryDto,
} from './closing-view.js';
import type { ClosingDeps, SnapshotHeader, StoredSnapshot } from './ports/index.js';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `financial period ${id} not found`);

export type CloseReportFormat = 'csv' | 'pdf';

/** Documento del reporte de cierre tal como lo exportan los renderizadores (montos ya como texto decimal). */
export interface CloseReportDocument {
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly closeNo: number;
  readonly closedAt: string;
  readonly hasPreviousVersion: boolean;
  readonly versions: readonly CloseSnapshotSummaryDto[];
  readonly content: CloseSnapshotContent;
  readonly comparison: CloseReportDto['comparison'];
}

/** Renderizador del PDF del reporte (infraestructura: pdfkit). */
export interface CloseReportPdfRenderer {
  render(doc: CloseReportDocument): Promise<Uint8Array>;
}

export interface CloseReportFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly body: Uint8Array;
}

const UTF8_BOM = '﻿';
const csvCell = (value: string): string =>
  /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** CSV RFC 4180 (CRLF) con BOM UTF-8: columnas `section, account, currency, amount` (design.md decisión 11). */
export function closeReportCsv(doc: CloseReportDocument): string {
  const money = (section: string, account: string, m: MoneyValue): string[] => [
    section,
    account,
    m.currency,
    m.amount,
  ];
  const c = doc.content;
  const rows: string[][] = [
    ['section', 'account', 'currency', 'amount'],
    ['VERSION', doc.label, '', String(doc.closeNo)],
    ['CLOSED_AT', doc.label, '', doc.closedAt],
    ['PERIOD', doc.label, '', `${doc.periodStart}..${doc.periodEnd}`],
    ...c.balances.map((b) => money('BALANCE', b.accountName, b.balance)),
    ...c.flows.byCurrency.flatMap((f) => [
      money('INCOME', '', f.income),
      money('EXPENSE', '', f.expense),
      money('SAVINGS', '', f.savings),
    ]),
    money('CONSOLIDATED_INCOME', '', c.flows.consolidated.income),
    money('CONSOLIDATED_EXPENSE', '', c.flows.consolidated.expense),
    money('CONSOLIDATED_SAVINGS', '', c.flows.consolidated.savings),
    ['SAVINGS_RATE', '', c.baseCurrency, c.flows.consolidated.savingsRate ?? ''],
    money('NET_WORTH', c.netWorth.complete ? '' : 'INCOMPLETE', c.netWorth.amount),
  ];
  return `${UTF8_BOM}${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/**
 * Consultas del snapshot de cierre (design.md decisión 11): versiones, snapshot por versión, comparación, reporte con
 * variaciones respecto al periodo anterior y exportación CSV/PDF. Sin efectos (la exportación se audita en el
 * borde, igual que el recorrido). Todo corre en la unidad de trabajo del llamador o en una propia con RLS.
 */
export class ClosingQueries implements ClosingSnapshotQuery {
  constructor(
    private readonly deps: ClosingDeps,
    private readonly pdf?: CloseReportPdfRenderer,
    private readonly lifecycleQuery?: LifecycleQuery,
  ) {}

  listSnapshots(workspaceId: string, periodId: string): Promise<readonly CloseSnapshotSummaryDto[]> {
    return this.deps.uow.run(workspaceId, async () => {
      await this.period(workspaceId, periodId);
      const headers = await this.deps.snapshots.list(workspaceId, periodId);
      const current = headers.at(-1)?.closeNo ?? 0;
      return headers.map((h) => toSummaryDto(h, current));
    });
  }

  getSnapshot(workspaceId: string, periodId: string, closeNo: number): Promise<CloseSnapshotDto> {
    return this.deps.uow.run(workspaceId, async () => {
      await this.period(workspaceId, periodId);
      const snapshot = await this.deps.snapshots.find(workspaceId, periodId, closeNo);
      if (!snapshot)
        throw new DomainError('RESOURCE_NOT_FOUND', `snapshot ${closeNo} of ${periodId} not found`);
      const current = (await this.deps.snapshots.list(workspaceId, periodId)).at(-1)?.closeNo ?? closeNo;
      return toSnapshotDto(snapshot, current);
    });
  }

  compare(workspaceId: string, periodId: string, from: number, to: number): Promise<CloseSnapshotDiffDto> {
    return this.deps.uow.run(workspaceId, async () => {
      await this.period(workspaceId, periodId);
      const a = await this.deps.snapshots.find(workspaceId, periodId, from);
      const b = await this.deps.snapshots.find(workspaceId, periodId, to);
      if (!a || !b) throw new DomainError('RESOURCE_NOT_FOUND', 'snapshot version not found');
      return { from, to, ...SnapshotComparator.diff(a.content, b.content) };
    });
  }

  /** `GET …/close-report`: la versión indicada o la vigente; `REFERENCE_NOT_FOUND` si el periodo nunca se cerró. */
  report(workspaceId: string, periodId: string, closeNo?: number): Promise<CloseReportDto> {
    return this.deps.uow.run(workspaceId, async () => {
      const { snapshot, headers } = await this.reportSource(workspaceId, periodId, closeNo);
      const current = headers.at(-1)?.closeNo ?? snapshot.closeNo;
      const { comparison, reason } = await this.comparisonOf(workspaceId, periodId, snapshot);
      return {
        snapshot: toSnapshotDto(snapshot, current),
        versions: headers.map((h) => toSummaryDto(h, current)),
        comparison,
        comparisonUnavailableReason: reason,
      };
    });
  }

  async exportReport(input: {
    readonly workspaceId: string;
    readonly periodId: string;
    readonly closeNo?: number;
    readonly format: CloseReportFormat;
  }): Promise<CloseReportFile> {
    const { workspaceId, periodId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const { snapshot, headers } = await this.reportSource(workspaceId, periodId, input.closeNo);
      const current = headers.at(-1)?.closeNo ?? snapshot.closeNo;
      const { comparison } = await this.comparisonOf(workspaceId, periodId, snapshot);
      const doc: CloseReportDocument = {
        label: snapshot.content.period.label,
        periodStart: snapshot.content.period.periodStart,
        periodEnd: snapshot.content.period.periodEnd,
        closeNo: snapshot.closeNo,
        closedAt: snapshot.closedAt,
        hasPreviousVersion: headers.some((h) => h.closeNo < snapshot.closeNo) || current > snapshot.closeNo,
        versions: headers.map((h) => toSummaryDto(h, current)),
        content: snapshot.content,
        comparison,
      };
      const base = `cierre-${doc.label}-v${doc.closeNo}`;
      if (input.format === 'csv') {
        return {
          fileName: `${base}.csv`,
          contentType: 'text/csv; charset=utf-8',
          body: new TextEncoder().encode(closeReportCsv(doc)),
        };
      }
      if (!this.pdf) throw new DomainError('INTERNAL_ERROR', 'PDF renderer is not configured');
      return { fileName: `${base}.pdf`, contentType: 'application/pdf', body: await this.pdf.render(doc) };
    });
  }

  /** `GET …/periods/{id}/lifecycle` (VIEWER+): máquina `FINANCIAL_PERIOD_LIFECYCLE` del periodo. */
  lifecycle(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly periodId: string;
  }): Promise<LifecycleDto> {
    const query = this.lifecycleQuery;
    if (!query) throw new DomainError('INTERNAL_ERROR', 'lifecycle query is not configured');
    return this.deps.uow.run(input.workspaceId, async () => {
      const period = await this.period(input.workspaceId, input.periodId);
      return query.lifecycleOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateType: 'FinancialPeriod',
        aggregateId: period.id,
        currentState: period.status,
      });
    });
  }

  /** `ClosingSnapshotQuery.listCurrent` (contrato público para `add-net-worth-evolution`). */
  listCurrent: ClosingSnapshotQuery['listCurrent'] = (input) =>
    this.deps.uow.run(input.workspaceId, async () => {
      const rows = await this.deps.snapshots.listCurrent(input.workspaceId, input.periodIds);
      return rows.map((s) => ({
        periodId: s.periodId,
        label: s.content.period.label,
        periodStart: s.content.period.periodStart,
        periodEnd: s.content.period.periodEnd,
        closeNo: s.closeNo,
        snapshotId: s.id,
        baseCurrency: s.content.baseCurrency,
        netWorth: {
          amount: s.content.netWorth.amount,
          complete: s.content.netWorth.complete,
          unconverted: s.content.netWorth.unconverted,
        },
        assets: s.content.netWorth.assets,
        liabilities: s.content.netWorth.liabilities,
      }));
    });

  private async period(workspaceId: string, periodId: string) {
    const p = await this.deps.periods.findById(workspaceId, periodId);
    if (!p) throw notFound(periodId);
    return p;
  }

  private async reportSource(
    workspaceId: string,
    periodId: string,
    closeNo: number | undefined,
  ): Promise<{ snapshot: StoredSnapshot; headers: readonly SnapshotHeader[] }> {
    await this.period(workspaceId, periodId);
    const headers = await this.deps.snapshots.list(workspaceId, periodId);
    const target = closeNo ?? headers.at(-1)?.closeNo;
    if (target === undefined) {
      throw new DomainError('REFERENCE_NOT_FOUND', `period ${periodId} has never been closed`);
    }
    const snapshot = await this.deps.snapshots.find(workspaceId, periodId, target);
    if (!snapshot)
      throw new DomainError('REFERENCE_NOT_FOUND', `snapshot ${target} of ${periodId} not found`);
    return { snapshot, headers };
  }

  /** Variación contra el snapshot VIGENTE del periodo inmediatamente anterior en el momento de la consulta. */
  private async comparisonOf(
    workspaceId: string,
    periodId: string,
    snapshot: StoredSnapshot,
  ): Promise<{
    comparison: CloseReportDto['comparison'];
    reason: CloseReportDto['comparisonUnavailableReason'];
  }> {
    const all = await this.deps.periods.list(workspaceId);
    const index = all.findIndex((p) => p.id === periodId);
    const previous = index > 0 ? all[index - 1] : undefined;
    if (!previous) return { comparison: null, reason: 'NO_PREVIOUS_PERIOD' };
    const [current] = await this.deps.snapshots.listCurrent(workspaceId, [previous.id]);
    if (!current) return { comparison: null, reason: 'NO_PREVIOUS_SNAPSHOT' };
    return {
      comparison: {
        previousPeriodId: previous.id,
        previousLabel: previous.label,
        previousCloseNo: current.closeNo,
        deltas: PeriodVariation.compare(snapshot.content, current.content),
      },
      reason: null,
    };
  }
}
