import type {
  AuditChangeInput,
  AuditEntry,
  AuditPort,
  LifecycleDto,
  LifecycleEventRefDto,
} from '@pf/audit/contracts';
import { currency as makeCurrency, DomainError, Money } from '@pf/shared-kernel';
import {
  ACCOUNT_EVENTS,
  type AccountNatureDto,
  type MoneyDto,
  type PostingEligibilityDto,
} from '../contracts/index.js';
import {
  ACCOUNT_LIFECYCLE,
  Account,
  natureOf,
  type AccountChanges,
  type AccountState,
  type AccountStatus,
  type AccountType,
  type Liquidity,
} from '../domain/index.js';
import { baseCurrencyBalanceOf, type BaseCurrencyBalanceDto } from './base-currency-valuation.js';
import type { AccountListFilter, AccountsDeps, CurrencyInfo } from './ports/index.js';

const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `account ${id} not found`);
/** 412 con la versión vigente (`currentVersion`, docs/10 §6) cuando se conoce. */
const preconditionFailed = (currentVersion?: number) =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });
/** El UPDATE condicional perdió una carrera: relee la fila para publicar la versión ganadora. */
const lostRace = async (current: Promise<{ readonly version: number } | null>) =>
  preconditionFailed((await current)?.version);

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
  /** Equivalente en la moneda base (derivado, nunca persistido); `null` en moneda base o sin tasa. */
  readonly baseCurrencyBalance: BaseCurrencyBalanceDto | null;
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
      const ccy = await this.enabledCurrency(cmd.workspaceId, cmd.currency, '/currency');
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
      const opened = await this.publish(account, ACCOUNT_EVENTS.opened, {
        accountId: s.id,
        name: s.name,
        type: s.type,
        nature: account.nature,
        currency: s.currency,
        institutionId: s.institutionId,
        openedOn: s.openedOn ?? openedOn,
        includeInNetWorth: s.includeInNetWorth,
        liquidity: s.liquidity,
        transition: 'OPEN',
      });
      let openingEntryId: string | null = null;
      if (opening && !opening.isZero() && cmd.openingBalance) {
        ({ journalEntryId: openingEntryId } = await this.deps.openingBalance.recordOpeningBalance({
          workspaceId: cmd.workspaceId,
          accountId: s.id,
          nature: account.nature,
          amount: opening.toJSON(),
          date: cmd.openingBalance.date,
        }));
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
      await this.record(
        account,
        {
          workspaceId: s.workspaceId,
          action: 'accounts.account.opened',
          aggregateType: 'Account',
          aggregateId: s.id,
          aggregateVersion: s.version,
          changes,
        },
        [opened],
        openingEntryId,
      );
      // Releer la fila: `created_at` lo fija la base al insertar; sin esto la respuesta 201 llevaba `createdAt` nulo,
      // presentado como 1970-01-01 (regresión en accounts-ledger.api.test.ts).
      return this.view((await accounts.findById(s.workspaceId, s.id)) ?? account);
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
        currencyKind = (await this.enabledCurrency(workspaceId, changes.currency, '/currency')).kind;
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
      if (!(await accounts.update(account))) throw await lostRace(accounts.findById(workspaceId, accountId));
      const after = account.snapshot;
      const payload: Record<string, unknown> = { accountId, changedFields: changed };
      for (const f of ['name', 'institutionId', 'liquidity', 'includeInNetWorth', 'currency'] as const) {
        if (changed.includes(f)) payload[f] = after[f];
      }
      const updated = await this.publish(account, ACCOUNT_EVENTS.updated, payload);
      await this.record(
        account,
        {
          workspaceId,
          action: 'accounts.account.updated',
          aggregateType: 'Account',
          aggregateId: accountId,
          aggregateVersion: after.version,
          changes: changed.map((field) => ({ field, before: before[field], after: after[field] })),
        },
        [updated],
        null,
        changed,
      );
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
      const archived = await this.publish(account, ACCOUNT_EVENTS.archived, {
        accountId,
        archivedOn: await this.deps.calendar.today(workspaceId),
        reason: account.snapshot.archiveReason,
        transition: 'ARCHIVE',
      });
      await this.record(
        account,
        {
          workspaceId,
          action: 'accounts.account.archived',
          aggregateType: 'Account',
          aggregateId: accountId,
          aggregateVersion: account.version,
          reason: account.snapshot.archiveReason,
          changes: [{ field: 'status', before: previous, after: 'ARCHIVED' }],
        },
        [archived],
      );
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
      const closed = await this.publish(account, ACCOUNT_EVENTS.closed, {
        accountId,
        closedOn: s.closedOn,
        reason: s.closeReason,
        transition: 'CLOSE',
      });
      await this.record(
        account,
        {
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
        },
        [closed],
      );
      return this.view(account);
    });
  }

  reactivateAccount(workspaceId: string, accountId: string, expectedVersion: number): Promise<AccountView> {
    return this.deps.uow.run(workspaceId, async () => {
      const account = await this.load(workspaceId, accountId, expectedVersion, true);
      const previousStatus = account.reactivate();
      await this.save(account);
      const reactivated = await this.publish(account, ACCOUNT_EVENTS.reactivated, {
        accountId,
        previousStatus,
        reactivatedOn: await this.deps.calendar.today(workspaceId),
        transition: 'REACTIVATE',
      });
      await this.record(
        account,
        {
          workspaceId,
          action: 'accounts.account.reactivated',
          aggregateType: 'Account',
          aggregateId: accountId,
          aggregateVersion: account.version,
          changes: [{ field: 'status', before: previousStatus, after: 'ACTIVE' }],
        },
        [reactivated],
      );
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
        const updated = await this.publish(account, ACCOUNT_EVENTS.updated, {
          accountId: account.id,
          changedFields: ['displayOrder'],
        });
        await this.record(
          account,
          {
            workspaceId,
            action: 'accounts.account.reordered',
            aggregateType: 'Account',
            aggregateId: account.id,
            aggregateVersion: account.version,
            changes: [{ field: 'displayOrder', before, after: order }],
          },
          [updated],
          null,
          ['displayOrder'],
        );
      }
    });
  }

  /**
   * `GET W/accounts/{id}/lifecycle` (add-lifecycle-timeline decisión 7; VIEWER, D28): verifica que la cuenta existe en
   * el workspace (otro workspace ⇒ 404 idéntico a inexistente, RLS) y pide su recorrido a AUDIT con el estado actual.
   */
  accountLifecycle(input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly accountId: string;
  }): Promise<LifecycleDto> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const account = await this.deps.accounts.findById(input.workspaceId, input.accountId);
      if (!account) throw notFound(input.accountId);
      return this.deps.lifecycleQuery.lifecycleOf({
        userId: input.userId,
        workspaceId: input.workspaceId,
        aggregateType: 'Account',
        aggregateId: account.id,
        currentState: account.status,
      });
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
    if (account.version !== expectedVersion) throw preconditionFailed(account.version);
    return account;
  }

  private async save(account: Account): Promise<void> {
    if (!(await this.deps.accounts.update(account))) {
      throw await lostRace(this.deps.accounts.findById(account.workspaceId, account.id));
    }
  }

  /**
   * Moneda activa en el catálogo global Y habilitada en el workspace (docs/31 D45; FR-ACCOUNTS-002). Si no,
   * `CURRENCY_NOT_ENABLED` (422) apuntando al campo.
   */
  private async enabledCurrency(workspaceId: string, code: string, pointer: string): Promise<CurrencyInfo> {
    const notEnabled = () =>
      new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not enabled`).at(pointer);
    const ccy = await this.deps.currencies.find(code);
    if (!ccy || !ccy.active) throw notEnabled();
    const workspace = this.deps.workspaceCurrencies;
    if (workspace && !(await workspace.enabledCurrencies(workspaceId)).some((c) => c.code === code)) {
      throw notEnabled();
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

  /**
   * Auditoría + paso del recorrido en la unidad de trabajo del comando (add-lifecycle-timeline decisión 5): la
   * transición validada por `ACCOUNT_LIFECYCLE` o, si el comando no cambió el estado, una anotación de metadatos.
   */
  private record(
    account: Account,
    entry: AuditEntry,
    events: readonly LifecycleEventRefDto[],
    openingEntryId: string | null = null,
    changedFields: readonly string[] = [],
  ): Promise<void> {
    const t = account.lastTransition;
    return this.deps.lifecycle.record(entry, [
      t
        ? {
            kind: 'TRANSITION',
            transition: t.transition,
            fromState: t.from,
            toState: t.to,
            machineVersion: ACCOUNT_LIFECYCLE.version,
            events,
            ...(openingEntryId ? { journalEntries: { posted: openingEntryId } } : {}),
          }
        : { kind: 'ANNOTATION', changedFields, events },
    ]);
  }

  private async publish(
    account: Account,
    event: { readonly eventType: string; readonly eventVersion: number },
    payload: object,
  ): Promise<LifecycleEventRefDto> {
    const eventId = this.deps.ids.next();
    await this.deps.outbox.append({
      eventId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      occurredAt: this.deps.clock.now().toString(),
      workspaceId: account.workspaceId,
      aggregateType: 'Account',
      aggregateId: account.id,
      aggregateVersion: account.version,
      payload,
    });
    return { eventId, eventType: `${event.eventType}.v${event.eventVersion}` };
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
    const scaleOf = async (code: string) => {
      let scale = scales.get(code);
      if (scale === undefined) {
        scale = (await this.deps.currencies.find(code))?.scale ?? 2;
        scales.set(code, scale);
      }
      return scale;
    };
    const presentedOf = new Map<string, MoneyDto>();
    for (const account of accounts) {
      let presented = balances.get(account.id)?.presented;
      if (!presented || presented.currency !== account.currency) {
        presented = Money.zero(makeCurrency(account.currency, await scaleOf(account.currency))).toJSON();
      }
      presentedOf.set(account.id, presented);
    }
    const valueOf = await this.baseCurrencyValuer(workspaceId, accounts, scaleOf);
    return accounts.map((account) => {
      const balance = presentedOf.get(account.id) as MoneyDto;
      return {
        account: account.snapshot,
        nature: natureOf(account.type),
        status: account.status,
        balance,
        baseCurrencyBalance: valueOf(balance),
      };
    });
  }

  /**
   * Equivalente en moneda base (FR-ACCOUNTS-010, TC-ACCOUNTS-LIST-001): UNA resolución por lote de las tasas de
   * valoración "ahora" (puerto público de FX, misma semántica que Reporting) para las monedas distintas de la base.
   */
  private async baseCurrencyValuer(
    workspaceId: string,
    accounts: readonly Account[],
    scaleOf: (code: string) => Promise<number>,
  ): Promise<(balance: MoneyDto) => BaseCurrencyBalanceDto | null> {
    const valuation = this.deps.valuation;
    if (!valuation || accounts.length === 0) return () => null;
    const { baseCurrency, timeZone } = await valuation.workspaces.settingsOf(workspaceId);
    const codes = [...new Set(accounts.map((a) => a.currency))].filter((c) => c !== baseCurrency).sort();
    const at = this.deps.clock.now().toString();
    const resolved = codes.length
      ? await valuation.rates.resolveValuationRates({
          workspaceId,
          requests: codes.map((code) => ({ base: code, quote: baseCurrency, at })),
        })
      : [];
    const rates = new Map(codes.map((code, i) => [code, resolved[i] ?? null]));
    const base = { code: baseCurrency, scale: await scaleOf(baseCurrency) };
    return (balance) =>
      baseCurrencyBalanceOf({ balance, base, valuation: rates.get(balance.currency) ?? null, timeZone });
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
