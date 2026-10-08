import type { AuditPort } from '@pf/audit/contracts';
import { BUDGET_THRESHOLD_REACHED, type BudgetThresholdReachedV1 } from '../contracts/index.js';
import { THRESHOLD_KINDS, ThresholdEvaluator } from '../domain/index.js';
import { type BudgetCalculator, type BudgetView } from './budget-calculator.js';
import type { BudgetsDeps, ThresholdCrossingRow } from './ports/index.js';

const AGGREGATE = 'Budget';

/**
 * Detección de umbrales con emisión única (openspec add-budgets decisiones 7-9; FR-PLANNING-022):
 *   - el cruce se registra en `planning.budget_threshold_crossing` (append-only, PK por periodo, objetivo y umbral;
 *     `INSERT … ON CONFLICT DO NOTHING`) y el hecho `planning.BudgetThresholdReached.v1` se escribe en el outbox en la
 *     MISMA transacción, solo por los umbrales efectivamente insertados;
 *   - varios umbrales cruzados a la vez => UN hecho con el más alto y `alsoCrossed` (docs/33 D80);
 *   - el dedupe es por objetivo, no por línea: quitar y volver a agregar la línea no re-alerta;
 *   - se evalúa con la parte convertida del gastado aunque esté incompleto y se reevalúa con `fx.RateRecorded.v1`
 *     (docs/33 D82); los periodos cerrados nunca se evalúan.
 */
export class BudgetThresholdService {
  constructor(
    private readonly deps: BudgetsDeps,
    private readonly calculator: BudgetCalculator,
    private readonly audit: AuditPort = deps.audit,
  ) {}

  /**
   * Evalúa las líneas de una vista ya calculada (dentro de la unidad de trabajo que tiene bloqueado el plan).
   * `onlyLineIds`: solo esas líneas (edición síncrona de una línea). Devuelve cuántos hechos emitió.
   */
  async evaluateView(view: BudgetView, onlyLineIds?: ReadonlySet<string>): Promise<number> {
    const { deps } = this;
    if (view.period.status === 'CLOSED') return 0;
    let emitted = 0;
    for (const lv of view.lines) {
      const line = lv.line;
      if (onlyLineIds && !onlyLineIds.has(line.id)) continue;
      const s = line.snapshot;
      if (line.nature !== 'EXPENSE' || !THRESHOLD_KINDS.includes(line.kind) || s.thresholds.length === 0)
        continue;
      const evaluation = ThresholdEvaluator.evaluate({
        thresholds: s.thresholds,
        alreadyCrossed: lv.crossedThresholds,
        actual: lv.progress.actual.toFixed(),
        reference: lv.progress.reference.toFixed(),
      });
      if (!evaluation) continue;
      const eventId = deps.ids.next();
      const crossedAt = deps.clock.now().toString();
      const currency = view.currency.code;
      const rows: ThresholdCrossingRow[] = evaluation.newlyCrossed.map((threshold) => ({
        workspaceId: view.budget.workspaceId,
        periodId: view.period.id,
        targetKind: line.target.kind,
        targetId: line.target.id,
        threshold,
        budgetId: view.budget.id,
        budgetLineId: line.id,
        reference: lv.progress.reference.toFixed(),
        actual: lv.progress.actual.toFixed(),
        currency,
        crossedAt,
        eventId,
      }));
      const inserted = await deps.crossings.insertIfAbsent(rows);
      if (inserted.length === 0) continue; // otro proceso ya lo registró y lo emitió
      const sorted = [...inserted].sort((a, b) => Number(a) - Number(b));
      const highest = sorted[sorted.length - 1] as string;
      const payload: BudgetThresholdReachedV1 = {
        budgetId: view.budget.id,
        budgetLineId: line.id,
        periodId: view.period.id,
        periodLabel: view.period.label,
        periodStart: view.period.snapshot.periodStart,
        periodEnd: view.period.snapshot.periodEnd,
        target: line.target,
        threshold: highest,
        alsoCrossed: sorted.slice(0, -1),
        reference: lv.progress.reference.toJSON(),
        actual: lv.progress.actual.toJSON(),
        utilization: lv.progress.utilization ?? '0.0',
        actualComplete: lv.actualComplete,
        crossedAt,
      };
      // El outbox exige una versión de agregado distinta por evento (un plan puede emitir varios hechos de umbral): cada
      // hecho sube la versión del plan, que viaja en el envelope como `aggregateVersion`.
      view.budget.touch();
      if (!(await deps.budgets.save(view.budget))) {
        throw new Error(`budget ${view.budget.id} changed concurrently while publishing a threshold`);
      }
      view.budget.markPersisted();
      await deps.outbox.append({
        eventId,
        eventType: BUDGET_THRESHOLD_REACHED.eventType,
        eventVersion: BUDGET_THRESHOLD_REACHED.eventVersion,
        occurredAt: crossedAt,
        workspaceId: view.budget.workspaceId,
        aggregateType: AGGREGATE,
        aggregateId: view.budget.id,
        aggregateVersion: view.budget.version,
        payload,
      });
      // Auditoría síncrona del hecho (INV-029): el historial del plan muestra cuándo y con cuánto se cruzó cada umbral.
      await this.audit.append({
        workspaceId: view.budget.workspaceId,
        action: 'planning.budget.threshold_reached',
        aggregateType: AGGREGATE,
        aggregateId: view.budget.id,
        aggregateVersion: view.budget.version,
        changes: [
          { field: 'line', before: null, after: line.id },
          { field: 'target', before: null, after: `${line.target.kind}:${line.target.id}` },
          { field: 'threshold', before: null, after: highest },
          { field: 'alsoCrossed', before: null, after: JSON.stringify(payload.alsoCrossed) },
          { field: 'reference', before: null, after: lv.progress.reference.toJSON() },
          { field: 'actual', before: null, after: lv.progress.actual.toJSON() },
          { field: 'utilization', before: null, after: payload.utilization },
        ],
      });
      emitted += 1;
    }
    return emitted;
  }

  /**
   * Consumidor `planning.budget-thresholds` (decisión 9a): reevalúa TODOS los planes de periodos no cerrados del
   * workspace (borrador, activo, reabierto; normalmente <= 3), con el plan bloqueado `FOR UPDATE` para serializar
   * evaluaciones concurrentes. Reentregas y workers en paralelo producen un único cruce y un único hecho.
   */
  async evaluateWorkspace(workspaceId: string): Promise<number> {
    const { deps } = this;
    return deps.uow.run(workspaceId, async () => {
      const open = await deps.periods.list(workspaceId, ['DRAFT', 'ACTIVE', 'REOPENED']);
      if (open.length === 0) return 0;
      const budgets = await deps.budgets.listByPeriods(
        workspaceId,
        open.map((p) => p.id),
      );
      let emitted = 0;
      for (const listed of budgets) {
        const budget = await deps.budgets.findById(workspaceId, listed.id, { lock: 'update' });
        const period = open.find((p) => p.id === listed.periodId);
        if (!budget || !period) continue;
        const view = await this.calculator.view({ workspaceId, budget, period, now: deps.clock.now() });
        emitted += await this.evaluateView(view);
      }
      return emitted;
    });
  }
}
