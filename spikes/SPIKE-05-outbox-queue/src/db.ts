import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PG_URL } from './config.js';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function makePool(max = 20): pg.Pool {
  const pool = new pg.Pool({ connectionString: PG_URL, max, application_name: 'spike05' });
  pool.on('error', () => {}); // conexiones ociosas terminadas (p. ej. en tests de crash)
  return pool;
}

export async function migrate(pool: pg.Pool): Promise<void> {
  const sql = readFileSync(fileURLToPath(new URL('../sql/001_schema.sql', import.meta.url)), 'utf8');
  const c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock(5005)");
    await c.query(sql);
  } finally {
    await c.query("SELECT pg_advisory_unlock(5005)");
    c.release();
  }
}

export async function resetData(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE app.transaction, app.balance, app.applied, app.delivery,
    platform.outbox, platform.inbox, platform.dead_letter RESTART IDENTITY`);
}

export async function withTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
