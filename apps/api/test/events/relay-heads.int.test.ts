import { randomUUID } from 'node:crypto';
import { EventSubscriptions, OUTBOX_RELAY_HEADS_SQL, OutboxRelay } from '@pf/platform/events';
import { PgBossJobQueue } from '@pf/platform/queue';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { capturingLogger } from '../support/harness.js';

// Selección de cabezas del relay (openspec fix-outbox-relay-head-query, platform/event-delivery): equivalencia con la
// consulta anterior, cabeza bloqueada y plan con estadísticas desactualizadas. PostgreSQL real; los datos son
// sintéticos y se insertan como superusuario (el test de plan lo hace dentro de una transacción revertida).
const deps = inject('deps');
const quiet = capturingLogger('finance-worker', 'worker', 'warn').logger;

/** Consulta anterior del relay (NOT EXISTS), literal, como referencia de equivalencia. */
const LEGACY_HEADS_SQL = `SELECT o.id
  FROM platform.outbox o
 WHERE o.published_at IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM platform.outbox p
          WHERE p.published_at IS NULL
            AND p.workspace_id = o.workspace_id
            AND p.aggregate_id = o.aggregate_id
            AND p.sequence < o.sequence)
 ORDER BY o.sequence
 LIMIT $1
 FOR UPDATE OF o SKIP LOCKED`;

let workerPool: Pool;
let adminPool: Pool;
let queue: PgBossJobQueue;
let relay: OutboxRelay;

interface SyntheticEvent {
  id: string;
  workspaceId: string;
  aggregateId: string;
  version: number;
}

/** Inserta los eventos EN ESTE ORDEN (el orden de `sequence` es el de inserción). */
async function insertEvents(events: readonly SyntheticEvent[]): Promise<void> {
  for (const e of events) {
    await adminPool.query(
      `INSERT INTO platform.outbox (id, workspace_id, event_type, event_version, aggregate_type, aggregate_id,
                                    aggregate_version, occurred_at, correlation_id, envelope)
       VALUES ($1, $2, 'tc.Synthetic', 1, 'Synthetic', $3, $4, now(), $5, '{}'::jsonb)`,
      [e.id, e.workspaceId, e.aggregateId, e.version, randomUUID()],
    );
  }
}

interface PendingRef {
  id: string;
  workspace_id: string;
  aggregate_id: string;
}

/** Cabezas de referencia calculadas en el test: mínimo `sequence` por (workspace, agregado), orden por `sequence`. */
async function referenceHeads(limit: number): Promise<string[]> {
  const { rows } = await adminPool.query<PendingRef>(
    `SELECT id, workspace_id, aggregate_id FROM platform.outbox WHERE published_at IS NULL ORDER BY sequence`,
  );
  const seen = new Set<string>();
  const heads: string[] = [];
  for (const r of rows) {
    const key = `${r.workspace_id}/${r.aggregate_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    heads.push(r.id);
  }
  return heads.slice(0, limit);
}

async function pendingCount(ids: readonly string[]): Promise<number> {
  const { rows } = await adminPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform.outbox WHERE published_at IS NULL AND id = ANY($1::uuid[])`,
    [ids],
  );
  return rows[0]?.n ?? 0;
}

async function allPending(): Promise<number> {
  const { rows } = await adminPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM platform.outbox WHERE published_at IS NULL`,
  );
  return rows[0]?.n ?? 0;
}

async function publishedIds(ids: readonly string[]): Promise<Set<string>> {
  const { rows } = await adminPool.query<{ id: string }>(
    `SELECT id FROM platform.outbox WHERE published_at IS NOT NULL AND id = ANY($1::uuid[])`,
    [ids],
  );
  return new Set(rows.map((r) => r.id));
}

beforeAll(async () => {
  workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
  adminPool = new Pool({ connectionString: deps.superuserUrl, max: 2 });
  // Pendientes que dejaron otros archivos de la misma base: sin relay en marcha, se descartan para que los lotes de
  // estos tests (de 3 y de 1 000 eventos) solo vean los datos sintéticos propios.
  await adminPool.query('UPDATE platform.outbox SET published_at = now() WHERE published_at IS NULL');
  queue = new PgBossJobQueue({
    connectionString: deps.workerDatabaseUrl,
    logger: quiet,
    pollingIntervalSeconds: 0.5,
    role: 'consumer',
  });
  await queue.start();
  relay = new OutboxRelay({
    pool: workerPool,
    queue,
    routes: new EventSubscriptions([]),
    logger: quiet,
    batchSize: 3,
    pollIntervalMs: 200,
  });
});

afterAll(async () => {
  await queue?.drain();
  await queue?.stop();
  await Promise.all([workerPool?.end(), adminPool?.end()]);
});

type PlanNode = Record<string, unknown>;

function planNodes(node: PlanNode, out: PlanNode[] = []): PlanNode[] {
  out.push(node);
  for (const child of (node['Plans'] as PlanNode[] | undefined) ?? []) planNodes(child, out);
  return out;
}

describe('platform/event-delivery: selección de cabezas del relay', () => {
  it('[TC-PLATFORM-EVENTS-020] el relay selecciona por lote las mismas cabezas pendientes que antes, una por agregado y workspace', async () => {
    const ws1 = randomUUID();
    const ws2 = randomUUID();
    const shared = randomUUID();
    // 4 agregados por workspace (uno compartido entre los dos) con 1 a 4 eventos, intercalados por rondas.
    const plan = new Map<string, number>();
    for (const ws of [ws1, ws2]) {
      [shared, randomUUID(), randomUUID(), randomUUID()].forEach((a, i) => plan.set(`${ws}/${a}`, i + 1));
    }
    const events: SyntheticEvent[] = [];
    const versions = new Map<string, number>();
    for (let round = 1; round <= 4; round++) {
      for (const [key, n] of plan) {
        if (round > n) continue;
        const [workspaceId, aggregateId] = key.split('/') as [string, string];
        const version = (versions.get(key) ?? 0) + 1 + (workspaceId === ws2 ? 10 : 0);
        versions.set(key, version - (workspaceId === ws2 ? 10 : 0));
        events.push({ id: randomUUID(), workspaceId, aggregateId, version });
      }
    }
    await insertEvents(events);
    const mine = events.map((e) => e.id);
    expect(mine.length).toBe(2 * (1 + 2 + 3 + 4));

    const lot = new Map<string, number>();
    let batches = 0;
    while ((await pendingCount(mine)) > 0) {
      expect(batches).toBeLessThan(100);
      const expected = await referenceHeads(3);
      // La consulta anterior (literal) y la exportada devuelven la misma selección que la referencia del test.
      for (const sql of [LEGACY_HEADS_SQL, OUTBOX_RELAY_HEADS_SQL]) {
        const client = await workerPool.connect();
        try {
          await client.query('BEGIN');
          const { rows } = await client.query<{ id: string }>(sql, [3]);
          await client.query('ROLLBACK');
          expect(rows.map((r) => r.id)).toEqual(expected);
        } finally {
          client.release();
        }
      }
      const before = await allPending();
      const n = await relay.runOnce();
      expect(n).toBe(expected.length);
      expect(before - (await allPending())).toBe(n);
      expect((await publishedIds(expected)).size).toBe(expected.length);
      for (const id of expected) lot.set(id, batches);
      batches += 1;
    }
    // Ningún sucesor salió junto a su cabeza y cada agregado publicó todo en orden de confirmación.
    const byKey = new Map<string, number[]>();
    for (const e of events) {
      const key = `${e.workspaceId}/${e.aggregateId}`;
      byKey.set(key, [...(byKey.get(key) ?? []), lot.get(e.id) ?? -1]);
    }
    for (const lots of byKey.values()) {
      expect(lots.every((l) => l >= 0)).toBe(true);
      expect(new Set(lots).size).toBe(lots.length);
      expect([...lots].sort((x, y) => x - y)).toEqual(lots);
    }
    // El agregado compartido es una cabeza por workspace: un evento por workspace en su primer lote.
    expect(byKey.get(`${ws1}/${shared}`)?.length).toBe(1);
    expect(byKey.get(`${ws2}/${shared}`)?.length).toBe(1);
  }, 60_000);

  it('[TC-PLATFORM-EVENTS-021] una cabeza bloqueada por otra transacción retiene a sus sucesores y no frena a los demás agregados', async () => {
    const ws = randomUUID();
    const a1 = { id: randomUUID(), workspaceId: ws, aggregateId: randomUUID(), version: 1 };
    const a2 = { id: randomUUID(), workspaceId: ws, aggregateId: a1.aggregateId, version: 2 };
    const b1 = { id: randomUUID(), workspaceId: ws, aggregateId: randomUUID(), version: 1 };
    const c1 = { id: randomUUID(), workspaceId: ws, aggregateId: randomUUID(), version: 1 };
    await insertEvents([a1, a2, b1, c1]);
    const mine = [a1.id, a2.id, b1.id, c1.id];

    const relayBig = new OutboxRelay({
      pool: workerPool,
      queue,
      routes: new EventSubscriptions([]),
      logger: quiet,
      batchSize: 1000,
    });
    const locker: PoolClient = await workerPool.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM platform.outbox WHERE id = $1 FOR UPDATE', [a1.id]);
      await relayBig.runOnce();
      expect(await publishedIds(mine)).toEqual(new Set([b1.id, c1.id]));
      await locker.query('ROLLBACK');
    } finally {
      locker.release();
    }
    await relayBig.runOnce();
    expect(await publishedIds(mine)).toEqual(new Set([b1.id, c1.id, a1.id]));
    await relayBig.runOnce();
    expect(await publishedIds(mine)).toEqual(new Set(mine));
  }, 60_000);

  it('[TC-PLATFORM-EVENTS-022] con estadísticas desactualizadas la consulta de cabezas del relay no usa un anti join ni una subconsulta por fila (costo acotado)', async () => {
    const ws = randomUUID();
    const client = await adminPool.connect();
    const sql = OUTBOX_RELAY_HEADS_SQL.replace('$1', '200');
    try {
      await client.query('BEGIN');
      // 1. Historia publicada y ANALYZE: estadísticas con casi ningún pendiente.
      await client.query(
        `INSERT INTO platform.outbox (id, workspace_id, event_type, event_version, aggregate_type, aggregate_id,
                                      aggregate_version, occurred_at, correlation_id, envelope, published_at)
         SELECT gen_random_uuid(), $1::uuid, 'tc.Synthetic', 1, 'Synthetic', gen_random_uuid(), 1, now(),
                gen_random_uuid(), '{}'::jsonb, now()
           FROM generate_series(1, 5000)`,
        [ws],
      );
      await client.query('ANALYZE platform.outbox');
      // 2. 10 000 pendientes de 2 000 agregados, 5 consecutivos por agregado; 2 000 publicados (entradas muertas).
      await client.query(
        `INSERT INTO platform.outbox (id, workspace_id, event_type, event_version, aggregate_type, aggregate_id,
                                      aggregate_version, occurred_at, correlation_id, envelope)
         SELECT gen_random_uuid(), $1::uuid, 'tc.Synthetic', 1, 'Synthetic', md5($1::uuid::text || (i / 5)::text)::uuid,
                (i % 5) + 1, now(), gen_random_uuid(), '{}'::jsonb
           FROM generate_series(0, 9999) AS i`,
        [ws],
      );
      await client.query(
        `UPDATE platform.outbox SET published_at = now()
          WHERE id IN (SELECT id FROM platform.outbox WHERE workspace_id = $1 AND published_at IS NULL
                        ORDER BY sequence LIMIT 2000)`,
        [ws],
      );
      await client.query('SET LOCAL ROLE pf_worker');

      // 3. Plan: sin anti join, sin Join Filter de agregado ni SubPlan por fila; las cabezas se calculan una vez
      // (InitPlan con Unique) y el recorrido externo solo las filtra.
      const explain = await client.query<{ 'QUERY PLAN': PlanNode[] }>(`EXPLAIN (FORMAT JSON) ${sql}`);
      const root = explain.rows[0]?.['QUERY PLAN'][0]?.['Plan'] as PlanNode;
      const nodes = planNodes(root);
      const detail = JSON.stringify(root);
      expect(
        nodes.some((n) => n['Join Type'] === 'Anti'),
        detail,
      ).toBe(false);
      expect(
        nodes.some((n) => /workspace_id|aggregate_id/.test(String(n['Join Filter'] ?? ''))),
        detail,
      ).toBe(false);
      expect(
        nodes.some((n) => n['Parent Relationship'] === 'SubPlan'),
        detail,
      ).toBe(false);
      const init = nodes.find((n) => n['Parent Relationship'] === 'InitPlan');
      expect(init, detail).toBeDefined();
      expect(
        planNodes(init as PlanNode).some((n) => n['Node Type'] === 'Unique'),
        detail,
      ).toBe(true);

      // 4. Ejecución: 200 filas, todas cabezas, dentro del tope.
      const analyze = await client.query<{ 'QUERY PLAN': PlanNode[] }>(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
      );
      expect(Number(analyze.rows[0]?.['QUERY PLAN'][0]?.['Execution Time'])).toBeLessThanOrEqual(5000);
      const rows = await client.query<{ id: string }>(sql.replace('FOR UPDATE OF o SKIP LOCKED', ''));
      expect(rows.rows.length).toBe(200);
      const heads = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM platform.outbox o
          WHERE o.id = ANY($1::uuid[]) AND NOT EXISTS (
                SELECT 1 FROM platform.outbox p WHERE p.published_at IS NULL AND p.workspace_id = o.workspace_id
                   AND p.aggregate_id = o.aggregate_id AND p.sequence < o.sequence)`,
        [rows.rows.map((r) => r.id)],
      );
      expect(heads.rows[0]?.n).toBe(200);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }, 120_000);
});
