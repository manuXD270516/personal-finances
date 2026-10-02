// Señales reales. (1) Windows: SIGTERM no ejecuta handlers. (2) Worker en contenedor Linux: SIGTERM y SIGKILL a mitad de job.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { makePool, migrate, resetData } from '../src/db.js';
import { recordTransaction } from '../src/api.js';
import { Relay } from '../src/relay.js';
import { makeOption, type OptionId, type QueueOption } from '../src/options.js';
import { compose, saveResult, scalar, waitFor } from './helpers.js';

describe('señales en el host', () => {
  it(`child.kill('SIGTERM') en ${process.platform}: ¿se ejecuta el handler?`, async () => {
    const child = spawn(process.execPath, ['-e',
      "process.on('SIGTERM',()=>{console.log('HANDLED');process.exit(0)});console.log('READY');setInterval(()=>{},1000)"]);
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    await waitFor(async () => out.includes('READY'), 10_000, 20);
    const exit = new Promise<{ code: number | null; signal: string | null }>((r) => child.on('exit', (code, signal) => r({ code, signal })));
    child.kill('SIGTERM');
    const res = await exit;
    const handled = out.includes('HANDLED');
    saveResult('signals', { host: { platform: process.platform, sigtermHandlerRan: handled, exit: res } });
    if (process.platform === 'win32') expect(handled).toBe(false); // TerminateProcess: muerte abrupta
    else expect(handled).toBe(true);
  });
});

const JOB_MS = 4000;
const pool = makePool(10);
const logs = () => compose('--profile worker logs --no-log-prefix worker');
const exitCode = () => execSync('docker inspect pf-spike-05-worker-1 --format "{{.State.ExitCode}}"', { encoding: 'utf8' }).trim();

describe.each(['A', 'B', 'C'] as OptionId[])('worker en contenedor Linux, opción %s', (id) => {
  let opt: QueueOption;
  let relay: Relay;
  beforeAll(async () => {
    await migrate(pool);
    compose('--profile worker build worker');
  });
  afterAll(async () => {
    await relay?.stop();
    await opt?.close();
    try { compose('--profile worker rm -sf worker'); } catch { /* ignore */ }
  });

  async function startWorker() {
    compose('--profile worker up -d --force-recreate worker', { OPTION: id, JOB_MS: String(JOB_MS) });
    await waitFor(async () => logs().includes('READY'), 60_000, 250);
  }

  it('SIGTERM a mitad de job => termina el job, commitea y sale limpio; SIGKILL => rollback y re-entrega única', async () => {
    await resetData(pool);
    opt = makeOption(id, pool);
    await opt.init({ attempts: 5, backoffMs: 1000 });
    relay = new Relay(pool, opt.publisher);
    await relay.start();

    // --- SIGTERM ---
    await startWorker();
    const e1 = await recordTransaction(pool, { accountId: uuidv4(), amount: '5.00' });
    await waitFor(async () => logs().includes(`START ${e1.eventId}`), 30_000, 100);
    const t0 = Date.now();
    compose('--profile worker stop -t 30 worker'); // docker envía SIGTERM y espera
    const stopMs = Date.now() - t0;
    const l1 = logs();
    expect(l1).toContain('SIGNAL SIGTERM');
    expect(l1).toContain(`DONE applied ${e1.eventId}`);
    expect(l1).toContain('CLEAN_EXIT');
    expect(exitCode()).toBe('0');
    expect(await scalar(pool, 'SELECT count(*) FROM platform.inbox WHERE event_id=$1', [e1.eventId])).toBe(1);
    const countsAfterTerm = await opt.counts();
    expect(countsAfterTerm.active).toBe(0);

    // --- SIGKILL (crash) ---
    await startWorker();
    const e2 = await recordTransaction(pool, { accountId: uuidv4(), amount: '5.00' });
    await waitFor(async () => logs().includes(`START ${e2.eventId}`), 30_000, 100);
    compose('--profile worker kill -s SIGKILL worker');
    const killedAt = Date.now();
    // efecto NO commiteado (la tx se revierte al cortarse la conexión)
    await new Promise((r) => setTimeout(r, 500));
    expect(await scalar(pool, 'SELECT count(*) FROM platform.inbox WHERE event_id=$1', [e2.eventId])).toBe(0);
    const countsAfterKill = await opt.counts();
    await startWorker(); // nuevo worker: el job "huérfano" debe re-entregarse (stalled / expirado)
    await waitFor(async () => (await scalar(pool, 'SELECT count(*) FROM platform.inbox WHERE event_id=$1', [e2.eventId])) === 1, 180_000, 250);
    const redeliveryMs = Date.now() - killedAt;
    expect(await scalar(pool, 'SELECT count(*) FROM app.applied WHERE event_id=$1', [e2.eventId])).toBe(1);
    compose('--profile worker stop -t 30 worker');

    saveResult('signals', {
      [`container-${id}`]: {
        sigterm: { jobMs: JOB_MS, dockerStopMs: stopMs, exitCode: 0, effectCommitted: true, countsAfter: countsAfterTerm },
        sigkill: { effectRolledBack: true, countsRightAfterKill: countsAfterKill, redeliveryMsFromKill: redeliveryMs, appliedTimes: 1 },
      },
    });
  });
});

afterAll(async () => { await pool.end(); });
