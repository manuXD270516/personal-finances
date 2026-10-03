import type { AuditEntry } from '@pf/audit/contracts';
import { DomainError, FixedClock, Instant, Money } from '@pf/shared-kernel';
import { CurrencyDefinition, type CurrencyKind, type ExchangeRate } from '../../domain/index.js';
import type {
  ActiveWorkspacesPort,
  AnomalyReview,
  FxDeps,
  ProviderFeedKey,
  ProviderRun,
  ProviderRunRepository,
  RatePreference,
  StoredRate,
} from '../ports/index.js';

/** Igual que `AuditPort` real: solo valores planos (string/boolean/entero/null) o `Money` (`AUDIT_INVALID_VALUE`). */
const auditable = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  typeof v === 'string' ||
  typeof v === 'boolean' ||
  (typeof v === 'number' && Number.isSafeInteger(v)) ||
  v instanceof Money ||
  (typeof v === 'object' &&
    Object.keys(v).length === 2 &&
    typeof (v as { amount?: unknown }).amount === 'string' &&
    typeof (v as { currency?: unknown }).currency === 'string');

const CATALOG: readonly [string, CurrencyKind, number][] = [
  ['BOB', 'FIAT', 2],
  ['USD', 'FIAT', 2],
  ['EUR', 'FIAT', 2],
  ['USDT', 'CRYPTO', 6],
  ['USDC', 'CRYPTO', 6],
  ['TRX', 'CRYPTO', 6],
  ['BTC', 'CRYPTO', 8],
  ['ETH', 'CRYPTO', 18],
];

/**
 * Dobles en memoria de FX. La unidad de trabajo restaura TODO el estado si el callback falla (rollback PG). El
 * historial de tasas es append-only igual que en la BD (sin update/delete) y aplica el único parcial de `supersedes_id`.
 */
export function inMemoryFxDeps(options: { readonly baseCurrency?: string; readonly timeZone?: string } = {}) {
  let seq = 0;
  const ids = { next: () => `0192f3c4-0000-7000-8000-${(++seq).toString(16).padStart(12, '0')}` };
  const state = {
    rates: [] as ExchangeRate[],
    enabled: new Map<string, Set<string>>(),
    preferences: new Map<string, { list: RatePreference[]; version: number }>(),
    outbox: [] as {
      eventType: string;
      aggregateId: string;
      workspaceId: string;
      actor?: { type: string; id: string | null };
      payload: Record<string, unknown>;
    }[],
    audit: [] as AuditEntry[],
    reviews: [] as AnomalyReview[],
    runs: [] as ProviderRun[],
    /** Workspaces activos (worker): id → zona horaria. */
    workspaces: new Map<string, string>(),
  };
  const faults: { audit?: Error } = {};
  let depth = 0;
  const snapshot = () => ({
    rates: [...state.rates],
    enabled: new Map([...state.enabled].map(([k, v]) => [k, new Set(v)])),
    preferences: new Map(state.preferences),
    outbox: [...state.outbox],
    audit: [...state.audit],
    reviews: [...state.reviews],
    runs: [...state.runs],
    workspaces: new Map(state.workspaces),
  });
  const definitions = new Map(
    CATALOG.map(([code, kind, scale]) => [
      code,
      CurrencyDefinition.of({ code, kind, name: code, scale, symbol: null, isActive: true, inUse: false }),
    ]),
  );
  const supersededBy = (id: string) => state.rates.find((r) => r.snapshot.supersedesId === id)?.id ?? null;
  const reviewOf = (id: string) => state.reviews.find((r) => r.rateId === id) ?? null;
  const stored = (rate: ExchangeRate): StoredRate => ({
    rate,
    supersededById: supersededBy(rate.id),
    anomalyReview: reviewOf(rate.id),
  });
  const ofFeed = (ws: string, feed: ProviderFeedKey) =>
    state.rates.filter(
      (r) =>
        r.snapshot.workspaceId === ws &&
        r.snapshot.provider === feed.provider &&
        r.rate.base.code === feed.base &&
        r.rate.quote.code === feed.quote &&
        r.snapshot.rateType === feed.rateType,
    );
  const byAsOfDesc = (a: ExchangeRate, b: ExchangeRate) =>
    Date.parse(b.snapshot.asOf) - Date.parse(a.snapshot.asOf) || (b.id > a.id ? 1 : -1);
  const clock = new FixedClock(Instant.parse('2026-09-30T18:42:00Z'));

  const deps: FxDeps = {
    uow: {
      async run(_ws, fn) {
        const saved = depth === 0 ? snapshot() : null;
        depth++;
        try {
          return await fn();
        } catch (err) {
          if (saved) Object.assign(state, saved);
          throw err;
        } finally {
          depth--;
        }
      },
    },
    rates: {
      async insert(rate) {
        const sup = rate.snapshot.supersedesId;
        if (sup && supersededBy(sup)) {
          throw new DomainError('FX_RATE_ALREADY_SUPERSEDED', `rate ${sup} already superseded`);
        }
        state.rates.push(rate);
      },
      async findById(ws, id) {
        const rate = state.rates.find((r) => r.id === id && (r.snapshot.workspaceId ?? ws) === ws);
        return rate ? stored(rate) : null;
      },
      async candidates(ws, currencies, from, to) {
        return state.rates
          .filter((r) => (r.snapshot.workspaceId ?? ws) === ws)
          .filter((r) => currencies.includes(r.rate.base.code) && currencies.includes(r.rate.quote.code))
          .filter((r) => {
            const t = Date.parse(r.snapshot.asOf);
            return t >= from.epochMillis && t <= to.epochMillis;
          })
          .map((r) => ({
            state: r.snapshot,
            supersededById: supersededBy(r.id),
            anomalyDecision: reviewOf(r.id)?.decision ?? null,
          }));
      },
      async list(ws, filter, page) {
        return state.rates
          .filter((r) => (r.snapshot.workspaceId ?? ws) === ws)
          .filter((r) => filter.includeSuperseded || supersededBy(r.id) === null)
          .filter((r) => !filter.base || r.rate.base.code === filter.base)
          .filter((r) => !filter.quote || r.rate.quote.code === filter.quote)
          .filter((r) => !filter.rateType || r.snapshot.rateType === filter.rateType)
          .filter((r) => !filter.source || r.snapshot.source === filter.source)
          .filter((r) => !filter.provider || r.snapshot.provider === filter.provider)
          .sort((a, b) => Date.parse(b.snapshot.asOf) - Date.parse(a.snapshot.asOf))
          .slice(page.offset, page.offset + page.limit)
          .map(stored);
      },
      async insertProviderRate(rate) {
        const s = rate.snapshot;
        const duplicate = state.rates.some(
          (r) =>
            r.snapshot.workspaceId === s.workspaceId &&
            r.snapshot.provider === s.provider &&
            r.rate.base.code === s.rate.base.code &&
            r.rate.quote.code === s.rate.quote.code &&
            r.snapshot.rateType === s.rateType &&
            r.snapshot.asOf === s.asOf,
        );
        if (duplicate) return false;
        state.rates.push(rate);
        return true;
      },
      async latestAccepted(ws, feed) {
        const accepted = ofFeed(ws, feed)
          .filter((r) => r.snapshot.anomaly === null || reviewOf(r.id)?.decision === 'CONFIRMED')
          .sort(byAsOfDesc);
        return accepted[0] ? stored(accepted[0]) : null;
      },
      async providerDays(ws, feed, from, to) {
        return new Set(
          ofFeed(ws, feed)
            .map((r) => r.snapshot.effectiveDate)
            .filter((d) => d >= from && d <= to),
        );
      },
    },
    reviews: {
      async insert(review) {
        if (reviewOf(review.rateId)) {
          throw new DomainError('FX_RATE_ANOMALY_ALREADY_REVIEWED', `rate ${review.rateId} already reviewed`);
        }
        state.reviews.push(review);
      },
    },
    currencies: {
      async list(ws, filter) {
        return [...definitions.values()]
          .filter((d) => !filter.kind || d.kind === filter.kind)
          .map((definition) => ({
            definition,
            enabled: state.enabled.get(ws)?.has(definition.code) ?? false,
          }));
      },
      async find(code) {
        return definitions.get(code) ?? null;
      },
      async enable(ws, codes) {
        const set = state.enabled.get(ws) ?? new Set<string>();
        for (const c of codes) set.add(c);
        state.enabled.set(ws, set);
      },
    },
    preferences: {
      async get(ws) {
        const p = state.preferences.get(ws);
        return { preferences: p?.list ?? [], version: p?.version ?? 1 };
      },
      async replace(ws, list, expected) {
        const current = state.preferences.get(ws)?.version ?? 1;
        if (current !== expected) return false;
        state.preferences.set(ws, { list: [...list], version: current + 1 });
        return true;
      },
      async seedDefaults(ws, list) {
        if (state.preferences.has(ws)) return;
        state.preferences.set(ws, { list: [...list], version: 1 });
      },
    },
    workspaces: {
      async settingsOf() {
        return {
          baseCurrency: options.baseCurrency ?? 'BOB',
          timeZone: options.timeZone ?? 'America/La_Paz',
        };
      },
    },
    outbox: {
      async append(event) {
        state.outbox.push({
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          workspaceId: event.workspaceId,
          ...(event.actor ? { actor: event.actor } : {}),
          payload: event.payload as Record<string, unknown>,
        });
      },
    },
    audit: {
      async append(entry) {
        if (faults.audit) throw faults.audit;
        for (const c of entry.changes ?? []) {
          if (!auditable(c.before) || !auditable(c.after)) {
            throw new Error(`AUDIT_INVALID_VALUE: ${entry.action}.${c.field}`);
          }
        }
        state.audit.push(entry);
      },
    },
    ids,
    clock,
  };
  const runs: ProviderRunRepository = {
    async record(run) {
      state.runs.push(run);
    },
    async recent(provider, limit, kinds) {
      return state.runs
        .filter((r) => r.provider === provider && (!kinds || kinds.includes(r.kind)))
        .sort((a, b) => (a.startedAt === b.startedAt ? 0 : a.startedAt < b.startedAt ? 1 : -1))
        .slice(0, limit);
    },
    async purgeBefore(before) {
      const keep = state.runs.filter((r) => r.startedAt >= before);
      const purged = state.runs.length - keep.length;
      state.runs = keep;
      return purged;
    },
  };
  const workspaces: ActiveWorkspacesPort = {
    async list() {
      return [...state.workspaces].map(([workspaceId, timeZone]) => ({ workspaceId, timeZone }));
    },
  };
  return { deps, state, faults, clock, runs, workspaces };
}
