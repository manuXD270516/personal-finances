import type {
  AuditChangeInput,
  AuditEntry,
  LifecycleEventRefDto,
  LifecycleStepInput,
} from '@pf/audit/contracts';
import { FORECAST_RUN_LIFECYCLE, type ForecastRun, type ForecastRunState } from '../domain/index.js';

export const RUN_AGGREGATE = 'ForecastRun';

const FIELDS = ['trigger', 'status', 'requestedBy', 'attempts', 'failureReason', 'asOfPeriod'] as const;

/** Cambios campo a campo de la corrida (valores simples; sin montos). */
export function runChanges(before: ForecastRunState | null, after: ForecastRunState): AuditChangeInput[] {
  const out: AuditChangeInput[] = [];
  for (const f of FIELDS) {
    const b = before?.[f] ?? null;
    const a = after[f] ?? null;
    if (before === null || b !== a) out.push({ field: f, before: before === null ? null : b, after: a });
  }
  return out;
}

export function runEntry(run: ForecastRun, action: string, changes: readonly AuditChangeInput[]): AuditEntry {
  return {
    workspaceId: run.workspaceId,
    action: `forecasting.forecast_run.${action}`,
    aggregateType: RUN_AGGREGATE,
    aggregateId: run.id,
    aggregateVersion: run.version,
    changes,
  };
}

/** Paso del recorrido: la transición aplicada por el último comando. */
export function runSteps(
  run: ForecastRun,
  events: readonly LifecycleEventRefDto[] = [],
  reason?: string | null,
): LifecycleStepInput[] {
  const t = run.lastTransition;
  if (!t) return [];
  return [
    {
      kind: 'TRANSITION',
      transition: t.transition,
      fromState: t.from,
      toState: t.to,
      machineVersion: FORECAST_RUN_LIFECYCLE.version,
      events,
      ...(reason ? { reason } : {}),
    },
  ];
}
