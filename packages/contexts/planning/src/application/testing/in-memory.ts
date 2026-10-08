import type { AuditEntry, AuditPort, LifecyclePort, LifecycleStepInput } from '@pf/audit/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type { LedgerActivityRangeQuery } from '@pf/ledger/contracts';
import { DomainError, FixedClock, Instant } from '@pf/shared-kernel';
import type { FinancialPeriodDto, PeriodCreatedHook } from '../../contracts/index.js';
import {
  FinancialPeriod,
  PeriodCalendar,
  type FinancialPeriodState,
  type FinancialPeriodStatus,
} from '../../domain/index.js';
import type { FinancialPeriodRepository, OutboxPort, PlanningDeps, UnitOfWork } from '../ports/index.js';

type Event = Parameters<OutboxPort['append']>[0];

/**
 * Dobles en memoria para los tests de aplicación de PLANNING. La "transacción" se simula con snapshots: si el caso de
 * uso lanza, se restauran periodos, eventos, auditoría, pasos del recorrido y registros del participante (atomicidad
 * de la unidad de trabajo, INV-029). El repositorio reproduce las barreras de BD (etiqueta única, sin solapes, rango
 * congelado fuera de DRAFT).
 */
export class InMemoryPlanning {
  readonly rows = new Map<string, FinancialPeriodState>();
  readonly events: Event[] = [];
  readonly audits: AuditEntry[] = [];
  readonly lifecycleSteps: (LifecycleStepInput & { aggregateId: string; action: string })[] = [];
  /** Periodos recibidos por el participante de prueba del hook (con la "transacción" en la que llegaron). */
  readonly hookCalls: { label: string; inTransaction: boolean }[] = [];
  failHook = false;
  readonly clock = new FixedClock(Instant.parse('2026-10-05T14:00:00Z'));
  readonly calendars = new Map<string, { timeZone: string; fiscalMonthStartDay: number }>();
  readonly activityRanges = new Map<string, { minEntryDate: string; maxEntryDate: string }>();
  private seq = 0;
  private inTx = false;
  locks = 0;

  workspace(workspaceId: string, timeZone = 'America/La_Paz', fiscalMonthStartDay = 1): void {
    this.calendars.set(workspaceId, { timeZone, fiscalMonthStartDay });
  }

  /** Registra asientos con esas fechas (rango de actividad del ledger). */
  entries(workspaceId: string, ...dates: string[]): void {
    const current = this.activityRanges.get(workspaceId);
    const all = [...dates, ...(current ? [current.minEntryDate, current.maxEntryDate] : [])].sort();
    this.activityRanges.set(workspaceId, { minEntryDate: all[0]!, maxEntryDate: all.at(-1)! });
  }

  readonly uow: UnitOfWork = {
    run: async (_workspaceId, fn) => {
      if (this.inTx) return fn();
      const snapshot = {
        rows: new Map(this.rows),
        events: this.events.length,
        audits: this.audits.length,
        steps: this.lifecycleSteps.length,
        hooks: this.hookCalls.length,
      };
      this.inTx = true;
      try {
        return await fn();
      } catch (err) {
        this.rows.clear();
        for (const [k, v] of snapshot.rows) this.rows.set(k, v);
        this.events.length = snapshot.events;
        this.audits.length = snapshot.audits;
        this.lifecycleSteps.length = snapshot.steps;
        this.hookCalls.length = snapshot.hooks;
        throw err;
      } finally {
        this.inTx = false;
      }
    },
  };

  private sorted(workspaceId: string): FinancialPeriodState[] {
    return [...this.rows.values()]
      .filter((r) => r.workspaceId === workspaceId)
      .sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
  }

  readonly repository: FinancialPeriodRepository = {
    lockWorkspace: async () => {
      this.locks += 1;
    },
    list: async (workspaceId, statuses) =>
      this.sorted(workspaceId)
        .filter((r) => !statuses || statuses.includes(r.status))
        .map((r) => FinancialPeriod.restore(r)),
    findById: async (workspaceId, id) => {
      const row = this.rows.get(id);
      return row && row.workspaceId === workspaceId ? FinancialPeriod.restore(row) : null;
    },
    findContaining: async (workspaceId, date) => {
      const row = this.sorted(workspaceId).find((r) => r.periodStart <= date && date <= r.periodEnd);
      return row ? FinancialPeriod.restore(row) : null;
    },
    coveredRange: async (workspaceId) => {
      const all = this.sorted(workspaceId);
      return all.length ? { start: all[0]!.periodStart, end: all.at(-1)!.periodEnd } : null;
    },
    insertIfAbsent: async (period) => {
      const s = period.snapshot;
      const all = this.sorted(s.workspaceId);
      if (all.some((r) => r.label === s.label)) return false;
      if (all.some((r) => r.periodStart <= s.periodEnd && s.periodStart <= r.periodEnd)) {
        throw new Error('financial_period_no_overlap (23P01)');
      }
      this.rows.set(s.id, s);
      return true;
    },
    update: async (period) => {
      const current = this.rows.get(period.id);
      if (!current || current.version !== period.persistedVersion) return false;
      const next = period.snapshot;
      if (
        current.status !== 'DRAFT' &&
        (current.periodStart !== next.periodStart || current.periodEnd !== next.periodEnd)
      ) {
        throw new Error('financial_period_range_frozen (23514)');
      }
      this.rows.set(period.id, next);
      return true;
    },
  };

  readonly audit: AuditPort = { append: async (e) => void this.audits.push(e) };

  readonly lifecycle: LifecyclePort = {
    record: async (entry, steps) => {
      await this.audit.append(entry);
      for (const step of steps)
        this.lifecycleSteps.push({
          ...step,
          aggregateId: step.aggregateId ?? entry.aggregateId,
          action: entry.action,
        });
    },
  };

  readonly calendar: WorkspaceCalendarQuery = {
    calendarOf: async (workspaceId) => {
      const c = this.calendars.get(workspaceId);
      if (!c) throw new DomainError('RESOURCE_NOT_FOUND', `workspace ${workspaceId} not found`);
      return c;
    },
  };

  readonly activity: LedgerActivityRangeQuery = {
    getActivityRange: async (workspaceId) => this.activityRanges.get(workspaceId) ?? null,
  };

  readonly hook: PeriodCreatedHook = {
    onPeriodCreated: async ({ period }: { workspaceId: string; period: FinancialPeriodDto }) => {
      if (this.failHook) throw new Error(`participant failed on ${period.label}`);
      this.hookCalls.push({ label: period.label, inTransaction: this.inTx });
    },
  };

  deps(overrides: Partial<PlanningDeps> = {}): PlanningDeps {
    return {
      uow: this.uow,
      periods: this.repository,
      calendar: this.calendar,
      activity: this.activity,
      outbox: { append: async (e) => void this.events.push(e) },
      audit: this.audit,
      lifecycle: this.lifecycle,
      ids: { next: () => `00000000-0000-7000-8000-${String((this.seq += 1)).padStart(12, '0')}` },
      clock: this.clock,
      lookahead: 3,
      ...overrides,
    };
  }

  /** Siembra un periodo directo (estado arbitrario) para preparar escenarios. */
  seed(
    workspaceId: string,
    label: string,
    status: FinancialPeriodStatus,
    startDay = 1,
  ): FinancialPeriodState {
    const r = PeriodCalendar.rangeFor(label, startDay);
    const state: FinancialPeriodState = {
      id: `00000000-0000-7000-8000-${String((this.seq += 1)).padStart(12, '0')}`,
      workspaceId,
      label,
      periodStart: r.start.toString(),
      periodEnd: r.end.toString(),
      startDay,
      isTransition: false,
      status,
      closeCount: status === 'CLOSED' || status === 'REOPENED' ? 1 : 0,
      reopenCount: status === 'REOPENED' ? 1 : 0,
      latestCloseNo: status === 'CLOSED' || status === 'REOPENED' ? 1 : null,
      version: 1,
      createdAt: '2026-09-01T12:00:00.000Z',
      activatedAt: status === 'DRAFT' ? null : '2026-09-01T12:00:00.000Z',
    };
    this.rows.set(state.id, state);
    return state;
  }

  byLabel(workspaceId: string, label: string): FinancialPeriodState | undefined {
    return this.sorted(workspaceId).find((r) => r.label === label);
  }

  labels(workspaceId: string): string[] {
    return this.sorted(workspaceId).map((r) => `${r.label}:${r.status}`);
  }
}
