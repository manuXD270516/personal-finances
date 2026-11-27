import { PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import type { CategoryMergeQuery } from '../contracts/merge.js';

/** Profundidad máxima de la cadena de fusiones (una destino fusionada después en otra, y así): corta ciclos imposibles. */
const MAX_CHAIN = 32;

/**
 * `CategoryMergeQuery` sobre PostgreSQL (D496, design decisión 9): resuelve cada categoría fusionada hacia su destino
 * vigente siguiendo la cadena `merged_into_id`; las no fusionadas no aparecen. Lectura sin efectos, en la unidad de
 * trabajo del llamador (reutiliza la transacción en curso y su RLS; sin una abre la suya con el workspace).
 */
export class PgCategoryMergeQuery implements CategoryMergeQuery {
  private readonly uow: PgUnitOfWork;

  constructor(
    pool: Pool,
    private readonly userId: () => string | null = () => null,
  ) {
    this.uow = new PgUnitOfWork(pool);
  }

  resolve(input: {
    readonly workspaceId: string;
    readonly categoryIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    const { workspaceId } = input;
    const ids = [...new Set(input.categoryIds)];
    if (ids.length === 0) return Promise.resolve(new Map());
    return this.uow.run({ userId: this.userId(), workspaceId }, async () => {
      const rows = await sql<{ origin: string; target: string }>`
        WITH RECURSIVE chain(origin, id, merged_into_id, depth) AS (
          SELECT c.id, c.id, c.merged_into_id, 0
            FROM classification.category c
           WHERE c.workspace_id = ${workspaceId} AND c.id = ANY(${ids}::uuid[]) AND c.merged_into_id IS NOT NULL
          UNION ALL
          SELECT chain.origin, n.id, n.merged_into_id, chain.depth + 1
            FROM chain
            JOIN classification.category n ON n.workspace_id = ${workspaceId} AND n.id = chain.merged_into_id
           WHERE chain.depth < ${MAX_CHAIN}
        )
        SELECT origin, id AS target FROM chain WHERE merged_into_id IS NULL`.execute(unitOfWorkKysely());
      return new Map(rows.rows.map((r) => [r.origin, r.target]));
    });
  }
}
