import 'reflect-metadata';
import type { Client } from 'pg';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import golden from '../../src/demo/dataset/golden-summary.json' with { type: 'json' };
import { connect } from '../support/db.js';
import { rowsByTable, unbalancedEntries } from '../support/demo-db.js';
import { DemoWorld, eventually, type DemoLoad } from '../support/demo-world.js';
import { discardStaleEventBacklog } from '../support/harness.js';

// Independencia de la fecha real en la demo (openspec fix-demo-golden-clock-dependence, TC-IDENTITY-DEMO-021..024).
// El worker de este archivo no ejecuta tareas programadas (`scheduledJobs: false`) y usa un reloj fijo y modificable.
// Incidente de origen: nightly 39411997796 (2026-10-20), TC-IDENTITY-DEMO-007 con un "Retiro de efectivo" de más.
const deps = inject('deps');
const ANCHOR = '2026-09-30';
const JOB = 'commitments.generate-occurrences';
/** Reloj del worker durante la carga: ancla + 395 días (todo vencimiento posterior a la ancla ya habría pasado). */
const FAR_FUTURE = Instant.parse('2027-10-30T16:00:00.000Z');

const GOLDEN_BY_NAME: Record<string, string> = {
  'Banco Andino Demo — Cuenta corriente': golden.balances.bank_bob,
  'Banco Andino Demo — Ahorro USD': golden.balances.bank_usd,
  Efectivo: golden.balances.cash,
  'P2P Exchange Demo — Billetera USDT': golden.balances.usdt,
  'Cold Wallet BTC': golden.balances.btc,
  'Tarjeta Andina Demo': golden.balances.card,
  'Banco Andino Demo — Caja de ahorro BOB': golden.balances.savings_bob,
  'Tarjeta Kantuta Demo BOB': golden.balances.kantuta_bob,
  'Tarjeta Kantuta Demo USD': golden.balances.kantuta_usd,
  'Billetera Altiplano Demo': golden.balances.wallet,
  'Préstamo vehicular': golden.balances.loan_vehicular,
  'Préstamo de consumo': golden.balances.loan_consumo,
  'Préstamo familiar': golden.balances.loan_familiar,
  'Crédito educativo': golden.balances.loan_educativo,
};
/** Saldos tras el único "Retiro de efectivo" de 600.00 BOB del 2026-10-02 (las otras 12 cuentas no cambian). */
const WITH_WITHDRAWAL: Record<string, string> = {
  ...GOLDEN_BY_NAME,
  'Banco Andino Demo — Cuenta corriente': '116919.90',
  Efectivo: '9673.69',
};

const clock = new FixedClock(FAR_FUTURE);
const world = new DemoWorld();
let migrator: Client;
let startedAt: string;
let main: DemoLoad;

async function balancesOf(
  load: Pick<DemoLoad, 'user'> & { readonly job: { readonly demoWorkspaceId: string } },
): Promise<Record<string, string>> {
  return balancesIn(load.job.demoWorkspaceId, load.user.token);
}

async function balancesIn(workspaceId: string, token: string): Promise<Record<string, string>> {
  const r = await world.call('GET', `/api/v1/workspaces/${workspaceId}/accounts?limit=50`, token);
  expect(r.status).toBe(200);
  const data = r.body['data'] as { name: string; balance: { amount: string } }[];
  return Object.fromEntries(data.map((a) => [a.name, a.balance.amount]));
}

/** "Retiro de efectivo" con fecha posterior a la ancla. */
async function withdrawalsAfterAnchor(load: DemoLoad) {
  const r = await world.call(
    'GET',
    `/api/v1/workspaces/${load.job.demoWorkspaceId}/transactions?limit=100&dateFrom=2026-10-01`,
    load.user.token,
  );
  expect(r.status).toBe(200);
  return (
    r.body['data'] as { kind: string; description: string | null; transactionDate: string; amount: unknown }[]
  ).filter((t) => t.description === 'Retiro de efectivo');
}

/** Envía el job a mano y espera a que termine (el worker no tiene cron). */
async function runJob(queue: string): Promise<void> {
  const id = await world.worker.queue.send(queue, { trigger: 'manual' });
  await eventually(
    async () => {
      const { rows } = await migrator.query<{ state: string }>(
        `SELECT state FROM pgboss.job WHERE name = $1 AND id = $2`,
        [queue, id],
      );
      const state = rows[0]?.state;
      if (state === 'failed' || state === 'cancelled') throw new Error(`el job ${queue} terminó ${state}`);
      return state === 'completed' ? true : undefined;
    },
    { timeoutMs: 120_000, what: `el job ${queue}` },
  );
}

/** Conteos del workspace una vez que terminaron las reacciones asíncronas de la carga (outbox publicado y estables). */
async function settle(workspaceId: string, timeoutMs = 120_000): Promise<void> {
  await world.waitPublished(workspaceId);
  const deadline = Date.now() + timeoutMs;
  let previous = JSON.stringify(await rowsByTable(migrator, workspaceId));
  for (;;) {
    await new Promise((r) => setTimeout(r, 1_500));
    const current = JSON.stringify(await rowsByTable(migrator, workspaceId));
    if (current === previous) return;
    if (Date.now() > deadline) throw new Error('settle: los conteos del workspace no se estabilizaron');
    previous = current;
  }
}

beforeAll(async () => {
  migrator = await connect(deps.migratorUrl);
  // Trabajos pendientes de archivos anteriores: no deben ejecutarse con el reloj de 2027.
  await discardStaleEventBacklog(deps);
  startedAt = (await migrator.query<{ now: string }>(`SELECT now()::text AS now`)).rows[0]!.now;
  await world.start({ workerClock: clock });
  main = await world.load({ anchor: ANCHOR });
  expect(main.outcome, main.failure ?? '').toBe('READY');
  await settle(main.job.demoWorkspaceId);
}, 600_000);

afterAll(async () => {
  await world.cleanupAll();
  await world.stop();
  await migrator?.end();
}, 600_000);

describe('la demo no depende de la fecha real (identity/demo-data)', () => {
  it('[TC-IDENTITY-DEMO-021] con el reloj del worker en 2027-10-30 la carga conserva los 14 saldos del resumen de referencia y asientos balanceados', async () => {
    expect(await balancesOf(main)).toEqual(GOLDEN_BY_NAME);
    expect(await unbalancedEntries(migrator, main.job.demoWorkspaceId)).toEqual([]);
    expect(await withdrawalsAfterAnchor(main)).toEqual([]);
  }, 120_000);

  it('[TC-IDENTITY-DEMO-022] ninguna cola programada de pg-boss tiene trabajos creados desde el arranque del worker', async () => {
    const { rows: schedules } = await migrator.query<{ name: string }>(
      `SELECT DISTINCT name FROM pgboss.schedule ORDER BY 1`,
    );
    const names = schedules.map((s) => s.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain(JOB);
    // Se deriva de la tabla de schedules (no de una lista fija): cubre también los crons que se agreguen.
    const { rows: created } = await migrator.query<{ name: string; n: number }>(
      `SELECT j.name, count(*)::int AS n FROM pgboss.job j
        WHERE j.name = ANY($1::text[]) AND j.created_on >= $2::timestamptz
        GROUP BY j.name ORDER BY 1`,
      [names, startedAt],
    );
    expect(created).toEqual([]);
  }, 60_000);

  it('[TC-IDENTITY-DEMO-024] el motor de recurrencia crea un solo Retiro de efectivo de 600.00 BOB el 2026-10-02 y repetirlo no cambia nada', async () => {
    // El día de la ancla no hay nada que materializar.
    clock.set(Instant.parse(`${ANCHOR}T16:00:00.000Z`));
    await runJob(JOB);
    await settle(main.job.demoWorkspaceId);
    expect(await balancesOf(main)).toEqual(GOLDEN_BY_NAME);
    expect(await withdrawalsAfterAnchor(main)).toEqual([]);

    // 12:00 en America/La_Paz del día 2: vence la ocurrencia automática.
    clock.set(Instant.parse('2026-10-02T16:00:00.000Z'));
    await runJob(JOB);
    await settle(main.job.demoWorkspaceId);
    expect(await balancesOf(main)).toEqual(WITH_WITHDRAWAL);
    const created = await withdrawalsAfterAnchor(main);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: 'TRANSFER', transactionDate: '2026-10-02' });
    expect(created[0]!.amount).toMatchObject({ amount: '600.00', currency: 'BOB' });
    expect(await unbalancedEntries(migrator, main.job.demoWorkspaceId)).toEqual([]);

    // Repetir el mismo día no duplica nada.
    await runJob(JOB);
    await settle(main.job.demoWorkspaceId);
    expect(await balancesOf(main)).toEqual(WITH_WITHDRAWAL);
    expect(await withdrawalsAfterAnchor(main)).toHaveLength(1);
  }, 300_000);

  it('[TC-IDENTITY-DEMO-023] una tarea programada que actúa justo después de confirmar el plan no hace fallar la carga', async () => {
    const user = await world.user('demo-clock');
    const load = await world.load({
      anchor: ANCHOR,
      user,
      afterPlanCommitted: async (workspaceId) => {
        clock.set(Instant.parse('2026-10-02T16:00:00.000Z'));
        await runJob(JOB);
        // Se espera a que el retiro ya figure en los saldos del API: la ventana entre confirmar y terminar la carga
        // queda con el workspace ya modificado por la tarea programada.
        await world.waitPublished(workspaceId);
        await eventually(
          async () =>
            (await balancesIn(workspaceId, user.token))['Efectivo'] === WITH_WITHDRAWAL['Efectivo']
              ? true
              : undefined,
          { timeoutMs: 120_000, what: 'el retiro en los saldos' },
        );
      },
    });
    // La verificación de saldos ocurre antes de confirmar: el retiro posterior no la afecta.
    expect(load.outcome, load.failure ?? '').toBe('READY');
    await settle(load.job.demoWorkspaceId);
    // Prueba de que el gancho sí actuó sobre este workspace.
    expect(await withdrawalsAfterAnchor(load)).toHaveLength(1);
    expect(await balancesOf(load)).toEqual(WITH_WITHDRAWAL);
  }, 600_000);
});
