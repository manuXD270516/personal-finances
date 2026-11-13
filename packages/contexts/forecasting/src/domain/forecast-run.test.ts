import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_POLICY, FORECAST_RUN_LIFECYCLE, ForecastRun } from './forecast-run.js';

const requested = (at = '2026-12-01T10:00:00.000Z') =>
  ForecastRun.request({
    id: 'r3',
    workspaceId: 'w1',
    trigger: 'MANUAL',
    requestedBy: 'u1',
    at,
    reportingCurrency: 'BOB',
  });

const minutes = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();

describe('ForecastRun', () => {
  it('[TC-FORECAST-SERVICE-003] solo declara las transiciones del diseño y completar reemplaza a la vigente', () => {
    const run = requested();
    run.start('2026-12-01T10:01:00.000Z');
    run.complete({
      at: '2026-12-01T10:02:00.000Z',
      asOfPeriod: '2026-11',
      datasetSnapshotId: 'sha256:x',
      serviceVersion: '0.1.0',
      seriesPublished: 18,
      seriesInsufficient: 4,
      seriesInvalid: 0,
    });
    expect(run.status).toBe('COMPLETED');
    const previous = ForecastRun.restore({ ...run.snapshot, id: 'r1' });
    previous.supersede('r3', '2026-12-01T10:02:00.000Z');
    expect(previous.status).toBe('SUPERSEDED');
    expect(previous.snapshot.supersededBy).toBe('r3');
    expect(() => previous.supersede('r4', '2026-12-02T00:00:00.000Z')).toThrow(/cannot SUPERSEDE/);
    expect(FORECAST_RUN_LIFECYCLE.allows('START', 'COMPLETED', 'RUNNING')).toBe(false);
  });

  it('[TC-FORECAST-SERVICE-004] una corrida sin datos suficientes queda INSUFFICIENT_DATA (terminal)', () => {
    const run = requested();
    run.start('2026-12-01T10:01:00.000Z');
    run.noData({ at: '2026-12-01T10:02:00.000Z', asOfPeriod: null, seriesInsufficient: 5 });
    expect(run.status).toBe('INSUFFICIENT_DATA');
    expect(() => run.start('2026-12-01T10:03:00.000Z')).toThrow();
  });

  it('[TC-FORECAST-SERVICE-029] reintenta a los 5, 15, 45 y 135 minutos y falla al quinto intento', () => {
    const run = requested();
    let at = '2026-12-01T10:00:00.000Z';
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      run.start(at);
      const outcome = run.failAttempt('SERVICE_UNAVAILABLE', at);
      if (outcome === 'RETRY') {
        waits.push((Date.parse(run.snapshot.nextAttemptAt) - Date.parse(at)) / 60_000);
        at = run.snapshot.nextAttemptAt;
      } else {
        expect(attempt).toBe(5);
      }
    }
    expect(waits).toEqual([5, 15, 45, 135]);
    expect(run.status).toBe('FAILED');
    expect(run.snapshot.failureReason).toBe('SERVICE_UNAVAILABLE');
    expect(run.snapshot.attempts).toBe(5);
  });

  it('[TC-FORECAST-SERVICE-029] pasadas 24 horas desde la solicitud falla aunque queden intentos', () => {
    const run = requested();
    run.start('2026-12-02T10:00:00.000Z');
    expect(run.failAttempt('TIMEOUT', '2026-12-02T10:00:00.000Z')).toBe('FAIL');
  });

  it('[TC-FORECAST-SERVICE-030] se completa en el tercer intento', () => {
    const run = requested();
    let at = '2026-12-01T10:00:00.000Z';
    for (let i = 0; i < 2; i += 1) {
      run.start(at);
      expect(run.failAttempt('SERVICE_UNAVAILABLE', at)).toBe('RETRY');
      at = run.snapshot.nextAttemptAt;
    }
    run.start(at);
    run.complete({
      at: minutes(at, 1),
      asOfPeriod: '2026-11',
      datasetSnapshotId: 'sha256:x',
      serviceVersion: '0.1.0',
      seriesPublished: 1,
      seriesInsufficient: 0,
      seriesInvalid: 0,
    });
    expect(run.status).toBe('COMPLETED');
    expect(run.snapshot.attempts).toBe(2);
  });

  it('[TC-FORECAST-SERVICE-040] el recorrido registra solicitar, iniciar, reintentar, iniciar, completar y reemplazar', () => {
    const steps: string[] = [];
    const run = requested();
    steps.push(run.lastTransition?.transition ?? '');
    run.start('2026-12-01T10:01:00.000Z');
    steps.push(run.lastTransition?.transition ?? '');
    run.failAttempt('SERVICE_UNAVAILABLE', '2026-12-01T10:02:00.000Z');
    steps.push(run.lastTransition?.transition ?? '');
    run.start(run.snapshot.nextAttemptAt);
    steps.push(run.lastTransition?.transition ?? '');
    run.complete({
      at: '2026-12-01T10:08:00.000Z',
      asOfPeriod: '2026-11',
      datasetSnapshotId: 'sha256:x',
      serviceVersion: '0.1.0',
      seriesPublished: 1,
      seriesInsufficient: 0,
      seriesInvalid: 0,
    });
    steps.push(run.lastTransition?.transition ?? '');
    run.supersede('r4', '2026-12-02T05:15:00.000Z');
    steps.push(run.lastTransition?.transition ?? '');
    expect(steps).toEqual(['REQUEST', 'START', 'RETRY', 'START', 'COMPLETE', 'SUPERSEDE']);
    expect(run.version).toBe(6);
  });

  it('[TC-FORECAST-SERVICE-040] una corrida colgada 15 minutos se detecta', () => {
    const run = requested();
    run.start('2026-12-01T10:00:00.000Z');
    expect(run.isStalled('2026-12-01T10:14:00.000Z', DEFAULT_RETRY_POLICY)).toBe(false);
    expect(run.isStalled('2026-12-01T10:15:00.000Z', DEFAULT_RETRY_POLICY)).toBe(true);
  });

  it('una corrida manual exige el usuario que la solicita', () => {
    expect(() =>
      ForecastRun.request({
        id: 'r',
        workspaceId: 'w',
        trigger: 'MANUAL',
        requestedBy: null,
        at: '2026-12-01T10:00:00.000Z',
        reportingCurrency: 'BOB',
      }),
    ).toThrow();
  });
});
