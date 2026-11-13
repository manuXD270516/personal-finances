import type { AuditEntry, AuditPort, LifecyclePort, LifecycleStepInput } from '@pf/audit/contracts';
import {
  FixedClock,
  Instant,
  dec,
  type FlowRateResolverInput,
  type FlowResolvedRate,
} from '@pf/shared-kernel';
import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_THRESHOLDS,
  ForecastRun,
  type CategoryInfo,
  type FlowRow,
  type InstallmentInput,
  type LoanComponentInput,
  type OccurrenceInput,
  type ResolvedInput,
  type ForecastRequestV1,
  type ForecastResponseV1,
  type ForecastRunStatus,
  type GroupInfo,
} from '../../domain/index.js';
import {
  ForecastServiceError,
  type ForecastingDeps,
  type ForecastingSettings,
  type ListRunsFilter,
  type RunMetadata,
  type StoredKnownItem,
  type MaintenancePort,
  type OperationPort,
  type OutboxPort,
  type RunRef,
  type RunRepository,
  type SeriesRepository,
  type StoredSeries,
} from '../ports.js';

/** Corridas en memoria: misma semántica que el repositorio PG (una activa por workspace, reclamo por antigüedad). */
export class InMemoryRuns implements RunRepository {
  readonly rows = new Map<string, ForecastRun>();

  async insertIfNoActive(run: ForecastRun): Promise<boolean> {
    if (await this.hasActive(run.workspaceId)) return false;
    this.rows.set(run.id, ForecastRun.restore(run.snapshot));
    return true;
  }

  async findById(workspaceId: string, id: string): Promise<ForecastRun | null> {
    const r = this.rows.get(id);
    return r && r.workspaceId === workspaceId ? ForecastRun.restore(r.snapshot) : null;
  }

  async claimNext(workspaceId: string, nowIso: string): Promise<ForecastRun | null> {
    const due = [...this.rows.values()]
      .filter(
        (r) =>
          r.workspaceId === workspaceId &&
          r.status === 'REQUESTED' &&
          Date.parse(r.snapshot.nextAttemptAt) <= Date.parse(nowIso),
      )
      .sort((a, b) => Date.parse(a.snapshot.requestedAt) - Date.parse(b.snapshot.requestedAt));
    return due[0] ? ForecastRun.restore(due[0].snapshot) : null;
  }

  async claimStalled(workspaceId: string, beforeIso: string): Promise<readonly ForecastRun[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.workspaceId === workspaceId &&
          r.status === 'RUNNING' &&
          r.snapshot.startedAt !== null &&
          Date.parse(r.snapshot.startedAt) <= Date.parse(beforeIso),
      )
      .map((r) => ForecastRun.restore(r.snapshot));
  }

  async save(run: ForecastRun, expectedVersion: number): Promise<boolean> {
    const current = this.rows.get(run.id);
    if (!current || current.version !== expectedVersion) return false;
    this.rows.set(run.id, ForecastRun.restore(run.snapshot));
    return true;
  }

  private completed(workspaceId: string): ForecastRun[] {
    return [...this.rows.values()]
      .filter((r) => r.workspaceId === workspaceId && r.status === 'COMPLETED')
      .sort((a, b) => Date.parse(b.snapshot.completedAt ?? '') - Date.parse(a.snapshot.completedAt ?? ''));
  }

  async latestCompleted(workspaceId: string): Promise<ForecastRun | null> {
    const r = this.completed(workspaceId)[0];
    return r ? ForecastRun.restore(r.snapshot) : null;
  }

  async latestAttempt(workspaceId: string): Promise<ForecastRun | null> {
    const r = [...this.rows.values()]
      .filter((x) => x.workspaceId === workspaceId)
      .sort((a, b) => Date.parse(b.snapshot.requestedAt) - Date.parse(a.snapshot.requestedAt))[0];
    return r ? ForecastRun.restore(r.snapshot) : null;
  }

  async hasActive(workspaceId: string): Promise<boolean> {
    return [...this.rows.values()].some(
      (r) => r.workspaceId === workspaceId && (r.status === 'REQUESTED' || r.status === 'RUNNING'),
    );
  }

  async list(workspaceId: string, filter: ListRunsFilter): Promise<readonly ForecastRun[]> {
    return [...this.rows.values()]
      .filter((r) => r.workspaceId === workspaceId)
      .filter((r) => !filter.statuses || filter.statuses.includes(r.status))
      .sort(
        (a, b) =>
          Date.parse(b.snapshot.requestedAt) - Date.parse(a.snapshot.requestedAt) || (a.id < b.id ? 1 : -1),
      )
      .slice(0, filter.limit)
      .map((r) => ForecastRun.restore(r.snapshot));
  }

  async lastScheduledAt(workspaceId: string): Promise<string | null> {
    const r = [...this.rows.values()]
      .filter((x) => x.workspaceId === workspaceId && x.snapshot.trigger === 'SCHEDULED')
      .sort((a, b) => Date.parse(b.snapshot.requestedAt) - Date.parse(a.snapshot.requestedAt))[0];
    return r?.snapshot.requestedAt ?? null;
  }
}

export class InMemorySeries implements SeriesRepository {
  readonly rows: StoredSeries[] = [];
  readonly metadata = new Map<string, RunMetadata>();
  async insertAll(series: readonly StoredSeries[]): Promise<void> {
    this.rows.push(...series);
  }
  async listByRun(workspaceId: string, runId: string): Promise<readonly StoredSeries[]> {
    return this.rows.filter((s) => s.workspaceId === workspaceId && s.runId === runId);
  }
  async listKnownItems(
    workspaceId: string,
    runId: string,
    series: { scope: StoredSeries['scope']; scopeRef: string | null },
    period: string,
  ): Promise<readonly StoredKnownItem[]> {
    const row = this.rows.find(
      (s) =>
        s.workspaceId === workspaceId &&
        s.runId === runId &&
        s.scope === series.scope &&
        s.scopeRef === series.scopeRef,
    );
    return (row?.knownItems ?? []).filter((k) => k.period === period);
  }
  async saveRunMetadata(_ws: string, runId: string, metadata: RunMetadata): Promise<void> {
    this.metadata.set(runId, metadata);
  }
  async runMetadata(_ws: string, runId: string): Promise<RunMetadata | null> {
    return this.metadata.get(runId) ?? null;
  }
}

export class InMemoryOperations implements OperationPort {
  readonly rows = new Map<string, { status: string; error?: unknown }>();
  async create(input: { id: string }): Promise<void> {
    this.rows.set(input.id, { status: 'PENDING' });
  }
  async update(_ws: string, id: string, patch: { status: string; error?: unknown }): Promise<void> {
    this.rows.set(id, { status: patch.status, error: patch.error });
  }
}

export class InMemoryMaintenance implements MaintenancePort {
  constructor(private readonly runs: InMemoryRuns) {}

  async dueRuns(nowIso: string, stalledBeforeIso: string, limit: number): Promise<readonly RunRef[]> {
    const refs: { ref: RunRef; at: number }[] = [];
    for (const r of this.runs.rows.values()) {
      const s = r.snapshot;
      if (s.status === 'REQUESTED' && Date.parse(s.nextAttemptAt) <= Date.parse(nowIso)) {
        refs.push({ ref: { workspaceId: r.workspaceId, runId: r.id }, at: Date.parse(s.requestedAt) });
      } else if (
        s.status === 'RUNNING' &&
        s.startedAt &&
        Date.parse(s.startedAt) <= Date.parse(stalledBeforeIso)
      ) {
        refs.push({ ref: { workspaceId: r.workspaceId, runId: r.id }, at: Date.parse(s.startedAt) });
      }
    }
    return refs
      .sort((a, b) => a.at - b.at)
      .slice(0, limit)
      .map((x) => x.ref);
  }

  async purgeCandidates(input: { supersededBeforeIso: string; failedBeforeIso: string }) {
    const out: {
      workspaceId: string;
      runId: string;
      status: ForecastRunStatus;
      completedAt: string | null;
      requestedAt: string;
    }[] = [];
    for (const r of this.runs.rows.values()) {
      const s = r.snapshot;
      const at = Date.parse(s.completedAt ?? s.requestedAt);
      const old =
        (s.status === 'SUPERSEDED' && at < Date.parse(input.supersededBeforeIso)) ||
        ((s.status === 'FAILED' || s.status === 'INSUFFICIENT_DATA') &&
          at < Date.parse(input.failedBeforeIso));
      if (old) {
        out.push({
          workspaceId: r.workspaceId,
          runId: r.id,
          status: s.status,
          completedAt: s.completedAt,
          requestedAt: s.requestedAt,
        });
      }
    }
    return out;
  }

  async deleteRuns(_workspaceId: string, runIds: readonly string[]): Promise<number> {
    let n = 0;
    for (const id of runIds) if (this.runs.rows.delete(id)) n += 1;
    return n;
  }
}

export interface Recorded {
  readonly entry: AuditEntry;
  readonly steps: readonly LifecycleStepInput[];
}

export interface ScriptedService {
  /** Cada llamada consume un paso: `Error` ⇒ falla; una función arma la respuesta con la petición recibida. */
  steps: (Error | ((req: ForecastRequestV1) => ForecastResponseV1))[];
  readonly requests: ForecastRequestV1[];
  forecast(request: ForecastRequestV1): Promise<ForecastResponseV1>;
}

/** Servicio de pronósticos con respuestas guiadas: por omisión devuelve un pronóstico válido para cada serie pedida. */
export function scriptedService(): ScriptedService {
  const svc: ScriptedService = {
    steps: [],
    requests: [],
    async forecast(request) {
      svc.requests.push(request);
      const step = svc.steps.shift();
      if (step instanceof Error) throw step;
      return (step ?? okResponse)(request);
    },
  };
  return svc;
}

const shiftPeriod = (period: string, months: number): string => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + months;
  return `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;
};

export const okResponse = (request: ForecastRequestV1): ForecastResponseV1 => ({
  schemaVersion: '1',
  requestId: request.requestId,
  serviceVersion: '0.1.0',
  durationMs: 5,
  results: request.series.map((s) => {
    const last = Number(dec(s.points.at(-1)?.value ?? '0').toFixed(0));
    const f = (n: number) => Math.max(n, 0).toFixed(s.scale);
    return {
      ref: s.ref,
      status: 'OK' as const,
      error: null,
      model: { name: 'mean_last_n', version: '1', selectedBy: 'fixed' },
      baseline: { method: 'MEAN_LAST_N', n: 6 },
      points: Array.from({ length: s.horizon }, (_, i) => ({
        period: shiftPeriod(s.points.at(-1)?.period ?? '2026-10', i + 1),
        monthsAhead: i + 1,
        prediction: f(last),
        lower80: f(last * 0.9),
        upper80: f(last * 1.1),
        lower95: f(last * 0.8),
        upper95: f(last * 1.2),
        baselineValue: f(last),
      })),
    };
  }),
});

export const unavailable = (): ForecastServiceError =>
  new ForecastServiceError('SERVICE_UNAVAILABLE', 'service unavailable');

export interface TestWorld {
  readonly deps: ForecastingDeps;
  readonly clock: FixedClock;
  readonly runs: InMemoryRuns;
  readonly series: InMemorySeries;
  readonly operations: InMemoryOperations;
  readonly service: ScriptedService;
  readonly records: Recorded[];
  readonly outbox: Parameters<OutboxPort['append']>[0][];
  readonly metrics: { failures: string[]; durations: string[]; insufficient: number[] };
  flows: FlowRow[];
  loanComponents: LoanComponentInput[];
  resolved: ResolvedInput[];
  occurrences: OccurrenceInput[];
  installments: InstallmentInput[];
  categories: { groups: GroupInfo[]; categories: CategoryInfo[] };
  workspaces: string[];
}

export const DEFAULT_SETTINGS: ForecastingSettings = {
  enabled: true,
  maxAgeDays: 7,
  historyMaxPeriods: 60,
  thresholds: DEFAULT_THRESHOLDS,
  retry: DEFAULT_RETRY_POLICY,
  staleDays: 35,
  rateValidityWindowDays: 7,
  coherenceGapRatio: '0.05',
};

/** Mundo de pruebas: fecha fija en America/La_Paz, dobles en memoria y mocks de los contratos de otros contextos. */
export function buildWorld(
  now = '2026-11-01T09:15:00.000Z',
  overrides: Partial<ForecastingSettings> = {},
): TestWorld {
  const clock = new FixedClock(Instant.parse(now));
  const runs = new InMemoryRuns();
  const series = new InMemorySeries();
  const operations = new InMemoryOperations();
  const service = scriptedService();
  const records: Recorded[] = [];
  const outbox: Parameters<OutboxPort['append']>[0][] = [];
  const metrics = { failures: [] as string[], durations: [] as string[], insufficient: [] as number[] };
  let n = 0;
  const world: TestWorld = {
    clock,
    runs,
    series,
    operations,
    service,
    records,
    outbox,
    metrics,
    flows: [],
    loanComponents: [],
    resolved: [],
    occurrences: [],
    installments: [],
    categories: { groups: [], categories: [] },
    workspaces: ['w1'],
    deps: undefined as never,
  };
  const lifecycle: LifecyclePort = {
    async record(entry, steps) {
      records.push({ entry, steps });
    },
  };
  const deps: ForecastingDeps = {
    uow: { run: (_ws, fn) => fn() },
    runs,
    series,
    operations,
    maintenance: new InMemoryMaintenance(runs),
    workspaces: { list: async () => world.workspaces.map((workspaceId) => ({ workspaceId })) },
    settingsOf: {
      settingsOf: async () => ({
        timeZone: 'America/La_Paz',
        startDay: 1,
        reportingCurrency: 'BOB',
        reportingScale: 2,
      }),
    },
    flows: { loadFlows: async () => world.flows, loadLoanComponents: async () => world.loanComponents },
    known: {
      listResolved: async (_ws, _from, _to, direction) =>
        world.resolved.filter((r) => (direction === 'INFLOW') === (r.kind === 'INCOME')),
      project: async () => world.occurrences,
      installments: async () => world.installments,
    },
    categories: { catalog: async () => world.categories },
    rates: {
      resolve: async (_ws: string, input: FlowRateResolverInput) =>
        input.requests.map((r): FlowResolvedRate<unknown> | null =>
          r.base === 'USD'
            ? { exact: { base: 'USD', quote: 'BOB', value: '6.96' }, resolved: { rate: 'USD' } }
            : null,
        ),
    },
    service,
    audit: { append: async () => undefined } as unknown as AuditPort,
    lifecycle,
    outbox: {
      async append(event) {
        outbox.push(event);
      },
    },
    ids: { next: () => `id-${(n += 1)}` },
    clock,
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    metrics: {
      observeDuration: (outcome) => void metrics.durations.push(outcome),
      failure: (reason) => void metrics.failures.push(reason),
      insufficient: (count) => void metrics.insufficient.push(count),
    },
  };
  return Object.assign(world, { deps });
}
