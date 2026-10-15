import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { EventSchemaRegistry, PgOutboxWriter, type EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MarketRateIngestion } from '../../src/application/market-rate-ingestion.js';
import { parseFxProviderSettings } from '../../src/application/provider-settings.js';
import { FakeInstitutionRateProvider } from '../../src/application/testing/fake-institution-provider.js';
import type { FxInstitutionProviderId } from '../../src/domain/index.js';
import {
  PgCurrencyRepository,
  PgExchangeRateRepository,
  PgFxUnitOfWork,
  PgRatePairListRepository,
  PgRatePreferenceRepository,
  uuidV7Ids,
} from '../../src/infrastructure/pg-fx.js';
import { PgProviderRunRepository } from '../../src/infrastructure/pg-provider-runs.js';

// Tasas por institución sobre PostgreSQL real (add-exchange-house-rate-providers tarea 4.8): índice de idempotencia por
// institución, CHECK de institution_code, RLS por workspace, CHECK de tipos y de providers ampliados, estado por
// institución y eventos válidos contra contracts/events. El provider es un DOBLE en memoria (no existe ningún adapter
// real): sin red. Las tablas de instalación (`fx.provider_run`) se comparten entre suites: provider propio de la corrida
// (id único) y limpieza en afterAll; nunca fallas seguidas ni fechas futuras.
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
const EVENTS_DIR = fileURLToPath(new URL('../../../../../contracts/events/', import.meta.url));
const clock = new FixedClock(Instant.parse('2026-10-08T16:10:00Z'));
const ID = `INSTRATE_IT_${randomUUID().slice(0, 8).toUpperCase()}` as FxInstitutionProviderId;
let app: Pool;
let worker: Pool;
let migrator: Pool;
let appUow: PgUnitOfWork;
let registry: EventSchemaRegistry;
let fake: FakeInstitutionRateProvider;
let unregister: () => void;
let owner: string;
const w1 = randomUUID();
const w2 = randomUUID();

async function provision(label: string, ws: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/fx-inst', $1, $2, $3) AS id`,
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
    FX_PROVIDER_INSTITUTION_RATES: ID.toLowerCase(),
  });

function ingestion() {
  const writer = new PgOutboxWriter(registry);
  return new MarketRateIngestion({
    uow: new PgFxUnitOfWork(worker),
    rates: new PgExchangeRateRepository(),
    currencies: new PgCurrencyRepository(),
    preferences: new PgRatePreferenceRepository(),
    pairs: new PgRatePairListRepository(),
    runs: new PgProviderRunRepository(worker),
    workspaces: {
      list: async () =>
        [w1, w2].map((workspaceId) => ({ workspaceId, timeZone: 'America/La_Paz', baseCurrency: 'BOB' })),
    },
    outbox: { append: async (e) => void (await writer.append(e)) },
    ids: uuidV7Ids,
    clock,
    settings: settings(),
    providers: { [ID]: fake },
  });
}

const rows = (ws: string) =>
  inTx(
    app,
    ws,
    async (c) =>
      (
        await c.query<{
          institution_code: string;
          rate_type: string;
          rate: string;
          as_of: string;
          provider: string;
          source: string;
        }>(
          `SELECT institution_code, rate_type, trim_scale(rate)::text AS rate, provider, source,
                  to_char(as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS as_of
             FROM fx.exchange_rate
            WHERE workspace_id = $1 AND provider = $2
            ORDER BY institution_code, rate_type, as_of`,
          [ws, ID],
        )
      ).rows,
  );

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  appUow = new PgUnitOfWork(app);
  registry = EventSchemaRegistry.fromDirectory(EVENTS_DIR);
  owner = await provision('fxi-w1', w1);
  await provision('fxi-w2', w2);
  fake = new FakeInstitutionRateProvider({ id: ID }, () => clock.now().toString());
  unregister = fake.register();
  // Monedas por defecto habilitadas en ambos workspaces: la lista de pares por defecto incluye USD/BOB.
  const currencies = new PgCurrencyRepository();
  for (const ws of [w1, w2]) {
    await new PgFxUnitOfWork(worker).run(ws, () => currencies.enable(ws, ['BOB', 'USD', 'USDT', 'EUR']));
  }
});

afterAll(async () => {
  unregister?.();
  // Deja la instalación como estaba: las corridas del provider de esta suite (tabla compartida entre suites).
  await worker?.query('DELETE FROM fx.provider_run WHERE provider = $1', [ID]);
  await app?.end();
  await worker?.end();
  await migrator?.end();
});

describe('Tasas por institución sobre PostgreSQL (fx/market-rate-providers)', () => {
  it('[TC-FX-INSTRATE-003] cada institución registra su tasa con el mismo provider, par, tipo y vigencia; repetir el ciclo no duplica (índice por institución)', async () => {
    fake.quotes = { BAD: { compra: '11.85' }, BBD: { compra: '12.03' } };
    fake.asOf = '2026-10-08T16:00:00.000Z';
    const svc = ingestion();
    const first = await svc.poll();
    expect(svc.lastWorkspaceFailures).toEqual([]);
    expect(first.map((r) => [r.provider, r.outcome, r.newSamples])).toEqual([[ID, 'OK', 4]]);
    for (const ws of [w1, w2]) {
      expect(await rows(ws)).toEqual([
        {
          institution_code: 'BAD',
          rate_type: 'BANK_SELL',
          rate: '11.85',
          as_of: '2026-10-08T16:00:00.000Z',
          provider: ID,
          source: 'PROVIDER',
        },
        {
          institution_code: 'BBD',
          rate_type: 'BANK_SELL',
          rate: '12.03',
          as_of: '2026-10-08T16:00:00.000Z',
          provider: ID,
          source: 'PROVIDER',
        },
      ]);
    }
    clock.set(Instant.parse('2026-10-08T17:10:00Z'));
    const again = await ingestion().poll();
    expect(again.map((r) => [r.outcome, r.newSamples])).toEqual([['NO_NEW_SAMPLE', 0]]);
    expect(await rows(w1)).toHaveLength(2);
  });

  it('[TC-FX-INSTRATE-004] la compra y la venta de la misma entidad conviven, con lectura exacta de 11.8537', async () => {
    clock.set(Instant.parse('2026-10-09T16:10:00Z'));
    fake.asOf = '2026-10-09T16:00:00.000Z';
    fake.quotes = { BAD: { compra: '11.8537', venta: '11.95' } };
    await ingestion().poll();
    const day2 = (await rows(w1)).filter((r) => r.as_of.startsWith('2026-10-09'));
    expect(day2.map((r) => [r.institution_code, r.rate_type, r.rate])).toEqual([
      ['BAD', 'BANK_BUY', '11.95'],
      ['BAD', 'BANK_SELL', '11.8537'],
    ]);
  });

  it('el evento fx.RateRecorded de una tasa por institución valida contra contracts/events y lleva institutionCode', async () => {
    const events = await inTx(worker, null, async (c) =>
      (
        await c.query<{ envelope: EventEnvelope }>(
          `SELECT envelope FROM platform.outbox
            WHERE workspace_id = $1 AND event_type = 'fx.RateRecorded'
              AND envelope -> 'payload' ->> 'provider' = $2
            ORDER BY sequence`,
          [w1, ID],
        )
      ).rows.map((r) =>
        typeof r.envelope === 'string' ? (JSON.parse(r.envelope) as EventEnvelope) : r.envelope,
      ),
    );
    expect(events.length).toBe(4);
    for (const e of events) expect(() => registry.validate(e)).not.toThrow();
    expect(events.map((e) => (e.payload as { institutionCode?: string }).institutionCode).sort()).toEqual([
      'BAD',
      'BAD',
      'BAD',
      'BBD',
    ]);
  });

  it('[TC-FX-INSTRATE-007] el estado por institución lee la última tasa aceptada de cada (institución, tipo) y nunca llama al provider', async () => {
    const repo = new PgExchangeRateRepository();
    const calls = fake.calls;
    const latest = await appUow.run({ userId: owner, workspaceId: w1 }, () =>
      repo.latestInstitutionRates(w1, ID),
    );
    expect(
      latest
        .map((s) => [s.rate.snapshot.institutionCode, s.rate.snapshot.rateType, s.rate.valueText, s.rate.snapshot.asOf])
        .sort(),
    ).toEqual([
      ['BAD', 'BANK_BUY', '11.95', '2026-10-09T16:00:00.000Z'],
      ['BAD', 'BANK_SELL', '11.8537', '2026-10-09T16:00:00.000Z'],
      ['BBD', 'BANK_SELL', '12.03', '2026-10-08T16:00:00.000Z'],
    ]);
    expect(fake.calls).toBe(calls);
    // latestAccepted distingue la institución del feed.
    const bad = await appUow.run({ userId: owner, workspaceId: w1 }, () =>
      repo.latestAccepted(w1, {
        provider: ID,
        base: 'USD',
        quote: 'BOB',
        rateType: 'BANK_SELL',
        institutionCode: 'BBD',
      }),
    );
    expect(bad?.rate.valueText).toBe('12.03');
  });

  it('RLS: cada workspace solo ve sus copias; sin workspace en contexto la app no ve ninguna', async () => {
    const repo = new PgExchangeRateRepository();
    const mine = await appUow.run({ userId: owner, workspaceId: w1 }, () => repo.latestInstitutionRates(w1, ID));
    expect(mine.every((s) => s.rate.snapshot.workspaceId === w1)).toBe(true);
    const crossed = await appUow.run({ userId: owner, workspaceId: w2 }, () =>
      repo.latestInstitutionRates(w1, ID),
    );
    expect(crossed).toEqual([]);
    // Sin workspace en el contexto de la transacción la RLS rechaza la consulta (PF002), no devuelve filas ajenas.
    await expect(
      inTx(app, null, (c) => c.query('SELECT count(*) FROM fx.exchange_rate WHERE provider = $1', [ID])),
    ).rejects.toMatchObject({ code: 'PF002' });
    const { rows: forced } = await migrator.query<{ forced: boolean }>(
      `SELECT relforcerowsecurity AS forced FROM pg_class WHERE oid = 'fx.exchange_rate'::regclass`,
    );
    expect(forced[0]?.forced).toBe(true);
  });

  it('los CHECK de la tabla exigen institution_code solo en BANK_BUY/BANK_SELL de provider y con el patrón del catálogo', async () => {
    const insert = (over: Record<string, string | null>) =>
      inTx(app, w1, async (c) => {
        const v = {
          type: 'BANK_SELL',
          source: 'PROVIDER',
          provider: ID,
          code: 'BAD',
          ...over,
        };
        await c.query(
          `INSERT INTO fx.exchange_rate (id, workspace_id, base_currency, quote_currency, rate, rate_type, as_of, as_of_date,
                                          source, provider, institution_code, created_at, fetched_at, raw_payload)
           VALUES ($1, $2, 'USD', 'BOB', 12, $3, '2026-10-20T00:00:00Z', '2026-10-19', $4, $5, $6, now(), now(), '{}')`,
          [randomUUID(), w1, v.type, v.source, v.provider, v.code],
        );
      });
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (err) {
        return (err as { code?: string }).code;
      }
      return undefined;
    };
    // Una tasa de provider BANK_SELL sin institución, un código fuera del patrón o con un tipo ajeno: 23514.
    expect(await code(insert({ code: null }))).toBe('23514');
    expect(await code(insert({ code: 'ba d' }))).toBe('23514');
    expect(await code(insert({ type: 'PARALLEL', provider: 'PARALELO_BO' }))).toBe('23514');
    // La forma válida pasa (se revierte: las pruebas no dejan tasas futuras).
    expect(await code(insert({}))).toBeUndefined();
    // Un id de provider por institución con forma inválida no se admite.
    expect(await code(insert({ provider: 'INSTRATE_bad' }))).toBe('23514');
  });

  it('las preferencias admiten BANK_BUY/BANK_SELL y la corrida del provider por institución se registra (CHECK ampliados)', async () => {
    await inTx(app, w1, async (c) => {
      await c.query(
        `INSERT INTO fx.rate_preference (workspace_id, base_currency, quote_currency, rate_type, version)
         VALUES ($1, 'USD', 'EUR', 'BANK_SELL', 1)`,
        [w1],
      );
      expect(true).toBe(true);
    });
    const { rows: runs } = await worker.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM fx.provider_run WHERE provider = $1',
      [ID],
    );
    expect(runs[0]?.n).toBeGreaterThanOrEqual(2);
  });
});
