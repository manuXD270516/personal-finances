import { randomUUID } from 'node:crypto';
import {
  PgCommandTransaction,
  PgIdempotencyStore,
  applyRlsContext,
  idempotencyRequestHash,
  purgeExpiredIdempotencyKeys,
  type ReserveRequest,
} from '@pf/platform/api';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const deps = inject('deps');
const H = 3_600_000;

async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe('platform.idempotency_key: RLS, grants y PgIdempotencyStore (tareas 4.1 y 4.2)', () => {
  let pool: Pool;
  let migrator: Client;
  let store: PgIdempotencyStore;
  const user = randomUUID();
  const w1 = randomUUID();
  const w2 = randomUUID();

  const request = (over: Partial<ReserveRequest> = {}): ReserveRequest => ({
    scope: { workspaceId: w1, userId: user },
    key: `K-int-${randomUUID()}`,
    method: 'POST',
    route: '/workspaces/{workspaceId}/transactions',
    requestHash: idempotencyRequestHash('POST', '/workspaces/{workspaceId}/transactions', { a: 1 }),
    now: new Date(),
    lockTtlMs: 30_000,
    retentionMs: 24 * H,
    ...over,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: deps.databaseUrl, max: 6 });
    migrator = new Client({ connectionString: deps.migratorUrl });
    await migrator.connect();
    store = new PgIdempotencyStore(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await migrator?.end();
  });

  /** Claves visibles para pf_app en el contexto de W1 (el owner tampoco ve filas: RLS FORZADA sin política). */
  async function visibleKeys(keys: string[]): Promise<string[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await applyRlsContext(client, { workspaceId: w1, userId: user });
      const { rows } = await client.query<{ key: string }>(
        'SELECT key FROM platform.idempotency_key WHERE key = ANY($1)',
        [keys],
      );
      await client.query('COMMIT');
      return rows.map((r) => r.key);
    } finally {
      client.release();
    }
  }

  it('el propietario (pf_migrator) tampoco lee filas: RLS forzada', async () => {
    expect((await store.reserve(request())).outcome).toBe('reserved');
    expect((await migrator.query('SELECT 1 FROM platform.idempotency_key')).rowCount).toBe(0);
  });

  it('RLS habilitada y forzada, con políticas para pf_app y pf_maintenance y sin acceso de PUBLIC', async () => {
    const { rows } = await migrator.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'platform.idempotency_key'::regclass`,
    );
    expect(rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await migrator.query<{ policyname: string; roles: string[]; cmd: string }>(
      `SELECT policyname, roles::text[] AS roles, cmd FROM pg_policies
        WHERE schemaname = 'platform' AND tablename = 'idempotency_key' ORDER BY policyname`,
    );
    expect(policies.rows).toEqual([
      { policyname: 'idempotency_key_retention_purge', roles: ['pf_maintenance'], cmd: 'DELETE' },
      { policyname: 'idempotency_key_retention_read', roles: ['pf_maintenance'], cmd: 'SELECT' },
      { policyname: 'idempotency_key_scope', roles: ['pf_app'], cmd: 'ALL' },
    ]);
    const maint = await migrator.query(
      `SELECT rolcanlogin, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = 'pf_maintenance'`,
    );
    expect(maint.rows).toEqual([{ rolcanlogin: false, rolbypassrls: false, rolinherit: false }]);
  });

  it('sin contexto RLS la consulta falla con PF002 (nunca 0 filas silenciosas)', async () => {
    expect((await store.reserve(request())).outcome).toBe('reserved');
    const client = await pool.connect();
    try {
      expect(await sqlState(() => client.query('SELECT * FROM platform.idempotency_key'))).toBe('PF002');
    } finally {
      client.release();
    }
  });

  it('[TC-PLATFORM-API-009] dos reservas simultáneas de la misma clave: una reserva y la otra ve IN_PROGRESS', async () => {
    const req = request();
    const results = await Promise.all([store.reserve(req), store.reserve(req), store.reserve(req)]);
    expect(results.filter((r) => r.outcome === 'reserved')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'in-progress')).toHaveLength(2);
  });

  it('[TC-PLATFORM-API-009] exactly-once: si la transacción del comando se revierte, la respuesta tampoco queda guardada', async () => {
    const req = request();
    const reserved = await store.reserve(req);
    if (reserved.outcome !== 'reserved') throw new Error('esperaba reserva');
    const tx = new PgCommandTransaction(pool);
    await expect(
      tx.run(req.scope, async (exec) => {
        await store.complete(reserved.ref, { status: 201, headers: {}, body: { id: 'x' } }, new Date(), exec);
        throw new Error('fallo después de completar');
      }),
    ).rejects.toThrow('fallo después de completar');
    const again = await store.reserve({ ...req, now: new Date() });
    expect(again.outcome).toBe('in-progress');
    await tx.run(req.scope, (exec) =>
      store.complete(
        reserved.ref,
        { status: 201, headers: { etag: '"1"' }, body: { id: 'x' } },
        new Date(),
        exec,
      ),
    );
    const replay = await store.reserve({ ...req, now: new Date() });
    expect(replay).toMatchObject({
      outcome: 'completed',
      response: { status: 201, headers: { etag: '"1"' }, body: { id: 'x' } },
    });
  });

  it('una clave de W1 no es visible ni reutilizable desde W2 ni desde el ámbito de usuario', async () => {
    const req = request();
    const r1 = await store.reserve(req);
    expect(r1.outcome).toBe('reserved');
    expect((await store.reserve({ ...req, scope: { workspaceId: w2, userId: user } })).outcome).toBe(
      'reserved',
    );
    expect((await store.reserve({ ...req, scope: { userId: user } })).outcome).toBe('reserved');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await applyRlsContext(client, { workspaceId: w2, userId: user });
      const visible = await client.query<{ workspace_id: string | null }>(
        'SELECT workspace_id FROM platform.idempotency_key WHERE key = $1',
        [req.key],
      );
      // Ve la fila de W2 y la propia de usuario (sin workspace), nunca la de W1.
      expect(visible.rows.map((r) => r.workspace_id).sort()).toEqual([null, w2].sort());
      // Escribir una fila de W1 con contexto de W2 viola la política.
      expect(
        await sqlState(() =>
          client.query(
            `INSERT INTO platform.idempotency_key (scope_id, key, workspace_id, user_id, method, route, request_hash,
               status, lock_token, locked_until, created_at, expires_at)
             VALUES ($1, 'K-forged-0000000001', $1, $2, 'POST', '/x', decode(repeat('00', 32), 'hex'), 'IN_PROGRESS',
               gen_random_uuid(), now(), now(), now() + interval '24 hours')`,
            [w1, user],
          ),
        ),
      ).toBe('42501');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('[TC-PLATFORM-API-011] la purga (SET ROLE pf_maintenance) solo borra claves vencidas; pf_app no hereda ese rol', async () => {
    const old = request({ now: new Date(Date.now() - 25 * H) });
    const fresh = request();
    expect((await store.reserve(old)).outcome).toBe('reserved');
    expect((await store.reserve(fresh)).outcome).toBe('reserved');
    const purged = await purgeExpiredIdempotencyKeys(pool);
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await visibleKeys([old.key, fresh.key])).toEqual([fresh.key]);
    // Sin SET ROLE explícito, pf_app no tiene los privilegios de pf_maintenance (NOINHERIT de la membresía).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await applyRlsContext(client, { workspaceId: w1, userId: user });
      const del = await client.query('DELETE FROM platform.idempotency_key WHERE workspace_id <> $1', [w1]);
      expect(del.rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('las restricciones de la tabla rechazan estados imposibles (5xx/429 almacenados, retención fuera de rango)', async () => {
    const req = request();
    const reserved = await store.reserve(req);
    if (reserved.outcome !== 'reserved') throw new Error('esperaba reserva');
    expect(
      await sqlState(() => store.complete(reserved.ref, { status: 503, headers: {}, body: {} }, new Date())),
    ).toBe('23514');
    expect(
      await sqlState(() => store.complete(reserved.ref, { status: 429, headers: {}, body: {} }, new Date())),
    ).toBe('23514');
    expect(await sqlState(() => store.reserve(request({ retentionMs: H })))).toBe('23514');
    await store.release(reserved.ref);
    expect((await store.reserve({ ...req, now: new Date() })).outcome).toBe('reserved');
  });
});
