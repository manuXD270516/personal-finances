import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import { currentRequestContext, unitOfWorkKysely } from '@pf/platform/api';
import { dec } from '@pf/shared-kernel';
import { sql, type Kysely } from 'kysely';
import type {
  ActorPort,
  BudgetRepository,
  CrossingKey,
  ThresholdCrossingRepository,
  ThresholdCrossingRow,
} from '../application/ports/index.js';
import {
  Budget,
  BudgetLine,
  type BudgetLineKind,
  type BudgetLineState,
  type BudgetNature,
  type BudgetOrigin,
  type BudgetState,
  type IncomeBasis,
  type RolloverPolicy,
  type RolloverStatus,
  type TargetKind,
} from '../domain/index.js';

// Las tablas se consultan con SQL explícito (fechas e instantes como texto, importes como texto exacto).
const db = (): Kysely<unknown> => unitOfWorkKysely<unknown>();

const instantText = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const currentUserId = (): string | null => {
  const actor = currentRequestContext()?.actor;
  return actor && actor.type === 'USER' ? actor.userId : null;
};

/** `ActorPort` de la API: usuario de la petición (`''` en procesos del worker). */
export const requestActor: ActorPort = { userId: () => currentUserId() ?? '' };

interface BudgetRow {
  id: string;
  workspace_id: string;
  period_id: string;
  currency: string;
  scale: number;
  origin: BudgetOrigin;
  template_version_id: string | null;
  cloned_from_budget_id: string | null;
  zero_based: boolean;
  version: number;
  created_at: string;
}

interface LineRow {
  id: string;
  workspace_id: string;
  budget_id: string;
  target_kind: TargetKind;
  target_id: string;
  nature: BudgetNature;
  kind: BudgetLineKind;
  planned_amount: string | null;
  min_amount: string | null;
  max_amount: string | null;
  percent: string | null;
  income_basis: IncomeBasis | null;
  rollover_policy: RolloverPolicy;
  rollover_cap: string | null;
  rollover_in_amount: string | null;
  rollover_status: RolloverStatus;
  thresholds: string[];
  source: 'MANUAL' | 'TEMPLATE' | 'CLONE';
  template_line_id: string | null;
  overridden: boolean;
  version: number;
}

const budgetSelect = sql`
  b.id, b.workspace_id, b.period_id, b.currency, c.scale, b.origin, b.template_version_id,
  b.cloned_from_budget_id, b.zero_based, b.version, ${instantText('b.created_at')} AS created_at
  FROM planning.budget b JOIN fx.currency c ON c.code = b.currency`;

/** Importe a la escala de la moneda del plan (NUMERIC(38,18) devuelve 18 decimales). */
const atScale = (value: string | null, scale: number): string | null =>
  value === null ? null : dec(value).toFixed(scale);

function toBudget(row: BudgetRow, lines: readonly LineRow[]): Budget {
  const scale = Number(row.scale);
  const state: BudgetState = {
    id: row.id,
    workspaceId: row.workspace_id,
    periodId: row.period_id,
    currency: row.currency,
    origin: row.origin,
    templateVersionId: row.template_version_id,
    clonedFromBudgetId: row.cloned_from_budget_id,
    zeroBased: row.zero_based,
    version: Number(row.version),
    createdAt: row.created_at,
  };
  return Budget.restore(
    state,
    lines.map((l) => {
      const line: BudgetLineState = {
        id: l.id,
        workspaceId: l.workspace_id,
        budgetId: l.budget_id,
        target: { kind: l.target_kind, id: l.target_id },
        nature: l.nature,
        kind: l.kind,
        planned: atScale(l.planned_amount, scale),
        min: atScale(l.min_amount, scale),
        max: atScale(l.max_amount, scale),
        percent: l.percent === null ? null : dec(l.percent).toFixed(),
        incomeBasis: l.income_basis,
        rolloverPolicy: l.rollover_policy,
        rolloverCap: atScale(l.rollover_cap, scale),
        rolloverInAmount: atScale(l.rollover_in_amount, scale),
        rolloverStatus: l.rollover_status,
        thresholds: l.thresholds.map((t) => dec(t).toFixed()),
        source: l.source,
        templateLineId: l.template_line_id,
        overridden: l.overridden,
        version: Number(l.version),
      };
      return BudgetLine.restore(line);
    }),
  );
}

async function loadLines(budgetIds: readonly string[]): Promise<Map<string, LineRow[]>> {
  const out = new Map<string, LineRow[]>();
  if (budgetIds.length === 0) return out;
  const { rows } = await sql<LineRow>`
    SELECT id, workspace_id, budget_id, target_kind, target_id, nature, kind,
           planned_amount::text, min_amount::text, max_amount::text, percent::text, income_basis,
           rollover_policy, rollover_cap::text, rollover_in_amount::text, rollover_status,
           thresholds::text[] AS thresholds, source, template_line_id, overridden, version
      FROM planning.budget_line
     WHERE budget_id = ANY(${[...budgetIds]}::uuid[])
     ORDER BY created_at, id`.execute(db());
  for (const row of rows) {
    const list = out.get(row.budget_id) ?? [];
    list.push(row);
    out.set(row.budget_id, list);
  }
  return out;
}

async function hydrate(rows: readonly BudgetRow[]): Promise<Budget[]> {
  const lines = await loadLines(rows.map((r) => r.id));
  return rows.map((r) => toBudget(r, lines.get(r.id) ?? []));
}

/**
 * Repositorio Kysely/SQL de planes y líneas sobre la unidad de trabajo en curso (RLS WS ya fijado; tarea 4.2):
 * `SELECT … FOR UPDATE` del plan para serializar comandos y evaluaciones de umbral, optimistic locking por `version` e
 * `INSERT … ON CONFLICT (workspace_id, period_id) DO NOTHING`.
 */
export class PgBudgetRepository implements BudgetRepository {
  async findById(
    workspaceId: string,
    id: string,
    options: { readonly lock?: 'update' } = {},
  ): Promise<Budget | null> {
    const lock = options.lock === 'update' ? sql`FOR UPDATE OF b` : sql``;
    const { rows } = await sql<BudgetRow>`
      SELECT ${budgetSelect}
       WHERE b.workspace_id = ${workspaceId}::uuid AND b.id = ${id}::uuid ${lock}`.execute(db());
    return (await hydrate(rows))[0] ?? null;
  }

  async findByPeriod(
    workspaceId: string,
    periodId: string,
    options: { readonly lock?: 'update' } = {},
  ): Promise<Budget | null> {
    const lock = options.lock === 'update' ? sql`FOR UPDATE OF b` : sql``;
    const { rows } = await sql<BudgetRow>`
      SELECT ${budgetSelect}
       WHERE b.workspace_id = ${workspaceId}::uuid AND b.period_id = ${periodId}::uuid ${lock}`.execute(db());
    return (await hydrate(rows))[0] ?? null;
  }

  async listByPeriods(workspaceId: string, periodIds: readonly string[]): Promise<Budget[]> {
    if (periodIds.length === 0) return [];
    const { rows } = await sql<BudgetRow>`
      SELECT ${budgetSelect}
       WHERE b.workspace_id = ${workspaceId}::uuid AND b.period_id = ANY(${[...periodIds]}::uuid[])
       ORDER BY b.created_at, b.id`.execute(db());
    return hydrate(rows);
  }

  async insertIfAbsent(budget: Budget): Promise<boolean> {
    const s = budget.snapshot;
    const user = currentUserId();
    const res = await sql<{ id: string }>`
      INSERT INTO planning.budget
        (id, workspace_id, period_id, currency, origin, template_version_id, cloned_from_budget_id, zero_based,
         version, created_by, updated_by)
      VALUES (${s.id}::uuid, ${s.workspaceId}::uuid, ${s.periodId}::uuid, ${s.currency}, ${s.origin},
              ${s.templateVersionId}::uuid, ${s.clonedFromBudgetId}::uuid, ${s.zeroBased}, ${s.version},
              ${user}::uuid, ${user}::uuid)
      ON CONFLICT (workspace_id, period_id) DO NOTHING
      RETURNING id`.execute(db());
    return res.rows.length > 0;
  }

  async save(budget: Budget): Promise<boolean> {
    const s = budget.snapshot;
    const res = await sql`
      UPDATE planning.budget
         SET zero_based = ${s.zeroBased}, version = ${s.version}, updated_at = now(), updated_by = ${currentUserId()}::uuid
       WHERE workspace_id = ${s.workspaceId}::uuid AND id = ${s.id}::uuid AND version = ${budget.persistedVersion}`.execute(
      db(),
    );
    return (res.numAffectedRows ?? 0n) > 0n;
  }

  async insertLine(line: BudgetLine): Promise<void> {
    const s = line.snapshot;
    await sql`
      INSERT INTO planning.budget_line
        (id, workspace_id, budget_id, target_kind, target_id, nature, kind, planned_amount, min_amount, max_amount,
         percent, income_basis, rollover_policy, rollover_cap, rollover_in_amount, rollover_status, thresholds, source,
         template_line_id, overridden, version)
      VALUES (${s.id}::uuid, ${s.workspaceId}::uuid, ${s.budgetId}::uuid, ${s.target.kind}, ${s.target.id}::uuid,
              ${s.nature}, ${s.kind}, ${s.planned}::numeric, ${s.min}::numeric, ${s.max}::numeric,
              ${s.percent}::numeric, ${s.incomeBasis}, ${s.rolloverPolicy}, ${s.rolloverCap}::numeric,
              ${s.rolloverInAmount}::numeric, ${s.rolloverStatus}, ${[...s.thresholds]}::numeric[], ${s.source},
              ${s.templateLineId}::uuid, ${s.overridden}, ${s.version})`.execute(db());
  }

  async updateLine(line: BudgetLine): Promise<boolean> {
    const s = line.snapshot;
    const res = await sql`
      UPDATE planning.budget_line
         SET kind = ${s.kind}, planned_amount = ${s.planned}::numeric, min_amount = ${s.min}::numeric,
             max_amount = ${s.max}::numeric, percent = ${s.percent}::numeric, income_basis = ${s.incomeBasis},
             rollover_policy = ${s.rolloverPolicy}, rollover_cap = ${s.rolloverCap}::numeric,
             rollover_in_amount = ${s.rolloverInAmount}::numeric, rollover_status = ${s.rolloverStatus},
             thresholds = ${[...s.thresholds]}::numeric[], overridden = ${s.overridden}, version = ${s.version},
             updated_at = now()
       WHERE workspace_id = ${s.workspaceId}::uuid AND id = ${s.id}::uuid AND version = ${line.persistedVersion}`.execute(
      db(),
    );
    return (res.numAffectedRows ?? 0n) > 0n;
  }

  async deleteLine(workspaceId: string, lineId: string): Promise<void> {
    await sql`DELETE FROM planning.budget_line WHERE workspace_id = ${workspaceId}::uuid AND id = ${lineId}::uuid`.execute(
      db(),
    );
  }
}

/**
 * Cruces de umbral (append-only): `INSERT … ON CONFLICT DO NOTHING RETURNING threshold` => solo los umbrales que ESTA
 * transacción registró (la PK por periodo, objetivo y umbral absorbe reentregas y evaluaciones concurrentes).
 */
export class PgThresholdCrossingRepository implements ThresholdCrossingRepository {
  async list(workspaceId: string, periodId: string): Promise<readonly CrossingKey[]> {
    const { rows } = await sql<{ target_kind: TargetKind; target_id: string; threshold: string }>`
      SELECT target_kind, target_id, threshold::text AS threshold
        FROM planning.budget_threshold_crossing
       WHERE workspace_id = ${workspaceId}::uuid AND period_id = ${periodId}::uuid`.execute(db());
    return rows.map((r) => ({
      targetKind: r.target_kind,
      targetId: r.target_id,
      threshold: dec(r.threshold).toFixed(),
    }));
  }

  async insertIfAbsent(rows: readonly ThresholdCrossingRow[]): Promise<readonly string[]> {
    const inserted: string[] = [];
    for (const r of rows) {
      const res = await sql<{ threshold: string }>`
        INSERT INTO planning.budget_threshold_crossing
          (workspace_id, period_id, target_kind, target_id, threshold, budget_id, budget_line_id, reference_amount,
           actual_amount, currency, crossed_at, event_id)
        VALUES (${r.workspaceId}::uuid, ${r.periodId}::uuid, ${r.targetKind}, ${r.targetId}::uuid, ${r.threshold}::numeric,
                ${r.budgetId}::uuid, ${r.budgetLineId}::uuid, ${r.reference}::numeric, ${r.actual}::numeric, ${r.currency},
                ${r.crossedAt}::timestamptz, ${r.eventId}::uuid)
        ON CONFLICT (workspace_id, period_id, target_kind, target_id, threshold) DO NOTHING
        RETURNING threshold::text AS threshold`.execute(db());
      const row = res.rows[0];
      if (row) inserted.push(dec(row.threshold).toFixed());
    }
    return inserted;
  }
}

/**
 * Calendario del workspace con caché corta para el worker: `calendarOf` del directorio abre una conexión PROPIA
 * (rol `pf_workspace_directory`) mientras el consumidor ya retiene la de su transacción con el inbox; en ráfagas de
 * eventos (cada hecho dispara la evaluación de los planes) eso duplicaría las conexiones en uso. La zona horaria y el día
 * de inicio casi no cambian y sus cambios llegan por eventos; una lectura de hasta `ttlMs` es inocua para evaluar umbrales.
 */
export function cachedCalendar(
  inner: WorkspaceCalendarQuery,
  ttlMs: number,
  now: () => number = Date.now,
): WorkspaceCalendarQuery {
  const cache = new Map<
    string,
    { readonly at: number; readonly value: Awaited<ReturnType<WorkspaceCalendarQuery['calendarOf']>> }
  >();
  return {
    async calendarOf(workspaceId) {
      const hit = cache.get(workspaceId);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      const value = await inner.calendarOf(workspaceId);
      cache.set(workspaceId, { at: now(), value });
      return value;
    },
  };
}
