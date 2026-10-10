import { currentRequestContext, PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { DomainError, dec } from '@pf/shared-kernel';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import type {
  DefinitionFilter,
  DefinitionListRow,
  DefinitionRepository,
  IdGenerator,
  OccurrenceFilter,
  OccurrenceRepository,
  OccurrenceView,
  ResolvedOutflowRow,
  UnitOfWork,
} from '../application/ports/index.js';
import {
  RecurringDefinition,
  RecurringOccurrence,
  type AmountSpec,
  type DefinitionState,
  type DefinitionVersion,
  type ExistingOccurrence,
  type OccurrenceState,
  type OccurrenceStatus,
} from '../domain/index.js';

const db = () => unitOfWorkKysely<Record<string, never>>();

/** Unidad de trabajo de COMMITMENTS: transacción PG con el contexto RLS del workspace; reutiliza la del llamador. */
export class PgCommitmentsUnitOfWork implements UnitOfWork {
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

const iso = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Decimal de la base a la escala canónica de la moneda (`numeric(38,18)` devuelve 18 decimales). */
const canon = (value: string | null, scale: number): string | null =>
  value === null ? null : dec(value).toFixed(scale);

// ───────────────────────────────────────────────────────────── definiciones

interface DefinitionRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  notes: string | null;
  kind: DefinitionState['kind'];
  managed_by: DefinitionState['managedBy'];
  managed_ref: string | null;
  status: DefinitionState['status'];
  current_version_no: number;
  generated_through: string | null;
  end_date: string | null;
  ended_at: string | null;
  version: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

const DEFINITION_COLUMNS = sql`
  d.id, d.workspace_id, d.name, d.description, d.notes, d.kind, d.managed_by, d.managed_ref, d.status,
  d.current_version_no, d.generated_through::text AS generated_through, d.end_date::text AS end_date,
  CASE WHEN d.ended_at IS NULL THEN NULL
       ELSE to_char(d.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS ended_at,
  d.version,
  to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, d.created_by,
  to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at, d.updated_by`;

const toState = (r: DefinitionRow): DefinitionState => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  description: r.description,
  notes: r.notes,
  kind: r.kind,
  managedBy: r.managed_by,
  managedRef: r.managed_ref,
  status: r.status,
  currentVersionNo: Number(r.current_version_no),
  generatedThrough: r.generated_through,
  endDate: r.end_date,
  endedAt: r.ended_at,
  version: Number(r.version),
  createdAt: r.created_at,
  createdBy: r.created_by,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

interface VersionRow {
  definition_id: string;
  version_no: number;
  effective_from: string;
  account_id: string;
  to_account_id: string | null;
  currency: string;
  scale: number;
  amount_type: AmountSpec['type'];
  amount: string | null;
  amount_min: string | null;
  amount_max: string | null;
  category_id: string | null;
  counterparty_id: string | null;
  tag_ids: string[];
  payment_method: DefinitionVersion['paymentMethod'];
  cadence: DefinitionVersion['schedule']['cadence'];
  interval: number;
  month_days: number[];
  rrule: string | null;
  dtstart: string;
  until_date: string | null;
  max_count: number | null;
  weekend_adjustment: DefinitionVersion['schedule']['weekendAdjustment'];
  materialization_mode: DefinitionVersion['materialization']['mode'];
  auto_create_status: DefinitionVersion['materialization']['autoCreateStatus'];
  lead_days: number;
  indexed_amount: string | null;
  indexed_currency: string | null;
  indexed_scale: number | null;
}

const VERSION_COLUMNS = sql`
  v.definition_id, v.version_no, v.effective_from::text AS effective_from, v.account_id, v.to_account_id, v.currency,
  c.scale, v.amount_type, v.amount::text AS amount, v.amount_min::text AS amount_min, v.amount_max::text AS amount_max,
  v.category_id, v.counterparty_id, v.tag_ids::text[] AS tag_ids, v.payment_method, v.cadence, v.interval,
  v.month_days AS month_days, v.rrule, v.dtstart::text AS dtstart, v.until_date::text AS until_date,
  v.max_count, v.weekend_adjustment, v.materialization_mode, v.auto_create_status, v.lead_days,
  v.indexed_amount::text AS indexed_amount, v.indexed_currency, ic.scale AS indexed_scale`;

const toVersion = (r: VersionRow): DefinitionVersion => {
  const scale = Number(r.scale);
  return {
    versionNo: Number(r.version_no),
    effectiveFrom: r.effective_from,
    accountId: r.account_id,
    toAccountId: r.to_account_id,
    currency: r.currency,
    amount: {
      type: r.amount_type,
      amount: canon(r.amount, scale),
      min: canon(r.amount_min, scale),
      max: canon(r.amount_max, scale),
    },
    categoryId: r.category_id,
    counterpartyId: r.counterparty_id,
    tagIds: r.tag_ids ?? [],
    paymentMethod: r.payment_method,
    schedule: {
      cadence: r.cadence,
      interval: Number(r.interval),
      monthDays: (r.month_days ?? []).map(Number),
      rrule: r.rrule,
      startDate: r.dtstart,
      endDate: r.until_date,
      maxOccurrences: r.max_count === null ? null : Number(r.max_count),
      weekendAdjustment: r.weekend_adjustment,
    },
    materialization: {
      mode: r.materialization_mode,
      autoCreateStatus: r.auto_create_status,
      leadDays: Number(r.lead_days),
    },
    ...(r.indexed_amount !== null && r.indexed_currency !== null
      ? {
          indexedPrice: {
            amount: canon(r.indexed_amount, Number(r.indexed_scale)) as string,
            currency: r.indexed_currency,
          },
        }
      : {}),
  };
};

async function insertVersions(
  definition: RecurringDefinition,
  versions: readonly DefinitionVersion[],
): Promise<void> {
  const s = definition.snapshot;
  for (const v of versions) {
    await sql`
      INSERT INTO commitments.recurring_definition_version
        (workspace_id, definition_id, version_no, effective_from, account_id, to_account_id, currency, amount_type,
         amount, amount_min, amount_max, category_id, counterparty_id, tag_ids, payment_method, cadence, interval,
         month_days, rrule, dtstart, until_date, max_count, weekend_adjustment, materialization_mode,
         auto_create_status, lead_days, indexed_amount, indexed_currency, created_by)
      VALUES (${s.workspaceId}, ${s.id}, ${v.versionNo}, ${v.effectiveFrom}::date, ${v.accountId}::uuid,
              ${v.toAccountId}::uuid, ${v.currency}, ${v.amount.type}, ${v.amount.amount}::numeric,
              ${v.amount.min}::numeric, ${v.amount.max}::numeric, ${v.categoryId}::uuid, ${v.counterpartyId}::uuid,
              ${[...v.tagIds]}::uuid[], ${v.paymentMethod}, ${v.schedule.cadence}, ${v.schedule.interval},
              ${JSON.stringify(v.schedule.monthDays)}::jsonb, ${v.schedule.rrule}, ${v.schedule.startDate}::date,
              ${v.schedule.endDate}::date, ${v.schedule.maxOccurrences}, ${v.schedule.weekendAdjustment},
              ${v.materialization.mode}, ${v.materialization.autoCreateStatus}, ${v.materialization.leadDays},
              ${v.indexedPrice?.amount ?? null}::numeric, ${v.indexedPrice?.currency ?? null}, ${s.updatedBy}::uuid)`.execute(
      db(),
    );
  }
}

export class PgDefinitionRepository implements DefinitionRepository {
  async insert(definition: RecurringDefinition): Promise<void> {
    const s = definition.snapshot;
    await sql`
      INSERT INTO commitments.recurring_definition
        (id, workspace_id, name, description, notes, kind, managed_by, managed_ref, status, current_version_no,
         generated_through, end_date, ended_at, version, created_at, created_by, updated_at, updated_by)
      VALUES (${s.id}, ${s.workspaceId}, ${s.name}, ${s.description}, ${s.notes}, ${s.kind}, ${s.managedBy},
              ${s.managedRef}::uuid, ${s.status}, ${s.currentVersionNo}, ${s.generatedThrough}::date,
              ${s.endDate}::date, ${s.endedAt}::timestamptz, ${s.version}, ${s.createdAt}::timestamptz,
              ${s.createdBy}::uuid, ${s.updatedAt}::timestamptz, ${s.updatedBy}::uuid)`.execute(db());
    await insertVersions(definition, definition.addedVersions);
    definition.markPersisted();
  }

  async findById(
    workspaceId: string,
    id: string,
    options: { readonly lock?: 'update' } = {},
  ): Promise<RecurringDefinition | null> {
    const { rows } = await sql<DefinitionRow>`
      SELECT ${DEFINITION_COLUMNS}
        FROM commitments.recurring_definition d
       WHERE d.workspace_id = ${workspaceId} AND d.id = ${id}::uuid
       ${options.lock === 'update' ? sql`FOR UPDATE` : sql``}`.execute(db());
    const row = rows[0];
    if (!row) return null;
    const versions = await this.versionsOf([row.id]);
    return RecurringDefinition.restore(toState(row), versions.get(row.id) ?? []);
  }

  private async versionsOf(ids: readonly string[]): Promise<Map<string, DefinitionVersion[]>> {
    const out = new Map<string, DefinitionVersion[]>();
    if (ids.length === 0) return out;
    const { rows } = await sql<VersionRow>`
      SELECT ${VERSION_COLUMNS}
        FROM commitments.recurring_definition_version v
        JOIN fx.currency c ON c.code = v.currency
        LEFT JOIN fx.currency ic ON ic.code = v.indexed_currency
       WHERE v.definition_id = ANY(${[...ids]}::uuid[])
       ORDER BY v.definition_id, v.version_no`.execute(db());
    for (const r of rows) {
      const list = out.get(r.definition_id) ?? [];
      list.push(toVersion(r));
      out.set(r.definition_id, list);
    }
    return out;
  }

  async save(definition: RecurringDefinition): Promise<boolean> {
    const s = definition.snapshot;
    const res = await sql`
      UPDATE commitments.recurring_definition
         SET name = ${s.name}, description = ${s.description}, notes = ${s.notes}, status = ${s.status},
             current_version_no = ${s.currentVersionNo}, generated_through = ${s.generatedThrough}::date,
             end_date = ${s.endDate}::date, ended_at = ${s.endedAt}::timestamptz, version = ${s.version},
             updated_at = ${s.updatedAt}::timestamptz, updated_by = ${s.updatedBy}::uuid
       WHERE workspace_id = ${s.workspaceId} AND id = ${s.id}::uuid AND version = ${definition.persistedVersion}`.execute(
      db(),
    );
    if (Number(res.numAffectedRows ?? 0) === 0) return false;
    await insertVersions(definition, definition.addedVersions);
    definition.markPersisted();
    return true;
  }

  async list(workspaceId: string, filter: DefinitionFilter): Promise<DefinitionListRow[]> {
    const { rows } = await sql<DefinitionRow>`
      SELECT ${DEFINITION_COLUMNS}
        FROM commitments.recurring_definition d
       WHERE d.workspace_id = ${workspaceId}
         AND (${filter.status ?? null}::text IS NULL OR d.status = ${filter.status ?? null})
         AND (${filter.kind ?? null}::text IS NULL OR d.kind = ${filter.kind ?? null})
         AND (${filter.q ?? null}::text IS NULL OR d.name ILIKE '%' || ${escapeLike(filter.q ?? '')} || '%')
       ORDER BY lower(d.name), d.id`.execute(db());
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const versions = await this.versionsOf(ids);
    const { rows: next } = await sql<{ definition_id: string; occurrence_date: string; due_date: string }>`
      SELECT DISTINCT ON (o.definition_id) o.definition_id, o.occurrence_date::text AS occurrence_date,
             o.due_date::text AS due_date
        FROM commitments.recurring_occurrence o
       WHERE o.workspace_id = ${workspaceId} AND o.definition_id = ANY(${ids}::uuid[])
         AND o.status IN ('SCHEDULED', 'DUE', 'OVERDUE')
       ORDER BY o.definition_id, o.due_date, o.occurrence_date`.execute(db());
    const { rows: pending } = await sql<{ definition_id: string; n: string }>`
      SELECT o.definition_id, count(*)::text AS n
        FROM commitments.recurring_occurrence o
        JOIN commitments.recurring_definition_version v
          ON v.definition_id = o.definition_id AND v.version_no = o.definition_version_no
       WHERE o.workspace_id = ${workspaceId} AND o.definition_id = ANY(${ids}::uuid[])
         AND o.status IN ('DUE', 'OVERDUE') AND v.materialization_mode = 'PENDING_APPROVAL'
       GROUP BY o.definition_id`.execute(db());
    const nextBy = new Map(next.map((n) => [n.definition_id, n]));
    const pendingBy = new Map(pending.map((p) => [p.definition_id, Number(p.n)]));
    return rows.map((r) => {
      const n = nextBy.get(r.id);
      return {
        definition: RecurringDefinition.restore(toState(r), versions.get(r.id) ?? []),
        nextOccurrence: n ? { occurrenceDate: n.occurrence_date, dueDate: n.due_date } : null,
        pendingApprovalCount: pendingBy.get(r.id) ?? 0,
      };
    });
  }

  async idsNeedingWork(workspaceId: string): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      SELECT d.id
        FROM commitments.recurring_definition d
       WHERE d.workspace_id = ${workspaceId}
         AND (d.status = 'ACTIVE'
              OR EXISTS (SELECT 1 FROM commitments.recurring_occurrence o
                          WHERE o.workspace_id = d.workspace_id AND o.definition_id = d.id
                            AND o.status IN ('SCHEDULED', 'DUE')))
       ORDER BY d.id`.execute(db());
    return rows.map((r) => r.id);
  }

  async hasActive(workspaceId: string): Promise<boolean> {
    const { rows } = await sql<{ found: boolean }>`
      SELECT EXISTS (SELECT 1 FROM commitments.recurring_definition
                      WHERE workspace_id = ${workspaceId} AND status = 'ACTIVE') AS found`.execute(db());
    return rows[0]?.found === true;
  }
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

// ───────────────────────────────────────────────────────────── ocurrencias

interface OccurrenceRow {
  id: string;
  workspace_id: string;
  definition_id: string;
  occurrence_date: string;
  due_date: string;
  definition_version_no: number;
  expected_type: AmountSpec['type'];
  expected_amount: string | null;
  expected_min: string | null;
  expected_max: string | null;
  currency: string;
  scale: number;
  amount_overridden: boolean;
  date_overridden: boolean;
  status: OccurrenceStatus;
  cancel_reason: OccurrenceState['cancelReason'];
  transaction_id: string | null;
  resolution: OccurrenceState['resolution'];
  matched_by: OccurrenceState['matchedBy'];
  skip_reason: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  last_auto_create_error: string | null;
  last_auto_create_on: string | null;
  version: number;
  created_at: string;
}

const OCCURRENCE_COLUMNS = sql`
  o.id, o.workspace_id, o.definition_id, o.occurrence_date::text AS occurrence_date, o.due_date::text AS due_date,
  o.definition_version_no, o.expected_type, o.expected_amount::text AS expected_amount,
  o.expected_min::text AS expected_min, o.expected_max::text AS expected_max, o.currency, c.scale,
  o.amount_overridden, o.date_overridden, o.status, o.cancel_reason, o.transaction_id, o.resolution, o.matched_by,
  o.skip_reason,
  CASE WHEN o.resolved_at IS NULL THEN NULL
       ELSE to_char(o.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS resolved_at,
  o.resolved_by, o.last_auto_create_error, o.last_auto_create_on::text AS last_auto_create_on, o.version,
  to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at`;

const toOccurrenceState = (r: OccurrenceRow): OccurrenceState => {
  const scale = Number(r.scale);
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    definitionId: r.definition_id,
    occurrenceDate: r.occurrence_date,
    dueDate: r.due_date,
    definitionVersionNo: Number(r.definition_version_no),
    expected: {
      type: r.expected_type,
      amount: canon(r.expected_amount, scale),
      min: canon(r.expected_min, scale),
      max: canon(r.expected_max, scale),
    },
    currency: r.currency,
    amountOverridden: r.amount_overridden,
    dateOverridden: r.date_overridden,
    status: r.status,
    cancelReason: r.cancel_reason,
    transactionId: r.transaction_id,
    resolution: r.resolution,
    matchedBy: r.matched_by,
    skipReason: r.skip_reason,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
    lastAutoCreateError: r.last_auto_create_error,
    lastAutoCreateOn: r.last_auto_create_on,
    version: Number(r.version),
    createdAt: r.created_at,
  };
};

interface ViewRow extends OccurrenceRow {
  def_name: string;
  def_kind: OccurrenceView['kind'];
  def_managed_by: OccurrenceView['managedBy'];
  v_account_id: string;
  v_to_account_id: string | null;
  v_mode: OccurrenceView['mode'];
  v_lead_days: number;
}

const VIEW_SELECT = sql`
  SELECT ${OCCURRENCE_COLUMNS}, d.name AS def_name, d.kind AS def_kind, d.managed_by AS def_managed_by,
         v.account_id AS v_account_id, v.to_account_id AS v_to_account_id,
         v.materialization_mode AS v_mode, v.lead_days AS v_lead_days
    FROM commitments.recurring_occurrence o
    JOIN fx.currency c ON c.code = o.currency
    JOIN commitments.recurring_definition d ON d.workspace_id = o.workspace_id AND d.id = o.definition_id
    JOIN commitments.recurring_definition_version v
      ON v.definition_id = o.definition_id AND v.version_no = o.definition_version_no`;

const toView = (r: ViewRow): OccurrenceView => ({
  occurrence: toOccurrenceState(r),
  definitionName: r.def_name,
  kind: r.def_kind,
  managedBy: r.def_managed_by,
  accountId: r.v_account_id,
  toAccountId: r.v_to_account_id,
  mode: r.v_mode,
  leadDays: Number(r.v_lead_days),
});

const INSERT_CHUNK = 200;

export class PgOccurrenceRepository implements OccurrenceRepository {
  async insertIfAbsent(occurrences: readonly RecurringOccurrence[]): Promise<RecurringOccurrence[]> {
    const inserted: RecurringOccurrence[] = [];
    for (let i = 0; i < occurrences.length; i += INSERT_CHUNK) {
      const chunk = occurrences.slice(i, i + INSERT_CHUNK);
      const values = chunk.map((o) => {
        const s = o.snapshot;
        return {
          id: s.id,
          workspace_id: s.workspaceId,
          definition_id: s.definitionId,
          occurrence_date: s.occurrenceDate,
          due_date: s.dueDate,
          definition_version_no: s.definitionVersionNo,
          expected_type: s.expected.type,
          expected_amount: s.expected.amount,
          expected_min: s.expected.min,
          expected_max: s.expected.max,
          currency: s.currency,
          amount_overridden: s.amountOverridden,
          date_overridden: s.dateOverridden,
          status: s.status,
          cancel_reason: s.cancelReason,
          transaction_id: s.transactionId,
          resolution: s.resolution,
          matched_by: s.matchedBy,
          skip_reason: s.skipReason,
          resolved_at: s.resolvedAt,
          resolved_by: s.resolvedBy,
          last_auto_create_error: s.lastAutoCreateError,
          last_auto_create_on: s.lastAutoCreateOn,
          version: s.version,
          created_at: s.createdAt,
        };
      });
      const rows = await db()
        .insertInto('commitments.recurring_occurrence' as never)
        .values(values as never)
        .onConflict((oc) => oc.columns(['definition_id', 'occurrence_date'] as never).doNothing())
        .returning('id' as never)
        .execute();
      const ids = new Set((rows as unknown as { id: string }[]).map((r) => r.id));
      for (const o of chunk) {
        if (ids.has(o.id)) {
          o.markPersisted();
          inserted.push(o);
        }
      }
    }
    return inserted;
  }

  async findById(
    workspaceId: string,
    id: string,
    options: { readonly lock?: 'update' } = {},
  ): Promise<RecurringOccurrence | null> {
    const { rows } = await sql<OccurrenceRow>`
      SELECT ${OCCURRENCE_COLUMNS}
        FROM commitments.recurring_occurrence o
        JOIN fx.currency c ON c.code = o.currency
       WHERE o.workspace_id = ${workspaceId} AND o.id = ${id}::uuid
       ${options.lock === 'update' ? sql`FOR UPDATE OF o` : sql``}`.execute(db());
    return rows[0] ? RecurringOccurrence.restore(toOccurrenceState(rows[0])) : null;
  }

  async save(occurrence: RecurringOccurrence): Promise<boolean> {
    const s = occurrence.snapshot;
    try {
      const res = await sql`
        UPDATE commitments.recurring_occurrence
           SET due_date = ${s.dueDate}::date, definition_version_no = ${s.definitionVersionNo},
               expected_type = ${s.expected.type}, expected_amount = ${s.expected.amount}::numeric,
               expected_min = ${s.expected.min}::numeric, expected_max = ${s.expected.max}::numeric,
               currency = ${s.currency}, amount_overridden = ${s.amountOverridden},
               date_overridden = ${s.dateOverridden}, status = ${s.status}, cancel_reason = ${s.cancelReason},
               transaction_id = ${s.transactionId}::uuid, resolution = ${s.resolution}, matched_by = ${s.matchedBy},
               skip_reason = ${s.skipReason}, resolved_at = ${s.resolvedAt}::timestamptz,
               resolved_by = ${s.resolvedBy}::uuid, last_auto_create_error = ${s.lastAutoCreateError},
               last_auto_create_on = ${s.lastAutoCreateOn}::date, version = ${s.version}
         WHERE workspace_id = ${s.workspaceId} AND id = ${s.id}::uuid AND version = ${occurrence.persistedVersion}`.execute(
        db(),
      );
      if (Number(res.numAffectedRows ?? 0) === 0) return false;
      occurrence.markPersisted();
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new DomainError(
          'TRANSACTION_ALREADY_LINKED',
          'the transaction already resolves another occurrence',
        ).at('/transactionId');
      }
      throw err;
    }
  }

  async findByTransaction(workspaceId: string, transactionId: string): Promise<RecurringOccurrence | null> {
    const { rows } = await sql<OccurrenceRow>`
      SELECT ${OCCURRENCE_COLUMNS}
        FROM commitments.recurring_occurrence o
        JOIN fx.currency c ON c.code = o.currency
       WHERE o.workspace_id = ${workspaceId} AND o.transaction_id = ${transactionId}::uuid
         AND o.status IN ('MATERIALIZED', 'MATCHED')`.execute(db());
    return rows[0] ? RecurringOccurrence.restore(toOccurrenceState(rows[0])) : null;
  }

  async listForDefinition(
    workspaceId: string,
    definitionId: string,
    options: { readonly from?: string; readonly statuses?: readonly OccurrenceStatus[] } = {},
  ): Promise<RecurringOccurrence[]> {
    const statuses = options.statuses ? [...options.statuses] : null;
    const { rows } = await sql<OccurrenceRow>`
      SELECT ${OCCURRENCE_COLUMNS}
        FROM commitments.recurring_occurrence o
        JOIN fx.currency c ON c.code = o.currency
       WHERE o.workspace_id = ${workspaceId} AND o.definition_id = ${definitionId}::uuid
         AND (${options.from ?? null}::date IS NULL OR o.occurrence_date >= ${options.from ?? null}::date)
         AND (${statuses}::text[] IS NULL OR o.status = ANY(${statuses}::text[]))
       ORDER BY o.occurrence_date`.execute(db());
    return rows.map((r) => RecurringOccurrence.restore(toOccurrenceState(r)));
  }

  async listExisting(
    workspaceId: string,
    definitionId: string,
    from?: string,
  ): Promise<ExistingOccurrence[]> {
    const { rows } = await sql<{
      id: string;
      occurrence_date: string;
      status: OccurrenceStatus;
      cancel_reason: OccurrenceState['cancelReason'];
      due_date: string;
      amount_overridden: boolean;
      date_overridden: boolean;
    }>`
      SELECT o.id, o.occurrence_date::text AS occurrence_date, o.status, o.cancel_reason,
             o.due_date::text AS due_date, o.amount_overridden, o.date_overridden
        FROM commitments.recurring_occurrence o
       WHERE o.workspace_id = ${workspaceId} AND o.definition_id = ${definitionId}::uuid
         AND (${from ?? null}::date IS NULL OR o.occurrence_date >= ${from ?? null}::date)
       ORDER BY o.occurrence_date`.execute(db());
    return rows.map((r) => ({
      id: r.id,
      occurrenceDate: r.occurrence_date,
      status: r.status,
      cancelReason: r.cancel_reason,
      dueDate: r.due_date,
      amountOverridden: r.amount_overridden,
      dateOverridden: r.date_overridden,
    }));
  }

  async list(workspaceId: string, filter: OccurrenceFilter): Promise<OccurrenceView[]> {
    const statuses = filter.statuses ? [...filter.statuses] : null;
    const after = filter.after ?? null;
    const approval =
      filter.requiresApproval === undefined
        ? sql``
        : filter.requiresApproval
          ? sql`AND o.status IN ('DUE', 'OVERDUE') AND v.materialization_mode = 'PENDING_APPROVAL'`
          : sql`AND NOT (o.status IN ('DUE', 'OVERDUE') AND v.materialization_mode = 'PENDING_APPROVAL')`;
    const { rows } = await sql<ViewRow>`
      ${VIEW_SELECT}
       WHERE o.workspace_id = ${workspaceId}
         AND (${filter.definitionId ?? null}::uuid IS NULL OR o.definition_id = ${filter.definitionId ?? null}::uuid)
         AND (${statuses}::text[] IS NULL OR o.status = ANY(${statuses}::text[]))
         AND (${filter.dueFrom ?? null}::date IS NULL OR o.due_date >= ${filter.dueFrom ?? null}::date)
         AND (${filter.dueTo ?? null}::date IS NULL OR o.due_date <= ${filter.dueTo ?? null}::date)
         AND (${after?.[0] ?? null}::date IS NULL
              OR (o.due_date, o.id) > (${after?.[0] ?? null}::date, ${after?.[1] ?? null}::uuid))
         ${approval}
       ORDER BY o.due_date, o.id
       ${filter.limit ? sql`LIMIT ${filter.limit}` : sql``}`.execute(db());
    return rows.map(toView);
  }

  async findView(workspaceId: string, id: string): Promise<OccurrenceView | null> {
    const { rows } = await sql<ViewRow>`
      ${VIEW_SELECT} WHERE o.workspace_id = ${workspaceId} AND o.id = ${id}::uuid`.execute(db());
    return rows[0] ? toView(rows[0]) : null;
  }

  async listUnresolvedInRange(workspaceId: string, from: string, to: string): Promise<OccurrenceView[]> {
    const { rows } = await sql<ViewRow>`
      ${VIEW_SELECT}
       WHERE o.workspace_id = ${workspaceId} AND o.status IN ('SCHEDULED', 'DUE', 'OVERDUE')
         AND o.due_date BETWEEN ${from}::date AND ${to}::date
       ORDER BY o.due_date, o.id`.execute(db());
    return rows.map(toView);
  }

  async listUnresolvedBefore(workspaceId: string, before: string): Promise<OccurrenceView[]> {
    const { rows } = await sql<ViewRow>`
      ${VIEW_SELECT}
       WHERE o.workspace_id = ${workspaceId} AND o.status IN ('SCHEDULED', 'DUE', 'OVERDUE')
         AND o.due_date < ${before}::date
       ORDER BY o.due_date, o.id`.execute(db());
    return rows.map(toView);
  }

  async listResolvedOutflows(workspaceId: string, from: string, to: string): Promise<ResolvedOutflowRow[]> {
    const { rows } = await sql<{
      id: string;
      definition_id: string;
      name: string;
      created_at: string;
      status: 'MATERIALIZED' | 'MATCHED';
      matched_by: OccurrenceState['matchedBy'];
      transaction_id: string;
      currency: string;
    }>`
      SELECT o.id, o.definition_id, d.name,
             to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
             o.status, o.matched_by, o.transaction_id, o.currency
        FROM commitments.recurring_occurrence o
        JOIN commitments.recurring_definition d ON d.workspace_id = o.workspace_id AND d.id = o.definition_id
       WHERE o.workspace_id = ${workspaceId} AND o.status IN ('MATERIALIZED', 'MATCHED')
         AND d.kind <> 'INCOME' AND o.due_date BETWEEN ${from}::date AND ${to}::date
       ORDER BY o.due_date, o.id`.execute(db());
    return rows.map((r) => ({
      occurrenceId: r.id,
      definitionId: r.definition_id,
      definitionName: r.name,
      generatedAt: r.created_at,
      resolution: r.status,
      matchedBy: r.matched_by,
      transactionId: r.transaction_id,
      currency: r.currency,
    }));
  }

  async lastResolvedNominal(workspaceId: string, definitionId: string): Promise<string | null> {
    const { rows } = await sql<{ d: string | null }>`
      SELECT max(o.occurrence_date)::text AS d
        FROM commitments.recurring_occurrence o
       WHERE o.workspace_id = ${workspaceId} AND o.definition_id = ${definitionId}::uuid
         AND o.status IN ('MATERIALIZED', 'MATCHED', 'SKIPPED')`.execute(db());
    return rows[0]?.d ?? null;
  }
}

export { iso as instantText };
