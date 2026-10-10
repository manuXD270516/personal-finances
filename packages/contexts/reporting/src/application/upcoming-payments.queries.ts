import type { RateAttributionDto, ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  currency as makeCurrency,
  DomainError,
  FlowValuation,
  LocalDate,
  Money,
  type Currency,
} from '@pf/shared-kernel';
import type {
  CommittedBlockDto,
  MoneyDto,
  ProjectedBalanceDto,
  SurprisePaymentsDto,
  UpcomingPaymentItemDto,
  UpcomingPaymentsDto,
  ValuedTotalDto,
} from '../contracts/index.js';
import {
  CommittedPeriod,
  countsAsOutflow,
  ProjectedBalanceCalculator,
  SurprisePaymentClassifier,
  UPCOMING_PAYMENTS_DURATION_METRIC,
  UPCOMING_PAYMENTS_ROWS_METRIC,
  UpcomingPaymentsAssembler,
  UpcomingValuation,
  UpcomingWindow,
  type AccountClass,
  type OccurrenceInput,
  type PendingInput,
  type UpcomingItem,
  type ValuedTotal,
} from '../domain/index.js';
import type { UpcomingPaymentsDeps } from './ports/index.js';
import { DEFAULT_RATE_VALIDITY_WINDOW_DAYS, rateKey } from './report-summary.queries.js';

export interface GetUpcomingPaymentsQuery {
  readonly userId: string | null;
  readonly workspaceId: string;
  /** Ventana en días (1..90, por defecto 30); fuera de rango ⇒ `INVALID_FILTER`. */
  readonly days?: number;
  /** Por defecto la moneda base del workspace. */
  readonly reportingCurrency?: string;
}

export interface UpcomingPaymentsResult {
  readonly upcoming: UpcomingPaymentsDto;
  /** Versión derivada de los datos del workspace (parte del ETag). */
  readonly dataVersion: string;
}

export interface GetSurprisePaymentsQuery {
  readonly userId: string | null;
  readonly workspaceId: string;
  /** Etiqueta `YYYY-MM` del periodo financiero; por defecto el que contiene hoy. */
  readonly period?: string;
}

/**
 * Los egresos resueltos se piden con holgura alrededor del periodo: COMMITMENTS filtra por el vencimiento de la ocurrencia
 * y SM-07 por la fecha de la transacción, que puede caer fuera del vencimiento (vinculada o aprobada antes o después).
 */
const RESOLVED_SLACK_DAYS = 62;

const monotonic = () => Number(process.hrtime.bigint()) / 1e9;

/**
 * Consultas de `reporting/cash-flow-calendar` en su versión simple de Phase 3 (add-upcoming-payments): lista de próximos
 * pagos (Q8), comprometido del periodo (Q4), saldo proyectado (FR-LEDGER-013) y pagos sorpresa (SM-07). Leen la FUENTE DE
 * VERDAD en una sola transacción de lectura con RLS (read-your-writes, decisión 1; docs/35 D117): contratos públicos de
 * Commitments, Transactions, Ledger, Accounts, Planning y FX. Todo lo financiero lo hacen los DS puros del dominio.
 */
export class UpcomingPaymentsQueries {
  constructor(private readonly deps: UpcomingPaymentsDeps) {}

  getUpcomingPayments(query: GetUpcomingPaymentsQuery): Promise<UpcomingPaymentsResult> {
    return this.deps.uow.run({ userId: query.userId, workspaceId: query.workspaceId }, () =>
      this.computeUpcoming(query),
    );
  }

  getSurprisePayments(query: GetSurprisePaymentsQuery): Promise<SurprisePaymentsDto> {
    return this.deps.uow.run({ userId: query.userId, workspaceId: query.workspaceId }, () =>
      this.computeSurprise(query),
    );
  }

  private async catalog(ws: string) {
    const catalog = await this.deps.rates.workspaceCurrencies(ws);
    const known = new Map<string, Currency>(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
    const enabled = new Set(catalog.filter((c) => c.enabled).map((c) => c.code));
    const decimalsOf = (amount: string) => amount.split('.')[1]?.length ?? 0;
    const scaleOf = (code: string, amount = '0') => known.get(code) ?? makeCurrency(code, decimalsOf(amount));
    const money = (dto: MoneyDto): Money => Money.parse(dto.amount, scaleOf(dto.currency, dto.amount));
    return { known, enabled, scaleOf, money };
  }

  private async computeUpcoming(query: GetUpcomingPaymentsQuery): Promise<UpcomingPaymentsResult> {
    const { deps } = this;
    const started = monotonic();
    const ws = query.workspaceId;
    const settings = await deps.workspaces.settingsOf(ws);
    const timeZone = settings.timeZone;
    const now = deps.clock.now();
    const window = UpcomingWindow.of(now, timeZone, query.days);
    const { known, enabled, scaleOf, money } = await this.catalog(ws);
    const reportingCode = query.reportingCurrency ?? settings.baseCurrency;
    const reporting = enabled.has(reportingCode) ? known.get(reportingCode) : undefined;
    if (!reporting) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${reportingCode} is not enabled`).at(
        '/reportingCurrency',
      );
    }
    const today = window.from.toString();
    const through = window.to.toString();

    // ---- lecturas (contratos públicos, misma transacción)
    const everyAccount = await deps.accounts.listAccounts({ workspaceId: ws, includeArchived: true });
    const accounts = await deps.accounts.listAccounts({ workspaceId: ws });
    const classes = new Map<string, AccountClass>(
      everyAccount.map((a) => [a.accountId, { nature: a.nature, liquidity: a.liquidity }]),
    );
    const accountName = new Map(everyAccount.map((a) => [a.accountId, a.name]));
    const balances = await deps.balances.getAccountBalances({
      workspaceId: ws,
      accountIds: accounts.map((a) => a.accountId),
      asOf: today,
    });
    const occurrenceRows = await deps.commitments.listUpcoming({ workspaceId: ws, through });
    const pendingRows = await deps.pending.listPending({ workspaceId: ws });
    const periods = await deps.periods.listPeriods({ workspaceId: ws });
    const period = CommittedPeriod.locate(periods, today);
    const committedRange = period
      ? await deps.commitments.getForRange({
          workspaceId: ws,
          from: period.periodStart,
          to: period.periodEnd,
        })
      : null;
    const hasActive = await deps.commitments.hasActiveDefinitions({ workspaceId: ws });

    // ---- dominio: lista
    const occurrences: OccurrenceInput[] = occurrenceRows.map((r) => {
      const at = (v: string | null) => (v === null ? null : Money.parse(v, scaleOf(r.expected.currency, v)));
      return {
        occurrenceId: r.occurrenceId,
        definitionId: r.definitionId,
        name: r.definitionName,
        dueDate: r.dueDate,
        status: r.status,
        requiresApproval: r.requiresApproval,
        amountType: r.expected.type,
        amount: at(r.expected.amount),
        min: at(r.expected.min),
        max: at(r.expected.max),
        accountId: r.accountId,
        toAccountId: r.toAccountId,
      };
    });
    const pending: PendingInput[] = pendingRows.map((p) => ({
      transactionId: p.transactionId,
      kind: p.kind,
      direction: p.direction,
      businessDate: p.businessDate,
      accountId: p.accountId,
      toAccountId: p.toAccountId,
      amount: money(p.amount),
      description: p.description,
      externalRef: p.externalRef,
    }));
    const items = UpcomingPaymentsAssembler.assemble({
      today: window.from,
      through,
      occurrences,
      pending,
      classes,
    });
    const { lines, withoutAmountCount } = UpcomingPaymentsAssembler.totals(items);

    // ---- comprometido del periodo (Q4)
    const committedLines = committedRange
      ? {
          fromCommitments: committedRange.fromCommitments.map(money),
          fromPending: committedRange.fromPending.map(money),
          overdue: committedRange.overdueBefore.amounts.map(money),
        }
      : null;

    // ---- tasas: UNA conversión por moneda con la tasa vigente al consultar (`FlowValuation` con fecha = hoy)
    const windowDays = deps.rateValidityWindowDays ?? DEFAULT_RATE_VALIDITY_WINDOW_DAYS;
    const rates = await FlowValuation.resolveRates<ResolvedRateDto>({
      flows: [
        ...lines,
        ...(committedLines
          ? [...committedLines.fromCommitments, ...committedLines.fromPending, ...committedLines.overdue]
          : []),
      ].map((amount) => ({ date: today, amount })),
      target: reporting,
      timeZone,
      now,
      windowDays,
      resolve: async ({ requests, windowDays: w }) => {
        const found = await deps.rates.resolveValuationRates({ workspaceId: ws, requests, windowDays: w });
        return found.map((r: ValuationRateDto | null) =>
          r ? { exact: r.exact, resolved: r.resolved } : null,
        );
      },
      keyOf: rateKey,
    });
    const collector = rates.collector();
    const rateFor = collector.rateFor;

    const totals = UpcomingValuation.value(lines, today, reporting, rateFor);
    const committed = this.committedBlock(period, committedLines, committedRange, today, reporting, rateFor);
    const itemDtos = items.map((i) => this.itemDto(i, accountName, today, reporting, rateFor));

    // ---- saldo proyectado (FR-LEDGER-013)
    const presented = new Map(
      balances.balances.filter((b) => b.accountId !== null).map((b) => [b.accountId as string, b.presented]),
    );
    const projected = ProjectedBalanceCalculator.compute(
      accounts.map((a) => ({
        accountId: a.accountId,
        name: a.name,
        currency: scaleOf(a.currency),
        booked: presented.has(a.accountId)
          ? money(presented.get(a.accountId) as MoneyDto)
          : Money.zero(scaleOf(a.currency)),
      })),
      pending,
    );
    const projectedBalances: ProjectedBalanceDto[] = projected.map((p) => ({
      accountId: p.accountId,
      accountName: p.name,
      currency: p.currency,
      booked: p.booked.toJSON(),
      pendingIn: p.pendingIn.toJSON(),
      pendingOut: p.pendingOut.toJSON(),
      projected: p.projected.toJSON(),
    }));

    const hasPendingOutflow = pending.some((p) =>
      countsAsOutflow({
        kind: p.kind,
        direction: p.direction,
        from: classes.get(p.accountId),
        to: p.toAccountId ? classes.get(p.toAccountId) : undefined,
      }),
    );
    const used = collector.used();
    const attributions = new Map<string, RateAttributionDto>();
    for (const r of used) if (r.attribution) attributions.set(r.attribution.provider, r.attribution);

    const upcoming: UpcomingPaymentsDto = {
      window: { from: today, to: through, days: window.days },
      items: itemDtos,
      totals: { ...valuedDto(totals), withoutAmountCount },
      committed,
      projectedBalances,
      hasCommitments: hasActive || hasPendingOutflow,
      meta: {
        generatedAt: now.toString(),
        reportingCurrency: reporting.code,
        timeZone,
        rateWindowDays: windowDays,
        ...(balances.latestEntryAt ? { dataFreshness: balances.latestEntryAt } : {}),
        approx: used.some((r) => r.approx),
        rates: used,
        attributions: [...attributions.values()],
      },
    };
    deps.metrics?.observe(UPCOMING_PAYMENTS_DURATION_METRIC, monotonic() - started);
    deps.metrics?.observe(UPCOMING_PAYMENTS_ROWS_METRIC, occurrenceRows.length + pendingRows.length);
    return { upcoming, dataVersion: await deps.versions.versionOf(ws) };
  }

  private committedBlock(
    period: { id: string; label: string; periodStart: string; periodEnd: string } | null,
    lines: { fromCommitments: Money[]; fromPending: Money[]; overdue: Money[] } | null,
    range: { withoutAmountCount: number; overdueBefore: { count: number } } | null,
    today: string,
    target: Currency,
    rateFor: Parameters<typeof UpcomingValuation.value>[3],
  ): CommittedBlockDto | null {
    if (!period || !lines || !range) return null;
    const v = CommittedPeriod.value({
      fromCommitments: lines.fromCommitments,
      fromPending: lines.fromPending,
      withoutAmountCount: range.withoutAmountCount,
      overdueBefore: { count: range.overdueBefore.count, amounts: lines.overdue },
      today,
      target,
      rateFor,
    });
    return {
      periodId: period.id,
      label: period.label,
      from: period.periodStart,
      to: period.periodEnd,
      total: valuedDto(v.total),
      fromCommitments: valuedDto(v.fromCommitments),
      fromPending: valuedDto(v.fromPending),
      withoutAmountCount: v.withoutAmountCount,
      overdueFromPreviousPeriods: {
        count: v.overdueFromPreviousPeriods.count,
        ...valuedDto(v.overdueFromPreviousPeriods),
      },
    };
  }

  private itemDto(
    i: UpcomingItem,
    accountName: ReadonlyMap<string, string>,
    today: string,
    target: Currency,
    rateFor: Parameters<typeof UpcomingValuation.value>[3],
  ): UpcomingPaymentItemDto {
    return {
      kind: i.kind,
      ...(i.occurrenceId ? { occurrenceId: i.occurrenceId } : {}),
      ...(i.definitionId ? { definitionId: i.definitionId } : {}),
      ...(i.transactionId ? { transactionId: i.transactionId } : {}),
      name: i.name,
      accountId: i.accountId,
      accountName: accountName.get(i.accountId) ?? '',
      date: i.date,
      status: i.status,
      ...(i.daysOverdue !== undefined ? { daysOverdue: i.daysOverdue } : {}),
      amountType: i.amountType,
      amount: i.amount ? i.amount.toJSON() : null,
      ...(i.range ? { range: { min: i.range.min.toJSON(), max: i.range.max.toJSON() } } : {}),
      estimated: i.estimated,
      withoutAmount: i.withoutAmount,
      converted: i.forTotals
        ? (UpcomingValuation.convert(i.forTotals, today, target, rateFor)?.toJSON() ?? null)
        : null,
    };
  }

  private async computeSurprise(query: GetSurprisePaymentsQuery): Promise<SurprisePaymentsDto> {
    const { deps } = this;
    const ws = query.workspaceId;
    const settings = await deps.workspaces.settingsOf(ws);
    const { scaleOf } = await this.catalog(ws);
    const today = LocalDate.ofInstant(deps.clock.now(), settings.timeZone).toString();
    const periods = await deps.periods.listPeriods({ workspaceId: ws });
    const period =
      query.period === undefined
        ? CommittedPeriod.locate(periods, today)
        : (periods.find((p) => p.label === query.period) ?? null);
    if (!period) {
      throw new DomainError(
        'RESOURCE_NOT_FOUND',
        `financial period ${query.period ?? `containing ${today}`} not found`,
      ).at('/period');
    }
    const resolved = await deps.commitments.listResolvedOutflows({
      workspaceId: ws,
      from: LocalDate.parse(period.periodStart).plusDays(-RESOLVED_SLACK_DAYS).toString(),
      to: LocalDate.parse(period.periodEnd).plusDays(RESOLVED_SLACK_DAYS).toString(),
    });
    const { items, partial } = SurprisePaymentClassifier.classify({
      resolved: resolved.map((r) => ({
        ...r,
        amount: Money.parse(r.amount.amount, scaleOf(r.amount.currency, r.amount.amount)),
      })),
      timeZone: settings.timeZone,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      today,
    });
    return {
      periodId: period.id,
      label: period.label,
      from: period.periodStart,
      to: period.periodEnd,
      partial,
      count: items.length,
      items: items.map((i) => ({
        transactionId: i.transactionId,
        date: i.date,
        name: i.name,
        amount: i.amount.toJSON(),
        occurrenceId: i.occurrenceId,
        definitionId: i.definitionId,
        generatedOn: i.generatedOn,
      })),
      note: 'UNLINKED_PAYMENTS_NOT_DETECTED',
    };
  }
}

const valuedDto = (v: ValuedTotal): ValuedTotalDto => ({
  byCurrency: v.byCurrency.map((m) => m.toJSON()),
  consolidated: {
    amount: v.consolidated.amount.toJSON(),
    complete: v.consolidated.complete,
    unconverted: v.consolidated.unconverted.map((m) => m.toJSON()),
  },
});
