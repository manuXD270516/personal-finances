import { PgUnitOfWork, currentRequestContext, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { Money, currency as makeCurrency, dec } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import type {
  FlowRow,
  FundRow,
  GoalFilter,
  GoalRepository,
  IdGenerator,
  MaterializationRecord,
  MaterializationRepository,
  MovementFilter,
  MovementRepository,
  MovementRow,
  PlanRecord,
  PlanRepository,
  ReservationStateRecord,
  ReservationStateRepository,
  SuggestionRecord,
  SuggestionRepository,
  SuggestionStatus,
  UnitOfWork,
} from '../application/ports/index.js';
import { SavingsGoal, type GoalState, type GoalStatus } from '../domain/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>();
const ISO = (col: string) => sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
const D = (col: string) => sql.raw(`to_char(${col}, 'YYYY-MM-DD')`);

/** Unidad de trabajo de GOALS: transacción PG con el contexto RLS del workspace; reutiliza la del llamador. */
export class PgGoalsUnitOfWork implements UnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const actor = currentRequestContext()?.actor;
    return this.uow.run({ userId: actor && actor.type === 'USER' ? actor.userId : null, workspaceId }, fn);
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };

/** Escala de `fx.currency`. */
export async function pgScaleOf(code: string): Promise<number | null> {
  const { rows } = await sql<{ scale: number }>`
    SELECT scale FROM fx.currency WHERE code = ${code} AND is_active`.execute(db());
  return rows[0] ? Number(rows[0].scale) : null;
}

/** Monto de BD (numeric(38,18)) a la escala de su moneda. */
const fixed = (value: string | null, scale: number): string => dec(value ?? '0').toFixed(scale);

// ───────────────────────────────────────────────────────────── metas

interface GoalRow {
  id: string;
  workspace_id: string;
  name: string;
  goal_type: GoalState['type'];
  target_amount: string;
  currency: string;
  scale: number;
  start_date: string;
  target_date: string | null;
  priority: number;
  icon: string | null;
  color: string | null;
  notes: string | null;
  tolerance_percent: string;
  pace_periods: number;
  status: GoalStatus;
  achieved_on: string | null;
  closed_on: string | null;
  cancelled_on: string | null;
  cancel_reason: string | null;
  archived_at: string | null;
  version: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

const GOAL_COLUMNS = sql`
  g.id, g.workspace_id, g.name, g.goal_type, g.target_amount, g.currency, c.scale,
  ${D('g.start_date')} AS start_date, ${D('g.target_date')} AS target_date, g.priority, g.icon, g.color, g.notes,
  g.tolerance_percent::text AS tolerance_percent, g.pace_periods, g.status,
  ${D('g.achieved_on')} AS achieved_on, ${D('g.closed_on')} AS closed_on, ${D('g.cancelled_on')} AS cancelled_on,
  g.cancel_reason, ${ISO('g.archived_at')} AS archived_at, g.version, g.created_by,
  ${ISO('g.created_at')} AS created_at, g.updated_by, ${ISO('g.updated_at')} AS updated_at`;

const toGoal = (r: GoalRow, linked: readonly string[]): SavingsGoal =>
  SavingsGoal.restore({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    type: r.goal_type,
    targetAmount: fixed(r.target_amount, Number(r.scale)),
    currency: r.currency,
    startDate: r.start_date,
    targetDate: r.target_date,
    linkedAccountIds: linked,
    priority: Number(r.priority),
    icon: r.icon,
    color: r.color,
    notes: r.notes,
    tolerancePercent: dec(r.tolerance_percent).toFixed(2),
    pacePeriods: Number(r.pace_periods),
    status: r.status,
    achievedOn: r.achieved_on,
    closedOn: r.closed_on,
    cancelledOn: r.cancelled_on,
    cancelReason: r.cancel_reason,
    archivedAt: r.archived_at,
    version: Number(r.version),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  });

async function linkedOf(workspaceId: string, ids: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const { rows } = await sql<{ goal_id: string; account_id: string }>`
    SELECT goal_id, account_id FROM goals.goal_linked_account
     WHERE workspace_id = ${workspaceId} AND goal_id = ANY(${[...ids]}::uuid[])
     ORDER BY linked_at, account_id`.execute(db());
  for (const r of rows) out.set(r.goal_id, [...(out.get(r.goal_id) ?? []), r.account_id]);
  return out;
}

export class PgGoalRepository implements GoalRepository {
  private async hydrate(workspaceId: string, rows: readonly GoalRow[]): Promise<SavingsGoal[]> {
    const linked = await linkedOf(
      workspaceId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toGoal(r, linked.get(r.id) ?? []));
  }

  async findById(
    workspaceId: string,
    id: string,
    options?: { lock?: 'update' },
  ): Promise<SavingsGoal | null> {
    const lock = options?.lock === 'update' ? sql`FOR UPDATE OF g` : sql``;
    const { rows } = await sql<GoalRow>`
      SELECT ${GOAL_COLUMNS} FROM goals.savings_goal g JOIN fx.currency c ON c.code = g.currency
       WHERE g.workspace_id = ${workspaceId} AND g.id = ${id} ${lock}`.execute(db());
    return (await this.hydrate(workspaceId, rows))[0] ?? null;
  }

  async lockMany(workspaceId: string, ids: readonly string[]): Promise<readonly SavingsGoal[]> {
    const { rows } = await sql<GoalRow>`
      SELECT ${GOAL_COLUMNS} FROM goals.savings_goal g JOIN fx.currency c ON c.code = g.currency
       WHERE g.workspace_id = ${workspaceId} AND g.id = ANY(${[...ids]}::uuid[])
       ORDER BY g.id FOR UPDATE OF g`.execute(db());
    return this.hydrate(workspaceId, rows);
  }

  async insert(goal: SavingsGoal): Promise<void> {
    const s = goal.snapshot;
    await sql`
      INSERT INTO goals.savings_goal (
        id, workspace_id, name, goal_type, target_amount, currency, start_date, target_date, priority, icon, color,
        notes, tolerance_percent, pace_periods, status, achieved_on, closed_on, cancelled_on, cancel_reason,
        archived_at, version, created_by, created_at, updated_by, updated_at)
      VALUES (
        ${s.id}, ${s.workspaceId}, ${s.name}, ${s.type}, ${s.targetAmount}, ${s.currency}, ${s.startDate}::date,
        ${s.targetDate}::date, ${s.priority}, ${s.icon}, ${s.color}, ${s.notes}, ${s.tolerancePercent}::numeric,
        ${s.pacePeriods}, ${s.status}, ${s.achievedOn}::date, ${s.closedOn}::date, ${s.cancelledOn}::date,
        ${s.cancelReason}, ${s.archivedAt}::timestamptz, ${s.version}, ${s.createdBy}, ${s.createdAt}::timestamptz,
        ${s.updatedBy}, ${s.updatedAt}::timestamptz)`.execute(db());
    for (const accountId of s.linkedAccountIds) {
      await sql`
        INSERT INTO goals.goal_linked_account (workspace_id, goal_id, account_id, linked_by)
        VALUES (${s.workspaceId}, ${s.id}, ${accountId}, ${s.createdBy})`.execute(db());
    }
  }

  async save(goal: SavingsGoal): Promise<boolean> {
    const s = goal.snapshot;
    const result = await sql`
      UPDATE goals.savings_goal SET
        name = ${s.name}, goal_type = ${s.type}, target_amount = ${s.targetAmount}, currency = ${s.currency},
        target_date = ${s.targetDate}::date, priority = ${s.priority}, icon = ${s.icon}, color = ${s.color},
        notes = ${s.notes}, tolerance_percent = ${s.tolerancePercent}::numeric, pace_periods = ${s.pacePeriods},
        status = ${s.status}, achieved_on = ${s.achievedOn}::date, closed_on = ${s.closedOn}::date,
        cancelled_on = ${s.cancelledOn}::date, cancel_reason = ${s.cancelReason},
        archived_at = ${s.archivedAt}::timestamptz, version = ${s.version}, updated_by = ${s.updatedBy},
        updated_at = ${s.updatedAt}::timestamptz
       WHERE workspace_id = ${s.workspaceId} AND id = ${s.id} AND version = ${goal.persistedVersion}`.execute(
      db(),
    );
    if (Number(result.numAffectedRows ?? 0) !== 1) return false;
    const current = (await linkedOf(s.workspaceId, [s.id])).get(s.id) ?? [];
    for (const accountId of current.filter((a) => !s.linkedAccountIds.includes(a))) {
      await sql`
        DELETE FROM goals.goal_linked_account
         WHERE workspace_id = ${s.workspaceId} AND goal_id = ${s.id} AND account_id = ${accountId}`.execute(
        db(),
      );
    }
    for (const accountId of s.linkedAccountIds.filter((a) => !current.includes(a))) {
      await sql`
        INSERT INTO goals.goal_linked_account (workspace_id, goal_id, account_id, linked_by)
        VALUES (${s.workspaceId}, ${s.id}, ${accountId}, ${s.updatedBy})`.execute(db());
    }
    return true;
  }

  async list(workspaceId: string, filter: GoalFilter): Promise<readonly SavingsGoal[]> {
    const statuses = filter.statuses && filter.statuses.length > 0 ? [...filter.statuses] : null;
    const { rows } = await sql<GoalRow>`
      SELECT ${GOAL_COLUMNS} FROM goals.savings_goal g JOIN fx.currency c ON c.code = g.currency
       WHERE g.workspace_id = ${workspaceId}
         AND (${statuses}::text[] IS NULL OR g.status = ANY(${statuses}::text[]))
         AND (${filter.type ?? null}::text IS NULL OR g.goal_type = ${filter.type ?? null})
         AND (${filter.includeArchived ?? false} OR g.archived_at IS NULL)
       ORDER BY g.priority, g.target_date NULLS LAST, lower(g.name), g.id`.execute(db());
    return this.hydrate(workspaceId, rows);
  }

  async nameTaken(workspaceId: string, name: string, exceptId?: string): Promise<boolean> {
    const { rows } = await sql<{ found: number }>`
      SELECT 1 AS found FROM goals.savings_goal
       WHERE workspace_id = ${workspaceId} AND lower(name) = lower(${name}) AND archived_at IS NULL
         AND (${exceptId ?? null}::uuid IS NULL OR id <> ${exceptId ?? null}::uuid) LIMIT 1`.execute(db());
    return rows.length > 0;
  }

  async linkedToAccounts(workspaceId: string, accountIds: readonly string[]) {
    if (accountIds.length === 0) return [];
    const { rows } = await sql<{ goal_id: string; account_id: string; status: GoalStatus }>`
      SELECT l.goal_id, l.account_id, g.status
        FROM goals.goal_linked_account l
        JOIN goals.savings_goal g ON g.workspace_id = l.workspace_id AND g.id = l.goal_id
       WHERE l.workspace_id = ${workspaceId} AND l.account_id = ANY(${[...accountIds]}::uuid[])
         AND g.status IN ('ACTIVE', 'PAUSED')
       ORDER BY l.goal_id`.execute(db());
    return rows.map((r) => ({ goalId: r.goal_id, accountId: r.account_id, status: r.status }));
  }

  async withForeignFunds(workspaceId: string): Promise<readonly string[]> {
    const { rows } = await sql<{ id: string }>`
      SELECT DISTINCT g.id FROM goals.savings_goal g
        JOIN goals.goal_movement m ON m.workspace_id = g.workspace_id AND m.goal_id = g.id
       WHERE g.workspace_id = ${workspaceId} AND g.status IN ('ACTIVE', 'PAUSED') AND m.currency <> g.currency
       ORDER BY g.id`.execute(db());
    return rows.map((r) => r.id);
  }
}

// ───────────────────────────────────────────────────────────── movimientos

interface MovementDbRow {
  id: string;
  goal_id: string;
  fund: MovementRow['fund'];
  movement: MovementRow['kind'];
  amount: string;
  currency: string;
  scale: number;
  account_id: string;
  occurred_on: string;
  transaction_id: string | null;
  transaction_revision: number | null;
  reverses_id: string | null;
  reassignment_id: string | null;
  origin: MovementRow['origin'];
  note: string | null;
  recorded_at: string;
  recorded_by: string;
}

const MOVEMENT_COLUMNS = sql`
  m.id, m.goal_id, m.fund, m.movement, m.amount, m.currency, c.scale, m.account_id,
  ${D('m.occurred_on')} AS occurred_on, m.transaction_id, m.transaction_revision, m.reverses_id, m.reassignment_id,
  m.origin, m.note, ${ISO('m.recorded_at')} AS recorded_at, m.recorded_by`;

const toMovement = (r: MovementDbRow): MovementRow => ({
  id: r.id,
  goalId: r.goal_id,
  fund: r.fund,
  kind: r.movement,
  amount: Money.parse(fixed(r.amount, Number(r.scale)), makeCurrency(r.currency, Number(r.scale))),
  accountId: r.account_id,
  occurredOn: r.occurred_on,
  transactionId: r.transaction_id,
  transactionRevision: r.transaction_revision === null ? null : Number(r.transaction_revision),
  reversesId: r.reverses_id,
  reassignmentId: r.reassignment_id,
  origin: r.origin,
  note: r.note,
  recordedAt: r.recorded_at,
  recordedBy: r.recorded_by,
});

const FROM_MOVEMENT = sql`goals.goal_movement m JOIN fx.currency c ON c.code = m.currency`;

export class PgMovementRepository implements MovementRepository {
  async insert(workspaceId: string, m: MovementRow): Promise<boolean> {
    const result = await sql`
      INSERT INTO goals.goal_movement (
        id, workspace_id, goal_id, fund, movement, amount, currency, account_id, occurred_on, transaction_id,
        transaction_revision, reverses_id, reassignment_id, origin, note, recorded_at, recorded_by)
      VALUES (
        ${m.id}, ${workspaceId}, ${m.goalId}, ${m.fund}, ${m.kind}, ${m.amount.toFixed()}, ${m.amount.currency.code},
        ${m.accountId}, ${m.occurredOn}::date, ${m.transactionId}, ${m.transactionRevision}, ${m.reversesId},
        ${m.reassignmentId}, ${m.origin}, ${m.note}, ${m.recordedAt}::timestamptz, ${m.recordedBy})
      ON CONFLICT DO NOTHING`.execute(db());
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async find(workspaceId: string, id: string): Promise<MovementRow | null> {
    const { rows } = await sql<MovementDbRow>`
      SELECT ${MOVEMENT_COLUMNS} FROM ${FROM_MOVEMENT} WHERE m.workspace_id = ${workspaceId} AND m.id = ${id}`.execute(
      db(),
    );
    return rows[0] ? toMovement(rows[0]) : null;
  }

  async listAll(workspaceId: string, goalId: string): Promise<readonly MovementRow[]> {
    const { rows } = await sql<MovementDbRow>`
      SELECT ${MOVEMENT_COLUMNS} FROM ${FROM_MOVEMENT}
       WHERE m.workspace_id = ${workspaceId} AND m.goal_id = ${goalId} ORDER BY m.recorded_at, m.id`.execute(
      db(),
    );
    return rows.map(toMovement);
  }

  async list(workspaceId: string, goalId: string, filter: MovementFilter): Promise<readonly MovementRow[]> {
    const cursor = filter.cursor;
    const { rows } = await sql<MovementDbRow>`
      SELECT ${MOVEMENT_COLUMNS} FROM ${FROM_MOVEMENT}
       WHERE m.workspace_id = ${workspaceId} AND m.goal_id = ${goalId}
         AND (${filter.from ?? null}::date IS NULL OR m.occurred_on >= ${filter.from ?? null}::date)
         AND (${filter.to ?? null}::date IS NULL OR m.occurred_on <= ${filter.to ?? null}::date)
         AND (${cursor?.occurredOn ?? null}::date IS NULL
              OR (m.occurred_on, m.recorded_at, m.id) <
                 (${cursor?.occurredOn ?? null}::date, ${cursor?.recordedAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
       ORDER BY m.occurred_on DESC, m.recorded_at DESC, m.id DESC
       LIMIT ${filter.limit ?? 50}`.execute(db());
    return rows.map(toMovement);
  }

  async hasAny(workspaceId: string, goalId: string): Promise<boolean> {
    const { rows } = await sql<{ x: number }>`
      SELECT 1 AS x FROM goals.goal_movement WHERE workspace_id = ${workspaceId} AND goal_id = ${goalId} LIMIT 1`.execute(
      db(),
    );
    return rows.length > 0;
  }

  async sums(workspaceId: string, goalIds: readonly string[]) {
    if (goalIds.length === 0) return [];
    const { rows } = await sql<{ goal_id: string; currency: string; amount: string; scale: number }>`
      SELECT m.goal_id, m.currency, c.scale, SUM(m.amount)::text AS amount
        FROM ${FROM_MOVEMENT}
       WHERE m.workspace_id = ${workspaceId} AND m.goal_id = ANY(${[...goalIds]}::uuid[])
       GROUP BY m.goal_id, m.currency, c.scale ORDER BY m.goal_id, m.currency`.execute(db());
    return rows.map((r) => ({
      goalId: r.goal_id,
      currency: r.currency,
      amount: fixed(r.amount, Number(r.scale)),
    }));
  }

  async funds(
    workspaceId: string,
    filter: {
      readonly goalIds?: readonly string[];
      readonly accountIds?: readonly string[];
      readonly statuses?: readonly GoalStatus[];
    },
  ): Promise<readonly FundRow[]> {
    const goalIds = filter.goalIds ? [...filter.goalIds] : null;
    const accountIds = filter.accountIds ? [...filter.accountIds] : null;
    const statuses = filter.statuses ? [...filter.statuses] : null;
    const { rows } = await sql<{
      goal_id: string;
      name: string;
      status: GoalStatus;
      account_id: string;
      fund: FundRow['fund'];
      currency: string;
      scale: number;
      amount: string;
    }>`
      SELECT m.goal_id, g.name, g.status, m.account_id, m.fund, m.currency, c.scale, SUM(m.amount)::text AS amount
        FROM ${FROM_MOVEMENT}
        JOIN goals.savings_goal g ON g.workspace_id = m.workspace_id AND g.id = m.goal_id
       WHERE m.workspace_id = ${workspaceId}
         AND (${goalIds}::uuid[] IS NULL OR m.goal_id = ANY(${goalIds}::uuid[]))
         AND (${accountIds}::uuid[] IS NULL OR m.account_id = ANY(${accountIds}::uuid[]))
         AND (${statuses}::text[] IS NULL OR g.status = ANY(${statuses}::text[]))
       GROUP BY m.goal_id, g.name, g.status, m.account_id, m.fund, m.currency, c.scale
       ORDER BY m.goal_id, m.account_id, m.fund`.execute(db());
    return rows.map((r) => ({
      goalId: r.goal_id,
      goalName: r.name,
      goalStatus: r.status,
      accountId: r.account_id,
      fund: r.fund,
      currency: r.currency,
      amount: fixed(r.amount, Number(r.scale)),
    }));
  }

  async byTransactions(
    workspaceId: string,
    transactionIds: readonly string[],
  ): Promise<readonly MovementRow[]> {
    if (transactionIds.length === 0) return [];
    const { rows } = await sql<MovementDbRow>`
      SELECT ${MOVEMENT_COLUMNS} FROM ${FROM_MOVEMENT}
       WHERE m.workspace_id = ${workspaceId} AND m.transaction_id = ANY(${[...transactionIds]}::uuid[])
       ORDER BY m.recorded_at, m.id`.execute(db());
    return rows.map(toMovement);
  }

  async liveByTransaction(workspaceId: string, transactionId: string): Promise<readonly MovementRow[]> {
    const { rows } = await sql<MovementDbRow>`
      SELECT ${MOVEMENT_COLUMNS} FROM ${FROM_MOVEMENT}
       WHERE m.workspace_id = ${workspaceId} AND m.transaction_id = ${transactionId}
         AND m.fund = 'REAL' AND m.movement IN ('CONTRIBUTION', 'WITHDRAWAL')
         AND NOT EXISTS (SELECT 1 FROM goals.goal_movement r WHERE r.reverses_id = m.id)
       ORDER BY m.recorded_at, m.id`.execute(db());
    return rows.map(toMovement);
  }

  async isReversed(workspaceId: string, movementId: string): Promise<boolean> {
    const { rows } = await sql<{ x: number }>`
      SELECT 1 AS x FROM goals.goal_movement WHERE workspace_id = ${workspaceId} AND reverses_id = ${movementId} LIMIT 1`.execute(
      db(),
    );
    return rows.length > 0;
  }

  async flows(
    workspaceId: string,
    filter: {
      readonly goalIds?: readonly string[];
      readonly from: string;
      readonly to: string;
      readonly includeReassignments: boolean;
    },
  ): Promise<readonly FlowRow[]> {
    const goalIds = filter.goalIds ? [...filter.goalIds] : null;
    const { rows } = await sql<{
      goal_id: string;
      occurred_on: string;
      currency: string;
      scale: number;
      amount: string;
    }>`
      SELECT m.goal_id, ${D('m.occurred_on')} AS occurred_on, m.currency, c.scale, SUM(m.amount)::text AS amount
        FROM ${FROM_MOVEMENT}
       WHERE m.workspace_id = ${workspaceId}
         AND (${goalIds}::uuid[] IS NULL OR m.goal_id = ANY(${goalIds}::uuid[]))
         AND m.occurred_on BETWEEN ${filter.from}::date AND ${filter.to}::date
         AND (${filter.includeReassignments} OR m.movement NOT IN ('REASSIGN_IN', 'REASSIGN_OUT'))
       GROUP BY m.goal_id, m.occurred_on, m.currency, c.scale
       ORDER BY m.goal_id, m.occurred_on, m.currency`.execute(db());
    return rows.map((r) => ({
      goalId: r.goal_id,
      date: r.occurred_on,
      currency: r.currency,
      amount: fixed(r.amount, Number(r.scale)),
    }));
  }

  async accountsWithMovements(workspaceId: string): Promise<readonly string[]> {
    const { rows } = await sql<{ account_id: string }>`
      SELECT DISTINCT account_id FROM goals.goal_movement WHERE workspace_id = ${workspaceId} ORDER BY account_id`.execute(
      db(),
    );
    return rows.map((r) => r.account_id);
  }

  async withdrawnFromTransaction(workspaceId: string, transactionId: string): Promise<string> {
    const { rows } = await sql<{ total: string | null }>`
      SELECT COALESCE(SUM(-m.amount), 0)::text AS total FROM goals.goal_movement m
       WHERE m.workspace_id = ${workspaceId} AND m.transaction_id = ${transactionId}
         AND m.fund = 'REAL' AND m.movement = 'WITHDRAWAL'
         AND NOT EXISTS (SELECT 1 FROM goals.goal_movement r WHERE r.reverses_id = m.id)`.execute(db());
    return rows[0]?.total ?? '0';
  }
}

// ───────────────────────────────────────────────────────────── plan

interface PlanDbRow {
  goal_id: string;
  monthly_amount: string;
  currency: string;
  scale: number;
  fund: PlanRecord['fund'];
  source_account_id: string | null;
  destination_account_id: string | null;
  day_of_month: number | null;
  automation: PlanRecord['automation'];
  materialization_mode: PlanRecord['materializationMode'];
  auto_create_status: PlanRecord['autoCreateStatus'];
  definition_id: string | null;
  version: number;
}

const toPlan = (r: PlanDbRow): PlanRecord => ({
  goalId: r.goal_id,
  monthlyAmount: fixed(r.monthly_amount, Number(r.scale)),
  currency: r.currency,
  fund: r.fund,
  sourceAccountId: r.source_account_id,
  destinationAccountId: r.destination_account_id,
  dayOfMonth: r.day_of_month === null ? null : Number(r.day_of_month),
  automation: r.automation,
  materializationMode: r.materialization_mode,
  autoCreateStatus: r.auto_create_status,
  definitionId: r.definition_id,
  version: Number(r.version),
});

const PLAN_SELECT = sql`
  SELECT p.goal_id, p.monthly_amount, p.currency, c.scale, p.fund, p.source_account_id, p.destination_account_id,
         p.day_of_month, p.automation, p.materialization_mode, p.auto_create_status, p.definition_id, p.version
    FROM goals.goal_plan p JOIN fx.currency c ON c.code = p.currency`;

export class PgPlanRepository implements PlanRepository {
  async get(workspaceId: string, goalId: string): Promise<PlanRecord | null> {
    const { rows } = await sql<PlanDbRow>`
      ${PLAN_SELECT} WHERE p.workspace_id = ${workspaceId} AND p.goal_id = ${goalId}`.execute(db());
    return rows[0] ? toPlan(rows[0]) : null;
  }

  async getMany(workspaceId: string, goalIds: readonly string[]): Promise<readonly PlanRecord[]> {
    if (goalIds.length === 0) return [];
    const { rows } = await sql<PlanDbRow>`
      ${PLAN_SELECT} WHERE p.workspace_id = ${workspaceId} AND p.goal_id = ANY(${[...goalIds]}::uuid[])`.execute(
      db(),
    );
    return rows.map(toPlan);
  }

  async upsert(workspaceId: string, p: PlanRecord): Promise<void> {
    await sql`
      INSERT INTO goals.goal_plan (
        goal_id, workspace_id, monthly_amount, currency, fund, source_account_id, destination_account_id,
        day_of_month, automation, materialization_mode, auto_create_status, definition_id, version, updated_at)
      VALUES (
        ${p.goalId}, ${workspaceId}, ${p.monthlyAmount}, ${p.currency}, ${p.fund}, ${p.sourceAccountId},
        ${p.destinationAccountId}, ${p.dayOfMonth}, ${p.automation}, ${p.materializationMode},
        ${p.autoCreateStatus}, ${p.definitionId}, ${p.version}, now())
      ON CONFLICT (goal_id) DO UPDATE SET
        monthly_amount = EXCLUDED.monthly_amount, currency = EXCLUDED.currency, fund = EXCLUDED.fund,
        source_account_id = EXCLUDED.source_account_id, destination_account_id = EXCLUDED.destination_account_id,
        day_of_month = EXCLUDED.day_of_month, automation = EXCLUDED.automation,
        materialization_mode = EXCLUDED.materialization_mode, auto_create_status = EXCLUDED.auto_create_status,
        definition_id = EXCLUDED.definition_id, version = EXCLUDED.version, updated_at = now()`.execute(db());
  }

  async remove(workspaceId: string, goalId: string): Promise<void> {
    await sql`DELETE FROM goals.goal_plan WHERE workspace_id = ${workspaceId} AND goal_id = ${goalId}`.execute(
      db(),
    );
  }

  async findByDefinition(workspaceId: string, definitionId: string): Promise<PlanRecord | null> {
    const { rows } = await sql<PlanDbRow>`
      ${PLAN_SELECT} WHERE p.workspace_id = ${workspaceId} AND p.definition_id = ${definitionId}`.execute(
      db(),
    );
    return rows[0] ? toPlan(rows[0]) : null;
  }
}

// ───────────────────────────────────────────────────────────── estado de reservas por cuenta

interface StateDbRow {
  account_id: string;
  state: ReservationStateRecord['state'];
  episode_id: string | null;
  since: string | null;
  shortfall: string | null;
  currency: string | null;
  scale: number | null;
  version: number;
}

const toState = (r: StateDbRow): ReservationStateRecord => ({
  accountId: r.account_id,
  state: r.state,
  episodeId: r.episode_id,
  since: r.since,
  shortfall: r.shortfall === null ? null : fixed(r.shortfall, Number(r.scale ?? 2)),
  currency: r.currency,
  version: Number(r.version),
});

const STATE_SELECT = sql`
  SELECT s.account_id, s.state, s.episode_id, ${D('s.since')} AS since, s.shortfall, s.currency, c.scale, s.version
    FROM goals.account_reservation_state s LEFT JOIN fx.currency c ON c.code = s.currency`;

export class PgReservationStateRepository implements ReservationStateRepository {
  async lock(workspaceId: string, accountId: string): Promise<ReservationStateRecord> {
    await sql`
      INSERT INTO goals.account_reservation_state (workspace_id, account_id)
      VALUES (${workspaceId}, ${accountId}) ON CONFLICT DO NOTHING`.execute(db());
    const { rows } = await sql<StateDbRow>`
      ${STATE_SELECT} WHERE s.workspace_id = ${workspaceId} AND s.account_id = ${accountId} FOR UPDATE OF s`.execute(
      db(),
    );
    return toState(rows[0] as StateDbRow);
  }

  async save(workspaceId: string, s: ReservationStateRecord, evaluatedAt: string): Promise<void> {
    await sql`
      UPDATE goals.account_reservation_state SET
        state = ${s.state}, episode_id = ${s.episodeId}, since = ${s.since}::date, shortfall = ${s.shortfall},
        currency = ${s.currency}, evaluated_at = ${evaluatedAt}::timestamptz, version = ${s.version}
       WHERE workspace_id = ${workspaceId} AND account_id = ${s.accountId}`.execute(db());
  }

  async overAllocated(workspaceId: string): Promise<readonly ReservationStateRecord[]> {
    const { rows } = await sql<StateDbRow>`
      ${STATE_SELECT} WHERE s.workspace_id = ${workspaceId} AND s.state = 'OVER_ALLOCATED'`.execute(db());
    return rows.map(toState);
  }

  async states(
    workspaceId: string,
    accountIds?: readonly string[],
  ): Promise<readonly ReservationStateRecord[]> {
    const ids = accountIds ? [...accountIds] : null;
    const { rows } = await sql<StateDbRow>`
      ${STATE_SELECT} WHERE s.workspace_id = ${workspaceId}
        AND (${ids}::uuid[] IS NULL OR s.account_id = ANY(${ids}::uuid[]))`.execute(db());
    return rows.map(toState);
  }
}

// ───────────────────────────────────────────────────────────── aportes recurrentes en espera

export class PgMaterializationRepository implements MaterializationRepository {
  async find(workspaceId: string, transactionId: string): Promise<MaterializationRecord | null> {
    const { rows } = await sql<{
      transaction_id: string;
      goal_id: string;
      definition_id: string;
      occurrence_id: string;
      status: MaterializationRecord['status'];
    }>`
      SELECT transaction_id, goal_id, definition_id, occurrence_id, status FROM goals.recurring_materialization
       WHERE workspace_id = ${workspaceId} AND transaction_id = ${transactionId}`.execute(db());
    const r = rows[0];
    return r
      ? {
          transactionId: r.transaction_id,
          goalId: r.goal_id,
          definitionId: r.definition_id,
          occurrenceId: r.occurrence_id,
          status: r.status,
        }
      : null;
  }

  async upsert(workspaceId: string, r: MaterializationRecord, at: string): Promise<void> {
    await sql`
      INSERT INTO goals.recurring_materialization
        (workspace_id, transaction_id, goal_id, definition_id, occurrence_id, status, created_at, updated_at)
      VALUES (${workspaceId}, ${r.transactionId}, ${r.goalId}, ${r.definitionId}, ${r.occurrenceId}, ${r.status},
              ${at}::timestamptz, ${at}::timestamptz)
      ON CONFLICT (workspace_id, transaction_id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`.execute(
      db(),
    );
  }

  async setStatus(
    workspaceId: string,
    transactionId: string,
    status: MaterializationRecord['status'],
    at: string,
  ): Promise<void> {
    await sql`
      UPDATE goals.recurring_materialization SET status = ${status}, updated_at = ${at}::timestamptz
       WHERE workspace_id = ${workspaceId} AND transaction_id = ${transactionId}`.execute(db());
  }

  async waitingForGoal(workspaceId: string, goalId: string): Promise<number> {
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM goals.recurring_materialization
       WHERE workspace_id = ${workspaceId} AND goal_id = ${goalId} AND status = 'WAITING'`.execute(db());
    return Number(rows[0]?.n ?? 0);
  }
}

// ───────────────────────────────────────────────────────────── sugerencias

interface SuggestionDbRow {
  id: string;
  transaction_id: string;
  transaction_revision: number;
  account_id: string;
  amount: string;
  currency: string;
  scale: number;
  goal_id: string | null;
  status: SuggestionStatus;
  business_date: string;
  decided_at: string | null;
  decided_by: string | null;
  movement_id: string | null;
  created_at: string;
}

const SUGGESTION_SELECT = sql`
  SELECT s.id, s.transaction_id, s.transaction_revision, s.account_id, s.amount, s.currency, c.scale, s.goal_id,
         s.status, ${D('s.business_date')} AS business_date, ${ISO('s.decided_at')} AS decided_at, s.decided_by,
         s.movement_id, ${ISO('s.created_at')} AS created_at
    FROM goals.contribution_suggestion s JOIN fx.currency c ON c.code = s.currency`;

const toSuggestion = (r: SuggestionDbRow): SuggestionRecord => ({
  id: r.id,
  transactionId: r.transaction_id,
  transactionRevision: Number(r.transaction_revision),
  accountId: r.account_id,
  amount: Money.parse(fixed(r.amount, Number(r.scale)), makeCurrency(r.currency, Number(r.scale))),
  goalId: r.goal_id,
  status: r.status,
  businessDate: r.business_date,
  decidedAt: r.decided_at,
  decidedBy: r.decided_by,
  movementId: r.movement_id,
  createdAt: r.created_at,
});

export class PgSuggestionRepository implements SuggestionRepository {
  async insertIfAbsent(workspaceId: string, s: SuggestionRecord): Promise<boolean> {
    const result = await sql`
      INSERT INTO goals.contribution_suggestion (
        id, workspace_id, transaction_id, transaction_revision, account_id, amount, currency, goal_id, status,
        business_date, created_at)
      VALUES (${s.id}, ${workspaceId}, ${s.transactionId}, ${s.transactionRevision}, ${s.accountId},
              ${s.amount.toFixed()}, ${s.amount.currency.code}, ${s.goalId}, ${s.status}, ${s.businessDate}::date,
              ${s.createdAt}::timestamptz)
      ON CONFLICT (workspace_id, transaction_id, transaction_revision) DO NOTHING`.execute(db());
    return Number(result.numAffectedRows ?? 0) === 1;
  }

  async find(
    workspaceId: string,
    id: string,
    options?: { lock?: 'update' },
  ): Promise<SuggestionRecord | null> {
    const lock = options?.lock === 'update' ? sql`FOR UPDATE OF s` : sql``;
    const { rows } = await sql<SuggestionDbRow>`
      ${SUGGESTION_SELECT} WHERE s.workspace_id = ${workspaceId} AND s.id = ${id} ${lock}`.execute(db());
    return rows[0] ? toSuggestion(rows[0]) : null;
  }

  async list(workspaceId: string, status?: SuggestionStatus): Promise<readonly SuggestionRecord[]> {
    const { rows } = await sql<SuggestionDbRow>`
      ${SUGGESTION_SELECT} WHERE s.workspace_id = ${workspaceId}
        AND (${status ?? null}::text IS NULL OR s.status = ${status ?? null})
       ORDER BY s.created_at DESC, s.id DESC LIMIT 200`.execute(db());
    return rows.map(toSuggestion);
  }

  async pendingCount(workspaceId: string): Promise<number> {
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM goals.contribution_suggestion
       WHERE workspace_id = ${workspaceId} AND status = 'PENDING'`.execute(db());
    return Number(rows[0]?.n ?? 0);
  }

  async decide(
    workspaceId: string,
    id: string,
    input: { status: 'CONFIRMED' | 'DISMISSED'; at: string; by: string; movementId: string | null },
  ): Promise<void> {
    await sql`
      UPDATE goals.contribution_suggestion
         SET status = ${input.status}, decided_at = ${input.at}::timestamptz, decided_by = ${input.by},
             movement_id = ${input.movementId}
       WHERE workspace_id = ${workspaceId} AND id = ${id}`.execute(db());
  }

  async expireForTransaction(workspaceId: string, transactionId: string): Promise<number> {
    const result = await sql`
      UPDATE goals.contribution_suggestion SET status = 'EXPIRED'
       WHERE workspace_id = ${workspaceId} AND transaction_id = ${transactionId} AND status = 'PENDING'`.execute(
      db(),
    );
    return Number(result.numAffectedRows ?? 0);
  }
}
