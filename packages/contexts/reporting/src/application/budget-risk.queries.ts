import {
  convertExact,
  currency as makeCurrency,
  DomainError,
  LocalDate,
  Money,
  dec,
  type Currency,
  type Decimal,
  type Instant,
} from '@pf/shared-kernel';
import {
  BUDGET_RISK_HOME_LIMIT,
  type BudgetLineRiskDto,
  type BudgetRiskDto,
  type BudgetRiskHomeDto,
  type BudgetRiskStatusDto,
} from '../contracts/budget-risk.js';
import {
  BudgetOverrunProjector,
  categoriesOfTarget,
  periodDays,
  type KnownPayment,
  type PlanCategoryNode,
} from '../domain/index.js';
import type { BudgetRiskDeps } from './ports/budget-risk.js';
import { DEFAULT_RATE_VALIDITY_WINDOW_DAYS, toExact } from './valuation-support.js';
import type { ExactRate } from '../domain/index.js';

const monotonic = () => Number(process.hrtime.bigint()) / 1e9;

/** Histograma de la lectura del riesgo de presupuesto (sin etiquetas de alta cardinalidad). */
export const BUDGET_RISK_DURATION_METRIC = 'reporting_budget_risk_duration_seconds';

export interface BudgetRiskPeriod {
  readonly id: string;
  readonly label: string;
  readonly start: string;
  readonly end: string;
}

export interface BudgetRiskComputeInput {
  readonly workspaceId: string;
  readonly period: BudgetRiskPeriod;
  readonly today: LocalDate;
  readonly now: Instant;
  /** Escalas de las monedas; sin él se leen del catálogo de FX (una consulta). */
  readonly scaleOf?: (code: string, amount?: string) => Currency;
}

const ZERO = dec('0');

/**
 * Cálculo del riesgo de exceder un presupuesto (openspec add-budget-overrun-risk, design.md decisiones 2 a 5): lee la
 * FUENTE DE VERDAD en la unidad de trabajo ya abierta (`BudgetVsActualQuery`, ocurrencias pendientes y resueltas de
 * COMMITMENTS y, solo con los pronósticos habilitados, `LatestForecastQuery`), una lectura de cada una y por lote, y
 * delega la proyección en el DS puro `BudgetOverrunProjector`. Sin efectos ni caché. Lo comparten la consulta HTTP, el
 * bloque del Home y el paso de avisos de `reporting.cash-flow-watch`.
 */
export class BudgetRiskCalculation {
  constructor(private readonly deps: BudgetRiskDeps) {}

  async compute(input: BudgetRiskComputeInput): Promise<BudgetRiskDto> {
    const { deps } = this;
    const ws = input.workspaceId;
    const { period } = input;
    const today = input.today.toString();
    const base = (status: BudgetRiskStatusDto, currency = ''): BudgetRiskDto => ({
      status,
      periodId: period.id,
      budgetId: null,
      asOf: today,
      currency,
      elapsedDays: 0,
      remainingDays: 0,
      forecastRunId: null,
      lines: [],
    });
    if (!deps.enabled) return base('DISABLED');
    if (today < period.start || today > period.end) return base('NOT_CURRENT_PERIOD');
    const plan = await deps.budgets.getForPeriod({ workspaceId: ws, periodId: period.id });
    if (!plan) return base('NO_PLAN');

    const { elapsed, remaining } = periodDays({
      today,
      periodStart: period.start,
      periodEnd: period.end,
    });
    const header = {
      ...base('AVAILABLE', plan.currency),
      budgetId: plan.budgetId,
      elapsedDays: elapsed,
      remainingDays: remaining,
    };
    const planLines = plan.lines.filter(
      (l) => l.nature === 'EXPENSE' && (l.target.kind === 'CATEGORY' || l.target.kind === 'GROUP'),
    );
    if (planLines.length === 0) return header;

    const scaleOf = input.scaleOf ?? (await this.scaleOf(ws));
    const planCurrency = scaleOf(plan.currency);
    const tree = await deps.categories.categoryTree({ userId: '', workspaceId: ws });
    const nodes = new Map<string, PlanCategoryNode>(
      tree.categories.map((c) => [c.categoryId, { parentId: c.parentId, groupId: c.groupId }]),
    );
    const names = new Map<string, string>([
      ...tree.categories.map((c) => [c.categoryId, c.name] as const),
      ...tree.groups.map((g) => [g.groupId, g.name] as const),
    ]);

    // ---- lecturas por lote (contratos públicos, misma transacción)
    const occurrences = await deps.commitments.listForCashFlow({ workspaceId: ws, through: period.end });
    const resolved = await deps.commitments.listResolved({
      workspaceId: ws,
      from: period.start,
      to: period.end,
      direction: 'OUTFLOW',
    });
    const forecast = await this.readForecast(ws);

    // ---- pagos conocidos y resueltos de egreso con categoría, en la moneda del plan (tasa vigente; sin tasa, fuera)
    const rateOf = await this.rates(ws, input.now, planCurrency, [
      ...occurrences.items.map((o) => o.expected.currency),
      ...resolved.map((r) => r.amount.currency),
    ]);
    interface Item {
      readonly categoryId: string;
      readonly amount: Decimal | null;
      readonly dueDate: string;
    }
    const toPlan = (amount: string, code: string): Decimal | null => {
      if (code === planCurrency.code) return dec(amount);
      const rate = rateOf.get(code);
      return rate ? convertExact(Money.parse(amount, scaleOf(code, amount)), planCurrency, rate) : null;
    };
    const pending: Item[] = [];
    for (const o of occurrences.items) {
      if (o.kind !== 'EXPENSE' || o.categoryId === null || o.dueDate > period.end) continue;
      const e = o.expected;
      // Conservador en el egreso de rango: el máximo (FR-COMMITMENTS-004); sin monto (VARIABLE) no hay qué sumar.
      const raw = e.type === 'VARIABLE' ? null : e.type === 'MIN_MAX' ? e.max : e.amount;
      if (raw === null) continue;
      pending.push({ categoryId: o.categoryId, amount: toPlan(raw, e.currency), dueDate: o.dueDate });
    }
    const paid: Item[] = [];
    for (const r of resolved) {
      if (r.kind !== 'EXPENSE' || r.categoryId === null) continue;
      paid.push({
        categoryId: r.categoryId,
        amount: toPlan(r.amount.amount, r.amount.currency),
        dueDate: r.transactionDate,
      });
    }

    let forecastUsed = false;
    const lines: BudgetLineRiskDto[] = planLines.map((l) => {
      const kind = l.target.kind as 'CATEGORY' | 'GROUP';
      const covered = categoriesOfTarget(kind, l.target.id, nodes);
      const known: KnownPayment[] = [];
      let paidByOccurrences = ZERO;
      let complete = l.actualComplete;
      for (const p of pending) {
        if (!covered.has(p.categoryId)) continue;
        if (p.amount === null) complete = false;
        else known.push({ dueDate: p.dueDate, amount: p.amount });
      }
      for (const p of paid) {
        if (!covered.has(p.categoryId)) continue;
        if (p.amount === null) complete = false;
        else paidByOccurrences = paidByOccurrences.add(p.amount);
      }
      const band = kind === 'CATEGORY' ? forecast?.bandOf(l.target.id, planCurrency.code, today) : undefined;
      if (band) forecastUsed = true;
      const result = BudgetOverrunProjector.project(
        {
          kind: l.kind,
          reference: dec(l.reference.amount),
          actual: dec(l.actual.amount),
          paidByOccurrences,
          knownPending: known,
          forecast: band ?? null,
        },
        {
          currency: planCurrency,
          today,
          periodStart: period.start,
          periodEnd: period.end,
          minElapsedDays: deps.minElapsedDays,
        },
      );
      return {
        budgetLineId: l.budgetLineId,
        target: { kind, id: l.target.id },
        targetName: names.get(l.target.id) ?? l.target.id,
        reference: Money.roundToScale(dec(l.reference.amount), planCurrency).toJSON(),
        actual: result.actual.toJSON(),
        variableActual: result.variableActual.toJSON(),
        knownPending: result.knownPending.toJSON(),
        projected: result.projected?.toJSON() ?? null,
        projectedHigh: result.projectedHigh?.toJSON() ?? null,
        projectionComplete: complete,
        level: result.level,
        reason: result.reason,
        estimatedDate: result.estimatedDate,
        basis: result.basis,
      };
    });
    return { ...header, forecastRunId: forecastUsed ? (forecast?.runId ?? null) : null, lines };
  }

  /** Escalas de las monedas del workspace (catálogo de FX, una consulta). */
  private async scaleOf(workspaceId: string): Promise<(code: string, amount?: string) => Currency> {
    const catalog = await this.deps.rates.workspaceCurrencies(workspaceId);
    const known = new Map<string, Currency>(catalog.map((c) => [c.code, makeCurrency(c.code, c.scale)]));
    const decimalsOf = (amount: string) => amount.split('.')[1]?.length ?? 0;
    return (code, amount = '0') => known.get(code) ?? makeCurrency(code, decimalsOf(amount));
  }

  /** Tasas exactas vigentes hacia la moneda del plan, una resolución por lote para las monedas distintas. */
  private async rates(
    workspaceId: string,
    now: Instant,
    target: Currency,
    codes: readonly string[],
  ): Promise<ReadonlyMap<string, ExactRate>> {
    const distinct = [...new Set(codes)].filter((c) => c !== target.code).sort();
    const out = new Map<string, ExactRate>();
    if (distinct.length === 0) return out;
    const found = await this.deps.rates.resolveValuationRates({
      workspaceId,
      requests: distinct.map((code) => ({ base: code, quote: target.code, at: now.toString() })),
      windowDays: this.deps.rateValidityWindowDays ?? DEFAULT_RATE_VALIDITY_WINDOW_DAYS,
    });
    distinct.forEach((code, i) => {
      const r = found[i];
      if (r) out.set(code, toExact(r));
    });
    return out;
  }

  /** Pronóstico vigente por categoría (solo con los pronósticos habilitados); aunque esté `stale`. */
  private async readForecast(workspaceId: string) {
    const { forecast } = this.deps;
    if (!forecast) return null;
    const latest = await forecast.getLatest({ workspaceId, scopes: ['CATEGORY'], horizon: 1 });
    if (latest.status !== 'AVAILABLE' || !latest.run) return null;
    const series = latest.series.filter((s) => s.scope === 'CATEGORY' && s.readiness !== 'INSUFFICIENT');
    return {
      runId: latest.run.id,
      bandOf(categoryId: string, currencyCode: string, today: string) {
        const s = series.find((x) => x.scopeRef === categoryId && x.currency === currencyCode);
        const point = s?.points.find((p) => p.periodStart <= today && today <= p.periodEnd);
        return point
          ? { expected: dec(point.prediction.amount), upper: dec(point.interval80.upper.amount) }
          : undefined;
      },
    };
  }

  /** Bloque del Home: hasta 3 líneas `LIKELY` por fecha estimada y nombre; `null` sin líneas en riesgo. */
  static homeBlock(dto: BudgetRiskDto, periodLabel: string): BudgetRiskHomeDto | null {
    if (dto.status !== 'AVAILABLE') return null;
    const likely = dto.lines
      .filter((l) => l.level === 'LIKELY')
      .sort(
        (a, b) =>
          (a.estimatedDate ?? '9999-12-31').localeCompare(b.estimatedDate ?? '9999-12-31') ||
          a.targetName.localeCompare(b.targetName, 'es') ||
          a.budgetLineId.localeCompare(b.budgetLineId),
      );
    if (likely.length === 0) return null;
    return {
      periodId: dto.periodId,
      periodLabel,
      lines: likely.slice(0, BUDGET_RISK_HOME_LIMIT),
      moreCount: Math.max(0, likely.length - BUDGET_RISK_HOME_LIMIT),
    };
  }
}

/** Consultas de riesgo de presupuesto: la lectura HTTP y el cálculo para el resumen del Home y el paso de avisos. */
export class BudgetRiskQueries {
  readonly calculation: BudgetRiskCalculation;

  constructor(private readonly deps: BudgetRiskDeps) {
    this.calculation = new BudgetRiskCalculation(deps);
  }

  /** `GET …/periods/{periodId}/budget-risk`: periodo inexistente o de otro workspace ⇒ `RESOURCE_NOT_FOUND`. */
  getBudgetRisk(input: {
    readonly userId: string | null;
    readonly workspaceId: string;
    readonly periodId: string;
  }): Promise<BudgetRiskDto> {
    const { deps } = this;
    return deps.uow.run({ userId: input.userId, workspaceId: input.workspaceId }, async () => {
      const started = monotonic();
      const periods = await deps.periods.listPeriods({ workspaceId: input.workspaceId });
      const found = periods.find((p) => p.id === input.periodId);
      if (!found) throw new DomainError('RESOURCE_NOT_FOUND', 'period not found');
      const settings = await deps.workspaces.settingsOf(input.workspaceId);
      const now = deps.clock.now();
      const dto = await this.calculation.compute({
        workspaceId: input.workspaceId,
        period: { id: found.id, label: found.label, start: found.periodStart, end: found.periodEnd },
        today: LocalDate.ofInstant(now, settings.timeZone),
        now,
      });
      deps.metrics?.observe(BUDGET_RISK_DURATION_METRIC, monotonic() - started);
      return dto;
    });
  }

  /**
   * Riesgo del periodo que contiene hoy, en la unidad de trabajo YA abierta por el llamador (el resumen del Home y el
   * paso de avisos). `null` si ningún periodo cubre hoy.
   */
  async evaluateCurrent(input: {
    readonly workspaceId: string;
    readonly timeZone: string;
    readonly scaleOf?: (code: string, amount?: string) => Currency;
  }): Promise<{ readonly dto: BudgetRiskDto; readonly periodLabel: string } | null> {
    const { deps } = this;
    if (!deps.enabled) return null;
    const now = deps.clock.now();
    const today = LocalDate.ofInstant(now, input.timeZone);
    const periods = await deps.periods.listPeriods({ workspaceId: input.workspaceId });
    const t = today.toString();
    const found = periods.find((p) => p.periodStart <= t && t <= p.periodEnd);
    if (!found) return null;
    const dto = await this.calculation.compute({
      workspaceId: input.workspaceId,
      period: { id: found.id, label: found.label, start: found.periodStart, end: found.periodEnd },
      today,
      now,
      ...(input.scaleOf ? { scaleOf: input.scaleOf } : {}),
    });
    return { dto, periodLabel: found.label };
  }
}
