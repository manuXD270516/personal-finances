import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';
import type { IdempotencyScope, SqlExecutor } from '../idempotency/store.js';

/**
 * Contexto RLS de una transacción (`set_config(..., true)` = `SET LOCAL`): `app.user_id` siempre y
 * `app.workspace_id` cuando la operación es de un workspace. Las políticas usan `platform.current_user_id()` y
 * `platform.current_workspace_id()`, que fallan con SQLSTATE PF002 si el contexto falta (ADR-0023).
 */
export async function applyRlsContext(tx: SqlExecutor, scope: IdempotencyScope): Promise<void> {
  await tx.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
    scope.userId,
    scope.workspaceId ?? '',
  ]);
}

const current = new AsyncLocalStorage<PoolClient>();

/** Transacción del comando en curso (la abre `PgCommandTransaction.run`); `undefined` fuera de un comando. */
export const currentSqlExecutor = (): SqlExecutor | undefined => current.getStore();

/** Puerto: ejecuta un comando dentro de una transacción con contexto RLS. */
export interface CommandTransaction {
  run<T>(scope: IdempotencyScope, fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/**
 * Transacción por comando sobre PostgreSQL (READ COMMITTED) con contexto RLS y la conexión expuesta por
 * `currentSqlExecutor()` a repositorios del mismo request. Es el mínimo que necesita la idempotencia para confirmar
 * efectos y respuesta juntos; la `UnitOfWork` de `add-workspace-identity` (AuthContext + membresía) la reemplaza
 * implementando el mismo puerto.
 */
export class PgCommandTransaction implements CommandTransaction {
  constructor(private readonly pool: Pool) {}

  async run<T>(scope: IdempotencyScope, fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await applyRlsContext(client, scope);
      const result = await current.run(client, () => fn(client));
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
