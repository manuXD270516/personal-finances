import { currentRequestContext, PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { currency, DomainError, Rate, type Instant } from '@pf/shared-kernel';
import { sql, type Generated, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type {
  CurrencyRepository,
  CurrencyRow,
  ExchangeRateRepository,
  IdGenerator,
  RateListFilter,
  RatePreference,
  RatePreferenceRepository,
  RatePreferenceSet,
  StoredRate,
  UnitOfWork,
} from '../application/ports/index.js';
import {
  CurrencyDefinition,
  DEFAULT_WORKSPACE_CURRENCIES,
  ExchangeRate,
  type CurrencyKind,
  type FxRateSource,
  type FxRateType,
  type RateCandidate,
} from '../domain/index.js';

/** Tablas del schema `fx` (montos/tasas NUMERIC como string, instantes como texto ISO). */
interface FxDb {
  'fx.currency': {
    code: string;
    kind: CurrencyKind;
    name: string;
    scale: number;
    symbol: string | null;
    is_active: boolean;
  };
  'fx.workspace_currency': {
    workspace_id: string;
    currency_code: string;
    sort_order: Generated<number>;
    enabled_at: Generated<string>;
  };
  'fx.exchange_rate': {
    id: string;
    workspace_id: string | null;
    base_currency: string;
    quote_currency: string;
    rate: string;
    rate_type: FxRateType;
    as_of: string;
    as_of_date: string;
    source: FxRateSource;
    source_label: string | null;
    provider: string | null;
    supersedes_id: string | null;
    supersede_reason: string | null;
    created_at: string;
    created_by: string | null;
  };
  'fx.rate_preference': {
    workspace_id: string;
    base_currency: string;
    quote_currency: string;
    rate_type: FxRateType;
    version: number;
  };
  'fx.rate_preference_set': { workspace_id: string; version: number };
}

const db = (): Kysely<FxDb> => unitOfWorkKysely<FxDb>();
const iso = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

interface RateRow {
  id: string;
  workspace_id: string | null;
  base_currency: string;
  quote_currency: string;
  rate: string;
  rate_type: FxRateType;
  as_of: string;
  as_of_date: string;
  source: FxRateSource;
  source_label: string | null;
  supersedes_id: string | null;
  supersede_reason: string | null;
  created_at: string;
  created_by: string | null;
  base_scale: number;
  quote_scale: number;
  superseded_by: string | null;
}

/** Selección común: tasa con escalas de sus monedas y la versión que la reemplazó (si existe). */
function selectRates() {
  return db()
    .selectFrom('fx.exchange_rate as r')
    .innerJoin('fx.currency as b', 'b.code', 'r.base_currency')
    .innerJoin('fx.currency as q', 'q.code', 'r.quote_currency')
    .select([
      'r.id',
      'r.workspace_id',
      'r.base_currency',
      'r.quote_currency',
      // trim_scale: el valor exacto registrado, sin los ceros de NUMERIC(38,18) ("6.95", no "6.950000000000000000").
      sql<string>`trim_scale(r.rate)::text`.as('rate'),
      'r.rate_type',
      iso('r.as_of').as('as_of'),
      sql<string>`r.as_of_date::text`.as('as_of_date'),
      'r.source',
      'r.source_label',
      'r.supersedes_id',
      'r.supersede_reason',
      iso('r.created_at').as('created_at'),
      'r.created_by',
      'b.scale as base_scale',
      'q.scale as quote_scale',
      sql<string | null>`(SELECT s.id::text FROM fx.exchange_rate s WHERE s.supersedes_id = r.id LIMIT 1)`.as(
        'superseded_by',
      ),
    ]);
}

function toStored(row: RateRow): StoredRate {
  const base = currency(row.base_currency, Number(row.base_scale));
  const quote = currency(row.quote_currency, Number(row.quote_scale));
  return {
    rate: ExchangeRate.rehydrate({
      id: row.id,
      workspaceId: row.workspace_id,
      rate: Rate.of(base, quote, row.rate),
      rateType: row.rate_type,
      source: row.source,
      sourceLabel: row.source_label,
      asOf: row.as_of,
      effectiveDate: row.as_of_date,
      supersedesId: row.supersedes_id,
      supersedeReason: row.supersede_reason,
      createdAt: row.created_at,
      createdBy: row.created_by,
    }),
    supersededById: row.superseded_by,
  };
}

const isUniqueViolation = (err: unknown, constraint: string) =>
  (err as { code?: string; constraint?: string }).code === '23505' &&
  (err as { constraint?: string }).constraint === constraint;

/**
 * Historial de tasas sobre `fx.exchange_rate` (append-only, INV-011): solo `INSERT`; la carrera de dos reemplazos de
 * la misma versión la resuelve el índice único parcial `exchange_rate_supersedes_uk` (→ `FX_RATE_ALREADY_SUPERSEDED`).
 */
export class PgExchangeRateRepository implements ExchangeRateRepository {
  async insert(rate: ExchangeRate): Promise<void> {
    const s = rate.snapshot;
    try {
      await db()
        .insertInto('fx.exchange_rate')
        .values({
          id: s.id,
          workspace_id: s.workspaceId,
          base_currency: s.rate.base.code,
          quote_currency: s.rate.quote.code,
          rate: rate.valueText,
          rate_type: s.rateType,
          as_of: s.asOf,
          as_of_date: s.effectiveDate,
          source: s.source,
          source_label: s.sourceLabel,
          provider: null,
          supersedes_id: s.supersedesId,
          supersede_reason: s.supersedeReason,
          created_at: s.createdAt,
          created_by: s.createdBy,
        })
        .execute();
    } catch (err) {
      if (isUniqueViolation(err, 'exchange_rate_supersedes_uk')) {
        throw new DomainError(
          'FX_RATE_ALREADY_SUPERSEDED',
          `rate ${String(s.supersedesId)} already superseded`,
          {
            cause: err,
          },
        );
      }
      throw err;
    }
  }

  async findById(_workspaceId: string, id: string): Promise<StoredRate | null> {
    const row = await selectRates().where('r.id', '=', id).executeTakeFirst();
    return row ? toStored(row as RateRow) : null;
  }

  async candidates(
    _workspaceId: string,
    currencies: readonly string[],
    from: Instant,
    to: Instant,
  ): Promise<RateCandidate[]> {
    if (currencies.length < 2) return [];
    const codes = [...new Set(currencies)];
    const rows = await selectRates()
      .where('r.base_currency', 'in', codes)
      .where('r.quote_currency', 'in', codes)
      .where('r.as_of', '>=', from.toString())
      .where('r.as_of', '<=', to.toString())
      .execute();
    return rows.map((r) => {
      const stored = toStored(r as RateRow);
      return { state: stored.rate.snapshot, supersededById: stored.supersededById };
    });
  }

  async list(
    _workspaceId: string,
    filter: RateListFilter,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<StoredRate[]> {
    let q = selectRates();
    if (filter.base) q = q.where('r.base_currency', '=', filter.base);
    if (filter.quote) q = q.where('r.quote_currency', '=', filter.quote);
    if (filter.rateType) q = q.where('r.rate_type', '=', filter.rateType);
    if (filter.source) q = q.where('r.source', '=', filter.source);
    if (filter.asOfFrom) q = q.where('r.as_of', '>=', filter.asOfFrom);
    if (filter.asOfTo) q = q.where('r.as_of', '<=', filter.asOfTo);
    if (!filter.includeSuperseded) {
      q = q.where(({ not, exists, selectFrom }) =>
        not(
          exists(selectFrom('fx.exchange_rate as s').select('s.id').whereRef('s.supersedes_id', '=', 'r.id')),
        ),
      );
    }
    const rows = await q
      .orderBy('r.as_of', 'desc')
      .orderBy('r.id', 'desc')
      .offset(page.offset)
      .limit(page.limit)
      .execute();
    return rows.map((r) => toStored(r as RateRow));
  }
}

/** Catálogo global (solo lectura) + monedas habilitadas por workspace. */
export class PgCurrencyRepository implements CurrencyRepository {
  async list(workspaceId: string, filter: { readonly kind?: CurrencyKind }): Promise<CurrencyRow[]> {
    let q = db()
      .selectFrom('fx.currency as c')
      .leftJoin('fx.workspace_currency as w', (j) =>
        j.onRef('w.currency_code', '=', 'c.code').on('w.workspace_id', '=', workspaceId),
      )
      .select([
        'c.code',
        'c.kind',
        'c.name',
        'c.scale',
        'c.symbol',
        'c.is_active',
        'w.currency_code as enabled_code',
      ])
      .where('c.is_active', '=', true);
    if (filter.kind) q = q.where('c.kind', '=', filter.kind);
    const rows = await q.orderBy('c.code').execute();
    const anyEnabled = await db()
      .selectFrom('fx.workspace_currency')
      .select('currency_code')
      .where('workspace_id', '=', workspaceId)
      .limit(1)
      .executeTakeFirst();
    const defaults: readonly string[] = DEFAULT_WORKSPACE_CURRENCIES;
    return rows.map((r) => ({
      definition: CurrencyDefinition.of({
        code: r.code,
        kind: r.kind,
        name: r.name,
        scale: Number(r.scale),
        symbol: r.symbol,
        isActive: r.is_active,
        inUse: true,
      }),
      // Workspaces creados antes de FX (sin filas): conjunto por defecto BOB/USD/USDT (design.md decisión 11).
      enabled: anyEnabled ? r.enabled_code !== null : defaults.includes(r.code),
    }));
  }

  async find(code: string): Promise<CurrencyDefinition | null> {
    const r = await db()
      .selectFrom('fx.currency')
      .select(['code', 'kind', 'name', 'scale', 'symbol', 'is_active'])
      .where('code', '=', code)
      .executeTakeFirst();
    if (!r || !r.is_active) return null;
    return CurrencyDefinition.of({
      code: r.code,
      kind: r.kind,
      name: r.name,
      scale: Number(r.scale),
      symbol: r.symbol,
      isActive: r.is_active,
      inUse: true,
    });
  }

  async enable(workspaceId: string, codes: readonly string[]): Promise<void> {
    if (codes.length === 0) return;
    await db()
      .insertInto('fx.workspace_currency')
      .values(codes.map((currency_code) => ({ workspace_id: workspaceId, currency_code })))
      .onConflict((oc) => oc.columns(['workspace_id', 'currency_code']).doNothing())
      .execute();
  }
}

/** Preferencias de tipo por par con la versión de la lista en `fx.rate_preference_set`. */
export class PgRatePreferenceRepository implements RatePreferenceRepository {
  async get(workspaceId: string, options: { readonly forUpdate?: boolean } = {}): Promise<RatePreferenceSet> {
    let setQ = db()
      .selectFrom('fx.rate_preference_set')
      .select('version')
      .where('workspace_id', '=', workspaceId);
    if (options.forUpdate) setQ = setQ.forUpdate();
    const set = await setQ.executeTakeFirst();
    const rows = await db()
      .selectFrom('fx.rate_preference')
      .select(['base_currency', 'quote_currency', 'rate_type'])
      .where('workspace_id', '=', workspaceId)
      .orderBy('base_currency')
      .orderBy('quote_currency')
      .execute();
    return {
      preferences: rows.map((r): RatePreference => ({
        base: r.base_currency,
        quote: r.quote_currency,
        rateType: r.rate_type,
      })),
      version: set ? Number(set.version) : 1,
    };
  }

  async replace(
    workspaceId: string,
    preferences: readonly RatePreference[],
    expectedVersion: number,
  ): Promise<boolean> {
    const next = expectedVersion + 1;
    const k = db();
    if (expectedVersion === 1) {
      const inserted = await k
        .insertInto('fx.rate_preference_set')
        .values({ workspace_id: workspaceId, version: next })
        .onConflict((oc) => oc.column('workspace_id').doNothing())
        .executeTakeFirst();
      if (Number(inserted.numInsertedOrUpdatedRows ?? 0n) !== 1) return false;
    } else {
      const updated = await k
        .updateTable('fx.rate_preference_set')
        .set({ version: next })
        .where('workspace_id', '=', workspaceId)
        .where('version', '=', expectedVersion)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) return false;
    }
    await k.deleteFrom('fx.rate_preference').where('workspace_id', '=', workspaceId).execute();
    if (preferences.length > 0) {
      await k
        .insertInto('fx.rate_preference')
        .values(
          preferences.map((p) => ({
            workspace_id: workspaceId,
            base_currency: p.base,
            quote_currency: p.quote,
            rate_type: p.rateType,
            version: next,
          })),
        )
        .execute();
    }
    return true;
  }
}

/** Unidad de trabajo: reutiliza la transacción en curso (Transactions, idempotencia) o abre una con RLS. */
export class PgFxUnitOfWork implements UnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const actor = currentRequestContext()?.actor;
    const userId = actor && actor.type === 'USER' ? actor.userId : null;
    return this.uow.run({ userId, workspaceId }, fn);
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };
