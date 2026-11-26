import type { AuditEntry, AuditPort } from '@pf/audit/contracts';
import { FixedClock, Instant, type FlowRateResolverInput, type FlowResolvedRate } from '@pf/shared-kernel';
import {
  DEFAULT_ANOMALY_THRESHOLDS,
  SpendingAnomaly,
  type SpendingAnomalyStatus,
} from '../../domain/index.js';
import type {
  AnomalyDeps,
  AnomalyMaintenancePort,
  AnomalyRepository,
  AnomalyScanRepository,
  ExpenseLineInput,
  ListAnomaliesFilter,
  SpendingAnomaliesPassFact,
} from '../anomaly-ports.js';

/** Gastos atípicos en memoria: misma semántica que el repositorio PG (unicidad por transacción y versión). */
export class InMemoryAnomalies implements AnomalyRepository {
  readonly rows = new Map<string, SpendingAnomaly>();

  async insert(anomaly: SpendingAnomaly): Promise<boolean> {
    const s = anomaly.snapshot;
    const dup = [...this.rows.values()].some(
      (r) =>
        r.workspaceId === s.workspaceId &&
        r.snapshot.transactionId === s.transactionId &&
        r.snapshot.transactionVersion === s.transactionVersion,
    );
    if (dup) return false;
    this.rows.set(anomaly.id, SpendingAnomaly.restore(s));
    return true;
  }

  async findById(workspaceId: string, id: string): Promise<SpendingAnomaly | null> {
    const r = this.rows.get(id);
    return r && r.workspaceId === workspaceId ? SpendingAnomaly.restore(r.snapshot) : null;
  }

  async save(anomaly: SpendingAnomaly, expectedVersion: number): Promise<boolean> {
    const current = this.rows.get(anomaly.id);
    if (!current || current.version !== expectedVersion) return false;
    this.rows.set(anomaly.id, SpendingAnomaly.restore(anomaly.snapshot));
    return true;
  }

  async supersedeOlder(workspaceId: string, transactionId: string, currentVersion: number): Promise<number> {
    let n = 0;
    for (const [id, r] of this.rows) {
      const s = r.snapshot;
      if (
        r.workspaceId === workspaceId &&
        s.transactionId === transactionId &&
        s.transactionVersion < currentVersion &&
        s.status !== 'SUPERSEDED'
      ) {
        this.rows.set(id, SpendingAnomaly.restore({ ...s, status: 'SUPERSEDED' }));
        n += 1;
      }
    }
    return n;
  }

  async list(workspaceId: string, filter: ListAnomaliesFilter): Promise<readonly SpendingAnomaly[]> {
    return [...this.rows.values()]
      .filter((r) => r.workspaceId === workspaceId)
      .filter((r) =>
        filter.status === 'ALL' ? r.snapshot.status !== 'SUPERSEDED' : r.snapshot.status === filter.status,
      )
      .filter((r) => !filter.from || r.snapshot.transactionDate >= filter.from)
      .filter((r) => !filter.to || r.snapshot.transactionDate <= filter.to)
      .sort((a, b) =>
        a.snapshot.transactionDate === b.snapshot.transactionDate
          ? b.id.localeCompare(a.id)
          : b.snapshot.transactionDate.localeCompare(a.snapshot.transactionDate),
      )
      .filter(
        (r) =>
          !filter.cursor ||
          r.snapshot.transactionDate < filter.cursor.date ||
          (r.snapshot.transactionDate === filter.cursor.date && r.id < filter.cursor.id),
      )
      .slice(0, filter.limit + 1)
      .map((r) => SpendingAnomaly.restore(r.snapshot));
  }

  async byTransactionIds(
    workspaceId: string,
    transactionIds: readonly string[],
  ): Promise<readonly SpendingAnomaly[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.workspaceId === workspaceId &&
          r.snapshot.status !== 'SUPERSEDED' &&
          transactionIds.includes(r.snapshot.transactionId),
      )
      .map((r) => SpendingAnomaly.restore(r.snapshot));
  }

  async countByStatus(workspaceId: string, status: SpendingAnomalyStatus): Promise<number> {
    return [...this.rows.values()].filter(
      (r) => r.workspaceId === workspaceId && r.snapshot.status === status,
    ).length;
  }
}

export class InMemoryScans implements AnomalyScanRepository {
  readonly rows = new Map<string, { workspaceId: string; at: string }>();

  async evaluated(workspaceId: string, sinceIso: string): Promise<ReadonlySet<string>> {
    return new Set(
      [...this.rows.entries()]
        .filter(([, v]) => v.workspaceId === workspaceId && Date.parse(v.at) >= Date.parse(sinceIso))
        .map(([k]) => k),
    );
  }

  async record(
    workspaceId: string,
    rows: readonly { transactionId: string; version: number }[],
    atIso: string,
  ): Promise<void> {
    for (const r of rows) this.rows.set(`${r.transactionId}:${r.version}`, { workspaceId, at: atIso });
  }
}

export class InMemoryAnomalyMaintenance implements AnomalyMaintenancePort {
  constructor(
    private readonly anomalies: InMemoryAnomalies,
    private readonly scans: InMemoryScans,
  ) {}

  async purgeCandidates(input: {
    transactionBefore: string;
    scanBeforeIso: string;
  }): Promise<readonly string[]> {
    const ids = new Set<string>();
    for (const r of this.anomalies.rows.values())
      if (r.snapshot.transactionDate < input.transactionBefore) ids.add(r.workspaceId);
    for (const v of this.scans.rows.values())
      if (Date.parse(v.at) < Date.parse(input.scanBeforeIso)) ids.add(v.workspaceId);
    return [...ids];
  }

  async purge(workspaceId: string, input: { transactionBefore: string; scanBeforeIso: string }) {
    let anomalies = 0;
    let scans = 0;
    for (const [id, r] of this.anomalies.rows)
      if (r.workspaceId === workspaceId && r.snapshot.transactionDate < input.transactionBefore) {
        this.anomalies.rows.delete(id);
        anomalies += 1;
      }
    for (const [k, v] of this.scans.rows)
      if (v.workspaceId === workspaceId && Date.parse(v.at) < Date.parse(input.scanBeforeIso)) {
        this.scans.rows.delete(k);
        scans += 1;
      }
    return { anomalies, scans };
  }
}

export interface AnomalyWorld {
  readonly deps: AnomalyDeps;
  readonly clock: FixedClock;
  readonly anomalies: InMemoryAnomalies;
  readonly scans: InMemoryScans;
  readonly audits: AuditEntry[];
  readonly facts: SpendingAnomaliesPassFact[];
  readonly metrics: {
    evaluated: number;
    notRated: number;
    flagged: Record<string, number>;
    decided: string[];
    passes: number;
  };
  lines: ExpenseLineInput[];
  linkedTransactions: Set<string>;
  /** Estado y versión actuales por transacción (por omisión, `POSTED` con la versión de su primera línea). */
  states: Map<string, { version: number; status: string }>;
  categories: { categoryId: string; uncategorized: boolean }[];
  workspaces: string[];
  /** Tasas USD/BOB por fecha (`undefined` = sin tasa). Por omisión 6.96 para USD y nada para las demás. */
  usdRate: string | undefined;
}

export interface LineSpec {
  readonly id: string;
  readonly date: string;
  readonly amount: string;
  readonly currency?: string;
  readonly categoryId?: string;
  readonly counterpartyId?: string | null;
  readonly version?: number;
  readonly splitIndex?: number;
}

export const line = (spec: LineSpec): ExpenseLineInput => ({
  transactionId: spec.id,
  version: spec.version ?? 1,
  date: spec.date,
  counterpartyId: spec.counterpartyId ?? null,
  categoryId: spec.categoryId ?? 'cat-restaurantes',
  splitIndex: spec.splitIndex ?? 0,
  amount: { amount: spec.amount, currency: spec.currency ?? 'BOB' },
});

/** Historia de «Restaurantes» de TC-FORECAST-ANOMALY-001: 12 gastos con mediana 80.00 y MAD 7.50 (todos antes del 2026-11-01). */
export function restaurantHistory(
  options: { categoryId?: string; counterpartyId?: string | null; prefix?: string } = {},
): ExpenseLineInput[] {
  const amounts = [
    '60.00',
    '65.00',
    '70.00',
    '75.00',
    '78.00',
    '80.00',
    '80.00',
    '82.00',
    '85.00',
    '90.00',
    '95.00',
    '100.00',
  ];
  return amounts.map((amount, i) =>
    line({
      id: `${options.prefix ?? 'h'}-${i + 1}`,
      date: `2026-0${(i % 9) + 1}-1${(i % 8) + 1}`,
      amount,
      categoryId: options.categoryId ?? 'cat-restaurantes',
      counterpartyId: options.counterpartyId ?? null,
    }),
  );
}

export function buildAnomalyWorld(
  now = '2026-11-13T09:15:00.000Z',
  overrides: Partial<AnomalyDeps['settings']> = {},
): AnomalyWorld {
  const clock = new FixedClock(Instant.parse(now));
  const anomalies = new InMemoryAnomalies();
  const scans = new InMemoryScans();
  const audits: AuditEntry[] = [];
  const facts: SpendingAnomaliesPassFact[] = [];
  const metrics = {
    evaluated: 0,
    notRated: 0,
    flagged: {} as Record<string, number>,
    decided: [] as string[],
    passes: 0,
  };
  let n = 0;
  const world: AnomalyWorld = {
    clock,
    anomalies,
    scans,
    audits,
    facts,
    metrics,
    lines: [],
    linkedTransactions: new Set(),
    states: new Map(),
    categories: [
      { categoryId: 'cat-restaurantes', uncategorized: false },
      { categoryId: 'cat-sin-categoria', uncategorized: true },
    ],
    workspaces: ['w1'],
    usdRate: '6.96',
    deps: undefined as never,
  };
  const deps: AnomalyDeps = {
    uow: { run: (_ws, fn) => fn() },
    workspaces: { list: async () => world.workspaces.map((workspaceId) => ({ workspaceId })) },
    settingsOf: {
      settingsOf: async () => ({
        timeZone: 'America/La_Paz',
        startDay: 1,
        reportingCurrency: 'BOB',
        reportingScale: 2,
      }),
    },
    categories: {
      catalog: async () => ({
        groups: [],
        categories: world.categories.map((c) => ({
          categoryId: c.categoryId,
          groupId: 'g',
          name: c.categoryId,
          uncategorized: c.uncategorized,
        })),
      }),
    },
    rates: {
      resolve: async (_ws: string, input: FlowRateResolverInput) =>
        input.requests.map((r): FlowResolvedRate<unknown> | null =>
          r.base === 'USD' && world.usdRate !== undefined
            ? { exact: { base: 'USD', quote: 'BOB', value: world.usdRate }, resolved: { rate: 'USD' } }
            : null,
        ),
    },
    expenses: {
      listExpenseLines: async (_ws, from, to) => world.lines.filter((l) => l.date >= from && l.date <= to),
    },
    resolved: { transactionIds: async () => world.linkedTransactions },
    transactions: {
      statesOf: async (_ws, ids) =>
        ids.flatMap((id) => {
          const state =
            world.states.get(id) ??
            (world.lines.find((l) => l.transactionId === id)
              ? { version: world.lines.find((l) => l.transactionId === id)?.version ?? 1, status: 'POSTED' }
              : undefined);
          return state ? [{ transactionId: id, ...state }] : [];
        }),
    },
    anomalies,
    scans,
    maintenance: new InMemoryAnomalyMaintenance(anomalies, scans),
    notifier: {
      async notify(fact) {
        facts.push(fact);
      },
    },
    audit: {
      append: async (entry: AuditEntry) => {
        audits.push(entry);
      },
    } as unknown as AuditPort,
    ids: { next: () => `id-${(n += 1)}` },
    clock,
    settings: {
      enabled: true,
      lookbackDays: 7,
      thresholds: DEFAULT_ANOMALY_THRESHOLDS,
      rateValidityWindowDays: 7,
      ...overrides,
    },
    metrics: {
      evaluated: (c) => void (metrics.evaluated += c),
      notRated: (c) => void (metrics.notRated += c),
      flagged: (reason, c) => void (metrics.flagged[reason] = (metrics.flagged[reason] ?? 0) + c),
      decided: (d) => void metrics.decided.push(d),
      passDuration: () => void (metrics.passes += 1),
    },
  };
  return Object.assign(world, { deps });
}
