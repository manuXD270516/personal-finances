import { createHash } from 'node:crypto';
import type { AuditChangeInput } from '@pf/audit/contracts';
import type { CategoryTreeDto } from '@pf/classification/contracts';
import {
  DomainError,
  LocalDate,
  Money,
  currency as makeCurrency,
  dec,
  present,
  type Currency,
} from '@pf/shared-kernel';
import {
  type Budget,
  type BudgetLine,
  HistoricalBudgetEstimator,
  SUGGESTION_METHODS,
  ROUNDING_INCREMENTS,
  SuggestionWindow,
  TargetOverlapPolicy,
  anchorFieldOf,
  resolveTarget,
  targetKey,
  type BudgetLineInput,
  type BudgetLineKind,
  type BudgetNature,
  type BudgetTarget,
  type Estimate,
  type EstimatorPeriod,
  type FinancialPeriod,
  type HistoryBasisState,
  type SuggestionMethod,
  type TargetTree,
  type WindowPeriod,
} from '../domain/index.js';
import { BudgetCalculator, targetTreeOf } from './budget-calculator.js';
import { originOf } from './budget-origin.js';
import { BudgetThresholdService } from './budget-thresholds.service.js';
import { toBudgetDto, type BudgetDto } from './budget-view.js';
import { BudgetsService, auditMoney, lineDiff, lineSnapshotChanges, parseTarget } from './budgets.service.js';
import { HistoricalActualsLoader, type LoadedActual } from './historical-actuals.loader.js';
import { DEFAULT_HISTORY_SUGGESTION_CONFIG, type BudgetsDeps } from './ports/index.js';
import {
  type BudgetHistoryBasisDto,
  type BudgetSuggestionLineDto,
  type BudgetSuggestionPreviewDto,
} from './suggestion-view.js';

const AGGREGATE = 'Budget';
const NEW_LINE_KINDS: readonly BudgetLineKind[] = ['FIXED', 'MAXIMUM', 'MINIMUM'];

const invalid = (detail: string, pointer: string) => new DomainError('VALIDATION_FAILED', detail).at(pointer);

interface ParsedRequest {
  readonly periodId: string;
  readonly method: SuggestionMethod;
  readonly periods: number;
  readonly adjustmentPercent: string;
  readonly roundingIncrement: number | null;
  readonly extraTargets: readonly BudgetTarget[];
  /** `targetKey` -> periodIds a excluir / reincluir. */
  readonly overrides: ReadonlyMap<string, { exclude: readonly string[]; include: readonly string[] }>;
}

interface SuggestionLine {
  readonly target: BudgetTarget;
  readonly nature: BudgetNature;
  readonly kind: BudgetLineKind;
  readonly existing: BudgetLine | null;
  readonly status: 'OK' | 'INSUFFICIENT_HISTORY' | 'NOT_APPLICABLE';
  readonly estimate: Estimate | null;
}

interface Computation {
  readonly period: FinancialPeriod;
  readonly budget: Budget | null;
  readonly currency: Currency;
  readonly request: ParsedRequest;
  readonly window: readonly WindowPeriod[];
  readonly lines: readonly SuggestionLine[];
  readonly names: ReadonlyMap<string, string>;
  readonly token: string;
  readonly tree: TargetTree;
}

export interface SuggestionInput {
  readonly workspaceId: string;
  readonly request: unknown;
}

export interface ConfirmSuggestionInput extends SuggestionInput {
  readonly token: unknown;
  readonly lines: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const moneyOf = (amount: string | null, code: string) =>
  amount === null ? null : { amount, currency: code };

/**
 * Sugerencias de presupuesto desde el historial (openspec add-historical-budgets decisiones 1-8; FR-PLANNING-021).
 * `preview` es una vista previa SIN estado (ni escrituras ni auditoría) con un token SHA-256 de lo que vio; `confirm`
 * recalcula en UNA unidad de trabajo, compara el token (`BUDGET_SUGGESTION_STALE`) y aplica solo las líneas elegidas,
 * con el monto sugerido o uno escrito a mano, guardando la base de cada una. Nunca se llama desde la creación de
 * periodos o planes, el template predeterminado, el clonado, la propagación ni el rollover.
 */
export class BudgetSuggestionService {
  private readonly loader: HistoricalActualsLoader;
  private readonly calculator: BudgetCalculator;
  private readonly thresholds: BudgetThresholdService;
  private readonly plans: BudgetsService;

  constructor(private readonly deps: BudgetsDeps) {
    this.loader = new HistoricalActualsLoader(deps);
    this.calculator = new BudgetCalculator(deps);
    this.thresholds = new BudgetThresholdService(deps, this.calculator);
    this.plans = new BudgetsService(deps);
  }

  private get config() {
    return this.deps.suggestions ?? DEFAULT_HISTORY_SUGGESTION_CONFIG;
  }

  async preview(input: SuggestionInput): Promise<BudgetSuggestionPreviewDto> {
    const { deps } = this;
    const request = this.parseRequest(input.request);
    return deps.uow.run(input.workspaceId, async () => {
      const c = await this.compute(input.workspaceId, request, false);
      return this.previewDto(c);
    });
  }

  async confirm(input: ConfirmSuggestionInput): Promise<BudgetDto> {
    const { deps } = this;
    const { workspaceId } = input;
    const request = this.parseRequest(input.request);
    if (typeof input.token !== 'string' || !/^[0-9a-f]{64}$/.test(input.token)) {
      throw invalid('token is required', '/token');
    }
    const token = input.token;
    const chosen = this.parseChosen(input.lines);
    return deps.uow.run(workspaceId, async () => {
      // Orden de candados como el resto de comandos del plan: periodo (FOR SHARE) y después el plan (FOR UPDATE).
      await deps.guard.assertPlanEditable({ workspaceId, periodId: request.periodId });
      let c = await this.compute(workspaceId, request, true);
      if (c.token !== token) {
        throw new DomainError(
          'BUDGET_SUGGESTION_STALE',
          'the history or the plan changed after the preview; request a new preview',
        );
      }
      const byKey = new Map(c.lines.map((l) => [targetKey(l.target), l]));
      const picks = chosen.map((pick, i) => {
        const line = byKey.get(targetKey(pick.target));
        if (!line) throw invalid('the line is not part of the preview', `/lines/${i}/target`);
        if (line.status !== 'OK' || !line.estimate?.suggested) {
          throw invalid('the line has no suggestion to apply', `/lines/${i}/target`);
        }
        const suggested = line.estimate.suggested;
        if (
          pick.suggestedAmount.currency !== c.currency.code ||
          !dec(pick.suggestedAmount.amount).eq(dec(suggested))
        ) {
          throw new DomainError(
            'BUDGET_SUGGESTION_STALE',
            `the suggestion of ${pick.target.kind} ${pick.target.id} changed after the preview`,
          );
        }
        if (line.existing === null) {
          if (pick.kind === undefined) throw invalid('kind is required for a new line', `/lines/${i}/kind`);
          if (!NEW_LINE_KINDS.includes(pick.kind) || (line.nature === 'INCOME' && pick.kind !== 'FIXED')) {
            throw new DomainError(
              'BUDGET_INVALID_LINE_KIND',
              `${pick.kind} is not valid for a line suggested from the history`,
            ).at(`/lines/${i}/kind`);
          }
        }
        return { pick, line, suggested };
      });

      if (c.budget === null) {
        await this.plans.createEmptyInUnit({ workspaceId, periodId: request.periodId });
        const created = await deps.budgets.findByPeriod(workspaceId, request.periodId, { lock: 'update' });
        if (!created) throw new DomainError('BUDGET_SUGGESTION_STALE', 'the plan could not be created');
        c = { ...c, budget: created };
      }
      const budget = c.budget as Budget;
      const currency = c.currency;
      const operationId = deps.ids.next();
      const computedAt = deps.clock.now().toString();
      const applied: { line: BudgetLine; entry: AuditChangeInput[]; created: boolean; action: string }[] = [];

      for (const { pick, line, suggested } of picks) {
        const amount = Money.parse(pick.amount.amount, currency).toFixed();
        if (pick.amount.currency !== currency.code) {
          throw new DomainError(
            'CURRENCY_MISMATCH',
            `the plan is in ${currency.code}; got ${pick.amount.currency}`,
          ).at('/lines');
        }
        const est = line.estimate as Estimate;
        const basis = this.basisOf(c, est, suggested, amount, operationId, computedAt);
        const money = { amount, currency: currency.code };
        if (line.existing) {
          const field = anchorFieldOf(line.existing.kind) as 'planned' | 'min' | 'max';
          const { before, after } = budget.updateLine({
            lineId: line.existing.id,
            expectedVersion: line.existing.version,
            patch: { [field]: money } as BudgetLineInput,
            currency,
          });
          const withBasis = after.withHistoryBasis(basis);
          budget.replaceLine(withBasis);
          applied.push({
            line: withBasis,
            created: false,
            action: 'planning.budget.line_updated',
            entry: [
              ...lineDiff(before.snapshot, withBasis.snapshot, currency.code),
              ...basisChanges(before.historyBasis, basis),
            ],
          });
        } else {
          const added = budget.addLine({
            lineId: deps.ids.next(),
            target: pick.target,
            spec: { kind: pick.kind, planned: money } as BudgetLineInput,
            currency,
            tree: c.tree,
          });
          const withBasis = added.withHistoryBasis(basis);
          budget.replaceLine(withBasis);
          applied.push({
            line: withBasis,
            created: true,
            action: 'planning.budget.line_added',
            entry: [...lineSnapshotChanges(withBasis.snapshot, currency.code), ...basisChanges(null, basis)],
          });
        }
      }

      if (!(await deps.budgets.save(budget))) {
        throw new DomainError('BUDGET_SUGGESTION_STALE', 'the plan was modified concurrently');
      }
      budget.markPersisted();
      for (const a of applied) {
        if (a.created) await deps.budgets.insertLine(a.line);
        else if (!(await deps.budgets.updateLine(a.line))) {
          throw new DomainError('BUDGET_SUGGESTION_STALE', 'a plan line was modified concurrently');
        }
      }
      for (const a of applied) {
        await deps.audit.append({
          workspaceId,
          action: a.action,
          aggregateType: AGGREGATE,
          aggregateId: budget.id,
          aggregateVersion: budget.version,
          changes: a.entry,
        });
      }
      const view = await this.calculator.view({
        workspaceId,
        budget,
        period: c.period,
        now: deps.clock.now(),
      });
      await this.thresholds.evaluateView(view, new Set(applied.map((a) => a.line.id)));
      return toBudgetDto(view, await originOf(deps, budget));
    });
  }

  // ------------------------------------------------------------------ internos

  private basisOf(
    c: Computation,
    est: Estimate,
    suggested: string,
    applied: string,
    operationId: string,
    computedAt: string,
  ): HistoryBasisState {
    const code = c.currency.code;
    const byLabel = new Map(c.window.map((w) => [w.label, w]));
    return {
      schemaVersion: 1,
      method: c.request.method,
      periodsRequested: c.request.periods,
      adjustmentPercent: c.request.adjustmentPercent,
      roundingIncrement: c.request.roundingIncrement,
      suggested: { amount: suggested, currency: code },
      applied: { amount: applied, currency: code },
      mean: est.mean,
      median: est.median,
      q1: est.q1,
      q3: est.q3,
      outlierRule: est.outlierRule,
      minValid: est.minValid,
      usedCount: est.usedCount,
      periods: est.periods.map((p) => {
        const w = byLabel.get(p.key) as WindowPeriod;
        return {
          periodId: w.periodId,
          label: w.label,
          start: w.start,
          end: w.end,
          closed: w.closed,
          actual: p.actual,
          status: p.status,
        };
      }),
      computedAt,
      operationId,
    };
  }

  private previewDto(c: Computation): BudgetSuggestionPreviewDto {
    const code = c.currency.code;
    const computedAt = this.deps.clock.now().toString();
    const byLabel = new Map(c.window.map((w) => [w.label, w]));
    const lines: BudgetSuggestionLineDto[] = c.lines.map((l) => {
      const field = anchorFieldOf(l.existing?.kind ?? l.kind);
      const current = l.existing && field ? l.existing.snapshot[field] : null;
      const est = l.estimate;
      const suggested = est?.suggested ?? null;
      const difference =
        suggested !== null && current !== null
          ? present(dec(suggested).minus(dec(current)), c.currency).toFixed()
          : null;
      let explanation: BudgetHistoryBasisDto | null = null;
      if (est) {
        explanation = {
          method: c.request.method,
          periodsRequested: c.request.periods,
          adjustmentPercent: c.request.adjustmentPercent,
          roundingIncrement: c.request.roundingIncrement,
          usedCount: est.usedCount,
          minValid: est.minValid,
          outlierRule: est.outlierRule,
          q1: est.q1,
          q3: est.q3,
          mean: est.mean,
          median: est.median,
          suggested: moneyOf(suggested, code),
          computedAt,
          periods: est.periods.map((p) => {
            const w = byLabel.get(p.key) as WindowPeriod;
            return {
              periodId: w.periodId,
              label: w.label,
              start: w.start,
              end: w.end,
              closed: w.closed,
              actual: moneyOf(p.actual, code),
              status: p.status,
            };
          }),
        };
      }
      return {
        target: l.target,
        targetName: c.names.get(targetKey(l.target)) ?? '',
        nature: l.nature,
        kind: l.kind,
        existingLineId: l.existing?.id ?? null,
        currentAmount: moneyOf(current, code),
        suggestedAmount: moneyOf(suggested, code),
        difference: moneyOf(difference, code),
        status: l.status,
        explanation,
      };
    });
    return {
      periodId: c.period.id,
      budgetId: c.budget?.id ?? null,
      budgetVersion: c.budget?.version ?? null,
      currency: code,
      method: c.request.method,
      periods: c.request.periods,
      adjustmentPercent: c.request.adjustmentPercent,
      roundingIncrement: c.request.roundingIncrement,
      token: c.token,
      window: c.window.map((w) => ({
        periodId: w.periodId,
        label: w.label,
        start: w.start,
        end: w.end,
        closed: w.closed,
      })),
      lines,
    };
  }

  private parseRequest(raw: unknown): ParsedRequest {
    const cfg = this.config;
    if (!isObject(raw)) throw invalid('request is required', '/request');
    const periodId = raw['periodId'];
    if (typeof periodId !== 'string' || periodId === '') throw invalid('periodId is required', '/periodId');
    const method = raw['method'] ?? 'AVERAGE';
    if (!(SUGGESTION_METHODS as readonly unknown[]).includes(method)) {
      throw invalid('method must be AVERAGE or SAME_PERIOD_LAST_YEAR', '/method');
    }
    const periods = raw['periods'] ?? cfg.defaultPeriods;
    if (
      typeof periods !== 'number' ||
      !Number.isInteger(periods) ||
      periods < 1 ||
      periods > cfg.maxPeriods
    ) {
      throw invalid(`periods must be an integer between 1 and ${cfg.maxPeriods}`, '/periods');
    }
    const adjustmentRaw = raw['adjustmentPercent'] ?? '0.00';
    if (typeof adjustmentRaw !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(adjustmentRaw)) {
      throw invalid('adjustmentPercent must be a decimal with at most 2 decimals', '/adjustmentPercent');
    }
    const adjustment = dec(adjustmentRaw);
    if (adjustment.lt(-100) || adjustment.gt(1000)) {
      throw invalid('adjustmentPercent must be between -100.00 and 1000.00', '/adjustmentPercent');
    }
    const rounding = raw['roundingIncrement'] ?? null;
    if (rounding !== null && !(ROUNDING_INCREMENTS as readonly unknown[]).includes(rounding)) {
      throw invalid('roundingIncrement must be 1, 5, 10, 50, 100 or null', '/roundingIncrement');
    }
    const extraRaw = raw['extraTargets'] ?? [];
    if (!Array.isArray(extraRaw) || extraRaw.length > 50) {
      throw invalid('extraTargets must be a list of at most 50 targets', '/extraTargets');
    }
    const overridesRaw = raw['overrides'] ?? [];
    if (!Array.isArray(overridesRaw) || overridesRaw.length > 200) {
      throw invalid('overrides must be a list of at most 200 items', '/overrides');
    }
    const overrides = new Map<string, { exclude: string[]; include: string[] }>();
    overridesRaw.forEach((o: unknown, i) => {
      if (!isObject(o)) throw invalid('override must be an object', `/overrides/${i}`);
      const target = parseTarget(o['target']);
      const ids = (field: string): string[] => {
        const v = o[field] ?? [];
        if (!Array.isArray(v) || v.length > 12 || v.some((x) => typeof x !== 'string')) {
          throw invalid(`${field} must be a list of at most 12 period ids`, `/overrides/${i}/${field}`);
        }
        return v as string[];
      };
      const entry = overrides.get(targetKey(target)) ?? { exclude: [], include: [] };
      entry.exclude.push(...ids('excludePeriodIds'));
      entry.include.push(...ids('includePeriodIds'));
      overrides.set(targetKey(target), entry);
    });
    return {
      periodId,
      method: method as SuggestionMethod,
      periods: method === 'SAME_PERIOD_LAST_YEAR' ? 1 : periods,
      adjustmentPercent: adjustment.toFixed(2),
      roundingIncrement: rounding as number | null,
      extraTargets: extraRaw.map((t: unknown) => parseTarget(t)),
      overrides,
    };
  }

  private parseChosen(raw: unknown) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) {
      throw invalid('lines must list between 1 and 200 lines', '/lines');
    }
    const seen = new Set<string>();
    return raw.map((l: unknown, i) => {
      if (!isObject(l)) throw invalid('line must be an object', `/lines/${i}`);
      const target = parseTarget(l['target']);
      if (seen.has(targetKey(target))) throw invalid('the target is repeated', `/lines/${i}/target`);
      seen.add(targetKey(target));
      const money = (v: unknown, field: string): { amount: string; currency: string } => {
        if (!isObject(v) || typeof v['amount'] !== 'string' || typeof v['currency'] !== 'string') {
          throw invalid(`${field} must be {amount, currency}`, `/lines/${i}/${field}`);
        }
        return { amount: v['amount'], currency: v['currency'] };
      };
      const kind = l['kind'];
      return {
        target,
        kind: kind === undefined || kind === null ? undefined : (kind as BudgetLineKind),
        amount: money(l['amount'], 'amount'),
        suggestedAmount: money(l['suggestedAmount'], 'suggestedAmount'),
      };
    });
  }

  /** Núcleo común de vista previa y confirmación: ventana, reales, estimación por línea y token. */
  private async compute(workspaceId: string, request: ParsedRequest, lock: boolean): Promise<Computation> {
    const { deps } = this;
    if (!deps.settings) throw new Error('BudgetsDeps.settings is required for budget suggestions');
    if (!deps.activity) throw new Error('BudgetsDeps.activity is required for budget suggestions');
    const cfg = this.config;
    const period = await deps.periods.findById(workspaceId, request.periodId);
    if (!period) {
      throw new DomainError('REFERENCE_NOT_FOUND', `financial period ${request.periodId} not found`).at(
        '/periodId',
      );
    }
    const budget = await deps.budgets.findByPeriod(workspaceId, period.id, lock ? { lock: 'update' } : {});
    const settings = await deps.settings.settingsOf(workspaceId);
    const catalog = await deps.rates.workspaceCurrencies(workspaceId);
    const known = new Map<string, Currency>(catalog.map((x) => [x.code, makeCurrency(x.code, x.scale)]));
    const code = budget ? budget.snapshot.currency : settings.baseCurrency;
    const currency = known.get(code);
    if (!currency) throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not in the catalog`);
    const calendar = await deps.calendar.calendarOf(workspaceId);
    const now = deps.clock.now();
    const today = LocalDate.ofInstant(now, calendar.timeZone);
    const activity = await deps.activity.getActivityRange(workspaceId);
    const rows = (await deps.periods.list(workspaceId)).map((p) => ({
      id: p.id,
      label: p.label,
      periodStart: p.snapshot.periodStart,
      periodEnd: p.snapshot.periodEnd,
      status: p.status,
    }));
    const built = SuggestionWindow.build({
      targetLabel: period.label,
      targetStart: period.snapshot.periodStart,
      count: request.periods,
      today,
      startDay: calendar.fiscalMonthStartDay,
      firstActivity: activity?.minEntryDate ?? null,
      rows,
    });
    const window: readonly WindowPeriod[] =
      request.method === 'AVERAGE' ? built.periods : [built.sameLastYear];

    const treeDto: CategoryTreeDto = await deps.catalog.categoryTree({
      userId: deps.actor.userId(),
      workspaceId,
    });
    const tree = targetTreeOf(treeDto);
    const names = new Map<string, string>();
    for (const g of treeDto.groups) names.set(`GROUP:${g.groupId}`, g.name);
    for (const x of treeDto.categories) names.set(`CATEGORY:${x.categoryId}`, x.name);
    for (const t of treeDto.tags) names.set(`TAG:${t.tagId}`, t.name);

    // Candidatas: líneas del plan; sin plan, las categorías raíz no archivadas; más los objetivos extra.
    interface Candidate {
      target: BudgetTarget;
      nature: BudgetNature;
      kind: BudgetLineKind;
      existing: BudgetLine | null;
      discovered: boolean;
    }
    const candidates: Candidate[] = [];
    if (budget) {
      for (const l of budget.lines) {
        candidates.push({
          target: l.target,
          nature: l.nature,
          kind: l.kind,
          existing: l,
          discovered: false,
        });
      }
    } else {
      const roots = treeDto.categories
        .filter((x) => x.parentId === null && !x.archived)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.categoryId < b.categoryId ? -1 : 1));
      for (const x of roots) {
        candidates.push({
          target: { kind: 'CATEGORY', id: x.categoryId },
          nature: x.kind,
          kind: x.kind === 'INCOME' ? 'FIXED' : 'MAXIMUM',
          existing: null,
          discovered: true,
        });
      }
    }
    const extras: Candidate[] = [];
    for (const target of request.extraTargets) {
      const { nature } = resolveTarget(tree, target);
      extras.push({
        target,
        nature,
        kind: nature === 'INCOME' ? 'FIXED' : 'MAXIMUM',
        existing: null,
        discovered: false,
      });
    }

    // Reales: una consulta de agregados y un lote de tasas para toda la ventana.
    const loadable = window.filter((w) => w.base === 'ELIGIBLE');
    const all = [...candidates, ...extras];
    const loaded = await this.loader.load({
      workspaceId,
      periods: loadable.map((w) => ({ key: w.label, start: w.start, end: w.end })),
      lines: all
        .filter((x) => x.existing?.kind !== 'PERCENT_OF_INCOME')
        .map((x) => ({ key: targetKey(x.target), target: x.target, nature: x.nature })),
      tree,
      currency,
      timeZone: calendar.timeZone,
      now,
      knownCurrencies: known,
      withTags: all.some((x) => x.target.kind === 'TAG'),
    });

    const idToLabel = new Map(window.filter((w) => w.periodId).map((w) => [w.periodId as string, w.label]));
    const adjustment = dec(request.adjustmentPercent);
    const estimate = (cand: Candidate): SuggestionLine => {
      if (cand.existing?.kind === 'PERCENT_OF_INCOME') {
        return { ...cand, status: 'NOT_APPLICABLE', estimate: null };
      }
      const key = targetKey(cand.target);
      const ov = request.overrides.get(key);
      const labelsOf = (ids: readonly string[]): Set<string> =>
        new Set(
          ids.map((id) => {
            const label = idToLabel.get(id);
            if (!label) throw invalid(`period ${id} is not in the suggestion window`, '/overrides');
            return label;
          }),
        );
      const periods: EstimatorPeriod[] = window.map((w) => {
        if (w.base !== 'ELIGIBLE') return { key: w.label, base: w.base, actual: null };
        const got: LoadedActual | undefined = loaded.get(w.label)?.get(key);
        if (!got || !got.complete) return { key: w.label, base: 'NO_RATE', actual: null };
        return { key: w.label, base: 'ELIGIBLE', actual: got.actual };
      });
      const est = HistoricalBudgetEstimator.estimate({
        method: request.method,
        requested: request.periods,
        periods,
        currency,
        adjustmentPercent: adjustment,
        roundingIncrement: request.roundingIncrement,
        exclude: labelsOf(ov?.exclude ?? []),
        include: labelsOf(ov?.include ?? []),
        config: {
          minValidRatio: cfg.minValidRatio,
          outlierMinSample: cfg.outlierMinSample,
          iqrFactor: cfg.outlierIqrFactor,
        },
      });
      return { ...cand, status: est.status === 'OK' ? 'OK' : 'INSUFFICIENT_HISTORY', estimate: est };
    };

    const estimated = candidates.map(estimate);
    // Sin plan: solo las raíces con sugerencia mayor que 0.00.
    const kept = budget
      ? estimated
      : estimated.filter((l) => l.status === 'OK' && dec(l.estimate?.suggested ?? '0').gt(0));
    // Objetivos extra: sin duplicar ni solaparse con las líneas del plan (o las propuestas).
    const taken: BudgetTarget[] = kept.map((l) => l.target);
    const extraLines: SuggestionLine[] = [];
    for (const extra of extras) {
      TargetOverlapPolicy.assertAllowed(taken, extra.target, tree);
      taken.push(extra.target);
      extraLines.push(estimate(extra));
    }
    const lines = [...kept, ...extraLines];
    const token = this.tokenOf({ period, budget, request, window, lines });
    return { period, budget, currency, request, window, lines, names, token, tree };
  }

  /** Hash de lo que la vista previa vio: periodo, plan (con versión), parámetros, ajustes manuales y cada línea. */
  private tokenOf(input: {
    readonly period: FinancialPeriod;
    readonly budget: Budget | null;
    readonly request: ParsedRequest;
    readonly window: readonly WindowPeriod[];
    readonly lines: readonly SuggestionLine[];
  }): string {
    const { request: r } = input;
    const payload = {
      v: 1,
      period: input.period.id,
      budget: input.budget ? [input.budget.id, input.budget.version] : null,
      params: [r.method, r.periods, r.adjustmentPercent, r.roundingIncrement],
      window: input.window.map((w) => [w.label, w.periodId, w.closed, w.base]),
      extra: r.extraTargets.map(targetKey).sort(),
      overrides: [...r.overrides.entries()]
        .map(([k, v]) => [k, [...v.exclude].sort(), [...v.include].sort()])
        .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1)),
      lines: input.lines
        .map((l) => [
          targetKey(l.target),
          l.status,
          l.estimate?.suggested ?? null,
          l.estimate?.periods.map((p) => [p.key, p.status]) ?? null,
        ])
        .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1)),
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}

/** Cambios de auditoría de la base (texto JSON compacto, docs/31 D19) y del identificador común de la operación. */
function basisChanges(before: HistoryBasisState | null, after: HistoryBasisState): AuditChangeInput[] {
  const compact = (b: HistoryBasisState) =>
    JSON.stringify({
      method: b.method,
      periods: b.periodsRequested,
      adjustmentPercent: b.adjustmentPercent,
      roundingIncrement: b.roundingIncrement,
      suggested: auditMoney(b.suggested.amount, b.suggested.currency),
      applied: auditMoney(b.applied.amount, b.applied.currency),
      usedCount: b.usedCount,
      statuses: b.periods.map((p) => `${p.label}:${p.status}`),
    });
  return [
    { field: 'historyBasis', before: before ? compact(before) : null, after: compact(after) },
    { field: 'operationId', before: null, after: after.operationId },
  ];
}
