import type { BudgetOverrunNoticeRepository, BudgetRiskNotifierPort } from './ports/budget-risk.js';
import type { BudgetRiskSource, ShortfallWorkspacesPort } from './ports/index.js';

export interface BudgetRiskWatchSummary {
  /** Workspaces evaluados sin error. */
  readonly workspaces: number;
  /** Avisos nuevos (una línea por periodo, la primera vez que pasa a «probable»). */
  readonly notified: number;
  readonly failed: number;
  /** Solo el nombre del error (nunca datos del workspace). */
  readonly errors: readonly string[];
  readonly durationMs: number;
}

interface BudgetRiskUnitOfWork {
  run<T>(
    ctx: { readonly userId: string | null; readonly workspaceId: string },
    fn: () => Promise<T>,
  ): Promise<T>;
}

export interface BudgetRiskWatchDeps {
  readonly uow: BudgetRiskUnitOfWork;
  readonly workspaces: ShortfallWorkspacesPort;
  readonly source: BudgetRiskSource;
  readonly notices: BudgetOverrunNoticeRepository;
  readonly notifier: BudgetRiskNotifierPort;
  readonly clock: { now(): { toString(): string } };
  readonly enabled: boolean;
}

/**
 * `EvaluateBudgetRiskNotices` (paso de `reporting.cash-flow-watch` después del flujo de caja; openspec
 * add-budget-overrun-risk, decisión 7; D484): por workspace, UNO a UNO y en su unidad de trabajo con RLS, calcula el riesgo
 * del periodo en curso y, por cada línea «probable» (nunca «excedida» ni «posible») que aún no se avisó, inserta el
 * registro `reporting.budget_overrun_notice` (idempotente por línea y periodo) y entrega la notificación en la misma
 * transacción: o se confirma junto o se revierte y la pasada siguiente reintenta. Bajar y volver a subir no avisa otra
 * vez. Dato derivado: sin auditoría ni eventos. Nunca consultas en paralelo sobre el mismo cliente.
 */
export class EvaluateBudgetRiskNotices {
  constructor(private readonly deps: BudgetRiskWatchDeps) {}

  async run(): Promise<BudgetRiskWatchSummary> {
    const started = Date.now();
    let workspaces = 0;
    let notified = 0;
    const errors: string[] = [];
    if (this.deps.enabled) {
      for (const target of await this.deps.workspaces.list()) {
        try {
          notified += await this.evaluateWorkspace(target);
          workspaces += 1;
        } catch (err) {
          const code = (err as { code?: unknown }).code;
          errors.push(
            err instanceof Error ? (typeof code === 'string' ? `${err.name}:${code}` : err.name) : typeof err,
          );
        }
      }
    }
    return { workspaces, notified, failed: errors.length, errors, durationMs: Date.now() - started };
  }

  evaluateWorkspace(target: {
    readonly workspaceId: string;
    readonly timeZone: string;
    readonly baseCurrency: string;
  }): Promise<number> {
    const { deps } = this;
    const { workspaceId } = target;
    return deps.uow.run({ userId: null, workspaceId }, async () => {
      const evaluation = await deps.source.evaluateCurrent({ workspaceId, timeZone: target.timeZone });
      if (!evaluation || evaluation.dto.status !== 'AVAILABLE' || evaluation.dto.budgetId === null) return 0;
      const { dto, periodLabel } = evaluation;
      const nowIso = deps.clock.now().toString();
      let notified = 0;
      for (const line of dto.lines) {
        if (line.level !== 'LIKELY' || !line.projected || !line.basis) continue;
        const inserted = await deps.notices.insertIfAbsent({
          workspaceId,
          periodId: dto.periodId,
          budgetLineId: line.budgetLineId,
          level: 'LIKELY',
          estimatedDate: line.estimatedDate,
          notifiedAt: nowIso,
        });
        if (!inserted) continue;
        await deps.notifier.notify({
          workspaceId,
          periodId: dto.periodId,
          periodLabel,
          budgetId: dto.budgetId as string,
          budgetLineId: line.budgetLineId,
          target: { kind: line.target.kind, id: line.target.id, name: line.targetName },
          projected: line.projected,
          reference: line.reference,
          estimatedDate: line.estimatedDate,
          basis: line.basis,
          detectedAt: nowIso,
          timeZone: target.timeZone,
        });
        notified += 1;
      }
      return notified;
    });
  }
}
