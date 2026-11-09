import { createLogger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { registerCashFlowWatchJob } from './reporting-jobs.js';

// Registro del job de vigilancia del flujo de caja con una cola falsa: sin Docker ni red.
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

const watch = { run: async () => ({ failed: 0, opened: 0, closed: 0, errors: [] }) } as never;

describe('registerCashFlowWatchJob', () => {
  it('[TC-PLATFORM-PIPELINE-040] sin cron ni pasada de arranque no programa ni encola nada', async () => {
    const { queue, calls } = fakeQueue();
    await registerCashFlowWatchJob(queue, watch, logger, {
      cron: '25 * * * *',
      runOnStart: false,
      scheduleCrons: false,
    });
    expect(calls.work).toEqual(['reporting.cash-flow-watch']);
    expect(calls.schedule).toEqual([]);
    expect(calls.send).toEqual([]);
  });

  it('en producción (por omisión) programa el cron horario y encola la pasada de arranque', async () => {
    const { queue, calls } = fakeQueue();
    await registerCashFlowWatchJob(queue, watch, logger, { cron: '25 * * * *', runOnStart: true });
    expect(calls.schedule).toEqual([['reporting.cash-flow-watch', '25 * * * *']]);
    expect(calls.send).toEqual(['reporting.cash-flow-watch']);
  });
});
