import { DomainError, LocalDate, Money, plusDays, type DatedAmount } from '@pf/shared-kernel';
import {
  MAX_REPORT_EXPORT_ROWS,
  type AccountBalanceHistoryReportDto,
  type BudgetVsActualReportDto,
  type CashFlowReportDto,
  type ExpensesByCategoryReportDto,
  type IncomeExpensesReportDto,
  type NetWorthReportDto,
  type ReportDrillDownPageDto,
  type ReportDrillDownRowDto,
} from '../contracts/financial-reports.js';
import {
  COMPONENT_CLASSES,
  NetWorthDecomposer,
  ReportConversionPolicy,
  type FlowCounterpart,
  type LiquidityComponent,
} from '../domain/index.js';
import { csvCell, UTF8_BOM } from './csv.js';
import {
  FinancialReportsQueries,
  type ExpensesByCategoryParams,
  type IncomeExpensesParams,
  type NetWorthParams,
  type ReportResult,
} from './financial-reports.queries.js';
import { amountDto, invalid, type ReportContext, type ReportParams } from './report-context.js';

export type DrillDownReport =
  | 'INCOME_EXPENSES'
  | 'EXPENSES_BY_CATEGORY'
  | 'BUDGET_VS_ACTUAL'
  | 'CASH_FLOW'
  | 'ACCOUNT_BALANCE_HISTORY'
  | 'NET_WORTH';

/** Componentes de la descomposición del patrimonio que se pueden abrir hasta las cuentas (reporting/net-worth). */
export type NetWorthComponent =
  'savings' | 'conversionResult' | 'adjustments' | 'otherMovements' | 'fxRevaluation' | 'assetRevaluation';
const NET_WORTH_COMPONENTS: readonly string[] = [
  'savings',
  'conversionResult',
  'adjustments',
  'otherMovements',
  'fxRevaluation',
  'assetRevaluation',
];

export interface DrillDownParams extends ReportParams {
  readonly report: DrillDownReport;
  /** Naturaleza de la celda de ingresos y gastos o gastos por categoría. */
  readonly nature?: 'INCOME' | 'EXPENSE';
  readonly categoryGroupId?: string;
  readonly budgetPeriodId?: string;
  readonly budgetLineId?: string;
  readonly component?: LiquidityComponent | NetWorthComponent;
  /** Historial de saldo: cuenta y día. */
  readonly accountId?: string;
  readonly date?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ReportExport {
  readonly fileName: string;
  readonly contentType: 'text/csv; charset=utf-8';
  readonly body: Buffer;
  readonly rowCount: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PAGE = 200;

const tooLarge = (count: number) =>
  new DomainError(
    'REPORT_EXPORT_TOO_LARGE',
    `the export would have ${count} rows and the limit is ${MAX_REPORT_EXPORT_ROWS}`,
  );

const csv = (rows: readonly (readonly (string | number | boolean | null)[])[]): string =>
  rows.map((r) => r.map((c) => csvCell(c === null ? '' : String(c))).join(',')).join('\r\n');

/**
 * Drill-down y exportación CSV de los reportes (add-financial-reports, FR-REPORTING-010 y 012). La celda y su detalle
 * usan el MISMO predicado y la misma resolución de tasas, así que Σ filas = cifra de la celda. Las exportaciones son
 * síncronas con tope de 50 000 filas (`REPORT_EXPORT_TOO_LARGE`, D370), se auditan sin contenido y neutralizan las
 * celdas de texto contra fórmulas.
 */
export class FinancialReportsService extends FinancialReportsQueries {
  // ───────────────────────────────────────────── drill-down

  getDrillDown(params: DrillDownParams): Promise<ReportResult<ReportDrillDownPageDto>> {
    return this.run(params.report, params, (ctx) => this.drill(ctx, params));
  }

  private async drill(ctx: ReportContext, p: DrillDownParams): Promise<ReportDrillDownPageDto> {
    const limit = p.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw invalid('limit must be between 1 and 200', '/limit');
    }
    LocalDate.parse(p.from);
    LocalDate.parse(p.to);
    if (p.from > p.to) throw invalid('from must not be after to', '/from');
    const ws = p.workspaceId;
    const f = ctx.filters;
    if (p.report === 'NET_WORTH') return this.drillNetWorth(ctx, p);
    type Row = {
      readonly base: Omit<ReportDrillDownRowDto, 'amount' | 'valued' | 'rate'>;
      readonly money: Money;
    };
    let rows: Row[] = [];
    const cellRows: DatedAmount[] = [];
    let nextCursor: string | null = null;
    let count = 0;
    let kind: ReportDrillDownPageDto['kind'] = 'PORTION';

    if (p.report === 'CASH_FLOW' || p.report === 'ACCOUNT_BALANCE_HISTORY') {
      let ids: string[];
      let counterparts: readonly string[] | undefined;
      let from = p.from;
      let to = p.to;
      let component: string | null = null;
      if (p.report === 'ACCOUNT_BALANCE_HISTORY') {
        if (!p.accountId || !p.date) throw invalid('accountId and date are required', '/accountId');
        const account = (
          await this.deps.accounts.listAccounts({ workspaceId: ws, includeArchived: true })
        ).find((a) => a.accountId === p.accountId);
        if (!account) throw new DomainError('RESOURCE_NOT_FOUND', 'account not found');
        ids = [p.accountId];
        from = p.date;
        to = p.date;
        kind = 'ACCOUNT_MOVEMENT';
      } else {
        if (!p.component || !(p.component in COMPONENT_CLASSES)) {
          throw invalid('component is required', '/component');
        }
        ids = (await this.deps.accounts.listAccounts({ workspaceId: ws }))
          .filter(
            (a) =>
              a.liquidity === 'LIQUID' &&
              (f.accountIds.length === 0 || f.accountIds.includes(a.accountId)) &&
              (f.currencies.length === 0 || f.currencies.includes(a.currency)),
          )
          .map((a) => a.accountId);
        counterparts = COMPONENT_CLASSES[p.component as LiquidityComponent];
        component = p.component;
        kind = 'LIQUIDITY_MOVEMENT';
      }
      if (ids.length > 0) {
        const page = await this.deps.accountFlows.listMovements({
          workspaceId: ws,
          accountIds: ids,
          dateFrom: from,
          dateTo: to,
          ...(counterparts ? { counterparts: counterparts as never } : {}),
          limit,
          ...(p.cursor ? { cursor: p.cursor } : {}),
        });
        count = page.count;
        nextCursor = page.nextCursor;
        rows = page.rows.map((r) => ({
          base: {
            transactionId: r.transactionId,
            splitId: null,
            journalEntryId: r.journalEntryId,
            date: r.businessDate,
            accountId: r.accountIds[0] ?? null,
            accountIds: r.accountIds,
            categoryId: null,
            counterpartyId: null,
            description: null,
            nature: null,
            component: component ?? r.counterpart,
          },
          money: ctx.money({ amount: r.amount, currency: r.currency }),
        }));
        // La celda completa (para el total consolidado): mismos filtros y clases.
        for (const r of await this.deps.accountFlows.summarize({
          workspaceId: ws,
          accountIds: ids,
          dateFrom: from,
          dateTo: to,
        })) {
          if (counterparts && !counterparts.includes(r.counterpart)) continue;
          cellRows.push({
            date: ctx.flowDate(r.businessDate),
            amount: ctx.money({ amount: r.amount, currency: r.currency }),
          });
        }
      }
    } else {
      // Porciones: ingresos y gastos, gastos por categoría y presupuesto vs real comparten el predicado de la celda.
      let categoryIds: readonly string[] | undefined =
        f.requestedCategoryIds.length > 0 ? f.categoryIds : undefined;
      let tagIds: readonly string[] | undefined = f.tagIds.length > 0 ? f.tagIds : undefined;
      let nature = p.nature;
      let from = p.from;
      let to = p.to;
      if (p.categoryGroupId) {
        categoryIds = ctx.tree.categories
          .filter((c) => c.groupId === p.categoryGroupId)
          .map((c) => c.categoryId);
      }
      if (p.report === 'BUDGET_VS_ACTUAL') {
        if (!p.budgetPeriodId || !p.budgetLineId)
          throw invalid('budgetPeriodId and budgetLineId are required', '/budgetLineId');
        const period = (await this.deps.periods.listPeriods({ workspaceId: ws })).find(
          (x) => x.id === p.budgetPeriodId,
        );
        if (!period) throw new DomainError('RESOURCE_NOT_FOUND', 'period not found');
        const vs = await this.deps.budgets.getForPeriod({ workspaceId: ws, periodId: p.budgetPeriodId });
        const line = vs?.lines.find((l) => l.budgetLineId === p.budgetLineId);
        if (!line) throw new DomainError('RESOURCE_NOT_FOUND', 'budget line not found');
        from = period.periodStart;
        to = period.periodEnd;
        nature = line.nature === 'INCOME' ? 'INCOME' : 'EXPENSE';
        if (line.target.kind === 'TAG') {
          tagIds = [line.target.id];
          categoryIds = undefined;
        } else if (line.target.kind === 'GROUP') {
          categoryIds = ctx.tree.categories
            .filter((c) => c.groupId === line.target.id)
            .map((c) => c.categoryId);
        } else {
          categoryIds = [
            line.target.id,
            ...ctx.tree.categories.filter((c) => c.parentId === line.target.id).map((c) => c.categoryId),
          ];
        }
      }
      if (p.report === 'EXPENSES_BY_CATEGORY') nature = 'EXPENSE';
      const filters = {
        workspaceId: ws,
        dateFrom: from,
        dateTo: to,
        ...(nature ? { nature } : {}),
        ...(categoryIds ? { categoryIds } : {}),
        ...(f.accountIds.length > 0 ? { accountIds: f.accountIds } : {}),
        ...(f.counterpartyIds.length > 0 ? { counterpartyIds: f.counterpartyIds } : {}),
        ...(tagIds ? { tagIds } : {}),
        ...(f.currencies.length > 0 ? { currencies: f.currencies } : {}),
      };
      const page = await this.deps.portions.listPortions({
        ...filters,
        limit,
        ...(p.cursor ? { cursor: p.cursor } : {}),
      });
      count = page.count;
      nextCursor = page.nextCursor;
      rows = page.rows.map((r) => ({
        base: {
          transactionId: r.transactionId,
          splitId: r.splitId,
          journalEntryId: null,
          date: r.businessDate,
          accountId: r.accountId,
          accountIds: null,
          categoryId: r.categoryId,
          counterpartyId: r.counterpartyId,
          description: r.description,
          nature: r.nature,
          component: null,
        },
        money: ctx.money(r.amount),
      }));
      // La celda completa por (día, moneda): el mismo agregado que el reporte (`summarizeNominalFlows`).
      for (const r of await this.deps.flows.summarizeNominalFlows({
        workspaceId: ws,
        dateFrom: from,
        dateTo: to,
        ...(categoryIds ? { categoryIds } : {}),
        ...(f.accountIds.length > 0 ? { accountIds: f.accountIds } : {}),
        ...(f.counterpartyIds.length > 0 ? { counterpartyIds: f.counterpartyIds } : {}),
        ...(tagIds ? { tagIds } : {}),
        ...(f.currencies.length > 0 ? { currencies: f.currencies } : {}),
      })) {
        if (nature && r.nature !== nature) continue;
        cellRows.push({ date: ctx.flowDate(r.businessDate), amount: ctx.money(r.amount) });
      }
    }

    await ctx.resolveRates([
      ...cellRows,
      ...rows.map((r) => ({ date: ctx.flowDate(r.base.date), amount: r.money })),
    ]);
    const policy = ctx.flowPolicy();
    const totals = policy.value(cellRows.map((r) => ({ date: r.date, amount: r.amount })));
    ctx.track(totals);
    const out: ReportDrillDownRowDto[] = rows.map((r) => {
      const v = policy.value([{ date: r.base.date, amount: r.money }]);
      return {
        ...r.base,
        amount: r.money.toJSON(),
        valued: v.complete ? v.consolidated.toJSON() : null,
        rate: ctx.rateOf(r.money.currency.code, r.base.date),
      };
    });
    const meta = await ctx.meta({
      reportId: p.report,
      periods: [],
      comparison: null,
      policy: 'TRANSACTION_DATE',
    });
    return { meta, kind, totals: amountDto(totals), count, rows: out, nextCursor };
  }

  /**
   * Drill-down del patrimonio (Should): las cuentas del patrimonio que componen un componente de la descomposición de
   * un rango, con su saldo nativo al cierre y el monto del componente en la moneda de reporte. Cada cuenta se
   * descompone con el mismo `NetWorthDecomposer` y las mismas tasas, así que la suma de las cuentas es el componente.
   */
  private async drillNetWorth(ctx: ReportContext, p: DrillDownParams): Promise<ReportDrillDownPageDto> {
    const component = p.component as NetWorthComponent | undefined;
    if (!component || !NET_WORTH_COMPONENTS.includes(component)) {
      throw invalid('component is required for the net worth drill-down', '/component');
    }
    const ws = p.workspaceId;
    const dayBefore = plusDays(LocalDate.parse(p.from), -1).toString();
    const accounts = (
      await this.deps.accounts.listAccounts({ workspaceId: ws, includeArchived: true })
    ).filter((a) => a.includeInNetWorth);
    const history =
      accounts.length === 0
        ? {
            byDate: [] as {
              asOf: string;
              balances: { accountId: string | null; balance: { amount: string; currency: string } }[];
            }[],
          }
        : await this.deps.balanceHistory.getAccountBalancesAtDates({
            workspaceId: ws,
            accountIds: accounts.map((a) => a.accountId),
            dates: [dayBefore, p.to],
          });
    const balanceOf = (date: string, accountId: string): Money[] =>
      (history.byDate.find((d) => d.asOf === date)?.balances ?? [])
        .filter((b) => b.accountId === accountId)
        .map((b) => ctx.money(b.balance));
    const perAccount: {
      account: (typeof accounts)[number];
      opening: Money[];
      closing: Money[];
      flows: { date: string; currency: string; counterpart: FlowCounterpart; amount: Money }[];
    }[] = [];
    // Una consulta por cuenta, una tras otra sobre el mismo cliente (nunca en paralelo).
    for (const account of accounts) {
      const flows = (
        await this.deps.accountFlows.summarize({
          workspaceId: ws,
          accountIds: [account.accountId],
          dateFrom: p.from,
          dateTo: p.to,
        })
      ).map((r) => ({
        date: r.businessDate,
        currency: r.currency,
        counterpart: r.counterpart as FlowCounterpart,
        amount: ctx.money({ amount: r.amount, currency: r.currency }),
      }));
      perAccount.push({
        account,
        opening: balanceOf(dayBefore, account.accountId),
        closing: balanceOf(p.to, account.accountId),
        flows,
      });
    }
    await ctx.resolveRates(
      perAccount.flatMap((x) => [
        ...x.opening.map((amount) => ({ date: dayBefore, amount })),
        ...x.closing.map((amount) => ({ date: p.to, amount })),
        ...x.flows.map((fl) => ({ date: fl.date, amount: fl.amount })),
      ]),
    );
    const currencies = new Map(ctx.known);
    const rows: ReportDrillDownRowDto[] = [];
    let total = ctx.flowPolicy().zero();
    for (const x of perAccount) {
      for (const m of [...x.opening, ...x.closing, ...x.flows.map((fl) => fl.amount)])
        currencies.set(m.currency.code, m.currency);
      const d = NetWorthDecomposer.decompose({
        target: ctx.reporting,
        currencies,
        kinds: ctx.kinds,
        opening: x.opening,
        closing: x.closing,
        openingDate: dayBefore,
        closingDate: p.to,
        flows: x.flows,
        rateFor: (code, date) => ctx.rateFor(code, date),
      });
      const value = d[component];
      if (value.isZero() && !x.closing.some((m) => !m.isZero())) continue;
      if (value.isZero()) continue;
      const native = x.closing[0] ?? Money.zero(ctx.currencyOf(x.account.currency));
      rows.push({
        transactionId: null,
        splitId: null,
        journalEntryId: null,
        date: p.to,
        accountId: x.account.accountId,
        accountIds: [x.account.accountId],
        categoryId: null,
        counterpartyId: null,
        description: x.account.name,
        nature: null,
        component,
        amount: native.toJSON(),
        valued: value.toJSON(),
        rate: null,
      });
      total = ReportConversionPolicy.combine(ctx.reporting, [
        total,
        {
          ...total,
          exact: value.toDecimal(),
          consolidated: value,
          byCurrency: [],
          unconverted: [],
          complete: d.complete,
        },
      ]);
    }
    const meta = await ctx.meta({
      reportId: 'NET_WORTH',
      periods: [],
      comparison: null,
      policy: 'TRANSACTION_DATE',
    });
    return {
      meta,
      kind: 'NET_WORTH_ACCOUNT',
      totals: amountDto(total),
      count: rows.length,
      rows,
      nextCursor: null,
    };
  }

  // ───────────────────────────────────────────── exportación CSV

  private async finish(
    result: ReportResult<{
      readonly meta: { readonly filters: unknown; readonly from: string; readonly to: string };
    }>,
    ctx: { reportId: string; userId: string | null; workspaceId: string },
    fileSlug: string,
    lines: readonly (readonly (string | number | boolean | null)[])[],
  ): Promise<ReportExport> {
    const rowCount = Math.max(0, lines.length - 1);
    if (rowCount > MAX_REPORT_EXPORT_ROWS) throw tooLarge(rowCount);
    // La auditoría va DESPUÉS de validar el tope (una exportación rechazada no deja registro) y sin el contenido.
    await this.auditExport({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      reportId: ctx.reportId,
      filters: {
        from: result.report.meta.from,
        to: result.report.meta.to,
        ...(result.report.meta.filters as object),
      },
      rowCount,
    });
    // Bloques de 1000 filas: el cuerpo se arma por partes sin un único concatenado intermedio gigante.
    const chunks: string[] = [UTF8_BOM];
    for (let i = 0; i < lines.length; i += 1000) chunks.push(`${csv(lines.slice(i, i + 1000))}\r\n`);
    return {
      fileName: `${fileSlug}-${result.report.meta.from}-${result.report.meta.to}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: Buffer.from(chunks.join(''), 'utf8'),
      rowCount,
    };
  }

  private async auditExport(input: {
    workspaceId: string;
    userId: string | null;
    reportId: string;
    filters: object;
    rowCount: number;
  }): Promise<void> {
    if (!this.deps.audit) return;
    await this.deps.uow.run({ userId: input.userId, workspaceId: input.workspaceId }, () =>
      this.deps.audit!.exported({
        workspaceId: input.workspaceId,
        userId: input.userId,
        reportId: input.reportId,
        filters: JSON.stringify(input.filters),
        rowCount: input.rowCount,
      }),
    );
  }

  async exportIncomeExpenses(p: IncomeExpensesParams): Promise<ReportExport> {
    const res = await this.getIncomeExpenses(p);
    const r: IncomeExpensesReportDto = res.report;
    const policy = r.meta.conversion.policy;
    const tail = [policy, r.meta.reportingCurrency];
    const lines: (string | number | boolean | null)[][] = [
      [
        'period_label',
        'period_from',
        'period_to',
        'partial',
        'row_kind',
        'currency',
        'income',
        'expenses',
        'savings',
        'savings_rate',
        'conversion_policy',
        'reporting_currency',
        'complete',
      ],
    ];
    for (const row of r.rows) {
      const codes = [
        ...new Set([...row.income.byCurrency, ...row.expenses.byCurrency].map((m) => m.currency)),
      ].sort();
      for (const c of codes) {
        const inc = row.income.byCurrency.find((m) => m.currency === c);
        const exp = row.expenses.byCurrency.find((m) => m.currency === c);
        const zero = (inc ?? exp)!;
        const sav = Money.parse(inc?.amount ?? zeroLike(zero.amount), c, scaleOf(zero.amount)).subtract(
          Money.parse(exp?.amount ?? zeroLike(zero.amount), c, scaleOf(zero.amount)),
        );
        lines.push([
          row.period.label,
          row.period.from,
          row.period.to,
          row.period.partial,
          'NATIVE',
          c,
          inc?.amount ?? zeroLike(zero.amount),
          exp?.amount ?? zeroLike(zero.amount),
          sav.toFixed(),
          '',
          ...tail,
          true,
        ]);
      }
      lines.push([
        row.period.label,
        row.period.from,
        row.period.to,
        row.period.partial,
        'CONSOLIDATED',
        r.meta.reportingCurrency,
        row.income.consolidated.amount,
        row.expenses.consolidated.amount,
        row.savings.consolidated.amount,
        row.savingsRate,
        ...tail,
        row.income.complete && row.expenses.complete,
      ]);
    }
    return this.finish(
      res,
      { reportId: 'INCOME_EXPENSES', userId: p.userId, workspaceId: p.workspaceId },
      'income-expenses',
      lines,
    );
  }

  async exportExpensesByCategory(p: ExpensesByCategoryParams): Promise<ReportExport> {
    const res = await this.getExpensesByCategory(p);
    const r: ExpensesByCategoryReportDto = res.report;
    const tail = [r.meta.conversion.policy, r.meta.reportingCurrency];
    const lines: (string | number | boolean | null)[][] = [
      [
        'group',
        'category',
        'subcategory',
        'archived',
        'row_kind',
        'currency',
        'amount',
        'negative_net',
        'conversion_policy',
        'reporting_currency',
        'complete',
      ],
    ];
    const emit = (
      g: string,
      c: string,
      s: string,
      archived: boolean,
      a: ExpensesByCategoryReportDto['total'],
      neg: boolean,
    ) => {
      for (const m of a.byCurrency)
        lines.push([g, c, s, archived, 'NATIVE', m.currency, m.amount, neg, ...tail, true]);
      lines.push([
        g,
        c,
        s,
        archived,
        'CONSOLIDATED',
        a.consolidated.currency,
        a.consolidated.amount,
        neg,
        ...tail,
        a.complete,
      ]);
    };
    for (const g of r.groups) {
      emit(g.name, '', '', false, g.amount, g.negativeNet);
      for (const c of g.categories) {
        emit(g.name, c.name, '', c.archived, c.amount, c.negativeNet);
        for (const s of c.subcategories) emit(g.name, c.name, s.name, s.archived, s.amount, s.negativeNet);
      }
    }
    if (r.others) emit('', 'Otras categorías', '', false, r.others, false);
    return this.finish(
      res,
      { reportId: 'EXPENSES_BY_CATEGORY', userId: p.userId, workspaceId: p.workspaceId },
      'expenses-by-category',
      lines,
    );
  }

  async exportBudgetVsActual(p: ReportParams): Promise<ReportExport> {
    const res = await this.getBudgetVsActual(p);
    const r: BudgetVsActualReportDto = res.report;
    const lines: (string | number | boolean | null)[][] = [
      [
        'period_label',
        'period_from',
        'period_to',
        'status',
        'target_kind',
        'target',
        'nature',
        'line_kind',
        'currency',
        'reference',
        'actual',
        'line_status',
        'complete',
      ],
    ];
    for (const per of r.periods) {
      if (per.status === 'NO_BUDGET') {
        lines.push([
          per.period.label,
          per.period.from,
          per.period.to,
          'NO_BUDGET',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);
        continue;
      }
      for (const l of per.lines) {
        lines.push([
          per.period.label,
          per.period.from,
          per.period.to,
          'BUDGETED',
          l.target.kind,
          l.target.name,
          l.nature,
          l.kind,
          l.reference.currency,
          l.reference.amount,
          l.actual.amount,
          l.status,
          l.actualComplete,
        ]);
      }
    }
    return this.finish(
      res,
      { reportId: 'BUDGET_VS_ACTUAL', userId: p.userId, workspaceId: p.workspaceId },
      'budget-vs-actual',
      lines,
    );
  }

  async exportCashFlow(p: ReportParams): Promise<ReportExport> {
    const res = await this.getCashFlow(p);
    const r: CashFlowReportDto = res.report;
    const tail = [r.meta.conversion.policy, r.meta.reportingCurrency];
    const lines: (string | number | boolean | null)[][] = [
      [
        'period_label',
        'period_from',
        'period_to',
        'row_kind',
        'currency',
        'opening',
        'operating',
        'debt',
        'savings_investments',
        'currency_exchange',
        'adjustments',
        'revaluation',
        'closing',
        'conversion_policy',
        'reporting_currency',
        'complete',
      ],
    ];
    for (const per of r.periods) {
      const head = [per.period.label, per.period.from, per.period.to];
      for (const b of per.byCurrency) {
        lines.push([
          ...head,
          'NATIVE',
          b.currency,
          b.opening.amount,
          b.operating.amount,
          b.debt.amount,
          b.savingsInvestments.amount,
          b.currencyExchange.amount,
          b.adjustments.amount,
          '',
          b.closing.amount,
          ...tail,
          true,
        ]);
      }
      const c = per.consolidated;
      lines.push([
        ...head,
        'CONSOLIDATED',
        c.closing.currency,
        c.opening.amount,
        c.operating.amount,
        c.debt.amount,
        c.savingsInvestments.amount,
        c.currencyExchange.amount,
        c.adjustments.amount,
        c.revaluation.amount,
        c.closing.amount,
        ...tail,
        c.complete,
      ]);
    }
    return this.finish(
      res,
      { reportId: 'CASH_FLOW', userId: p.userId, workspaceId: p.workspaceId },
      'cash-flow',
      lines,
    );
  }

  async exportAccountBalanceHistory(p: ReportParams & { readonly accountId: string }): Promise<ReportExport> {
    const res = await this.getAccountBalanceHistory(p);
    const r: AccountBalanceHistoryReportDto = res.report;
    const lines: (string | number | boolean | null)[][] = [
      [
        'date',
        'currency',
        'balance',
        'valued',
        'reporting_currency',
        'has_movements',
        'reconciled',
        'conversion_policy',
      ],
      ...r.days.map((d) => [
        d.date,
        d.balance.currency,
        d.balance.amount,
        d.valued?.amount ?? null,
        r.meta.reportingCurrency,
        d.hasMovements,
        d.reconciled,
        r.meta.conversion.policy,
      ]),
    ];
    return this.finish(
      res,
      { reportId: 'ACCOUNT_BALANCE_HISTORY', userId: p.userId, workspaceId: p.workspaceId },
      'account-balance-history',
      lines,
    );
  }

  async exportNetWorth(p: NetWorthParams): Promise<ReportExport> {
    const res = await this.getNetWorth(p);
    const r: NetWorthReportDto = res.report;
    const lines: (string | number | boolean | null)[][] = [
      [
        'period_label',
        'period_from',
        'period_to',
        'currency',
        'opening',
        'closing',
        'savings',
        'conversion_result',
        'adjustments',
        'other_movements',
        'fx_revaluation',
        'asset_revaluation',
        'conversion_policy',
        'complete',
      ],
      ...r.decomposition.map((d) => [
        d.period.label,
        d.period.from,
        d.period.to,
        d.opening.currency,
        d.opening.amount,
        d.closing.amount,
        d.savings.amount,
        d.conversionResult.amount,
        d.adjustments.amount,
        d.otherMovements.amount,
        d.fxRevaluation.amount,
        d.assetRevaluation.amount,
        r.meta.conversion.policy,
        d.complete,
      ]),
    ];
    return this.finish(
      res,
      { reportId: 'NET_WORTH', userId: p.userId, workspaceId: p.workspaceId },
      'net-worth',
      lines,
    );
  }

  /** CSV de TODAS las filas de un drill-down (no solo la página visible): se pagina por cursor de a 200. */
  async exportDrillDown(p: DrillDownParams): Promise<ReportExport> {
    const first = await this.getDrillDown({ ...p, limit: PAGE });
    if (first.report.count > MAX_REPORT_EXPORT_ROWS) throw tooLarge(first.report.count);
    const all: ReportDrillDownRowDto[] = [...first.report.rows];
    let cursor = first.report.nextCursor;
    while (cursor) {
      const next = await this.getDrillDown({ ...p, limit: PAGE, cursor });
      all.push(...next.report.rows);
      cursor = next.report.nextCursor;
    }
    const lines: (string | number | boolean | null)[][] = [
      [
        'date',
        'transaction_id',
        'split_id',
        'journal_entry_id',
        'account_id',
        'category_id',
        'counterparty_id',
        'description',
        'nature',
        'component',
        'currency',
        'amount',
        'valued',
        'reporting_currency',
        'conversion_policy',
      ],
      ...all.map((x) => [
        x.date,
        x.transactionId,
        x.splitId,
        x.journalEntryId,
        x.accountId,
        x.categoryId,
        x.counterpartyId,
        x.description,
        x.nature,
        x.component,
        x.amount.currency,
        x.amount.amount,
        x.valued?.amount ?? null,
        first.report.meta.reportingCurrency,
        first.report.meta.conversion.policy,
      ]),
    ];
    return this.finish(
      first,
      { reportId: p.report, userId: p.userId, workspaceId: p.workspaceId },
      `drill-down-${p.report.toLowerCase()}`,
      lines,
    );
  }
}

/** Escala (decimales) de un monto en texto. */
function scaleOf(amount: string): number {
  return amount.split('.')[1]?.length ?? 0;
}

/** Cero con los mismos decimales que `like`. */
function zeroLike(like: string): string {
  const s = scaleOf(like);
  return s === 0 ? '0' : `0.${'0'.repeat(s)}`;
}
