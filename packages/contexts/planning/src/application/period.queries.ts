import { DomainError, LocalDate } from '@pf/shared-kernel';
import type {
  FinancialPeriodDto,
  FinancialPeriodStatusDto,
  PeriodQuery,
  PlanningEditGuard,
} from '../contracts/index.js';
import { parseDate } from './periods.service.js';
import { toPeriodDto } from './period-view.js';
import type { PlanningDeps } from './ports/index.js';

/**
 * Consultas de periodos (`GetPeriod`, `ListPeriods`, `GetPeriodContaining`, `getPrevious`; tarea 3.4) y guard de
 * planificación (decisión 10). Sin efectos; cada consulta corre en la unidad de trabajo en curso (o abre una) con el RLS
 * del workspace. `pendingClosure` usa hoy en la zona horaria del workspace.
 */
export class PeriodQueries implements PeriodQuery, PlanningEditGuard {
  constructor(private readonly deps: Pick<PlanningDeps, 'uow' | 'periods' | 'calendar' | 'clock'>) {}

  async getPeriod(input: {
    readonly workspaceId: string;
    readonly periodId: string;
  }): Promise<FinancialPeriodDto | null> {
    const today = await this.today(input.workspaceId);
    return this.deps.uow.run(input.workspaceId, async () => {
      const p = await this.deps.periods.findById(input.workspaceId, input.periodId);
      return p ? toPeriodDto(p, today) : null;
    });
  }

  async getPeriodContaining(input: {
    readonly workspaceId: string;
    readonly date: string;
  }): Promise<FinancialPeriodDto | null> {
    const date = parseDate(input.date, '/containsDate').toString();
    const today = await this.today(input.workspaceId);
    return this.deps.uow.run(input.workspaceId, async () => {
      const p = await this.deps.periods.findContaining(input.workspaceId, date);
      return p ? toPeriodDto(p, today) : null;
    });
  }

  async listPeriods(input: {
    readonly workspaceId: string;
    readonly statuses?: readonly FinancialPeriodStatusDto[];
  }): Promise<readonly FinancialPeriodDto[]> {
    const today = await this.today(input.workspaceId);
    return this.deps.uow.run(input.workspaceId, async () =>
      (await this.deps.periods.list(input.workspaceId, input.statuses)).map((p) => toPeriodDto(p, today)),
    );
  }

  async getPrevious(input: {
    readonly workspaceId: string;
    readonly periodId: string;
  }): Promise<FinancialPeriodDto | null> {
    const today = await this.today(input.workspaceId);
    return this.deps.uow.run(input.workspaceId, async () => {
      const all = await this.deps.periods.list(input.workspaceId);
      const i = all.findIndex((p) => p.id === input.periodId);
      const previous = i > 0 ? all[i - 1] : undefined;
      return previous ? toPeriodDto(previous, today) : null;
    });
  }

  /** `PlanningEditGuard` (decisión 10): `FOR SHARE` sobre el periodo en la unidad de trabajo del llamador. */
  assertPlanEditable(input: { readonly workspaceId: string; readonly periodId: string }): Promise<void> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const p = await this.deps.periods.findById(input.workspaceId, input.periodId, { lock: 'share' });
      if (!p) throw new DomainError('REFERENCE_NOT_FOUND', `financial period ${input.periodId} not found`);
      if (p.status === 'CLOSED') {
        throw new DomainError(
          'PERIOD_CLOSED',
          `financial period ${p.label} is closed: its plan is read-only`,
        );
      }
    });
  }

  /** `GET …/periods/{id}` (404 `RESOURCE_NOT_FOUND`, idéntico a inexistente si es de otro workspace). */
  async period(workspaceId: string, periodId: string): Promise<FinancialPeriodDto> {
    const p = await this.getPeriod({ workspaceId, periodId });
    if (!p) throw new DomainError('RESOURCE_NOT_FOUND', `financial period ${periodId} not found`);
    return p;
  }

  /** `GET …/periods?containsDate=` (404 `RESOURCE_NOT_FOUND` si ningún periodo cubre la fecha). */
  async periodContaining(workspaceId: string, date: string): Promise<FinancialPeriodDto> {
    const p = await this.getPeriodContaining({ workspaceId, date });
    if (!p) throw new DomainError('RESOURCE_NOT_FOUND', `no financial period contains ${date}`);
    return p;
  }

  private async today(workspaceId: string): Promise<LocalDate> {
    const { timeZone } = await this.deps.calendar.calendarOf(workspaceId);
    return LocalDate.ofInstant(this.deps.clock.now(), timeZone);
  }
}
