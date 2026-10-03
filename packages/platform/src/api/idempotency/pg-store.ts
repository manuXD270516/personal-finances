import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { applyRlsContext } from '../db/command-transaction.js';
import type { HttpResponseSnapshot } from '../errors/problem.js';
import {
  ReservationLostError,
  scopeIdOf,
  type IdempotencyScope,
  type IdempotencyStore,
  type ReservationRef,
  type ReserveRequest,
  type ReserveResult,
  type SqlExecutor,
} from './store.js';

interface Row {
  status: 'IN_PROGRESS' | 'COMPLETED';
  request_hash: Buffer;
  locked_until: Date | null;
  expires_at: Date;
  response_status: number | null;
  response_headers: Record<string, string> | null;
  response_body: unknown;
}

/**
 * `IdempotencyStore` sobre `platform.idempotency_key` (docs/08 §5.18, design §3), con RLS por workspace/usuario.
 *
 * - `reserve`: transacción corta. `INSERT … ON CONFLICT DO NOTHING`; si la clave existe se lee con `FOR UPDATE` y,
 *   si venció la retención o la reserva IN_PROGRESS (proceso caído), se retoma con un token nuevo.
 * - `complete`: `UPDATE … WHERE lock_token = $token`; con `tx` corre en la transacción del comando.
 * - `release`: borra la reserva propia (5xx/429).
 *
 * Los instantes vienen del reloj de la aplicación (inyectable en tests). Nunca registra `response_body`.
 */
export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: Pool) {}

  async reserve(req: ReserveRequest): Promise<ReserveResult> {
    return this.inTransaction(req.scope, async (tx) => {
      const token = randomUUID();
      const scopeId = scopeIdOf(req.scope);
      const lockedUntil = new Date(req.now.getTime() + req.lockTtlMs);
      const expiresAt = new Date(req.now.getTime() + req.retentionMs);
      const hash = Buffer.from(req.requestHash, 'hex');
      const inserted = await tx.query(
        `INSERT INTO platform.idempotency_key
           (scope_id, key, workspace_id, user_id, method, route, request_hash, status, lock_token, locked_until,
            created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'IN_PROGRESS', $8, $9, $10, $11)
         ON CONFLICT (scope_id, key) DO NOTHING
         RETURNING lock_token`,
        [
          scopeId,
          req.key,
          req.scope.workspaceId ?? null,
          req.scope.userId,
          req.method,
          req.route,
          hash,
          token,
          lockedUntil,
          req.now,
          expiresAt,
        ],
      );
      if (inserted.rowCount === 1)
        return { outcome: 'reserved', ref: { scope: req.scope, key: req.key, token } };

      const { rows } = await tx.query<Row>(
        `SELECT status, request_hash, locked_until, expires_at, response_status, response_headers, response_body
           FROM platform.idempotency_key WHERE scope_id = $1 AND key = $2 FOR UPDATE`,
        [scopeId, req.key],
      );
      const row = rows[0];
      const now = req.now.getTime();
      const takeOver =
        !row ||
        row.expires_at.getTime() <= now ||
        (row.status === 'IN_PROGRESS' && (row.locked_until?.getTime() ?? 0) <= now);
      if (takeOver) {
        // Clave vencida (se trata como nueva) o reserva huérfana tras una caída: se retoma.
        await tx.query(
          `INSERT INTO platform.idempotency_key
             (scope_id, key, workspace_id, user_id, method, route, request_hash, status, lock_token, locked_until,
              created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'IN_PROGRESS', $8, $9, $10, $11)
           ON CONFLICT (scope_id, key) DO UPDATE SET
             workspace_id = EXCLUDED.workspace_id, user_id = EXCLUDED.user_id, method = EXCLUDED.method,
             route = EXCLUDED.route, request_hash = EXCLUDED.request_hash, status = 'IN_PROGRESS',
             lock_token = EXCLUDED.lock_token, locked_until = EXCLUDED.locked_until,
             response_status = NULL, response_headers = NULL, response_body = NULL,
             created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
          [
            scopeId,
            req.key,
            req.scope.workspaceId ?? null,
            req.scope.userId,
            req.method,
            req.route,
            hash,
            token,
            lockedUntil,
            req.now,
            expiresAt,
          ],
        );
        return { outcome: 'reserved', ref: { scope: req.scope, key: req.key, token } };
      }
      const requestHash = row.request_hash.toString('hex');
      if (row.status === 'COMPLETED' && row.response_status !== null) {
        return {
          outcome: 'completed',
          requestHash,
          response: {
            status: row.response_status,
            headers: row.response_headers ?? {},
            body: row.response_body ?? undefined,
          },
        };
      }
      return { outcome: 'in-progress', requestHash };
    });
  }

  async complete(
    ref: ReservationRef,
    response: HttpResponseSnapshot,
    _now: Date,
    tx?: SqlExecutor,
  ): Promise<void> {
    const update = async (exec: SqlExecutor) => {
      const result = await exec.query(
        `UPDATE platform.idempotency_key
            SET status = 'COMPLETED', response_status = $4, response_headers = $5, response_body = $6,
                lock_token = NULL, locked_until = NULL
          WHERE scope_id = $1 AND key = $2 AND lock_token = $3 AND status = 'IN_PROGRESS'`,
        [
          scopeIdOf(ref.scope),
          ref.key,
          ref.token,
          response.status,
          JSON.stringify(response.headers),
          response.body === undefined ? null : JSON.stringify(response.body),
        ],
      );
      if (result.rowCount !== 1) throw new ReservationLostError();
    };
    if (tx) await update(tx);
    else await this.inTransaction(ref.scope, update);
  }

  async release(ref: ReservationRef): Promise<void> {
    await this.inTransaction(ref.scope, (tx) =>
      tx.query(`DELETE FROM platform.idempotency_key WHERE scope_id = $1 AND key = $2 AND lock_token = $3`, [
        scopeIdOf(ref.scope),
        ref.key,
        ref.token,
      ]),
    );
  }

  private async inTransaction<T>(scope: IdempotencyScope, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await applyRlsContext(client, scope);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      throw err;
    } finally {
      client.release(broken);
    }
  }
}

/**
 * Purga por retención (job del worker): asume el rol `pf_maintenance` solo dentro de la transacción
 * (`SET LOCAL ROLE`), cuya política RLS únicamente ve y borra filas con `expires_at < now()`.
 */
export async function purgeExpiredIdempotencyKeys(pool: Pool): Promise<number> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE pf_maintenance');
    const result = await client.query('DELETE FROM platform.idempotency_key WHERE expires_at < now()');
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw err;
  } finally {
    client.release(broken);
  }
}
