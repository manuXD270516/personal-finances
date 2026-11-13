import { createLogger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
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
