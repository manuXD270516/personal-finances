import { DomainError, Instant, dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ForecastRun, type FlowRow } from '../domain/index.js';
import { ExecuteForecastRun } from './execute-forecast-run.js';
import { ForecastQueries } from './forecast-queries.js';
import { RequestForecastRun } from './request-forecast-run.js';
import { ScheduleForecastRuns } from './schedule-forecast-runs.js';
import { buildWorld, unavailable, type TestWorld } from './testing/in-memory.js';

const WS = 'w1';
const T0 = '2026-11-05T15:00:00.000Z';

const months = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `2026-${String(from + i).padStart(2, '0')}`);

/** 8 periodos terminados (2026-03 a 2026-10) con 3 categorías y un ingreso mensual. */
const seedHistory = (w: TestWorld): void => {
  const rows: FlowRow[] = [];
  for (const m of months(3, 10)) {
    for (const [cat, amount] of [
      ['rest', '900.00'],
      ['transp', '400.00'],
      ['rent', '2500.00'],
    ] as const) {
      for (const day of ['03', '10', '17', '24']) {
        rows.push({
          businessDate: `${m}-${day}`,
          nature: 'EXPENSE',
          categoryId: cat,
          amount: { amount: dec(amount).div(4).toFixed(2), currency: 'BOB' },
        });
      }
    }
    rows.push({
      businessDate: `${m}-05`,
      nature: 'INCOME',
      categoryId: 'salary',
      amount: { amount: '9000.00', currency: 'BOB' },
    });
  }
  w.flows = rows;
  w.categories = {
    groups: [{ groupId: 'g1', name: 'Vida diaria' }],
    categories: [
      { categoryId: 'rest', groupId: 'g1', name: 'Restaurantes', uncategorized: false },
      { categoryId: 'transp', groupId: 'g1', name: 'Transporte', uncategorized: false },
      { categoryId: 'rent', groupId: 'g1', name: 'Alquiler', uncategorized: false },
    ],
  };
};

const world = (now = T0, overrides = {}): TestWorld => {
  const w = buildWorld(now, overrides);
  seedHistory(w);
  return w;
};

const request = (w: TestWorld, userId = 'u-editor') =>
  new RequestForecastRun(w.deps).execute({ workspaceId: WS, userId });
const runner = (w: TestWorld) => new ExecuteForecastRun(w.deps);
const queries = (w: TestWorld) => new ForecastQueries(w.deps);

describe('RequestForecastRun', () => {
  it('[TC-FORECAST-SERVICE-005] un EDITOR solicita una corrida y recibe la operación pendiente auditada', async () => {
    const w = world();
    const { runId } = await request(w);
    expect(w.operations.rows.get(runId)?.status).toBe('PENDING');
    const rec = w.records.find((r) => r.entry.aggregateId === runId);
    expect(rec?.entry.action).toBe('forecasting.forecast_run.requested');
    expect(rec?.entry.changes?.find((c) => c.field === 'requestedBy')?.after).toBe('u-editor');
    expect(rec?.steps[0]).toMatchObject({
      kind: 'TRANSITION',
      transition: 'REQUEST',
      fromState: null,
      toState: 'REQUESTED',
    });
  });

  it('[TC-FORECAST-SERVICE-006] una segunda solicitud con una corrida activa se rechaza', async () => {
    const w = world();
    await request(w);
    await expect(request(w, 'u-owner')).rejects.toMatchObject({ code: 'FORECAST_RUN_IN_PROGRESS' });
    expect(w.runs.rows.size).toBe(1);
  });

  it('[TC-FORECAST-SERVICE-002] con la función deshabilitada la solicitud se rechaza y la consulta lo informa', async () => {
    const w = world(T0, { enabled: false });
    await expect(request(w)).rejects.toMatchObject({ code: 'FORECASTING_DISABLED' });
    const latest = await queries(w).getLatest({ workspaceId: WS });
    expect(latest).toMatchObject({ status: 'DISABLED', series: [], run: null });
    const summary = await new ScheduleForecastRuns(w.deps).run();
    expect(summary.created).toBe(0);
    expect(w.runs.rows.size).toBe(0);
  });
});

describe('ExecuteForecastRun', () => {
  it('[TC-FORECAST-SERVICE-025] [TC-FORECAST-SERVICE-036] completa la corrida, publica una vez el hecho sin montos y guarda los puntos', async () => {
    const w = world();
    const { runId } = await request(w);
    const outcome = await runner(w).runOnce();
    expect(outcome).toEqual({ kind: 'COMPLETED', runId });
    expect(w.outbox).toHaveLength(1);
    expect(w.outbox[0]).toMatchObject({
      eventType: 'forecast.ForecastGenerated',
      aggregateType: 'ForecastRun',
      aggregateId: runId,
    });
    expect(JSON.stringify(w.outbox[0]?.payload)).not.toMatch(/"-?\d+\.\d{2}"/);
    const payload = w.outbox[0]?.payload as {
      seriesPublished: number;
      asOfPeriod: string;
      modelVersions: string[];
    };
    expect(payload.asOfPeriod).toBe('2026-10');
    expect(payload.modelVersions).toEqual(['mean_last_n@1']);
    expect(w.operations.rows.get(runId)?.status).toBe('SUCCEEDED');
    const total = w.series.rows.find((s) => s.scope === 'TOTAL_EXPENSE');
    expect(total?.status).toBe('PUBLISHED');
    expect(total?.points).toHaveLength(12);
    expect(total?.points[0]?.period).toBe('2026-11');
    const latest = await queries(w).getLatest({ workspaceId: WS, horizon: 3 });
    const point = latest.series.find((s) => s.scope === 'TOTAL_EXPENSE')?.points[0];
    expect(point).toMatchObject({
      period: '2026-11',
      monthsAhead: 1,
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      interval80: { lower: { currency: 'BOB' } },
      baseline: { method: 'MEAN_LAST_N', n: 6 },
    });
    expect(w.metrics.durations).toContain('completed');
  });

  it('[TC-FORECAST-SERVICE-021] la petición al servicio no contiene nombres ni identificadores del workspace', async () => {
    const w = world();
    await request(w);
    await runner(w).runOnce();
    const text = JSON.stringify(w.service.requests[0]);
    for (const secret of [
      WS,
      'rest',
      'transp',
      'rent',
      'Restaurantes',
      'Vida diaria',
      'workspace',
      'u-editor',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(w.service.requests[0]?.series.length).toBeGreaterThan(3);
  });

  it('[TC-FORECAST-SERVICE-026] el total se pronostica 12 periodos y una categoría con pocos periodos de historia 6', async () => {
    const w = world();
    await request(w);
    await runner(w).runOnce();
    const byScope = (scope: string) => w.series.rows.find((s) => s.scope === scope);
    expect(byScope('TOTAL_EXPENSE')?.points).toHaveLength(12);
    expect(byScope('CATEGORY')?.points).toHaveLength(6);
  });

  it('[TC-FORECAST-SERVICE-003] una corrida completada reemplaza a la vigente anterior', async () => {
    const w = world();
    const { runId: r1 } = await request(w);
    await runner(w).runOnce();
    w.clock.advance(3_600_000);
    const { runId: r2 } = await request(w);
    await runner(w).runOnce();
    expect(w.runs.rows.get(r1)?.status).toBe('SUPERSEDED');
    expect(w.runs.rows.get(r1)?.snapshot.supersededBy).toBe(r2);
    expect(w.runs.rows.get(r2)?.status).toBe('COMPLETED');
    expect(
      w.records
        .filter((r) => r.entry.aggregateId === r1)
        .map((r) => r.steps[0]?.kind === 'TRANSITION' && r.steps[0].transition),
    ).toEqual(['REQUEST', 'START', 'COMPLETE', 'SUPERSEDE']);
  });

  it('[TC-FORECAST-SERVICE-004] una corrida sin datos suficientes queda INSUFFICIENT_DATA y no reemplaza la vigente', async () => {
    const w = world();
    const { runId: r2 } = await request(w);
    await runner(w).runOnce();
    w.flows = w.flows.filter(
      (f) => f.businessDate.startsWith('2026-10') || f.businessDate.startsWith('2026-09'),
    );
    w.clock.advance(3_600_000);
    const { runId: r3 } = await request(w);
    const outcome = await runner(w).runOnce();
    expect(outcome).toEqual({ kind: 'INSUFFICIENT_DATA', runId: r3 });
    expect(w.runs.rows.get(r3)?.status).toBe('INSUFFICIENT_DATA');
    expect(w.runs.rows.get(r2)?.status).toBe('COMPLETED');
    const insufficient = w.series.rows.filter((s) => s.runId === r3);
    expect(insufficient.every((s) => s.status === 'INSUFFICIENT' && s.readinessReasons.length > 0)).toBe(
      true,
    );
    expect(w.service.requests).toHaveLength(1);
  });

  it('[TC-FORECAST-SERVICE-023] una serie con el intervalo desordenado se descarta y las demás se publican', async () => {
    const w = world();
    w.service.steps.push((req) => {
      const base = {
        schemaVersion: '1' as const,
        requestId: req.requestId,
        serviceVersion: '0.1.0',
        durationMs: 1,
      };
      return {
        ...base,
        results: req.series.map((s, i) => ({
          ref: s.ref,
          status: 'OK' as const,
          error: null,
          model: { name: 'mean_last_n', version: '1', selectedBy: 'fixed' },
          baseline: { method: 'MEAN_LAST_N', n: 6 },
          points: Array.from({ length: s.horizon }, (_, k) => {
            const [y, m] = [2026 + Math.floor((10 + k) / 12), ((10 + k) % 12) + 1];
            return {
              period: `${y}-${String(m).padStart(2, '0')}`,
              monthsAhead: k + 1,
              prediction: '900.00',
              lower80: i === 0 ? '950.00' : '800.00',
              upper80: '1100.00',
              lower95: '700.00',
              upper95: '1200.00',
              baselineValue: '900.00',
            };
          }),
        })),
      };
    });
    const { runId } = await request(w);
    expect(await runner(w).runOnce()).toEqual({ kind: 'COMPLETED', runId });
    const snap = w.runs.rows.get(runId)?.snapshot;
    expect(snap?.seriesInvalid).toBe(1);
    expect(snap?.seriesPublished).toBeGreaterThan(0);
    expect(w.series.rows.filter((s) => s.status === 'INVALID')).toHaveLength(1);
  });

  it('[TC-FORECAST-SERVICE-023] sin ninguna serie válida la corrida termina fallida', async () => {
    const w = world();
    w.service.steps.push((req) => ({
      schemaVersion: '1',
      requestId: req.requestId,
      serviceVersion: '0.1.0',
      durationMs: 1,
      results: req.series.map((s) => ({
        ref: s.ref,
        status: 'ERROR' as const,
        error: 'X',
        model: null,
        baseline: null,
        points: [],
      })),
    }));
    const { runId } = await request(w);
    expect(await runner(w).runOnce()).toEqual({ kind: 'FAILED', runId });
    expect(w.runs.rows.get(runId)?.snapshot.failureReason).toBe('INVALID_OUTPUT');
    expect(w.metrics.failures).toEqual(['invalid_output']);
  });

  it('[TC-FORECAST-SERVICE-029] con el servicio caído en los 5 intentos la corrida falla y se muestra la vigente marcada', async () => {
    const w = world();
    const { runId: r2 } = await request(w);
    await runner(w).runOnce();
    w.clock.advance(30 * 86_400_000);
    const { runId: r3 } = await request(w);
    const waits: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      w.service.steps.push(unavailable());
      const before = w.clock.now();
      const outcome = await runner(w).runOnce();
      expect(outcome.kind).toBe(i < 4 ? 'RETRY' : 'FAILED');
      if (i < 4) {
        const next = w.runs.rows.get(r3)?.snapshot.nextAttemptAt as string;
        waits.push((Date.parse(next) - before.epochMillis) / 60_000);
        w.clock.set(Instant.parse(next));
      }
    }
    expect(waits).toEqual([5, 15, 45, 135]);
    expect(w.runs.rows.get(r3)?.snapshot).toMatchObject({
      status: 'FAILED',
      failureReason: 'SERVICE_UNAVAILABLE',
      attempts: 5,
    });
    expect(w.operations.rows.get(r3)?.status).toBe('FAILED');
    expect(w.metrics.failures).toEqual(['unavailable']);
    const latest = await queries(w).getLatest({ workspaceId: WS });
    expect(latest.run?.id).toBe(r2);
    expect(latest.generatedAt).toBe(w.runs.rows.get(r2)?.snapshot.completedAt);
    expect(latest.stale).toBe(true);
    expect(latest.lastAttempt).toMatchObject({ status: 'FAILED', failureReason: 'SERVICE_UNAVAILABLE' });
    // Sin ninguna llamada pendiente: el ejecutor queda ocioso.
    expect((await runner(w).runOnce()).kind).toBe('IDLE');
  });

  it('[TC-FORECAST-SERVICE-030] la corrida se completa si el servicio responde en el tercer intento', async () => {
    const w = world();
    const { runId: r2 } = await request(w);
    await runner(w).runOnce();
    w.clock.advance(3_600_000);
    const { runId: r3 } = await request(w);
    for (let i = 0; i < 2; i += 1) {
      w.service.steps.push(unavailable());
      expect((await runner(w).runOnce()).kind).toBe('RETRY');
      w.clock.set(Instant.parse(w.runs.rows.get(r3)?.snapshot.nextAttemptAt as string));
    }
    expect((await runner(w).runOnce()).kind).toBe('COMPLETED');
    expect(w.runs.rows.get(r3)?.status).toBe('COMPLETED');
    expect(w.runs.rows.get(r2)?.status).toBe('SUPERSEDED');
    const steps = w.records
      .filter((r) => r.entry.aggregateId === r3)
      .map((r) => (r.steps[0]?.kind === 'TRANSITION' ? r.steps[0].transition : '?'));
    expect(steps).toEqual(['REQUEST', 'START', 'RETRY', 'START', 'RETRY', 'START', 'COMPLETE']);
  });

  it('[TC-FORECAST-SERVICE-040] una corrida colgada 15 minutos vuelve a solicitada', async () => {
    const w = world();
    const run = ForecastRun.request({
      id: 'r-stuck',
      workspaceId: WS,
      trigger: 'SCHEDULED',
      requestedBy: null,
      at: T0,
      reportingCurrency: 'BOB',
    });
    run.start(T0);
    await w.runs.insertIfNoActive(ForecastRun.restore({ ...run.snapshot, status: 'REQUESTED', version: 1 }));
    w.runs.rows.set('r-stuck', run);
    w.clock.advance(16 * 60_000);
    expect(await runner(w).runOnce()).toEqual({ kind: 'RECOVERED', runId: 'r-stuck' });
    expect(w.runs.rows.get('r-stuck')?.status).toBe('REQUESTED');
    expect(w.runs.rows.get('r-stuck')?.snapshot.attempts).toBe(1);
  });

  it('[TC-FORECAST-SERVICE-037] tres corridas fallidas seguidas suman 3 en la métrica de fallas por servicio no disponible', async () => {
    const w = world(T0, {
      retry: { maxAttempts: 1, baseDelayMs: 1, factor: 1, windowMs: 86_400_000, stallMs: 900_000 },
    });
    for (let day = 0; day < 3; day += 1) {
      await request(w);
      w.service.steps.push(unavailable());
      expect((await runner(w).runOnce()).kind).toBe('FAILED');
      w.clock.advance(86_400_000);
    }
    expect(w.metrics.failures).toEqual(['unavailable', 'unavailable', 'unavailable']);
  });
});

describe('ScheduleForecastRuns', () => {
  const completeOnce = async (w: TestWorld) => {
    await request(w);
    await runner(w).runOnce();
  };

  it('[TC-FORECAST-SERVICE-008] crea una corrida programada cuando termina un periodo nuevo', async () => {
    const w = world('2026-10-03T09:15:00.000Z');
    // La corrida del 2026-10-03 pronosticó con 2026-09 como último periodo terminado.
    w.flows = w.flows.filter((f) => f.businessDate < '2026-10-01');
    await completeOnce(w);
    expect([...w.runs.rows.values()][0]?.snapshot.asOfPeriod).toBe('2026-09');
    w.clock.set(Instant.parse('2026-11-01T09:15:00.000Z'));
    const summary = await new ScheduleForecastRuns(w.deps).run();
    expect(summary.created).toBe(1);
    const created = [...w.runs.rows.values()].find((r) => r.status === 'REQUESTED');
    expect(created?.snapshot.trigger).toBe('SCHEDULED');
    expect(created?.snapshot.requestedBy).toBeNull();
    // A lo sumo una por día: la segunda pasada del mismo día no crea otra (y hay una activa).
    expect((await new ScheduleForecastRuns(w.deps).run()).created).toBe(0);
  });

  it('[TC-FORECAST-SERVICE-009] no crea corridas con un pronóstico reciente y sin periodo nuevo', async () => {
    const w = world('2026-11-01T09:15:00.000Z');
    await completeOnce(w);
    w.clock.set(Instant.parse('2026-11-05T09:15:00.000Z'));
    expect((await new ScheduleForecastRuns(w.deps).run()).created).toBe(0);
    expect(w.runs.rows.size).toBe(1);
  });

  it('[TC-FORECAST-SERVICE-009] con la vigente de más de 7 días crea una corrida aunque no haya periodo nuevo', async () => {
    const w = world('2026-11-01T09:15:00.000Z');
    await completeOnce(w);
    w.clock.set(Instant.parse('2026-11-09T09:15:00.000Z'));
    expect((await new ScheduleForecastRuns(w.deps).run()).created).toBe(1);
  });

  it('[TC-FORECAST-SERVICE-038] la retención conserva la corrida del inicio del periodo y purga las demás reemplazadas', async () => {
    const w = world('2026-12-15T12:00:00.000Z');
    const mk = (id: string, completedAt: string) => {
      const run = ForecastRun.request({
        id,
        workspaceId: WS,
        trigger: 'SCHEDULED',
        requestedBy: null,
        at: completedAt,
        reportingCurrency: 'BOB',
      });
      run.start(completedAt);
      run.complete({
        at: completedAt,
        asOfPeriod: '2026-10',
        datasetSnapshotId: 'sha256:x',
        serviceVersion: '0.1.0',
        seriesPublished: 1,
        seriesInsufficient: 0,
        seriesInvalid: 0,
      });
      run.supersede('next', completedAt);
      w.runs.rows.set(id, run);
    };
    mk('nov-01', '2026-11-01T05:15:00.000Z');
    mk('nov-08', '2026-11-08T05:15:00.000Z');
    // Las dos tienen más de 30 días: se mueven hacia atrás cambiando "hoy".
    w.clock.set(Instant.parse('2026-12-15T12:00:00.000Z'));
    const purged = await new ScheduleForecastRuns(w.deps).purge();
    expect(purged).toBe(1);
    expect(w.runs.rows.has('nov-08')).toBe(false);
    expect(w.runs.rows.has('nov-01')).toBe(true);
  });
});

describe('ForecastQueries', () => {
  it('[TC-FORECAST-SERVICE-032] sin corridas completadas la consulta informa que no hay pronóstico', async () => {
    const w = world();
    const latest = await queries(w).getLatest({ workspaceId: WS });
    expect(latest).toMatchObject({ status: 'NONE', stale: false, run: null, series: [] });
  });

  it('[TC-FORECAST-SERVICE-031] un VIEWER consulta el pronóstico vigente con horizonte 3 y la preparación de cada serie', async () => {
    const w = world();
    await request(w);
    await runner(w).runOnce();
    const latest = await queries(w).getLatest({ workspaceId: WS, horizon: 3 });
    expect(latest.status).toBe('AVAILABLE');
    for (const s of latest.series.filter((x) => x.readiness !== 'INSUFFICIENT')) {
      expect(s.points).toHaveLength(3);
      expect(s.readiness).toBe('MODEL');
    }
    const filtered = await queries(w).getLatest({ workspaceId: WS, scopes: ['TOTAL_INCOME'], horizon: 1 });
    expect(filtered.series.map((s) => s.scope)).toEqual(['TOTAL_INCOME']);
  });

  it('[TC-FORECAST-SERVICE-027] un horizonte distinto de 1, 3, 6 o 12 se rechaza con INVALID_FILTER', async () => {
    const w = world();
    const err = await queries(w)
      .getLatest({ workspaceId: WS, horizon: 4 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('INVALID_FILTER');
  });

  it('[TC-FORECAST-SERVICE-033] una corrida de otro workspace no se revela', async () => {
    const w = world();
    const { runId } = await request(w);
    await expect(queries(w).getRun({ workspaceId: 'w2', runId })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    const page = await queries(w).listRuns({ workspaceId: WS, limit: 20 });
    expect(page.items.map((r) => r.id)).toEqual([runId]);
  });
});

describe('snapshot del conjunto de datos', () => {
  it('[TC-FORECAST-SERVICE-021] el identificador del conjunto es estable entre intentos y no incluye el requestId', async () => {
    const { ForecastRequestBuilder } = await import('../domain/index.js');
    const { datasetSnapshotId, seededRandom } = await import('./snapshot.js');
    const series = [
      {
        scope: 'TOTAL_EXPENSE' as const,
        scopeRef: null,
        name: 'TOTAL_EXPENSE',
        kind: 'EXPENSE' as const,
        readiness: 'MODEL' as const,
        readinessReasons: [],
        points: [{ period: '2026-10', value: dec('100.00'), txCount: 3 }],
        historyFrom: '2026-10',
        historyTo: '2026-10',
        groupedCategoryIds: [],
        horizon: 12,
      },
    ];
    const build = (requestId: string) =>
      ForecastRequestBuilder.build({
        requestId,
        seed: 1,
        series,
        currency: 'BOB',
        scale: 2,
        random: seededRandom('run'),
      }).request;
    const a = build('6f1b7c3e-2d54-4b7a-9a52-0d1c3e5a7b90');
    const b = build('7f1b7c3e-2d54-4b7a-9a52-0d1c3e5a7b90');
    expect(datasetSnapshotId(a)).toBe(datasetSnapshotId(b));
    expect(datasetSnapshotId(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
