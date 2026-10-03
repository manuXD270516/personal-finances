import type { AuditChangeInput, AuditPort } from '@pf/audit/contracts';
import { currency as makeCurrency, DomainError, Money } from '@pf/shared-kernel';
import {
  ACCOUNT_EVENTS,
  type AccountNatureDto,
  type MoneyDto,
  type PostingEligibilityDto,
} from '../contracts/index.js';
import {
  Account,
  natureOf,
  type AccountChanges,
  type AccountState,
  type AccountStatus,
  type AccountType,
  type Liquidity,
} from '../domain/index.js';
import type { AccountListFilter, AccountsDeps, CurrencyInfo } from './ports/index.js';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `account ${id} not found`);
const preconditionFailed = () =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version');

export interface OpenAccountCommand {
  readonly workspaceId: string;
  readonly id?: string;
  readonly name: string;
  readonly type: string;
  readonly currency: string;
  readonly institutionId?: string | null;
  readonly openedOn?: string | null;
  readonly openingBalance?: { readonly amount: MoneyDto; readonly date: string } | null;
  readonly liquidity?: string | null;
  readonly includeInNetWorth?: boolean;
  readonly includeInBudget?: boolean;
  readonly accountNumberLast4?: string | null;
  readonly color?: string | null;
  readonly icon?: string | null;
  readonly tagIds?: readonly string[];
  readonly cryptoNetwork?: string | null;
  readonly notes?: string | null;
}

/** Cuenta con su saldo derivado del ledger (nunca persistido en Accounts). */
export interface AccountView {
  readonly account: AccountState;
  readonly nature: AccountNatureDto;
  readonly status: AccountStatus;
  /** Saldo presentado (pasivo positivo = adeudado), en la moneda y escala de la cuenta. */
  readonly balance: MoneyDto;
}

export type AccountSort =
  'displayOrder' | 'name' | '-name' | 'type' | 'institution' | 'createdAt' | '-createdAt';

export interface ListAccountsQuery {
  readonly workspaceId: string;
  readonly includeArchived?: boolean;
  readonly types?: readonly AccountType[];
  readonly currencies?: readonly string[];
  readonly institutionId?: string;
  readonly statuses?: readonly AccountStatus[];
  readonly tagId?: string;
  readonly liquidities?: readonly Liquidity[];
  readonly sort?: AccountSort;
  readonly groupBy?: 'type' | 'institution';
}

export interface AccountGroupView {
  readonly key: string | null;
  readonly label: string | null;
  readonly accountIds: readonly string[];
}

export interface AccountListView {
  readonly data: readonly AccountView[];
  readonly groups?: readonly AccountGroupView[];
}

/**
 * Casos de uso de cuentas (design.md decisiones 1, 2, 4, 11, 12). Cada mutación corre en UNA unidad de trabajo:
 * dominio → persistencia (optimistic locking) → outbox → auditoría (AuditPort, INV-029). La apertura con saldo
 * inicial invoca `AccountOpeningBalancePort` (compuesto en apps/api sobre el ledger) en esa MISMA unidad de trabajo:
 * si el asiento se rechaza, la cuenta, su evento y su auditoría hacen rollback.
 */
export class AccountsService {
  constructor(
    private readonly deps: AccountsDeps,
    private readonly audit: AuditPort = deps.audit,
  ) {}

  openAccount(cmd: OpenAccountCommand): Promise<AccountView> {
    const { uow, accounts, ids } = this.deps;
    return uow.run(cmd.workspaceId, async () => {
      const ccy = await this.enabledCurrency(cmd.currency, '/currency');
      if (cmd.institutionId) await this.assertAssignableInstitution(cmd.workspaceId, cmd.institutionId);
      if (cmd.tagIds && cmd.tagIds.length > 0) {
        await this.deps.tags.assertAssignable(cmd.workspaceId, cmd.tagIds);
      }
      const opening = cmd.openingBalance
        ? this.openingAmount(cmd.openingBalance.amount, ccy, cmd.currency)
        : null;
      const openedOn =
        cmd.openedOn ?? cmd.openingBalance?.date ?? (await this.deps.calendar.today(cmd.workspaceId));
      const account = Account.open({
        id: cmd.id ?? ids.next(),
        workspaceId: cmd.workspaceId,
        name: cmd.name,
        type: cmd.type,
        currency: cmd.currency,
        currencyKind: ccy.kind,
        institutionId: cmd.institutionId ?? null,
        liquidity: cmd.liquidity ?? null,
        ...(cmd.includeInNetWorth === undefined ? {} : { includeInNetWorth: cmd.includeInNetWorth }),
        ...(cmd.includeInBudget === undefined ? {} : { includeInBudget: cmd.includeInBudget }),
        openedOn,
        displayOrder: await accounts.nextDisplayOrder(cmd.workspaceId),
        accountNumberLast4: cmd.accountNumberLast4 ?? null,
        color: cmd.color ?? null,
        icon: cmd.icon ?? null,
        notes: cmd.notes ?? null,
        tagIds: cmd.tagIds ?? [],
        cryptoNetwork: cmd.cryptoNetwork ?? null,
      });
      await accounts.insert(account);
      const s = account.snapshot;
      await this.publish(account, ACCOUNT_EVENTS.opened, {
        accountId: s.id,
        name: s.name,
        type: s.type,
        nature: account.nature,
        currency: s.currency,
        institutionId: s.institutionId,
        openedOn: s.openedOn ?? openedOn,
        includeInNetWorth: s.includeInNetWorth,
        liquidity: s.liquidity,
      });
      if (opening && !opening.isZero() && cmd.openingBalance) {
        await this.deps.openingBalance.recordOpeningBalance({
          workspaceId: cmd.workspaceId,
          accountId: s.id,
          nature: account.nature,
          amount: opening.toJSON(),
          date: cmd.openingBalance.date,
        });
      }
      const changes: AuditChangeInput[] = [
        { field: 'name', before: null, after: s.name },
        { field: 'type', before: null, after: s.type },
        { field: 'currency', before: null, after: s.currency },
        { field: 'liquidity', before: null, after: s.liquidity },
        { field: 'institutionId', before: null, after: s.institutionId },
        { field: 'openedOn', before: null, after: s.openedOn },
      ];
      if (s.accountNumberLast4)
        changes.push({ field: 'accountNumberLast4', before: null, after: s.accountNumberLast4 });
      if (opening) changes.push({ field: 'openingBalance', before: null, after: opening.toJSON() });
      await this.audit.append({
        workspaceId: s.workspaceId,
        action: 'accounts.account.opened',
        aggregateType: 'Account',
        aggregateId: s.id,
        aggregateVersion: s.version,
        changes,
      });
      return this.view(account);
    });
  }

  updateAccount(
    workspaceId: string,
    accountId: string,
    expectedVersion: number,
    changes: AccountChanges,
  ): Promise<AccountView> {
    const { uow, accounts } = this.deps;
    return uow.run(workspaceId, async () => {
      const account = await this.load(workspaceId, accountId, expectedVersion);
      const before = account.snapshot;
      let currencyKind: string | undefined;
      let hasPostings = false;
      if (changes.currency !== undefined && changes.currency !== before.currency) {
        currencyKind = (await this.enabledCurrency(changes.currency, '/currency')).kind;
        hasPostings = (await this.deps.balances.balancesOf(workspaceId, [accountId])).has(accountId);
      }
      if (changes.institutionId && changes.institutionId !== before.institutionId) {
        await this.assertAssignableInstitution(workspaceId, changes.institutionId);
      }
      if (changes.tagIds && changes.tagIds.length > 0) {
        await this.deps.tags.assertAssignable(workspaceId, changes.tagIds);
      }
      const changed = account.update(changes, {
        hasPostings,
        ...(currencyKind === undefined ? {} : { currencyKind }),
      });
      if (changed.length === 0) return this.view(account);
      if (!(await accounts.update(account))) throw preconditionFailed();
      const after = account.snapshot;
      const payload: Record<string, unknown> = { accountId, changedFields: changed };
      for (const f of ['name', 'institutionId', 'liquidity', 'includeInNetWorth', 'currency'] as const) {
        if (changed.includes(f)) payload[f] = after[f];
      }
      await this.publish(account, ACCOUNT_EVENTS.updated, payload);
      await this.audit.append({
        workspaceId,
        action: 'accounts.account.updated',
        aggregateType: 'Account',
        aggregateId: accountId,
        aggregateVersion: after.version,
        changes: changed.map((field) => ({ field, before: before[field], after: after[field] })),
      });
      return this.view(account);
    });
  }

  archiveAccount(
    workspaceId: string,
    accountId: string,
    expectedVersion: number,
    reason: string | null,
  ): Promise<AccountView> {
    return this.deps.uow.run(workspaceId, async () => {
      const account = await this.load(workspaceId, accountId, expectedVersion, true);
      const previous = account.status;
      account.archive(this.deps.clock.now().toString(), reason);
      await this.save(account);
      await this.publish(account, ACCOUNT_EVENTS.archived, {
        accountId,
        archivedOn: await this.deps.calendar.today(workspaceId),
        reason: account.snapshot.archiveReason,
      });
      await this.audit.append({
        workspaceId,
        action: 'accounts.account.archived',
        aggregateType: 'Account',
        aggregateId: accountId,
        aggregateVersion: account.version,
        reason: account.snapshot.archiveReason,
        changes: [{ field: 'status', before: previous, after: 'ARCHIVED' }],
      });
      return this.view(account);
    });
  }

  closeAccount(
    workspaceId: string,
    accountId: string,
    expectedVersion: number,
    input: { readonly closedOn: string; readonly reason?: string | null },
  ): Promise<AccountView> {
    return this.deps.uow.run(workspaceId, async () => {
      const account = await this.load(workspaceId, accountId, expectedVersion, true);
      const balance = (await this.deps.balances.balancesOf(workspaceId, [accountId])).get(accountId);
      const balanceIsZero = balance === undefined || /^-?0(\.0*)?$/.test(balance.balance.amount);
      account.close(input.closedOn, input.reason ?? null, { balanceIsZero });
      await this.save(account);
      const s = account.snapshot;
      await this.publish(account, ACCOUNT_EVENTS.closed, {
        accountId,
        closedOn: s.closedOn,
        reason: s.closeReason,
      });
      await this.audit.append({
        workspaceId,
        action: 'accounts.account.closed',
        aggregateType: 'Account',
        aggregateId: accountId,
        aggregateVersion: s.version,
        reason: s.closeReason,
        changes: [
          { field: 'status', before: 'ACTIVE', after: 'CLOSED' },
          { field: 'closedOn', before: null, after: s.closedOn },
        ],
      });
      return this.view(account);
    });
  }

  reactivateAccount(workspaceId: string, accountId: string, expectedVersion: number): Promise<AccountView> {
    return this.deps.uow.run(workspaceId, async () => {
      const account = await this.load(workspaceId, accountId, expectedVersion, true);
      const previousStatus = account.reactivate();
      await this.save(account);
      await this.publish(account, ACCOUNT_EVENTS.reactivated, {
        accountId,
        previousStatus,
        reactivatedOn: await this.deps.calendar.today(workspaceId),
      });
      await this.audit.append({
        workspaceId,
        action: 'accounts.account.reactivated',
        aggregateType: 'Account',
        aggregateId: accountId,
        aggregateVersion: account.version,
        changes: [{ field: 'status', before: previousStatus, after: 'ACTIVE' }],
      });
      return this.view(account);
    });
  }

  /**
   * Orden manual: las cuentas listadas reciben `displayOrder` 0..n-1; las demás conservan su orden relativo detrás.
   * `REFERENCE_NOT_FOUND` si un id no es una cuenta del workspace.
   */
  reorderAccounts(workspaceId: string, accountIds: readonly string[]): Promise<void> {
    return this.deps.uow.run(workspaceId, async () => {
      const all = await this.deps.accounts.listAllForUpdate(workspaceId);
      const byId = new Map(all.map((a) => [a.id, a]));
      accountIds.forEach((id, i) => {
        if (!byId.has(id)) {
          throw new DomainError('REFERENCE_NOT_FOUND', `account ${id} not found`).at(`/accountIds/${i}`);
        }
      });
      const listed = new Set(accountIds);
      const ordered = [
        ...accountIds.map((id) => byId.get(id) as Account),
        ...all.filter((a) => !listed.has(a.id)),
      ];
      for (const [order, account] of ordered.entries()) {
        const before = account.snapshot.displayOrder;
        if (!account.moveTo(order)) continue;
        await this.save(account);
        await this.publish(account, ACCOUNT_EVENTS.updated, {
          accountId: account.id,
          changedFields: ['displayOrder'],
        });
        await this.audit.append({
          workspaceId,
          action: 'accounts.account.reordered',
          aggregateType: 'Account',
          aggregateId: account.id,
          aggregateVersion: account.version,
          changes: [{ field: 'displayOrder', before, after: order }],
        });
      }
    });
  }

  getAccount(workspaceId: string, accountId: string): Promise<AccountView> {
    return this.deps.uow.run(workspaceId, async () => {
      const account = await this.deps.accounts.findById(workspaceId, accountId);
      if (!account) throw notFound(accountId);
      return this.view(account);
    });
  }

  /**
   * Listado con filtros, orden y agrupación (TC-ACCOUNTS-LIST-002). Por defecto ACTIVE + CLOSED; ARCHIVED solo con
   * `includeArchived` o `status=ARCHIVED` explícito. Saldos en lote desde LEDGER.
   */
  listAccounts(query: ListAccountsQuery): Promise<AccountListView> {
    return this.deps.uow.run(query.workspaceId, async () => {
      const statuses: AccountStatus[] =
        query.statuses && query.statuses.length > 0
          ? [...query.statuses]
          : query.includeArchived
            ? ['ACTIVE', 'CLOSED', 'ARCHIVED']
            : ['ACTIVE', 'CLOSED'];
      const filter: AccountListFilter = {
        statuses,
        ...(query.types ? { types: query.types } : {}),
        ...(query.currencies ? { currencies: query.currencies } : {}),
        ...(query.institutionId ? { institutionId: query.institutionId } : {}),
        ...(query.tagId ? { tagId: query.tagId } : {}),
        ...(query.liquidities ? { liquidities: query.liquidities } : {}),
      };
      const found = sortAccounts(await this.deps.accounts.list(query.workspaceId, filter), query.sort);
      const views = await this.views(query.workspaceId, found);
      if (!query.groupBy) return { data: views };
      return { data: views, groups: await this.groups(query.workspaceId, found, query.groupBy) };
    });
  }

  /** `AccountsQueryPort.getPostingEligibility` con `FOR SHARE` (INV-026, design.md decisión 4). */
  getPostingEligibility(
    workspaceId: string,
    accountIds: readonly string[],
  ): Promise<PostingEligibilityDto[]> {
    return this.deps.uow.run(workspaceId, async () =>
      (await this.deps.accounts.lockForPosting(workspaceId, accountIds)).map((a) => ({
        accountId: a.id,
        currency: a.currency,
        nature: a.nature,
        status: a.status,
      })),
    );
  }

  /** Verificación que Transactions aplica antes de crear/editar/anular (TC-ACCOUNTS-ARCHIVE-002). */
  assertCanPost(
    workspaceId: string,
    targets: readonly { readonly accountId: string; readonly currency?: string }[],
  ): Promise<PostingEligibilityDto[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const locked = await this.deps.accounts.lockForPosting(
        workspaceId,
        targets.map((t) => t.accountId),
      );
      const byId = new Map(locked.map((a) => [a.id, a]));
      return targets.map((t) => {
        const account = byId.get(t.accountId);
        if (!account) throw new DomainError('REFERENCE_NOT_FOUND', `account ${t.accountId} not found`);
        account.assertCanReceivePostings();
        if (t.currency !== undefined && t.currency !== account.currency) {
          throw new DomainError(
            'CURRENCY_MISMATCH',
            `account ${account.id} is in ${account.currency}, not ${t.currency}`,
          );
        }
        return {
          accountId: account.id,
          currency: account.currency,
          nature: account.nature,
          status: account.status,
        };
      });
    });
  }

  // ------------------------------------------------------------------ helpers

  private async load(workspaceId: string, id: string, expectedVersion: number, forUpdate = false) {
    const account = await this.deps.accounts.findById(workspaceId, id, { forUpdate });
    if (!account) throw notFound(id);
    if (account.version !== expectedVersion) throw preconditionFailed();
    return account;
  }

  private async save(account: Account): Promise<void> {
    if (!(await this.deps.accounts.update(account))) throw preconditionFailed();
  }

  private async enabledCurrency(code: string, pointer: string): Promise<CurrencyInfo> {
    const ccy = await this.deps.currencies.find(code);
    if (!ccy || !ccy.active) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not enabled`).at(pointer);
    }
    return ccy;
  }

  private async assertAssignableInstitution(workspaceId: string, institutionId: string): Promise<void> {
    const institution = await this.deps.institutions.findById(workspaceId, institutionId);
    if (!institution) {
      throw new DomainError('REFERENCE_NOT_FOUND', 'institution not found').at('/institutionId');
    }
    if (institution.isArchived) {
      throw new DomainError('INSTITUTION_ARCHIVED', `institution ${institutionId} is archived`).at(
        '/institutionId',
      );
    }
  }

  private openingAmount(amount: MoneyDto, ccy: CurrencyInfo, accountCurrency: string): Money {
    if (amount.currency !== accountCurrency) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `opening balance must be in ${accountCurrency}, got ${amount.currency}`,
      ).at('/openingBalance/amount/currency');
    }
    try {
      return Money.parse(amount.amount, makeCurrency(ccy.code, ccy.scale));
    } catch (err) {
      throw err instanceof DomainError ? err.at('/openingBalance/amount/amount') : err;
    }
  }

  private async publish(
    account: Account,
    event: { readonly eventType: string; readonly eventVersion: number },
    payload: object,
  ): Promise<void> {
    await this.deps.outbox.append({
      eventId: this.deps.ids.next(),
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      occurredAt: this.deps.clock.now().toString(),
      workspaceId: account.workspaceId,
      aggregateType: 'Account',
      aggregateId: account.id,
      aggregateVersion: account.version,
      payload,
    });
  }

  private async view(account: Account): Promise<AccountView> {
    return (await this.views(account.workspaceId, [account]))[0] as AccountView;
  }

  private async views(workspaceId: string, accounts: readonly Account[]): Promise<AccountView[]> {
    const balances = await this.deps.balances.balancesOf(
      workspaceId,
      accounts.map((a) => a.id),
    );
    const scales = new Map<string, number>();
    const out: AccountView[] = [];
    for (const account of accounts) {
      let presented = balances.get(account.id)?.presented;
      if (!presented || presented.currency !== account.currency) {
        let scale = scales.get(account.currency);
        if (scale === undefined) {
          scale = (await this.deps.currencies.find(account.currency))?.scale ?? 2;
          scales.set(account.currency, scale);
        }
        presented = Money.zero(makeCurrency(account.currency, scale)).toJSON();
      }
      out.push({
        account: account.snapshot,
        nature: natureOf(account.type),
        status: account.status,
        balance: presented,
      });
    }
    return out;
  }

  private async groups(
    workspaceId: string,
    accounts: readonly Account[],
    groupBy: 'type' | 'institution',
  ): Promise<AccountGroupView[]> {
    const groups = new Map<string | null, string[]>();
    for (const a of accounts) {
      const key = groupBy === 'type' ? a.type : a.snapshot.institutionId;
      groups.set(key, [...(groups.get(key) ?? []), a.id]);
    }
    const out: AccountGroupView[] = [];
    for (const [key, accountIds] of groups) {
      let label: string | null = key;
      if (groupBy === 'institution') {
        label =
          key === null
            ? null
            : ((await this.deps.institutions.findById(workspaceId, key))?.snapshot.name ?? null);
      }
      out.push({ key, label, accountIds });
    }
    return out;
  }
}

function sortAccounts(accounts: Account[], sort: AccountSort = 'displayOrder'): Account[] {
  const by = (f: (a: AccountState) => string | number, dir = 1) =>
    [...accounts].sort((x, y) => {
      const a = f(x.snapshot);
      const b = f(y.snapshot);
      if (a < b) return -dir;
      if (a > b) return dir;
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });
  switch (sort) {
    case 'name':
      return by((s) => s.name.toLowerCase());
    case '-name':
      return by((s) => s.name.toLowerCase(), -1);
    case 'type':
      return by((s) => s.type);
    case 'institution':
      return by((s) => s.institutionId ?? '￿');
    case 'createdAt':
      return by((s) => s.createdAt ?? s.id);
    case '-createdAt':
      return by((s) => s.createdAt ?? s.id, -1);
    default:
      return by((s) => s.displayOrder);
  }
}
