import type { Pool } from 'pg';

export interface EventPurgeOptions {
  /** Días que se retienen los eventos publicados (docs/08 §5.18: 7). */
  readonly outboxRetentionDays?: number;
  /** Días que se retienen los registros de inbox (docs/08 §5.18: 30). */
  readonly inboxRetentionDays?: number;
}

export interface EventPurgeResult {
  readonly outbox: number;
  readonly inbox: number;
}

/**
 * Purga por retención (openspec add-event-outbox, design §7) con el rol `pf_maintenance` asumido solo en esta
 * transacción: sus políticas exponen únicamente eventos YA publicados, así que un pendiente nunca se borra.
 * Idempotente entre réplicas. Los dead-letters no se purgan (se resuelven a mano).
 */
export async function purgeDeliveredEvents(
  pool: Pool,
  options: EventPurgeOptions = {},
): Promise<EventPurgeResult> {
  const outboxDays = options.outboxRetentionDays ?? 7;
  const inboxDays = options.inboxRetentionDays ?? 30;
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE pf_maintenance');
    const outbox = await client.query(
      `DELETE FROM platform.outbox
        WHERE published_at IS NOT NULL AND published_at < clock_timestamp() - make_interval(days => $1)`,
      [outboxDays],
    );
    const inbox = await client.query(
      `DELETE FROM platform.inbox WHERE processed_at < clock_timestamp() - make_interval(days => $1)`,
      [inboxDays],
    );
    await client.query('COMMIT');
    return { outbox: outbox.rowCount ?? 0, inbox: inbox.rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw err;
  } finally {
    client.release(broken);
  }
}
