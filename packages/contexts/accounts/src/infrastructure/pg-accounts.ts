import type { BalanceQuery } from '@pf/ledger/contracts';
import { currentRequestContext, PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { DomainError } from '@pf/shared-kernel';
import { sql, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type {
  AccountListFilter,
  AccountRepository,
  CurrencyCatalog,
  IdGenerator,
  InstitutionListFilter,
  InstitutionRepository,
  LedgerAccountBalance,
  LedgerBalancesPort,
  UnitOfWork,
} from '../application/ports/index.js';
import {
  Account,
  Institution,
  type AccountType,
  type InstitutionKind,
  type Liquidity,
} from '../domain/index.js';

/** Tablas del schema `accounts` (fechas como texto, timestamptz como string ISO). */
interface AccountsDb {
  'accounts.account': {
    id: string;
    workspace_id: string;
    name: string;
    type: AccountType;
    classification: 'ASSET' | 'LIABILITY';
    currency: string;
    institution_id: string | null;
    liquidity: Liquidity;
    include_in_net_worth: boolean;
    include_in_budget: boolean;
    opened_on: string | null;
    closed_on: string | null;
    close_reason: string | null;
    archived_at: string | null;
    archive_reason: string | null;
    display_order: number;
    account_number_last4: string | null;
    color: string | null;
    icon: string | null;
    notes: string | null;
    crypto_network: string | null;
    version: number;
    created_at: string;
    updated_at: string;
  };
  'accounts.account_tag': { workspace_id: string; account_id: string; tag_id: string };
  'accounts.institution': {
    id: string;
    workspace_id: string;
    name: string;
    kind: InstitutionKind;
    country_code: string | null;
    website: string | null;
    icon: string | null;
    color: string | null;
    notes: string | null;
    archived_at: string | null;
    version: number;
    created_at: string;
    updated_at: string;
  };
  'fx.currency': {
    code: string;
    kind: string;
    scale: number;
    is_active: boolean;
    owner_workspace_id: string | null;
  };
}

type AccountRow = AccountsDb['accounts.account'];

const db = (): Kysely<AccountsDb> => unitOfWorkKysely<AccountsDb>();

const pgCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
const pgConstraint = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'constraint' in err
    ? String((err as { constraint: unknown }).constraint)
    : undefined;

/** 23505 en los únicos parciales de nombre → `ACCOUNT_NAME_TAKEN` / `NAME_TAKEN` (tarea 5.2). */
function mapUnique(err: unknown): unknown {
  if (pgCode(err) !== '23505') return err;
  const constraint = pgConstraint(err);
  if (constraint === 'account_name_uk') {
    return new DomainError('ACCOUNT_NAME_TAKEN', 'an active account already uses this name', {
      cause: err,
    }).at('/name');
  }
  if (constraint === 'institution_name_uk') {
    return new DomainError('NAME_TAKEN', 'an active institution already uses this name', { cause: err }).at(
      '/name',
    );
  }
  return err;
}

// Columnas de fecha como texto: evita el parser de `pg` (date → Date local).
const accountColumns = [
  'a.id',
  'a.workspace_id',
  'a.name',
  'a.type',
  'a.classification',
  'a.currency',
  'a.institution_id',
  'a.liquidity',
  'a.include_in_net_worth',
  'a.include_in_budget',
  'a.close_reason',
  'a.archive_reason',
  'a.display_order',
  'a.account_number_last4',
  'a.color',
  'a.icon',
  'a.notes',
  'a.crypto_network',
  'a.version',
  sql<string | null>`a.opened_on::text`.as('opened_on'),
  sql<string | null>`a.closed_on::text`.as('closed_on'),
  sql<string | null>`to_char(a.archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as(
    'archived_at',
  ),
  sql<string>`to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as('created_at'),
  sql<string>`to_char(a.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as('updated_at'),
  sql<string[]>`COALESCE((SELECT array_agg(t.tag_id::text ORDER BY t.tag_id) FROM accounts.account_tag t
     WHERE t.workspace_id = a.workspace_id AND t.account_id = a.id), '{}')`.as('tag_ids'),
] as const;

function toAccount(row: AccountRow & { tag_ids: string[] }): Account {
  return Account.restore({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    institutionId: row.institution_id,
    liquidity: row.liquidity,
    includeInNetWorth: row.include_in_net_worth,
    includeInBudget: row.include_in_budget,
    openedOn: row.opened_on,
    closedOn: row.closed_on,
    closeReason: row.close_reason,
    archivedAt: row.archived_at,
    archiveReason: row.archive_reason,
    displayOrder: row.display_order,
    accountNumberLast4: row.account_number_last4,
    color: row.color,
    icon: row.icon,
    notes: row.notes,
    tagIds: row.tag_ids ?? [],
    cryptoNetwork: row.crypto_network,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function accountValues(account: Account) {
  const s = account.snapshot;
  return {
    name: s.name,
    currency: s.currency,
    institution_id: s.institutionId,
    liquidity: s.liquidity,
    include_in_net_worth: s.includeInNetWorth,
    include_in_budget: s.includeInBudget,
    opened_on: s.openedOn,
    closed_on: s.closedOn,
    close_reason: s.closeReason,
    archived_at: s.archivedAt,
    archive_reason: s.archiveReason,
    display_order: s.displayOrder,
    account_number_last4: s.accountNumberLast4,
    color: s.color,
    icon: s.icon,
    notes: s.notes,
    crypto_network: s.cryptoNetwork,
    version: s.version,
  };
}

/** Repositorio Kysely de cuentas sobre la unidad de trabajo en curso (RLS WS ya fijado). */
export class PgAccountRepository implements AccountRepository {
  async insert(account: Account): Promise<void> {
    const s = account.snapshot;
    try {
      await db()
        .insertInto('accounts.account')
        .values({
          id: s.id,
          workspace_id: s.workspaceId,
          type: s.type,
          classification: account.nature,
          ...accountValues(account),
        } as never)
        .execute();
    } catch (err) {
      throw mapUnique(err);
    }
    await this.saveTags(account);
  }

  async update(account: Account): Promise<boolean> {
    const s = account.snapshot;
    let updated: bigint;
    try {
      const res = await db()
        .updateTable('accounts.account')
        .set({ ...accountValues(account), updated_at: sql`now()` } as never)
        .where('workspace_id', '=', s.workspaceId)
        .where('id', '=', s.id)
        .where('version', '=', account.persistedVersion)
        .executeTakeFirst();
      updated = res.numUpdatedRows;
    } catch (err) {
      throw mapUnique(err);
    }
    if (updated === 0n) return false;
    await this.saveTags(account);
    return true;
  }

  private async saveTags(account: Account): Promise<void> {
    const s = account.snapshot;
    const current = await db()
      .selectFrom('accounts.account_tag')
      .select('tag_id')
      .where('workspace_id', '=', s.workspaceId)
      .where('account_id', '=', s.id)
      .execute();
    const have = new Set(current.map((r) => r.tag_id));
    const want = new Set(s.tagIds);
    const remove = [...have].filter((t) => !want.has(t));
    const add = [...want].filter((t) => !have.has(t));
    if (remove.length > 0) {
      await db()
        .deleteFrom('accounts.account_tag')
        .where('workspace_id', '=', s.workspaceId)
        .where('account_id', '=', s.id)
        .where('tag_id', 'in', remove)
        .execute();
    }
    if (add.length > 0) {
      await db()
        .insertInto('accounts.account_tag')
        .values(add.map((tag_id) => ({ workspace_id: s.workspaceId, account_id: s.id, tag_id })))
        .execute();
    }
  }

  async findById(
    workspaceId: string,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<Account | null> {
    if (!UUID.test(id)) return null;
    let q = db()
      .selectFrom('accounts.account as a')
      .select(accountColumns)
      .where('a.workspace_id', '=', workspaceId)
      .where('a.id', '=', id);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? toAccount(row as never) : null;
  }

  async list(workspaceId: string, filter: AccountListFilter): Promise<Account[]> {
    let q = db()
      .selectFrom('accounts.account as a')
      .select(accountColumns)
      .where('a.workspace_id', '=', workspaceId);
    const status = sql<string>`CASE WHEN a.archived_at IS NOT NULL THEN 'ARCHIVED'
      WHEN a.closed_on IS NOT NULL THEN 'CLOSED' ELSE 'ACTIVE' END`;
    q = q.where(status, 'in', [...filter.statuses]);
    if (filter.types?.length) q = q.where('a.type', 'in', [...filter.types]);
    if (filter.currencies?.length) q = q.where('a.currency', 'in', [...filter.currencies]);
    if (filter.liquidities?.length) q = q.where('a.liquidity', 'in', [...filter.liquidities]);
    if (filter.institutionId) q = q.where('a.institution_id', '=', filter.institutionId);
    if (filter.tagId) {
      const tagId = filter.tagId;
      q = q.where(({ exists, selectFrom }) =>
        exists(
          selectFrom('accounts.account_tag as t')
            .select('t.tag_id')
            .whereRef('t.workspace_id', '=', 'a.workspace_id')
            .whereRef('t.account_id', '=', 'a.id')
            .where('t.tag_id', '=', tagId),
        ),
      );
    }
    const rows = await q.orderBy('a.display_order').orderBy('a.id').execute();
    return rows.map((r) => toAccount(r as never));
  }

  async listAllForUpdate(workspaceId: string): Promise<Account[]> {
    const rows = await db()
      .selectFrom('accounts.account as a')
      .select(accountColumns)
      .where('a.workspace_id', '=', workspaceId)
      .orderBy('a.display_order')
      .orderBy('a.id')
      .forUpdate()
      .execute();
    return rows.map((r) => toAccount(r as never));
  }

  async nextDisplayOrder(workspaceId: string): Promise<number> {
    const row = await db()
      .selectFrom('accounts.account')
      .select(sql<number>`COALESCE(MAX(display_order) + 1, 0)::int`.as('next'))
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst();
    return row?.next ?? 0;
  }

  async lockForPosting(workspaceId: string, ids: readonly string[]): Promise<Account[]> {
    if (ids.length === 0) return [];
    const valid = ids.filter((id) => UUID.test(id));
    if (valid.length === 0) return [];
    const rows = await db()
      .selectFrom('accounts.account as a')
      .select(accountColumns)
      .where('a.workspace_id', '=', workspaceId)
      .where('a.id', 'in', valid)
      .orderBy('a.id')
      .forShare()
      .execute();
    return rows.map((r) => toAccount(r as never));
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const institutionColumns = [
  'i.id',
  'i.workspace_id',
  'i.name',
  'i.kind',
  'i.country_code',
  'i.website',
  'i.icon',
  'i.color',
  'i.notes',
  'i.version',
  sql<string | null>`to_char(i.archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as(
    'archived_at',
  ),
] as const;

function toInstitution(row: AccountsDb['accounts.institution']): Institution {
  return Institution.restore({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    kind: row.kind,
    countryCode: row.country_code,
    website: row.website,
    icon: row.icon,
    color: row.color,
    notes: row.notes,
    archivedAt: row.archived_at,
    version: row.version,
  });
}

function institutionValues(i: Institution) {
  const s = i.snapshot;
  return {
    name: s.name,
    kind: s.kind,
    country_code: s.countryCode,
    website: s.website,
    icon: s.icon,
    color: s.color,
    notes: s.notes,
    archived_at: s.archivedAt,
    version: s.version,
  };
}

export class PgInstitutionRepository implements InstitutionRepository {
  async insert(institution: Institution): Promise<void> {
    const s = institution.snapshot;
    try {
      await db()
        .insertInto('accounts.institution')
        .values({ id: s.id, workspace_id: s.workspaceId, ...institutionValues(institution) } as never)
        .execute();
    } catch (err) {
      throw mapUnique(err);
    }
  }

  async update(institution: Institution): Promise<boolean> {
    const s = institution.snapshot;
    try {
      const res = await db()
        .updateTable('accounts.institution')
        .set({ ...institutionValues(institution), updated_at: sql`now()` } as never)
        .where('workspace_id', '=', s.workspaceId)
        .where('id', '=', s.id)
        .where('version', '=', institution.persistedVersion)
        .executeTakeFirst();
      return res.numUpdatedRows > 0n;
    } catch (err) {
      throw mapUnique(err);
    }
  }

  async findById(workspaceId: string, id: string): Promise<Institution | null> {
    if (!UUID.test(id)) return null;
    const row = await db()
      .selectFrom('accounts.institution as i')
      .select(institutionColumns)
      .where('i.workspace_id', '=', workspaceId)
      .where('i.id', '=', id)
      .executeTakeFirst();
    return row ? toInstitution(row as never) : null;
  }

  async list(workspaceId: string, filter: InstitutionListFilter): Promise<Institution[]> {
    let q = db()
      .selectFrom('accounts.institution as i')
      .select(institutionColumns)
      .where('i.workspace_id', '=', workspaceId);
    if (!filter.includeArchived) q = q.where('i.archived_at', 'is', null);
    if (filter.kinds?.length) q = q.where('i.kind', 'in', [...filter.kinds]);
    if (filter.query)
      q = q.where(
        sql<string>`lower(i.name)`,
        'like',
        `%${filter.query.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`,
      );
    const rows = await q
      .orderBy(sql`lower(i.name)`)
      .orderBy('i.id')
      .execute();
    return rows.map((r) => toInstitution(r as never));
  }
}

/** Catálogo `fx.currency`: habilitada = activa (y, si es CUSTOM, del propio workspace — la RLS no aplica aquí). */
export const pgCurrencyCatalog: CurrencyCatalog = {
  async find(code) {
    const row = await db()
      .selectFrom('fx.currency')
      .select(['code', 'kind', 'scale', 'is_active', 'owner_workspace_id'])
      .where('code', '=', code)
      .executeTakeFirst();
    if (!row) return null;
    return { code: row.code, kind: row.kind, scale: Number(row.scale), active: row.is_active };
  },
};

/**
 * Saldos desde LEDGER vía su API pública (`BalanceQuery.getTrialBalance`, misma transacción): la cuenta contable 1:1
 * se identifica por `accountId`. Una cuenta sin ledger account no tiene movimientos (nace con el primer posting).
 */
export class LedgerBalancesAdapter implements LedgerBalancesPort {
  constructor(private readonly ledger: BalanceQuery) {}

  async balancesOf(
    workspaceId: string,
    accountIds: readonly string[],
  ): Promise<ReadonlyMap<string, LedgerAccountBalance>> {
    const wanted = new Set(accountIds);
    const out = new Map<string, LedgerAccountBalance>();
    if (wanted.size === 0) return out;
    const trial = await this.ledger.getTrialBalance({ workspaceId });
    for (const group of trial.currencies) {
      for (const line of group.lines) {
        if (line.accountId && wanted.has(line.accountId)) {
          out.set(line.accountId, { balance: line.balance, presented: line.presented });
        }
      }
    }
    return out;
  }
}

/** Unidad de trabajo: reutiliza la transacción en curso (idempotencia/orquestación) o abre una con RLS del workspace. */
export class PgAccountsUnitOfWork implements UnitOfWork {
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
