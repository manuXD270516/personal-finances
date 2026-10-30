import { unitOfWorkKysely } from '@pf/platform/api';
import { sql } from 'kysely';
import type { MappingProfileRepository, StoredProfileVersion } from '../application/ports/index.js';
import { type MappingProfileVersion, type ProfileOptions, type StatementFormat } from '../domain/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>();

const TS = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

interface ProfileDbRow {
  id: string;
  version: number;
  workspace_id: string;
  institution_id: string | null;
  account_id: string | null;
  name: string;
  format: StatementFormat;
  options: unknown;
  created_by: string;
  created_at: string;
  archived_at: string | null;
}

const COLUMNS = sql`
  p.id, p.version, p.workspace_id, p.institution_id, p.account_id, p.name, p.format, p.options, p.created_by,
  ${TS('p.created_at')} AS created_at, ${TS('p.archived_at')} AS archived_at`;

const toVersion = (r: ProfileDbRow): StoredProfileVersion => ({
  id: r.id,
  version: Number(r.version),
  workspaceId: r.workspace_id,
  institutionId: r.institution_id,
  accountId: r.account_id,
  name: r.name,
  format: r.format,
  // Se guarda el `ProfileOptions` ya validado por el dominio (la forma de entrada del API es otra): sin re-parseo.
  options: r.options as ProfileOptions,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.created_at,
  archivedAt: r.archived_at,
});

/** Última versión de cada perfil (la de mayor `version`), con el alias `p`. */
const LATEST = sql`p.version = (SELECT max(m.version) FROM imports.mapping_profile m WHERE m.id = p.id AND m.workspace_id = p.workspace_id)`;

/**
 * Perfiles de mapeo (`imports.mapping_profile`, FR-IMPORTS-005): una fila por versión, inmutable salvo `archived_at`,
 * que `archive` escribe en todas las versiones del perfil. RLS forzada por workspace.
 */
export class PgMappingProfileRepository implements MappingProfileRepository {
  async insertVersion(v: MappingProfileVersion): Promise<void> {
    await sql`
      INSERT INTO imports.mapping_profile
        (id, version, workspace_id, institution_id, account_id, name, format, options, created_by, created_at)
      VALUES (${v.id}, ${v.version}, ${v.workspaceId}, ${v.institutionId}, ${v.accountId}, ${v.name}, ${v.format},
              ${JSON.stringify(v.options)}::jsonb, ${v.createdBy}, ${v.createdAt}::timestamptz)`.execute(
      db(),
    );
  }

  async versionsOf(workspaceId: string, profileId: string): Promise<readonly StoredProfileVersion[]> {
    const { rows } = await sql<ProfileDbRow>`
      SELECT ${COLUMNS} FROM imports.mapping_profile p
       WHERE p.workspace_id = ${workspaceId} AND p.id = ${profileId}
       ORDER BY p.version`.execute(db());
    return rows.map(toVersion);
  }

  async archive(workspaceId: string, profileId: string, at: string): Promise<void> {
    await sql`
      UPDATE imports.mapping_profile SET archived_at = ${at}::timestamptz
       WHERE workspace_id = ${workspaceId} AND id = ${profileId} AND archived_at IS NULL`.execute(db());
  }

  async latestForMatching(
    workspaceId: string,
    input: {
      readonly accountId: string;
      readonly institutionId: string | null;
      readonly format: StatementFormat;
    },
  ): Promise<readonly StoredProfileVersion[]> {
    const { rows } = await sql<ProfileDbRow>`
      SELECT ${COLUMNS} FROM imports.mapping_profile p
       WHERE p.workspace_id = ${workspaceId} AND p.format = ${input.format} AND p.archived_at IS NULL AND ${LATEST}
         AND (p.account_id = ${input.accountId}
              OR (p.account_id IS NULL AND ${input.institutionId}::uuid IS NOT NULL
                  AND p.institution_id = ${input.institutionId}::uuid))
       ORDER BY p.created_at DESC, p.id`.execute(db());
    return rows.map(toVersion);
  }

  async list(
    workspaceId: string,
    filter: {
      readonly institutionId?: string | undefined;
      readonly accountId?: string | undefined;
      readonly format?: StatementFormat | undefined;
      readonly includeArchived: boolean;
      readonly limit: number;
      readonly after?: readonly [string, string] | undefined;
    },
  ): Promise<readonly StoredProfileVersion[]> {
    const { rows } = await sql<ProfileDbRow>`
      SELECT ${COLUMNS} FROM imports.mapping_profile p
       WHERE p.workspace_id = ${workspaceId} AND ${LATEST}
         AND (${filter.institutionId ?? null}::uuid IS NULL OR p.institution_id = ${filter.institutionId ?? null}::uuid)
         AND (${filter.accountId ?? null}::uuid IS NULL OR p.account_id = ${filter.accountId ?? null}::uuid)
         AND (${filter.format ?? null}::text IS NULL OR p.format = ${filter.format ?? null}::text)
         AND (${filter.includeArchived} OR p.archived_at IS NULL)
         AND (${filter.after ? filter.after[0] : null}::timestamptz IS NULL
              OR (p.created_at, p.id) < (${filter.after ? filter.after[0] : null}::timestamptz,
                                         ${filter.after ? filter.after[1] : null}::uuid))
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ${filter.limit}`.execute(db());
    return rows.map(toVersion);
  }
}
