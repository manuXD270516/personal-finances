import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { EventSchemaRegistry, PgOutboxWriter, type EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { FxService } from '../../src/application/fx.service.js';
import { MarketRateIngestion } from '../../src/application/market-rate-ingestion.js';
import type { FirstBalanceDatePort, FxDeps } from '../../src/application/ports/index.js';
import { assetClassPolicyOf, parseFxProviderSettings } from '../../src/application/provider-settings.js';
import { FakeCryptoProvider } from '../../src/application/testing/fake-crypto-provider.js';
import {
  PgCurrencyRepository,
  PgExchangeRateRepository,
  PgFxUnitOfWork,
  PgRateAnomalyReviewRepository,
  PgRatePairListRepository,
  PgRatePreferenceRepository,
  uuidV7Ids,
} from '../../src/infrastructure/pg-fx.js';
import { PgProviderHistoryCache } from '../../src/infrastructure/pg-provider-history.js';
import { PgProviderRunRepository } from '../../src/infrastructure/pg-provider-runs.js';

// Pares configurables y providers cripto sobre PostgreSQL real (Testcontainers; add-crypto-rate-providers tarea 4.8):
// lista de pares con RLS y optimistic locking, caché de cierres diarios de instalación, quitar un par conserva el
// histórico, histórico idempotente desde la primera fecha con saldo y eventos válidos contra contracts/events. El
// provider cripto es un DOBLE en memoria (no existe ningún adapter real hasta ADR-0029): sin red.
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const EVENTS_DIR = fileURLToPath(new URL('../../../../../contracts/events/', import.meta.url));
const clock = new FixedClock(Instant.parse('2026-10-13T14:00:00Z'));
const PRIMARY = 'CRYPTO_TEST_PRIMARY' as const;
let app: Pool;
let worker: Pool;
let migrator: Pool;
let appUow: PgUnitOfWork;
let registry: EventSchemaRegistry;
let owner: string;
const w1 = randomUUID();
const w2 = randomUUID();
const firstBalance = new Map<string, Map<string, string>>();

async function provision(label: string, ws: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/fx-crypto', $1, $2, $3) AS id`,
    [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID()}@demo.pfos.test`, label],
  );
  const user = rows[0]!.id;
  await appUow.run({ userId: user, workspaceId: ws }, async () => {
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, $2, 'BOB', 'America/La_Paz', 'es-BO')`,
      [ws, label],
    );
    await requireSqlExecutor().query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [ws, user],
    );
  });
  return user;
}

async function inTx<T>(pool: Pool, ws: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (ws) await c.query(`SELECT set_config('app.workspace_id', $1, true)`, [ws]);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

const settings = () =>
  parseFxProviderSettings({
    FX_PROVIDER_PRIMARY: 'none',
    FX_PROVIDER_FALLBACK: 'none',
    FX_PROVIDER_OFFICIAL: 'none',
    FX_PROVIDER_CRYPTO_PRIMARY: 'crypto_test_primary',
    FX_CRYPTO_HISTORY_FROM: '2026-01-01',
  });

let fake: FakeCryptoProvider;
let unregister: () => void;

function ingestion() {
  const writer = new PgOutboxWriter(registry);
  const first: FirstBalanceDatePort = { byCurrency: async (ws) => firstBalance.get(ws) ?? new Map() };
  return new MarketRateIngestion({
    uow: new PgFxUnitOfWork(worker),
    rates: new PgExchangeRateRepository(),
    currencies: new PgCurrencyRepository(),
    preferences: new PgRatePreferenceRepository(),
    pairs: new PgRatePairListRepository(),
    runs: new PgProviderRunRepository(worker),
    historyCache: new PgProviderHistoryCache(worker),
    firstBalance: first,
    workspaces: {
      list: async () =>
        [w1, w2].map((workspaceId) => ({ workspaceId, timeZone: 'America/La_Paz', baseCurrency: 'BOB' })),
    },
    outbox: { append: async (e) => void (await writer.append(e)) },
    ids: uuidV7Ids,
    clock,
    settings: settings(),
    providers: { [PRIMARY]: fake },
  });
}

function service(ws: string) {
  const s = settings();
  const fxDeps: FxDeps = {
    uow: new PgFxUnitOfWork(app),
    rates: new PgExchangeRateRepository(),
    currencies: new PgCurrencyRepository(),
    preferences: new PgRatePreferenceRepository(),
    pairs: new PgRatePairListRepository(),
    reviews: new PgRateAnomalyReviewRepository(),
    workspaces: { settingsOf: async () => ({ baseCurrency: 'BOB', timeZone: 'America/La_Paz' }) },
    outbox: { append: async () => undefined },
    audit: { append: async () => undefined },
    lifecycle: { record: async () => undefined },
    lifecycleQuery: {
      machineOf: () => {
        throw new Error('not used');
      },
      lifecycleOf: () => Promise.reject(new Error('not used')),
    },
    ids: uuidV7Ids,
    clock,
    assetClasses: assetClassPolicyOf(s),
  };
  const svc = new FxService(fxDeps);
  return {
    replace: (
      expectedVersion: number,
      body: Parameters<FxService['replaceRatePairs']>[0]['pairs'],
      mode: 'DEFAULT' | 'CUSTOM' = 'CUSTOM',
    ) =>
      appUow.run({ userId: owner, workspaceId: ws }, () =>
        svc.replaceRatePairs({ workspaceId: ws, expectedVersion, mode, ...(body ? { pairs: body } : {}) }),
      ),
  };
}

const rateRows = (ws: string, base: string) =>
  inTx(
    app,
    ws,
    async (c) =>
      (
        await c.query<{ id: string; rate: string; as_of: string }>(
          `SELECT id::text, trim_scale(rate)::text AS rate,
                  to_char(as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS as_of
             FROM fx.exchange_rate
            WHERE workspace_id = $1 AND base_currency = $2 AND quote_currency = 'USDT' AND rate_type = 'MARKET'
            ORDER BY as_of, id`,
          [ws, base],
        )
      ).rows,
  );

const pairRows = (ws: string) =>
  inTx(app, ws, async (c) =>
    (
      await c.query<{ pair: string }>(
        `SELECT base_currency || '/' || quote_currency AS pair FROM fx.rate_pair WHERE workspace_id = $1 ORDER BY sort_order`,
        [ws],
      )
    ).rows.map((r) => r.pair),
  );

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  appUow = new PgUnitOfWork(app);
  registry = EventSchemaRegistry.fromDirectory(EVENTS_DIR);
  owner = await provision('fxc-w1', w1);
  await provision('fxc-w2', w2);
  fake = new FakeCryptoProvider({ id: PRIMARY, symbols: ['BTC'] }, () => clock.now().toString());
  unregister = fake.register();
  // BTC habilitada en ambos workspaces (el resto de las monedas por defecto se mantiene).
  const currencies = new PgCurrencyRepository();
  for (const ws of [w1, w2]) {
    await new PgFxUnitOfWork(worker).run(ws, () => currencies.enable(ws, ['BOB', 'USD', 'USDT', 'BTC']));
  }
});

afterAll(async () => {
  unregister?.();
  await app?.end();
  await worker?.end();
  await migrator?.end();
});

describe('Lista de pares sobre PostgreSQL (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-021] sin fila la lista es DEFAULT v1; guardar una lista conserva el orden y sube la versión; la versión vieja es 412', async () => {
    const repo = new PgRatePairListRepository();
    expect(await appUow.run({ userId: owner, workspaceId: w1 }, () => repo.get(w1))).toEqual({
      mode: 'DEFAULT',
      pairs: [],
      version: 1,
    });
    const svc = service(w1);
    expect(
      await svc.replace(1, [
        { base: 'USDT', quote: 'BOB' },
        { base: 'USD', quote: 'BOB' },
        { base: 'BTC', quote: 'USDT' },
      ]),
    ).toEqual({ mode: 'CUSTOM', version: 2 });
    expect(await pairRows(w1)).toEqual(['USDT/BOB', 'USD/BOB', 'BTC/USDT']);
    const stored = await appUow.run({ userId: owner, workspaceId: w1 }, () => repo.get(w1));
    expect([stored.mode, stored.version, stored.pairs.map((p) => `${p.base}/${p.quote}`)]).toEqual([
      'CUSTOM',
      2,
      ['USDT/BOB', 'USD/BOB', 'BTC/USDT'],
    ]);
    await expect(svc.replace(1, [{ base: 'USD', quote: 'BOB' }])).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    // Aislamiento por workspace (RLS): w2 sigue en la lista por defecto.
    expect(await pairRows(w2)).toEqual([]);
    expect(await appUow.run({ userId: owner, workspaceId: w2 }, () => repo.get(w2))).toMatchObject({
      mode: 'DEFAULT',
    });
  });

  it('[TC-FX-PROVIDER-021] volver a DEFAULT borra las filas de la lista explícita; las tablas tienen RLS forzada y están registradas', async () => {
    await service(w1).replace(2, undefined, 'DEFAULT');
    expect(await pairRows(w1)).toEqual([]);
    const { rows } = await migrator.query<{ table_name: string; forced: boolean }>(
      `SELECT s.table_name, c.relforcerowsecurity AS forced
         FROM platform.workspace_scoped_table s
         JOIN pg_class c ON c.oid = format('%I.%I', s.schema_name, s.table_name)::regclass
        WHERE s.schema_name = 'fx' AND s.table_name IN ('rate_pair', 'rate_pair_list') ORDER BY 1`,
    );
    expect(rows).toEqual([
      { table_name: 'rate_pair', forced: true },
      { table_name: 'rate_pair_list', forced: true },
    ]);
    // Dejar a w1 con la lista que usan las pruebas siguientes.
    await service(w1).replace(3, [
      { base: 'USDT', quote: 'BOB' },
      { base: 'BTC', quote: 'USDT' },
    ]);
  });
});

describe('Caché de cierres de instalación (fx.provider_history_point)', () => {
  it('[TC-FX-PROVIDER-030] inserta idempotente, conserva el decimal exacto y solo el worker puede leerla', async () => {
    const cache = new PgProviderHistoryCache(worker);
    // Provider propio de la prueba: la caché es de instalación y la base puede reutilizarse entre corridas.
    const provider = `CRYPTO_TEST_CACHE_${randomUUID().slice(0, 8).toUpperCase()}` as const;
    const close = {
      provider,
      base: 'BTC',
      quote: 'USDT',
      day: '2025-12-31',
      close: '65000.01000000',
      closeAt: '2025-12-31T23:59:59.000Z',
      fetchedAt: '2026-10-13T14:00:00.000Z',
      rawPayload: '{"close":"65000.01000000"}',
    };
    expect(await cache.insertCloses([close])).toBe(1);
    expect(await cache.insertCloses([close])).toBe(0);
    expect(await cache.lastDay(provider, 'BTC', 'USDT')).toBe('2025-12-31');
    const [row] = await cache.closes(provider, {
      bases: ['BTC'],
      quote: 'USDT',
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(row).toMatchObject({ day: '2025-12-31', close: '65000.01', closeAt: '2025-12-31T23:59:59.000Z' });
    expect(await cache.summary(provider)).toEqual({ points: 1, from: '2025-12-31', to: '2025-12-31' });
    // La API (pf_app) no tiene acceso a la caché de instalación.
    await expect(
      inTx(app, null, (c) => c.query('SELECT 1 FROM fx.provider_history_point LIMIT 1')),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('Providers cripto sobre PostgreSQL (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-024] [TC-FX-PROVIDER-026] solo se registran los pares de la lista: w1 (USDT/BOB, BTC/USDT) y w2 (por defecto) reciben el precio MARKET y el evento valida', async () => {
    fake.prices = { BTC: { price: '65000.01000000', asOf: '2026-10-13T14:00:00.000Z' } };
    const results = await ingestion().poll();
    expect(results.map((r) => [r.provider, r.outcome, r.newSamples])).toEqual([[PRIMARY, 'OK', 2]]);
    for (const ws of [w1, w2]) {
      expect((await rateRows(ws, 'BTC')).map((r) => [r.rate, r.as_of])).toEqual([
        ['65000.01', '2026-10-13T14:00:00.000Z'],
      ]);
    }
    const events = await inTx(worker, null, async (c) =>
      (
        await c.query<{ envelope: EventEnvelope }>(
          `SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = 'fx.RateRecorded' ORDER BY sequence`,
          [w1],
        )
      ).rows.map((r) =>
        typeof r.envelope === 'string' ? (JSON.parse(r.envelope) as EventEnvelope) : r.envelope,
      ),
    );
    expect(events).toHaveLength(1);
    expect(() => registry.validate(events[0]!)).not.toThrow();
    expect(events[0]?.payload).toMatchObject({
      rateType: 'MARKET',
      provider: PRIMARY,
      base: 'BTC',
      quote: 'USDT',
    });
  });

  it('[TC-FX-PROVIDER-023] quitar BTC/USDT deja de registrarlo y conserva intactas las tasas registradas', async () => {
    const before = await rateRows(w1, 'BTC');
    await service(w1).replace(4, [{ base: 'USDT', quote: 'BOB' }]);
    clock.set(Instant.parse('2026-10-13T14:15:00Z'));
    fake.prices = { BTC: { price: '65100.00', asOf: '2026-10-13T14:10:00.000Z' } };
    await ingestion().poll();
    expect(await rateRows(w1, 'BTC')).toEqual(before);
    // w2 mantiene la lista por defecto: sigue registrando.
    expect((await rateRows(w2, 'BTC')).length).toBe(2);
  });

  it('[TC-FX-PROVIDER-030] [TC-FX-PROVIDER-031] el histórico copia los cierres desde la primera fecha con saldo, es idempotente y completa los días anteriores', async () => {
    await service(w1).replace(5, [
      { base: 'USDT', quote: 'BOB' },
      { base: 'BTC', quote: 'USDT' },
    ]);
    const closes: Record<string, string> = {};
    for (
      let ms = Date.parse('2026-01-01T00:00:00Z');
      ms <= Date.parse('2026-10-13T00:00:00Z');
      ms += 86_400_000
    ) {
      closes[new Date(ms).toISOString().slice(0, 10)] = '60000.00';
    }
    closes['2026-03-31'] = '82000.00';
    fake.closes = { BTC: closes };
    clock.set(Instant.parse('2026-10-13T14:30:00Z'));
    firstBalance.set(w1, new Map([['BTC', '2026-03-10']]));
    const svc = ingestion();
    await svc.cryptoFillGaps();
    const days = (rows: { as_of: string }[]) => rows.map((r) => r.as_of.slice(0, 10));
    const close = (await rateRows(w1, 'BTC')).filter((r) => r.as_of.endsWith('T23:59:59.000Z'));
    expect(close).toHaveLength(217);
    expect([days(close)[0], days(close).at(-1)]).toEqual(['2026-03-10', '2026-10-12']);
    expect(close.find((r) => r.as_of === '2026-03-31T23:59:59.000Z')?.rate).toBe('82000');
    expect((await svc.cryptoFillGaps()).every((r) => r.newSamples === 0)).toBe(true);
    // Un movimiento con fecha anterior adelanta la primera fecha con saldo: 9 cierres más, sin tocar los previos.
    firstBalance.set(w1, new Map([['BTC', '2026-03-01']]));
    await svc.cryptoFillGaps();
    const after = (await rateRows(w1, 'BTC')).filter((r) => r.as_of.endsWith('T23:59:59.000Z'));
    expect(after).toHaveLength(226);
    for (const r of close) expect(after.find((a) => a.id === r.id)).toEqual(r);
  }, 120_000);
});
