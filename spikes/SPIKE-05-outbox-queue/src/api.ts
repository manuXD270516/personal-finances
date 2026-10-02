// "API": comando que escribe la fila de negocio + el evento en platform.outbox en la MISMA transacción.
import { v4 as uuidv4 } from 'uuid';
import { withTx, type Pool, type PoolClient } from './db.js';
import { makeEnvelope, type Envelope } from './envelope.js';

export async function insertOutbox(c: PoolClient, env: Envelope): Promise<void> {
  await c.query(
    `INSERT INTO platform.outbox (id, workspace_id, event_type, event_version, aggregate_type, aggregate_id, aggregate_version, envelope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [env.eventId, env.workspaceId, env.eventType, env.eventVersion, env.aggregateType, env.aggregateId, env.aggregateVersion, env],
  );
}

/** Registra una transacción en una cuenta. `failAfterOutbox` simula un error tras escribir el outbox (=> rollback). */
export async function recordTransaction(
  pool: Pool,
  p: { accountId: string; amount: string; poison?: boolean; failAfterOutbox?: boolean },
): Promise<Envelope> {
  return withTx(pool, async (c) => {
    // versión del agregado: serializa por cuenta (lock de fila vía advisory xact lock)
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [p.accountId]);
    const { rows } = await c.query(
      'SELECT coalesce(max(account_version),0)+1 AS v FROM app.transaction WHERE account_id=$1', [p.accountId]);
    const version = Number(rows[0].v);
    const id = uuidv4();
    await c.query('INSERT INTO app.transaction (id, account_id, account_version, amount) VALUES ($1,$2,$3,$4)',
      [id, p.accountId, version, p.amount]);
    const env = makeEnvelope({
      aggregateId: p.accountId, aggregateVersion: version,
      payload: { transactionId: id, amount: { amount: p.amount, currency: 'USD' }, ...(p.poison ? { poison: true } : {}) },
    });
    await insertOutbox(c, env);
    if (p.failAfterOutbox) throw new Error('simulated business failure after outbox insert');
    return env;
  });
}
