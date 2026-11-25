import { DomainError } from '@pf/shared-kernel';
import type {
  SpendingAnomalyDismissReasonDto,
  SpendingAnomalyDto,
  SpendingAnomalyPageDto,
} from '../contracts/index.js';
import { DISMISS_REASONS, type DismissReason, type SpendingAnomaly } from '../domain/index.js';
import type { AnomalyDeps } from './anomaly-ports.js';

export const MAX_TRANSACTION_IDS = 100;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
const AGGREGATE = 'SpendingAnomaly';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export interface ListSpendingAnomaliesInput {
  readonly workspaceId: string;
  readonly status?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  /** Con ids, el resto de los filtros se ignora y se devuelven todos los estados salvo `SUPERSEDED`. */
  readonly transactionIds?: readonly string[] | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: { readonly date: string; readonly id: string } | undefined;
}

const invalidFilter = (message: string, pointer: string) =>
  new DomainError('INVALID_FILTER', message).at(pointer);

/** Consultas, descarte y restauración de los gastos atípicos (decisiones 7, 8 y 13). */
export class SpendingAnomalyQueries {
  constructor(private readonly deps: AnomalyDeps) {}

  async list(input: ListSpendingAnomaliesInput): Promise<SpendingAnomalyPageDto> {
    const { deps } = this;
    const featureStatus = deps.settings.enabled ? 'ENABLED' : 'DISABLED';
    if (input.transactionIds !== undefined) {
      if (input.transactionIds.length === 0 || input.transactionIds.length > MAX_TRANSACTION_IDS) {
        throw invalidFilter(
          `transactionId accepts between 1 and ${MAX_TRANSACTION_IDS} ids`,
          '/transactionId',
        );
      }
      if (input.transactionIds.some((id) => !UUID.test(id))) {
        throw invalidFilter('transactionId must be a UUID', '/transactionId');
      }
      return deps.uow.run(input.workspaceId, async () => {
        const found = await deps.anomalies.byTransactionIds(input.workspaceId, input.transactionIds ?? []);
        return { featureStatus, items: await this.present(input.workspaceId, found), nextCursor: null };
      });
    }
    const status = input.status ?? 'OPEN';
    if (status !== 'OPEN' && status !== 'DISMISSED' && status !== 'ALL') {
      throw invalidFilter('status must be OPEN, DISMISSED or ALL', '/status');
    }
    for (const [key, value] of [
      ['from', input.from],
      ['to', input.to],
    ] as const) {
      if (value !== undefined && !LOCAL_DATE.test(value)) {
        throw invalidFilter(`${key} must be YYYY-MM-DD`, `/${key}`);
      }
    }
    if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
      throw invalidFilter('from must not be after to', '/from');
    }
    const limit = input.limit ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new DomainError('VALIDATION_FAILED', `limit must be between 1 and ${MAX_PAGE_SIZE}`).at('/limit');
    }
    return deps.uow.run(input.workspaceId, async () => {
      const rows = await deps.anomalies.list(input.workspaceId, {
        status,
        from: input.from,
        to: input.to,
        cursor: input.cursor,
        limit,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        featureStatus,
        items: await this.present(input.workspaceId, page),
        nextCursor: rows.length > limit && last ? `${last.snapshot.transactionDate}|${last.id}` : null,
      };
    });
  }

  /** «No es atípico» (OWNER y EDITOR): inocuo si ya estaba descartado; 404 si no existe, es de otro workspace o fue reemplazado. */
  dismiss(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly anomalyId: string;
    readonly reason?: string | undefined;
    readonly note?: string | undefined;
  }): Promise<void> {
    if (input.reason !== undefined && !(DISMISS_REASONS as readonly string[]).includes(input.reason)) {
      throw new DomainError('VALIDATION_FAILED', 'reason must be EXPECTED_ONE_OFF, NOT_UNUSUAL or OTHER').at(
        '/reason',
      );
    }
    return this.decide(input, 'DISMISS', (anomaly, at) =>
      anomaly.dismiss({
        actorId: input.userId,
        at,
        reason: input.reason as DismissReason | undefined,
        note: input.note,
      }),
    );
  }

  restore(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly anomalyId: string;
  }): Promise<void> {
    return this.decide(input, 'RESTORE', (anomaly, at) => anomaly.restoreOpen({ actorId: input.userId, at }));
  }

  private decide(
    input: { readonly userId: string; readonly workspaceId: string; readonly anomalyId: string },
    decision: 'DISMISS' | 'RESTORE',
    apply: (anomaly: SpendingAnomaly, at: string) => ReturnType<SpendingAnomaly['dismiss']>,
  ): Promise<void> {
    const { deps } = this;
    return deps.uow.run(input.workspaceId, async () => {
      const anomaly = await deps.anomalies.findById(input.workspaceId, input.anomalyId);
      if (!anomaly) throw new DomainError('RESOURCE_NOT_FOUND', 'spending anomaly not found');
      const expected = anomaly.version;
      const result = apply(anomaly, deps.clock.now().toString());
      if (!result.changed) return;
      if (!(await deps.anomalies.save(anomaly, expected))) {
        throw new DomainError('RESOURCE_NOT_FOUND', 'spending anomaly not found');
      }
      await deps.audit.append({
        workspaceId: input.workspaceId,
        action: `forecasting.spending_anomaly.${decision === 'DISMISS' ? 'dismissed' : 'restored'}`,
        aggregateType: AGGREGATE,
        aggregateId: anomaly.id,
        aggregateVersion: anomaly.version,
        actor: { type: 'USER', userId: input.userId },
        changes: result.changes,
      });
      deps.metrics.decided(decision);
    });
  }

  /** Oculta las de transacciones anuladas o inexistentes y marca las editadas desde la detección. */
  private async present(
    workspaceId: string,
    anomalies: readonly SpendingAnomaly[],
  ): Promise<SpendingAnomalyDto[]> {
    if (anomalies.length === 0) return [];
    const states = await this.deps.transactions.statesOf(workspaceId, [
      ...new Set(anomalies.map((a) => a.snapshot.transactionId)),
    ]);
    const byId = new Map(states.map((s) => [s.transactionId, s]));
    const out: SpendingAnomalyDto[] = [];
    for (const a of anomalies) {
      const s = a.snapshot;
      const state = byId.get(s.transactionId);
      if (!state || state.status === 'VOIDED') continue;
      out.push({
        id: s.id,
        transactionId: s.transactionId,
        transactionVersion: s.transactionVersion,
        transactionDate: s.transactionDate,
        transactionChanged: state.version !== s.transactionVersion,
        amount: s.amount,
        reportingAmount: s.reportingAmount,
        categoryIds: s.categoryIds,
        counterpartyId: s.counterpartyId,
        reasons: s.reasons.map((r) => ({
          kind: r.kind,
          categoryId: r.categoryId,
          counterpartyId: r.counterpartyId,
          reference: { amount: r.reference, currency: s.reportingAmount.currency },
          ratio: r.ratio,
          robustScore: r.robustScore,
          sampleSize: r.sampleSize,
        })),
        status: s.status === 'DISMISSED' ? 'DISMISSED' : 'OPEN',
        detectedAt: s.detectedAt,
        decidedAt: s.decidedAt,
        decidedBy: s.decidedBy,
        dismissReason: s.dismissReason as SpendingAnomalyDismissReasonDto | null,
      });
    }
    return out;
  }
}
