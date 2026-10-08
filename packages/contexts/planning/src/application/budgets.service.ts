import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import { BUDGET_CREATED, type BudgetCreatedV1 } from '../contracts/index.js';
import {
  Budget,
  BudgetCloner,
  BudgetFromTemplateFactory,
  type BudgetLine,
  type BudgetLineInput,
  type BudgetLineState,
  type BudgetTarget,
  type CopiedLines,
  type FinancialPeriod,
  isTargetKind,
} from '../domain/index.js';
import { BudgetCalculator, loadTargetTree, planCurrency, type BudgetView } from './budget-calculator.js';
import { originOf } from './budget-origin.js';
import { BudgetThresholdService } from './budget-thresholds.service.js';
import { toBudgetDto, toLineDto, type BudgetDto, type BudgetLineDto } from './budget-view.js';
import type { BudgetsDeps } from './ports/index.js';
import { toOmittedDto } from './template-view.js';

const AGGREGATE = 'Budget';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `budget ${id} not found`);
const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

export interface CreateBudgetInput {
  readonly workspaceId: string;
  readonly periodId: string;
  /** `EMPTY` (por defecto), `TEMPLATE {templateId, versionNo?}` o `CLONE_PREVIOUS` (add-budget-templates). */
  readonly source?: unknown;
  readonly zeroBased?: boolean | undefined;
}

export type BudgetSource =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'TEMPLATE'; readonly templateId: string; readonly versionNo: number | undefined }
  | { readonly kind: 'CLONE_PREVIOUS' };

/** Respuesta de `createBudget`: el plan más las líneas del origen que no se copiaron (`omittedLines`). */
export type CreatedBudgetDto = BudgetDto;

function parseSource(raw: unknown): BudgetSource {
  if (raw === undefined || raw === null) return { kind: 'EMPTY' };
  const source = raw as { kind?: unknown; templateId?: unknown; versionNo?: unknown };
  const kind = source.kind ?? 'EMPTY';
  if (kind === 'EMPTY') return { kind: 'EMPTY' };
  if (kind === 'CLONE_PREVIOUS') return { kind: 'CLONE_PREVIOUS' };
  if (kind === 'TEMPLATE') {
    if (typeof source.templateId !== 'string' || source.templateId === '') {
      throw new DomainError('VALIDATION_FAILED', 'source.templateId is required for TEMPLATE').at(
        '/source/templateId',
      );
    }
    let versionNo: number | undefined;
    if (source.versionNo !== undefined && source.versionNo !== null) {
      if (
        typeof source.versionNo !== 'number' ||
        !Number.isInteger(source.versionNo) ||
        source.versionNo < 1
      ) {
        throw new DomainError('VALIDATION_FAILED', 'source.versionNo must be a positive integer').at(
          '/source/versionNo',
        );
      }
      versionNo = source.versionNo;
    }
    return { kind: 'TEMPLATE', templateId: source.templateId, versionNo };
  }
  throw new DomainError('VALIDATION_FAILED', 'source.kind must be EMPTY, TEMPLATE or CLONE_PREVIOUS').at(
    '/source/kind',
  );
}

export interface AddBudgetLineInput {
  readonly workspaceId: string;
  readonly budgetId: string;
  readonly target: unknown;
  readonly spec: BudgetLineInput;
}

export interface UpdateBudgetLineInput {
  readonly workspaceId: string;
  readonly budgetId: string;
  readonly lineId: string;
  readonly expectedVersion: number;
  readonly patch: BudgetLineInput;
}

/** Monto del plan para la auditoría (`money` exacto de la allow-list). */
const auditMoney = (amount: string | null, currency: string) =>
  amount === null ? null : { amount, currency };

function lineSnapshotChanges(state: BudgetLineState, currency: string): AuditChangeInput[] {
  return [
    { field: 'line', before: null, after: state.id },
    { field: 'target', before: null, after: `${state.target.kind}:${state.target.id}` },
    { field: 'nature', before: null, after: state.nature },
    { field: 'kind', before: null, after: state.kind },
    { field: 'planned', before: null, after: auditMoney(state.planned, currency) },
    { field: 'min', before: null, after: auditMoney(state.min, currency) },
    { field: 'max', before: null, after: auditMoney(state.max, currency) },
    { field: 'percent', before: null, after: state.percent },
    { field: 'incomeBasis', before: null, after: state.incomeBasis },
    { field: 'rolloverPolicy', before: null, after: state.rolloverPolicy },
    { field: 'rolloverCap', before: null, after: auditMoney(state.rolloverCap, currency) },
    { field: 'thresholds', before: null, after: JSON.stringify(state.thresholds) },
    { field: 'source', before: null, after: state.source },
  ];
}

/** Cambios campo a campo entre dos versiones de una línea (solo lo que cambió, más la línea afectada). */
function lineDiff(before: BudgetLineState, after: BudgetLineState, currency: string): AuditChangeInput[] {
  const out: AuditChangeInput[] = [
    { field: 'line', before: before.id, after: after.id },
    {
      field: 'target',
      before: `${before.target.kind}:${before.target.id}`,
      after: `${after.target.kind}:${after.target.id}`,
    },
  ];
  const push = (field: string, b: unknown, a: unknown) => {
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ field, before: b, after: a });
  };
  push('kind', before.kind, after.kind);
  push('planned', auditMoney(before.planned, currency), auditMoney(after.planned, currency));
  push('min', auditMoney(before.min, currency), auditMoney(after.min, currency));
  push('max', auditMoney(before.max, currency), auditMoney(after.max, currency));
  push('percent', before.percent, after.percent);
  push('incomeBasis', before.incomeBasis, after.incomeBasis);
  push('rolloverPolicy', before.rolloverPolicy, after.rolloverPolicy);
  push('rolloverCap', auditMoney(before.rolloverCap, currency), auditMoney(after.rolloverCap, currency));
  push('thresholds', JSON.stringify(before.thresholds), JSON.stringify(after.thresholds));
  return out;
}

function parseTarget(raw: unknown): BudgetTarget {
  const target = raw as { kind?: unknown; id?: unknown } | null | undefined;
  if (!target || !isTargetKind(target.kind) || typeof target.id !== 'string' || target.id === '') {
    throw new DomainError('VALIDATION_FAILED', 'target must be {kind: CATEGORY|GROUP|TAG, id}').at('/target');
  }
  return { kind: target.kind, id: target.id };
}

/**
 * Comandos del plan mensual (openspec add-budgets decisiones 1-3, 7, 11-13): cada uno corre en UNA unidad de trabajo
 * con el plan bloqueado `FOR UPDATE`, antecedido por `PlanningEditGuard.assertPlanEditable(periodId)` (periodo
 * cerrado => `PERIOD_CLOSED`, INV-015), con auditoría síncrona (INV-029) y evaluación de umbrales en la misma
 * transacción. El rol (VIEWER lee; EDITOR/OWNER escriben) lo aplica el contrato (`x-required-role`).
 */
export class BudgetsService {
  private readonly calculator: BudgetCalculator;
  private readonly thresholds: BudgetThresholdService;

  constructor(private readonly deps: BudgetsDeps) {
    this.calculator = new BudgetCalculator(deps);
    this.thresholds = new BudgetThresholdService(deps, this.calculator);
  }

  /**
   * `CreateBudget`: un plan por periodo, en la moneda base del workspace (docs/33 D78), vacío (`EMPTY`), desde una
   * versión de template (`TEMPLATE`) o clonando el plan del periodo anterior (`CLONE_PREVIOUS`); add-budget-templates
   * decisiones 2-4.
   */
  async createBudget(input: CreateBudgetInput): Promise<CreatedBudgetDto> {
    const { deps } = this;
    const { workspaceId, periodId } = input;
    const source = parseSource(input.source);
    if (!deps.settings) throw new Error('BudgetsDeps.settings is required to create budgets');
    const settings = await deps.settings.settingsOf(workspaceId);
    return deps.uow.run(workspaceId, () =>
      this.createIn({
        workspaceId,
        periodId,
        source,
        zeroBased: input.zeroBased === true,
        baseCurrency: settings.baseCurrency,
      }),
    );
  }

  /**
   * `PeriodCreatedHook` (add-budget-templates decisión 5): invocado de forma síncrona por la creación de periodos en
   * SU unidad de trabajo. Con template predeterminado activo y el periodo sin plan, crea el plan desde su última
   * versión; sin predeterminado o con plan existente no hace nada (idempotente ante reintentos).
   */
  async applyDefaultTemplate(input: {
    readonly workspaceId: string;
    readonly periodId: string;
  }): Promise<boolean> {
    const { deps } = this;
    const { workspaceId, periodId } = input;
    return deps.uow.run(workspaceId, async () => {
      const template = await deps.templates.findDefault(workspaceId);
      if (!template) return false;
      if (await deps.budgets.findByPeriod(workspaceId, periodId)) return false;
      if (!deps.settings) throw new Error('BudgetsDeps.settings is required to apply the default template');
      const settings = await deps.settings.settingsOf(workspaceId);
      await this.createIn({
        workspaceId,
        periodId,
        source: { kind: 'TEMPLATE', templateId: template.id, versionNo: undefined },
        zeroBased: false,
        baseCurrency: settings.baseCurrency,
      });
      return true;
    });
  }

  /** Núcleo de `CreateBudget` en la unidad de trabajo en curso. */
  private async createIn(input: {
    readonly workspaceId: string;
    readonly periodId: string;
    readonly source: BudgetSource;
    readonly zeroBased: boolean;
    readonly baseCurrency: string;
  }): Promise<CreatedBudgetDto> {
    const { deps } = this;
    const { workspaceId, periodId, source } = input;
    await deps.guard.assertPlanEditable({ workspaceId, periodId });
    const period = await deps.periods.findById(workspaceId, periodId);
    if (!period) throw new DomainError('REFERENCE_NOT_FOUND', `financial period ${periodId} not found`);
    const currency = await planCurrency(deps, workspaceId, input.baseCurrency);
    const now = deps.clock.now().toString();
    const budgetId = deps.ids.next();
    const nextId = () => deps.ids.next();

    let origin: 'EMPTY' | 'TEMPLATE' | 'CLONE' = 'EMPTY';
    let templateVersionId: string | null = null;
    let clonedFromBudgetId: string | null = null;
    let copied: CopiedLines = { lines: [], omitted: [] };
    if (source.kind === 'TEMPLATE') {
      origin = 'TEMPLATE';
      const template = await deps.templates.findById(workspaceId, source.templateId);
      if (!template) {
        throw new DomainError('REFERENCE_NOT_FOUND', `budget template ${source.templateId} not found`).at(
          '/source/templateId',
        );
      }
      template.assertActive();
      const version =
        source.versionNo === undefined || source.versionNo === template.currentVersionNo
          ? template.currentVersion
          : await deps.templates.findVersion(workspaceId, template.id, source.versionNo);
      if (!version) {
        throw new DomainError(
          'REFERENCE_NOT_FOUND',
          `version ${source.versionNo} of template ${template.name} not found`,
        ).at('/source/versionNo');
      }
      templateVersionId = version.id;
      const tree = await loadTargetTree(deps, workspaceId);
      copied = BudgetFromTemplateFactory.build({
        version,
        workspaceId,
        budgetId,
        currency: currency.code,
        tree,
        nextId,
      });
    } else if (source.kind === 'CLONE_PREVIOUS') {
      origin = 'CLONE';
      const previousPeriod = (await deps.periods.list(workspaceId))
        .filter((p) => p.snapshot.periodStart < period.snapshot.periodStart)
        .at(-1);
      const previous = previousPeriod
        ? await deps.budgets.findByPeriod(workspaceId, previousPeriod.id)
        : null;
      if (!previous) {
        throw new DomainError(
          'REFERENCE_NOT_FOUND',
          `the period before ${period.label} has no budget plan to clone`,
        ).at('/periodId');
      }
      clonedFromBudgetId = previous.id;
      templateVersionId = previous.snapshot.templateVersionId;
      const tree = await loadTargetTree(deps, workspaceId);
      copied = BudgetCloner.build({
        previous,
        workspaceId,
        budgetId,
        currency: currency.code,
        tree,
        nextId,
      });
    }

    // Un template archivado o una versión inexistente se informan antes que un plan ya existente.
    const existing = await deps.budgets.findByPeriod(workspaceId, periodId);
    if (existing) {
      throw new DomainError('BUDGET_ALREADY_EXISTS', `period ${period.label} already has a budget plan`).at(
        '/periodId',
      );
    }

    const budget = Budget.create({
      id: budgetId,
      workspaceId,
      periodId,
      currency,
      zeroBased: input.zeroBased,
      origin,
      templateVersionId,
      clonedFromBudgetId,
      at: now,
    });
    budget.seedLines(copied.lines);
    if (!(await deps.budgets.insertIfAbsent(budget))) {
      throw new DomainError('BUDGET_ALREADY_EXISTS', `period ${period.label} already has a budget plan`).at(
        '/periodId',
      );
    }
    for (const line of copied.lines) await deps.budgets.insertLine(line);
    const s = budget.snapshot;
    const ref = templateVersionId ? await deps.templates.versionRef(workspaceId, templateVersionId) : null;
    const omittedJson = copied.omitted.length
      ? JSON.stringify(
          copied.omitted.map((o) => ({ target: `${o.target.kind}:${o.target.id}`, reason: o.reason })),
        )
      : null;
    await deps.audit.append({
      workspaceId,
      action: 'planning.budget.created',
      aggregateType: AGGREGATE,
      aggregateId: s.id,
      aggregateVersion: s.version,
      changes: [
        { field: 'periodId', before: null, after: s.periodId },
        { field: 'currency', before: null, after: s.currency },
        { field: 'origin', before: null, after: s.origin },
        { field: 'zeroBased', before: null, after: s.zeroBased },
        ...(ref
          ? [
              { field: 'templateId', before: null, after: ref.templateId },
              { field: 'templateVersionNo', before: null, after: ref.versionNo },
            ]
          : []),
        ...(clonedFromBudgetId
          ? [{ field: 'clonedFromBudgetId', before: null, after: clonedFromBudgetId }]
          : []),
        ...(origin === 'EMPTY' ? [] : [{ field: 'lineCount', before: null, after: copied.lines.length }]),
        ...(omittedJson ? [{ field: 'omittedLines', before: null, after: omittedJson }] : []),
      ],
    });
    const payload: BudgetCreatedV1 = {
      budgetId: s.id,
      periodId: s.periodId,
      periodLabel: period.label,
      currency: s.currency,
      origin: s.origin,
      templateId: ref?.templateId ?? null,
      templateVersionNo: ref?.versionNo ?? null,
      clonedFromBudgetId,
      lineCount: copied.lines.length,
    };
    await deps.outbox.append({
      eventId: deps.ids.next(),
      eventType: BUDGET_CREATED.eventType,
      eventVersion: BUDGET_CREATED.eventVersion,
      occurredAt: now,
      workspaceId,
      aggregateType: AGGREGATE,
      aggregateId: s.id,
      aggregateVersion: s.version,
      payload,
    });
    const view = await this.calculator.view({ workspaceId, budget, period, now: deps.clock.now() });
    if (copied.lines.length > 0) {
      await this.thresholds.evaluateView(view, new Set(copied.lines.map((l) => l.id)));
    }
    const dto = toBudgetDto(
      await this.calculator.view({ workspaceId, budget, period, now: deps.clock.now() }),
      {
        templateVersion: ref
          ? { templateId: ref.templateId, versionNo: ref.versionNo, name: ref.templateName }
          : null,
        clonedFromBudgetId,
      },
    );
    return origin === 'EMPTY' ? dto : { ...dto, omittedLines: copied.omitted.map(toOmittedDto) };
  }

  /** `AddBudgetLine`: valida, persiste, audita y evalúa los umbrales de la línea nueva en la misma transacción. */
  async addLine(input: AddBudgetLineInput): Promise<BudgetLineDto> {
    const { deps } = this;
    const { workspaceId } = input;
    const target = parseTarget(input.target);
    return this.withBudget(workspaceId, input.budgetId, async (budget, period) => {
      const currency = await planCurrency(deps, workspaceId, budget.snapshot.currency);
      const tree = await loadTargetTree(deps, workspaceId);
      const line = budget.addLine({
        lineId: deps.ids.next(),
        target,
        spec: input.spec,
        currency,
        tree,
      });
      await this.persist(budget, [{ insert: line }]);
      await deps.audit.append({
        workspaceId,
        action: 'planning.budget.line_added',
        aggregateType: AGGREGATE,
        aggregateId: budget.id,
        aggregateVersion: budget.version,
        changes: lineSnapshotChanges(line.snapshot, currency.code),
      });
      const view = await this.calculator.view({ workspaceId, budget, period, now: deps.clock.now() });
      await this.thresholds.evaluateView(view, new Set([line.id]));
      return this.lineDto(view, line.id);
    });
  }

  /** `UpdateBudgetLine` (`If-Match` = versión de la línea): reevalúa los umbrales con el gastado vigente. */
  async updateLine(input: UpdateBudgetLineInput): Promise<BudgetLineDto> {
    const { deps } = this;
    const { workspaceId } = input;
    return this.withBudget(workspaceId, input.budgetId, async (budget, period) => {
      const currency = await planCurrency(deps, workspaceId, budget.snapshot.currency);
      const { before, after } = budget.updateLine({
        lineId: input.lineId,
        expectedVersion: input.expectedVersion,
        patch: input.patch,
        currency,
      });
      await this.persist(budget, [{ update: after }]);
      await deps.audit.append({
        workspaceId,
        action: 'planning.budget.line_updated',
        aggregateType: AGGREGATE,
        aggregateId: budget.id,
        aggregateVersion: budget.version,
        changes: lineDiff(before.snapshot, after.snapshot, currency.code),
      });
      const view = await this.calculator.view({ workspaceId, budget, period, now: deps.clock.now() });
      await this.thresholds.evaluateView(view, new Set([after.id]));
      return this.lineDto(view, after.id);
    });
  }

  async removeLine(input: { workspaceId: string; budgetId: string; lineId: string }): Promise<void> {
    const { deps } = this;
    const { workspaceId } = input;
    await this.withBudget(workspaceId, input.budgetId, async (budget) => {
      const currency = budget.snapshot.currency;
      const removed = budget.removeLine(input.lineId);
      await this.persist(budget, [{ remove: removed }]);
      const s = removed.snapshot;
      await deps.audit.append({
        workspaceId,
        action: 'planning.budget.line_removed',
        aggregateType: AGGREGATE,
        aggregateId: budget.id,
        aggregateVersion: budget.version,
        changes: [
          { field: 'line', before: s.id, after: null },
          { field: 'target', before: `${s.target.kind}:${s.target.id}`, after: null },
          { field: 'kind', before: s.kind, after: null },
          { field: 'planned', before: auditMoney(s.planned, currency), after: null },
          { field: 'min', before: auditMoney(s.min, currency), after: null },
          { field: 'max', before: auditMoney(s.max, currency), after: null },
        ],
      });
    });
  }

  /** `SetZeroBasedMode` (`If-Match` = versión del plan). */
  async setZeroBased(input: {
    workspaceId: string;
    budgetId: string;
    zeroBased: boolean;
    expectedVersion: number;
  }): Promise<BudgetDto> {
    const { deps } = this;
    const { workspaceId } = input;
    return this.withBudget(workspaceId, input.budgetId, async (budget, period) => {
      if (budget.version !== input.expectedVersion) throw preconditionFailed(budget.version);
      const before = budget.zeroBased;
      if (budget.setZeroBased(input.zeroBased)) {
        await this.persist(budget, []);
        await deps.audit.append({
          workspaceId,
          action: 'planning.budget.updated',
          aggregateType: AGGREGATE,
          aggregateId: budget.id,
          aggregateVersion: budget.version,
          changes: [{ field: 'zeroBased', before, after: input.zeroBased }],
        });
      }
      return toBudgetDto(
        await this.calculator.view({ workspaceId, budget, period, now: deps.clock.now() }),
        await originOf(deps, budget),
      );
    });
  }

  /**
   * Carga el plan bajo `FOR UPDATE` DESPUÉS del guard de planificación (el periodo se bloquea `FOR SHARE` primero,
   * mismo orden que el cierre de mes: sin interbloqueos) y entrega el periodo.
   */
  private withBudget<T>(
    workspaceId: string,
    budgetId: string,
    fn: (budget: Budget, period: FinancialPeriod) => Promise<T>,
  ): Promise<T> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const probe = await deps.budgets.findById(workspaceId, budgetId);
      if (!probe) throw notFound(budgetId);
      await deps.guard.assertPlanEditable({ workspaceId, periodId: probe.periodId });
      const budget = await deps.budgets.findById(workspaceId, budgetId, { lock: 'update' });
      if (!budget) throw notFound(budgetId);
      const period = await deps.periods.findById(workspaceId, budget.periodId);
      if (!period)
        throw new DomainError('REFERENCE_NOT_FOUND', `financial period ${budget.periodId} not found`);
      return fn(budget, period);
    });
  }

  private async persist(
    budget: Budget,
    ops: readonly ({ insert: BudgetLine } | { update: BudgetLine } | { remove: BudgetLine })[],
  ): Promise<void> {
    const { deps } = this;
    if (!(await deps.budgets.save(budget))) throw preconditionFailed(budget.persistedVersion);
    budget.markPersisted();
    for (const op of ops) {
      if ('insert' in op) await deps.budgets.insertLine(op.insert);
      else if ('update' in op) {
        if (!(await deps.budgets.updateLine(op.update))) throw preconditionFailed(op.update.persistedVersion);
      } else await deps.budgets.deleteLine(budget.workspaceId, op.remove.id);
    }
  }

  private lineDto(view: BudgetView, lineId: string): BudgetLineDto {
    const lv = view.lines.find((l) => l.line.id === lineId);
    if (!lv) throw new DomainError('RESOURCE_NOT_FOUND', `budget line ${lineId} not found`);
    return toLineDto(lv, view.currency.code);
  }
}
