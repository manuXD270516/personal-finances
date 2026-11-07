import { unitOfWorkKysely } from '@pf/platform/api';
import { DomainError } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { SavedViewRecord, SavedViewRepository } from '../application/ports/extended-reports.js';

interface Row {
  id: string;
  workspace_id: string;
  user_id: string;
  report_id: string;
  name: string;
  params: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = sql`id, workspace_id, user_id, report_id, name, params, version,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at`;

const toRecord = (r: Row): SavedViewRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  userId: r.user_id,
  reportId: r.report_id,
  name: r.name,
  params: r.params,
  version: Number(r.version),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';

/**
 * `reporting.saved_report_view` sobre PostgreSQL. Corre en la transacción de `ReportingUnitOfWork.run({userId,
 * workspaceId})`, que fija `app.workspace_id` y `app.user_id`: la RLS forzada deja ver y tocar solo las vistas del usuario
 * (las de otro miembro o de otro workspace son inexistentes). El alta serializa por (workspace, usuario) con un bloqueo
 * de asesoría de transacción para verificar el tope sin carreras; la unicidad del nombre la respalda el índice único.
 */
export class PgSavedViewRepository implements SavedViewRepository {
  async list(input: {
    workspaceId: string;
    userId: string;
    reportId?: string;
  }): Promise<readonly SavedViewRecord[]> {
    const { rows } = await sql<Row>`
      SELECT ${COLUMNS} FROM reporting.saved_report_view
       WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId}
         AND (${input.reportId ?? null}::text IS NULL OR report_id = ${input.reportId ?? null})
       ORDER BY lower(name), id`.execute(unitOfWorkKysely());
    return rows.map(toRecord);
  }

  async find(input: { workspaceId: string; userId: string; id: string }): Promise<SavedViewRecord | null> {
    const { rows } = await sql<Row>`
      SELECT ${COLUMNS} FROM reporting.saved_report_view
       WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId} AND id = ${input.id}`.execute(
      unitOfWorkKysely(),
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async lockAndCount(input: { workspaceId: string; userId: string }): Promise<number> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`saved-views:${input.workspaceId}:${input.userId}`}, 0))`.execute(
      unitOfWorkKysely(),
    );
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM reporting.saved_report_view
       WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId}`.execute(unitOfWorkKysely());
    return Number(rows[0]?.n ?? 0);
  }

  async nameTaken(input: {
    workspaceId: string;
    userId: string;
    reportId: string;
    name: string;
    exceptId?: string;
  }): Promise<boolean> {
    const { rows } = await sql<{ id: string }>`
      SELECT id FROM reporting.saved_report_view
       WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId} AND report_id = ${input.reportId}
         AND lower(name) = lower(${input.name})
         AND (${input.exceptId ?? null}::uuid IS NULL OR id <> ${input.exceptId ?? null}::uuid)
       LIMIT 1`.execute(unitOfWorkKysely());
    return rows.length > 0;
  }

  async insert(r: SavedViewRecord): Promise<void> {
    try {
      await sql`
        INSERT INTO reporting.saved_report_view
          (id, workspace_id, user_id, report_id, name, params, version, created_at, updated_at)
        VALUES (${r.id}, ${r.workspaceId}, ${r.userId}, ${r.reportId}, ${r.name}, ${JSON.stringify(r.params)}::jsonb,
                ${r.version}, ${r.createdAt}::timestamptz, ${r.updatedAt}::timestamptz)`.execute(
        unitOfWorkKysely(),
      );
    } catch (err) {
      // Carrera con otra alta del mismo nombre que la verificación previa no vio.
      if (isUniqueViolation(err)) {
        throw new DomainError('SAVED_VIEW_NAME_TAKEN', 'a view of this report already has that name').at(
          '/name',
        );
      }
      throw err;
    }
  }

  async update(input: {
    workspaceId: string;
    userId: string;
    id: string;
    expectedVersion: number;
    name: string;
    params: Readonly<Record<string, unknown>>;
    updatedAt: string;
  }): Promise<boolean> {
    try {
      const { rows } = await sql<{ id: string }>`
        UPDATE reporting.saved_report_view
           SET name = ${input.name}, params = ${JSON.stringify(input.params)}::jsonb, version = version + 1,
               updated_at = ${input.updatedAt}::timestamptz
         WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId} AND id = ${input.id}
           AND version = ${input.expectedVersion}
        RETURNING id`.execute(unitOfWorkKysely());
      return rows.length > 0;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError('SAVED_VIEW_NAME_TAKEN', 'a view of this report already has that name').at(
          '/name',
        );
      }
      throw err;
    }
  }

  async delete(input: { workspaceId: string; userId: string; id: string }): Promise<boolean> {
    const { rows } = await sql<{ id: string }>`
      DELETE FROM reporting.saved_report_view
       WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId} AND id = ${input.id}
      RETURNING id`.execute(unitOfWorkKysely());
    return rows.length > 0;
  }
}
