import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { EventSchemaRegistry, PgOutboxWriter, type EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant, DomainError } from '@pf/shared-kernel';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { FxService } from '../../src/application/fx.service.js';
import { MarketRateIngestion } from '../../src/application/market-rate-ingestion.js';
import { parseFxProviderSettings } from '../../src/application/provider-settings.js';
import type { FxDeps } from '../../src/application/ports/index.js';
import {
  PgCurrencyRepository,
  PgExchangeRateRepository,
  PgFxUnitOfWork,
  PgRateAnomalyReviewRepository,
  PgRatePreferenceRepository,
  uuidV7Ids,
} from '../../src/infrastructure/pg-fx.js';
import { PgProviderRunRepository } from '../../src/infrastructure/pg-provider-runs.js';
import { fixture, FixtureServer } from '../../src/infrastructure/providers/fixture-server.test-support.js';
import { DolarApiBoProvider } from '../../src/infrastructure/providers/dolarapi-bo.provider.js';
import { ParaleloBoProvider } from '../../src/infrastructure/providers/paralelo-bo.provider.js';
import { ProviderHttpClient } from '../../src/infrastructure/providers/provider-http-client.js';

// Providers de tasas sobre PostgreSQL real (Testcontainers; tarea 4.1 y 4.4): columnas inmutables, índice único de
// idempotencia, fx.rate_anomaly_review (WS append-only), fx.provider_run (instalación), copia por workspace con RLS,
// outbox validado contra contracts/events y rol pf_workspace_directory. Providers simulados por un servidor HTTP local
// con las respuestas grabadas (sin red).
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const EVENTS_DIR = fileURLToPath(new URL('../../../../../contracts/events/', import.meta.url));
const server = new FixtureServer();
const clock = new FixedClock(Instant.parse('2026-10-02T09:00:00Z'));
let app: Pool;
let worker: Pool;
let migrator: Pool;
let appUow: PgUnitOfWork;
let u1: string;
const w1 = randomUUID();
const w2 = randomUUID();
const active = new Set<string>();
let registry: EventSchemaRegistry;

async function pgError(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    return (err as { code?: string }).code ?? (err instanceof DomainError ? err.code : undefined);
  }
  return undefined;
}

async function provision(label: string, ws: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/fx-providers', $1, $2, $3) AS id`,
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

/** Consulta como `client` dentro de una transacción con contexto RLS (rollback). */
async function inTx<T>(
  pool: Pool,
  ws: string | null,
  user: string | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (ws) await c.query(`SELECT set_config('app.workspace_id', $1, true)`, [ws]);
    if (user) await c.query(`SELECT set_config('app.user_id', $1, true)`, [user]);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

function ingestion(workspaces: () => string[] = () => [...active]) {
  const http = new ProviderHttpClient({ clock, timeoutMs: 2000, allowedHosts: ['127.0.0.1'] });
  const writer = new PgOutboxWriter(registry);
  return new MarketRateIngestion({
    uow: new PgFxUnitOfWork(worker),
    rates: new PgExchangeRateRepository(),
    currencies: new PgCurrencyRepository(),
    preferences: new PgRatePreferenceRepository(),
    runs: new PgProviderRunRepository(worker),
    workspaces: {
      list: async () => workspaces().map((workspaceId) => ({ workspaceId, timeZone: 'America/La_Paz' })),
    },
    outbox: { append: async (e) => void (await writer.append(e)) },
    ids: uuidV7Ids,
    clock,
    settings: parseFxProviderSettings({ FX_PROVIDER_FALLBACK: 'none', FX_PROVIDER_OFFICIAL: 'none' }),
    providers: {
      PARALELO_BO: new ParaleloBoProvider(http, clock, server.baseUrl),
      DOLARAPI_BO: new DolarApiBoProvider(http, server.baseUrl),
    },
  });
}

const rowsOf = (ws: string, user: string | null = null, rateType = 'PARALLEL') =>
  inTx(
    app,
    ws,
    user,
    async (c) =>
      (
        await c.query<{
          id: string;
          base: string;
          rate: string;
          provider: string;
          source: string;
          as_of: string;
          fetched_at: string;
          raw_payload: string;
          anomaly_flagged: boolean;
          anomaly_variation_pct: string | null;
        }>(
          `SELECT id::text, base_currency AS base, trim_scale(rate)::text AS rate, provider, source,
                to_char(as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS as_of,
                to_char(fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fetched_at,
                raw_payload, anomaly_flagged, anomaly_variation_pct::text
           FROM fx.exchange_rate WHERE workspace_id = $1 AND source = 'PROVIDER' AND rate_type = $2
          ORDER BY as_of, base_currency`,
          [ws, rateType],
        )
      ).rows,
  );

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  appUow = new PgUnitOfWork(app);
  registry = EventSchemaRegistry.fromDirectory(EVENTS_DIR);
  u1 = await provision('fxp-w1', w1);
  await provision('fxp-w2', w2);
  await server.start();
});

afterAll(async () => {
  await server.stop();
  await app?.end();
  await worker?.end();
  await migrator?.end();
});

describe('PollMarketRates sobre PostgreSQL (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-005] 09:00 registra 2 tasas inmutables con procedencia y 2 eventos válidos; 09:15 con el mismo timestamp no registra nada', async () => {
    active.clear();
    active.add(w1);
    server.route('/api/v1/rate', { body: fixture('paralelo-bo/rate.ok.json') });
    clock.set(Instant.parse('2026-10-02T09:00:00Z'));
    // Mediana + compra + venta por par (decisión del owner 2026-10-03).
    expect((await ingestion().poll()).map((r) => [r.provider, r.outcome, r.newSamples])).toEqual([
      ['PARALELO_BO', 'OK', 6],
    ]);
    const rows = await rowsOf(w1);
    expect(rows.map((r) => [r.base, r.rate, r.provider, r.as_of, r.fetched_at])).toEqual([
      ['USD', '12.02', 'PARALELO_BO', '2026-10-02T08:53:07.532Z', '2026-10-02T09:00:00.000Z'],
      ['USDT', '12.02', 'PARALELO_BO', '2026-10-02T08:53:07.532Z', '2026-10-02T09:00:00.000Z'],
    ]);
    expect(rows.every((r) => r.raw_payload === fixture('paralelo-bo/rate.ok.json'))).toBe(true);
    const events = await inTx(worker, null, null, async (c) =>
      (
        await c.query<{ envelope: EventEnvelope }>(
          `SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = 'fx.RateRecorded' ORDER BY sequence`,
          [w1],
        )
      ).rows.map((r) =>
        typeof r.envelope === 'string' ? (JSON.parse(r.envelope) as EventEnvelope) : r.envelope,
      ),
    );
    expect(events).toHaveLength(6);
    for (const e of events) {
      expect(() => registry.validate(e)).not.toThrow();
      expect(e.actor).toEqual({ type: 'SYSTEM', id: 'fx-provider:PARALELO_BO' });
      expect(e.payload).toMatchObject({ source: 'PROVIDER', provider: 'PARALELO_BO', anomalyFlagged: false });
    }

    clock.set(Instant.parse('2026-10-02T09:15:00Z'));
    expect((await ingestion().poll())[0]?.outcome).toBe('NO_NEW_SAMPLE');
    expect(await rowsOf(w1)).toHaveLength(2);
    const runs = await new PgProviderRunRepository(app).recent('PARALELO_BO', 10, ['POLL']);
    expect(runs.slice(0, 2).map((r) => [r.outcome, r.startedAt])).toEqual([
      ['NO_NEW_SAMPLE', '2026-10-02T09:15:00.000Z'],
      ['OK', '2026-10-02T09:00:00.000Z'],
    ]);
    // Inmutables: ni pf_app ni pf_worker pueden actualizar ni borrar (INV-011).
    const id = rows[0]!.id;
    for (const pool of [app, worker]) {
      expect(
        await pgError(
          inTx(pool, w1, null, (c) => c.query(`UPDATE fx.exchange_rate SET rate = 99 WHERE id = $1`, [id])),
        ),
      ).toBe('42501');
      expect(
        await pgError(
          inTx(pool, w1, null, (c) => c.query(`DELETE FROM fx.exchange_rate WHERE id = $1`, [id])),
        ),
      ).toBe('42501');
    }
    expect((await rowsOf(w1))[0]?.rate).toBe('12.02');
  });

  it('[TC-FX-PROVIDER-016] compra 12.12 y venta 11.92 quedan como PARALLEL_BUY/PARALLEL_SELL inmutables (CHECK ampliado por la migración)', async () => {
    const buy = await rowsOf(w1, null, 'PARALLEL_BUY');
    const sell = await rowsOf(w1, null, 'PARALLEL_SELL');
    expect(buy.map((r) => [r.base, r.rate, r.provider, r.as_of])).toEqual([
      ['USD', '12.12', 'PARALELO_BO', '2026-10-02T08:53:07.532Z'],
      ['USDT', '12.12', 'PARALELO_BO', '2026-10-02T08:53:07.532Z'],
    ]);
    expect(sell.map((r) => [r.base, r.rate])).toEqual([
      ['USD', '11.92'],
      ['USDT', '11.92'],
    ]);
    // Migración 20261004130000: los tres CHECK de tipo de tasa admiten compra/venta y siguen cerrados al resto.
    const { rows } = await migrator.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('exchange_rate_rate_type_check', 'rate_preference_rate_type_check',
                          'conversion_detail_reference_rate_type_check') ORDER BY conname`,
    );
    expect(rows.map((r) => r.conname)).toEqual([
      'conversion_detail_reference_rate_type_check',
      'exchange_rate_rate_type_check',
      'rate_preference_rate_type_check',
    ]);
    for (const r of rows) {
      expect(r.def).toContain("'PARALLEL_BUY'");
      expect(r.def).toContain("'PARALLEL_SELL'");
      expect(r.def).not.toContain('MID');
    }
  });

  it('[TC-FX-PROVIDER-013] dos workspaces: una sola solicitud por ciclo y filas propias aisladas por RLS', async () => {
    active.clear();
    active.add(w1);
    active.add(w2);
    server.requests.length = 0;
    server.route('/api/v1/rate', { body: fixture('paralelo-bo/rate.18-decimals.json') });
    clock.set(Instant.parse('2026-10-02T09:30:00Z'));
    await ingestion().poll();
    expect(server.requestsTo('/api/v1/rate')).toHaveLength(1);
    const r2 = await rowsOf(w2);
    expect(r2.map((r) => r.rate)).toEqual(['12.020000000000000001', '12.020000000000000001']);
    // Desde el contexto de w2 no se ven las filas de w1.
    const visible = await inTx(
      app,
      w2,
      null,
      async (c) =>
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM fx.exchange_rate WHERE workspace_id = $1`,
            [w1],
          )
        ).rows[0]?.n,
    );
    expect(visible).toBe('0');
  });

  it('[TC-FX-PROVIDER-010] anomalía: la muestra 13.50 queda marcada; la revisión es única, append-only y aislada', async () => {
    active.clear();
    active.add(w1);
    server.route('/api/v1/rate', { body: fixture('paralelo-bo/rate.anomaly-13.50.json') });
    clock.set(Instant.parse('2026-10-02T09:45:00Z'));
    await ingestion().poll();
    const jump = (await rowsOf(w1)).find((r) => r.rate === '13.5' && r.base === 'USD');
    // Línea base: la última aceptada (12.020000000000000001 de las 09:08Z) → +12.3128 %.
    expect([jump?.anomaly_flagged, jump?.anomaly_variation_pct]).toEqual([true, '12.3128']);
    const fxDeps = {
      uow: new PgFxUnitOfWork(app),
      rates: new PgExchangeRateRepository(),
      currencies: new PgCurrencyRepository(),
      preferences: new PgRatePreferenceRepository(),
      reviews: new PgRateAnomalyReviewRepository(),
      workspaces: { settingsOf: async () => ({ baseCurrency: 'BOB', timeZone: 'America/La_Paz' }) },
      outbox: { append: async () => undefined },
      audit: { append: async () => undefined },
      ids: uuidV7Ids,
      clock,
    } satisfies FxDeps;
    const service = new FxService(fxDeps);
    const inW1 = <T>(fn: () => Promise<T>) => appUow.run({ userId: u1, workspaceId: w1 }, fn);
    const reviewed = await inW1(() =>
      service.reviewAnomaly({
        workspaceId: w1,
        userId: u1,
        rateId: jump!.id,
        decision: 'CONFIRM',
        reason: 'devaluación anunciada',
      }),
    );
    expect(reviewed.anomalyReview?.decision).toBe('CONFIRMED');
    const again = await pgError(
      inW1(() =>
        service.reviewAnomaly({
          workspaceId: w1,
          userId: u1,
          rateId: jump!.id,
          decision: 'REJECT',
          reason: 'otra',
        }),
      ),
    );
    expect(again).toBe('FX_RATE_ANOMALY_ALREADY_REVIEWED');
    const normal = (await rowsOf(w1)).find((r) => !r.anomaly_flagged)!;
    expect(
      await pgError(
        inTx(app, w1, u1, (c) =>
          c.query(
            `INSERT INTO fx.rate_anomaly_review (exchange_rate_id, workspace_id, decision, reason, decided_by) VALUES ($1, $2, 'CONFIRMED', 'no aplica', $3)`,
            [normal.id, w1, u1],
          ),
        ),
      ),
    ).toBe('23514');
    for (const sqlText of [
      'UPDATE fx.rate_anomaly_review SET decision = $2 WHERE exchange_rate_id = $1',
      'DELETE FROM fx.rate_anomaly_review WHERE exchange_rate_id = $1 AND $2 = $2',
    ]) {
      expect(await pgError(inTx(app, w1, u1, (c) => c.query(sqlText, [jump!.id, 'REJECTED'])))).toBe('42501');
    }
    const seenFromW2 = await inTx(
      app,
      w2,
      null,
      async (c) =>
        (await c.query(`SELECT 1 FROM fx.rate_anomaly_review WHERE exchange_rate_id = $1`, [jump!.id])).rows
          .length,
    );
    expect(seenFromW2).toBe(0);
  });
});

describe('Carga histórica sobre PostgreSQL (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-006] 787 días por par (día en curso excluido), reimportación = 0 y preferencias PARALLEL sembradas', async () => {
    const ws = randomUUID();
    await provision('fxp-backfill', ws);
    server.route('/api/v1/historical.json', { body: fixture('paralelo-bo/historical.sample.json') });
    clock.set(Instant.parse('2026-10-02T12:00:00Z'));
    const svc = ingestion(() => [ws]);
    await svc.seedPreferences(ws);
    expect((await svc.backfill({ workspaceId: ws, timeZone: 'America/La_Paz' }))?.newSamples).toBe(1574);
    const rows = await rowsOf(ws);
    expect(rows.filter((r) => r.base === 'USD')).toHaveLength(787);
    expect(rows.find((r) => r.base === 'USD' && r.as_of === '2026-09-11T03:59:59.000Z')?.rate).toBe('11.96');
    expect(rows.some((r) => r.as_of >= '2026-10-02T04:00:00.000Z')).toBe(false);
    expect((await svc.backfill({ workspaceId: ws, timeZone: 'America/La_Paz' }))?.newSamples).toBe(0);
    const prefs = await inTx(app, ws, null, async (c) =>
      (
        await c.query<{ p: string }>(
          `SELECT base_currency || '/' || quote_currency || '=' || rate_type AS p FROM fx.rate_preference WHERE workspace_id = $1 ORDER BY 1`,
          [ws],
        )
      ).rows.map((r) => r.p),
    );
    expect(prefs).toEqual(['USD/BOB=PARALLEL', 'USDT/BOB=PARALLEL']);
    const events = await inTx(
      worker,
      null,
      null,
      async (c) => (await c.query(`SELECT 1 FROM platform.outbox WHERE workspace_id = $1`, [ws])).rows.length,
    );
    expect(events).toBe(1);
  });
});

describe('Grants de las tablas nuevas (fx/market-rate-providers)', () => {
  it('fx.provider_run: pf_worker inserta y purga; pf_app solo lee', async () => {
    const id = randomUUID();
    const insert = (c: PoolClient) =>
      c.query(
        `INSERT INTO fx.provider_run (id, provider, kind, started_at, finished_at, outcome, latency_ms)
         VALUES ($1, 'PARALELO_BO', 'POLL', now(), now(), 'OK', 5)`,
        [id],
      );
    expect(await pgError(inTx(app, null, null, insert))).toBe('42501');
    expect(await pgError(inTx(worker, null, null, insert))).toBeUndefined();
    expect(
      await pgError(inTx(app, null, null, (c) => c.query('SELECT count(*) FROM fx.provider_run'))),
    ).toBeUndefined();
    expect(await pgError(inTx(app, null, null, (c) => c.query('DELETE FROM fx.provider_run')))).toBe('42501');
  });

  it('pf_workspace_directory: el worker lista id y zona horaria de los workspaces activos, nunca otras columnas', async () => {
    const ids = await inTx(worker, null, null, async (c) => {
      await c.query('SET LOCAL ROLE pf_workspace_directory');
      return (
        await c.query<{ id: string }>(`SELECT id::text FROM iam.workspace WHERE status = 'ACTIVE'`)
      ).rows.map((r) => r.id);
    });
    expect(ids).toEqual(expect.arrayContaining([w1, w2]));
    const name = await pgError(
      inTx(worker, null, null, async (c) => {
        await c.query('SET LOCAL ROLE pf_workspace_directory');
        return c.query('SELECT name FROM iam.workspace');
      }),
    );
    expect(name).toBe('42501');
    expect(
      await pgError(inTx(app, null, null, (c) => c.query('SET LOCAL ROLE pf_workspace_directory'))),
    ).toBe('42501');
  });
});
