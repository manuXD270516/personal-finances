// Garantías semánticas por opción (A: BullMQ/Valkey, B: BullMQ/PG, C: pg-boss).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { makePool, migrate, resetData } from '../src/db.js';
import { recordTransaction } from '../src/api.js';
import { Relay } from '../src/relay.js';
import { makeOption, type OptionId, type QueueOption } from '../src/options.js';
import { validateEnvelope, makeEnvelope, EnvelopeValidationError } from '../src/envelope.js';
import { orderInversions, saveResult, scalar, waitFor } from './helpers.js';
import { sleep } from '../src/config.js';

const pool = makePool(40);
beforeAll(async () => { await migrate(pool); });
afterAll(async () => { await pool.end(); });

describe('envelope + transacción de negocio', () => {
  it('valida el envelope contra contracts/events/envelope.v1.schema.json (ajv 2020-12)', () => {
    const env = makeEnvelope({ aggregateId: uuidv4(), aggregateVersion: 1, payload: { x: 1 } });
    expect(() => validateEnvelope(env)).not.toThrow();
    expect(() => validateEnvelope({ ...env, eventType: 'TransactionPosted' })).toThrow(EnvelopeValidationError);
    expect(() => validateEnvelope({ ...env, eventId: uuidv4() })).toThrow(/pattern/); // no es UUIDv7
    expect(() => validateEnvelope({ ...env, occurredAt: '2026-10-01T10:00:00-05:00' })).toThrow();
    expect(() => validateEnvelope({ ...env, extra: 1 })).toThrow(/additional/);
  });

  it('rollback del comando => ni fila de negocio ni evento en outbox', async () => {
    await resetData(pool);
    await expect(recordTransaction(pool, { accountId: uuidv4(), amount: '10.00', failAfterOutbox: true })).rejects.toThrow();
    expect(await scalar(pool, 'SELECT count(*) FROM platform.outbox')).toBe(0);
    expect(await scalar(pool, 'SELECT count(*) FROM app.transaction')).toBe(0);
  });
});

const OPTIONS: OptionId[] = ['A', 'B', 'C'];

describe.each(OPTIONS)('opción %s', (id) => {
  let opt: QueueOption;
  let relay: Relay | undefined;
  afterEach(async () => {
    await relay?.stop(); relay = undefined;
    await opt?.close();
  });

  async function setup(init: Parameters<QueueOption['init']>[0] = {}) {
    await resetData(pool);
    opt = makeOption(id, pool);
    await opt.init(init);
  }

  it('crash del relay tras publicar y antes de marcar: ningún evento perdido, efecto exactamente una vez', async () => {
    await setup();
    const N = 300;
    const accounts = Array.from({ length: 10 }, () => uuidv4());
    for (let i = 0; i < N; i++) await recordTransaction(pool, { accountId: accounts[i % 10], amount: '1.25' });
    let calls = 0;
    // los 3 primeros lotes "crashean" después de publicar en la cola pero antes del UPDATE published_at
    relay = new Relay(pool, opt.publisher, { batchSize: 50, crashAfterPublish: () => ++calls <= 3 });
    await opt.startConsumer({ concurrency: 8 });
    await relay.start();
    await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM platform.inbox')) >= N, 60_000);
    await sleep(1500); // dar tiempo a duplicados tardíos
    expect(relay.errors).toBe(3);
    expect(await scalar(pool, 'SELECT count(*) FROM platform.outbox WHERE published_at IS NULL')).toBe(0);
    expect(await scalar(pool, 'SELECT count(*) FROM platform.inbox')).toBe(N);
    expect(await scalar(pool, 'SELECT count(*) FROM app.applied')).toBe(N);
    expect(await scalar(pool, 'SELECT sum(applied_count) FROM app.balance')).toBe(N);
    expect(await scalar(pool, 'SELECT sum(total) FROM app.balance')).toBe(N * 1.25);
    const dupDeliveries = await scalar(pool, 'SELECT count(*) FROM app.delivery WHERE duplicate');
    saveResult(`semantics-${id}`, { relayCrash: { events: N, crashedBatches: 3, duplicateDeliveriesSeenByConsumer: dupDeliveries, atomicPublish: opt.atomicPublish } });
  });

  it('entrega duplicada (misma eventId, 5 copias concurrentes) => efecto exactamente una vez', async () => {
    await setup();
    const env = await recordTransaction(pool, { accountId: uuidv4(), amount: '7.00' });
    await opt.startConsumer({ concurrency: 8 });
    await Promise.all(Array.from({ length: 5 }, () => opt.enqueueCopy(env)));
    await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM app.delivery')) >= 5, 30_000);
    expect(await scalar(pool, 'SELECT count(*) FROM app.delivery WHERE NOT duplicate')).toBe(1);
    expect(await scalar(pool, 'SELECT count(*) FROM app.delivery WHERE duplicate')).toBe(4);
    expect(await scalar(pool, 'SELECT total FROM app.balance')).toBe(7);
  });

  it('reintentos con backoff y DLQ: evento venenoso termina en dead_letter sin bloquear al resto', async () => {
    await setup({ attempts: 3, backoffMs: id === 'C' ? 1000 : 100 });
    const acc = uuidv4();
    const poison = await recordTransaction(pool, { accountId: uuidv4(), amount: '1.00', poison: true });
    for (let i = 0; i < 20; i++) await recordTransaction(pool, { accountId: acc, amount: '1.00' });
    relay = new Relay(pool, opt.publisher);
    await opt.startConsumer({ concurrency: 4 });
    await relay.start();
    const t = await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM platform.dead_letter')) === 1, 60_000);
    await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM app.applied')) === 20, 30_000);
    const tries = await scalar(pool, 'SELECT count(*) FROM app.delivery WHERE event_id=$1', [poison.eventId]);
    expect(tries).toBe(0); // la fila de delivery se revierte con la tx fallida: los intentos no dejan efectos
    expect(await scalar(pool, 'SELECT count(*) FROM platform.inbox WHERE event_id=$1', [poison.eventId])).toBe(0);
    const counts = await opt.counts();
    saveResult(`semantics-${id}`, { dlq: { attempts: 3, msToDeadLetter: t, queueCounts: counts } });
  });

  it('orden por agregado: medición sin y con garantías', async () => {
    const ACC = 20, PER = 25, N = ACC * PER;
    const accounts = Array.from({ length: ACC }, () => uuidv4());
    async function run(mode: 'none' | 'strict') {
      await setup({ attempts: 30, backoffMs: id === 'C' ? 1000 : 20, strictFifo: id === 'C' && mode === 'strict' });
      // primero escribir todo (backlog), luego drenar con concurrencia 8 => peor caso de reordenamiento
      for (let v = 0; v < PER; v++) await Promise.all(accounts.map((a) => recordTransaction(pool, { accountId: a, amount: '1.00' })));
      relay = new Relay(pool, opt.publisher, { batchSize: 500 });
      await relay.start();
      await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM platform.outbox WHERE published_at IS NULL')) === 0);
      const t0 = Date.now();
      await opt.startConsumer({ concurrency: 8, jitterMs: 10, strictOrder: mode === 'strict' && id !== 'C' });
      await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM app.applied')) === N, 120_000, 50);
      const ms = Date.now() - t0;
      const inv = await orderInversions(pool);
      await relay.stop(); relay = undefined;
      await opt.close();
      return { inversions: inv, drainMs: ms };
    }
    const none = await run('none');
    const strict = await run('strict');
    expect(strict.inversions).toBe(0);
    saveResult(`semantics-${id}`, {
      ordering: { events: N, aggregates: ACC, concurrency: 8, handlerJitterMs: 10, withoutGuarantee: none,
        withGuarantee: { ...strict, mechanism: id === 'C' ? 'policy key_strict_fifo (singletonKey=aggregateId)' : 'detección de huecos aggregateVersion + reintento' } },
    });
  });

  it('graceful shutdown con un job en curso: el job termina y su efecto queda commiteado', async () => {
    await setup();
    let started = false;
    await opt.startConsumer({ concurrency: 1, workMs: 1500, onStart: () => { started = true; } });
    relay = new Relay(pool, opt.publisher);
    await relay.start();
    const env = await recordTransaction(pool, { accountId: uuidv4(), amount: '3.00' });
    await waitFor(async () => started, 20_000, 20);
    const t0 = Date.now();
    await opt.stopConsumer(); // mismo camino que el handler de SIGTERM
    const stopMs = Date.now() - t0;
    expect(await scalar(pool, 'SELECT count(*) FROM platform.inbox WHERE event_id=$1', [env.eventId])).toBe(1);
    expect(await scalar(pool, 'SELECT total FROM app.balance')).toBe(3);
    const counts = await opt.counts();
    expect(counts.active).toBe(0);
    saveResult(`semantics-${id}`, { gracefulInProcess: { stopWaitedMs: stopMs, countsAfterStop: counts } });
  });
});
