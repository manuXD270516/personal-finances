import { PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import type { DataVersionStore, ReportingUnitOfWork } from '../application/ports/index.js';

/**
 * Unidad de trabajo de lectura: una transacción PG con el contexto RLS del workspace y del usuario (INV-025,
 * ADR-0023); los adapters de los otros contextos la reutilizan (misma conexión ⇒ lectura consistente).
 */
export class PgReportingUnitOfWork implements ReportingUnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  run<T>(
    ctx: { readonly userId: string | null; readonly workspaceId: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.uow.run(ctx, fn);
  }
}

/**
 * `reporting.workspace_data_version` (DRV): `pf_app` la lee (ETag); el consumidor del worker la incrementa con un
 * UPSERT dentro de la transacción del inbox (una re-entrega del mismo evento no llega aquí: idempotencia, INV-028).
 */
export class PgDataVersionStore implements DataVersionStore {
  async versionOf(workspaceId: string): Promise<string> {
    const { rows } = await sql<{ version: string }>`
      SELECT version::text AS version FROM reporting.workspace_data_version
       WHERE workspace_id = ${workspaceId}`.execute(unitOfWorkKysely());
    return rows[0]?.version ?? '0';
  }

  async bump(workspaceId: string, at: string): Promise<void> {
    await sql`
      INSERT INTO reporting.workspace_data_version AS v (workspace_id, version, updated_at)
      VALUES (${workspaceId}, 1, ${at}::timestamptz)
      ON CONFLICT (workspace_id) DO UPDATE
        SET version = v.version + 1, updated_at = GREATEST(v.updated_at, EXCLUDED.updated_at)`.execute(
      unitOfWorkKysely(),
    );
  }
}
