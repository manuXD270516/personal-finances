import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { requireSqlExecutor } from './command-transaction.js';

/**
 * Conexión Kysely que ejecuta SIEMPRE sobre la conexión de la unidad de trabajo en curso (`PgUnitOfWork.run`):
 * mismo client, misma transacción y el contexto RLS ya fijado con `set_config(..., true)` (ADR-0007, ADR-0023).
 * Kysely solo construye y compila la consulta; no abre transacciones ni conexiones propias. NUMERIC llega como
 * string (parser por defecto de `pg`), nunca como `number`.
 */
class UnitOfWorkConnection implements DatabaseConnection {
  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const res = (await requireSqlExecutor().query(compiled.sql, [...compiled.parameters])) as {
      rows: R[];
      rowCount?: number | null;
    };
    const affected = res.rowCount ?? undefined;
    return affected === undefined
      ? { rows: res.rows }
      : { rows: res.rows, numAffectedRows: BigInt(affected) };
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streamQuery no está soportado sobre la unidad de trabajo');
  }
}

class UnitOfWorkDriver implements Driver {
  private readonly connection = new UnitOfWorkConnection();
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return this.connection;
  }
  async beginTransaction(): Promise<void> {
    throw new Error('las transacciones las abre PgUnitOfWork.run, no Kysely');
  }
  async commitTransaction(): Promise<void> {
    throw new Error('las transacciones las abre PgUnitOfWork.run, no Kysely');
  }
  async rollbackTransaction(): Promise<void> {
    throw new Error('las transacciones las abre PgUnitOfWork.run, no Kysely');
  }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {}
}

/** Instancia Kysely tipada por `DB` ligada a la unidad de trabajo en curso (falla fuera de una). */
export function unitOfWorkKysely<DB>(): Kysely<DB> {
  return new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new UnitOfWorkDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}
