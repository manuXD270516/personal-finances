import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { EventConsumerDefinition } from '@pf/platform/events';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { money, startHarness, until, type Harness, type User } from '../support/portability.js';
import { perfOutDir, recordSuiteLoad } from './background-load.js';
import {
  BURST_EVENT_TYPES,
  LockWaitSampler,
  SamplingMetrics,
  consumerBacklogWithZeros,
  generateCsv,
  jobFailures,
  outboxPending,
  retriedJobs,
} from './burst-support.js';
import { DrainTracker } from './connection-budget.js';
import { IMPORTS_API_POOL_MAX, PERF_RATE_LIMITS } from './perf-env.js';
import {
  writeConsumerCostReport,
  type ConsumerCost,
  type ConsumerDrain,
  type JobFailure,
  type RetriedJobs,
} from './perf-report.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

recordSuiteLoad(import.meta.url, inject('deps').superuserUrl);

/**
 * Perfil de ráfaga del import y costo por evento de cada consumidor (optimize-consumer-throughput, E6–E10b; D300, D301,
 * TC-PLATFORM-THROUGHPUT-008/012/013). Informativo: no decide el veredicto del job (D300); la fila bloqueante de la
 * ráfaga con la configuración del host es la de `imports.perf.ts` (D311).
 *
 * Fase A (E6, E7, E9, E10b): se persisten N transacciones importadas con los consumidores de la ráfaga detenidos (el
 * relay publica en sus colas), se detiene el worker y se arranca otro con la configuración de la plantilla del host
 * (concurrencia 1, pool 34); se mide el drenado de cada cola y del outbox desde el arranque, la duración por evento
 * de cada consumidor y las esperas por bloqueos.
 *
 * Fase B (E8): otro backlog igual; cada consumidor de la ráfaga drena SOLO, uno a uno, para medir su ritmo aislado.
 */
const ROWS = Number(process.env['PF_PERF_BURST_ROWS'] ?? 5000);
const DRAIN_BUDGET_MS = 120_000;
/** Tope de espera por consumidor: más allá se publica «sin llegar a 0» con lo procesado hasta entonces. */
const SOLO_CAP_MS = 20 * 60_000;
const HOST_ENV = { EVENT_CONSUMER_CONCURRENCY: '1', DATABASE_POOL_MAX: '34' } as const;

let h: Harness;
let sampler: Client;
const metrics = new SamplingMetrics();
let first = true;
let burstDefs: readonly EventConsumerDefinition[] = [];

const isBurst = (def: EventConsumerDefinition): boolean =>
  def.events.some((e) => (BURST_EVENT_TYPES as readonly string[]).includes(e.type));

beforeAll(async () => {
  h = await startHarness({
    apiEnv: { ...PERF_RATE_LIMITS, DATABASE_POOL_MAX: String(IMPORTS_API_POOL_MAX) },
  });
  sampler = new Client({
    connectionString: inject('deps').superuserUrl,
    application_name: 'pf-perf-lock-sampler',
  });
  await sampler.connect();
}, 300_000);

afterAll(async () => {
  await h?.close();
  await sampler?.end();
});

async function startWorker(filter?: (def: EventConsumerDefinition) => boolean): Promise<void> {
  await h.stopWorker();
  await h.startWorker(
    { metrics, ...(filter ? { startConsumers: filter } : {}) },
    { env: HOST_ENV, discardBacklog: first },
  );
  first = false;
}

/** Persiste ROWS transacciones con el worker sin los consumidores de la ráfaga; deja sus colas llenas. */
async function persistBacklog(label: string): Promise<{ persistMs: number; user: User }> {
  await startWorker((def) => !isBurst(def));
  const user = await h.user(`kc-burst-${label}-${randomUUID()}`);
  const W = `/api/v1/workspaces/${user.ws}`;
  const account = await h.call('POST', `${W}/accounts`, {
    token: user.token,
    body: {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('10000000.00'), date: '2026-07-01' },
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(account.status).toBe(201);
  const form = new FormData();
  form.append('file', new Blob([generateCsv(ROWS)], { type: 'text/csv' }), `extracto-${String(ROWS)}.csv`);
  form.append('accountId', account.body['id'] as string);
  const upload = await h.call('POST', `${W}/imports`, {
    token: user.token,
    form,
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(upload.status, JSON.stringify(upload.body)).toBe(201);
  const mapped = await h.call('PUT', `${W}/imports/${upload.body['id'] as string}/mapping`, {
    token: user.token,
    body: {
      hasHeader: true,
      skipRows: 0,
      columns: {
        date: { index: 0 },
        description: { index: 1 },
        amount: { mode: 'SIGNED', index: 2, signConvention: 'NEGATIVE_IS_OUTFLOW' },
      },
      dateFormat: 'dd/MM/yyyy',
      decimalSeparator: ',',
    },
    headers: { 'if-match': `"${String(upload.body['version'])}"` },
  });
  expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
  const t0 = performance.now();
  const approved = await h.call('POST', `${W}/imports/${upload.body['id'] as string}/approve`, {
    token: user.token,
    headers: { 'idempotency-key': randomUUID(), 'if-match': `"${String(mapped.body['version'])}"` },
  });
  expect(approved.status, JSON.stringify(approved.body)).toBe(202);
  await until(
    async () => {
      const r = await h.call('GET', `${W}/imports/${upload.body['id'] as string}`, { token: user.token });
      return ['COMPLETED', 'PARTIALLY_FAILED'].includes(r.body['status'] as string) ? r.body : undefined;
    },
    900_000,
    500,
  );
  const persistMs = performance.now() - t0;
  // El relay publica el resto del outbox en las colas (los consumidores de la ráfaga siguen detenidos).
  await until(async () => ((await outboxPending(h)) === 0 ? true : undefined), 600_000, 500);
  return { persistMs, user };
}

const artifacts: Record<string, unknown> = {};

function writeArtifacts(): void {
  const dir = perfOutDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'throughput-perf.json'), `${JSON.stringify(artifacts, null, 2)}\n`, 'utf8');
}

describe('ráfaga del import y costo por consumidor', () => {
  const cost: ConsumerCost[] = [];

  it('[TC-PLATFORM-THROUGHPUT-008] fase A: la ráfaga con la configuración del host, drenado por consumidor, duración por evento, bloqueos y reintentos', async () => {
    const { persistMs } = await persistBacklog('a');
    const startedAt = new Date(Date.now() - 1000);
    await h.stopWorker();
    const before = await consumerBacklogWithZeros(h);
    const burstQueues = [...before.backlog].filter(([, n]) => n > 0).map(([q]) => q);
    metrics.reset();
    const locks = new LockWaitSampler(sampler);
    locks.start();
    const tracker = new DrainTracker();
    const t0 = performance.now();
    await startWorker();
    burstDefs = h.worker!.subscriptions.definitions().filter(isBurst);
    try {
      await until(
        async () => {
          const { backlog, retrying } = await consumerBacklogWithZeros(h);
          const outbox = await outboxPending(h);
          tracker.observe(performance.now() - t0, backlog, outbox, retrying);
          const pending = [...backlog.values()].reduce((a, b) => a + b, 0);
          return pending === 0 && outbox === 0 ? true : undefined;
        },
        SOLO_CAP_MS,
        500,
      );
    } catch {
      // Se publica lo observado: las colas que no llegaron a 0 figuran como «sin llegar a 0».
    }
    const totalMs = performance.now() - t0;
    const lockWaits = locks.stop();
    const drainByConsumer: ConsumerDrain[] = tracker
      .result()
      .filter((d) => burstQueues.includes(d.queue) || d.queue === 'outbox');
    const retries: RetriedJobs[] = await retriedJobs(h, startedAt).catch(() => []);
    const failures: JobFailure[] = jobFailures(h);
    const durations = Object.fromEntries([...metrics.samples.keys()].map((c) => [c, metrics.percentiles(c)]));
    artifacts['burstHost'] = {
      rows: ROWS,
      persistMs: Math.round(persistMs),
      drainBudgetMs: DRAIN_BUDGET_MS,
      totalDrainMs: Math.round(totalMs),
      burstQueues,
      drainByConsumer,
      durationsMs: durations,
      lockWaits,
      retries,
      jobFailures: failures,
    };
    writeArtifacts();
    console.log(
      JSON.stringify({ test: 'TC-PLATFORM-THROUGHPUT-008', ...(artifacts['burstHost'] as object) }),
    );
    expect(drainByConsumer.length).toBeGreaterThan(0);
  }, 3_600_000);

  it('[TC-PLATFORM-THROUGHPUT-012] fase B: cada consumidor de la ráfaga drena solo; ritmo aislado, p50/p95 y esperas por bloqueos', async () => {
    await persistBacklog('b');
    await h.stopWorker();
    const { backlog } = await consumerBacklogWithZeros(h);
    const defs = burstDefs;
    const solo: Record<string, unknown> = {};
    for (const def of defs) {
      const queue = `events.${def.consumer}`;
      const pending = backlog.get(queue) ?? 0;
      if (pending === 0) continue;
      metrics.reset();
      const locks = new LockWaitSampler(sampler);
      locks.start();
      const t0 = performance.now();
      await startWorker((d) => d.consumer === def.consumer);
      let remaining = pending;
      try {
        await until(
          async () => {
            const now = await consumerBacklogWithZeros(h);
            remaining = now.backlog.get(queue) ?? 0;
            return remaining === 0 ? true : undefined;
          },
          SOLO_CAP_MS,
          500,
        );
      } catch {
        // «sin llegar a 0»: el ritmo se calcula con lo procesado.
      }
      const elapsedMs = performance.now() - t0;
      const lockWaits = locks.stop();
      await h.stopWorker();
      const processed = pending - remaining;
      const pct = metrics.percentiles(def.consumer);
      const eventsPerSecond = elapsedMs > 0 ? Math.round((processed / (elapsedMs / 1000)) * 10) / 10 : null;
      cost.push({
        consumer: def.consumer,
        p50Ms: pct.p50Ms,
        p95Ms: pct.p95Ms,
        soloEventsPerSecond: eventsPerSecond,
        lockWaitsMs: lockWaits.totalMs,
        ...(def.grouping ? { groupSize: def.grouping.maxBatch ?? 100 } : {}),
        gate: false,
      });
      solo[def.consumer] = {
        pending,
        processed,
        elapsedMs: Math.round(elapsedMs),
        eventsPerSecond,
        projectedDrainMsAtHost: eventsPerSecond ? Math.round((pending / eventsPerSecond) * 1000) : null,
        durations: pct,
        lockWaits,
      };
    }
    artifacts['solo'] = solo;
    writeArtifacts();
    writeConsumerCostReport(cost, perfOutDir());
    console.log(JSON.stringify({ test: 'TC-PLATFORM-THROUGHPUT-012', solo }));
    expect(cost.length).toBeGreaterThan(0);
  }, 5_400_000);
});
