import { DomainError } from '@pf/shared-kernel';
import { ForecastRun } from '../domain/index.js';
import type { ForecastingDeps } from './ports.js';
import { runChanges, runEntry, runSteps } from './support.js';

/**
 * `RequestForecastRun` (openspec add-ml-forecasting-service, decisión 14; FR-FORECAST-001). Solicitud manual de OWNER o
 * EDITOR (el rol lo exige el contrato de la API): con la función deshabilitada ⇒ `FORECASTING_DISABLED`; con otra corrida
 * solicitada o en curso ⇒ `FORECAST_RUN_IN_PROGRESS`. Crea la corrida `MANUAL`, la operación asíncrona `FORECAST` (mismo
 * id), la auditoría y el paso del recorrido, todo en la misma unidad de trabajo.
 */
export class RequestForecastRun {
  constructor(private readonly deps: ForecastingDeps) {}

  async execute(input: {
    readonly workspaceId: string;
    readonly userId: string;
  }): Promise<{ readonly runId: string }> {
    const { deps } = this;
    if (!deps.settings.enabled) {
      throw new DomainError('FORECASTING_DISABLED', 'forecasting is not enabled in this installation');
    }
    const { workspaceId, userId } = input;
    const at = deps.clock.now().toString();
    return deps.uow.run(workspaceId, async () => {
      const ws = await deps.settingsOf.settingsOf(workspaceId);
      const run = ForecastRun.request({
        id: deps.ids.next(),
        workspaceId,
        trigger: 'MANUAL',
        requestedBy: userId,
        at,
        reportingCurrency: ws.reportingCurrency,
      });
      // Carrera de dos solicitudes simultáneas: el índice único parcial deja una sola activa.
      if (!(await deps.runs.insertIfNoActive(run))) {
        throw new DomainError(
          'FORECAST_RUN_IN_PROGRESS',
          'the workspace already has a forecast run in progress',
        );
      }
      await deps.operations.create({ id: run.id, workspaceId, requestedBy: userId });
      await deps.lifecycle.record(runEntry(run, 'requested', runChanges(null, run.snapshot)), runSteps(run));
      return { runId: run.id };
    });
  }
}
