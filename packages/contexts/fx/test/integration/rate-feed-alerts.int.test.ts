import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { NotificationIntakeFact, NotificationIntakePort } from '@pf/notifications/contracts';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { EventSchemaRegistry, PgOutboxWriter, type EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MarketRateIngestion } from '../../src/application/market-rate-ingestion.js';
import { parseFxProviderSettings } from '../../src/application/provider-settings.js';
import { RatePairViews } from '../../src/application/rate-pair-views.js';
import { RatePairResolver } from '../../src/application/rate-pairs.js';
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
import { PgRateFeedEpisodeRepository } from '../../src/infrastructure/pg-rate-feed-episodes.js';
import {
  ProviderError,
  ProviderSample,
  providerDescriptor,
  type MarketRateProvider,
} from '../../src/domain/index.js';

// Alertas de obsolescencia y muestras retenidas sobre PostgreSQL real (add-rate-feed-alerts, tareas 4.1 y 4.5): tabla
// `fx.rate_feed_episode` con RLS forzada, índice único parcial y registro en `platform.workspace_scoped_table`; ciclo de
// providers con episodio + evento del outbox (validado contra contracts/events) + puerto de NOTIFY en la MISMA transacción,
// con rollback completo si NOTIFY falla. Providers simulados por dobles en memoria y reloj fijo (sin red).
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const EVENTS_DIR = fileURLToPath(new URL('../../../../../contracts/events/', import.meta.url));
const clock = new FixedClock(Instant.parse('2026-10-13T08:05:00Z'));
const CRYPTO = 'CRYPTO_TEST_PRIMARY' as const;
const RAW =
  '{"timestamp":"2026-10-13T08:00:00.000Z","buy":12.12,"sell":11.92,"median":12.02,"spreadPct":-1.6972,"sourceCount":4,"methodologyVersion":"ec2-backend"}';
let app: Pool;
let worker: Pool;
let migrator: Pool;
let appUow: PgUnitOfWork;
let registry: EventSchemaRegistry;
const w1 = randomUUID();
const w2 = randomUUID();
const active = new Set<string>();

class FakeParalelo implements MarketRateProvider {
  latest: ProviderSample[] = [];
  failure: ProviderError | null = null;
  descriptor() {
    return providerDescriptor('PARALELO_BO') as NonNullable<ReturnType<typeof providerDescriptor>>;
  }
  async fetchLatest() {
    if (this.failure) throw this.failure;
    return this.latest;
  }
  async fetchHistory() {
    return [];
  }
}
const paralelo = new FakeParalelo();
let crypto: FakeCryptoProvider;
let unregister: () => void;
const notified: NotificationIntakeFact[] = [];
const faults: { notify: Error | null } = { notify: null };

/** Doble del puerto de NOTIFY: registra el hecho SOLO si la transacción de FX confirma (se escribe en una tabla temporal). */
const intake: NotificationIntakePort = {
  async notify(fact) {
    if (faults.notify) throw faults.notify;
    // Escribe en la propia transacción de FX: si se revierte, el hecho no queda en la base (prueba de la misma unidad).
    await requireSqlExecutor().query(
      `INSERT INTO fx.exchange_rate_probe_notified (fact_key, fact_type) VALUES ($1, $2)`,
      [fact.factKey, fact.type],
    );
    notified.push(fact);
    return { created: 2, refreshed: 0, deliveries: 2 };
  },
};

const sample = (base: string, value: string, asOf: string) =>
  ProviderSample.of({
    provider: 'PARALELO_BO',
    base,
    quote: 'BOB',
    rateType: 'PARALLEL',
    value,
    asOf,
    fetchedAt: clock.now().toString(),
    rawPayload: RAW,
    sourceLabel: 'paralelo.bo (mediana P2P USDT/BOB)',
  });

function settings() {
  return parseFxProviderSettings({
    FX_PROVIDER_FALLBACK: 'none',
    FX_PROVIDER_OFFICIAL: 'none',
    FX_PROVIDER_CRYPTO_PRIMARY: 'crypto_test_primary',
  });
}

function ingestion() {
  const writer = new PgOutboxWriter(registry);
  return new MarketRateIngestion({
    uow: new PgFxUnitOfWork(worker),
    rates: new PgExchangeRateRepository(),
    currencies: new PgCurrencyRepository(),
    preferences: new PgRatePreferenceRepository(),
    pairs: new PgRatePairListRepository(),
    runs: new PgProviderRunRepository(worker),
    historyCache: new PgProviderHistoryCache(worker),
    workspaces: {
      list: async () =>
        [...active].map((workspaceId) => ({ workspaceId, timeZone: 'America/La_Paz', baseCurrency: 'BOB' })),
    },
    outbox: { append: async (e) => void (await writer.append(e)) },
    ids: uuidV7Ids,
    clock,
    settings: settings(),
    providers: { PARALELO_BO: paralelo, [CRYPTO]: crypto } as never,
    episodes: new PgRateFeedEpisodeRepository(),
    notifications: intake,
  });
}

async function provision(label: string, ws: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/fx-feed-alerts', $1, $2, $3) AS id`,
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

const episodes = (ws: string) =>
  inTx(
    app,
    ws,
    async (c) =>
      (
        await c.query<{
          id: string;
          pair: string;
          opened_at: string;
          last_rate_as_of: string | null;
          closed_at: string | null;
          closed_reason: string | null;
          recovered_rate_id: string | null;
        }>(
          `SELECT id::text, base_currency || '/' || quote_currency AS pair,
                  to_char(opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS opened_at,
                  to_char(last_rate_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_rate_as_of,
                  to_char(closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS closed_at,
                  closed_reason, recovered_rate_id::text
             FROM fx.rate_feed_episode WHERE workspace_id = $1 ORDER BY opened_at, id`,
          [ws],
        )
      ).rows,
  );

const events = (ws: string, type: string) =>
  inTx(worker, null, async (c) =>
    (
      await c.query<{ envelope: EventEnvelope }>(
        `SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = $2 ORDER BY sequence`,
        [ws, type],
      )
    ).rows.map((r) =>
      typeof r.envelope === 'string' ? (JSON.parse(r.envelope) as EventEnvelope) : r.envelope,
    ),
  );

async function setPairs(ws: string, user: string, pairs: [string, string][]) {
  const repo = new PgRatePairListRepository();
  const state = await appUow.run({ userId: user, workspaceId: ws }, () => repo.get(ws));
  await appUow.run({ userId: user, workspaceId: ws }, () =>
    repo.replace(
      ws,
      { mode: 'CUSTOM', pairs: pairs.map(([base, quote]) => ({ base, quote })), version: state.version + 1 },
      state.version,
    ),
  );
}

let u1: string;
let u2: string;
/** Corridas de `fx.provider_run` (tabla de instalación compartida) que ya existían antes de esta suite. */
let preexistingRuns: string[] = [];

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  appUow = new PgUnitOfWork(app);
  registry = EventSchemaRegistry.fromDirectory(EVENTS_DIR);
  preexistingRuns = (await worker.query<{ id: string }>('SELECT id::text FROM fx.provider_run')).rows.map(
    (r) => r.id,
  );
  u1 = await provision('fxa-w1', w1);
  u2 = await provision('fxa-w2', w2);
  crypto = new FakeCryptoProvider({ id: CRYPTO, symbols: ['BTC'] }, () => clock.now().toString());
  unregister = crypto.register();
  const currencies = new PgCurrencyRepository();
  for (const ws of [w1, w2]) {
    await new PgFxUnitOfWork(worker).run(ws, () =>
      currencies.enable(ws, ['BOB', 'USD', 'USDT', 'EUR', 'BTC']),
    );
  }
  // Tabla de prueba (solo en esta base efímera): prueba que el aviso a NOTIFY comparte la transacción de FX.
  await migrator.query(
    `CREATE TABLE fx.exchange_rate_probe_notified (fact_key text NOT NULL, fact_type text NOT NULL)`,
  );
  await migrator.query(`GRANT INSERT, SELECT ON fx.exchange_rate_probe_notified TO pf_worker`);
});

afterAll(async () => {
  unregister?.();
  // Los relojes de esta suite (octubre 2026, hasta el 23) dejarían corridas "futuras" que `recent` ordena primero y
  // romperían a las demás suites de la corrida: se borran las que esta suite creó (pf_worker puede purgar).
  await worker
    ?.query('DELETE FROM fx.provider_run WHERE NOT (id::text = ANY($1::text[]))', [preexistingRuns])
    .catch(() => undefined);
  await migrator?.query('DROP TABLE IF EXISTS fx.exchange_rate_probe_notified').catch(() => undefined);
  await app?.end();
  await worker?.end();
  await migrator?.end();
});

const probeCount = () =>
  migrator
    .query<{ n: string }>(`SELECT count(*)::text AS n FROM fx.exchange_rate_probe_notified`)
    .then((r) => Number(r.rows[0]?.n));

describe('fx.rate_feed_episode sobre PostgreSQL (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-038] la tabla tiene RLS forzada y está registrada en platform.workspace_scoped_table', async () => {
    const { rows } = await migrator.query<{ forced: boolean; purge_order: number }>(
      `SELECT c.relforcerowsecurity AS forced, s.purge_order
         FROM platform.workspace_scoped_table s
         JOIN pg_class c ON c.oid = format('%I.%I', s.schema_name, s.table_name)::regclass
        WHERE s.schema_name = 'fx' AND s.table_name = 'rate_feed_episode'`,
    );
    expect(rows).toEqual([{ forced: true, purge_order: 150 }]);
  });

  it('[TC-FX-PROVIDER-038] un solo episodio abierto por par (índice único parcial), también entre dos aperturas a la vez; tras cerrarlo se abre otro', async () => {
    const repo = new PgRateFeedEpisodeRepository();
    const uow = new PgFxUnitOfWork(worker);
    const open = (ws: string) =>
      uow.run(ws, () =>
        repo.open({
          id: randomUUID(),
          workspaceId: ws,
          base: 'EUR',
          quote: 'BOB',
          openedAt: '2026-10-13T14:15:00.000Z',
          lastRateAsOf: null,
        }),
      );
    const results = await Promise.all([open(w2), open(w2)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const [episode] = await uow.run(w2, () => repo.listOpen(w2));
    expect(episode).toMatchObject({ base: 'EUR', quote: 'BOB', lastRateAsOf: null });
    // Cerrar dos veces: solo la primera lo hace.
    const close = () =>
      uow.run(w2, () =>
        repo.close({
          id: episode!.id,
          workspaceId: w2,
          closedAt: '2026-10-13T16:00:00.000Z',
          recoveredRateId: null,
          reason: 'PAIR_REMOVED',
        }),
      );
    expect([await close(), await close()]).toEqual([true, false]);
    expect(await open(w2)).toBe(true);
  });

  it('[TC-FX-PROVIDER-038] RLS: pf_app solo lee su workspace, no inserta; otro contexto no ve ni escribe filas ajenas; los CHECK de coherencia rechazan filas incoherentes', async () => {
    const own = await episodes(w2);
    expect(own.length).toBeGreaterThan(0);
    expect(await episodes(w1)).toHaveLength(0);
    await expect(
      inTx(app, w2, (c) =>
        c.query(
          `INSERT INTO fx.rate_feed_episode (id, workspace_id, base_currency, quote_currency, opened_at)
           VALUES (gen_random_uuid(), $1, 'USD', 'BOB', now())`,
          [w2],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // pf_worker con el contexto de OTRO workspace no puede insertar en este (WITH CHECK de la política).
    await expect(
      inTx(worker, w1, (c) =>
        c.query(
          `INSERT INTO fx.rate_feed_episode (id, workspace_id, base_currency, quote_currency, opened_at)
           VALUES (gen_random_uuid(), $1, 'USD', 'BOB', now())`,
          [w2],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // CHECK: closed_at sin closed_reason; recovered_rate_id con un motivo que no es RECOVERED; base = quote.
    for (const sqlText of [
      `INSERT INTO fx.rate_feed_episode (id, workspace_id, base_currency, quote_currency, opened_at, closed_at)
       VALUES (gen_random_uuid(), $1, 'USD', 'BOB', now(), now())`,
      `INSERT INTO fx.rate_feed_episode (id, workspace_id, base_currency, quote_currency, opened_at)
       VALUES (gen_random_uuid(), $1, 'BOB', 'BOB', now())`,
    ]) {
      await expect(inTx(worker, w2, (c) => c.query(sqlText, [w2]))).rejects.toMatchObject({ code: '23514' });
    }
  });
});

describe('Ciclo de providers sobre PostgreSQL: episodio, evento y aviso en la misma unidad de trabajo', () => {
  const run = ingestion;

  it('[TC-FX-PROVIDER-038] 14:00Z no abre; 14:15Z abre USDT/BOB desde 08:00Z con un evento válido y un aviso; 14:30Z y 15:00Z no repiten', async () => {
    active.clear();
    active.add(w1);
    await setPairs(w1, u1, [
      ['USDT', 'BOB'],
      ['EUR', 'BOB'],
    ]);
    clock.set(Instant.parse('2026-10-13T08:05:00Z'));
    paralelo.failure = null;
    paralelo.latest = [sample('USDT', '12.02', '2026-10-13T08:00:00Z')];
    await run().poll();
    expect(await episodes(w1)).toHaveLength(0);

    paralelo.failure = new ProviderError('PROVIDER_UNAVAILABLE', 'unexpected HTTP 503', 503);
    for (const t of ['14:00:00', '14:15:00', '14:30:00', '15:00:00']) {
      clock.set(Instant.parse(`2026-10-13T${t}Z`));
      await run().poll();
      if (t === '14:00:00') expect(await episodes(w1)).toHaveLength(0);
    }
    const rows = await episodes(w1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pair: 'USDT/BOB',
      opened_at: '2026-10-13T14:15:00.000Z',
      last_rate_as_of: '2026-10-13T08:00:00.000Z',
      closed_at: null,
    });
    const stale = await events(w1, 'fx.RateFeedStale');
    expect(stale).toHaveLength(1);
    expect(() => registry.validate(stale[0] as EventEnvelope)).not.toThrow();
    expect(stale[0]?.payload).toMatchObject({
      episodeId: rows[0]?.id,
      base: 'USDT',
      quote: 'BOB',
      lastRateAsOf: '2026-10-13T08:00:00.000Z',
      staleAfterSeconds: 21600,
    });
    expect(stale[0]?.actor.type).toBe('SYSTEM');
    expect(notified.filter((f) => f.workspaceId === w1).map((f) => f.type)).toEqual(['FX_RATE_FEED_STALE']);
    expect(await probeCount()).toBe(1);
  });

  it('[TC-FX-PROVIDER-039] una tasa fresca cierra el episodio con recovered_rate_id y un único evento válido; el estado por par informa el episodio abierto antes', async () => {
    const views = new RatePairViews({
      uow: new PgFxUnitOfWork(app),
      rates: new PgExchangeRateRepository(),
      pairs: new RatePairResolver({
        pairs: new PgRatePairListRepository(),
        currencies: new PgCurrencyRepository(),
        workspaces: { settingsOf: async () => ({ baseCurrency: 'BOB', timeZone: 'America/La_Paz' }) },
      }),
      clock,
      settings: settings(),
      episodes: new PgRateFeedEpisodeRepository(),
    });
    const status = await appUow.run({ userId: u1, workspaceId: w1 }, () => views.status(w1));
    expect(status.find((s) => s.base === 'USDT')).toMatchObject({
      coverage: 'AUTOMATIC',
      openEpisode: { openedAt: '2026-10-13T14:15:00.000Z', lastRateAsOf: '2026-10-13T08:00:00.000Z' },
    });
    // EUR/BOB (solo manual) no tiene cobertura ni episodio.
    expect(status.find((s) => s.base === 'EUR')).toMatchObject({
      coverage: 'MANUAL_ONLY',
      openEpisode: null,
    });

    clock.set(Instant.parse('2026-10-13T16:00:00Z'));
    paralelo.failure = null;
    paralelo.latest = [sample('USDT', '12.05', '2026-10-13T15:58:00Z')];
    await run().poll();
    clock.set(Instant.parse('2026-10-13T16:15:00Z'));
    await run().poll();
    const rows = await episodes(w1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ closed_at: '2026-10-13T16:00:00.000Z', closed_reason: 'RECOVERED' });
    expect(rows[0]?.recovered_rate_id).toMatch(/^[0-9a-f-]{36}$/);
    const recovered = await events(w1, 'fx.RateFeedRecovered');
    expect(recovered).toHaveLength(1);
    expect(() => registry.validate(recovered[0] as EventEnvelope)).not.toThrow();
    expect(recovered[0]?.payload).toMatchObject({
      episodeId: rows[0]?.id,
      rateId: rows[0]?.recovered_rate_id,
      asOf: '2026-10-13T15:58:00.000Z',
    });
    const after = await appUow.run({ userId: u1, workspaceId: w1 }, () => views.status(w1));
    expect(after.find((s) => s.base === 'USDT')?.openEpisode).toBeNull();
  });

  it('[TC-NOTIFICATIONS-FX-009] un error del puerto de NOTIFY revierte episodio, evento y aviso del workspace; el ciclo siguiente reintenta; el otro workspace no se detiene', async () => {
    active.clear();
    active.add(w1);
    active.add(w2);
    await setPairs(w2, u2, [['USDT', 'BOB']]);
    clock.set(Instant.parse('2026-10-14T08:00:00Z'));
    paralelo.failure = null;
    paralelo.latest = [sample('USDT', '12.05', '2026-10-14T08:00:00Z')];
    await run().poll();
    const before = {
      w1: (await episodes(w1)).length,
      w2: (await episodes(w2)).length,
      probe: await probeCount(),
      staleEvents: (await events(w1, 'fx.RateFeedStale')).length,
    };
    paralelo.failure = new ProviderError('PROVIDER_UNAVAILABLE', '503', 503);
    clock.set(Instant.parse('2026-10-14T14:15:00Z'));
    faults.notify = new Error('NOTIFY caído');
    const failing = run();
    await failing.poll();
    expect(failing.lastFeedCheck).toMatchObject({ failed: 2, opened: 0 });
    expect(failing.lastFeedCheck.errors).toEqual(['Error', 'Error']);
    expect((await episodes(w1)).length).toBe(before.w1);
    expect((await episodes(w2)).length).toBe(before.w2);
    expect((await events(w1, 'fx.RateFeedStale')).length).toBe(before.staleEvents);
    expect(await probeCount()).toBe(before.probe);

    faults.notify = null;
    clock.set(Instant.parse('2026-10-14T14:30:00Z'));
    const retry = run();
    await retry.poll();
    expect(retry.lastFeedCheck).toMatchObject({ failed: 0, opened: 2 });
    expect((await episodes(w1)).length).toBe(before.w1 + 1);
    expect((await episodes(w2)).length).toBe(before.w2 + 1);
    expect(await probeCount()).toBe(before.probe + 2);
  });
});

describe('Muestra retenida sobre PostgreSQL (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-040] BTC/USDT 72000.00 sobre 65000.00 publica un único evento válido y un aviso; repetir el ciclo y pasar 3 días no publican otro', async () => {
    active.clear();
    active.add(w1);
    // `fx.provider_run` es de la instalación: se deja a paralelo.bo sin fallas seguidas para las demás pruebas de la corrida.
    paralelo.failure = null;
    await setPairs(w1, u1, [['BTC', 'USDT']]);
    clock.set(Instant.parse('2026-10-20T14:00:00Z'));
    crypto.prices = { BTC: { price: '65000.00', asOf: '2026-10-20T14:00:00.000Z' } };
    await ingestion().poll();
    const factsBefore = notified.filter((f) => f.type === 'FX_RATE_ANOMALY_RETAINED').length;
    clock.set(Instant.parse('2026-10-20T14:15:00Z'));
    crypto.prices = { BTC: { price: '72000.00', asOf: '2026-10-20T14:10:00.000Z' } };
    await ingestion().poll();
    await ingestion().poll();
    clock.set(Instant.parse('2026-10-23T14:15:00Z'));
    await ingestion().poll();
    const retained = (await events(w1, 'fx.RateAnomalyRetained')).filter(
      (e) => (e.payload as { base?: string }).base === 'BTC',
    );
    expect(retained).toHaveLength(1);
    expect(() => registry.validate(retained[0] as EventEnvelope)).not.toThrow();
    expect(retained[0]?.payload).toMatchObject({
      base: 'BTC',
      quote: 'USDT',
      rateType: 'MARKET',
      provider: CRYPTO,
      variationPct: '10.7692',
      thresholdPct: '10',
    });
    expect(Number((retained[0]?.payload as { value: string }).value)).toBe(72000);
    expect(Number((retained[0]?.payload as { baselineValue: string }).baselineValue)).toBe(65000);
    const facts = notified.filter((f) => f.type === 'FX_RATE_ANOMALY_RETAINED');
    expect(facts.length - factsBefore).toBe(1);
    // La muestra sigue retenida: marcada y sin revisión.
    const held = await inTx(
      app,
      w1,
      async (c) =>
        (
          await c.query<{ anomaly_flagged: boolean; reviews: string }>(
            `SELECT r.anomaly_flagged, (SELECT count(*)::text FROM fx.rate_anomaly_review v WHERE v.exchange_rate_id = r.id) AS reviews
             FROM fx.exchange_rate r WHERE r.workspace_id = $1 AND r.id = $2`,
            [w1, (retained[0]?.payload as { rateId: string }).rateId],
          )
        ).rows[0],
    );
    expect(held).toEqual({ anomaly_flagged: true, reviews: '0' });
  });
});

// ───────────────────────────────────────────────────────────────────────────── aviso agrupado (refine-rate-anomaly-alert-grouping)

describe('Aviso agrupado de muestras retenidas sobre PostgreSQL (refine-rate-anomaly-alert-grouping)', () => {
  type PRateType = 'PARALLEL' | 'PARALLEL_BUY' | 'PARALLEL_SELL';
  const typed = (rateType: PRateType, value: string, asOf: string) =>
    ProviderSample.of({
      provider: 'PARALELO_BO',
      base: 'USDT',
      quote: 'BOB',
      rateType,
      value,
      asOf,
      fetchedAt: clock.now().toString(),
      rawPayload: RAW,
      sourceLabel: 'paralelo.bo (P2P USDT/BOB)',
    });
  const jump = (asOf: string, values: [string, string, string] = ['12.80', '12.70', '12.90']) => [
    typed('PARALLEL', values[0], asOf),
    typed('PARALLEL_BUY', values[1], asOf),
    typed('PARALLEL_SELL', values[2], asOf),
  ];
  const usdtFacts = () =>
    notified.filter(
      (f) => f.type === 'FX_RATE_ANOMALY_RETAINED' && (f.payload as { base?: string }).base === 'USDT',
    );
  const group = (f: NotificationIntakeFact | undefined) =>
    f?.payload as unknown as {
      anchorRateId: string;
      reviewRateId: string;
      pendingCount: number;
      retainedCount: number;
      providers: string[];
      peak: { rateType: string; value: string; baselineValue: string; variationPct: string };
    };
  const heldIds = (ws: string) =>
    inTx(app, ws, async (c) =>
      (
        await c.query<{ id: string }>(
          `SELECT id::text FROM fx.exchange_rate WHERE workspace_id = $1 AND anomaly_flagged AND base_currency = 'USDT' ORDER BY created_at, id`,
          [ws],
        )
      ).rows.map((r) => r.id),
    );
  const review = (ws: string, user: string, rateId: string, decidedAt: string) =>
    appUow.run({ userId: user, workspaceId: ws }, () =>
      new PgRateAnomalyReviewRepository().insert({
        rateId,
        workspaceId: ws,
        decision: 'CONFIRMED',
        reason: 'verificado',
        decidedBy: user,
        decidedAt,
      }),
    );

  it('[TC-NOTIFICATIONS-FX-010] [TC-NOTIFICATIONS-FX-012] [TC-NOTIFICATIONS-FX-013] [TC-NOTIFICATIONS-FX-014] [TC-NOTIFICATIONS-FX-016] salto, ciclo siguiente, revisión parcial y grupo nuevo: una clave por grupo, el ancla estable y la lectura SQL de la isla vigente', async () => {
    active.clear();
    active.add(w2);
    paralelo.failure = null;
    await setPairs(w2, u2, [['USDT', 'BOB']]);
    // Líneas base a las 08:00Z de ese día.
    clock.set(Instant.parse('2026-10-27T08:05:00Z'));
    paralelo.latest = jump('2026-10-27T08:00:00Z', ['12.05', '12.00', '12.10']);
    await ingestion().poll();
    expect(usdtFacts()).toHaveLength(0);

    // Ciclo del salto: tres muestras retenidas ⇒ UN aviso con 3 pendientes y tres eventos.
    clock.set(Instant.parse('2026-10-27T14:00:00Z'));
    paralelo.latest = jump('2026-10-27T13:55:00Z');
    await ingestion().poll();
    expect(usdtFacts()).toHaveLength(1);
    const first = group(usdtFacts()[0]);
    expect(first).toMatchObject({
      pendingCount: 3,
      retainedCount: 3,
      providers: ['PARALELO_BO'],
      peak: { rateType: 'PARALLEL_SELL', variationPct: '6.6116' },
    });
    expect(Number(first.peak.value)).toBe(12.9);
    expect(Number(first.peak.baselineValue)).toBe(12.1);
    const ids = await heldIds(w2);
    expect(ids).toHaveLength(3);
    expect(first.anchorRateId).toBe(ids[0]);
    expect(
      (await events(w2, 'fx.RateAnomalyRetained')).filter(
        (e) => (e.payload as { base?: string }).base === 'USDT',
      ),
    ).toHaveLength(3);

    // Reproceso del ciclo: sin muestras nuevas ni otra llamada al puerto.
    await ingestion().poll();
    expect(usdtFacts()).toHaveLength(1);

    // Ciclo siguiente con vigencia nueva: misma clave, 6 pendientes.
    clock.set(Instant.parse('2026-10-27T14:15:00Z'));
    paralelo.latest = jump('2026-10-27T14:10:00Z');
    await ingestion().poll();
    expect(usdtFacts()).toHaveLength(2);
    expect(group(usdtFacts()[1])).toMatchObject({ anchorRateId: first.anchorRateId, pendingCount: 6 });

    // Revisión parcial: la más antigua se confirma; el grupo no se corta y el enlace va a la pendiente más antigua.
    await review(w2, u2, ids[0] as string, '2026-10-27T14:20:00.000Z');
    clock.set(Instant.parse('2026-10-27T14:30:00Z'));
    paralelo.latest = jump('2026-10-27T14:25:00Z', ['13.60', '13.50', '13.70']);
    await ingestion().poll();
    const partial = group(usdtFacts()[2]);
    expect(partial.anchorRateId).toBe(first.anchorRateId);
    expect(partial.reviewRateId).toBe(ids[1]);
    expect(partial.pendingCount).toBeGreaterThanOrEqual(5);
    expect(partial.retainedCount).toBeGreaterThan(partial.pendingCount);

    // Se revisa TODO el grupo; un salto nuevo abre otro con otra clave y 1 pendiente.
    for (const id of await heldIds(w2)) {
      if (id === ids[0]) continue;
      await review(w2, u2, id, '2026-10-27T15:00:00.000Z');
    }
    clock.set(Instant.parse('2026-10-27T18:00:00Z'));
    paralelo.latest = [typed('PARALLEL', '16.00', '2026-10-27T17:55:00Z')];
    await ingestion().poll();
    const fresh = group(usdtFacts().at(-1));
    expect(fresh.anchorRateId).not.toBe(first.anchorRateId);
    expect(fresh).toMatchObject({ pendingCount: 1, retainedCount: 1 });
  }, 60_000);

  it('[TC-NOTIFICATIONS-FX-010] retainedOfPair devuelve solo desde el ancla del grupo vigente y existe el índice parcial', async () => {
    const rates = new PgExchangeRateRepository();
    const rows = await new PgFxUnitOfWork(worker).run(w2, () => rates.retainedOfPair(w2, 'USDT', 'BOB'));
    // El grupo anterior (todo revisado antes de las 18:00Z) queda fuera: solo la muestra del grupo nuevo.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decidedAt: null, rateType: 'PARALLEL' });
    const { rows: plan } = await migrator.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'fx' AND indexname = 'exchange_rate_retained_ix'`,
    );
    expect(plan[0]?.indexdef).toMatch(/WHERE anomaly_flagged/);
  });

  it('[TC-NOTIFICATIONS-FX-010] el bloqueo consultivo serializa las transacciones del mismo workspace y no bloquea a otro', async () => {
    const uow = new PgFxUnitOfWork(worker);
    const rates = new PgExchangeRateRepository();
    const order: string[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const a = uow.run(w2, async () => {
      await rates.lockAnomalyGroups(w2);
      order.push('a-lock');
      await sleep(300);
      order.push('a-done');
    });
    await sleep(80);
    const b = uow.run(w2, async () => {
      await rates.lockAnomalyGroups(w2);
      order.push('b-lock');
    });
    const other = uow.run(w1, async () => {
      await rates.lockAnomalyGroups(w1);
      order.push('other-lock');
    });
    await Promise.all([a, b, other]);
    expect(order.indexOf('other-lock')).toBeLessThan(order.indexOf('a-done'));
    expect(order.indexOf('b-lock')).toBeGreaterThan(order.indexOf('a-done'));
  });
});
