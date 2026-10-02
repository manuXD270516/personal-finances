import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { Money, currency, type Currency, type Clock } from '@pf/shared-kernel';
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
  WorkspaceRepository,
  WorkspaceSummary,
} from '../application/ports/index.js';
import { LocaleTag } from '../domain/locale-tag.js';
import { isRole, type Role } from '../domain/role.js';
import { TimeZoneId } from '../domain/time-zone.js';
import { User, type UserStatus } from '../domain/user.js';
import { Workspace, type Membership, type WorkspaceStatus } from '../domain/workspace.js';

/**
 * Adaptadores PostgreSQL de IDENTITY sobre la conexión de la `PgUnitOfWork` en curso (contexto RLS fijado por
 * ella). SQL parametrizado; los montos viajan como string (`numeric::text`), nunca como `number`.
 */
const q = async <R>(text: string, values: readonly unknown[] = []): Promise<R[]> =>
  (await requireSqlExecutor().query(text, values)).rows as R[];

interface UserRow {
  id: string;
  idp_issuer: string;
  idp_subject: string;
  email: string;
  display_name: string;
  locale: string;
  time_zone: string | null;
  status: UserStatus;
  version: number;
}

export class PgUserRepository implements UserRepository {
  async provision(identity: VerifiedIdentity): Promise<string> {
    const [row] = await q<{ id: string }>('SELECT iam.provision_user($1, $2, $3, $4) AS id', [
      identity.issuer,
      identity.subject,
      identity.email,
      identity.displayName,
    ]);
    if (!row) throw new Error('iam.provision_user no devolvió id');
    return row.id;
  }

  async findById(id: string): Promise<User | null> {
    const [r] = await q<UserRow>(
      `SELECT id, idp_issuer, idp_subject, email, display_name, locale, time_zone, status, version
         FROM iam."user" WHERE id = $1`,
      [id],
    );
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
    });
  }

  async savePreferences(user: User, expectedVersion: number): Promise<boolean> {
    const res = await requireSqlExecutor().query(
      `UPDATE iam."user" SET locale = $2, time_zone = $3, version = $4, updated_at = now()
        WHERE id = $1 AND version = $5`,
      [user.id, user.locale.value, user.timeZone?.value ?? null, user.version, expectedVersion],
    );
    return res.rowCount === 1;
  }
}

interface WorkspaceRow {
  id: string;
  name: string;
  base_currency: string;
  base_scale: number;
  time_zone: string;
  locale: string;
  fiscal_month_start_day: number;
  reserve_amount: string | null;
  reserve_currency: string | null;
  reserve_scale: number | null;
  personal_of_user_id: string | null;
  status: WorkspaceStatus;
  version: number;
}

export class PgWorkspaceRepository implements WorkspaceRepository {
  async lockProvisioning(userId: string): Promise<void> {
    await q(`SELECT pg_advisory_xact_lock(hashtextextended('iam.provision:' || $1, 0))`, [userId]);
  }

  async countActiveMemberships(userId: string): Promise<number> {
    const [r] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM iam.workspace_membership WHERE user_id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    return r?.n ?? 0;
  }

  async insert(ws: Workspace): Promise<void> {
    const s = ws.settings;
    // Sin RETURNING: la política SELECT exige la membresía, que se inserta a continuación.
    await q(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale, fiscal_month_start_day,
                                  min_liquidity_reserve_amount, min_liquidity_reserve_currency,
                                  personal_of_user_id, status, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11)`,
      [
        ws.id,
        s.name,
        s.baseCurrency.code,
        s.timeZone.value,
        s.locale.value,
        s.fiscalMonthStartDay,
        s.minimumLiquidityReserve?.toFixed() ?? null,
        s.minimumLiquidityReserve?.currency.code ?? null,
        ws.personalOfUserId,
        ws.status,
        ws.version,
      ],
    );
    for (const m of ws.memberships) {
      await q(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status, revoked_at)
         VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'REVOKED' THEN now() END)`,
        [ws.id, m.userId, m.role, m.status],
      );
    }
  }

  async findById(id: string): Promise<Workspace | null> {
    const [r] = await q<WorkspaceRow>(
      `SELECT w.id, w.name, w.base_currency, bc.scale AS base_scale, w.time_zone, w.locale, w.fiscal_month_start_day,
              w.min_liquidity_reserve_amount::text AS reserve_amount, w.min_liquidity_reserve_currency AS reserve_currency,
              rc.scale AS reserve_scale, w.personal_of_user_id, w.status, w.version
         FROM iam.workspace w
         JOIN fx.currency bc ON bc.code = w.base_currency
         LEFT JOIN fx.currency rc ON rc.code = w.min_liquidity_reserve_currency
        WHERE w.id = $1`,
      [id],
    );
    if (!r) return null;
    const members = await q<{ user_id: string; role: string; status: Membership['status'] }>(
      `SELECT user_id, role, status FROM iam.workspace_membership WHERE workspace_id = $1 ORDER BY joined_at, user_id`,
      [id],
    );
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
    });
  }

  async update(ws: Workspace, expectedVersion: number): Promise<boolean> {
    const s = ws.settings;
    const res = await requireSqlExecutor().query(
      `UPDATE iam.workspace
          SET name = $2, base_currency = $3, time_zone = $4, locale = $5, fiscal_month_start_day = $6,
              min_liquidity_reserve_amount = $7::numeric, min_liquidity_reserve_currency = $8,
              version = $9, updated_at = now()
        WHERE id = $1 AND version = $10`,
      [
        ws.id,
        s.name,
        s.baseCurrency.code,
        s.timeZone.value,
        s.locale.value,
        s.fiscalMonthStartDay,
        s.minimumLiquidityReserve?.toFixed() ?? null,
        s.minimumLiquidityReserve?.currency.code ?? null,
        ws.version,
        expectedVersion,
      ],
    );
    return res.rowCount === 1;
  }

  async listForUser(userId: string): Promise<readonly WorkspaceSummary[]> {
    const rows = await q<{ id: string; name: string; role: string; base_currency: string }>(
      `SELECT w.id, w.name, m.role, w.base_currency
         FROM iam.workspace_membership m JOIN iam.workspace w ON w.id = m.workspace_id
        WHERE m.user_id = $1 AND m.status = 'ACTIVE'
        ORDER BY m.joined_at, w.id`,
      [userId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, role: toRole(r.role), baseCurrency: r.base_currency }));
  }
}

export class PgMembershipReader implements MembershipReader {
  async activeRole(userId: string, workspaceId: string): Promise<Role | null> {
    const [r] = await q<{ role: string }>(
      `SELECT role FROM iam.workspace_membership WHERE user_id = $1 AND workspace_id = $2 AND status = 'ACTIVE'`,
      [userId, workspaceId],
    );
    return r ? toRole(r.role) : null;
  }
}

/** Adapter de solo lectura sobre el catálogo sembrado `fx.currency` (hasta que FX publique su contrato). */
export class PgCurrencyCatalog implements CurrencyCatalogPort {
  async find(code: string): Promise<Currency | null> {
    const [r] = await q<{ code: string; scale: number }>(
      'SELECT code, scale FROM fx.currency WHERE code = $1 AND is_active',
      [code],
    );
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
