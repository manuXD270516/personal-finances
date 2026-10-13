import type { AuditEntry, LifecycleStepInput } from '@pf/audit/contracts';
import type { NotificationIntakeFact } from '@pf/notifications/contracts';
import { DomainError, FixedClock, Instant, Money } from '@pf/shared-kernel';
import {
  CurrencyDefinition,
  DEFAULT_WORKSPACE_CURRENCIES,
  EXCHANGE_RATE_LIFECYCLE,
  RatePairList,
  type CurrencyKind,
  type ExchangeRate,
  type RatePairListState,
} from '../../domain/index.js';
import type {
  ActiveWorkspacesPort,
  AnomalyReview,
  FirstBalanceDatePort,
  FeedEpisodeClosedReason,
  FxDeps,
  HistoryClose,
  ProviderFeedKey,
  ProviderHistoryCache,
  ProviderRun,
  ProviderRunRepository,
  RateFeedEpisodeRepository,
  RatePreference,
  RateWithdrawal,
  StoredRate,
  NotificationIntakePort,
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
    /** Pasos del recorrido (doble de `LifecyclePort`). */
    lifecycle: [] as (LifecycleStepInput & { aggregateId: string; action: string })[],
    reviews: [] as AnomalyReview[],
    /** Marcas de observaciones anuladas (`fx.rate_withdrawal`, append-only). */
    withdrawals: [] as RateWithdrawal[],
    runs: [] as ProviderRun[],
    /** Workspaces activos (worker): id → zona horaria. */
    workspaces: new Map<string, string>(),
    /** Moneda base de los workspaces activos del worker (por defecto la de la composición). */
    workspaceBase: new Map<string, string>(),
    /** Listas de pares fijadas (`fx.rate_pair_list`); sin entrada = lista por defecto, versión 1. */
    pairLists: new Map<string, RatePairListState>(),
    /** Cierres diarios cripto de la instalación (`fx.provider_history_point`). */
    historyCloses: [] as HistoryClose[],
    /** Primera fecha con saldo por moneda (doble de `FirstBalanceDateQuery` de LEDGER). */
    firstBalance: new Map<string, Map<string, string>>(),
    /** Episodios de obsolescencia (`fx.rate_feed_episode`). */
    episodes: [] as {
      id: string;
      workspaceId: string;
      base: string;
      quote: string;
      openedAt: string;
      lastRateAsOf: string | null;
      closedAt: string | null;
      recoveredRateId: string | null;
      closedReason: FeedEpisodeClosedReason | null;
    }[],
    /** Hechos entregados al puerto de NOTIFY (doble de `NotificationIntakePort`). */
    notified: [] as NotificationIntakeFact[],
  };
  const faults: { audit?: Error; notify?: Error } = {};
  let depth = 0;
  const snapshot = () => ({
    rates: [...state.rates],
    enabled: new Map([...state.enabled].map(([k, v]) => [k, new Set(v)])),
    preferences: new Map(state.preferences),
    outbox: [...state.outbox],
    audit: [...state.audit],
    lifecycle: [...state.lifecycle],
    reviews: [...state.reviews],
    withdrawals: [...state.withdrawals],
    runs: [...state.runs],
    workspaces: new Map(state.workspaces),
    workspaceBase: new Map(state.workspaceBase),
    pairLists: new Map(state.pairLists),
    historyCloses: [...state.historyCloses],
    firstBalance: new Map(state.firstBalance),
    episodes: state.episodes.map((e) => ({ ...e })),
    notified: [...state.notified],
  });
  const definitions = new Map(
    CATALOG.map(([code, kind, scale]) => [
      code,
      CurrencyDefinition.of({ code, kind, name: code, scale, symbol: null, isActive: true, inUse: false }),
    ]),
  );
  const supersededBy = (id: string) => state.rates.find((r) => r.snapshot.supersedesId === id)?.id ?? null;
  const reviewOf = (id: string) => state.reviews.find((r) => r.rateId === id) ?? null;
  const withdrawalOf = (id: string) => state.withdrawals.find((w) => w.rateId === id) ?? null;
  const stored = (rate: ExchangeRate): StoredRate => ({
    rate,
    supersededById: supersededBy(rate.id),
    anomalyReview: reviewOf(rate.id),
    withdrawal: withdrawalOf(rate.id),
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
        return (
          state.rates
            .filter((r) => (r.snapshot.workspaceId ?? ws) === ws)
            // Como PgExchangeRateRepository: las observaciones de conversiones propias nunca son candidatas (D231).
            .filter((r) => r.snapshot.source !== 'USER_CONVERSION')
            .filter((r) => currencies.includes(r.rate.base.code) && currencies.includes(r.rate.quote.code))
            .filter((r) => {
              const t = Date.parse(r.snapshot.asOf);
              return t >= from.epochMillis && t <= to.epochMillis;
            })
            .map((r) => ({
              state: r.snapshot,
              supersededById: supersededBy(r.id),
              anomalyDecision: reviewOf(r.id)?.decision ?? null,
            }))
        );
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
      async insertUserConversionObservation(rate) {
        const s = rate.snapshot;
        const ref = s.conversionRef;
        if (!ref) throw new Error('an observation needs a conversionRef');
        const duplicate = state.rates.some(
          (r) =>
            r.snapshot.workspaceId === s.workspaceId &&
            r.snapshot.conversionRef?.transactionId === ref.transactionId &&
            r.snapshot.conversionRef.revision === ref.revision,
        );
        if (duplicate) return false;
        if (s.supersedesId && supersededBy(s.supersedesId)) {
          throw new DomainError('FX_RATE_ALREADY_SUPERSEDED', `rate ${s.supersedesId} already superseded`);
        }
        state.rates.push(rate);
        return true;
      },
      async currentUserConversionObservation(ws, transactionId) {
        const found = state.rates
          .filter(
            (r) =>
              r.snapshot.workspaceId === ws &&
              r.snapshot.source === 'USER_CONVERSION' &&
              r.snapshot.conversionRef?.transactionId === transactionId,
          )
          .sort(
            (a, b) => (b.snapshot.conversionRef?.revision ?? 0) - (a.snapshot.conversionRef?.revision ?? 0),
          )[0];
        return found ? stored(found) : null;
      },
      async insertWithdrawal(withdrawal) {
        if (withdrawalOf(withdrawal.rateId)) return false;
        state.withdrawals.push(withdrawal);
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
      async providerAsOfs(ws, feed, from, to) {
        return new Set(
          ofFeed(ws, feed)
            .map((r) => r.snapshot.asOf)
            .filter((a) => a >= from && a <= to),
        );
      },
    },
    pairs: {
      async get(ws) {
        return state.pairLists.get(ws) ?? RatePairList.defaults().snapshot;
      },
      async replace(ws, next, expectedVersion) {
        const current = state.pairLists.get(ws)?.version ?? 1;
        if (current !== expectedVersion) return false;
        state.pairLists.set(ws, next);
        return true;
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
            // Como PgCurrencyRepository: un workspace sin filas tiene el conjunto por defecto.
            enabled:
              state.enabled.get(ws)?.has(definition.code) ??
              (DEFAULT_WORKSPACE_CURRENCIES as readonly string[]).includes(definition.code),
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
    lifecycle: {
      async record(entry, steps) {
        await deps.audit.append(entry);
        for (const step of steps) {
          state.lifecycle.push({
            ...step,
            aggregateId: step.aggregateId ?? entry.aggregateId,
            action: entry.action,
            ...(step.kind === 'TRANSITION' ? { reason: step.reason ?? entry.reason ?? null } : {}),
          });
        }
      },
    },
    lifecycleQuery: {
      machineOf: () => EXCHANGE_RATE_LIFECYCLE.definition,
      async lifecycleOf(input) {
        const own = state.lifecycle.filter((l) => l.aggregateId === input.aggregateId);
        return {
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          currentState: input.currentState,
          path: own.flatMap((l) => (l.kind === 'TRANSITION' ? [l.toState] : [])),
          historyComplete: own.find((l) => l.kind === 'TRANSITION')?.fromState === null,
          machine: EXCHANGE_RATE_LIFECYCLE.definition,
          items: own.map((l, i) =>
            l.kind === 'TRANSITION'
              ? {
                  sequence: i + 1,
                  kind: 'TRANSITION' as const,
                  transition: l.transition,
                  fromState: l.fromState,
                  toState: l.toState,
                  machineVersion: l.machineVersion,
                  occurredAt: clock.now().toString(),
                  actor: { type: 'USER' as const, id: input.userId, displayName: null },
                  origin: 'api' as const,
                  reason: l.reason ?? null,
                  revisionFrom: null,
                  revisionTo: null,
                  aggregateVersion: null,
                  journalEntries: { reversed: null, reversal: null, posted: null },
                  detailRefs: l.detailRefs ?? {},
                  events: (l.events ?? []).map((e) => e.eventType),
                  auditLogId: null,
                  derived: false,
                }
              : {
                  sequence: i + 1,
                  kind: 'ANNOTATION' as const,
                  occurredAt: clock.now().toString(),
                  actor: { type: 'USER' as const, id: input.userId, displayName: null },
                  origin: 'api' as const,
                  changedFields: [...l.changedFields],
                  revisionFrom: null,
                  revisionTo: null,
                  aggregateVersion: null,
                  events: (l.events ?? []).map((e) => e.eventType),
                  auditLogId: null,
                  derived: false,
                },
          ),
        };
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
      return [...state.workspaces].map(([workspaceId, timeZone]) => ({
        workspaceId,
        timeZone,
        baseCurrency: state.workspaceBase.get(workspaceId) ?? options.baseCurrency ?? 'BOB',
      }));
    },
  };
  const historyCache: ProviderHistoryCache = {
    async insertCloses(closes) {
      let inserted = 0;
      for (const c of closes) {
        const exists = state.historyCloses.some(
          (h) => h.provider === c.provider && h.base === c.base && h.quote === c.quote && h.day === c.day,
        );
        if (exists) continue;
        state.historyCloses.push(c);
        inserted++;
      }
      return inserted;
    },
    async lastDay(provider, base, quote) {
      const days = state.historyCloses
        .filter((h) => h.provider === provider && h.base === base && h.quote === quote)
        .map((h) => h.day)
        .sort();
      return days.at(-1) ?? null;
    },
    async summary(provider) {
      const days = [
        ...new Set(state.historyCloses.filter((h) => h.provider === provider).map((h) => h.day)),
      ].sort();
      return { points: days.length, from: days[0] ?? null, to: days.at(-1) ?? null };
    },
    async closes(provider, filter) {
      return state.historyCloses
        .filter(
          (h) =>
            h.provider === provider &&
            filter.bases.includes(h.base) &&
            h.quote === filter.quote &&
            h.day >= filter.from &&
            h.day <= filter.to,
        )
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    },
  };
  const firstBalance: FirstBalanceDatePort = {
    async byCurrency(ws) {
      return state.firstBalance.get(ws) ?? new Map();
    },
  };
  const episodes: RateFeedEpisodeRepository = {
    async listOpen(ws) {
      return state.episodes
        .filter((e) => e.workspaceId === ws && e.closedAt === null)
        .map((e) => ({
          id: e.id,
          base: e.base,
          quote: e.quote,
          openedAt: e.openedAt,
          lastRateAsOf: e.lastRateAsOf,
        }));
    },
    async open(input) {
      const duplicate = state.episodes.some(
        (e) =>
          e.workspaceId === input.workspaceId &&
          e.base === input.base &&
          e.quote === input.quote &&
          e.closedAt === null,
      );
      if (duplicate) return false;
      state.episodes.push({ ...input, closedAt: null, recoveredRateId: null, closedReason: null });
      return true;
    },
    async close(input) {
      const row = state.episodes.find(
        (e) => e.id === input.id && e.workspaceId === input.workspaceId && e.closedAt === null,
      );
      if (!row) return false;
      row.closedAt = input.closedAt;
      row.recoveredRateId = input.recoveredRateId;
      row.closedReason = input.reason;
      return true;
    },
  };
  /** Doble del puerto de NOTIFY: registra los hechos (y se revierte con la unidad de trabajo) o falla a pedido. */
  const notifications: NotificationIntakePort = {
    async notify(fact) {
      if (faults.notify) throw faults.notify;
      state.notified.push(fact);
      return { created: 2, deliveries: 2 };
    },
  };
  return {
    deps,
    state,
    faults,
    clock,
    runs,
    workspaces,
    historyCache,
    firstBalance,
    episodes,
    notifications,
  };
}
