// Opción A: comportamiento con Valkey caído. La API debe seguir aceptando escrituras (el outbox está en PG).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { makePool, migrate, resetData } from '../src/db.js';
import { recordTransaction } from '../src/api.js';
import { Relay, sweepUnconsumed } from '../src/relay.js';
import { makeOption } from '../src/options.js';
import { CONSUMER, sleep } from '../src/config.js';
import { compose, pct, saveResult, scalar, waitFor } from './helpers.js';

const pool = makePool(20);
beforeAll(async () => { await migrate(pool); });
afterAll(async () => {
  compose('up -d --wait valkey'); // dejar el entorno sano pase lo que pase
  await pool.end();
});

describe('opción A con Valkey caído', () => {
  it('la API acepta escrituras; el relay reintenta; al volver Valkey todo se entrega', async () => {
    await resetData(pool);
    const opt = makeOption('A', pool);
    await opt.init();
    const relay = new Relay(pool, opt.publisher, { publishTimeoutMs: 2000 });
    await opt.startConsumer({ concurrency: 8 });
    await relay.start();

    compose('stop valkey');
    const acc = uuidv4();
    const lat: number[] = [];
    for (let i = 0; i < 100; i++) {
      const s = performance.now();
      await recordTransaction(pool, { accountId: acc, amount: '2.00' }); // no debe lanzar
      lat.push(performance.now() - s);
    }
    await sleep(3000);
    const errorsWhileDown = relay.errors;
    expect(errorsWhileDown).toBeGreaterThan(0);
    expect(await scalar(pool, 'SELECT count(*) FROM platform.outbox WHERE published_at IS NULL')).toBe(100);
    expect(await scalar(pool, 'SELECT count(*) FROM platform.inbox')).toBe(0);

    const t0 = Date.now();
    compose('up -d --wait valkey');
    await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM platform.inbox')) === 100, 60_000);
    const recoveryMs = Date.now() - t0;
    expect(await scalar(pool, 'SELECT total FROM app.balance')).toBe(200);

    // --- Pérdida de datos en Valkey (sin persistencia): jobs publicados pero no consumidos se pierden ---
    await opt.stopConsumer();
    for (let i = 0; i < 50; i++) await recordTransaction(pool, { accountId: acc, amount: '2.00' });
    await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM platform.outbox WHERE published_at IS NULL')) === 0);
    compose('kill valkey');
    compose('up -d --wait valkey');
    await opt.startConsumer({ concurrency: 8 });
    await sleep(4000);
    const appliedAfterLoss = await scalar(pool, 'SELECT count(*) FROM platform.inbox');
    expect(appliedAfterLoss).toBe(100); // los 50 "publicados" se perdieron con Valkey
    const swept = await sweepUnconsumed(pool, CONSUMER, 1000);
    expect(swept).toBe(50);
    await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM platform.inbox')) === 150, 60_000);
    expect(await scalar(pool, 'SELECT total FROM app.balance')).toBe(300);

    saveResult('valkey-down', {
      apiWritesWhileValkeyDown: { count: 100, failed: 0, p50ms: +pct(lat, 50).toFixed(1), p99ms: +pct(lat, 99).toFixed(1) },
      relayErrorsWhileDown: errorsWhileDown,
      recoveryMsAfterValkeyBack: recoveryMs,
      valkeyDataLoss: { publishedButLost: 150 - appliedAfterLoss, recoveredBySweeper: swept },
    });
    await relay.stop();
    await opt.close();
  });
});
