import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { Money, currency, type Currency, type Clock } from '@pf/shared-kernel';
import { sql, type Generated, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type {
  AuditPort,
  CurrencyCatalogPort,
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
} from '../application/ports/index.js';
import { LocaleTag } from '../domain/locale-tag.js';
import { isRole, type Role } from '../domain/role.js';
import { TimeZoneId } from '../domain/time-zone.js';
import { User, type UserStatus } from '../domain/user.js';
import { Workspace, type Membership, type WorkspaceStatus } from '../domain/workspace.js';

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
}

const db = (): Kysely<IdentityDb> => unitOfWorkKysely<IdentityDb>();
const now = sql<Date>`now()`;

export class PgUserRepository implements UserRepository {
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
      locale: LocaleTag.of(r.locale),
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
      })
      .execute();
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
        locale: LocaleTag.of(r.locale),
        fiscalMonthStartDay: r.fiscal_month_start_day,
        minimumLiquidityReserve:
          r.reserve_amount === null || r.reserve_currency === null || r.reserve_scale === null
            ? null
            : Money.parse(r.reserve_amount, currency(r.reserve_currency, r.reserve_scale)),
      },
      memberships: members.map((m) => ({ userId: m.user_id, role: toRole(m.role), status: m.status })),
      personalOfUserId: r.personal_of_user_id,
      status: r.status,
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
      .select(['w.id', 'w.name', 'm.role', 'w.base_currency'])
      .where('m.user_id', '=', userId)
      .where('m.status', '=', 'ACTIVE')
      .orderBy('w.id');
    if (page?.afterId !== undefined) q = q.where('w.id', '>', page.afterId);
    if (page?.limit !== undefined) q = q.limit(page.limit);
    const rows = await q.execute();
    return rows.map((r) => ({ id: r.id, name: r.name, role: toRole(r.role), baseCurrency: r.base_currency }));
  }
}

export class PgMembershipReader implements MembershipReader {
  async activeRole(userId: string, workspaceId: string): Promise<Role | null> {
    const r = await db()
      .selectFrom('iam.workspace_membership')
      .select('role')
      .where('user_id', '=', userId)
      .where('workspace_id', '=', workspaceId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    return r ? toRole(r.role) : null;
  }
}

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
}): IdentityDeps {
  const uow: UnitOfWork = new PgUnitOfWork(input.pool);
  return {
    uow,
    users: new PgUserRepository(),
    workspaces: new PgWorkspaceRepository(),
    memberships: new PgMembershipReader(),
    currencies: new PgCurrencyCatalog(),
    outbox: input.outbox,
    audit: input.audit,
    ids: uuidV7,
    clock: input.clock,
    defaults: input.defaults,
  };
}
