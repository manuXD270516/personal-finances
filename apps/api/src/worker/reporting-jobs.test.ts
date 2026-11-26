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
  const handlers: ((job: { payload: { trigger: string } }) => Promise<void>)[] = [];
  const calls = {
    work: [] as string[],
    schedule: [] as [string, string][],
    unschedule: [] as string[],
    send: [] as string[],
  };
  const queue = {
    work: async (
      name: string,
      _opts: unknown,
      handler: (job: { payload: { trigger: string } }) => Promise<void>,
    ) => {
      calls.work.push(name);
      handlers.push(handler);
    },
    schedule: async (name: string, cron: string) => void calls.schedule.push([name, cron]),
    unschedule: async (name: string) => void calls.unschedule.push(name),
    send: async (name: string) => {
      calls.send.push(name);
      return 'job';
    },
  } as unknown as JobQueue;
  return { queue, calls, handlers };
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

describe('registerCashFlowWatchJob: paso de riesgo de presupuesto', () => {
  const budgetRun = (box: { calls: number }) =>
    ({
      run: async () => {
        box.calls += 1;
        return { workspaces: 1, notified: 0, failed: 0, errors: [], durationMs: 3 };
      },
    }) as never;
  const opts = { cron: '25 * * * *', runOnStart: false, scheduleCrons: false };

  it('[TC-REPORTING-INSIGHT-015] el paso corre dentro del mismo trabajo, sin trabajos nuevos', async () => {
    const { queue, calls, handlers } = fakeQueue();
    const box = { calls: 0 };
    await registerCashFlowWatchJob(queue, watch, logger, opts, budgetRun(box));
    expect(calls.work).toEqual(['reporting.cash-flow-watch']);
    await handlers[0]?.({ payload: { trigger: 'cron' } });
    expect(box.calls).toBe(1);
  });

  it('[TC-REPORTING-INSIGHT-015] una falla del paso de riesgo no afecta al del flujo de caja ni lo hace fallar', async () => {
    const { queue, handlers } = fakeQueue();
    let cashFlowRuns = 0;
    const cashFlow = {
      run: async () => {
        cashFlowRuns += 1;
        return { failed: 0, opened: 0, closed: 0, errors: [] };
      },
    } as never;
    const broken = {
      run: async () => {
        throw new Error('boom');
      },
    } as never;
    await registerCashFlowWatchJob(queue, cashFlow, logger, opts, broken);
    await expect(handlers[0]?.({ payload: { trigger: 'cron' } })).resolves.toBeUndefined();
    expect(cashFlowRuns).toBe(1);
  });

  it('[TC-REPORTING-INSIGHT-015] una falla del flujo de caja no impide el paso de riesgo y se relanza para reintentar', async () => {
    const { queue, handlers } = fakeQueue();
    const box = { calls: 0 };
    const failing = {
      run: async () => {
        throw new Error('listing failed');
      },
    } as never;
    await registerCashFlowWatchJob(queue, failing, logger, opts, budgetRun(box));
    await expect(handlers[0]?.({ payload: { trigger: 'cron' } })).rejects.toThrow('listing failed');
    expect(box.calls).toBe(1);
  });
});
