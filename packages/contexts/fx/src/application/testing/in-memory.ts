import type { AuditEntry } from '@pf/audit/contracts';
import { DomainError, FixedClock, Instant, Money } from '@pf/shared-kernel';
import { CurrencyDefinition, type CurrencyKind, type ExchangeRate } from '../../domain/index.js';
import type { FxDeps, RatePreference } from '../ports/index.js';

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
    outbox: [] as { eventType: string; aggregateId: string; payload: Record<string, unknown> }[],
    audit: [] as AuditEntry[],
  };
  const faults: { audit?: Error } = {};
  let depth = 0;
  const snapshot = () => ({
    rates: [...state.rates],
    enabled: new Map([...state.enabled].map(([k, v]) => [k, new Set(v)])),
    preferences: new Map(state.preferences),
    outbox: [...state.outbox],
    audit: [...state.audit],
  });
  const definitions = new Map(
    CATALOG.map(([code, kind, scale]) => [
      code,
      CurrencyDefinition.of({ code, kind, name: code, scale, symbol: null, isActive: true, inUse: false }),
    ]),
  );
  const supersededBy = (id: string) => state.rates.find((r) => r.snapshot.supersedesId === id)?.id ?? null;
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
        return rate ? { rate, supersededById: supersededBy(rate.id) } : null;
      },
      async candidates(ws, currencies, from, to) {
        return state.rates
          .filter((r) => (r.snapshot.workspaceId ?? ws) === ws)
          .filter((r) => currencies.includes(r.rate.base.code) && currencies.includes(r.rate.quote.code))
          .filter((r) => {
            const t = Date.parse(r.snapshot.asOf);
            return t >= from.epochMillis && t <= to.epochMillis;
          })
          .map((r) => ({ state: r.snapshot, supersededById: supersededBy(r.id) }));
      },
      async list(ws, filter, page) {
        return state.rates
          .filter((r) => (r.snapshot.workspaceId ?? ws) === ws)
          .filter((r) => filter.includeSuperseded || supersededBy(r.id) === null)
          .filter((r) => !filter.base || r.rate.base.code === filter.base)
          .filter((r) => !filter.quote || r.rate.quote.code === filter.quote)
          .filter((r) => !filter.rateType || r.snapshot.rateType === filter.rateType)
          .sort((a, b) => Date.parse(b.snapshot.asOf) - Date.parse(a.snapshot.asOf))
          .slice(page.offset, page.offset + page.limit)
          .map((rate) => ({ rate, supersededById: supersededBy(rate.id) }));
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
  return { deps, state, faults, clock };
}
