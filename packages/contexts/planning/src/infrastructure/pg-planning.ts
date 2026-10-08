import { currentRequestContext, PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { sql, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { FinancialPeriodRepository, IdGenerator, UnitOfWork } from '../application/ports/index.js';
import { FinancialPeriod, type FinancialPeriodStatus } from '../domain/index.js';

/** `planning.financial_period` (fechas como texto: evita el parser `date` → `Date` local de `pg`). */
interface PlanningDb {
  'planning.financial_period': {
    id: string;
    workspace_id: string;
    label: string;
    period_start: string;
    period_end: string;
    start_day: number;
    is_transition: boolean;
    status: FinancialPeriodStatus;
    close_count: number;
    reopen_count: number;
    latest_close_no: number | null;
    created_at: string;
    activated_at: string | null;
    updated_at: string;
    version: number;
  };
}

const db = (): Kysely<PlanningDb> => unitOfWorkKysely<PlanningDb>();

const instantText = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const columns = [
  'p.id',
  'p.workspace_id',
  'p.label',
  'p.start_day',
  'p.is_transition',
  'p.status',
  'p.close_count',
  'p.reopen_count',
  'p.latest_close_no',
  'p.version',
  sql<string>`p.period_start::text`.as('period_start'),
  sql<string>`p.period_end::text`.as('period_end'),
  instantText('p.created_at').as('created_at'),
  sql<string | null>`CASE WHEN p.activated_at IS NULL THEN NULL ELSE ${instantText('p.activated_at')} END`.as(
    'activated_at',
  ),
] as const;

type Row = Omit<PlanningDb['planning.financial_period'], 'updated_at'>;

function toPeriod(row: Row): FinancialPeriod {
  return FinancialPeriod.restore({
    id: row.id,
    workspaceId: row.workspace_id,
    label: row.label,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    startDay: Number(row.start_day),
    isTransition: row.is_transition,
    status: row.status,
    closeCount: Number(row.close_count),
    reopenCount: Number(row.reopen_count),
    latestCloseNo: row.latest_close_no === null ? null : Number(row.latest_close_no),
    version: Number(row.version),
    createdAt: row.created_at,
    activatedAt: row.activated_at,
  });
}

/**
 * Repositorio Kysely de periodos sobre la unidad de trabajo en curso (RLS WS ya fijado; tarea 4.2): optimistic locking
 * por `version`, `INSERT … ON CONFLICT (workspace_id, label) DO NOTHING` y candado consultivo por workspace.
 */
export class PgFinancialPeriodRepository implements FinancialPeriodRepository {
  async lockWorkspace(workspaceId: string): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`planning.periods:${workspaceId}`}))`.execute(db());
  }

  async list(workspaceId: string, statuses?: readonly FinancialPeriodStatus[]): Promise<FinancialPeriod[]> {
    let q = db()
      .selectFrom('planning.financial_period as p')
      .select(columns)
      .where('p.workspace_id', '=', workspaceId);
    if (statuses && statuses.length > 0) q = q.where('p.status', 'in', [...statuses]);
    const rows = await q.orderBy('p.period_start', 'asc').execute();
    return rows.map((r) => toPeriod(r as Row));
  }

  async findById(
    workspaceId: string,
    id: string,
    options: { readonly lock?: 'update' | 'share' } = {},
  ): Promise<FinancialPeriod | null> {
    let q = db()
      .selectFrom('planning.financial_period as p')
      .select(columns)
      .where('p.workspace_id', '=', workspaceId)
      .where('p.id', '=', id);
    if (options.lock === 'update') q = q.forUpdate();
    if (options.lock === 'share') q = q.forShare();
    const row = await q.executeTakeFirst();
    return row ? toPeriod(row as Row) : null;
  }

  async findContaining(workspaceId: string, date: string): Promise<FinancialPeriod | null> {
    const row = await db()
      .selectFrom('planning.financial_period as p')
      .select(columns)
      .where('p.workspace_id', '=', workspaceId)
      .where(sql<boolean>`p.period_start <= ${date}::date AND p.period_end >= ${date}::date`)
      .executeTakeFirst();
    return row ? toPeriod(row as Row) : null;
  }

  async coveredRange(workspaceId: string): Promise<{ readonly start: string; readonly end: string } | null> {
    const { rows } = await sql<{ start: string | null; end: string | null }>`
      SELECT min(period_start)::text AS start, max(period_end)::text AS "end"
        FROM planning.financial_period WHERE workspace_id = ${workspaceId}`.execute(db());
    const row = rows[0];
    return row?.start && row.end ? { start: row.start, end: row.end } : null;
  }

  async insertIfAbsent(period: FinancialPeriod): Promise<boolean> {
    const s = period.snapshot;
    const res = await db()
      .insertInto('planning.financial_period')
      .values({
        id: s.id,
        workspace_id: s.workspaceId,
        label: s.label,
        period_start: s.periodStart,
        period_end: s.periodEnd,
        start_day: s.startDay,
        is_transition: s.isTransition,
        status: s.status,
        close_count: s.closeCount,
        reopen_count: s.reopenCount,
        latest_close_no: s.latestCloseNo,
        created_at: s.createdAt ?? sql`now()`,
        activated_at: s.activatedAt,
        version: s.version,
      } as never)
      .onConflict((oc) => oc.columns(['workspace_id', 'label']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return res !== undefined;
  }

  async update(period: FinancialPeriod): Promise<boolean> {
    const s = period.snapshot;
    const res = await db()
      .updateTable('planning.financial_period')
      .set({
        period_start: s.periodStart,
        period_end: s.periodEnd,
        start_day: s.startDay,
        is_transition: s.isTransition,
        status: s.status,
        close_count: s.closeCount,
        reopen_count: s.reopenCount,
        latest_close_no: s.latestCloseNo,
        activated_at: s.activatedAt,
        version: s.version,
        updated_at: sql`now()`,
      } as never)
      .where('workspace_id', '=', s.workspaceId)
      .where('id', '=', s.id)
      .where('version', '=', period.persistedVersion)
      .executeTakeFirst();
    return res.numUpdatedRows > 0n;
  }
}

/**
 * Unidad de trabajo de PLANNING: transacción PG con el contexto RLS del workspace y del usuario de la petición (o sin
 * usuario en el worker); reutiliza la transacción del llamador (consumidor con inbox, caso de uso de pf-p2b).
 */
export class PgPlanningUnitOfWork implements UnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const actor = currentRequestContext()?.actor;
    const userId = actor && actor.type === 'USER' ? actor.userId : null;
    return this.uow.run({ userId, workspaceId }, fn);
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };
