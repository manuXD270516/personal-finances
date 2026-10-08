import { currentRequestContext, unitOfWorkKysely } from '@pf/platform/api';
import { DomainError, dec } from '@pf/shared-kernel';
import { sql, type Kysely } from 'kysely';
import type {
  BudgetTemplateRepository,
  TemplateVersionHeader,
  TemplateVersionRef,
} from '../application/ports/index.js';
import {
  BudgetTemplate,
  type BudgetLineKind,
  type BudgetNature,
  type BudgetTemplateState,
  type IncomeBasis,
  type RolloverPolicy,
  type TargetKind,
  type TemplateLine,
  type TemplateStatus,
  type TemplateVersion,
} from '../domain/index.js';

const db = (): Kysely<unknown> => unitOfWorkKysely<unknown>();

const instantText = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const currentUserId = (): string | null => {
  const actor = currentRequestContext()?.actor;
  return actor && actor.type === 'USER' ? actor.userId : null;
};

interface TemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  status: TemplateStatus;
  current_version_no: number;
  version: number;
  created_at: string;
}

interface VersionRow {
  id: string;
  version_no: number;
  based_on_version_no: number | null;
  change_note: string | null;
  created_at: string;
  created_by: string | null;
}

interface LineRow {
  id: string;
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
  thresholds: string[];
  currency: string;
  scale: number;
}

const templateSelect = sql`
  t.id, t.workspace_id, t.name, t.description, t.is_default, t.status, t.current_version_no, t.version,
  ${instantText('t.created_at')} AS created_at
  FROM planning.budget_template t`;

/** Importe a la escala de la moneda de la línea (NUMERIC(38,18) devuelve 18 decimales). */
const atScale = (value: string | null, scale: number): string | null =>
  value === null ? null : dec(value).toFixed(scale);

function toLine(row: LineRow): TemplateLine {
  const scale = Number(row.scale);
  return {
    id: row.id,
    target: { kind: row.target_kind, id: row.target_id },
    nature: row.nature,
    currency: row.currency,
    spec: {
      kind: row.kind,
      planned: atScale(row.planned_amount, scale),
      min: atScale(row.min_amount, scale),
      max: atScale(row.max_amount, scale),
      percent: row.percent === null ? null : dec(row.percent).toFixed(),
      incomeBasis: row.income_basis,
      rolloverPolicy: row.rollover_policy,
      rolloverCap: atScale(row.rollover_cap, scale),
      thresholds: row.thresholds.map((t) => dec(t).toFixed()),
    },
  };
}

async function loadLines(versionId: string): Promise<TemplateLine[]> {
  const { rows } = await sql<LineRow>`
    SELECT l.id, l.target_kind, l.target_id, l.nature, l.kind, l.planned_amount::text, l.min_amount::text,
           l.max_amount::text, l.percent::text, l.income_basis, l.rollover_policy, l.rollover_cap::text,
           l.thresholds::text[] AS thresholds, l.currency, c.scale
      FROM planning.budget_template_line l JOIN fx.currency c ON c.code = l.currency
     WHERE l.template_version_id = ${versionId}::uuid
     ORDER BY l.target_kind, l.target_id`.execute(db());
  return rows.map(toLine);
}

async function loadVersion(
  workspaceId: string,
  templateId: string,
  versionNo: number,
): Promise<TemplateVersion | null> {
  const { rows } = await sql<VersionRow>`
    SELECT id, version_no, based_on_version_no, change_note, ${instantText('created_at')} AS created_at, created_by
      FROM planning.budget_template_version
     WHERE workspace_id = ${workspaceId}::uuid AND template_id = ${templateId}::uuid AND version_no = ${versionNo}`.execute(
    db(),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    versionNo: Number(row.version_no),
    basedOnVersionNo: row.based_on_version_no === null ? null : Number(row.based_on_version_no),
    changeNote: row.change_note,
    createdAt: row.created_at,
    createdBy: row.created_by,
    lines: await loadLines(row.id),
  };
}

async function hydrate(rows: readonly TemplateRow[]): Promise<BudgetTemplate[]> {
  const out: BudgetTemplate[] = [];
  for (const r of rows) {
    const state: BudgetTemplateState = {
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      description: r.description,
      isDefault: r.is_default,
      status: r.status,
      currentVersionNo: Number(r.current_version_no),
      version: Number(r.version),
      createdAt: r.created_at,
    };
    const current = await loadVersion(r.workspace_id, r.id, state.currentVersionNo);
    if (!current) throw new Error(`template ${r.id} has no version ${state.currentVersionNo}`);
    out.push(BudgetTemplate.restore(state, current));
  }
  return out;
}

/** 23505 en el único parcial de nombre activo => `NAME_TAKEN`; otro error se propaga. */
async function translateUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23505' && e.constraint === 'budget_template_active_name_uq') {
      throw new DomainError('NAME_TAKEN', 'an active template already uses this name').at('/name');
    }
    throw err;
  }
}

async function insertVersion(template: BudgetTemplate): Promise<void> {
  const v = template.currentVersion;
  const workspaceId = template.workspaceId;
  await sql`
    INSERT INTO planning.budget_template_version
      (id, workspace_id, template_id, version_no, based_on_version_no, change_note, created_at, created_by)
    VALUES (${v.id}::uuid, ${workspaceId}::uuid, ${template.id}::uuid, ${v.versionNo}, ${v.basedOnVersionNo},
            ${v.changeNote}, ${v.createdAt}::timestamptz, ${v.createdBy}::uuid)`.execute(db());
  for (const l of v.lines) {
    const s = l.spec;
    await sql`
      INSERT INTO planning.budget_template_line
        (id, workspace_id, template_version_id, target_kind, target_id, nature, kind, planned_amount, min_amount,
         max_amount, percent, income_basis, rollover_policy, rollover_cap, thresholds, currency)
      VALUES (${l.id}::uuid, ${workspaceId}::uuid, ${v.id}::uuid, ${l.target.kind}, ${l.target.id}::uuid, ${l.nature},
              ${s.kind}, ${s.planned}::numeric, ${s.min}::numeric, ${s.max}::numeric, ${s.percent}::numeric,
              ${s.incomeBasis}, ${s.rolloverPolicy}, ${s.rolloverCap}::numeric, ${[...s.thresholds]}::numeric[],
              ${l.currency})`.execute(db());
  }
}

/**
 * Repositorio Kysely/SQL de templates, versiones y líneas sobre la unidad de trabajo en curso (RLS WS ya fijado;
 * tarea 4.2): `SELECT … FOR UPDATE`, optimistic locking por `version`, candado consultivo para "predeterminado" y
 * traducción de 23505 a `NAME_TAKEN`. Las versiones y líneas solo se insertan (WS-RO en la BD).
 */
export class PgBudgetTemplateRepository implements BudgetTemplateRepository {
  async lockDefaults(workspaceId: string): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'budget-template-default:' + workspaceId}, 0))`.execute(
      db(),
    );
  }

  async insert(template: BudgetTemplate): Promise<void> {
    const s = template.snapshot;
    const user = currentUserId();
    await translateUnique(async () => {
      await sql`
        INSERT INTO planning.budget_template
          (id, workspace_id, name, description, is_default, status, current_version_no, version, created_at,
           created_by, updated_by)
        VALUES (${s.id}::uuid, ${s.workspaceId}::uuid, ${s.name}, ${s.description}, ${s.isDefault}, ${s.status},
                ${s.currentVersionNo}, ${s.version}, ${s.createdAt}::timestamptz, ${user}::uuid, ${user}::uuid)`.execute(
        db(),
      );
    });
    await insertVersion(template);
  }

  async insertCurrentVersion(template: BudgetTemplate): Promise<void> {
    await insertVersion(template);
  }

  async save(template: BudgetTemplate): Promise<boolean> {
    const s = template.snapshot;
    return translateUnique(async () => {
      const res = await sql`
        UPDATE planning.budget_template
           SET name = ${s.name}, description = ${s.description}, is_default = ${s.isDefault}, status = ${s.status},
               archived_at = CASE WHEN ${s.status} = 'ARCHIVED' THEN COALESCE(archived_at, now()) ELSE NULL END,
               current_version_no = ${s.currentVersionNo}, version = ${s.version}, updated_at = now(),
               updated_by = ${currentUserId()}::uuid
         WHERE workspace_id = ${s.workspaceId}::uuid AND id = ${s.id}::uuid AND version = ${template.persistedVersion}`.execute(
        db(),
      );
      return (res.numAffectedRows ?? 0n) > 0n;
    });
  }

  async findById(
    workspaceId: string,
    id: string,
    options: { readonly lock?: 'update' } = {},
  ): Promise<BudgetTemplate | null> {
    const lock = options.lock === 'update' ? sql`FOR UPDATE OF t` : sql``;
    const { rows } = await sql<TemplateRow>`
      SELECT ${templateSelect}
       WHERE t.workspace_id = ${workspaceId}::uuid AND t.id = ${id}::uuid ${lock}`.execute(db());
    return (await hydrate(rows))[0] ?? null;
  }

  async findActiveByName(workspaceId: string, name: string): Promise<BudgetTemplate | null> {
    const { rows } = await sql<TemplateRow>`
      SELECT ${templateSelect}
       WHERE t.workspace_id = ${workspaceId}::uuid AND t.status = 'ACTIVE'
         AND lower(btrim(t.name)) = lower(btrim(${name}))`.execute(db());
    return (await hydrate(rows))[0] ?? null;
  }

  async findDefault(workspaceId: string): Promise<BudgetTemplate | null> {
    const { rows } = await sql<TemplateRow>`
      SELECT ${templateSelect}
       WHERE t.workspace_id = ${workspaceId}::uuid AND t.is_default AND t.status = 'ACTIVE'`.execute(db());
    return (await hydrate(rows))[0] ?? null;
  }

  async list(workspaceId: string, status?: TemplateStatus): Promise<BudgetTemplate[]> {
    const filter = status ? sql`AND t.status = ${status}` : sql``;
    const { rows } = await sql<TemplateRow>`
      SELECT ${templateSelect}
       WHERE t.workspace_id = ${workspaceId}::uuid ${filter}
       ORDER BY t.is_default DESC, lower(t.name), t.id`.execute(db());
    return hydrate(rows);
  }

  async listVersions(workspaceId: string, templateId: string): Promise<TemplateVersionHeader[]> {
    const { rows } = await sql<VersionRow & { line_count: string }>`
      SELECT v.id, v.version_no, v.based_on_version_no, v.change_note, ${instantText('v.created_at')} AS created_at,
             v.created_by,
             (SELECT count(*) FROM planning.budget_template_line l WHERE l.template_version_id = v.id)::text AS line_count
        FROM planning.budget_template_version v
       WHERE v.workspace_id = ${workspaceId}::uuid AND v.template_id = ${templateId}::uuid
       ORDER BY v.version_no DESC`.execute(db());
    return rows.map((r) => ({
      versionNo: Number(r.version_no),
      basedOnVersionNo: r.based_on_version_no === null ? null : Number(r.based_on_version_no),
      changeNote: r.change_note,
      createdAt: r.created_at,
      createdBy: r.created_by,
      lineCount: Number(r.line_count),
    }));
  }

  findVersion(workspaceId: string, templateId: string, versionNo: number): Promise<TemplateVersion | null> {
    return loadVersion(workspaceId, templateId, versionNo);
  }

  async versionRef(workspaceId: string, versionId: string): Promise<TemplateVersionRef | null> {
    const { rows } = await sql<{ id: string; template_id: string; version_no: number; name: string }>`
      SELECT v.id, v.template_id, v.version_no, t.name
        FROM planning.budget_template_version v
        JOIN planning.budget_template t ON t.workspace_id = v.workspace_id AND t.id = v.template_id
       WHERE v.workspace_id = ${workspaceId}::uuid AND v.id = ${versionId}::uuid`.execute(db());
    const row = rows[0];
    return row
      ? {
          versionId: row.id,
          templateId: row.template_id,
          versionNo: Number(row.version_no),
          templateName: row.name,
        }
      : null;
  }
}
