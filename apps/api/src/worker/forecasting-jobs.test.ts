import { createLogger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runForecastSchedule } from '@pf/forecasting/interface/forecasting.module';
import { registerForecastingJobs } from './forecasting-jobs.js';

// Registro de los jobs de pronósticos con una cola falsa: sin Docker ni red.
const logger = createLogger({
  service: 'finance-worker',
  role: 'worker',
  environment: 'ci',
  level: 'fatal',
  destination: new Writable({ write: (_c, _e, cb) => cb() }),
});

function fakeQueue() {
  const calls = {
    work: [] as string[],
    schedule: [] as [string, string][],
    unschedule: [] as string[],
    send: [] as string[],
  };
  const queue = {
    work: async (name: string) => void calls.work.push(name),
    schedule: async (name: string, cron: string) => void calls.schedule.push([name, cron]),
    unschedule: async (name: string) => void calls.unschedule.push(name),
    send: async (name: string) => {
      calls.send.push(name);
      return 'job';
    },
  } as unknown as JobQueue;
  return { queue, calls };
}

const runtime = {
  schedule: { run: async () => ({}) },
  execute: { runOnce: async () => ({ kind: 'IDLE' }) },
} as never;
const base = { scheduleCron: '15 5 * * *', runnerCron: '* * * * *', runOnStart: false };

describe('registerForecastingJobs', () => {
  it('[TC-FORECAST-SERVICE-010] deshabilitado no registra trabajos ni consumidores y retira los cron', async () => {
    const { queue, calls } = fakeQueue();
    await registerForecastingJobs(queue, runtime, logger, { ...base, enabled: false });
    expect(calls.work).toEqual([]);
    expect(calls.schedule).toEqual([]);
    expect(calls.unschedule).toEqual(['forecasting.schedule', 'forecasting.runner']);
  });

  it('[TC-FORECAST-SERVICE-010] habilitado registra los dos trabajos periódicos (sin consumidores de eventos) y sus cron', async () => {
    const { queue, calls } = fakeQueue();
    await registerForecastingJobs(queue, runtime, logger, { ...base, enabled: true });
    expect(calls.work).toEqual(['forecasting.schedule', 'forecasting.runner']);
    expect(calls.schedule).toEqual([
      ['forecasting.schedule', '15 5 * * *'],
      ['forecasting.runner', '* * * * *'],
    ]);
    expect(calls.send).toEqual([]);
  });

  // add-spending-anomaly-detection (decisión 6): las cuatro combinaciones de FORECASTING_ENABLED y FORECASTING_ANOMALIES_ENABLED.
  it('[TC-FORECAST-ANOMALY-011] sin pronósticos y con la detección registra solo el trabajo diario, sin ejecutor, y retira el cron del ejecutor', async () => {
    const { queue, calls } = fakeQueue();
    await registerForecastingJobs(queue, runtime, logger, {
      ...base,
      enabled: false,
      anomaliesEnabled: true,
    });
    expect(calls.work).toEqual(['forecasting.schedule']);
    expect(calls.schedule).toEqual([['forecasting.schedule', '15 5 * * *']]);
    expect(calls.unschedule).toEqual(['forecasting.runner']);
  });

  it('[TC-FORECAST-ANOMALY-011] con pronósticos y sin la detección registra los dos trabajos como antes', async () => {
    const { queue, calls } = fakeQueue();
    await registerForecastingJobs(queue, runtime, logger, {
      ...base,
      enabled: true,
      anomaliesEnabled: false,
    });
    expect(calls.work).toEqual(['forecasting.schedule', 'forecasting.runner']);
    expect(calls.unschedule).toEqual([]);
  });

  it('[TC-FORECAST-ANOMALY-011] con pronósticos y con la detección registra los dos trabajos', async () => {
    const { queue, calls } = fakeQueue();
    await registerForecastingJobs(queue, runtime, logger, { ...base, enabled: true, anomaliesEnabled: true });
    expect(calls.work).toEqual(['forecasting.schedule', 'forecasting.runner']);
    expect(calls.schedule).toHaveLength(2);
  });

  it('[TC-FORECAST-ANOMALY-011] sin pronósticos ni detección no registra nada y retira los dos cron', async () => {
    const { queue, calls } = fakeQueue();
    await registerForecastingJobs(queue, runtime, logger, {
      ...base,
      enabled: false,
      anomaliesEnabled: false,
    });
    expect(calls.work).toEqual([]);
    expect(calls.unschedule).toEqual(['forecasting.schedule', 'forecasting.runner']);
  });

  it('con `off` no programa el cron del trabajo y la pasada de arranque encola solo el diario', async () => {
    const { queue, calls } = fakeQueue();
    await registerForecastingJobs(queue, runtime, logger, {
      ...base,
      enabled: true,
      runnerCron: 'off',
      runOnStart: true,
    });
    expect(calls.schedule).toEqual([['forecasting.schedule', '15 5 * * *']]);
    expect(calls.unschedule).toEqual(['forecasting.runner']);
    expect(calls.send).toEqual(['forecasting.schedule']);
  });

  it('sin programar cron (benchmarks y tests) solo registra el trabajo', async () => {
    const { queue, calls } = fakeQueue();
    await registerForecastingJobs(queue, runtime, logger, { ...base, enabled: true, scheduleCrons: false });
    expect(calls.work).toHaveLength(2);
    expect(calls.schedule).toEqual([]);
  });
});

describe('runForecastSchedule: dos pasos independientes', () => {
  const summary = { workspaces: 1, created: 0, purged: 0, failed: 0, errors: [] };
  const detected = { workspaces: 1, evaluated: 3, flagged: 1, purged: 0, failed: 0, errors: [] };

  it('[TC-FORECAST-ANOMALY-011] la falla del paso de corridas no impide la detección', async () => {
    const calls: string[] = [];
    const result = await runForecastSchedule(
      {
        schedule: {
          run: async () => {
            calls.push('schedule');
            throw new Error('boom');
          },
        },
        anomalies: {
          detect: {
            run: async () => {
              calls.push('detect');
              return detected;
            },
          },
        },
      } as never,
      logger,
      'manual',
    );
    expect(calls).toEqual(['schedule', 'detect']);
    expect(result.anomalies).toEqual(detected);
  });

  it('[TC-FORECAST-ANOMALY-011] la falla de la detección no impide el resultado de las corridas programadas', async () => {
    const result = await runForecastSchedule(
      {
        schedule: { run: async () => summary },
        anomalies: {
          detect: {
            run: async () => {
              throw new Error('boom');
            },
          },
        },
      } as never,
      logger,
      'cron',
    );
    expect(result).toMatchObject({ workspaces: 1, created: 0, anomalies: null });
  });
});
