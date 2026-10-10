import type { LifecycleDto } from '@pf/audit/contracts';
import type { ResolvedRateDto, ValuationRateDto } from '@pf/fx/contracts';
import {
  DomainError,
  FlowValuation,
  LocalDate,
  Money,
  dec,
  currency as makeCurrency,
  present,
  type Currency,
} from '@pf/shared-kernel';
import type {
  CommittedItemDto,
  CommittedQuery,
  CommittedRangeDto,
  DefinitionStatsQuery,
  MoneyDto,
  ResolvedOccurrencesQuery,
  ResolvedOutflowDto,
  UpcomingPaymentDto,
  UpcomingPaymentsQuery,
} from '../contracts/index.js';
import {
  computeCommitted,
  countsAsCommittedOutflow,
  projectedAmount,
  type AccountClass,
  type CommittedLine,
  type DefinitionStatus,
  type OccurrenceStatus,
  type RecurringKind,
} from '../domain/index.js';
import type { CommitmentsDeps, OccurrenceView } from './ports/index.js';
import {
  definitionDto,
  money,
  needsApproval,
  occurrenceDto,
  type DefinitionDto,
  type OccurrenceDto,
} from './views.js';

const notFound = (what: string, id: string) =>
  new DomainError('RESOURCE_NOT_FOUND', `${what} ${id} not found`);

const UNRESOLVED: readonly OccurrenceStatus[] = ['SCHEDULED', 'DUE', 'OVERDUE'];

/** `CommittedAmount` del contrato HTTP. */
export interface CommittedAmountDto {
  readonly periodId: string;
  readonly periodLabel: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly byCurrency: readonly {
    readonly currency: string;
    readonly occurrences: MoneyDto;
    readonly pending: MoneyDto;
    readonly total: MoneyDto;
  }[];
  readonly consolidated: {
    readonly amount: MoneyDto;
    readonly complete: boolean;
    readonly unconverted: readonly MoneyDto[];
  };
  readonly expectedIncome: readonly MoneyDto[];
  readonly withoutAmountCount: number;
  readonly items: readonly CommittedItemDto[];
  readonly ratesUsed: readonly ResolvedRateDto[];
  readonly generatedAt: string;
}

const rateKey = (r: ResolvedRateDto) =>
  `${r.rate.base}/${r.rate.quote}:${r.fxRateId ?? r.asOf}:${r.derivation}`;

/**
 * Consultas de COMMITMENTS (openspec add-recurrence-engine decisiones 16 y 17): definiciones, ocurrencias, próximos
 * pagos y total comprometido, más los contratos públicos para Reporting. Lectura directa de la fuente de verdad
 * (RISK-022): nada se proyecta ni se cachea.
 */
export class CommitmentsQueries
  implements CommittedQuery, UpcomingPaymentsQuery, ResolvedOccurrencesQuery, DefinitionStatsQuery
{
  constructor(private readonly deps: CommitmentsDeps) {}

  private async todayOf(workspaceId: string): Promise<LocalDate> {
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    return LocalDate.ofInstant(this.deps.clock.now(), calendar.timeZone);
  }

  // ───────────────────────────────────────────────────────────── definiciones

  listDefinitions(
    workspaceId: string,
    filter: {
      status?: DefinitionStatus | undefined;
      kind?: RecurringKind | undefined;
      q?: string | undefined;
    },
  ): Promise<DefinitionDto[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const rows = await this.deps.definitions.list(workspaceId, filter);
      return rows.map((r) =>
        definitionDto(r.definition, {
          nextOccurrence: r.nextOccurrence,
          pendingApprovalCount: r.pendingApprovalCount,
        }),
      );
    });
  }

  getDefinition(workspaceId: string, definitionId: string): Promise<DefinitionDto> {
    return this.deps.uow.run(workspaceId, async () => {
      const def = await this.deps.definitions.findById(workspaceId, definitionId);
      if (!def) throw notFound('recurring definition', definitionId);
      return definitionDto(def, { withVersions: true });
    });
  }

  definitionLifecycle(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly definitionId: string;
  }): Promise<LifecycleDto> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const def = await this.deps.definitions.findById(input.workspaceId, input.definitionId);
      if (!def) throw notFound('recurring definition', input.definitionId);
      return this.lifecycleOf({
        ...input,
        aggregateType: 'RecurringDefinition',
        aggregateId: def.id,
        currentState: def.status,
      });
    });
  }

  occurrenceLifecycle(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly occurrenceId: string;
  }): Promise<LifecycleDto> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const occ = await this.deps.occurrences.findById(input.workspaceId, input.occurrenceId);
      if (!occ) throw notFound('recurring occurrence', input.occurrenceId);
      return this.lifecycleOf({
        ...input,
        aggregateType: 'RecurringOccurrence',
        aggregateId: occ.id,
        currentState: occ.status,
      });
    });
  }

  private lifecycleOf(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly aggregateType: 'RecurringDefinition' | 'RecurringOccurrence';
    readonly aggregateId: string;
    readonly currentState: string;
  }): Promise<LifecycleDto> {
    const query = this.deps.lifecycleQuery;
    if (!query) throw new DomainError('INTERNAL_ERROR', 'lifecycle query is not configured');
    return query.lifecycleOf({
      userId: input.userId,
      workspaceId: input.workspaceId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      currentState: input.currentState,
    });
  }

  // ───────────────────────────────────────────────────────────── ocurrencias

  /**
   * Lista de ocurrencias (próximos pagos y bandeja "por aprobar"): con `days` solo las no resueltas con vencimiento
   * hasta hoy + días (las atrasadas primero, de cualquier antigüedad).
   */
  listOccurrences(
    workspaceId: string,
    filter: {
      readonly definitionId?: string | undefined;
      readonly from?: string | undefined;
      readonly to?: string | undefined;
      readonly statuses?: readonly OccurrenceStatus[] | undefined;
      readonly requiresApproval?: boolean | undefined;
      readonly days?: number | undefined;
      readonly limit: number;
      readonly after?: readonly [string, string] | undefined;
    },
  ): Promise<OccurrenceDto[]> {
    return this.deps.uow.run(workspaceId, async () => {
      let dueTo = filter.to;
      let statuses = filter.statuses;
      if (filter.days !== undefined) {
        const today = await this.todayOf(workspaceId);
        dueTo = today.plusDays(filter.days).toString();
        statuses ??= UNRESOLVED;
      }
      // `limit` filas más una: la extra solo indica que hay otra página (`buildPage`).
      const rows = await this.deps.occurrences.list(workspaceId, {
        definitionId: filter.definitionId,
        statuses,
        dueFrom: filter.from,
        dueTo,
        requiresApproval: filter.requiresApproval,
        limit: filter.limit + 1,
        after: filter.after,
        order: 'DUE_DATE',
      });
      return rows.map(occurrenceDto);
    });
  }

  getOccurrence(workspaceId: string, id: string): Promise<OccurrenceDto> {
    return this.deps.uow.run(workspaceId, async () => {
      const view = await this.deps.occurrences.findView(workspaceId, id);
      if (!view) throw notFound('recurring occurrence', id);
      return occurrenceDto(view);
    });
  }

  /** Cantidad de ocurrencias por aprobar (contador de la sidebar). */
  async pendingApprovalCount(workspaceId: string): Promise<number> {
    return this.deps.uow.run(workspaceId, async () => {
      const rows = await this.deps.occurrences.list(workspaceId, { requiresApproval: true, limit: 1000 });
      return rows.filter((r) => needsApproval(r.occurrence.status, r.mode)).length;
    });
  }

  // ───────────────────────────────────────────────────────────── comprometido

  private async accountClasses(workspaceId: string): Promise<ReadonlyMap<string, AccountClass>> {
    const accounts = await this.deps.accountCatalog.listAccounts({ workspaceId, includeArchived: true });
    return new Map(accounts.map((a) => [a.accountId, { nature: a.nature, liquidity: a.liquidity }]));
  }

  private async currencyMap(workspaceId: string): Promise<(code: string) => Currency> {
    const catalog = await this.deps.rates.workspaceCurrencies(workspaceId);
    const known = new Map(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
    return (code) => {
      const found = known.get(code);
      if (!found) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not in the catalog`);
      return found;
    };
  }

  /** ¿La ocurrencia reduce el dinero disponible? (D127). */
  private isOutflow(view: OccurrenceView, classes: ReadonlyMap<string, AccountClass>): boolean {
    return countsAsCommittedOutflow({
      kind: view.kind,
      from: classes.get(view.accountId),
      to: view.toAccountId ? classes.get(view.toAccountId) : undefined,
    });
  }

  getForRange(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<CommittedRangeDto> {
    const { workspaceId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const composed = await this.compose(workspaceId, input.from, input.to);
      return composed.range;
    });
  }

  private async compose(workspaceId: string, from: string, to: string) {
    const { deps } = this;
    const [classes, currencyOf] = await Promise.all([
      this.accountClasses(workspaceId),
      this.currencyMap(workspaceId),
    ]);
    const unresolved = await deps.occurrences.listUnresolvedInRange(workspaceId, from, to);
    const pendingRows = await deps.pending.listPending({ workspaceId, dateFrom: from, dateTo: to });
    const items: CommittedItemDto[] = [];
    const lines: CommittedLine[] = [];
    const income: CommittedLine[] = [];
    for (const v of unresolved) {
      const o = v.occurrence;
      const projected = projectedAmount(o.expected);
      if (v.kind === 'INCOME') {
        income.push({ id: o.id, source: 'OCCURRENCE', currency: o.currency, amount: projected });
        continue;
      }
      if (!this.isOutflow(v, classes)) continue;
      lines.push({ id: o.id, source: 'OCCURRENCE', currency: o.currency, amount: projected });
      items.push({
        source: 'OCCURRENCE',
        id: o.id,
        definitionId: o.definitionId,
        name: v.definitionName,
        kind: v.kind,
        date: o.dueDate,
        amount: projected === null ? null : money(projected, o.currency),
        status: o.status,
      });
    }
    for (const p of pendingRows) {
      const counts = countsAsCommittedOutflow({
        kind: p.kind === 'EXPENSE' ? 'EXPENSE' : p.kind === 'TRANSFER' ? 'TRANSFER' : 'OTHER',
        from: classes.get(p.accountId),
        to: p.toAccountId ? classes.get(p.toAccountId) : undefined,
      });
      if (!counts) continue;
      lines.push({
        id: p.transactionId,
        source: 'PENDING',
        currency: p.amount.currency,
        amount: p.amount.amount,
      });
      items.push({
        source: 'PENDING',
        id: p.transactionId,
        definitionId: null,
        name: p.description,
        kind: p.kind,
        date: p.businessDate,
        amount: p.amount,
        status: null,
      });
    }
    const result = computeCommitted({ lines, income, currencyOf });
    const before = (await deps.occurrences.listUnresolvedBefore(workspaceId, from)).filter(
      (v) => v.kind !== 'INCOME' && this.isOutflow(v, classes),
    );
    const overdueTotals = computeCommitted({
      lines: before.map((v) => ({
        id: v.occurrence.id,
        source: 'OCCURRENCE' as const,
        currency: v.occurrence.currency,
        amount: projectedAmount(v.occurrence.expected),
      })),
      income: [],
      currencyOf,
    });
    items.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
    const range: CommittedRangeDto = {
      fromCommitments: result.byCurrency
        .filter((c) => !dec(c.occurrences).isZero())
        .map((c) => money(c.occurrences, c.currency)),
      fromPending: result.byCurrency
        .filter((c) => !dec(c.pending).isZero())
        .map((c) => money(c.pending, c.currency)),
      withoutAmountCount: result.withoutAmount.length,
      expectedIncome: result.expectedIncome.map((i) => money(i.amount, i.currency)),
      overdueBefore: {
        count: before.length,
        amounts: overdueTotals.byCurrency.map((c) => money(c.total, c.currency)),
      },
      items,
    };
    return { range, result, currencyOf };
  }

  /**
   * `GetCommitted` (Q4, FR-COMMITMENTS-011): comprometido del periodo (el de hoy por omisión) por moneda y consolidado
   * en la moneda base con la MISMA valoración del Home (`FlowValuation`, ventana de Reporting, D29/D34/D53): sin tasa
   * la parte queda sin convertir y el resultado incompleto, nunca 1:1.
   */
  getCommitted(workspaceId: string, periodId?: string): Promise<CommittedAmountDto> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const now = deps.clock.now();
      const settings = await deps.settings.settingsOf(workspaceId);
      const today = LocalDate.ofInstant(now, settings.timeZone);
      const period = periodId
        ? await deps.periods.getPeriod({ workspaceId, periodId })
        : await deps.periods.getPeriodContaining({ workspaceId, date: today.toString() });
      if (!period) throw notFound('financial period', periodId ?? today.toString());
      const { range, result, currencyOf } = await this.compose(
        workspaceId,
        period.periodStart,
        period.periodEnd,
      );
      const target = currencyOf(settings.baseCurrency);
      const flows = result.byCurrency.map((c) => ({
        date: today.toString(),
        amount: Money.parse(c.total, currencyOf(c.currency)),
      }));
      const rates = await FlowValuation.resolveRates<ResolvedRateDto>({
        flows,
        target,
        timeZone: settings.timeZone,
        now,
        windowDays: deps.rateValidityWindowDays,
        resolve: async ({ requests, windowDays }) => {
          const found = await deps.rates.resolveValuationRates({ workspaceId, requests, windowDays });
          return found.map((r: ValuationRateDto | null) =>
            r ? { exact: r.exact, resolved: r.resolved } : null,
          );
        },
        keyOf: rateKey,
      });
      const collector = rates.collector();
      const consolidated = FlowValuation.consolidate(flows, target, collector.rateFor);
      return {
        periodId: period.id,
        periodLabel: period.label,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        byCurrency: result.byCurrency.map((c) => ({
          currency: c.currency,
          occurrences: money(c.occurrences, c.currency),
          pending: money(c.pending, c.currency),
          total: money(c.total, c.currency),
        })),
        consolidated: {
          amount: present(consolidated.total, target).toJSON(),
          complete: consolidated.complete,
          unconverted: consolidated.unconverted.map((m) => m.toJSON()),
        },
        expectedIncome: range.expectedIncome,
        withoutAmountCount: range.withoutAmountCount,
        items: range.items,
        ratesUsed: collector.used(),
        generatedAt: now.toString(),
      };
    });
  }

  // ───────────────────────────────────────────────────────────── contratos públicos

  listUpcoming(input: {
    readonly workspaceId: string;
    readonly through: string;
  }): Promise<readonly UpcomingPaymentDto[]> {
    const { workspaceId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const classes = await this.accountClasses(workspaceId);
      const rows = await this.deps.occurrences.list(workspaceId, {
        statuses: UNRESOLVED,
        dueTo: input.through,
        order: 'DUE_DATE',
      });
      return rows
        .filter((v) => v.kind !== 'INCOME' && this.isOutflow(v, classes))
        .map((v): UpcomingPaymentDto => {
          const o = v.occurrence;
          const projected = projectedAmount(o.expected);
          return {
            occurrenceId: o.id,
            definitionId: o.definitionId,
            definitionName: v.definitionName,
            kind: v.kind,
            occurrenceDate: o.occurrenceDate,
            dueDate: o.dueDate,
            status: o.status as 'SCHEDULED' | 'DUE' | 'OVERDUE',
            requiresApproval: needsApproval(o.status, v.mode),
            expected: { ...o.expected, currency: o.currency },
            projected: projected === null ? null : money(projected, o.currency),
            accountId: v.accountId,
            toAccountId: v.toAccountId,
          };
        });
    });
  }

  listResolvedOutflows(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<readonly ResolvedOutflowDto[]> {
    const { workspaceId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const rows = await this.deps.occurrences.listResolvedOutflows(workspaceId, input.from, input.to);
      const txns = new Map(
        (
          await this.deps.links.getManyForLink({
            workspaceId,
            transactionIds: rows.map((r) => r.transactionId),
          })
        ).map((t) => [t.transactionId, t] as const),
      );
      const out: ResolvedOutflowDto[] = [];
      for (const r of rows) {
        const txn = txns.get(r.transactionId);
        if (!txn || txn.status === 'VOIDED') continue;
        out.push({
          occurrenceId: r.occurrenceId,
          definitionId: r.definitionId,
          definitionName: r.definitionName,
          generatedAt: r.generatedAt,
          resolution: r.resolution,
          matchedBy: r.matchedBy,
          transactionId: r.transactionId,
          transactionDate: txn.businessDate,
          amount: txn.amount,
        });
      }
      return out;
    });
  }

  hasActiveDefinitions(input: { readonly workspaceId: string }): Promise<boolean> {
    return this.deps.uow.run(input.workspaceId, () => this.deps.definitions.hasActive(input.workspaceId));
  }
}
