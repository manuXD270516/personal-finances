import 'reflect-metadata';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connect } from '../support/db.js';
import { DemoWorld, eventually, type DemoLoad } from '../support/demo-world.js';
import { capturingLogger } from '../support/harness.js';

// Contexto de usuario ausente en el worker (openspec fix-worker-user-context). El dataset Demo v2 trae tarjetas en USD
// con la moneda base BOB: valorarlas llama a FX, que resolvía la moneda base de IDENTITY por la ruta de la petición
// (membresía del usuario). El consumidor `debt.card-activity` y el job `debt.card-daily` corren sin usuario y fallaban
// con PF002 «user context not set»; con la ruta de directorio del worker ya no.
const deps = inject('deps');
const ANCHOR = '2026-09-30';

const world = new DemoWorld();
const workerLogs = capturingLogger('finance-worker', 'worker');
let migrator: Client;
let load: DemoLoad;

beforeAll(async () => {
  migrator = await connect(deps.migratorUrl);
  await world.start({ workerLogger: workerLogs.logger });
  load = await world.load({ anchor: ANCHOR });
  expect(load.outcome, load.failure ?? '').toBe('READY');
  await world.waitPublished(load.job.demoWorkspaceId);
}, 900_000);

afterAll(async () => {
  await world.cleanupAll();
  await world.stop();
  await migrator?.end();
}, 600_000);

describe('worker sin usuario sobre el dataset Demo v2', () => {
  it('[TC-SECURITY-RLS-019] el consumidor debt.card-activity procesa los eventos de la carga demo sin PF002', async () => {
    const failed = await eventually(
      async () => {
        const { rows } = await migrator.query<{ n: number; pending: number }>(
          `SELECT count(*) FILTER (WHERE output::text LIKE '%PF002%')::int AS n,
                  count(*) FILTER (WHERE state IN ('created', 'retry', 'active'))::int AS pending
             FROM pgboss.job WHERE name = 'events.debt.card-activity'`,
        );
        const row = rows[0]!;
        return row.n > 0 || row.pending === 0 ? row.n : undefined;
      },
      { what: 'que el consumidor debt.card-activity drene su cola' },
    );
    expect(failed).toBe(0);
  }, 300_000);

  it('[TC-SECURITY-RLS-019] el job debt.card-daily recorre las tarjetas del workspace demo sin fallos', async () => {
    const before = workerLogs.records().filter((r) => r['msg'] === 'cards processed').length;
    await world.worker.queue.send('debt.card-daily', { trigger: 'manual' });
    const record = await eventually(
      async () => workerLogs.records().filter((r) => r['msg'] === 'cards processed')[before],
      { what: 'la ejecución manual de debt.card-daily' },
    );
    expect(record['failed']).toBe(0);
    const errors = workerLogs
      .records()
      .filter((r) => JSON.stringify(r).includes('PF002') && String(r['msg']).includes('card'));
    expect(errors).toEqual([]);
  }, 300_000);
});
