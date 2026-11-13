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
  CashFlowOccurrenceDto,
  CashFlowOccurrencesDto,
  CommittedForSpendableDto,
  CommittedForSpendableItemDto,
  CommittedItemDto,
  CommittedQuery,
  CommittedRangeDto,
  DefinitionStatsQuery,
  MoneyDto,
  RecurringCostDto,
  RecurringCostQuery,
  ProjectedOccurrenceDto,
  ResolvedOccurrenceDto,
  ResolvedOccurrencesQuery,
  ResolvedOutflowDto,
  UpcomingPaymentDto,
  UpcomingPaymentsQuery,
} from '../contracts/index.js';
import {
  OccurrenceGenerator,
  computeCommitted,
  countsAsCommittedOutflow,
  projectedAmount,
  renewalsPerYear,
  buildSchedule,
  type AccountClass,
  type CommittedLine,
  type DefinitionStatus,
  type OccurrenceStatus,
  type RecurringKind,
} from '../domain/index.js';
import { indexCandidates } from './indexation.js';
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

/** Nombre visible de la ocurrencia: una cuota de préstamo lleva su número ("Préstamo vehicular — cuota 1"). */
const nameOf = (v: OccurrenceView): string =>
  v.kind === 'LOAN_PAYMENT' && v.occurrence.scheduleKey
    ? `${v.definitionName} — cuota ${v.occurrence.scheduleKey}`
    : v.definitionName;

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
  implements
    CommittedQuery,
    UpcomingPaymentsQuery,
    ResolvedOccurrencesQuery,
    DefinitionStatsQuery,
    RecurringCostQuery
{
  constructor(private readonly deps: CommitmentsDeps) {}

  private async todayOf(workspaceId: string): Promise<LocalDate> {
    const calendar = await this.deps.calendar.calendarOf(workspaceId);
    return LocalDate.ofInstant(this.deps.clock.now(), calendar.timeZone);
  }

  /**
   * `RecurringCostQuery.listCosts` (add-financial-reports-extended, reporte 11): las definiciones activas de egreso con
   * lo necesario para normalizarlas a costo mensual y anual (regla de `GetSubscriptionCostSummary`). Sin efectos.
   */
  async listCosts(input: { workspaceId: string }): Promise<readonly RecurringCostDto[]> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const today = await this.todayOf(input.workspaceId);
      const rows = await this.deps.definitions.list(input.workspaceId, { status: 'ACTIVE', kind: 'EXPENSE' });
      const out: RecurringCostDto[] = [];
      for (const { definition } of rows) {
        const v = definition.current;
        const cadence = v.schedule.cadence;
        if (cadence === 'EXPLICIT') continue;
        const schedule = buildSchedule({
          cadence,
          interval: v.schedule.interval,
          monthDays: v.schedule.monthDays,
          rrule: v.schedule.rrule,
          startDate: today.toString(),
        });
        const type = v.amount.type;
        const own = type === 'MIN_MAX' ? v.amount.max : v.amount.amount;
        const indexed = v.indexedPrice ?? null;
        const price = indexed ? indexed.amount : type === 'VARIABLE' ? null : own;
        out.push({
          definitionId: definition.id,
          name: definition.name,
          categoryId: v.categoryId,
          cadence,
          interval: v.schedule.interval,
          currency: indexed ? indexed.currency : v.currency,
          renewalsPerYear: renewalsPerYear(schedule, today).toString(),
          price,
          variable: price === null,
        });
      }
      return out.sort(
        (a, b) => a.name.localeCompare(b.name, 'es') || a.definitionId.localeCompare(b.definitionId),
      );
    });
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

  /**
   * Insumo de Q5 (`add-spendable-amount`, S1): las ocurrencias de egreso sin resolver con vencimiento ≤ `periodTo` (las
   * del periodo y las atrasadas, marcando `overdueFromPrevious` las anteriores a `periodFrom`) y las transacciones
   * `PENDING` de egreso con fecha ≤ `periodTo`, con la liquidez de origen y destino y `managedBy`. No aplica las
   * exclusiones de Q5 (REPORTING las aplica) y nunca informa ingresos. Misma lectura que `getForRange` (Q4 no cambia).
   */
  listForSpendable(input: {
    readonly workspaceId: string;
    readonly periodFrom: string;
    readonly periodTo: string;
  }): Promise<CommittedForSpendableDto> {
    const { workspaceId, periodFrom, periodTo } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const classes = await this.accountClasses(workspaceId);
      const liquid = (id: string | null) => {
        const c = id === null ? undefined : classes.get(id);
        return c === undefined ? null : c.nature === 'ASSET' && c.liquidity === 'LIQUID';
      };
      const unresolved = await this.deps.occurrences.list(workspaceId, {
        statuses: UNRESOLVED,
        dueTo: periodTo,
        order: 'DUE_DATE',
      });
      const pendingRows = await this.deps.pending.listPending({ workspaceId, dateTo: periodTo });
      const items: CommittedForSpendableItemDto[] = [];
      for (const v of unresolved) {
        if (v.kind === 'INCOME') continue;
        const o = v.occurrence;
        const projected = projectedAmount(o.expected);
        items.push({
          source: 'OCCURRENCE',
          id: o.id,
          definitionId: o.definitionId,
          name: nameOf(v),
          kind: v.kind,
          date: o.dueDate,
          accountId: v.accountId,
          toAccountId: v.toAccountId,
          sourceLiquid: liquid(v.accountId) === true,
          targetLiquid: liquid(v.toAccountId),
          managedBy: v.managedBy,
          amount: projected === null ? null : money(projected, o.currency),
          overdueFromPrevious: o.dueDate < periodFrom,
          categoryId: v.categoryId,
        });
      }
      for (const p of pendingRows) {
        if (p.kind !== 'EXPENSE' && p.kind !== 'TRANSFER') continue;
        items.push({
          source: 'PENDING',
          id: p.transactionId,
          definitionId: null,
          name: p.description,
          kind: p.kind,
          date: p.businessDate,
          accountId: p.accountId,
          toAccountId: p.toAccountId,
          sourceLiquid: liquid(p.accountId) === true,
          targetLiquid: liquid(p.toAccountId),
          managedBy: null,
          amount: p.amount,
          overdueFromPrevious: false,
          categoryId: p.categoryId ?? null,
        });
      }
      items.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
      return { items, withoutAmountCount: items.filter((i) => i.amount === null).length };
    });
  }

  private async compose(workspaceId: string, from: string, to: string) {
    const { deps } = this;
    const classes = await this.accountClasses(workspaceId);
    const currencyOf = await this.currencyMap(workspaceId);
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
        name: nameOf(v),
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
            definitionName: nameOf(v),
            kind: v.kind,
            ...(o.scheduleKey ? { scheduleKey: o.scheduleKey } : {}),
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

  /**
   * Insumo del calendario de flujo de caja (`add-cash-flow-forecast`, S1): TODAS las ocurrencias no resueltas (ingresos,
   * gastos, transferencias, cuotas de préstamo y pagos de tarjeta; también las administradas por una meta o una deuda) con
   * vencimiento ≤ `through` y de cualquier antigüedad, con la liquidez de origen y destino y la categoría. Las
   * materializadas como transacción pendiente ya no son `SCHEDULED/DUE/OVERDUE`: las informa TRANSACTIONS. Lectura
   * directa en la unidad de trabajo del llamador (RISK-022); `listUpcoming` y Q4/Q5/Q8 no cambian.
   */
  listForCashFlow(input: {
    readonly workspaceId: string;
    readonly through: string;
  }): Promise<CashFlowOccurrencesDto> {
    const { workspaceId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const classes = await this.accountClasses(workspaceId);
      const liquid = (id: string | null) => {
        const c = id === null ? undefined : classes.get(id);
        return c === undefined ? null : c.nature === 'ASSET' && c.liquidity === 'LIQUID';
      };
      const rows = await this.deps.occurrences.list(workspaceId, {
        statuses: UNRESOLVED,
        dueTo: input.through,
        order: 'DUE_DATE',
      });
      const items = rows.map((v): CashFlowOccurrenceDto => {
        const o = v.occurrence;
        return {
          occurrenceId: o.id,
          definitionId: o.definitionId,
          definitionName: nameOf(v),
          kind: v.kind,
          dueDate: o.dueDate,
          status: o.status as 'SCHEDULED' | 'DUE' | 'OVERDUE',
          expected: { ...o.expected, currency: o.currency },
          accountId: v.accountId,
          toAccountId: v.toAccountId,
          sourceLiquid: liquid(v.accountId) === true,
          targetLiquid: liquid(v.toAccountId),
          managedBy: v.managedBy,
          categoryId: v.categoryId,
        };
      });
      const today = await this.todayOf(workspaceId);
      return { items, generatedThrough: today.plusDays(this.deps.horizonDays).toString() };
    });
  }

  /**
   * `UpcomingPaymentsQuery.projectForForecast` (add-expense-forecasts, S1): las no resueltas ya generadas con
   * vencimiento en `[from, to]` y, de cada definición activa, las fechas posteriores a lo ya generado que el motor
   * de recurrencia calcularía (mismo `OccurrenceGenerator.candidates`: reglas de fin de mes y de fin de semana, versiones
   * vigentes y fin de la serie, y la misma estimación de precios indexados). No escribe nada: solo lee.
   */
  projectForForecast(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<readonly ProjectedOccurrenceDto[]> {
    const { workspaceId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const from = LocalDate.parse(input.from);
      const to = LocalDate.parse(input.to);
      const direction = (kind: string): 'OUTFLOW' | 'INFLOW' => (kind === 'INCOME' ? 'INFLOW' : 'OUTFLOW');
      const unresolved = await this.deps.occurrences.list(workspaceId, {
        statuses: UNRESOLVED,
        dueFrom: input.from,
        dueTo: input.to,
        order: 'DUE_DATE',
      });
      const out: ProjectedOccurrenceDto[] = unresolved.map((v) => {
        const o = v.occurrence;
        const money = (amount: string | null) => (amount === null ? null : { amount, currency: o.currency });
        return {
          date: o.dueDate,
          definitionId: o.definitionId,
          occurrenceId: o.id,
          projected: false,
          kind: v.kind,
          direction: direction(v.kind),
          amountType: o.expected.type,
          amount: money(o.expected.amount),
          minAmount: money(o.expected.min),
          maxAmount: money(o.expected.max),
          categoryId: v.categoryId,
          accountId: v.accountId,
          managedBy: v.managedBy,
          label: nameOf(v),
        };
      });
      const definitions = await this.deps.definitions.list(workspaceId, { status: 'ACTIVE' });
      for (const { definition } of definitions) {
        const through = definition.snapshot.generatedThrough;
        const start = through ? LocalDate.parse(through).plusDays(1) : from;
        const lo = start.compare(from) > 0 ? start : from;
        if (lo.compare(to) > 0) continue;
        // El ajuste de fin de semana puede mover el vencimiento unos días: se pide una ventana algo mayor.
        const existing = new Set(
          (await this.deps.occurrences.listExisting(workspaceId, definition.id, lo.toString())).map(
            (e) => e.occurrenceDate,
          ),
        );
        const planned = OccurrenceGenerator.plan(
          definition,
          { from: lo, to: to.plusDays(7) },
          existing,
        ).filter((c) => c.dueDate.compare(from) >= 0 && c.dueDate.compare(to) <= 0);
        if (planned.length === 0) continue;
        const indexed = await indexCandidates(this.deps, workspaceId, planned);
        const kind = definition.snapshot.kind as RecurringKind;
        for (const c of indexed) {
          const money = (amount: string | null) =>
            amount === null ? null : { amount, currency: c.currency };
          const version = definition.versionNo(c.versionNo);
          out.push({
            date: c.dueDate.toString(),
            definitionId: definition.id,
            occurrenceId: null,
            projected: true,
            kind,
            direction: direction(kind),
            amountType: c.expected.type,
            amount: money(c.expected.amount),
            minAmount: money(c.expected.min),
            maxAmount: money(c.expected.max),
            categoryId: version.categoryId,
            accountId: version.accountId,
            managedBy: definition.snapshot.managedBy,
            label:
              kind === 'LOAN_PAYMENT' && c.scheduleKey
                ? `${definition.name} — cuota ${c.scheduleKey}`
                : definition.name,
          });
        }
      }
      return out.sort((a, b) =>
        a.date === b.date ? (a.label < b.label ? -1 : 1) : a.date < b.date ? -1 : 1,
      );
    });
  }

  /** `ResolvedOccurrencesQuery.listResolved` (add-expense-forecasts, S2): la transacción fija la fecha y el monto. */
  listResolved(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
    readonly direction: 'OUTFLOW' | 'INFLOW';
  }): Promise<readonly ResolvedOccurrenceDto[]> {
    const { workspaceId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      // Una ocurrencia puede vencer en un periodo y pagarse en el siguiente: se amplía el rango del vencimiento y el
      // filtro definitivo es la fecha de la transacción.
      const rows = await this.deps.occurrences.listResolvedForForecast(
        workspaceId,
        LocalDate.parse(input.from).plusDays(-62).toString(),
        LocalDate.parse(input.to).plusDays(62).toString(),
        input.direction,
      );
      const txns = new Map(
        (
          await this.deps.links.getManyForLink({
            workspaceId,
            transactionIds: rows.map((r) => r.transactionId),
          })
        ).map((t) => [t.transactionId, t] as const),
      );
      const out: ResolvedOccurrenceDto[] = [];
      for (const r of rows) {
        const txn = txns.get(r.transactionId);
        if (!txn || txn.status === 'VOIDED') continue;
        if (txn.businessDate < input.from || txn.businessDate > input.to) continue;
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
          kind: r.kind,
          managedBy: r.managedBy,
          direction: input.direction,
          categoryId: r.categoryId,
        });
      }
      return out;
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
