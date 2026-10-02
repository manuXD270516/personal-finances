// Throughput aproximado y lag del outbox: 10k eventos escritos por la API mientras relay+consumidor corren.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { makePool, migrate, resetData } from '../src/db.js';
import { recordTransaction } from '../src/api.js';
import { Relay } from '../src/relay.js';
import { makeOption, type OptionId } from '../src/options.js';
import { pct, saveResult, scalar, waitFor } from './helpers.js';

const N = Number(process.env.PERF_N ?? 10_000);
const WRITERS = 16;
const pool = makePool(60);
beforeAll(async () => { await migrate(pool); });
afterAll(async () => { await pool.end(); });

const VARIANTS: { key: string; id: OptionId; pgBossTransactional?: boolean }[] = [
  { key: 'A', id: 'A' },
  { key: 'B', id: 'B' },
  { key: 'C', id: 'C' },
  { key: 'C-transactional', id: 'C', pgBossTransactional: true },
];

describe.each(VARIANTS)('throughput $key', ({ key, id, pgBossTransactional }) => {
  it(`${N} eventos`, async () => {
    await resetData(pool);
    const opt = makeOption(id, pool);
    await opt.init();
    const relay = new Relay(pool, opt.publisher, { batchSize: 500, pollMs: 200 });
    await opt.startConsumer({ concurrency: 16, pgBossTransactional });
    await relay.start();

    const accounts = Array.from({ length: 200 }, () => uuidv4());
    const lat: number[] = [];
    const t0 = Date.now();
    let next = 0;
    await Promise.all(Array.from({ length: WRITERS }, async () => {
      while (next < N) {
        const i = next++;
        const s = performance.now();
        await recordTransaction(pool, { accountId: accounts[i % accounts.length], amount: '1.00' });
        lat.push(performance.now() - s);
      }
    }));
    const apiMs = Date.now() - t0;
    await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM platform.inbox')) >= N, 600_000, 200);
    const totalMs = Date.now() - t0;

    const { rows: lag } = await pool.query(`SELECT
        extract(epoch FROM (o.published_at - o.created_at))*1000 AS outbox_lag,
        extract(epoch FROM (i.processed_at - o.created_at))*1000 AS e2e
      FROM platform.outbox o JOIN platform.inbox i ON i.event_id = o.id`);
    const ol = lag.map((r) => Number(r.outbox_lag));
    const e2e = lag.map((r) => Number(r.e2e));
    const r = {
      events: N, writers: WRITERS, consumerConcurrency: 16,
      api: { totalMs: apiMs, writesPerSec: Math.round(N / (apiMs / 1000)), p50ms: +pct(lat, 50).toFixed(1), p99ms: +pct(lat, 99).toFixed(1) },
      endToEnd: { totalMs, eventsPerSec: Math.round(N / (totalMs / 1000)), p50ms: Math.round(pct(e2e, 50)), p99ms: Math.round(pct(e2e, 99)) },
      outboxLag: { p50ms: Math.round(pct(ol, 50)), p95ms: Math.round(pct(ol, 95)), p99ms: Math.round(pct(ol, 99)), maxms: Math.round(Math.max(...ol)) },
      duplicates: await scalar(pool, 'SELECT count(*) FROM app.delivery WHERE duplicate'),
    };
    console.log(key, JSON.stringify(r));
    saveResult('perf', { [key]: r });
    expect(await scalar(pool, 'SELECT sum(applied_count) FROM app.balance')).toBe(N);
    await relay.stop();
    await opt.stopConsumer();
    await opt.close();
  });

  // C-transactional (batchSize 1, sin burst) drena ~1 job / 0,5 s por worker: > 5 min para 10k => se omite
  it.skipIf(!!pgBossTransactional)(`drenar backlog de ${N} eventos (sólo relay+cola+consumidor)`, async () => {
    await resetData(pool);
    const accounts = Array.from({ length: 200 }, () => uuidv4());
    let next = 0;
    await Promise.all(Array.from({ length: WRITERS }, async () => {
      while (next < N) { const i = next++; await recordTransaction(pool, { accountId: accounts[i % 200], amount: '1.00' }); }
    }));
    const opt = makeOption(id, pool);
    await opt.init();
    const relay = new Relay(pool, opt.publisher, { batchSize: 500, pollMs: 200 });
    await opt.startConsumer({ concurrency: 16, pgBossTransactional });
    const t0 = Date.now();
    await relay.start();
    const relayMs = await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM platform.outbox WHERE published_at IS NULL')) === 0, 600_000, 100);
    await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM platform.inbox')) >= N, 600_000, 100);
    const totalMs = Date.now() - t0;
    const r = { events: N, relayPublishMs: relayMs, relayEventsPerSec: Math.round(N / (relayMs / 1000)), drainMs: totalMs, consumeEventsPerSec: Math.round(N / (totalMs / 1000)) };
    console.log(key, 'backlog', JSON.stringify(r));
    saveResult('perf', { [key + ' backlog']: r });
    await relay.stop();
    await opt.stopConsumer();
    await opt.close();
  });
});
