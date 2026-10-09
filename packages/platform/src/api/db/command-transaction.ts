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

/**
 * Aislamiento pedido para una transacción (`x-isolation` del contrato, add-reconciliation): `SERIALIZABLE` con
 * reintento acotado ante `40001`/`40P01` (docs/08 §11). Por omisión, READ COMMITTED sin reintentos.
 */
export interface TransactionOptions {
  readonly isolation?: 'SERIALIZABLE';
  /** Intentos totales ante un fallo de serialización (por defecto 3, solo con `SERIALIZABLE`). */
  readonly attempts?: number;
}

const DEFAULT_SERIALIZABLE_ATTEMPTS = 3;

/** ¿Es un fallo de serialización o un deadlock que se resuelve reintentando la transacción completa? */
export function isRetryableConflict(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === '40001' || code === '40P01';
}

const beginSql = (options: TransactionOptions): string =>
  options.isolation === 'SERIALIZABLE' ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN';
const attemptsOf = (options: TransactionOptions): number =>
  options.isolation === 'SERIALIZABLE' ? Math.max(1, options.attempts ?? DEFAULT_SERIALIZABLE_ATTEMPTS) : 1;

/** Puerto: ejecuta un comando dentro de una transacción con contexto RLS. */
export interface CommandTransaction {
  run<T>(
    scope: IdempotencyScope,
    fn: (tx: SqlExecutor) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
}

/**
 * Transacción por comando sobre PostgreSQL (READ COMMITTED) con contexto RLS y la conexión expuesta por
 * `currentSqlExecutor()` a repositorios del mismo request. Es el mínimo que necesita la idempotencia para confirmar
 * efectos y respuesta juntos; la `UnitOfWork` de `add-workspace-identity` (AuthContext + membresía) la reemplaza
 * implementando el mismo puerto.
 */
export class PgCommandTransaction implements CommandTransaction {
  constructor(private readonly pool: Pool) {}

  async run<T>(
    scope: IdempotencyScope,
    fn: (tx: SqlExecutor) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const attempts = attemptsOf(options);
    for (let attempt = 1; ; attempt += 1) {
      const client = await this.pool.connect();
      let broken = false;
      try {
        await client.query(beginSql(options));
        await applyRlsContext(client, scope);
        const result = await current.run(client, () => fn(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {
          broken = true;
        });
        // SERIALIZABLE: un conflicto con otra transacción se reintenta con una transacción nueva (efectos descartados).
        if (attempt < attempts && isRetryableConflict(err)) continue;
        throw err;
      } finally {
        client.release(broken);
      }
    }
  }
}

/** Contexto de autenticación/RLS de una unidad de trabajo (design §1). `null` = sin contexto (falla con PF002). */
export interface AuthContext {
  readonly userId: string | null;
  readonly workspaceId: string | null;
}

/** Fija el contexto RLS con `set_config(..., true)` (= `SET LOCAL`): nunca sobrevive a la transacción. */
export async function setRlsContext(tx: SqlExecutor, ctx: AuthContext): Promise<void> {
  await tx.query(`SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`, [
    ctx.userId ?? '',
    ctx.workspaceId ?? '',
  ]);
}

/**
 * Unit of Work de `add-workspace-identity`: ÚNICO punto autorizado para fijar el contexto RLS (lint contra
 * `SET app.` sin `LOCAL`). Abre una transacción, fija `app.user_id`/`app.workspace_id` LOCAL y expone la conexión
 * por `currentSqlExecutor()` a los repositorios. Si ya hay una transacción en curso en el mismo flujo async la
 * reutiliza (re-fijando el contexto), de modo que un caso de uso puede componer otros sin anidar transacciones.
 */
export class PgUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(ctx: AuthContext, fn: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const outer = current.getStore();
    if (outer) {
      // Reutiliza la transacción en curso: su aislamiento ya lo fijó quien la abrió (p. ej. el comando HTTP con
      // `x-isolation`), no se puede subir a mitad de transacción.
      await setRlsContext(outer, ctx);
      return fn();
    }
    const attempts = attemptsOf(options);
    for (let attempt = 1; ; attempt += 1) {
      const client = await this.pool.connect();
      let broken = false;
      try {
        await client.query(beginSql(options));
        await setRlsContext(client, ctx);
        const result = await current.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {
          broken = true;
        });
        if (attempt < attempts && isRetryableConflict(err)) continue;
        throw err;
      } finally {
        client.release(broken);
      }
    }
  }

  /**
   * Ejecuta `fn` en una transacción NUEVA e independiente aunque haya una unidad de trabajo en curso: lo que escribe
   * sobrevive al rollback de la transacción del comando (p. ej. auditar una solicitud RECHAZADA, que lanza y revierte el
   * comando). No usar para efectos que deban ser atómicos con el comando.
   */
  runDetached<T>(ctx: AuthContext, fn: () => Promise<T>): Promise<T> {
    return current.exit(() => this.run(ctx, fn));
  }

  /** Re-fija el contexto dentro de la transacción en curso (p. ej. tras dar de alta la identidad). */
  async bind(ctx: AuthContext): Promise<void> {
    await setRlsContext(requireSqlExecutor(), ctx);
  }
}

/** Conexión de la unidad de trabajo en curso; lanza si se usa un repositorio fuera de una. */
export function requireSqlExecutor(): SqlExecutor {
  const tx = current.getStore();
  if (!tx) throw new Error('no hay una unidad de trabajo en curso (PgUnitOfWork.run)');
  return tx;
}
