import { createHash } from 'node:crypto';
import type { AuditChangeInput } from '@pf/audit/contracts';
import { DomainError, LocalDate } from '@pf/shared-kernel';
import {
  BudgetLine,
  PropagationPlanner,
  buildTemplateLines,
  diffTemplates,
  targetKey,
  type Budget,
  type BudgetLineSpec,
  type BudgetPropagationPlan,
  type BudgetTemplate,
  type TemplateDiffEntry,
  type TemplateLine,
} from '../domain/index.js';
import { loadTargetTree, planCurrency } from './budget-calculator.js';
import type { BudgetsDeps } from './ports/index.js';
import { linesAuditJson } from './templates.service.js';
import {
  toChangeDto,
  toConflictDto,
  toTemplateDto,
  toTemplateLineDto,
  type PropagationPeriodDto,
  type PropagationPreviewDto,
  type TemplateDto,
} from './template-view.js';

const AGGREGATE = 'Budget';

type PropagationSource =
  | {
      readonly kind: 'TEMPLATE';
      readonly templateId: string;
      readonly baseVersionNo: number;
      readonly lines: unknown;
    }
  | { readonly kind: 'BUDGET'; readonly budgetId: string; readonly lineIds: readonly string[] };

export interface PropagationInput {
  readonly workspaceId: string;
  readonly source: unknown;
  readonly token?: unknown;
  readonly changeNote?: unknown;
}

export interface PropagationResultDto {
  readonly template: TemplateDto;
  readonly applied: readonly (PropagationPeriodDto & {
    readonly changes: number;
    readonly conflicts: number;
  })[];
}

interface Computation {
  readonly template: BudgetTemplate;
  readonly nextLines: readonly TemplateLine[];
  readonly diff: readonly TemplateDiffEntry[];
  readonly plans: readonly BudgetPropagationPlan[];
  readonly labels: ReadonlyMap<string, string>;
  readonly currency: string;
  readonly token: string;
}

function parseSource(raw: unknown): PropagationSource {
  const source = raw as {
    kind?: unknown;
    templateId?: unknown;
    baseVersionNo?: unknown;
    lines?: unknown;
    budgetId?: unknown;
    lineIds?: unknown;
  } | null;
  if (!source || typeof source !== 'object') {
    throw new DomainError('VALIDATION_FAILED', 'source is required').at('/source');
  }
  if (source.kind === 'TEMPLATE') {
    if (typeof source.templateId !== 'string' || source.templateId === '') {
      throw new DomainError('VALIDATION_FAILED', 'source.templateId is required').at('/source/templateId');
    }
    if (
      typeof source.baseVersionNo !== 'number' ||
      !Number.isInteger(source.baseVersionNo) ||
      source.baseVersionNo < 1
    ) {
      throw new DomainError('VALIDATION_FAILED', 'source.baseVersionNo must be a positive integer').at(
        '/source/baseVersionNo',
      );
    }
    return {
      kind: 'TEMPLATE',
      templateId: source.templateId,
      baseVersionNo: source.baseVersionNo,
      lines: source.lines,
    };
  }
  if (source.kind === 'BUDGET') {
    if (typeof source.budgetId !== 'string' || source.budgetId === '') {
      throw new DomainError('VALIDATION_FAILED', 'source.budgetId is required').at('/source/budgetId');
    }
    if (
      !Array.isArray(source.lineIds) ||
      source.lineIds.length === 0 ||
      source.lineIds.some((id) => typeof id !== 'string')
    ) {
      throw new DomainError('VALIDATION_FAILED', 'source.lineIds must list at least one line').at(
        '/source/lineIds',
      );
    }
    return { kind: 'BUDGET', budgetId: source.budgetId, lineIds: source.lineIds as string[] };
  }
  throw new DomainError('VALIDATION_FAILED', 'source.kind must be TEMPLATE or BUDGET').at('/source/kind');
}

/** Línea de plan o de template como entrada de `buildTemplateLines` (montos en la moneda indicada). */
function specToInput(spec: BudgetLineSpec, currency: string, target: { kind: string; id: string }) {
  const money = (amount: string | null) => (amount === null ? null : { amount, currency });
  return {
    target,
    kind: spec.kind,
    planned: money(spec.planned),
    min: money(spec.min),
    max: money(spec.max),
    percent: spec.percent,
    incomeBasis: spec.incomeBasis,
    rolloverPolicy: spec.rolloverPolicy,
    rolloverCap: money(spec.rolloverCap),
    thresholds: spec.thresholds,
  };
}

/**
 * Propagación a meses futuros (openspec add-budget-templates decisión 7; docs/33 D84-D86): `PreviewPropagation` es una
 * vista previa SIN estado (nada se persiste) con un token de hash; `ConfirmPropagation` recalcula en UNA transacción,
 * compara el token (`BUDGET_PROPAGATION_STALE`), publica la versión N+1 del template y actualiza los planes alcanzados.
 * Alcance: planes del template cuyos periodos están en borrador, con inicio posterior a hoy en la zona del workspace
 * (y posteriores al periodo del plan origen); nunca periodos activos, reabiertos o cerrados (INV-015).
 */
export class PropagationService {
  constructor(private readonly deps: BudgetsDeps) {}

  async preview(input: PropagationInput): Promise<PropagationPreviewDto> {
    const { deps } = this;
    const { workspaceId } = input;
    const source = parseSource(input.source);
    return deps.uow.run(workspaceId, async () => {
      const c = await this.compute(workspaceId, source, false);
      const periods: PropagationPeriodDto[] = c.plans.map((p) => this.periodOf(p.budget, c.labels));
      const added = c.diff.filter((d) => d.action === 'ADD').length;
      const updated = c.diff.filter((d) => d.action === 'UPDATE').length;
      const removed = c.diff.filter((d) => d.action === 'REMOVE').length;
      return {
        templateId: c.template.id,
        baseVersionNo: c.template.currentVersionNo,
        newVersionPreview: {
          versionNo: c.template.currentVersionNo + 1,
          added,
          updated,
          removed,
          lines: c.nextLines.map(toTemplateLineDto),
        },
        periods,
        changes: c.plans.flatMap((p, i) => p.changes.map((ch) => toChangeDto(ch, periods[i]!, c.currency))),
        conflicts: c.plans.flatMap((p, i) =>
          p.conflicts.map((cf) => toConflictDto(cf, periods[i]!, c.currency)),
        ),
        token: c.token,
      };
    });
  }

  async confirm(input: PropagationInput): Promise<PropagationResultDto> {
    const { deps } = this;
    const { workspaceId } = input;
    const source = parseSource(input.source);
    if (typeof input.token !== 'string' || input.token === '') {
      throw new DomainError('VALIDATION_FAILED', 'token is required').at('/token');
    }
    const token = input.token;
    const changeNote =
      typeof input.changeNote === 'string' && input.changeNote.trim() !== ''
        ? input.changeNote.trim().slice(0, 500)
        : null;
    return deps.uow.run(workspaceId, async () => {
      const c = await this.compute(workspaceId, source, true);
      if (c.token !== token) {
        throw new DomainError(
          'BUDGET_PROPAGATION_STALE',
          'the plans or the template changed after the preview; request a new preview',
        );
      }
      if (c.diff.length === 0) {
        throw new DomainError('VALIDATION_FAILED', 'there is nothing to propagate: no line differs').at(
          '/source',
        );
      }
      const { template } = c;
      const before = template.currentVersion;
      const now = deps.clock.now().toString();
      const next = template.publishVersion({
        baseVersionNo: before.versionNo,
        versionId: deps.ids.next(),
        lines: c.nextLines,
        changeNote,
        by: deps.actor.userId() === '' ? null : deps.actor.userId(),
        at: now,
      });
      if (!(await deps.templates.save(template))) {
        throw new DomainError('CONCURRENCY_CONFLICT', 'the template was modified concurrently');
      }
      template.markPersisted();
      await deps.templates.insertCurrentVersion(template);
      await deps.audit.append({
        workspaceId,
        action: 'planning.template.version_published',
        aggregateType: 'BudgetTemplate',
        aggregateId: template.id,
        aggregateVersion: template.version,
        changes: [
          { field: 'versionNo', before: before.versionNo, after: next.versionNo },
          { field: 'changeNote', before: null, after: next.changeNote },
          { field: 'lineCount', before: before.lines.length, after: next.lines.length },
          { field: 'lines', before: linesAuditJson(before.lines), after: linesAuditJson(next.lines) },
        ],
      });

      const applied: PropagationResultDto['applied'][number][] = [];
      for (const plan of c.plans) {
        const { budget } = plan;
        const previousVersionNo = before.versionNo;
        for (const ch of plan.changes) {
          if (ch.action === 'ADD') {
            const line = BudgetLine.create({
              id: deps.ids.next(),
              workspaceId,
              budgetId: budget.id,
              target: ch.target,
              nature: ch.nature,
              spec: ch.to!,
              source: 'TEMPLATE',
              templateLineId: ch.templateLine!.id,
            });
            budget.attachTemplateLine(line);
            await deps.budgets.insertLine(line);
          } else if (ch.action === 'UPDATE') {
            const current = budget.line(ch.lineId!)!;
            const line = current.withTemplateSpec(ch.to!, ch.templateLine!.id);
            budget.replaceTemplateLine(line);
            if (!(await deps.budgets.updateLine(line))) {
              throw new DomainError('CONCURRENCY_CONFLICT', 'a plan line was modified concurrently');
            }
          } else {
            const removed = budget.removeLine(ch.lineId!);
            await deps.budgets.deleteLine(workspaceId, removed.id);
          }
        }
        budget.adoptTemplateVersion(next.id);
        if (!(await deps.budgets.save(budget))) {
          throw new DomainError('CONCURRENCY_CONFLICT', 'a plan was modified concurrently');
        }
        budget.markPersisted();
        const period = this.periodOf(budget, c.labels);
        await deps.audit.append({
          workspaceId,
          action: 'planning.budget.propagated',
          aggregateType: AGGREGATE,
          aggregateId: budget.id,
          aggregateVersion: budget.version,
          changes: budgetChanges(template.id, previousVersionNo, next.versionNo, plan),
        });
        applied.push({ ...period, changes: plan.changes.length, conflicts: plan.conflicts.length });
      }
      return {
        template: toTemplateDto(template, await deps.templates.listVersions(workspaceId, template.id)),
        applied,
      };
    });
  }

  // ------------------------------------------------------------------ internos

  private periodOf(budget: Budget, labels: ReadonlyMap<string, string>): PropagationPeriodDto {
    return {
      budgetId: budget.id,
      periodId: budget.periodId,
      periodLabel: labels.get(budget.periodId) ?? '',
    };
  }

  /** Resuelve origen, alcance y diferencias; con `lock` toma los candados en el orden periodo -> plan (sin interbloqueos). */
  private async compute(workspaceId: string, source: PropagationSource, lock: boolean): Promise<Computation> {
    const { deps } = this;
    const tree = await loadTargetTree(deps, workspaceId);
    if (!deps.settings) throw new Error('BudgetsDeps.settings is required to propagate templates');
    const settings = await deps.settings.settingsOf(workspaceId);
    const baseCurrency = await planCurrency(deps, workspaceId, settings.baseCurrency);

    let template: BudgetTemplate;
    let nextLines: TemplateLine[];
    let originStart: string | null = null;
    let currency = baseCurrency;
    if (source.kind === 'TEMPLATE') {
      const found = await deps.templates.findById(
        workspaceId,
        source.templateId,
        lock ? { lock: 'update' } : {},
      );
      if (!found) {
        throw new DomainError('REFERENCE_NOT_FOUND', `budget template ${source.templateId} not found`).at(
          '/source/templateId',
        );
      }
      template = found;
      template.assertActive();
      if (source.baseVersionNo !== template.currentVersionNo) {
        throw new DomainError(
          'CONCURRENCY_CONFLICT',
          `template ${template.name} is at version ${template.currentVersionNo}, not ${source.baseVersionNo}`,
          { details: { currentVersionNo: template.currentVersionNo } },
        );
      }
      nextLines = buildTemplateLines({
        lines: source.lines,
        currency,
        tree,
        base: template.currentVersion.lines,
        nextId: () => deps.ids.next(),
      });
    } else {
      const origin = await deps.budgets.findById(workspaceId, source.budgetId);
      if (!origin) {
        throw new DomainError('REFERENCE_NOT_FOUND', `budget ${source.budgetId} not found`).at(
          '/source/budgetId',
        );
      }
      const ref = origin.snapshot.templateVersionId
        ? await deps.templates.versionRef(workspaceId, origin.snapshot.templateVersionId)
        : null;
      if (!ref) {
        throw new DomainError(
          'BUDGET_NO_TEMPLATE_ORIGIN',
          'the plan does not come from a template: create a template with its lines instead',
        ).at('/source/budgetId');
      }
      const found = await deps.templates.findById(
        workspaceId,
        ref.templateId,
        lock ? { lock: 'update' } : {},
      );
      if (!found) throw new DomainError('REFERENCE_NOT_FOUND', `budget template ${ref.templateId} not found`);
      template = found;
      template.assertActive();
      const period = await deps.periods.findById(workspaceId, origin.periodId);
      originStart = period?.snapshot.periodStart ?? null;
      currency = await planCurrency(deps, workspaceId, origin.snapshot.currency);
      const selected = source.lineIds.map((id) => {
        const line = origin.line(id);
        if (!line) {
          throw new DomainError('REFERENCE_NOT_FOUND', `budget line ${id} not found in the plan`).at(
            '/source/lineIds',
          );
        }
        return line;
      });
      const merged = new Map<string, unknown>(
        template.currentVersion.lines.map((l) => [
          targetKey(l.target),
          specToInput(l.spec, l.currency, l.target),
        ]),
      );
      for (const line of selected) {
        merged.set(targetKey(line.target), specToInput(line.spec, currency.code, line.target));
      }
      nextLines = buildTemplateLines({
        lines: [...merged.values()],
        currency,
        tree,
        base: template.currentVersion.lines,
        nextId: () => deps.ids.next(),
      });
    }

    const calendar = await deps.calendar.calendarOf(workspaceId);
    const today = LocalDate.ofInstant(deps.clock.now(), calendar.timeZone).toString();
    const drafts = (await deps.periods.list(workspaceId, ['DRAFT'])).filter(
      (p) => p.snapshot.periodStart > today && (originStart === null || p.snapshot.periodStart > originStart),
    );
    const labels = new Map(drafts.map((p) => [p.id, p.label]));
    const inScope = new Set(drafts.map((p) => p.id));
    let budgets = (await deps.budgets.listByTemplate(workspaceId, template.id))
      .filter((b) => inScope.has(b.periodId))
      .sort((a, b) =>
        a.periodId === b.periodId
          ? 0
          : (labels.get(a.periodId) ?? '') < (labels.get(b.periodId) ?? '')
            ? -1
            : 1,
      );
    if (lock) {
      const locked: Budget[] = [];
      for (const b of budgets) {
        await deps.guard.assertPlanEditable({ workspaceId, periodId: b.periodId });
        const fresh = await deps.budgets.findById(workspaceId, b.id, { lock: 'update' });
        if (fresh) locked.push(fresh);
      }
      budgets = locked;
    }
    const diff = diffTemplates(template.currentVersion.lines, nextLines);
    const plans = PropagationPlanner.plan({ diff, budgets, tree });
    return {
      template,
      nextLines,
      diff,
      plans,
      labels,
      currency: currency.code,
      token: tokenOf(template, budgets, nextLines),
    };
  }
}

/** Hash de lo que la vista previa vio: versión vigente, planes alcanzados (con su versión) y la instantánea nueva. */
function tokenOf(
  template: BudgetTemplate,
  budgets: readonly Budget[],
  lines: readonly TemplateLine[],
): string {
  const payload = {
    template: [template.id, template.currentVersionNo],
    budgets: budgets.map((b) => [b.id, b.version]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
    lines: lines
      .map((l) => [targetKey(l.target), l.nature, l.currency, l.spec])
      .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1)),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Cambios de auditoría de un plan propagado: versión del template, líneas cambiadas y conflictos (texto JSON). */
function budgetChanges(
  templateId: string,
  fromVersionNo: number,
  toVersionNo: number,
  plan: BudgetPropagationPlan,
): AuditChangeInput[] {
  const out: AuditChangeInput[] = [
    { field: 'templateId', before: templateId, after: templateId },
    { field: 'templateVersionNo', before: fromVersionNo, after: toVersionNo },
    {
      field: 'propagatedChanges',
      before: null,
      after: JSON.stringify(
        plan.changes.map((ch) => ({ action: ch.action, target: `${ch.target.kind}:${ch.target.id}` })),
      ),
    },
  ];
  if (plan.conflicts.length > 0) {
    out.push({
      field: 'propagationConflicts',
      before: null,
      after: JSON.stringify(
        plan.conflicts.map((cf) => ({
          action: cf.action,
          reason: cf.reason,
          target: `${cf.target.kind}:${cf.target.id}`,
        })),
      ),
    });
  }
  return out;
}
