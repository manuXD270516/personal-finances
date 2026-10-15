import {
  createFxMarketRateJobs,
  parseFxProviderSettings,
  providerHostsFor,
  type FxProviderEnv,
} from '@pf/fx/interface/fx.module';
import { createLogger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Writable } from 'node:stream';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { fxEndpointsFromConfig, registerFxMarketRateJobs } from './fx-jobs.js';

// Registro de los jobs de providers (tarea 4.4) con una cola falsa: sin Docker ni red.
const pool = new Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none', max: 1 });
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
    schedule: [] as [string, string, string][],
    unschedule: [] as string[],
    send: [] as string[],
  };
  const queue = {
    work: async (name: string) => void calls.work.push(name),
    schedule: async (name: string, cron: string, _p: object, o?: { tz?: string }) =>
      void calls.schedule.push([name, cron, o?.tz ?? 'UTC']),
    unschedule: async (name: string) => void calls.unschedule.push(name),
    send: async (name: string) => {
      calls.send.push(name);
      return 'job';
    },
  } as unknown as JobQueue;
  return { queue, calls };
}

const jobsFor = (env: FxProviderEnv) =>
  createFxMarketRateJobs({
    pool,
    clock: new FixedClock(Instant.parse('2026-10-02T09:00:00Z')),
    outbox: { append: async () => undefined },
    workspaces: { list: async () => [] },
    settings: parseFxProviderSettings(env),
  });

afterAll(async () => {
  await pool.end();
});

describe('registerFxMarketRateJobs (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-005] FX_POLL_INTERVAL=30m programa */30 * * * *, la carga histórica y el relleno diario; FX consume WorkspaceCreated', async () => {
    const { queue, calls } = fakeQueue();
    const consumers = await registerFxMarketRateJobs(queue, jobsFor({ FX_POLL_INTERVAL: '30m' }), logger);
    expect(calls.work).toEqual(['fx.poll-market-rates', 'fx.backfill-historical-rates', 'fx.fill-rate-gaps']);
    expect(calls.schedule).toEqual([
      ['fx.poll-market-rates', '*/30 * * * *', 'UTC'],
      ['fx.fill-rate-gaps', '0 2 * * *', 'America/La_Paz'],
    ]);
    expect(calls.send).toEqual(['fx.fill-rate-gaps']);
    expect(consumers.map((c) => [c.consumer, c.events])).toEqual([
      ['fx.market-rate-provisioning', [{ type: 'identity.WorkspaceCreated', version: 1 }]],
    ]);
  });

  it('[TC-FX-PROVIDER-014] con los providers en none no se registra ninguna cola ni consumidor (y se desprograman)', async () => {
    const { queue, calls } = fakeQueue();
    const consumers = await registerFxMarketRateJobs(
      queue,
      jobsFor({ FX_PROVIDER_PRIMARY: 'none', FX_PROVIDER_FALLBACK: 'none', FX_PROVIDER_OFFICIAL: 'none' }),
      logger,
    );
    expect([consumers, calls.work, calls.schedule, calls.send]).toEqual([[], [], [], []]);
    expect(calls.unschedule).toEqual(['fx.poll-market-rates', 'fx.fill-rate-gaps']);
  });

  it('[TC-FX-PROVIDER-011] FX_POLL_INTERVAL=30s: los providers no se inician pero el registro no falla (el worker sigue)', async () => {
    const { queue, calls } = fakeQueue();
    const jobs = jobsFor({ FX_POLL_INTERVAL: '30s' });
    expect(jobs.settings.configError).not.toBeNull();
    await expect(registerFxMarketRateJobs(queue, jobs, logger)).resolves.toEqual([]);
    expect(calls.work).toEqual([]);
  });
});

describe('providers por institución en el worker (add-exchange-house-rate-providers)', () => {
  it('[TC-FX-INSTRATE-001] el default (none) no cambia los jobs: sin provider por institución no se consulta ninguna fuente nueva y el presupuesto de conexiones no cambia', async () => {
    const { queue, calls } = fakeQueue();
    const jobs = jobsFor({});
    expect(jobs.settings.institutionProvider).toBeNull();
    const consumers = await registerFxMarketRateJobs(queue, jobs, logger);
    // Mismas colas y mismo consumidor que antes del change: ningún consumidor nuevo (D249).
    expect(calls.work).toEqual(['fx.poll-market-rates', 'fx.backfill-historical-rates', 'fx.fill-rate-gaps']);
    expect(consumers.map((c) => c.consumer)).toEqual(['fx.market-rate-provisioning']);
  });

  it('[TC-FX-INSTRATE-001] un provider por institución sin verificación deja los demás providers funcionando y el registro no falla', async () => {
    const { queue, calls } = fakeQueue();
    const jobs = jobsFor({ FX_PROVIDER_INSTITUTION_RATES: 'instrate_sin_verificar' });
    expect(jobs.settings.institutionConfigError).toMatch(/no registered adapter/);
    expect(jobs.settings.configError).toBeNull();
    expect(jobs.enabled).toBe(true);
    await registerFxMarketRateJobs(queue, jobs, logger);
    expect(calls.work).toContain('fx.poll-market-rates');
    expect(calls.schedule[0]).toEqual(['fx.poll-market-rates', '*/15 * * * *', 'UTC']);
  });
});

describe('fxEndpointsFromConfig (providers simulados en E2E, solo local/ci)', () => {
  it('sin URL alternativas usa los providers reales; con URL, la allowlist suma su host', () => {
    expect(fxEndpointsFromConfig({})).toBeUndefined();
    const endpoints = fxEndpointsFromConfig({
      FX_PROVIDER_PARALELO_BO_URL: 'http://host.docker.internal:39090',
    });
    expect(endpoints).toEqual({ baseUrls: { PARALELO_BO: 'http://host.docker.internal:39090' } });
    expect(providerHostsFor(endpoints!.baseUrls!)).toEqual([
      'paralelo.bo',
      'bo.dolarapi.com',
      'host.docker.internal',
    ]);
  });
});
