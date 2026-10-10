import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { DomainError, Money, currency, type Currency, type Clock } from '@pf/shared-kernel';
import { sql, type Generated, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type {
  AuditPort,
  CurrencyCatalogPort,
  DemoProgress,
  DemoPurgePort,
  DemoRun,
  DemoRunPatch,
  DemoRunRepository,
  IdGenerator,
  IdentityDeps,
  MembershipReader,
  OutboxPort,
  UnitOfWork,
  UserRepository,
  VerifiedIdentity,
  WorkspaceDefaults,
  WorkspacePageRequest,
  WorkspaceRepository,
  WorkspaceSummary,
  WorkspaceCreatedHook,
} from '../application/ports/index.js';
import { LocaleTag } from '../domain/locale-tag.js';
import { isRole, type Role } from '../domain/role.js';
import { TimeZoneId } from '../domain/time-zone.js';
import { User, type UserStatus } from '../domain/user.js';
import { Workspace, type DemoStatus, type Membership, type WorkspaceStatus } from '../domain/workspace.js';

/**
 * Adaptadores PostgreSQL de IDENTITY con Kysely (ADR-0007) sobre la conexión de la `PgUnitOfWork` en curso
 * (`unitOfWorkKysely`: mismo client y transacción, contexto RLS fijado con `set_config(..., true)`). Los montos
 * viajan como string (NUMERIC → string), nunca como `number`.
 */
type Numeric = string;

interface IamUserTable {
  id: string;
  idp_issuer: string;
  idp_subject: string;
  email: string;
  display_name: string;
  locale: string;
  time_zone: string | null;
  status: UserStatus;
  version: number;
  preferences: Record<string, unknown>;
  updated_at: Generated<Date>;
}

interface IamWorkspaceTable {
  id: string;
  name: string;
  base_currency: string;
  time_zone: string;
  locale: string;
  fiscal_month_start_day: number;
  min_liquidity_reserve_amount: Numeric | null;
  min_liquidity_reserve_currency: string | null;
  personal_of_user_id: string | null;
  status: WorkspaceStatus;
  version: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  archived_at: Date | null;
  is_demo: Generated<boolean>;
  demo_status: DemoStatus | null;
  demo_origin_workspace_id: string | null;
  demo_requested_by: string | null;
  demo_dataset_version: string | null;
}

interface DemoWorkspaceRunTable {
  workspace_id: string;
  origin_workspace_id: string;
  requested_by: string;
  dataset_version: string;
  anchor_date: string;
  requested_at: string;
  loaded_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  progress: DemoProgress;
  cleanup_requested_at: string | null;
  purged_at: string | null;
  rows_deleted: Record<string, number> | null;
}

interface IamMembershipTable {
  workspace_id: string;
  user_id: string;
  role: string;
  status: Membership['status'];
  joined_at: Generated<Date>;
  revoked_at: Date | null;
}

interface FxCurrencyTable {
  code: string;
  scale: number;
  is_active: boolean;
}

/** Subconjunto tipado del esquema que usa IDENTITY (sin codegen todavía; NUMERIC → string, ADR-0007). */
export interface IdentityDb {
  'iam.user': IamUserTable;
  'iam.workspace': IamWorkspaceTable;
  'iam.workspace_membership': IamMembershipTable;
  'fx.currency': FxCurrencyTable;
  'platform.demo_workspace_run': DemoWorkspaceRunTable;
}

const db = (): Kysely<IdentityDb> => unitOfWorkKysely<IdentityDb>();
const now = sql<Date>`now()`;

/** Locale de respaldo al rehidratar un locale guardado no soportado (`APP_DEFAULT_LOCALE`). */
export const DEFAULT_FALLBACK_LOCALE = 'es-BO';

export class PgUserRepository implements UserRepository {
  constructor(private readonly fallbackLocale: string = DEFAULT_FALLBACK_LOCALE) {}

  async provision(identity: VerifiedIdentity): Promise<string> {
    const { rows } = await sql<{
      id: string;
    }>`SELECT iam.provision_user(${identity.issuer}, ${identity.subject},
      ${identity.email}, ${identity.displayName}) AS id`.execute(db());
    const row = rows[0];
    if (!row) throw new Error('iam.provision_user no devolvió id');
    return row.id;
  }

  async findById(id: string): Promise<User | null> {
    const r = await db()
      .selectFrom('iam.user')
      .select([
        'id',
        'idp_issuer',
        'idp_subject',
        'email',
        'display_name',
        'locale',
        'time_zone',
        'status',
        'version',
        'preferences',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) return null;
    return User.restore({
      id: r.id,
      idpIssuer: r.idp_issuer,
      idpSubject: r.idp_subject,
      email: r.email,
      displayName: r.display_name,
      locale: LocaleTag.fromStored(r.locale, this.fallbackLocale),
      timeZone: r.time_zone === null ? null : TimeZoneId.of(r.time_zone),
      status: r.status,
      version: r.version,
      preferences: r.preferences ?? {},
    });
  }

  async savePreferences(user: User, expectedVersion: number): Promise<boolean> {
    const res = await db()
      .updateTable('iam.user')
      .set({
        display_name: user.displayName,
        locale: user.locale.value,
        time_zone: user.timeZone?.value ?? null,
        preferences: sql<Record<string, unknown>>`${JSON.stringify(user.preferences)}::jsonb`,
        version: user.version,
        updated_at: now,
      })
      .where('id', '=', user.id)
      .where('version', '=', expectedVersion)
      .executeTakeFirst();
    return res.numUpdatedRows === 1n;
  }
}

export class PgWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly fallbackLocale: string = DEFAULT_FALLBACK_LOCALE) {}

  async lockProvisioning(userId: string): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'iam.provision:' + userId}, 0))`.execute(db());
  }

  async countActiveMemberships(userId: string): Promise<number> {
    const r = await db()
      .selectFrom('iam.workspace_membership')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('user_id', '=', userId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    return r?.n ?? 0;
  }

  async insert(ws: Workspace): Promise<void> {
    const s = ws.settings;
    // Sin RETURNING: la política SELECT exige la membresía, que se inserta a continuación.
    await db()
      .insertInto('iam.workspace')
      .values({
        id: ws.id,
        name: s.name,
        base_currency: s.baseCurrency.code,
        time_zone: s.timeZone.value,
        locale: s.locale.value,
        fiscal_month_start_day: s.fiscalMonthStartDay,
        min_liquidity_reserve_amount: s.minimumLiquidityReserve?.toFixed() ?? null,
        min_liquidity_reserve_currency: s.minimumLiquidityReserve?.currency.code ?? null,
        personal_of_user_id: ws.personalOfUserId,
        status: ws.status,
        version: ws.version,
        ...(ws.demo
          ? {
              is_demo: true,
              demo_status: ws.demo.status,
              demo_origin_workspace_id: ws.demo.originWorkspaceId,
              demo_requested_by: ws.demo.requestedBy,
              demo_dataset_version: ws.demo.datasetVersion,
            }
          : {}),
      })
      .execute()
      .catch((err: unknown) => {
        // FR-IDENTITY-016: el índice único parcial respalda el chequeo de aplicación ante carreras.
        if ((err as { constraint?: string }).constraint === 'workspace_demo_active_per_user_uq') {
          throw new DomainError('DEMO_WORKSPACE_ALREADY_EXISTS', 'the user already has a demo workspace');
        }
        throw err;
      });
    for (const m of ws.memberships) {
      await db()
        .insertInto('iam.workspace_membership')
        .values({
          workspace_id: ws.id,
          user_id: m.userId,
          role: m.role,
          status: m.status,
          revoked_at: m.status === 'REVOKED' ? now : null,
        })
        .execute();
    }
  }

  async findById(id: string): Promise<Workspace | null> {
    const r = await db()
      .selectFrom('iam.workspace as w')
      .innerJoin('fx.currency as bc', 'bc.code', 'w.base_currency')
      .leftJoin('fx.currency as rc', 'rc.code', 'w.min_liquidity_reserve_currency')
      .select([
        'w.id',
        'w.name',
        'w.base_currency',
        'bc.scale as base_scale',
        'w.time_zone',
        'w.locale',
        'w.fiscal_month_start_day',
        'w.min_liquidity_reserve_amount as reserve_amount',
        'w.min_liquidity_reserve_currency as reserve_currency',
        'rc.scale as reserve_scale',
        'w.personal_of_user_id',
        'w.status',
        'w.version',
        'w.created_at',
        'w.is_demo',
        'w.demo_status',
        'w.demo_origin_workspace_id',
        'w.demo_requested_by',
        'w.demo_dataset_version',
      ])
      .where('w.id', '=', id)
      .executeTakeFirst();
    if (!r) return null;
    const members = await db()
      .selectFrom('iam.workspace_membership')
      .select(['user_id', 'role', 'status'])
      .where('workspace_id', '=', id)
      .orderBy('joined_at')
      .orderBy('user_id')
      .execute();
    return Workspace.restore({
      id: r.id,
      settings: {
        name: r.name,
        baseCurrency: currency(r.base_currency, r.base_scale),
        timeZone: TimeZoneId.of(r.time_zone),
        locale: LocaleTag.fromStored(r.locale, this.fallbackLocale),
        fiscalMonthStartDay: r.fiscal_month_start_day,
        minimumLiquidityReserve:
          r.reserve_amount === null || r.reserve_currency === null || r.reserve_scale === null
            ? null
            : Money.parse(r.reserve_amount, currency(r.reserve_currency, r.reserve_scale)),
      },
      memberships: members.map((m) => ({ userId: m.user_id, role: toRole(m.role), status: m.status })),
      personalOfUserId: r.personal_of_user_id,
      status: r.status,
      demo:
        r.is_demo &&
        r.demo_status &&
        r.demo_origin_workspace_id &&
        r.demo_requested_by &&
        r.demo_dataset_version
          ? {
              status: r.demo_status,
              originWorkspaceId: r.demo_origin_workspace_id,
              requestedBy: r.demo_requested_by,
              datasetVersion: r.demo_dataset_version,
            }
          : null,
      version: r.version,
      createdAt: r.created_at.toISOString(),
    });
  }

  async update(ws: Workspace, expectedVersion: number): Promise<boolean> {
    const s = ws.settings;
    const res = await db()
      .updateTable('iam.workspace')
      .set({
        name: s.name,
        base_currency: s.baseCurrency.code,
        time_zone: s.timeZone.value,
        locale: s.locale.value,
        fiscal_month_start_day: s.fiscalMonthStartDay,
        min_liquidity_reserve_amount: s.minimumLiquidityReserve?.toFixed() ?? null,
        min_liquidity_reserve_currency: s.minimumLiquidityReserve?.currency.code ?? null,
        status: ws.status,
        ...(ws.demo ? { demo_status: ws.demo.status } : {}),
        ...(ws.isRetired ? { archived_at: sql<Date>`coalesce(archived_at, now())` } : {}),
        version: ws.version,
        updated_at: now,
      })
      .where('id', '=', ws.id)
      .where('version', '=', expectedVersion)
      .executeTakeFirst();
    return res.numUpdatedRows === 1n;
  }

  async listForUser(userId: string, page?: WorkspacePageRequest): Promise<readonly WorkspaceSummary[]> {
    let q = db()
      .selectFrom('iam.workspace_membership as m')
      .innerJoin('iam.workspace as w', 'w.id', 'm.workspace_id')
      .select(['w.id', 'w.name', 'm.role', 'w.base_currency', 'w.is_demo'])
      .where('m.user_id', '=', userId)
      .where('m.status', '=', 'ACTIVE')
      .where('w.status', 'not in', ['ARCHIVED', 'PURGED'])
      .orderBy('w.id');
    if (page?.afterId !== undefined) q = q.where('w.id', '>', page.afterId);
    if (page?.limit !== undefined) q = q.limit(page.limit);
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: toRole(r.role),
      baseCurrency: r.base_currency,
      isDemo: r.is_demo,
    }));
  }

  async lockDemoRequests(userId: string): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'iam.demo:' + userId}, 0))`.execute(db());
  }

  async findActiveDemoFor(userId: string): Promise<Workspace | null> {
    const r = await db()
      .selectFrom('iam.workspace')
      .select('id')
      .where('demo_requested_by', '=', userId)
      .where('is_demo', '=', true)
      .where('demo_status', 'in', ['LOADING', 'READY', 'FAILED', 'CLEANING'])
      .executeTakeFirst();
    return r ? this.findById(r.id) : null;
  }
}

export class PgMembershipReader implements MembershipReader {
  async activeRole(userId: string, workspaceId: string): Promise<Role | null> {
    return this.roleIn(userId, workspaceId, false);
  }

  async retiredRole(userId: string, workspaceId: string): Promise<Role | null> {
    return this.roleIn(userId, workspaceId, true);
  }

  /** Membresía activa del usuario; `retired` elige workspaces demo archivados/purgados o el resto (add-demo-data). */
  private async roleIn(userId: string, workspaceId: string, retired: boolean): Promise<Role | null> {
    const r = await db()
      .selectFrom('iam.workspace_membership as m')
      .innerJoin('iam.workspace as w', 'w.id', 'm.workspace_id')
      .select('m.role')
      .where('m.user_id', '=', userId)
      .where('m.workspace_id', '=', workspaceId)
      .where('m.status', '=', 'ACTIVE')
      .where('w.status', retired ? 'in' : 'not in', ['ARCHIVED', 'PURGED'])
      .executeTakeFirst();
    return r ? toRole(r.role) : null;
  }
}

const iso = (v: string | Date | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/** `platform.demo_workspace_run` (RLS: solo las filas pedidas por el usuario en contexto). */
export class PgDemoRunRepository implements DemoRunRepository {
  async insert(run: DemoRun): Promise<void> {
    await db()
      .insertInto('platform.demo_workspace_run')
      .values({
        workspace_id: run.workspaceId,
        origin_workspace_id: run.originWorkspaceId,
        requested_by: run.requestedBy,
        dataset_version: run.datasetVersion,
        anchor_date: run.anchorDate,
        requested_at: run.requestedAt,
        progress: sql<DemoProgress>`${JSON.stringify(run.progress)}::jsonb`,
      })
      .execute();
  }

  async find(workspaceId: string): Promise<DemoRun | null> {
    const r = await this.select().where('workspace_id', '=', workspaceId).executeTakeFirst();
    return r ? toRun(r) : null;
  }

  async latestForOrigin(originWorkspaceId: string, userId: string): Promise<DemoRun | null> {
    const r = await this.select()
      .where('origin_workspace_id', '=', originWorkspaceId)
      .where('requested_by', '=', userId)
      .orderBy('requested_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return r ? toRun(r) : null;
  }

  async update(workspaceId: string, patch: DemoRunPatch): Promise<void> {
    await db()
      .updateTable('platform.demo_workspace_run')
      .set({
        ...(patch.progress ? { progress: sql<DemoProgress>`${JSON.stringify(patch.progress)}::jsonb` } : {}),
        ...(patch.loadedAt !== undefined ? { loaded_at: patch.loadedAt } : {}),
        ...(patch.failedAt !== undefined ? { failed_at: patch.failedAt } : {}),
        ...(patch.errorCode !== undefined ? { error_code: patch.errorCode } : {}),
        ...(patch.cleanupRequestedAt !== undefined ? { cleanup_requested_at: patch.cleanupRequestedAt } : {}),
      })
      .where('workspace_id', '=', workspaceId)
      .execute();
  }

  private select() {
    return db()
      .selectFrom('platform.demo_workspace_run')
      .select([
        'workspace_id',
        'origin_workspace_id',
        'requested_by',
        'dataset_version',
        sql<string>`to_char(anchor_date, 'YYYY-MM-DD')`.as('anchor_date'),
        'requested_at',
        'loaded_at',
        'failed_at',
        'error_code',
        'progress',
        'cleanup_requested_at',
        'purged_at',
        'rows_deleted',
      ]);
  }
}

function toRun(r: DemoWorkspaceRunTable): DemoRun {
  return {
    workspaceId: r.workspace_id,
    originWorkspaceId: r.origin_workspace_id,
    requestedBy: r.requested_by,
    datasetVersion: r.dataset_version,
    anchorDate: r.anchor_date,
    requestedAt: iso(r.requested_at) as string,
    loadedAt: iso(r.loaded_at),
    failedAt: iso(r.failed_at),
    errorCode: r.error_code,
    progress: r.progress,
    cleanupRequestedAt: iso(r.cleanup_requested_at),
    purgedAt: iso(r.purged_at),
    rowsDeleted: r.rows_deleted,
  };
}

/**
 * Purga física acotada: `platform.purge_demo_workspace` (SECURITY DEFINER, EXECUTE solo `pf_worker`; ADR-0026). Se
 * invoca en la transacción de la unidad de trabajo en curso. Los conteos llegan como números JSON enteros.
 */
export const pgDemoPurge: DemoPurgePort = {
  async purge(demoWorkspaceId) {
    const { rows } = await sql<{
      deleted: Record<string, number | string>;
    }>`SELECT platform.purge_demo_workspace(${demoWorkspaceId}) AS deleted`.execute(db());
    const out: Record<string, number> = {};
    for (const [table, n] of Object.entries(rows[0]?.deleted ?? {})) out[table] = Number(n);
    return out;
  },
};

/** Adapter de solo lectura sobre el catálogo sembrado `fx.currency` (hasta que FX publique su contrato). */
export class PgCurrencyCatalog implements CurrencyCatalogPort {
  async find(code: string): Promise<Currency | null> {
    const r = await db()
      .selectFrom('fx.currency')
      .select(['code', 'scale'])
      .where('code', '=', code)
      .where('is_active', '=', true)
      .executeTakeFirst();
    return r ? currency(r.code, r.scale) : null;
  }
}

function toRole(value: string): Role {
  if (!isRole(value)) throw new Error(`rol desconocido en iam.workspace_membership: ${value}`);
  return value;
}

/** UUIDv7 (RFC 9562 §5.7): 48 bits de milisegundos + aleatorio. */
export const uuidV7: IdGenerator = {
  next(): string {
    const hex = Date.now().toString(16).padStart(12, '0');
    const rand = randomUUID().replaceAll('-', '');
    const variant = ((parseInt(rand.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${rand.slice(13, 16)}-${variant}${rand.slice(17, 20)}-${rand.slice(20, 32)}`;
  },
};

/** Composición de los adaptadores PostgreSQL. `outbox`/`audit` los aporta el llamador (ver design.md). */
export function pgIdentityDeps(input: {
  readonly pool: Pool;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  readonly clock: Clock;
  readonly defaults: WorkspaceDefaults;
  readonly onWorkspaceCreated?: WorkspaceCreatedHook;
}): IdentityDeps {
  const uow: UnitOfWork = new PgUnitOfWork(input.pool);
  return {
    uow,
    users: new PgUserRepository(input.defaults.locale),
    workspaces: new PgWorkspaceRepository(input.defaults.locale),
    memberships: new PgMembershipReader(),
    currencies: new PgCurrencyCatalog(),
    outbox: input.outbox,
    audit: input.audit,
    ids: uuidV7,
    clock: input.clock,
    defaults: input.defaults,
    ...(input.onWorkspaceCreated ? { onWorkspaceCreated: input.onWorkspaceCreated } : {}),
  };
}
