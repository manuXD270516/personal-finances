// Consumidor idempotente: inbox (consumer, event_id) + efecto en la MISMA transacción.
import type { Pool } from './db.js';
import { validateEnvelope, type Envelope } from './envelope.js';
import { sleep } from './config.js';

export type Exec = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export class OutOfOrderError extends Error {}
export class PoisonError extends Error {}

export interface HandleOpts {
  consumer: string;
  /** Rechaza (y reintenta) si aggregateVersion != last_version + 1 (detección de huecos). */
  strictOrder?: boolean;
  /** Trabajo simulado dentro de la transacción (para probar shutdown/crash a mitad de job). */
  workMs?: number;
  /** Retardo aleatorio [0, jitterMs) antes de tomar el lock del agregado (expone reordenamientos). */
  jitterMs?: number;
  onStart?: (env: Envelope) => void;
}

async function body(exec: Exec, env: Envelope, o: HandleOpts): Promise<'applied' | 'duplicate'> {
  const ins = await exec(
    'INSERT INTO platform.inbox (consumer, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1',
    [o.consumer, env.eventId]);
  if (ins.rows.length === 0) {
    await exec('INSERT INTO app.delivery (consumer, event_id, duplicate) VALUES ($1,$2,true)', [o.consumer, env.eventId]);
    return 'duplicate';
  }
  await exec('INSERT INTO app.delivery (consumer, event_id, duplicate) VALUES ($1,$2,false)', [o.consumer, env.eventId]);
  if ((env.payload as any).poison) throw new PoisonError(`poison event ${env.eventId}`);
  if (o.jitterMs) await sleep(Math.random() * o.jitterMs);
  await exec('INSERT INTO app.balance (account_id) VALUES ($1) ON CONFLICT DO NOTHING', [env.aggregateId]);
  const { rows } = await exec('SELECT last_version FROM app.balance WHERE account_id=$1 FOR UPDATE', [env.aggregateId]);
  const last = Number(rows[0].last_version);
  if (o.strictOrder && env.aggregateVersion !== last + 1) {
    throw new OutOfOrderError(`account ${env.aggregateId}: got v${env.aggregateVersion}, expected v${last + 1}`);
  }
  if (o.workMs) await sleep(o.workMs);
  const amount = (env.payload as any).amount.amount as string;
  await exec(`UPDATE app.balance SET total = total + $2::numeric, last_version = GREATEST(last_version,$3),
              applied_count = applied_count + 1 WHERE account_id=$1`, [env.aggregateId, amount, env.aggregateVersion]);
  await exec('INSERT INTO app.applied (consumer, event_id, account_id, version) VALUES ($1,$2,$3,$4)',
    [o.consumer, env.eventId, env.aggregateId, env.aggregateVersion]);
  return 'applied';
}

/** Maneja con su propia transacción (BullMQ/Redis, BullMQ/PG). */
export async function handleWithPool(pool: Pool, env: unknown, o: HandleOpts): Promise<'applied' | 'duplicate'> {
  validateEnvelope(env);
  o.onStart?.(env);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await body((s, p) => c.query(s, p as any[]), env, o);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Maneja dentro de una transacción ajena (pg-boss `transactional: true`: inbox + efecto + completion juntos). */
export async function handleWithExec(exec: Exec, env: unknown, o: HandleOpts): Promise<'applied' | 'duplicate'> {
  validateEnvelope(env);
  o.onStart?.(env);
  return body(exec, env, o);
}

export async function recordDeadLetter(pool: Pool, consumer: string, env: Envelope, err: unknown, attempts: number) {
  await pool.query(
    `INSERT INTO platform.dead_letter (consumer, event_id, envelope, error, attempts) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (consumer, event_id) DO UPDATE SET error=EXCLUDED.error, attempts=EXCLUDED.attempts, last_failed_at=clock_timestamp()`,
    [consumer, env.eventId, env, String((err as Error)?.message ?? err), attempts]);
}
