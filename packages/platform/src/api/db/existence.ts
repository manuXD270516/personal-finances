import { sql } from 'kysely';
import { unitOfWorkKysely } from './uow-kysely.js';

/**
 * Consulta de existencia por lote para los contratos públicos `*ExistenceQuery` de cada contexto dueño (openspec
 * add-document-attachments, decisión 9): devuelve los ids que existen en el workspace dentro de la unidad de trabajo en
 * curso (RLS ya fijada). `table` y `predicate` son constantes del contexto dueño (nunca entrada del usuario).
 */
export function pgExistingIds(
  table: string,
  predicate?: string,
): (workspaceId: string, ids: readonly string[]) => Promise<ReadonlySet<string>> {
  if (!/^[a-z_]+\.[a-z_]+$/u.test(table)) throw new Error('tabla inválida');
  return async (workspaceId, ids) => {
    if (ids.length === 0) return new Set<string>();
    const db = unitOfWorkKysely<Record<string, never>>();
    const { rows } = await sql<{ id: string }>`
      SELECT id::text AS id FROM ${sql.raw(table)}
       WHERE workspace_id = ${workspaceId} AND id = ANY(${[...ids]}::uuid[])
       ${predicate ? sql`AND ${sql.raw(predicate)}` : sql``}`.execute(db);
    return new Set(rows.map((r) => r.id));
  };
}
