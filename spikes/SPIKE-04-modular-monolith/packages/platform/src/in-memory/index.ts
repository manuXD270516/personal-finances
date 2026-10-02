import { AsyncLocalStorage } from 'node:async_hooks';
import type { UnitOfWork } from '../index.js';

type Tables = Map<string, Map<string, unknown>>;

/**
 * "Base de datos" en memoria con semántica transaccional mínima:
 * cada transacción trabaja sobre una copia; COMMIT la publica, ROLLBACK la descarta.
 * Esto es infraestructura (usa node:async_hooks) y por eso vive fuera de `domain`.
 */
export class InMemoryDatabase {
  committed: Tables = new Map();
  commits = 0;
  rollbacks = 0;

  snapshot(): Tables {
    const copy: Tables = new Map();
    for (const [name, rows] of this.committed) copy.set(name, new Map(rows));
    return copy;
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  private readonly als = new AsyncLocalStorage<Tables>();

  constructor(readonly db: InMemoryDatabase) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return work(); // transacción ya abierta: participa en ella
    const tx = this.db.snapshot();
    try {
      const result = await this.als.run(tx, work);
      this.db.committed = tx;
      this.db.commits++;
      return result;
    } catch (err) {
      this.db.rollbacks++;
      throw err;
    }
  }

  /** Tabla de la transacción activa (o lectura del estado confirmado fuera de transacción). */
  table<V>(name: string): Map<string, V> {
    const tables = this.als.getStore() ?? this.db.committed;
    let t = tables.get(name);
    if (!t) {
      t = new Map();
      tables.set(name, t);
    }
    return t as Map<string, V>;
  }
}
