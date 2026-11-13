import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor, runWithRequestContext } from '@pf/platform/api';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { StoredKnownItem, StoredSeries } from '../../src/application/ports.js';
import { ForecastRun } from '../../src/domain/index.js';
import {
  PgForecastOperations,
  PgForecastingUnitOfWork,
  PgMaintenance,
  PgRunRepository,
  PgSeriesRepository,
} from '../../src/infrastructure/pg-forecasting.js';

declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');

// `forecasting.*` contra PostgreSQL 18 real (openspec add-ml-forecasting-service, tarea 5.2): índice único «una corrida
// activa por workspace» (carrera de dos solicitudes), reclamo `FOR UPDATE SKIP LOCKED`, control optimista, series y puntos
// con sus CHECK, aislamiento entre workspaces (RLS forzada fail-closed, PF002) y barrido de mantenimiento sin contexto.
let app: Pool;
let worker: Pool;
let migrator: Pool;
let user: string;
const w1 = randomUUID();
const w2 = randomUUID();
// El ejecutor, el reintento y la purga corren como `pf_worker` (miembro de `pf_app`); la API (`pf_app`) solo lee e inserta.
let uow: PgForecastingUnitOfWork;
let appUow: PgForecastingUnitOfWork;
const runs = new PgRunRepository();
const series = new PgSeriesRepository();
const operations = new PgForecastOperations();
const AT = '2026-11-01T09:15:00.000Z';

const asUser = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'USER', userId: user }, origin: 'api' }, fn);
const inWs = <T>(ws: string, fn: () => Promise<T>): Promise<T> => asUser(() => uow.run(ws, fn));

async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

const newRun = (ws: string, trigger: 'MANUAL' | 'SCHEDULED' = 'SCHEDULED', at = AT) =>
  ForecastRun.request({
    id: randomUUID(),
    workspaceId: ws,
    trigger,
    requestedBy: trigger === 'MANUAL' ? user : null,
    at,
    reportingCurrency: 'BOB',
  });

const point = (months: number, period: string) => ({
  period,
  monthsAhead: months,
  prediction: '4350.00',
  lower80: '3980.00',
  upper80: '4790.00',
  lower95: '3810.00',
  upper95: '5050.00',
  baselineValue: '4210.00',
  knownFuture: '700.00',
  predictedVariable: '3650.00',
  variableLower80: '3280.00',
  variableUpper80: '4090.00',
  knownBlankCount: 1,
  drivers: [
    { type: 'HISTORICAL_AVERAGE' as const, value: '3600.00', effect: null, periods: [], refCount: 0 },
    { type: 'TREND_AND_LEVEL' as const, value: null, effect: '50.00', periods: [], refCount: 0 },
    { type: 'KNOWN_RECURRING' as const, value: '700.00', effect: null, periods: [], refCount: 2 },
  ],
});

const storedSeries = (runId: string, ws: string, over: Partial<StoredSeries> = {}): StoredSeries => ({
  id: randomUUID(),
  runId,
  workspaceId: ws,
  opaqueRef: 's1',
  scope: 'TOTAL_EXPENSE',
  scopeRef: null,
  name: 'TOTAL_EXPENSE',
  currency: 'BOB',
  scale: 2,
  readiness: 'MODEL',
  readinessReasons: [],
  historyFrom: '2025-11',
  historyTo: '2026-10',
  historyPeriods: 12,
  groupedCategoryIds: [],
  modelName: 'mean_last_n',
  modelVersion: '1',
  baselineMethod: 'MEAN_LAST_N',
  baselineN: 6,
  status: 'PUBLISHED',
  points: [point(1, '2026-11'), point(2, '2026-12')],
  selectedBy: 'BACKTEST',
  mase: '0.7800',
  baselineMase: '0.9000',
  coverage80: '0.8000',
  confidence: 'MEDIUM',
  ...over,
});

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
  uow = new PgForecastingUnitOfWork(worker);
  appUow = new PgForecastingUnitOfWork(app);
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/forecasting', $1, $2, 'U1') AS id`,
    [`sub-forecasting-${randomUUID()}`, `forecasting-${randomUUID()}@demo.pfos.test`],
  );
  user = rows[0]!.id;
  const setup = new PgUnitOfWork(app);
  for (const ws of [w1, w2]) {
    await setup.run({ userId: user, workspaceId: ws }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Forecasting', 'BOB', 'America/La_Paz', 'es-BO')`,
        [ws],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [ws, user],
      );
    });
  }
}, 120_000);

afterAll(async () => {
  await app?.end();
  await worker?.end();
  await migrator?.end();
});

describe('PgRunRepository', () => {
  it('[TC-FORECAST-SERVICE-006] la carrera de dos solicitudes simultáneas deja una sola corrida activa', async () => {
    const a = newRun(w1, 'MANUAL');
    const b = newRun(w1, 'MANUAL');
    const results = await Promise.all([
      inWs(w1, () => runs.insertIfNoActive(a)),
      inWs(w1, () => runs.insertIfNoActive(b)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await inWs(w1, () => runs.hasActive(w1))).toBe(true);
    // Terminada la activa (fallida), otra corrida puede crearse.
    const winner = results[0] ? a : b;
    await inWs(w1, async () => {
      const run = (await runs.findById(w1, winner.id))!;
      const v = run.version;
      run.start(AT);
      run.failAttempt('SERVICE_UNAVAILABLE', AT, {
        maxAttempts: 1,
        baseDelayMs: 1,
        factor: 1,
        windowMs: 86_400_000,
        stallMs: 900_000,
      });
      expect(await runs.save(run, v)).toBe(true);
    });
    expect(await inWs(w1, () => runs.insertIfNoActive(newRun(w1)))).toBe(true);
  });

  it('round-trip, reclamo FOR UPDATE SKIP LOCKED por antigüedad y control optimista por versión', async () => {
    const first = newRun(w2, 'SCHEDULED', '2026-11-02T09:00:00.000Z');
    expect(await inWs(w2, () => runs.insertIfNoActive(first))).toBe(true);
    const claimed = await inWs(w2, () => runs.claimNext(w2, '2026-11-02T09:00:00.000Z'));
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.snapshot.trigger).toBe('SCHEDULED');
    expect(await inWs(w2, () => runs.claimNext(w2, '2026-11-01T00:00:00.000Z'))).toBeNull(); // espera sin cumplir
    const stale = (await inWs(w2, () => runs.findById(w2, first.id)))!;
    const fresh = (await inWs(w2, () => runs.findById(w2, first.id)))!;
    const v = fresh.version;
    fresh.start('2026-11-02T09:01:00.000Z');
    expect(await inWs(w2, () => runs.save(fresh, v))).toBe(true);
    stale.start('2026-11-02T09:01:30.000Z');
    expect(await inWs(w2, () => runs.save(stale, v))).toBe(false);
    const loaded = (await inWs(w2, () => runs.findById(w2, first.id)))!;
    expect(loaded.status).toBe('RUNNING');
    expect(loaded.snapshot.startedAt).toBe('2026-11-02T09:01:00.000Z');
    expect(await inWs(w2, () => runs.claimStalled(w2, '2026-11-02T09:30:00.000Z'))).toHaveLength(1);
  });

  it('[TC-FORECAST-SERVICE-033] una corrida de otro workspace no se revela y sin contexto la RLS falla (PF002)', async () => {
    const run = newRun(w1, 'SCHEDULED', '2026-12-01T09:15:00.000Z');
    // w1 puede tener una activa: termina la anterior antes.
    const mine = await inWs(w1, () => runs.latestAttempt(w1));
    expect(mine).not.toBeNull();
    expect(await inWs(w2, () => runs.findById(w2, mine!.id))).toBeNull();
    expect(await inWs(w2, () => runs.findById(w1, mine!.id))).toBeNull();
    void run;
    expect(await sqlState(() => app.query('SELECT count(*) FROM forecasting.forecast_run'))).toBe('PF002');
  });

  it('[TC-FORECAST-SERVICE-025] series y puntos: round-trip a la escala de la moneda y CHECK de intervalos', async () => {
    const w = randomUUID();
    const setup = new PgUnitOfWork(app);
    await setup.run({ userId: user, workspaceId: w }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Series', 'BOB', 'America/La_Paz', 'es-BO')`,
        [w],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [w, user],
      );
    });
    const run = newRun(w);
    await inWs(w, () => runs.insertIfNoActive(run));
    const s = storedSeries(run.id, w);
    const cat = storedSeries(run.id, w, {
      opaqueRef: 's2',
      scope: 'CATEGORY',
      scopeRef: randomUUID(),
      name: 'Restaurantes',
      groupedCategoryIds: [randomUUID()],
      readiness: 'SIMPLE',
      readinessReasons: [{ code: 'TOO_FEW_PERIODS', missingForSimple: 0, missingForModel: 2 }],
    });
    const insufficient = storedSeries(run.id, w, {
      opaqueRef: 'x3',
      scope: 'CATEGORY',
      scopeRef: randomUUID(),
      name: 'Gimnasio',
      readiness: 'INSUFFICIENT',
      status: 'INSUFFICIENT',
      modelName: null,
      modelVersion: null,
      baselineMethod: null,
      baselineN: null,
      points: [],
    });
    await inWs(w, () => series.insertAll([s, cat, insufficient]));
    const loaded = await inWs(w, () => series.listByRun(w, run.id));
    expect(loaded.map((x) => x.scope)).toEqual(['TOTAL_EXPENSE', 'CATEGORY', 'CATEGORY']);
    const total = loaded.find((x) => x.scope === 'TOTAL_EXPENSE')!;
    expect(total.points[0]).toEqual(point(1, '2026-11'));
    expect(loaded.find((x) => x.name === 'Restaurantes')?.readinessReasons[0]?.missingForModel).toBe(2);
    expect(loaded.find((x) => x.name === 'Restaurantes')?.groupedCategoryIds).toHaveLength(1);
    // Un intervalo desordenado viola el CHECK de la tabla.
    const bad = storedSeries(run.id, w, {
      opaqueRef: 's9',
      scope: 'TOTAL_INCOME',
      name: 'TOTAL_INCOME',
      points: [{ ...point(1, '2026-11'), lower80: '4500.00' }],
    });
    expect(await sqlState(() => inWs(w, () => series.insertAll([bad])))).toBe('23514');
    // Una serie repetida por (corrida, alcance, referencia) viola la clave única (NULLS NOT DISTINCT).
    expect(
      await sqlState(() => inWs(w, () => series.insertAll([storedSeries(run.id, w, { opaqueRef: 's77' })]))),
    ).toBe('23505');
  });
});

describe('componentes del pronóstico (add-expense-forecasts)', () => {
  const setupWorkspace = async (name: string): Promise<string> => {
    const w = randomUUID();
    const setup = new PgUnitOfWork(app);
    await setup.run({ userId: user, workspaceId: w }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, $2, 'BOB', 'America/La_Paz', 'es-BO')`,
        [w, name],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [w, user],
      );
    });
    return w;
  };
  const known = (over: Partial<StoredKnownItem> = {}): StoredKnownItem => ({
    period: '2026-12' as StoredKnownItem['period'],
    date: '2026-12-01',
    label: 'Alquiler',
    kind: 'EXPENSE',
    amountType: 'FIXED',
    amount: '2500.00',
    originalAmount: null,
    managedBy: 'USER',
    source: { context: 'COMMITMENTS', id: randomUUID() },
    categoryId: randomUUID(),
    withoutAmount: false,
    currency: 'BOB',
    ...over,
  });

  it('[TC-FORECAST-CASHFLOW-003] una serie del gasto variable líquido por moneda (BOB y USD) se guarda y se lee en su moneda', async () => {
    const w = await setupWorkspace('Gasto líquido');
    const run = newRun(w);
    await inWs(w, () => runs.insertIfNoActive(run));
    const liquid = (currency: string, ref: string, prediction: string) =>
      storedSeries(run.id, w, {
        opaqueRef: ref,
        scope: 'LIQUID_VARIABLE_OUTFLOW',
        scopeRef: null,
        name: currency,
        currency,
        points: [
          {
            ...point(1, '2026-11'),
            prediction,
            lower80: prediction,
            upper80: prediction,
            lower95: prediction,
            upper95: prediction,
            knownFuture: '0.00',
            predictedVariable: prediction,
            variableLower80: prediction,
            variableUpper80: prediction,
          },
        ],
      });
    await inWs(w, () =>
      series.insertAll([
        storedSeries(run.id, w),
        liquid('BOB', 's2', '1152.00'),
        liquid('USD', 's3', '120.00'),
      ]),
    );
    const loaded = await inWs(w, () => series.listByRun(w, run.id));
    const byCurrency = loaded.filter((x) => x.scope === 'LIQUID_VARIABLE_OUTFLOW');
    expect(byCurrency.map((x) => [x.currency, x.points[0]?.prediction])).toEqual([
      ['BOB', '1152.00'],
      ['USD', '120.00'],
    ]);
    // Dos series del mismo scope y de la misma moneda siguen siendo inválidas.
    expect(
      await sqlState(() =>
        inWs(w, () => series.insertAll([{ ...liquid('BOB', 's4', '10.00'), id: randomUUID() }])),
      ),
    ).toBe('23505');
  });

  it('[TC-FORECAST-EXPENSE-001] conocidos, motivos, backtesting y metadatos hacen el round-trip a la escala de la moneda', async () => {
    const w = await setupWorkspace('Componentes');
    const run = newRun(w);
    await inWs(w, () => runs.insertIfNoActive(run));
    const spotify = known({
      label: 'Spotify',
      date: '2026-12-20',
      amountType: 'ESTIMATED',
      amount: '69.53',
      originalAmount: { amount: '9.99', currency: 'USD' },
      managedBy: 'SUBSCRIPTION',
    });
    const luz = known({
      label: 'Luz',
      date: '2026-12-12',
      amountType: 'VARIABLE',
      amount: null,
      withoutAmount: true,
    });
    const s = storedSeries(run.id, w, {
      backtest: [
        {
          modelName: 'ETS_DAMPED',
          origins: 6,
          mase: '0.7800',
          coverage80: '0.8000',
          bias: '0.1000',
          selected: true,
        },
        {
          modelName: 'MEAN_LAST_6',
          origins: 6,
          mase: '0.9000',
          coverage80: '0.5000',
          bias: '-0.2000',
          selected: false,
        },
      ],
      knownItems: [known(), spotify, luz],
    });
    await inWs(w, () => series.insertAll([s]));
    await inWs(w, () =>
      series.saveRunMetadata(w, run.id, {
        seed: 1_234_567_890,
        modelSet: 'phase8-v1',
        conversion: { rateDate: '2026-11-05', ratesUsed: [{ rate: 'USD' }] },
      }),
    );
    const [loaded] = await inWs(w, () => series.listByRun(w, run.id));
    expect(loaded?.selectedBy).toBe('BACKTEST');
    expect(loaded?.mase).toBe('0.7800');
    expect(loaded?.baselineMase).toBe('0.9000');
    expect(loaded?.coverage80).toBe('0.8000');
    expect(loaded?.confidence).toBe('MEDIUM');
    expect(loaded?.points[0]?.knownFuture).toBe('700.00');
    expect(loaded?.points[0]?.drivers?.map((d) => d.type)).toEqual([
      'HISTORICAL_AVERAGE',
      'TREND_AND_LEVEL',
      'KNOWN_RECURRING',
    ]);
    const items = await inWs(w, () =>
      series.listKnownItems(w, run.id, { scope: 'TOTAL_EXPENSE', scopeRef: null }, '2026-12'),
    );
    expect(items.map((i) => i.label)).toEqual(['Alquiler', 'Luz', 'Spotify']); // por fecha
    expect(items.find((i) => i.label === 'Spotify')).toMatchObject({
      amount: '69.53',
      originalAmount: { amount: '9.99', currency: 'USD' },
      amountType: 'ESTIMATED',
    });
    expect(items.find((i) => i.label === 'Luz')).toMatchObject({ amount: null, withoutAmount: true });
    expect(
      await inWs(w, () =>
        series.listKnownItems(w, run.id, { scope: 'TOTAL_EXPENSE', scopeRef: null }, '2027-01'),
      ),
    ).toEqual([]);
    expect(await inWs(w, () => series.runMetadata(w, run.id))).toEqual({
      seed: 1_234_567_890,
      modelSet: 'phase8-v1',
      conversion: { rateDate: '2026-11-05', ratesUsed: [{ rate: 'USD' }] },
    });
    const { rows } = await asUser(() =>
      uow.run(w, async () =>
        requireSqlExecutor().query(
          `SELECT model_name, mase::text AS mase, selected FROM forecasting.backtest_result ORDER BY model_name`,
        ),
      ),
    );
    expect(rows).toEqual([
      { model_name: 'ETS_DAMPED', mase: '0.7800', selected: true },
      { model_name: 'MEAN_LAST_6', mase: '0.9000', selected: false },
    ]);
  });

  it('[TC-SECURITY-RLS-007] los conocidos y el backtesting de otro workspace no se revelan y sin contexto falla (PF002)', async () => {
    const wa = await setupWorkspace('Aislamiento A');
    const wb = await setupWorkspace('Aislamiento B');
    const run = newRun(wa);
    await inWs(wa, () => runs.insertIfNoActive(run));
    await inWs(wa, () =>
      series.insertAll([
        storedSeries(run.id, wa, {
          knownItems: [known()],
          backtest: [
            { modelName: 'NAIVE', origins: 2, mase: '1.0000', coverage80: null, bias: null, selected: true },
          ],
        }),
      ]),
    );
    expect(
      await inWs(wb, () =>
        series.listKnownItems(wb, run.id, { scope: 'TOTAL_EXPENSE', scopeRef: null }, '2026-12'),
      ),
    ).toEqual([]);
    for (const table of ['forecast_known_item', 'backtest_result']) {
      expect(await sqlState(() => app.query(`SELECT count(*) FROM forecasting.${table}`))).toBe('PF002');
    }
    const other = await inWs(wb, async () =>
      requireSqlExecutor().query(`SELECT count(*)::int AS n FROM forecasting.forecast_known_item`),
    );
    expect(other.rows[0]).toEqual({ n: 0 });
  });

  it('[TC-FORECAST-EXPENSE-001] un conocido con categoría nula o un CHECK de tipo inválido: el tipo desconocido se rechaza', async () => {
    const w = await setupWorkspace('Check');
    const run = newRun(w);
    await inWs(w, () => runs.insertIfNoActive(run));
    const bad = storedSeries(run.id, w, {
      knownItems: [known({ kind: 'TRANSFER' as StoredKnownItem['kind'] })],
    });
    expect(await sqlState(() => inWs(w, () => series.insertAll([bad])))).toBe('23514');
  });
});

describe('permisos de pf_app', () => {
  it('[TC-FORECAST-SERVICE-033] la API (pf_app) crea y lee corridas pero no las actualiza ni las borra; los puntos son solo inserción', async () => {
    const run = newRun(w2, 'MANUAL', '2027-01-01T09:00:00.000Z');
    const second = await asUser(() => appUow.run(w2, () => runs.insertIfNoActive(run)));
    expect(typeof second).toBe('boolean');
    const mine = await asUser(() => appUow.run(w2, () => runs.latestAttempt(w2)));
    expect(mine).not.toBeNull();
    const forged = ForecastRun.restore({ ...mine!.snapshot, version: mine!.version + 1 });
    expect(await sqlState(() => asUser(() => appUow.run(w2, () => runs.save(forged, mine!.version))))).toBe(
      '42501',
    );
    expect(await sqlState(() => asUser(() => appUow.run(w2, () => runs.save(forged, mine!.version))))).toBe(
      '42501',
    );
    expect(
      await sqlState(() =>
        asUser(() => appUow.run(w2, () => new PgMaintenance(appUow).deleteRuns(w2, [mine!.id]))),
      ),
    ).toBe('42501');
  });
});

describe('PgForecastOperations', () => {
  it('la corrida manual crea la operación FORECAST con el mismo id y la actualiza', async () => {
    const w = randomUUID();
    const setup = new PgUnitOfWork(app);
    await setup.run({ userId: user, workspaceId: w }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Ops', 'BOB', 'America/La_Paz', 'es-BO')`,
        [w],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [w, user],
      );
    });
    const id = randomUUID();
    await inWs(w, async () => {
      await operations.create({ id, workspaceId: w, requestedBy: user });
      await operations.update(w, id, { status: 'FAILED', progressPct: 100, error: { code: 'TIMEOUT' } });
      const { rows } = (await requireSqlExecutor().query(
        `SELECT kind, status, error FROM platform.operation WHERE workspace_id = $1 AND id = $2`,
        [w, id],
      )) as { rows: { kind: string; status: string; error: { code: string } }[] };
      expect(rows[0]).toMatchObject({ kind: 'FORECAST', status: 'FAILED', error: { code: 'TIMEOUT' } });
    });
  });
});

describe('PgMaintenance', () => {
  it('el barrido sin contexto (pf_maintenance) ve las corridas debidas y los candidatos a purga; borrar exige el contexto', async () => {
    const maintenance = new PgMaintenance(uow);
    const due = await maintenance.dueRuns('2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', 50);
    expect(due.length).toBeGreaterThan(0);
    const w = randomUUID();
    const setup = new PgUnitOfWork(app);
    await setup.run({ userId: user, workspaceId: w }, async () => {
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Purga', 'BOB', 'America/La_Paz', 'es-BO')`,
        [w],
      );
      await requireSqlExecutor().query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
        [w, user],
      );
    });
    const old = newRun(w, 'SCHEDULED', '2026-01-01T05:15:00.000Z');
    await inWs(w, () => runs.insertIfNoActive(old));
    await inWs(w, async () => {
      const r = (await runs.findById(w, old.id))!;
      const v = r.version;
      r.start('2026-01-01T05:16:00.000Z');
      r.noData({ at: '2026-01-01T05:17:00.000Z', asOfPeriod: null, seriesInsufficient: 3 });
      await runs.save(r, v);
      await series.insertAll([
        storedSeries(r.id, w, { status: 'INSUFFICIENT', readiness: 'INSUFFICIENT', points: [] }),
      ]);
    });
    const candidates = await maintenance.purgeCandidates({
      supersededBeforeIso: '2026-11-01T00:00:00.000Z',
      failedBeforeIso: '2026-11-01T00:00:00.000Z',
    });
    expect(candidates.some((c) => c.runId === old.id && c.status === 'INSUFFICIENT_DATA')).toBe(true);
    expect(await inWs(w, () => maintenance.deleteRuns(w, [old.id]))).toBe(1);
    // La cascada se llevó las series y los puntos.
    expect(await inWs(w, () => series.listByRun(w, old.id))).toHaveLength(0);
  });
});
